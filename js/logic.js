// Logique métier pure (sans Firebase ni DOM) — testable avec Node.

export const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const round4 = (n) => Math.round((n + Number.EPSILON) * 10000) / 10000;

/** Totaux d'une commande : articles + dépenses (transfert, motivation, autre) + frais de kilo. */
export function orderTotals(order) {
  const itemsTotal = round2((order.lines || []).reduce((s, l) => s + num(l.qty) * num(l.unitPrice), 0));
  const expensesTotal = round2((order.expenses || []).reduce((s, e) => s + num(e.amount), 0));
  const freightTotal = round2(num(order.freight?.total));
  return { itemsTotal, expensesTotal, freightTotal, totalCost: round2(itemsTotal + expensesTotal + freightTotal) };
}

/**
 * Répartit les frais annexes (dépenses + transport) sur les lignes pour obtenir le
 * coût de revient unitaire de chaque produit.
 * method = "value" : au prorata de la valeur d'achat de chaque ligne (par défaut)
 * method = "unit"  : même montant par unité
 * Garantit que Σ(coût de revient × qté) = coût total de la commande.
 */
export function allocateCosts(lines, extraTotal, method = "value") {
  const totalQty = lines.reduce((s, l) => s + num(l.qty), 0);
  const itemsTotal = lines.reduce((s, l) => s + num(l.qty) * num(l.unitPrice), 0);
  const useValue = method === "value" && itemsTotal > 0;
  const out = lines.map((l) => {
    const qty = num(l.qty);
    if (qty <= 0) return { landedUnitCost: num(l.unitPrice), extraShare: 0 };
    const share = useValue
      ? extraTotal * ((qty * num(l.unitPrice)) / itemsTotal)
      : totalQty > 0 ? extraTotal * (qty / totalQty) : 0;
    return { extraShare: share, landedUnitCost: num(l.unitPrice) + share / qty };
  });
  return out.map((o) => ({ extraShare: round2(o.extraShare), landedUnitCost: round4(o.landedUnitCost) }));
}

export const suggestPrice = (cost, marginPct) => round2(num(cost) * (1 + num(marginPct) / 100));

/** Statut d'une vente selon le montant payé. */
export function paymentStatus(total, paid) {
  const t = round2(num(total)), p = round2(num(paid));
  if (p >= t) return "paid";
  if (p <= 0) return "unpaid";
  return "partial";
}

export const remaining = (total, paid) => Math.max(0, round2(num(total) - num(paid)));

/** Une vente est en retard si un solde est dû et que l'échéance est passée. */
export function isOverdue(sale, now = new Date()) {
  if (!sale || sale.status === "cancelled" || num(sale.remaining) <= 0) return false;
  const d = toDate(sale.dueDate);
  if (!d) return false;
  const end = new Date(d); end.setHours(23, 59, 59, 999);
  return end < now;
}

export const daysLate = (sale, now = new Date()) => {
  const d = toDate(sale.dueDate);
  if (!d) return 0;
  return Math.max(0, Math.floor((startOfDay(now) - startOfDay(d)) / 86400000));
};

export function toDate(x) {
  if (!x) return null;
  if (typeof x.toDate === "function") return x.toDate();
  if (x instanceof Date) return x;
  const d = new Date(x);
  return isNaN(d) ? null : d;
}

export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export const startOfYear = (d) => new Date(d.getFullYear(), 0, 1);

/** Début de période pour les filtres : today | 7d | month | year | all */
export function periodStart(period, now = new Date()) {
  switch (period) {
    case "today": return startOfDay(now);
    case "7d": { const d = startOfDay(now); d.setDate(d.getDate() - 6); return d; }
    case "30d": { const d = startOfDay(now); d.setDate(d.getDate() - 29); return d; }
    case "month": return startOfMonth(now);
    case "year": return startOfYear(now);
    default: return null;
  }
}

export const inPeriod = (date, period, now = new Date()) => {
  const start = periodStart(period, now);
  if (!start) return true;
  const d = toDate(date);
  return !!d && d >= start;
};

/** Bénéfice d'une vente = total − (coût de revient unitaire × quantité). cost peut être null (inconnu). */
export function saleProfit(sale, unitCost) {
  if (unitCost == null) return null;
  return round2(num(sale.total) - num(unitCost) * num(sale.qty));
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export const sum = (arr, fn = (x) => x) => round2(arr.reduce((s, x) => s + num(fn(x)), 0));

/** Valeurs de stock (admin) : au coût de revient et au prix de vente. */
export function stockValues(products, costs) {
  let atCost = 0, atSell = 0, units = 0;
  for (const p of products) {
    if (p.archived) continue;
    const q = num(p.qty);
    units += q;
    atSell += q * num(p.sellPrice);
    atCost += q * num(costs[p.id]?.unitCost);
  }
  return { atCost: round2(atCost), atSell: round2(atSell), units };
}
