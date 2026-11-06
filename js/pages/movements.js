import { state } from "../store.js";
import { esc, fm, fnum, fmtDateTime, icon, chip, empty, downloadCSV } from "../ui.js";
import { actions, getF, periodSelect } from "../core.js";
import { inPeriod, sum, toDate, num } from "../logic.js";
import { cashLedger } from "../calc.js";

const REASONS = {
  order: "Réception de commande", sale: "Vente", initial: "Stock initial", adjustment: "Ajustement", cancel_sale: "Annulation de vente",
};

function stockTab(period) {
  const type = getF("mov.type", "all");
  const list = state.movements.filter((m) => inPeriod(m.date, period) && (type === "all" || m.type === type));
  const ins = sum(list.filter((m) => m.type === "in"), (m) => m.qty);
  const outs = sum(list.filter((m) => m.type === "out"), (m) => m.qty);
  return `
    <div class="toolbar">
      ${periodSelect("mov.period", "month")}
      <select class="select" data-filter="mov.type">
        ${[["all", "Entrées et sorties"], ["in", "Entrées seulement"], ["out", "Sorties seulement"]].map(([v, l]) => `<option value="${v}" ${v === type ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn ghost" data-action="export-movements">${icon("download")} Exporter CSV</button>
    </div>
    <div class="summary-bar">
      <div><span class="muted">Entrées</span><strong class="pos">+${fnum(ins)} u.</strong></div>
      <div><span class="muted">Sorties</span><strong class="neg">−${fnum(outs)} u.</strong></div>
      <div><span class="muted">Solde</span><strong>${fnum(ins - outs)} u.</strong></div>
    </div>
    <section class="card flush">${list.length ? `<table class="table responsive"><thead><tr><th>Date</th><th>Produit</th><th>Mouvement</th><th class="num">Quantité</th><th>Motif</th><th>Par</th></tr></thead><tbody>
      ${list.slice(0, 300).map((m) => `<tr>
        <td data-label="Date">${fmtDateTime(m.date)}</td>
        <td data-label="Produit"><strong>${esc(m.brand || "")} ${esc(m.productName)}</strong></td>
        <td data-label="Mouvement">${m.type === "in" ? chip("Entrée", "green") : chip("Sortie", "red")}</td>
        <td data-label="Quantité" class="num ${m.type === "in" ? "pos" : "neg"}">${m.type === "in" ? "+" : "−"}${m.qty}</td>
        <td data-label="Motif">${esc(REASONS[m.reason] || m.reason)}${m.note ? `<div class="muted small">${esc(m.note)}</div>` : ""}</td>
        <td data-label="Par">${esc(m.byName || "—")}</td></tr>`).join("")}</tbody></table>
      ${list.length > 300 ? `<p class="muted center pad">300 derniers mouvements affichés — utilisez l'export CSV pour tout obtenir.</p>` : ""}`
      : empty("Aucun mouvement sur cette période.", "swap")}</section>`;
}

function cashTab(period) {
  const kind = getF("mov.kind", "all");
  const rows = cashLedger().filter((r) => inPeriod(r.date, period) && (kind === "all" || r.kind === kind));
  const tin = sum(rows, (r) => r.in), tout = sum(rows, (r) => r.out);
  return `
    <div class="toolbar">
      ${periodSelect("mov.period", "month")}
      <select class="select" data-filter="mov.kind">
        ${[["all", "Tout"], ["vente", "Encaissements de ventes"], ["commande", "Achats & frais de commande"], ["depense", "Dépenses boutique"]].map(([v, l]) => `<option value="${v}" ${v === kind ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn ghost" data-action="export-cash">${icon("download")} Exporter CSV</button>
    </div>
    <div class="summary-bar">
      <div><span class="muted">Entrées d'argent</span><strong class="pos">${fm(tin)}</strong></div>
      <div><span class="muted">Sorties d'argent</span><strong class="neg">${fm(tout)}</strong></div>
      <div><span class="muted">Solde de la période</span><strong class="${tin - tout < 0 ? "neg" : "pos"}">${fm(tin - tout)}</strong></div>
    </div>
    <section class="card flush">${rows.length ? `<table class="table responsive"><thead><tr><th>Date</th><th>Libellé</th><th class="num">Entrée</th><th class="num">Sortie</th></tr></thead><tbody>
      ${rows.slice(0, 300).map((r) => `<tr><td data-label="Date">${fmtDateTime(r.date)}</td><td data-label="Libellé">${esc(r.label)}</td>
        <td data-label="Entrée" class="num pos">${r.in ? "+" + fm(r.in) : ""}</td><td data-label="Sortie" class="num neg">${r.out ? "−" + fm(r.out) : ""}</td></tr>`).join("")}</tbody></table>`
      : empty("Aucun mouvement d'argent sur cette période.", "wallet")}</section>
    <p class="muted small">Le journal est calculé à partir des ventes (paiements reçus), des commandes (achats, dépenses, frais de kilo) et des dépenses de la boutique.</p>`;
}

function render() {
  const tab = getF("mov.tab", "stock");
  const period = getF("mov.period", "month");
  return `
    <div class="page-head"><div><h2>Entrées & sorties</h2><p class="muted">Suivi des mouvements de stock et d'argent</p></div></div>
    <div class="tabs"><button class="tab ${tab === "stock" ? "on" : ""}" data-action="set-filter" data-key="mov.tab" data-value="stock">Mouvements de stock</button>
      <button class="tab ${tab === "cash" ? "on" : ""}" data-action="set-filter" data-key="mov.tab" data-value="cash">Mouvements d'argent</button></div>
    ${tab === "stock" ? stockTab(period) : cashTab(period)}`;
}

actions["export-movements"] = () => {
  const period = getF("mov.period", "month"), type = getF("mov.type", "all");
  const list = state.movements.filter((m) => inPeriod(m.date, period) && (type === "all" || m.type === type));
  downloadCSV("mouvements-stock.csv", [["Date", "Produit", "Mouvement", "Quantité", "Motif", "Note", "Par"],
    ...list.map((m) => [fmtDateTime(m.date), `${m.brand || ""} ${m.productName}`, m.type === "in" ? "Entrée" : "Sortie", m.qty, REASONS[m.reason] || m.reason, m.note || "", m.byName || ""])]);
};
actions["export-cash"] = () => {
  const period = getF("mov.period", "month"), kind = getF("mov.kind", "all");
  const rows = cashLedger().filter((r) => inPeriod(r.date, period) && (kind === "all" || r.kind === kind));
  downloadCSV("mouvements-argent.csv", [["Date", "Libellé", "Entrée", "Sortie"], ...rows.map((r) => [fmtDateTime(r.date), r.label, r.in || "", r.out || ""])]);
};

export default { id: "movements", title: "Entrées & sorties", label: "Entrées & sorties", icon: "swap", roles: ["admin"], render };
