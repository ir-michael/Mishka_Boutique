import { db, collection, doc, addDoc, deleteDoc, serverTimestamp, Timestamp } from "../fb.js";
import { state, isAdmin } from "../store.js";
import {
  esc, fm, fmtDate, toInputDate, fromInputDate, icon, chip, empty, openModal, closeModal, confirmBox, toast,
  formData, busy, friendlyError, downloadCSV,
} from "../ui.js";
import { actions, submits, getF, periodSelect } from "../core.js";
import { num, round2, inPeriod, sum, toDate } from "../logic.js";
import { EXPENSE_CATEGORIES } from "../config.js";

const TYPE_LABEL = { transfert: "Frais de transfert", motivation: "Motivation", autre: "Autre dépense" };

function shopTab(period) {
  const admin = isAdmin();
  const cat = getF("exp.cat", "all");
  const list = state.expenses.filter((e) => inPeriod(e.date, period) && (cat === "all" || e.category === cat));
  const byCat = {};
  list.forEach((e) => { byCat[e.category] = round2((byCat[e.category] || 0) + num(e.amount)); });
  return `
    <div class="toolbar">${periodSelect("exp.period", "month")}
      <select class="select" data-filter="exp.cat"><option value="all">Toutes catégories</option>
        ${EXPENSE_CATEGORIES.map((c) => `<option ${c === cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      ${admin ? `<button class="btn ghost" data-action="export-expenses">${icon("download")} CSV</button>` : ""}</div>
    <div class="summary-bar"><div><span class="muted">Total des dépenses</span><strong class="neg">${fm(sum(list, (e) => e.amount))}</strong></div>
      ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => `<div><span class="muted">${esc(c)}</span><strong>${fm(v)}</strong></div>`).join("")}</div>
    <section class="card flush">${list.length ? `<table class="table responsive"><thead><tr><th>Date</th><th>Catégorie</th><th>Note</th><th>Saisi par</th><th class="num">Montant</th>${admin ? "<th></th>" : ""}</tr></thead><tbody>
      ${list.map((e) => `<tr><td data-label="Date">${fmtDate(e.date)}</td><td data-label="Catégorie">${chip(e.category, "blue")}</td>
        <td data-label="Note">${esc(e.note || "—")}</td><td data-label="Saisi par">${esc(e.createdByName || "—")}</td>
        <td data-label="Montant" class="num"><strong>${fm(e.amount)}</strong></td>
        ${admin ? `<td class="actions"><button class="icon-btn" title="Supprimer" data-action="delete-expense" data-id="${e.id}">${icon("trash")}</button></td>` : ""}</tr>`).join("")}</tbody></table>`
      : empty("Aucune dépense sur cette période.", "receipt")}</section>`;
}

function orderTab(period) {
  const rows = [];
  for (const o of state.orders) {
    if (o.status === "cancelled") continue;
    const d = o.orderDate || o.createdAt;
    if (!inPeriod(d, period)) continue;
    (o.expenses || []).forEach((e) => rows.push({ date: d, ref: o.ref, label: (TYPE_LABEL[e.type] || "Dépense") + (e.label ? " — " + e.label : ""), amount: e.amount }));
    if (o.freight?.total > 0) rows.push({ date: o.receivedAt || d, ref: o.ref, label: "Frais de kilo (transport)", amount: o.freight.total });
  }
  rows.sort((a, b) => (toDate(b.date) || 0) - (toDate(a.date) || 0));
  return `
    <div class="toolbar">${periodSelect("exp.period", "month")}</div>
    <div class="summary-bar"><div><span class="muted">Total frais de commandes</span><strong class="neg">${fm(sum(rows, (r) => r.amount))}</strong></div>
      <div><span class="muted">dont transport</span><strong>${fm(sum(rows.filter((r) => r.label.startsWith("Frais de kilo")), (r) => r.amount))}</strong></div></div>
    <section class="card flush">${rows.length ? `<table class="table responsive"><thead><tr><th>Date</th><th>Commande</th><th>Nature</th><th class="num">Montant</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td data-label="Date">${fmtDate(r.date)}</td><td data-label="Commande">${esc(r.ref)}</td><td data-label="Nature">${esc(r.label)}</td><td data-label="Montant" class="num"><strong>${fm(r.amount)}</strong></td></tr>`).join("")}</tbody></table>`
      : empty("Aucun frais de commande sur cette période.", "truck")}</section>
    <p class="muted small">Ces frais sont déjà intégrés au coût de revient des produits (ils ne sont donc pas déduits une seconde fois du bénéfice).</p>`;
}

