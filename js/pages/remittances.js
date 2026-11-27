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
  const confirmedItems = items.filter((item) => item.status === "confirmed");
  const rejectedItems = items.filter((item) => item.status === "rejected");
  const pendingItems = items.filter((item) => !item.status || item.status === "pending");
  return {
    proposedAmount: round2(items.reduce((sum, item) => sum + num(item.amount), 0)) || num(remittance.proposedAmount ?? remittance.amount),
    confirmed: confirmedItems.length,
    confirmedAmount: round2(confirmedItems.reduce((sum, item) => sum + num(item.amount), 0)),
    rejected: rejectedItems.length,
    rejectedAmount: round2(rejectedItems.reduce((sum, item) => sum + num(item.amount), 0)),
    pending: pendingItems.length,
    pendingAmount: round2(pendingItems.reduce((sum, item) => sum + num(item.amount), 0)),
  };
}

function canReviewRemittance(remittance) {
  return isAdmin() && remittanceDecisionCounts(remittance).pending > 0;
}

function statusFor(remittance) {
  const counts = remittanceDecisionCounts(remittance);
  const hasLineDecisions = remittance.saleItems?.some((item) => item.status === "confirmed" || item.status === "rejected");
  if (!hasLineDecisions && remittance.status === "confirmed") return chip("Confirmée", "green");
  if (!hasLineDecisions && remittance.status === "rejected") return chip("Refusée", "red");
  if (!counts.pending && counts.rejected && counts.confirmed) return chip("Traitée partiellement", "amber");
  if (!counts.pending && counts.rejected && !counts.confirmed) return chip("Refusée", "red");
  if (!counts.pending && !counts.rejected) return chip("Confirmée", "green");
  if (counts.confirmed || counts.rejected) return chip("Partiellement vérifiée", "amber");
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
    <section class="remittance-list">${list.length ? list.map((item) => {
      const counts = remittanceDecisionCounts(item);
      return `<article class="remittance-card">
        <div class="remittance-card-head"><div><strong>${esc(item.employeeName)}</strong><time>${fmtDateTime(item.createdAt)}</time></div>${statusFor(item)}</div>
        <div class="remittance-card-summary">
          <div><span class="muted">Proposé</span><strong>${fm(counts.proposedAmount || item.amount)}</strong></div>
          <div><span class="muted">Validé</span><strong class="pos">${fm(counts.confirmedAmount)}</strong></div>
          <div><span class="muted">Refusé</span><strong class="neg">${fm(counts.rejectedAmount)}</strong></div>
          <div><span class="muted">À vérifier</span><strong>${fm(counts.pendingAmount)}</strong></div>
        </div>
        <div class="remittance-card-foot"><span class="muted">${counts.confirmed} validée(s) · ${counts.rejected} refusée(s) · ${counts.pending} en attente</span>
          <div class="row gap wrap"><button class="btn sm ghost" data-action="view-remittance" data-id="${esc(item.id)}">Détails</button>
            ${canReviewRemittance(item) ? `<button class="btn sm primary" data-action="review-remittance" data-id="${esc(item.id)}">Continuer la vérification (${counts.pending})</button>` : ""}</div>
        </div>
      </article>`;
    }).join("") : empty("Aucune remise sur cette période.", "wallet")}</section>`;
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
      employeeUid: me.uid, employeeName: me.name, saleIds, saleItems, amount, proposedAmount: amount, note: d.note || "",
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

function openRemittanceDetails(item, editable) {
  if (!item) return;
  const canEdit = editable && canReviewRemittance(item);
  const items = remittanceItems(item);
  const counts = remittanceDecisionCounts(item);
  const rows = items.map((saleItem) => {
    const sale = state.sales.find((row) => row.id === saleItem.saleId);
    const status = saleItem.status || "pending";
    const decisionControl = status !== "pending" || !canEdit
      ? saleItemStatusLabel(status)
      : `<select class="select remittance-decision" name="decision_${esc(saleItem.saleId)}"><option value="pending" selected>À décider</option><option value="confirmed">Valider cette vente</option><option value="rejected">Refuser cette vente</option></select>`;
    return `<div class="remittance-review-row">
      <div class="remittance-sale-info"><div class="remittance-sale-title"><strong>${esc(sale?.brand || "")} ${esc(sale?.productName || "Vente introuvable")}</strong><span>× ${sale?.qty || 0}</span></div>
        <div class="remittance-sale-meta"><span>${fmtDateTime(sale?.date)}</span><span>Acheteur : ${esc(sale?.buyerName || "Anonyme")}</span><span>${fm(sale?.unitPrice)} / article</span><span>Remise : <strong>${fm(saleItem.amount)}</strong></span></div></div>
      <div class="remittance-decision">${decisionControl}</div>
    </div>`;
  }).join("");
  const content = `
      <div class="remittance-detail-head"><div><span class="eyebrow">Remise de ${esc(item.employeeName)}</span><h4>${statusFor(item)}</h4></div><time>${fmtDateTime(item.createdAt)}</time></div>
      <div class="remittance-review-summary"><div><span class="muted">Montant proposé</span><strong>${fm(counts.proposedAmount)}</strong></div><div><span class="muted">Validé</span><strong class="pos">${fm(counts.confirmedAmount)}</strong></div><div><span class="muted">Refusé</span><strong class="neg">${fm(counts.rejectedAmount)}</strong></div><div><span class="muted">À vérifier</span><strong>${fm(counts.pendingAmount)}</strong></div></div>
      <div class="remittance-review-heading"><h4>Ventes incluses</h4><span class="muted">${items.length} ligne(s)</span></div>
      <div class="remittance-review">${rows}</div>
      ${item.note ? `<div class="remittance-note"><span class="muted">Note de l’employé</span><p>${esc(item.note)}</p></div>` : ""}
      ${item.adminNote ? `<div class="remittance-note"><span class="muted">Note de l’administrateur</span><p>${esc(item.adminNote)}</p></div>` : ""}`;
  if (!canEdit) {
    openModal("Détails de la remise", content, { wide: true });
    return;
  }
  openModal("Vérifier la remise", `
    <form data-submit="reviewRemittance" class="form">
      <input type="hidden" name="id" value="${esc(item.id)}">
      ${content}
      <label class="field"><span>Note administrateur <em>(facultatif)</em></span><input class="input" name="adminNote"></label>
      <div class="remittance-modal-footer"><span class="muted">Les décisions déjà enregistrées ne peuvent pas être modifiées.</span><div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Fermer</button>
        <button class="btn primary" type="submit">Enregistrer les décisions</button></div></div>
    </form>`, { wide: true });
}

actions["view-remittance"] = (el) => {
  const item = state.remittances.find((row) => row.id === el.dataset.id);
  openRemittanceDetails(item, false);
};

actions["review-remittance"] = (el) => {
  const item = state.remittances.find((row) => row.id === el.dataset.id);
  if (!item || !canReviewRemittance(item)) return;
  openRemittanceDetails(item, true);
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
      amount: review.amount, proposedAmount: review.proposedAmount,
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