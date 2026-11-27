import { db, collection, doc, addDoc, updateDoc, serverTimestamp, Timestamp } from "../fb.js";
import { state, isAdmin } from "../store.js";
import { esc, fm, fmtDate, fmtDateTime, icon, chip, empty, openModal, closeModal, toast, busy, formData, friendlyError, confirmBox } from "../ui.js";
import { actions, submits, getF, periodSelect } from "../core.js";
import { num, round2, inPeriod, toDate, reviewRemittanceItems } from "../logic.js";

function remittedBySale() {
  const allocated = new Map();
  for (const remittance of state.remittances) {
    if (remittance.status === "rejected") continue;
    for (const item of remittance.saleItems || []) {
      if (item.status === "rejected") continue;
      allocated.set(item.saleId, round2(num(allocated.get(item.saleId)) + num(item.amount)));
    }
    if (!remittance.saleItems?.length) {
      for (const saleId of remittance.saleIds || []) {
        const sale = state.sales.find((row) => row.id === saleId);
        if (sale) allocated.set(saleId, round2(num(allocated.get(saleId)) + num(sale.paid)));
      }
    }
  }
  return allocated;
}

function paidSalesNotInRemittance() {
  const allocated = remittedBySale();
  return state.sales
    .filter((sale) => sale.status !== "cancelled" && sale.createdBy === state.me.uid && num(sale.paid) > 0)
    .map((sale) => {
      const alreadyRemitted = round2(num(allocated.get(sale.id)));
      return { ...sale, alreadyRemitted, remittanceAmount: round2(num(sale.paid) - alreadyRemitted) };
    })
    .filter((sale) => sale.remittanceAmount > 0);
}

function saleItemStatusLabel(status) {
  if (status === "confirmed") return chip("Validée", "green");
  if (status === "rejected") return chip("Refusée", "red");
  return chip("En attente", "amber");
}

function remittanceItems(remittance) {
  return remittance.saleItems?.length ? remittance.saleItems : (remittance.saleIds || []).map((saleId) => {
    const sale = state.sales.find((row) => row.id === saleId);
    return { saleId, amount: num(sale?.paid), status: "pending" };
  });
}

function remittanceDecisionCounts(remittance) {
  const items = remittanceItems(remittance);
  return {
    confirmed: items.filter((item) => item.status === "confirmed").length,
    rejected: items.filter((item) => item.status === "rejected").length,
    pending: items.filter((item) => !item.status || item.status === "pending").length,
  };
}

function canReviewRemittance(remittance) {
  return isAdmin() && remittanceDecisionCounts(remittance).pending > 0;
}

