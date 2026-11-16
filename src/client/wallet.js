// Non-custodial HD wallet (BIP39 seed, BIP84 native segwit) on Bitcoin signet.
// Keys never leave the device: the seed is encrypted with the seller's PIN (PBKDF2 + AES-GCM)
// before it is stored, and only public addresses are ever sent over the network.
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { HDKey } from '@scure/bip32';
import * as btc from '@scure/btc-signer';
import { hex } from '@scure/base';

export const NETWORK = btc.TEST_NETWORK; // signet uses the same address format as testnet (tb1…)
export const ACCOUNT_PATH = "m/84'/1'/0'";
export const DUST = 546;

export const newMnemonic = () => generateMnemonic(wordlist, 128); // 12 words
export const isValidMnemonic = (m) => validateMnemonic(normalize(m), wordlist);
const normalize = (m) => String(m || '').trim().toLowerCase().split(/\s+/).join(' ');

export function account(mnemonic) {
  if (!isValidMnemonic(mnemonic)) throw new Error('Invalid recovery phrase');
  const root = HDKey.fromMasterSeed(mnemonicToSeedSync(normalize(mnemonic)));
  const acct = root.derive(ACCOUNT_PATH);
  const node = (chain, index) => acct.deriveChild(chain).deriveChild(index);
  return {
    xpubFingerprint: acct.fingerprint,
    address(chain, index) { return btc.p2wpkh(node(chain, index).publicKey, NETWORK).address; },
    key(chain, index) { return node(chain, index).privateKey; },
    pub(chain, index) { return node(chain, index).publicKey; },
  };
}

// ---- PIN encryption of the recovery phrase (WebCrypto, works in browsers and Node 20+) ----
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = () => globalThis.crypto.subtle;
const PBKDF2_ITERATIONS = 310000;

async function pinKey(pin, salt) {
  const base = await subtle().importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export function validPin(pin) { return /^\d{6,}$/.test(String(pin)); }
export async function encryptSecret(secret, pin) {
  if (!validPin(pin)) throw new Error('PIN must be at least 6 digits');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await pinKey(pin, salt), enc.encode(secret)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: PBKDF2_ITERATIONS, salt: hex.encode(salt), iv: hex.encode(iv), ct: hex.encode(ct) };
}
export async function decryptSecret(box, pin) {
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: hex.decode(box.iv) }, await pinKey(pin, hex.decode(box.salt)), hex.decode(box.ct));
    return dec.decode(pt);
  } catch { throw new Error('Wrong PIN'); }
}

// ---- Amounts ----
export const XOF_PER_EUR = 655.957; // CFA franc (XOF) is pegged to the euro
export function xofToSats(xof, btcEur) {
  if (!(xof > 0) || !(btcEur > 0)) throw new Error('Amount and rate must be positive');
  return Math.round((xof / XOF_PER_EUR / btcEur) * 1e8);
}
export const satsToXof = (sats, btcEur) => Math.round((sats / 1e8) * btcEur * XOF_PER_EUR);
export function isAddress(addr) {
  try { btc.Address(NETWORK).decode(String(addr).trim()); return true; } catch { return false; }
}

// ---- Spending: largest-first coin selection, P2WPKH inputs, one change output ----
const vbytes = (ins, outs) => Math.ceil(10.5 + 68 * ins + 31 * outs);
export function selectCoins(utxos, amount, feeRate) {
  const sorted = [...utxos].sort((a, b) => b.value - a.value);
  const picked = []; let total = 0;
  for (const u of sorted) {
    picked.push(u); total += u.value;
    const feeWithChange = vbytes(picked.length, 2) * feeRate;
    if (total >= amount + feeWithChange) {
      const change = total - amount - feeWithChange;
      if (change >= DUST) return { picked, fee: feeWithChange, change };
      const feeNoChange = total - amount; // give the dust to the miners instead of creating a dust output
      if (feeNoChange >= vbytes(picked.length, 1) * feeRate) return { picked, fee: feeNoChange, change: 0 };
    }
  }
  throw new Error('Not enough funds for this amount plus the network fee');
}

// utxos: [{ txid, vout, value, chain, index }], acct from account()
export function buildSend(acct, utxos, { to, amount, feeRate, changeAddress }) {
  if (!isAddress(to)) throw new Error('That is not a valid signet address');
  if (!Number.isInteger(amount) || amount < DUST) throw new Error(`Amount must be at least ${DUST} sats`);
  if (!(feeRate >= 1 && feeRate <= 500)) throw new Error('Fee rate out of range');
  const { picked, fee, change } = selectCoins(utxos, amount, feeRate);
  const tx = new btc.Transaction();
  for (const u of picked) {
    tx.addInput({ txid: u.txid, index: u.vout, witnessUtxo: { script: btc.p2wpkh(acct.pub(u.chain, u.index), NETWORK).script, amount: BigInt(u.value) } });
  }
  tx.addOutputAddress(to.trim(), BigInt(amount), NETWORK);
  if (change) tx.addOutputAddress(changeAddress, BigInt(change), NETWORK);
  picked.forEach((u, i) => tx.signIdx(acct.key(u.chain, u.index), i));
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, fee, change, inputs: picked.length };
}
