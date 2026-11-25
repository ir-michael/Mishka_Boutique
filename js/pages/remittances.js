import { db, collection, doc, addDoc, updateDoc, serverTimestamp, Timestamp } from "../fb.js";
import { state, isAdmin } from "../store.js";
import { esc, fm, fmtDateTime, icon, chip, empty, openModal, closeModal, toast, busy, friendlyError, confirmBox } from "../ui.js";
import { actions, submits, getF, periodSelect } from "../core.js";
import { num, round2, inPeriod, toDate } from "../logic.js";

function paidSalesNotInRemittance() {
  const allocated = new Map();
  for (const remittance of state.remittances) {
    if (remittance.status === "rejected") continue;
    for (const id of remittance.saleIds || []) {
      allocated.set(id, true);
    }
  }
  return state.sales
    .filter((sale) => sale.status !== "cancelled" && sale.createdBy === state.me.uid && num(sale.paid) > 0)
    .filter((sale) => !allocated.has(sale.id))
    .map((sale) => ({
      ...sale,
      remittanceAmount: round2(num(sale.paid)),
    }));
}

function statusFor(remittance) {
  if (remittance.status === "confirmed" || (remittance.employeeConfirmedAt && remittance.adminConfirmedAt)) return chip("Confirmée", "green");
  if (remittance.status === "rejected") return chip("Refusée", "red");
  return chip("En attente de confirmation", "amber");
}

function render() {
  const period = getF("remittances.period", "month");
  const list = state.remittances.filter((item) => inPeriod(item.createdAt, period));
  const employee = state.me.role === "employee";
  return `
    <div class="page-head"><div><h2>Remises d'argent</h2><p class="muted">Ventes remises au propriétaire</p></div>
      ${employee ? `<button class="btn primary" data-action="new-remittance">${icon("plus")} Nouvelle remise</button>` : ""}</div>
    <div class="toolbar">${periodSelect("remittances.period", "month")}</div>
    <section class="card flush">${list.length ? `<table class="table responsive"><thead><tr><th>Date</th><th>Employé</th><th class="num">Montant</th><th>Ventes</th><th>Employé</th><th>Administrateur</th><th>Statut</th><th></th></tr></thead><tbody>
      ${list.map((item) => `<tr>
        <td data-label="Date">${fmtDateTime(item.createdAt)}</td>
        <td data-label="Employé"><strong>${esc(item.employeeName)}</strong></td>
        <td data-label="Montant" class="num"><strong>${fm(item.amount)}</strong></td>
        <td data-label="Ventes">${(item.saleIds || []).length} vente(s)</td>
        <td data-label="Employé">${item.employeeConfirmedAt ? chip("Confirmée", "green") : chip("Non", "amber")}</td>
        <td data-label="Administrateur">${item.adminConfirmedAt ? chip("Confirmée", "green") : chip("En attente", "amber")}</td>
        <td data-label="Statut">${statusFor(item)}</td>
        <td class="actions">${isAdmin() && item.status !== "confirmed" && item.status !== "rejected" ? `<button class="btn sm primary" data-action="confirm-remittance" data-id="${esc(item.id)}">Confirmer</button>
          <button class="btn sm ghost" data-action="reject-remittance" data-id="${esc(item.id)}">Refuser</button>` : ""}</td>
      </tr>`).join("")}</tbody></table>` : empty("Aucune remise sur cette période.", "wallet")}</section>`;
}

