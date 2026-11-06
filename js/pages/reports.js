import { state } from "../store.js";
import { esc, fm, fnum, fmtDate, icon, chip, empty, downloadCSV } from "../ui.js";
import { actions, getF, periodSelect, PERIODS } from "../core.js";
import { num, round2, sum, groupBy, orderTotals } from "../logic.js";
import { salesInPeriod, expensesInPeriod } from "../calc.js";
import { CATEGORIES } from "../config.js";

const pct = (a, b) => (b > 0 ? fnum((a / b) * 100) + " %" : "—");
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "Autre";

function productRows(sales) {
  return [...groupBy(sales, (s) => `${s.brand || ""} ${s.productName}`.trim()).entries()].map(([name, arr]) => {
    const known = arr.filter((s) => s.profit != null);
    const rev = sum(arr, (s) => s.total);
    const cogs = sum(known, (s) => s.cogs);
    const stockLeft = sum(state.products.filter((p) => !p.archived && `${p.brand || ""} ${p.name}`.trim() === name), (p) => p.qty);
    return { name, qty: sum(arr, (s) => s.qty), rev, cogs, profit: sum(known, (s) => s.profit), revKnown: sum(known, (s) => s.total), stockLeft };
  }).sort((a, b) => b.profit - a.profit);
}

function orderRows() {
  return state.orders.filter((o) => o.status === "received").map((o) => {
    const t = o.totals || orderTotals(o);
    const lots = state.products.filter((p) => p.orderId === o.id);
    const sold = state.sales.filter((s) => s.orderId === o.id && s.status !== "cancelled");
    const rev = sum(sold, (s) => s.total);
    const cogs = sum(sold, (s) => num(state.costs[s.productId]?.unitCost) * num(s.qty));
    const stockCost = sum(lots, (p) => num(p.qty) * num(state.costs[p.id]?.unitCost));
    const stockSell = sum(lots, (p) => num(p.qty) * num(p.sellPrice));
    return {
      ref: o.ref, date: o.receivedAt || o.orderDate, cost: t.totalCost, bought: sum(o.lines, (l) => l.qty), sold: sum(sold, (s) => s.qty),
      rev, realized: round2(rev - cogs), stockCost, projected: round2(rev + stockSell - t.totalCost),
    };
  }).sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0));
}

