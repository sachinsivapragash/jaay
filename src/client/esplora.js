// Minimal Esplora client for Bitcoin signet (mempool.space). Only public addresses and signed
// transactions are sent; requests are small JSON so they work on slow mobile connections.
export const ESPLORA = 'https://mempool.space/signet/api';
export const EXPLORER = 'https://mempool.space/signet';

async function get(path) {
  const r = await fetch(ESPLORA + path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Network error (${r.status})`);
  return r.json();
}

export const addressStats = (a) => get(`/address/${a}`);
export const addressTxs = (a) => get(`/address/${a}/txs`);
export const utxos = (a) => get(`/address/${a}/utxo`);
export async function feeRate() {
  try { const f = await get('/v1/fees/recommended'); return Math.max(1, f.halfHourFee || f.hourFee || 1); } catch { return 2; }
}
export async function broadcast(hex) {
  const r = await fetch(ESPLORA + '/tx', { method: 'POST', body: hex });
  const t = await r.text();
  if (!r.ok) throw new Error(`Broadcast refused: ${t.slice(0, 160)}`);
  return t.trim();
}

// Total received/spent for an address (confirmed + mempool), in sats.
export function balanceOf(stats) {
  const c = stats.chain_stats, m = stats.mempool_stats;
  return { confirmed: c.funded_txo_sum - c.spent_txo_sum, pending: m.funded_txo_sum - m.spent_txo_sum, used: c.tx_count + m.tx_count > 0 };
}

// Amount an address received from a single transaction (sum of outputs paying it).
export const receivedIn = (tx, address) => tx.vout.filter((o) => o.scriptpubkey_address === address).reduce((s, o) => s + o.value, 0);
