import { db, collection, doc, addDoc, deleteDoc, serverTimestamp, Timestamp } from "../fb.js";
import { state } from "../store.js";
import {
  esc, fm, fmtDate, toInputDate, fromInputDate, icon, chip, empty,
  openModal, closeModal, toast, busy, friendlyError, confirmBox,
} from "../ui.js";
import { actions, submits, getF, periodSelect } from "../core.js";
import { num, round2, sum, inPeriod, toDate } from "../logic.js";

const capitalTotal = () => sum(state.capitalEntries || [], (entry) => entry.type === "withdrawal" ? -num(entry.amount) : num(entry.amount));
const personalSpent = (period = "all") => sum((state.personalExpenses || []).filter((entry) => inPeriod(entry.date, period)), (entry) => entry.amount);

function render() {
  const period = getF("finance.period", "month");
  const capital = capitalTotal();
  const paidOut = personalSpent(period);
  return `
    <div class="page-head"><div><h2>Finances personnelles & capital</h2><p class="muted">Suivi privé de l'administrateur</p></div>
      <div class="row gap"><button class="btn" data-action="add-capital">${icon("plus")} Capital</button>
        <button class="btn primary" data-action="add-personal-expense">${icon("minus")} Dépense personnelle</button></div></div>

    <div class="toolbar">${periodSelect("finance.period", "month")}</div>
    <div class="summary-bar">
      <div><span class="muted">Capital cumulé</span><strong class="pos">${fm(capital)}</strong></div>
      <div><span class="muted">Dépenses personnelles (${period === "all" ? "tout" : period})</span><strong class="neg">${fm(paidOut)}</strong></div>
      <div><span class="muted">Capital disponible hors bénéfices</span><strong>${fm(round2(capital - personalSpent("all")))}</strong></div>
    </div>

    <div class="grid-2">
      <section class="card"><div class="card-head"><h3>Entrées et retraits de capital</h3></div>
        ${(state.capitalEntries || []).length ? `<table class="table responsive"><thead><tr><th>Date</th><th>Nature</th><th>Source / motif</th><th class="num">Montant</th><th></th></tr></thead><tbody>
          ${(state.capitalEntries || []).filter((entry) => inPeriod(entry.date, period)).map((entry) => `<tr>
            <td data-label="Date">${fmtDate(entry.date)}</td>
            <td data-label="Nature">${chip(entry.type === "withdrawal" ? "Retrait" : "Entrée", entry.type === "withdrawal" ? "red" : "green")}</td>
            <td data-label="Source / motif">${esc(entry.source || entry.note || "—")}</td>
            <td data-label="Montant" class="num ${entry.type === "withdrawal" ? "neg" : "pos"}">${entry.type === "withdrawal" ? "−" : "+"}${fm(entry.amount)}</td>
            <td class="actions"><button class="icon-btn" title="Supprimer" data-action="delete-capital" data-id="${esc(entry.id)}">${icon("trash")}</button></td>
          </tr>`).join("")}</tbody></table>` : empty("Aucune entrée de capital sur cette période.", "wallet")}</section>

      <section class="card"><div class="card-head"><h3>Dépenses personnelles</h3></div>
        ${(state.personalExpenses || []).length ? `<table class="table responsive"><thead><tr><th>Date</th><th>Nature</th><th>Note</th><th class="num">Montant</th><th></th></tr></thead><tbody>
          ${(state.personalExpenses || []).filter((entry) => inPeriod(entry.date, period)).map((entry) => `<tr>
            <td data-label="Date">${fmtDate(entry.date)}</td>
            <td data-label="Nature">${chip(entry.category, "blue")}</td>
            <td data-label="Note">${esc(entry.note || "—")}</td>
            <td data-label="Montant" class="num neg">−${fm(entry.amount)}</td>
            <td class="actions"><button class="icon-btn" title="Supprimer" data-action="delete-personal-expense" data-id="${esc(entry.id)}">${icon("trash")}</button></td>
          </tr>`).join("")}</tbody></table>` : empty("Aucune dépense personnelle sur cette période.", "receipt")}</section>
    </div>
    <p class="muted small">Ces dépenses ne sont jamais incluses dans le bénéfice net ni dans les dépenses de la boutique.</p>`;
}

