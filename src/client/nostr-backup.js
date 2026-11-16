// Encrypted ledger backup over Nostr.
// The seller's Nostr key is derived from the same 12 words as the wallet (NIP-06, m/44'/1237'/0'/0/0),
// so restoring the phrase on a new phone also restores the sales history and the credit book.
// The ledger is encrypted to the seller's own key with NIP-44 and stored as a replaceable
// app-data event (kind 30078, d="jaay-ledger"). Relays only ever see ciphertext.
import { mnemonicToSeedSync } from '@scure/bip39';
import { HDKey } from '@scure/bip32';
import { finalizeEvent, getPublicKey, nip44, SimplePool } from 'nostr-tools';

export const RELAYS = ['wss://nostr.mom', 'wss://offchain.pub', 'wss://relay.nostr.net', 'wss://nostr.oxtr.dev'];
export const KIND = 30078;
export const D_TAG = 'jaay-ledger';
const MAX_PLAINTEXT = 60000; // NIP-44 limit is 65535 bytes

export function nostrKey(mnemonic) {
  const sk = HDKey.fromMasterSeed(mnemonicToSeedSync(String(mnemonic).trim().toLowerCase().split(/\s+/).join(' '))).derive("m/44'/1237'/0'/0/0").privateKey;
  return { sk, pk: getPublicKey(sk) };
}

// Keep the newest records until the JSON fits in one NIP-44 message.
export function packLedger(state) {
  const base = { v: 1, at: Date.now(), shop: state.shop || '', next: state.next || 0, changeNext: state.changeNext || 0, catalog: state.catalog || [], credits: state.credits || {} };
  let sales = (state.sales || []).slice(0, 1500);
  let json = JSON.stringify({ ...base, sales });
  while (new TextEncoder().encode(json).length > MAX_PLAINTEXT && sales.length) {
    sales = sales.slice(0, Math.floor(sales.length * 0.8));
    json = JSON.stringify({ ...base, sales });
  }
  return json;
}

export function sealLedger(state, sk, pk) {
  const content = nip44.encrypt(packLedger(state), nip44.getConversationKey(sk, pk));
  return finalizeEvent({ kind: KIND, created_at: Math.floor(Date.now() / 1000), tags: [['d', D_TAG]], content }, sk);
}

export function openLedger(event, sk, pk) {
  if (event.pubkey !== pk || event.kind !== KIND) throw new Error('Not your backup');
  const data = JSON.parse(nip44.decrypt(event.content, nip44.getConversationKey(sk, pk)));
  if (data.v !== 1 || !Array.isArray(data.sales) || typeof data.credits !== 'object') throw new Error('Unrecognised backup');
  return data;
}

// Merge a restored ledger into local state without losing anything recorded on either side.
export function mergeLedger(local, remote) {
  const ids = new Set((local.sales || []).map((s) => s.id));
  const sales = [...(local.sales || []), ...remote.sales.filter((s) => !ids.has(s.id))].sort((a, b) => (b.at || 0) - (a.at || 0));
  const credits = { ...remote.credits };
  for (const [k, c] of Object.entries(local.credits || {})) {
    if (!credits[k]) { credits[k] = c; continue; }
    const seen = new Set(credits[k].entries.map((e) => `${e.at}|${e.xof}`));
    credits[k] = { ...credits[k], ...c, entries: [...credits[k].entries, ...c.entries.filter((e) => !seen.has(`${e.at}|${e.xof}`))].sort((a, b) => b.at - a.at) };
  }
  const names = new Set((local.catalog || []).map((c) => c.name.toLowerCase()));
  return {
    sales, credits,
    catalog: [...(local.catalog || []), ...remote.catalog.filter((c) => !names.has(c.name.toLowerCase()))].slice(0, 24),
    shop: local.shop || remote.shop,
    next: Math.max(local.next || 0, remote.next || 0), // never reuse a receive address
    changeNext: Math.max(local.changeNext || 0, remote.changeNext || 0),
  };
}

export async function backup(state, mnemonic, relays = RELAYS) {
  const { sk, pk } = nostrKey(mnemonic);
  const ev = sealLedger(state, sk, pk);
  const pool = new SimplePool();
  try {
    const results = await Promise.allSettled(pool.publish(relays, ev));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    if (!ok) throw new Error('No relay accepted the backup');
    return { ok, of: relays.length, at: ev.created_at };
  } finally { pool.close(relays); }
}

export async function restore(mnemonic, relays = RELAYS) {
  const { sk, pk } = nostrKey(mnemonic);
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(relays, { kinds: [KIND], authors: [pk], '#d': [D_TAG] }, { maxWait: 6000 });
    if (!events.length) return null;
    const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
    return openLedger(newest, sk, pk);
  } finally { pool.close(relays); }
}
