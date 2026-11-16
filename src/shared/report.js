// Sales summaries computed on the device (no server analytics).
export function dayTotals(sales, day) {
  const list = sales.filter((s) => s.day === day && s.paid);
  const byMethod = {};
  for (const s of list) byMethod[s.method] = (byMethod[s.method] || 0) + s.xof;
  return { day, count: list.length, total: list.reduce((a, s) => a + s.xof, 0), sats: list.reduce((a, s) => a + (s.sats || 0), 0), byMethod };
}

export function lastDays(sales, n, end = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end); d.setUTCDate(d.getUTCDate() - i);
    out.push(dayTotals(sales, d.toISOString().slice(0, 10)));
  }
  return out;
}

// CSV for an accountant or a savings group. Cells that start with = + - @ are neutralised
// so a customer name can't become a spreadsheet formula.
export function toCsv(sales) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['date', 'time', 'item', 'customer', 'amount_xof', 'sats', 'method']];
  for (const s of sales) {
    const d = new Date(s.at || s.day);
    rows.push([s.day, isNaN(d) ? '' : d.toISOString().slice(11, 16), s.item, s.customer, s.xof, s.sats || 0, s.method]);
  }
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
