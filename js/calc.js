// Calculs dérivés des données (ventes enrichies, bénéfices, trésorerie).
import { state, unitCost, activeSales } from "./store.js";
import { saleProfit, round2, num, toDate, inPeriod, orderTotals, sum } from "./logic.js";

/** Ventes non annulées avec coût et bénéfice (admin uniquement : sinon cogs/profit = null). */
export function enrichedSales() {
  return activeSales().map((s) => {
    const c = unitCost(s.productId);
    return { ...s, cogs: c == null ? null : round2(c * num(s.qty)), profit: saleProfit(s, c) };
  });
}

export const salesInPeriod = (period) => enrichedSales().filter((s) => inPeriod(s.date, period));

/** Somme des paiements encaissés sur la période (acomptes + soldes). */
export function collectedInPeriod(period) {
  let t = 0;
  for (const s of activeSales()) {
    for (const p of s.payments || []) if (inPeriod(p.date, period)) t += num(p.amount);
  }
  return round2(t);
}

export const expensesInPeriod = (period) => state.expenses.filter((e) => inPeriod(e.date, period));

export function debts() {
  return activeSales().filter((s) => num(s.remaining) > 0);
}

export const lowStock = () =>
  state.products.filter((p) => !p.archived && num(p.qty) <= num(p.alertQty ?? state.shop.lowStock));

/** Journal de trésorerie dérivé : encaissements de ventes, achats/frais de commande, dépenses boutique. */
export function cashLedger() {
  const rows = [];
  for (const s of activeSales()) {
    for (const p of s.payments || []) {
      rows.push({ date: toDate(p.date), label: `Vente — ${s.productName}${s.buyerName ? " (" + s.buyerName + ")" : ""}`, in: num(p.amount), out: 0, kind: "vente" });
    }
  }
  for (const o of state.orders) {
    if (o.status === "cancelled") continue;
    const t = orderTotals(o);
    rows.push({ date: toDate(o.createdAt), label: `Commande ${o.ref} — achat + frais`, in: 0, out: round2(t.itemsTotal + t.expensesTotal), kind: "commande" });
    if (o.status === "received" && t.freightTotal > 0) {
      rows.push({ date: toDate(o.receivedAt), label: `Commande ${o.ref} — frais de kilo (transport)`, in: 0, out: t.freightTotal, kind: "commande" });
    }
  }
  for (const e of state.expenses) {
    rows.push({ date: toDate(e.date), label: `Dépense — ${e.category}${e.note ? " : " + e.note : ""}`, in: 0, out: num(e.amount), kind: "depense" });
  }
  return rows.filter((r) => r.date).sort((a, b) => b.date - a.date);
}

export { sum };