function render() {
  const period = getF("rep.period", "month");
  const tab = getF("rep.tab", "products");
  const sales = salesInPeriod(period);
  const known = sales.filter((s) => s.profit != null);
  const rev = sum(sales, (s) => s.total);
  const gross = sum(known, (s) => s.profit);
  const exp = sum(expensesInPeriod(period), (e) => e.amount);
  const net = round2(gross - exp);
  const label = PERIODS.find((p) => p[0] === period)[1].toLowerCase();

  let body = "";
  if (tab === "products") {
    const rows = productRows(sales);
    body = rows.length ? `<table class="table responsive"><thead><tr><th>Produit</th><th class="num">Qté vendue</th><th class="num">CA</th><th class="num">Coût</th><th class="num">Bénéfice</th><th class="num">Marge</th><th class="num">En stock</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td data-label="Produit"><strong>${esc(r.name)}</strong></td><td data-label="Qté vendue" class="num">${fnum(r.qty)}</td><td data-label="CA" class="num">${fm(r.rev)}</td>
        <td data-label="Coût" class="num">${fm(r.cogs)}</td><td data-label="Bénéfice" class="num ${r.profit < 0 ? "neg" : "pos"}"><strong>${fm(r.profit)}</strong></td>
        <td data-label="Marge" class="num">${pct(r.profit, r.revKnown)}</td><td data-label="En stock" class="num">${fnum(r.stockLeft)}</td></tr>`).join("")}</tbody></table>` : empty("Aucune vente sur cette période.", "chart");
  } else if (tab === "orders") {
    const rows = orderRows();
    body = rows.length ? `<table class="table responsive"><thead><tr><th>Commande</th><th>Reçue le</th><th class="num">Coût total</th><th class="num">Vendu</th><th class="num">CA</th><th class="num">Bénéfice réalisé</th><th class="num">Stock restant (coût)</th><th class="num">Bénéfice prévisionnel*</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td data-label="Commande"><strong>${esc(r.ref)}</strong></td><td data-label="Reçue le">${fmtDate(r.date)}</td><td data-label="Coût total" class="num">${fm(r.cost)}</td>
        <td data-label="Vendu" class="num">${fnum(r.sold)} / ${fnum(r.bought)}</td><td data-label="CA" class="num">${fm(r.rev)}</td>
        <td data-label="Bénéfice réalisé" class="num ${r.realized < 0 ? "neg" : "pos"}">${fm(r.realized)}</td><td data-label="Stock restant" class="num">${fm(r.stockCost)}</td>
        <td data-label="Prévisionnel" class="num ${r.projected < 0 ? "neg" : "pos"}"><strong>${fm(r.projected)}</strong></td></tr>`).join("")}</tbody></table>
      <p class="muted small pad">* Bénéfice prévisionnel = chiffre d'affaires déjà fait + valeur de vente du stock restant − coût total de la commande. Les commandes sont cumulées depuis le début (non filtrées par période).</p>` : empty("Aucune commande reçue pour le moment.", "truck");
  } else {
    const rows = [...groupBy(sales, (s) => s.category || "autre").entries()].map(([c, arr]) => {
      const k = arr.filter((s) => s.profit != null);
      return { c, qty: sum(arr, (s) => s.qty), rev: sum(arr, (s) => s.total), profit: sum(k, (s) => s.profit), revKnown: sum(k, (s) => s.total) };
    }).sort((a, b) => b.profit - a.profit);
    body = rows.length ? `<table class="table responsive"><thead><tr><th>Catégorie</th><th class="num">Qté vendue</th><th class="num">CA</th><th class="num">Bénéfice</th><th class="num">Marge</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td data-label="Catégorie"><strong>${esc(catLabel(r.c))}</strong></td><td data-label="Qté" class="num">${fnum(r.qty)}</td><td data-label="CA" class="num">${fm(r.rev)}</td>
        <td data-label="Bénéfice" class="num ${r.profit < 0 ? "neg" : "pos"}"><strong>${fm(r.profit)}</strong></td><td data-label="Marge" class="num">${pct(r.profit, r.revKnown)}</td></tr>`).join("")}</tbody></table>` : empty("Aucune vente sur cette période.", "chart");
  }

  return `
    <div class="page-head"><div><h2>Bénéfices & rapports</h2><p class="muted">Calculés à partir du coût de revient réel (achat + dépenses + transport)</p></div>
      <div class="row gap">${periodSelect("rep.period", "month")}<button class="btn ghost" data-action="export-report">${icon("download")} CSV</button></div></div>

    <div class="summary-bar">
      <div><span class="muted">Chiffre d'affaires (${label})</span><strong>${fm(rev)}</strong></div>
      <div><span class="muted">Bénéfice brut</span><strong class="${gross < 0 ? "neg" : "pos"}">${fm(gross)}</strong></div>
      <div><span class="muted">Marge brute</span><strong>${pct(gross, sum(known, (s) => s.total))}</strong></div>
      <div><span class="muted">Dépenses boutique</span><strong>${fm(exp)}</strong></div>
      <div><span class="muted">Bénéfice net</span><strong class="${net < 0 ? "neg" : "pos"}">${fm(net)}</strong></div>
    </div>
    ${sales.length - known.length ? `<div class="alert warn">${icon("alert")}<span>${sales.length - known.length} vente(s) n'ont pas de coût de revient connu : elles sont exclues du bénéfice.</span></div>` : ""}

    <div class="tabs">
      ${[["products", "Par produit"], ["orders", "Par commande"], ["categories", "Par catégorie"]].map(([v, l]) =>
        `<button class="tab ${tab === v ? "on" : ""}" data-action="set-filter" data-key="rep.tab" data-value="${v}">${l}</button>`).join("")}
    </div>
    <section class="card flush">${body}</section>`;
}

actions["export-report"] = () => {
  const period = getF("rep.period", "month"), tab = getF("rep.tab", "products");
  const sales = salesInPeriod(period);
  if (tab === "products") {
    downloadCSV("benefices-par-produit.csv", [["Produit", "Qté vendue", "CA", "Coût", "Bénéfice", "En stock"],
      ...productRows(sales).map((r) => [r.name, r.qty, r.rev, r.cogs, r.profit, r.stockLeft])]);
  } else if (tab === "orders") {
    downloadCSV("benefices-par-commande.csv", [["Commande", "Coût total", "Unités achetées", "Unités vendues", "CA", "Bénéfice réalisé", "Stock restant (coût)", "Bénéfice prévisionnel"],
      ...orderRows().map((r) => [r.ref, r.cost, r.bought, r.sold, r.rev, r.realized, r.stockCost, r.projected])]);
  } else {
    downloadCSV("ventes-detail.csv", [["Date", "Produit", "Catégorie", "Qté", "Prix unit.", "Total", "Coût", "Bénéfice", "Acheteur", "Statut"],
      ...sales.map((s) => [fmtDate(s.date), `${s.brand || ""} ${s.productName}`, catLabel(s.category), s.qty, s.unitPrice, s.total, s.cogs ?? "", s.profit ?? "", s.buyerName || "Anonyme", s.status])]);
  }
};

export default { id: "reports", title: "Bénéfices & rapports", label: "Rapports", icon: "chart", roles: ["admin"], render };