function statusFor(remittance) {
  if (remittance.status === "confirmed" || (!remittance.status && remittance.employeeConfirmedAt && remittance.adminConfirmedAt)) return chip("Confirmée", "green");
  if (remittance.status === "partially_confirmed") return chip("Traitée partiellement", "amber");
  if (remittance.status === "partial") return chip("Partiellement vérifiée", "amber");
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
    <section class="card flush">${list.length ? `<table class="table responsive remittance-table"><thead><tr><th>Date</th><th>Employé</th><th class="num">Montant proposé</th><th>Décisions sur les ventes</th><th>Employé</th><th>Administrateur</th><th>Statut</th><th></th></tr></thead><tbody>
      ${list.map((item) => `<tr>
        <td data-label="Date">${fmtDateTime(item.createdAt)}</td>
        <td data-label="Employé"><strong>${esc(item.employeeName)}</strong></td>
        <td data-label="Montant" class="num"><strong>${fm(item.amount)}</strong></td>
        <td data-label="Décisions">${(() => { const counts = remittanceDecisionCounts(item); return `<span class="remittance-counts"><span class="pos">${counts.confirmed} validée(s)</span><span class="neg">${counts.rejected} refusée(s)</span><span class="muted">${counts.pending} en attente</span></span>`; })()}</td>
        <td data-label="Employé">${item.employeeConfirmedAt ? chip("Confirmée", "green") : chip("Non", "amber")}</td>
        <td data-label="Administrateur">${item.adminConfirmedAt ? chip("Confirmée", "green") : chip("En attente", "amber")}</td>
        <td data-label="Statut">${statusFor(item)}</td>
        <td class="actions">${canReviewRemittance(item) ? `<button class="btn sm primary" data-action="review-remittance" data-id="${esc(item.id)}">Vérifier les ventes</button>` : ""}</td>
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
          <span><strong>${esc(sale.brand || "")} ${esc(sale.productName)}</strong> × ${sale.qty}</span>
          <span class="muted small">${fmtDate(sale.date)} · Vendu par ${esc(sale.createdByName || "—")} · Acheteur : ${esc(sale.buyerName || "Anonyme")} · Prix : ${fm(sale.unitPrice)} / article · Reste à remettre : <strong class="pos">${fm(sale.remittanceAmount)}</strong></span></label>`).join("")}</div>
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
  const saleItems = selected.map((input) => ({ saleId: input.value, amount: round2(num(input.dataset.amount)) }));
  const amount = round2(saleItems.reduce((sum, item) => sum + item.amount, 0));
  const staleIds = saleIds.filter((id) => !paidSalesNotInRemittance().some((sale) => sale.id === id));
  if (staleIds.length) return toast("Une ou plusieurs ventes ont déjà été mises dans une autre remise.", "error");
  if (!(amount > 0)) return toast("Le montant sélectionné doit être supérieur à zéro.", "error");
  const me = state.me;
  try {
    await busy(form.querySelector("[type=submit]"), () => addDoc(collection(db, "remittances"), {
      employeeUid: me.uid, employeeName: me.name, saleIds, saleItems, amount, note: d.note || "",
      status: "pending", employeeConfirmedAt: serverTimestamp(), employeeConfirmedBy: me.uid,
      adminConfirmedAt: null, adminConfirmedBy: null, rejectedAt: null, rejectedBy: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    try {
      await addDoc(collection(db, "notifications"), {
      recipientRole: "admin", recipientUid: "all-admins", title: "Nouvelle remise d'argent",
      message: `${me.name} propose une remise de ${fm(amount)} pour ${saleIds.length} vente(s).`,
        readBy: [], createdAt: serverTimestamp(), kind: "remittance",
      });
    } catch (notificationError) {
      console.warn("Remise créée, notification impossible", notificationError);
    }
    closeModal();
    toast("Remise envoyée à l'administrateur.", "success", 6000);
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

actions["review-remittance"] = (el) => {
  const item = state.remittances.find((row) => row.id === el.dataset.id);
  if (!item || !canReviewRemittance(item)) return;
  const items = remittanceItems(item);
  const rows = items.map((saleItem) => {
    const sale = state.sales.find((row) => row.id === saleItem.saleId);
    const status = saleItem.status || "pending";
    const decisionControl = status === "confirmed" || status === "rejected"
      ? saleItemStatusLabel(status)
      : `<select class="select" name="decision_${esc(saleItem.saleId)}"><option value="pending" selected>En attente</option><option value="confirmed">Valider</option><option value="rejected">Refuser</option></select>`;
    return `<div class="remittance-review-row">
      <div class="grow"><strong>${esc(sale?.brand || "")} ${esc(sale?.productName || "Vente introuvable")}</strong> × ${sale?.qty || 0}
        <div class="muted small">Acheteur : ${esc(sale?.buyerName || "Anonyme")} · ${fm(sale?.unitPrice)} / article · Remise : ${fm(saleItem.amount)}</div></div>
      ${decisionControl}
    </div>`;
  }).join("");
  openModal("Vérifier la remise", `
    <form data-submit="reviewRemittance" class="form">
      <input type="hidden" name="id" value="${esc(item.id)}">
      <div class="remittance-review-summary"><div><span class="muted">Employé</span><strong>${esc(item.employeeName)}</strong></div><div><span class="muted">Montant proposé</span><strong>${fm(item.amount)}</strong></div><div><span class="muted">À vérifier</span><strong>${remittanceDecisionCounts(item).pending} vente(s)</strong></div></div>
      <p class="muted">Décidez ligne par ligne. Les ventes validées sont confirmées, les refusées sont retirées, et seules celles laissées « En attente » resteront à vérifier.</p>
      <div class="remittance-review">${rows}</div>
      <label class="field"><span>Note administrateur <em>(facultatif)</em></span><input class="input" name="adminNote"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">Enregistrer la vérification</button></div>
    </form>`, { wide: true });
};

submits.reviewRemittance = async (form) => {
  const d = formData(form);
  const item = state.remittances.find((row) => row.id === d.id);
  if (!item) return toast("Remise introuvable.", "error");
  const sourceItems = remittanceItems(item);
  const decisions = Object.fromEntries(sourceItems.map((saleItem) => [saleItem.saleId, d[`decision_${saleItem.saleId}`]]));
  const review = reviewRemittanceItems(sourceItems, decisions);
  const { saleItems, approvedAmount, pendingCount, status } = review;
  try {
    await busy(form.querySelector("[type=submit]"), () => updateDoc(doc(db, "remittances", item.id), {
      saleItems, saleIds: saleItems.filter((saleItem) => saleItem.status !== "rejected").map((saleItem) => saleItem.saleId),
      amount: review.amount,
      approvedAmount, status, adminNote: d.adminNote || "", adminConfirmedAt: pendingCount === 0 ? serverTimestamp() : null,
      adminConfirmedBy: pendingCount === 0 ? state.me.uid : null, updatedAt: serverTimestamp(),
    }));
    await addDoc(collection(db, "notifications"), {
      recipientUid: item.employeeUid, title: status === "confirmed" ? "Remise confirmée" : status === "rejected" ? "Remise refusée" : status === "partially_confirmed" ? "Remise traitée partiellement" : "Remise partiellement vérifiée",
      message: status === "confirmed" ? `Toutes les ventes ont été validées pour ${fm(approvedAmount)}.` : status === "rejected" ? `Toutes les ventes de cette remise ont été refusées.` : status === "partially_confirmed" ? `${fm(approvedAmount)} validé(s); les autres ventes ont été refusées.` : `${fm(approvedAmount)} validé(s); des ventes restent en attente.`,
      readBy: [], createdAt: serverTimestamp(), kind: "remittance-review",
    });
    closeModal();
    toast(status === "partial" ? "Décisions enregistrées, des ventes restent en attente." : status === "confirmed" ? "Toutes les ventes ont été validées." : status === "partially_confirmed" ? "Les ventes validées sont confirmées et les autres refusées." : "Toutes les ventes ont été refusées.", "success", 6000);
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