function render() {
  const admin = isAdmin();
  const tab = admin ? getF("exp.tab", "shop") : "shop";
  const period = getF("exp.period", "month");
  return `
    <div class="page-head"><div><h2>Dépenses</h2><p class="muted">${admin ? "Frais de fonctionnement et frais de commandes" : "Vos dépenses saisies pour la boutique"}</p></div>
      <button class="btn primary" data-action="add-expense">${icon("plus")} Nouvelle dépense</button></div>
    ${admin ? `<div class="tabs"><button class="tab ${tab === "shop" ? "on" : ""}" data-action="set-filter" data-key="exp.tab" data-value="shop">Dépenses de la boutique</button>
      <button class="tab ${tab === "orders" ? "on" : ""}" data-action="set-filter" data-key="exp.tab" data-value="orders">Frais de commandes</button></div>` : ""}
    ${tab === "shop" ? shopTab(period) : orderTab(period)}`;
}

actions["add-expense"] = () => openModal("Nouvelle dépense", `
  <form data-submit="saveExpense" class="form">
    <div class="grid-2">
      <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${toInputDate()}" max="${toInputDate()}" required></label>
      <label class="field"><span>Catégorie</span><select class="select" name="category">${EXPENSE_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>Montant</span><input class="input" type="number" name="amount" min="0.01" step="0.01" inputmode="decimal" required></label>
    <label class="field"><span>Note <em>(facultatif)</em></span><input class="input" name="note" placeholder="Ex. Recharge internet, course moto…"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
      <button class="btn primary" type="submit">${icon("check")} Enregistrer</button></div>
  </form>`);

submits.saveExpense = async (form) => {
  const d = formData(form);
  const amount = round2(num(d.amount));
  if (!(amount > 0)) return toast("Montant invalide.", "error");
  try {
    await busy(form.querySelector("[type=submit]"), () => addDoc(collection(db, "expenses"), {
      date: Timestamp.fromDate(fromInputDate(d.date)), category: d.category, amount, note: d.note || "",
      createdBy: state.me.uid, createdByName: state.me.name, createdAt: serverTimestamp(),
    }));
    toast("Dépense enregistrée ✓", "success");
    closeModal();
  } catch (e) { toast(friendlyError(e), "error"); }
};

actions["delete-expense"] = async (el) => {
  if (!(await confirmBox("Supprimer cette dépense ?", { okLabel: "Supprimer", danger: true }))) return;
  try { await deleteDoc(doc(db, "expenses", el.dataset.id)); toast("Dépense supprimée.", "success"); } catch (e) { toast(friendlyError(e), "error"); }
};

actions["export-expenses"] = () => {
  const period = getF("exp.period", "month"), cat = getF("exp.cat", "all");
  const list = state.expenses.filter((e) => inPeriod(e.date, period) && (cat === "all" || e.category === cat));
  downloadCSV("depenses.csv", [["Date", "Catégorie", "Note", "Saisi par", "Montant"], ...list.map((e) => [fmtDate(e.date), e.category, e.note || "", e.createdByName || "", e.amount])]);
};

export default { id: "expenses", title: "Dépenses", label: "Dépenses", icon: "receipt", roles: ["admin", "employee"], render };