actions["new-remittance"] = () => {
  const sales = paidSalesNotInRemittance();
  if (!sales.length) return toast("Aucune vente encaissée reste à remettre.", "error");
  openModal("Nouvelle remise d'argent", `
    <form data-submit="saveRemittance" class="form">
      <p class="muted">Sélectionnez les ventes dont l'argent est remis. Le montant total sera calculé depuis les paiements encaissés de chaque vente.</p>
      <div class="remittance-sales">${sales.map((sale) => `
        <label class="remittance-row"><input type="checkbox" name="saleId" value="${esc(sale.id)}" data-amount="${sale.remittanceAmount}">
          <span><strong>${esc(sale.brand || "")} ${esc(sale.productName)}</strong> × ${sale.qty}<br><span class="muted small">Acheteur : ${esc(sale.buyerName || "Anonyme")} · ${fm(sale.unitPrice)} l'unité · ${fm(sale.remittanceAmount)} encaissé</span></span></label>`).join("")}</div>
      <div class="summary-bar"><div><span class="muted">Montant de la remise</span><strong id="remittance-total" class="pos">${fm(0)}</strong></div></div>
      <label class="field"><span>Note <em>(facultatif)</em></span><input class="input" name="note"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">Confirmer ma remise</button></div>
    </form>`);
};

function recalculateRemittance(form) {
  const total = [...form.querySelectorAll('input[name="saleId"]:checked')]
    .reduce((sum, input) => sum + num(input.dataset.amount), 0);
  const el = document.getElementById("remittance-total");
  if (el) el.textContent = fm(round2(total));
}

if (typeof document !== "undefined") {
  document.addEventListener("change", (event) => {
    if (event.target.matches('input[name="saleId"]')) recalculateRemittance(event.target.closest("form"));
  });
}

submits.saveRemittance = async (form) => {
  const d = formData(form);
  const selected = [...form.querySelectorAll('input[name="saleId"]:checked')];
  if (!selected.length) return toast("Sélectionnez au moins une vente.", "error");
  const saleIds = selected.map((input) => input.value);
  const amount = round2(selected.reduce((sum, input) => sum + num(input.dataset.amount), 0));
  const staleIds = saleIds.filter((id) => !paidSalesNotInRemittance().some((sale) => sale.id === id));
  if (staleIds.length) return toast("Une ou plusieurs ventes ont déjà été mises dans une autre remise.", "error");
  if (!(amount > 0)) return toast("Le montant sélectionné doit être supérieur à zéro.", "error");
  const me = state.me;
  try {
    await busy(form.querySelector("[type=submit]"), () => addDoc(collection(db, "remittances"), {
      employeeUid: me.uid, employeeName: me.name, saleIds, amount, note: d.note || "",
      status: "pending", employeeConfirmedAt: serverTimestamp(), employeeConfirmedBy: me.uid,
      adminConfirmedAt: null, adminConfirmedBy: null, rejectedAt: null, rejectedBy: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    await addDoc(collection(db, "notifications"), {
      recipientRole: "admin", recipientUid: "all-admins", title: "Nouvelle remise d'argent",
      message: `${me.name} propose une remise de ${fm(amount)} pour ${saleIds.length} vente(s).`,
      readBy: [], createdAt: serverTimestamp(), kind: "remittance",
    });
    closeModal();
    toast("Remise envoyée à l'administrateur.", "success", 6000);
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

actions["confirm-remittance"] = async (el) => {
  const item = state.remittances.find((row) => row.id === el.dataset.id);
  if (!item || item.status === "confirmed" || item.status === "rejected") return;
  if (!(await confirmBox(`Confirmer la remise de ${fm(item.amount)} ?`, { okLabel: "Confirmer la remise" }))) return;
  try {
    await updateDoc(doc(db, "remittances", item.id), {
      status: "confirmed", adminConfirmedAt: serverTimestamp(), adminConfirmedBy: state.me.uid,
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, "notifications"), {
      recipientUid: item.employeeUid, title: "Remise confirmée",
      message: `Votre remise de ${fm(item.amount)} a été confirmée par l'administrateur.`,
      readBy: [], createdAt: serverTimestamp(), kind: "remittance-confirmed",
    });
    toast("Remise confirmée par les deux parties.", "success");
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

actions["reject-remittance"] = async (el) => {
  const item = state.remittances.find((row) => row.id === el.dataset.id);
  if (!item || item.status === "confirmed" || item.status === "rejected") return;
  if (!(await confirmBox(`Refuser la remise de ${fm(item.amount)} ? L'employé pourra corriger sa remise.`, { okLabel: "Refuser", danger: true }))) return;
  try {
    await updateDoc(doc(db, "remittances", item.id), {
      status: "rejected", rejectedAt: serverTimestamp(), rejectedBy: state.me.uid,
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, "notifications"), {
      recipientUid: item.employeeUid, title: "Remise refusée",
      message: `Votre remise de ${fm(item.amount)} a été refusée. Elle pourra être corrigée.`,
      readBy: [], createdAt: serverTimestamp(), kind: "remittance-rejected",
    });
    toast("Remise refusée.", "success");
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

export default { id: "remittances", title: "Remises d'argent", label: "Remises", labelEmployee: "Mes remises", icon: "wallet", roles: ["admin", "employee"], render };