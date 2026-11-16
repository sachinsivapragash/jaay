// Lightning through Nostr Wallet Connect (NIP-47). The seller pastes a connection string from
// their own Lightning wallet (Alby Hub, Coinos, Mutiny, …). Jaay never holds Lightning funds:
// it asks the seller's wallet to create an invoice, then asks whether it was paid.
// Requests are kind 23194 events encrypted with NIP-04 to the wallet; replies are kind 23195.
import { Relay, finalizeEvent, getPublicKey, nip04 } from 'nostr-tools';
import { hex } from '@scure/base';

export function parseNwc(uri) {
  const u = new URL(String(uri).trim().replace(/^nostr\+walletconnect:\/\//i, 'http://').replace(/^nostrwalletconnect:\/\//i, 'http://'));
  const walletPubkey = u.hostname || u.pathname.replace(/^\/+/, '');
  const relay = u.searchParams.get('relay');
  const secret = u.searchParams.get('secret');
  if (!/^[0-9a-f]{64}$/.test(walletPubkey) || !relay || !/^wss?:\/\//.test(relay) || !/^[0-9a-f]{64}$/.test(secret || '')) {
    throw new Error('That does not look like a Nostr Wallet Connect string (nostr+walletconnect://…)');
  }
  return { walletPubkey, relay, secret };
}

export function nwcClient(uri, { timeoutMs = 20000 } = {}) {
  const { walletPubkey, relay, secret } = parseNwc(uri);
  const sk = hex.decode(secret);
  let conn = null;
  const connect = async () => (conn && conn.connected ? conn : (conn = await Relay.connect(relay)));

  async function request(method, params = {}) {
    const r = await connect();
    const content = await nip04.encrypt(sk, walletPubkey, JSON.stringify({ method, params }));
    const ev = finalizeEvent({ kind: 23194, created_at: Math.floor(Date.now() / 1000), tags: [['p', walletPubkey]], content }, sk);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { sub.close(); reject(new Error('Your Lightning wallet did not answer in time')); }, timeoutMs);
      const sub = r.subscribe([{ kinds: [23195], authors: [walletPubkey], '#e': [ev.id] }], {
        async onevent(reply) {
          clearTimeout(timer); sub.close();
          try {
            const body = JSON.parse(await nip04.decrypt(sk, walletPubkey, reply.content));
            if (body.error) reject(new Error(body.error.message || body.error.code || 'Wallet error'));
            else resolve(body.result);
          } catch (e) { reject(e); }
        },
      });
      r.publish(ev).catch((e) => { clearTimeout(timer); sub.close(); reject(e); });
    });
  }

  return {
    clientPubkey: getPublicKey(sk),
    getInfo: () => request('get_info'),
    getBalance: () => request('get_balance'), // msats
    makeInvoice: (sats, description) => request('make_invoice', { amount: sats * 1000, description: String(description || '').slice(0, 120) }),
    lookupInvoice: (paymentHash) => request('lookup_invoice', { payment_hash: paymentHash }),
    close: () => conn?.close(),
  };
}