actions["add-capital"] = () => openModal("Capital", `
  <form data-submit="saveCapital" class="form">
    <div class="grid-2">
      <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${toInputDate()}" required></label>
      <label class="field"><span>Nature</span><select class="select" name="type"><option value="entry">Entrée / augmentation</option><option value="withdrawal">Retrait / réduction</option></select></label>
    </div>
    <label class="field"><span>Montant</span><input class="input" type="number" name="amount" min="0.01" step="0.01" required></label>
    <label class="field"><span>Source ou motif</span><input class="input" name="source" placeholder="Ex. apport personnel, prêt, retrait du capital…" required></label>
    <label class="field"><span>Note <em>(facultatif)</em></span><input class="input" name="note"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
      <button class="btn primary" type="submit">Enregistrer</button></div>
  </form>`);

submits.saveCapital = async (form) => {
  const d = Object.fromEntries(new FormData(form));
  const amount = round2(num(d.amount));
  if (!(amount > 0)) return toast("Montant invalide.", "error");
  try {
    await busy(form.querySelector("[type=submit]"), () => addDoc(collection(db, "capitalEntries"), {
      date: Timestamp.fromDate(fromInputDate(d.date)), type: d.type, amount, source: d.source.trim(), note: d.note?.trim() || "",
      createdBy: state.me.uid, createdByName: state.me.name, createdAt: serverTimestamp(),
    }));
    closeModal();
    toast("Capital enregistré.", "success");
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

actions["delete-capital"] = async (el) => {
  if (!(await confirmBox("Supprimer cette entrée de capital ?", { okLabel: "Supprimer", danger: true }))) return;
  try { await deleteDoc(doc(db, "capitalEntries", el.dataset.id)); toast("Entrée supprimée.", "success"); }
  catch (error) { toast(friendlyError(error), "error", 5000); }
};

actions["add-personal-expense"] = () => openModal("Dépense personnelle", `
  <form data-submit="savePersonalExpense" class="form">
    <div class="grid-2">
      <label class="field"><span>Date</span><input class="input" type="date" name="date" value="${toInputDate()}" required></label>
      <label class="field"><span>Catégorie</span><select class="select" name="category"><option>Foyer</option><option>Santé</option><option>Famille</option><option>Transport personnel</option><option>Investissement personnel</option><option>Éducation</option><option>Loisirs</option><option>Autre</option></select></label>
    </div>
    <label class="field"><span>Montant</span><input class="input" type="number" name="amount" min="0.01" step="0.01" required></label>
    <label class="field"><span>Note <em>(facultatif)</em></span><input class="input" name="note"></label>
    <p class="notice info">Cette dépense diminue le capital affiché, mais n'entre pas dans les bénéfices de la boutique.</p>
    <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
      <button class="btn primary" type="submit">Enregistrer</button></div>
  </form>`);

submits.savePersonalExpense = async (form) => {
  const d = Object.fromEntries(new FormData(form));
  const amount = round2(num(d.amount));
  if (!(amount > 0)) return toast("Montant invalide.", "error");
  try {
    await busy(form.querySelector("[type=submit]"), () => addDoc(collection(db, "personalExpenses"), {
      date: Timestamp.fromDate(fromInputDate(d.date)), category: d.category, amount, note: d.note?.trim() || "",
      createdBy: state.me.uid, createdByName: state.me.name, createdAt: serverTimestamp(),
    }));
    closeModal();
    toast("Dépense personnelle enregistrée.", "success");
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

actions["delete-personal-expense"] = async (el) => {
  if (!(await confirmBox("Supprimer cette dépense personnelle ?", { okLabel: "Supprimer", danger: true }))) return;
  try { await deleteDoc(doc(db, "personalExpenses", el.dataset.id)); toast("Dépense supprimée.", "success"); }
  catch (error) { toast(friendlyError(error), "error", 5000); }
};

export default { id: "finances", title: "Finances personnelles", label: "Finances personnelles", icon: "chart", roles: ["admin"], render };