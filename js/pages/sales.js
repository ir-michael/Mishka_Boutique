import {
  db, collection, doc, runTransaction, serverTimestamp, Timestamp,
} from "../fb.js";
import { state, isAdmin, productById, unitCost } from "../store.js";
import {
  esc, fm, fnum, fmtDate, fmtDateTime, toInputDate, fromInputDate, addDays, icon, chip, empty,
  openModal, closeModal, confirmBox, toast, formData, busy, friendlyError,
} from "../ui.js";
import { actions, submits, inputs, getF, setF, rerender, periodSelect } from "../core.js";
import {
  num, round2, paymentStatus, remaining, isOverdue, daysLate, inPeriod, saleProfit, toDate,
} from "../logic.js";
import { CATEGORIES } from "../config.js";

const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "Autre";
const pendingStorageKey = (uid) => `boutique-pending-sales:${uid}`;
let pendingUid = null;
let pendingSales = [];

function ensurePendingSales() {
  const uid = state.me?.uid;
  if (!uid) { pendingUid = null; pendingSales = []; return; }
  if (pendingUid === uid) return;
  pendingUid = uid;
  try {
    const stored = JSON.parse(localStorage.getItem(pendingStorageKey(uid)) || "[]");
    pendingSales = Array.isArray(stored) ? stored : [];
  } catch { pendingSales = []; }
}

function savePendingSales() {
  if (!pendingUid) throw new Error("Connectez-vous pour accéder aux ventes en attente.");
  localStorage.setItem(pendingStorageKey(pendingUid), JSON.stringify(pendingSales));
}

export function pendingSalesCount() {
  ensurePendingSales();
  return pendingSales.length;
}

function pendingQty(productId) {
  ensurePendingSales();
  return pendingSales.reduce((total, item) => total + (item.sale.productId === productId ? num(item.sale.qty) : 0), 0);
}

function availableQty(product) {
  return Math.max(0, num(product.qty) - pendingQty(product.id));
}

function serializePendingSale(sale) {
  const { dueDate, payments, ...fields } = sale;
  return {
    ...fields,
    dueDateMs: dueDate?.toMillis?.() ?? null,
    payments: payments.map(({ date, ...payment }) => ({ ...payment, dateMs: date.toMillis() })),
  };
}

function restorePendingSale(sale) {
  const { dueDateMs, payments, ...fields } = sale;
  return {
    ...fields,
    dueDate: dueDateMs == null ? null : Timestamp.fromMillis(dueDateMs),
    payments: payments.map(({ dateMs, ...payment }) => ({ ...payment, date: Timestamp.fromMillis(dateMs) })),
  };
}

async function queueSale(sale, saleId, movementId, capturedAt = Date.now()) {
  ensurePendingSales();
  pendingSales.push({ id: saleId, movementId, capturedAt, sale: serializePendingSale(sale), error: "" });
  try { savePendingSales(); }
  catch (error) { pendingSales.pop(); throw error; }
  rerender();
}

async function writeSale(saleId, movementId, sale, capturedAt = null) {
  const saleRef = doc(db, "sales", saleId);
  const movRef = doc(db, "movements", movementId);
  const prodRef = doc(db, "products", sale.productId);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(saleRef);
    if (existing.exists()) return;
    const snap = await tx.get(prodRef);
    const current = snap.exists() ? snap.data() : null;
    if (!current || num(current.qty) < sale.qty) throw new Error(`Stock insuffisant (${current ? current.qty : 0} disponible).`);
    tx.update(prodRef, { qty: num(current.qty) - sale.qty, updatedAt: serverTimestamp() });
    tx.set(saleRef, capturedAt == null ? { ...sale, date: serverTimestamp() } : {
      ...sale,
      date: Timestamp.fromMillis(capturedAt),
      offlineCapturedAt: Timestamp.fromMillis(capturedAt),
    });
    tx.set(movRef, {
      type: "out", reason: "sale", productId: sale.productId, productName: sale.productName, brand: sale.brand || "",
      qty: sale.qty, refId: saleId, date: serverTimestamp(), by: sale.createdBy, byName: sale.createdByName,
    });
  });
}

export async function syncPendingSales() {
  ensurePendingSales();
  if (!pendingSales.length) return;
  if (!navigator.onLine) return toast("Connexion Internet requise pour synchroniser les ventes.", "error");
  let synced = 0;
  for (const item of [...pendingSales]) {
    try {
      await writeSale(item.id, item.movementId, restorePendingSale(item.sale), item.capturedAt);
      pendingSales = pendingSales.filter((sale) => sale.id !== item.id);
      savePendingSales();
      synced++;
    } catch (error) {
      const current = pendingSales.find((sale) => sale.id === item.id);
      if (current) current.error = friendlyError(error);
      savePendingSales();
    }
  }
  rerender();
  if (synced) toast(`${synced} vente(s) synchronisée(s).`, "success");
  if (pendingSales.length) toast(`${pendingSales.length} vente(s) restent en attente. Vérifiez le stock ou votre connexion.`, "error", 6000);
}

actions["sync-sales"] = syncPendingSales;

actions["discard-pending-sale"] = async (el) => {
  const item = pendingSales.find((sale) => sale.id === el.dataset.id);
  if (!item || !(await confirmBox("Cette vente n'a pas encore été envoyée à Firebase. La retirer définitivement de cet appareil ?", { okLabel: "Retirer", danger: true }))) return;
  pendingSales = pendingSales.filter((sale) => sale.id !== item.id);
  savePendingSales();
  rerender();
};

function pendingSalesBlock() {
  if (!pendingSales.length) return "";
  return `<section class="card"><div class="card-head"><h3>Ventes en attente de synchronisation (${pendingSales.length})</h3>
      <button class="btn primary" data-action="sync-sales" ${navigator.onLine ? "" : "disabled"}>Synchroniser</button></div>
    <p class="muted">Ces ventes sont enregistrées sur cet appareil, mais ne figurent pas encore dans les données partagées. La synchronisation recontrôlera le stock.</p>
    <div class="table-wrap"><table class="table responsive compact"><thead><tr><th>Date locale</th><th>Produit</th><th>Qté</th><th>Total</th><th>État</th><th></th></tr></thead><tbody>
      ${pendingSales.map((item) => `<tr><td data-label="Date locale">${fmtDate(new Date(item.capturedAt))}</td><td data-label="Produit">${esc(item.sale.brand || "")} ${esc(item.sale.productName)}</td>
        <td data-label="Qté">${item.sale.qty}</td><td data-label="Total">${fm(item.sale.total)}</td><td data-label="État">${item.error ? `<span class="neg">${esc(item.error)}</span>` : chip("À synchroniser", "amber")}</td>
        <td class="actions"><button class="btn sm ghost" data-action="discard-pending-sale" data-id="${esc(item.id)}">Retirer</button></td></tr>`).join("")}</tbody></table></div></section>`;
}

export const statusChip = (s) => {
  if (s.status === "cancelled") return chip("Annulée", "gray");
  if (s.status === "paid") return chip("Soldé", "green");
  if (isOverdue(s)) return chip("En retard", "red");
  return s.status === "partial" ? chip("Partiel", "amber") : chip("Impayé", "red");
};

// ============================================================
//  Liste des ventes
// ============================================================
function filtered() {
  const q = getF("sales.q").toLowerCase();
  const st = getF("sales.status", "all");
  const per = getF("sales.period", "month");
  return state.sales.filter((s) => {
    if (!inPeriod(s.date, per)) return false;
    if (st === "overdue") { if (!isOverdue(s)) return false; }
    else if (st !== "all" && s.status !== st) return false;
    if (q && !`${s.productName} ${s.brand} ${s.buyerName || ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

function render() {
  ensurePendingSales();
  const admin = isAdmin();
  const list = filtered();
  const live = list.filter((s) => s.status !== "cancelled");
  const total = round2(live.reduce((t, s) => t + num(s.total), 0));
  const paid = round2(live.reduce((t, s) => t + num(s.paid), 0));
  const rest = round2(live.reduce((t, s) => t + num(s.remaining), 0));
  const profit = admin ? round2(live.reduce((t, s) => t + (saleProfit(s, unitCost(s.productId)) ?? 0), 0)) : 0;
  const limit = getF("sales.limit", 100);
  const rows = list.slice(0, limit);
  const st = getF("sales.status", "all");

  return `
    <div class="page-head"><div><h2>Ventes</h2><p class="muted">${list.length} vente(s) · date enregistrée automatiquement</p></div>
      <button class="btn primary" data-action="new-sale">${icon("plus")} Nouvelle vente</button></div>

    <div class="toolbar">
      <div class="search">${icon("search")}<input id="sales-q" class="input" placeholder="Rechercher produit ou acheteur…" value="${esc(getF("sales.q"))}" data-filter="sales.q"></div>
      <select class="select" data-filter="sales.status">
        ${[["all", "Tous les statuts"], ["paid", "Soldées"], ["partial", "Paiement partiel"], ["unpaid", "Impayées"], ["overdue", "En retard"], ["cancelled", "Annulées"]]
          .map(([v, l]) => `<option value="${v}" ${v === st ? "selected" : ""}>${l}</option>`).join("")}
      </select>
      ${periodSelect("sales.period", "month")}
    </div>

    ${pendingSalesBlock()}

    <div class="summary-bar">
      <div><span class="muted">Total ventes</span><strong>${fm(total)}</strong></div>
      <div><span class="muted">Encaissé</span><strong class="pos">${fm(paid)}</strong></div>
      <div><span class="muted">Reste à payer</span><strong class="${rest > 0 ? "neg" : ""}">${fm(rest)}</strong></div>
      ${admin ? `<div><span class="muted">Bénéfice brut</span><strong class="pos">${fm(profit)}</strong></div>` : ""}
    </div>

    <section class="card flush">
      ${rows.length ? `<table class="table responsive"><thead><tr>
        <th>Date</th><th>Produit</th><th class="num">Qté</th><th class="num">Prix unit.</th><th class="num">Total</th>
        <th>Acheteur</th><th class="num">Payé</th><th>Reste / échéance</th><th>Statut</th>${admin ? '<th class="num">Bénéfice</th>' : ""}<th></th></tr></thead><tbody>
        ${rows.map((s) => {
          const p = admin ? saleProfit(s, unitCost(s.productId)) : null;
          return `<tr class="${s.status === "cancelled" ? "dim" : ""}" data-action="sale-detail" data-id="${s.id}">
            <td data-label="Date">${fmtDate(s.date)}<div class="muted small">${fmtDateTime(s.date).split("·")[1] || ""}</div></td>
            <td data-label="Produit"><strong>${esc(s.brand || "")} ${esc(s.productName)}</strong><div class="muted small">${esc(catLabel(s.category))}</div></td>
            <td data-label="Qté" class="num">${s.qty}</td>
            <td data-label="Prix unit." class="num">${fm(s.unitPrice)}</td>
            <td data-label="Total" class="num"><strong>${fm(s.total)}</strong></td>
            <td data-label="Acheteur">${esc(s.buyerName || "Anonyme")}</td>
            <td data-label="Payé" class="num">${fm(s.paid)}</td>
            <td data-label="Reste">${num(s.remaining) > 0 && s.status !== "cancelled" ? `<span class="neg">${fm(s.remaining)}</span><div class="muted small">avant le ${fmtDate(s.dueDate)}</div>` : "—"}</td>
            <td data-label="Statut">${statusChip(s)}</td>
            ${admin ? `<td data-label="Bénéfice" class="num ${p != null && p < 0 ? "neg" : "pos"}">${p == null ? "—" : fm(p)}</td>` : ""}
            <td class="actions"><button class="btn sm ghost" data-action="sale-detail" data-id="${s.id}">Détails</button></td>
          </tr>`;
        }).join("")}</tbody></table>
        ${list.length > limit ? `<div class="center pad"><button class="btn ghost" data-action="more-sales">Afficher plus</button></div>` : ""}`
        : empty("Aucune vente ne correspond à ces filtres.", "cart")}
    </section>`;
}

actions["more-sales"] = () => { setF("sales.limit", getF("sales.limit", 100) + 100); rerender(); };

// ============================================================
//  Nouvelle vente
// ============================================================
actions["new-sale"] = (el) => openSaleForm(el?.dataset?.product || "");

export function openSaleForm(preselect = "") {
  ensurePendingSales();
  const avail = state.products.filter((p) => !p.archived && availableQty(p) > 0)
    .sort((a, b) => `${a.brand}${a.name}`.localeCompare(`${b.brand}${b.name}`));
  if (!avail.length) { toast("Aucun produit en stock à vendre.", "error"); return; }
  const buyers = [...new Set(state.sales.map((s) => s.buyerName).filter(Boolean))];
  const groups = CATEGORIES.map((c) => ({ c, items: avail.filter((p) => (p.category || "autre") === c.id) })).filter((g) => g.items.length);
  const options = groups.map((g) => `<optgroup label="${esc(g.c.label)}">${g.items.map((p) =>
    `<option value="${p.id}" ${p.id === preselect ? "selected" : ""}>${esc(p.brand || "")} ${esc(p.name)} — ${availableQty(p)} disponible(s)</option>`).join("")}</optgroup>`).join("");

  openModal("Nouvelle vente", `
    <form data-submit="saveSale" class="form" autocomplete="off">
      <label class="field"><span>Produit à vendre</span>
        <select class="select" name="productId" data-input="saleCalc" required><option value="">— Choisir un produit —</option>${options}</select></label>
      <div class="grid-3">
        <label class="field"><span>Quantité</span><input class="input" type="number" name="qty" min="1" step="1" value="1" inputmode="numeric" data-input="saleCalc" required></label>
        <label class="field"><span>Prix unitaire</span><input class="input" type="number" name="unitPrice" min="0" step="0.01" inputmode="decimal" data-input="saleCalc" required></label>
        <label class="field"><span>Total</span><input class="input total-field" name="total" readonly value="—"></label>
      </div>
      <p class="hint" id="sale-hint"></p>

      <div class="grid-2">
        <label class="field"><span>Nom de l'acheteur <em>(facultatif)</em></span>
          <input class="input" name="buyerName" list="buyers" placeholder="Laisser vide = anonyme"><datalist id="buyers">${buyers.map((b) => `<option value="${esc(b)}">`).join("")}</datalist></label>
        <label class="field"><span>Téléphone <em>(facultatif)</em></span><input class="input" name="buyerPhone" type="tel" placeholder="Pour les rappels WhatsApp"></label>
      </div>

      <fieldset class="field"><legend>Paiement</legend>
        <div class="seg" role="radiogroup">
          <label><input type="radio" name="payMode" value="full" checked data-input="saleCalc"><span>Payé en totalité</span></label>
          <label><input type="radio" name="payMode" value="partial" data-input="saleCalc"><span>Paiement partiel</span></label>
          <label><input type="radio" name="payMode" value="none" data-input="saleCalc"><span>Rien payé</span></label>
        </div>
      </fieldset>
      <div class="grid-2" id="pay-extra" hidden>
        <label class="field" id="paid-wrap" hidden><span>Montant payé maintenant</span><input class="input" type="number" name="paidAmount" min="0" step="0.01" inputmode="decimal" data-input="saleCalc"></label>
        <label class="field" id="due-wrap" hidden><span>Date pour solder le reste</span><input class="input" type="date" name="dueDate" value="${toInputDate(addDays(7))}" min="${toInputDate()}"></label>
      </div>
      <p class="hint" id="sale-rest"></p>
      <p class="muted small">${icon("clock", 14)} La date et l'heure de la vente sont ajoutées automatiquement.</p>
      <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">${icon("check")} Enregistrer la vente</button></div>
    </form>`);
  const form = document.querySelector("#modal-root form");
  if (preselect) updateSaleForm(form, true);
}

function updateSaleForm(form, productChanged = false) {
  const p = productById(form.productId.value);
  if (productChanged && p) { form.unitPrice.value = p.sellPrice ?? ""; form.qty.max = availableQty(p); }
  if (!p) form.qty.removeAttribute("max");
  const qty = Math.max(0, parseInt(form.qty.value, 10) || 0);
  const price = num(form.unitPrice.value);
  const total = round2(qty * price);
  form.total.value = p ? fm(total) : "—";

  const mode = form.payMode.value;
  let paid = mode === "full" ? total : mode === "none" ? 0 : Math.min(num(form.paidAmount.value), total);
  const rest = remaining(total, paid);
  document.getElementById("paid-wrap").hidden = mode !== "partial";
  document.getElementById("due-wrap").hidden = !(rest > 0 && total > 0);
  document.getElementById("pay-extra").hidden = mode === "full";
  form.dueDate.required = rest > 0 && total > 0;

  const hint = [];
  if (p) {
    const available = availableQty(p);
    hint.push(`Stock disponible : <strong>${available}</strong>`);
    if (qty > available) hint.push(`<span class="neg">Quantité supérieure au stock disponible sur cet appareil</span>`);
    const c = unitCost(p.id);
    if (isAdmin() && c != null && price < c) hint.push(`<span class="neg">⚠ Prix inférieur au coût de revient (${fm(c)})</span>`);
  }
  document.getElementById("sale-hint").innerHTML = hint.join(" · ");
  document.getElementById("sale-rest").innerHTML = total > 0
    ? `Payé : <strong>${fm(paid)}</strong> · Reste à payer : <strong class="${rest > 0 ? "neg" : "pos"}">${fm(rest)}</strong>` : "";
}

inputs.saleCalc = (el) => updateSaleForm(el.closest("form"), el.name === "productId");

submits.saveSale = async (form) => {
  ensurePendingSales();
  const d = formData(form);
  const product = productById(d.productId);
  const qty = parseInt(d.qty, 10);
  const unitPrice = round2(num(d.unitPrice));
  if (!product) return toast("Choisissez un produit.", "error");
  if (!(qty > 0)) return toast("Quantité invalide.", "error");
  if (qty > availableQty(product)) return toast(`Stock insuffisant (${availableQty(product)} disponible sur cet appareil).`, "error");
  const total = round2(qty * unitPrice);
  let paid = d.payMode === "full" ? total : d.payMode === "none" ? 0 : round2(Math.min(num(d.paidAmount), total));
  if (d.payMode === "partial" && !(paid > 0)) return toast("Indiquez le montant payé ou choisissez « Rien payé ».", "error");
  const rest = remaining(total, paid);
  if (rest > 0 && !d.dueDate) return toast("Indiquez la date pour solder le reste.", "error");

  const me = state.me;
  const saleRef = doc(collection(db, "sales"));
  const movRef = doc(collection(db, "movements"));
  const sale = {
    productId: product.id, productName: product.name, brand: product.brand || "", category: product.category || "autre",
    orderId: product.orderId || null, qty, unitPrice, total, buyerName: d.buyerName || "", buyerPhone: d.buyerPhone || "",
    paid, remaining: rest, status: paymentStatus(total, paid),
    dueDate: rest > 0 ? Timestamp.fromDate(fromInputDate(d.dueDate)) : null,
    payments: paid > 0 ? [{ amount: paid, date: Timestamp.now(), by: me.uid, byName: me.name }] : [],
    createdBy: me.uid, createdByName: me.name,
  };
  const btn = form.querySelector("[type=submit]");
  try {
    if (!navigator.onLine) {
      await queueSale(sale, saleRef.id, movRef.id);
      closeModal();
      toast("Vente enregistrée sur cet appareil. Synchronisez-la au retour de la connexion.", "info", 6000);
      return;
    }
    await busy(btn, () => writeSale(saleRef.id, movRef.id, sale));
    const done = { id: saleRef.id, ...sale, date: new Date() };
    openModal("Vente enregistrée ✓", `
      <div class="success-box">${icon("check", 36)}
        <p><strong>${esc(sale.brand)} ${esc(sale.productName)}</strong> × ${qty}</p>
        <p class="big">${fm(total)}</p>
        <p class="muted">${rest > 0 ? `Reste ${fm(rest)} à payer avant le ${fmtDate(sale.dueDate)}` : "Paiement complet"}</p></div>
      <div class="row gap wrap center">
        <button class="btn" id="btn-receipt">${icon("print")} Imprimer le reçu</button>
        <button class="btn primary" data-action="new-sale">${icon("plus")} Nouvelle vente</button>
        <button class="btn ghost" data-action="close-modal">Fermer</button></div>`);
    document.getElementById("btn-receipt").onclick = () => printReceipt(done);
  } catch (e) {
    if (!navigator.onLine || ["unavailable", "deadline-exceeded", "network-request-failed"].includes(e?.code)) {
      try {
        await queueSale(sale, saleRef.id, movRef.id);
        closeModal();
        toast("Connexion interrompue : vente gardée sur cet appareil, à synchroniser plus tard.", "info", 6000);
        return;
      } catch (queueError) { toast(friendlyError(queueError), "error", 5000); return; }
    }
    toast(friendlyError(e), "error", 5000);
  }
};

// ============================================================
//  Détail d'une vente
// ============================================================
actions["sale-detail"] = (el, ev) => {
  if (ev.target.closest("button") && ev.target.closest("button") !== el && el.tagName === "TR") {
    // un bouton interne gère lui-même le clic
  }
  openSaleDetail(el.dataset.id);
};

export function openSaleDetail(id) {
  const s = state.sales.find((x) => x.id === id);
  if (!s) return;
  const admin = isAdmin();
  const cost = admin ? unitCost(s.productId) : null;
  const profit = admin ? saleProfit(s, cost) : null;
  const pays = (s.payments || []).slice().sort((a, b) => toDate(a.date) - toDate(b.date));
  openModal(`Vente — ${s.brand || ""} ${s.productName}`.trim(), `
    <div class="detail-grid">
      <div><span class="muted">Date</span><strong>${fmtDateTime(s.date)}</strong></div>
      <div><span class="muted">Statut</span>${statusChip(s)}</div>
      <div><span class="muted">Acheteur</span><strong>${esc(s.buyerName || "Anonyme")}</strong>${s.buyerPhone ? `<div class="muted small">${esc(s.buyerPhone)}</div>` : ""}</div>
      <div><span class="muted">Vendeur</span><strong>${esc(s.createdByName || "—")}</strong></div>
      <div><span class="muted">Quantité × prix</span><strong>${s.qty} × ${fm(s.unitPrice)}</strong></div>
      <div><span class="muted">Total</span><strong>${fm(s.total)}</strong></div>
      <div><span class="muted">Payé</span><strong class="pos">${fm(s.paid)}</strong></div>
      <div><span class="muted">Reste à payer</span><strong class="${num(s.remaining) > 0 ? "neg" : ""}">${fm(s.remaining)}</strong>
        ${num(s.remaining) > 0 && s.status !== "cancelled" ? `<div class="muted small">avant le ${fmtDate(s.dueDate)}${isOverdue(s) ? ` · <span class="neg">${daysLate(s)} j de retard</span>` : ""}</div>` : ""}</div>
      ${admin ? `<div><span class="muted">Coût de revient</span><strong>${cost == null ? "—" : fm(cost * s.qty)}</strong></div>
      <div><span class="muted">Bénéfice</span><strong class="${profit != null && profit < 0 ? "neg" : "pos"}">${profit == null ? "—" : fm(profit)}</strong></div>` : ""}
    </div>
    <h4>Historique des paiements</h4>
    ${pays.length ? `<table class="table compact"><thead><tr><th>Date</th><th>Reçu par</th><th class="num">Montant</th></tr></thead><tbody>
      ${pays.map((p) => `<tr><td>${fmtDateTime(p.date)}</td><td>${esc(p.byName || "—")}</td><td class="num">${fm(p.amount)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">Aucun paiement enregistré.</p>`}
    <div class="row gap wrap end top-gap">
      ${num(s.remaining) > 0 && s.status !== "cancelled" ? `<button class="btn primary" data-action="pay-sale" data-id="${s.id}">${icon("wallet")} Encaisser</button>` : ""}
      <button class="btn" data-action="receipt" data-id="${s.id}">${icon("print")} Reçu</button>
      ${admin && s.status !== "cancelled" ? `<button class="btn danger-ghost" data-action="cancel-sale" data-id="${s.id}">Annuler la vente</button>` : ""}
    </div>`, { wide: true });
}

actions.receipt = (el) => { const s = state.sales.find((x) => x.id === el.dataset.id); if (s) printReceipt(s); };

// ============================================================
//  Encaissement d'un solde
// ============================================================
actions["pay-sale"] = (el) => openPaymentForm(el.dataset.id);

export function openPaymentForm(id) {
  const s = state.sales.find((x) => x.id === id);
  if (!s) return;
  openModal("Encaisser un paiement", `
    <form data-submit="savePayment" class="form">
      <input type="hidden" name="id" value="${s.id}">
      <p><strong>${esc(s.buyerName || "Anonyme")}</strong> — ${esc(s.brand || "")} ${esc(s.productName)}<br>
        <span class="muted">Reste à payer : </span><strong class="neg">${fm(s.remaining)}</strong></p>
      <label class="field"><span>Montant reçu</span>
        <input class="input" type="number" name="amount" min="0.01" max="${s.remaining}" step="0.01" value="${s.remaining}" inputmode="decimal" required></label>
      <label class="field"><span>Nouvelle date pour le reste <em>(si paiement partiel)</em></span>
        <input class="input" type="date" name="dueDate" value="${toInputDate(toDate(s.dueDate) > new Date() ? s.dueDate : addDays(7))}"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">${icon("check")} Valider</button></div>
    </form>`);
}

submits.savePayment = async (form) => {
  const d = formData(form);
  const ref = doc(db, "sales", d.id);
  const amount = round2(num(d.amount));
  if (!(amount > 0)) return toast("Montant invalide.", "error");
  const me = state.me;
  try {
    await busy(form.querySelector("[type=submit]"), () => runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const s = snap.data();
      if (!s || s.status === "cancelled") throw new Error("Vente introuvable ou annulée.");
      if (amount > num(s.remaining) + 0.001) throw new Error(`Le montant dépasse le reste à payer (${fm(s.remaining)}).`);
      const paid = round2(num(s.paid) + amount);
      const rest = remaining(s.total, paid);
      tx.update(ref, {
        paid, remaining: rest, status: paymentStatus(s.total, paid),
        payments: [...(s.payments || []), { amount, date: Timestamp.now(), by: me.uid, byName: me.name }],
        dueDate: rest > 0 ? (d.dueDate ? Timestamp.fromDate(fromInputDate(d.dueDate)) : s.dueDate) : null,
      });
    }));
    toast("Paiement enregistré ✓", "success");
    closeModal();
  } catch (e) { toast(friendlyError(e), "error", 5000); }
};

// ============================================================
//  Annulation (admin)
// ============================================================
actions["cancel-sale"] = async (el) => {
  const s = state.sales.find((x) => x.id === el.dataset.id);
  if (!s) return;
  const refund = num(s.paid) > 0 ? ` Les ${fm(s.paid)} déjà encaissés devront être remboursés.` : "";
  if (!(await confirmBox(`Annuler cette vente ? Le stock sera remis (+${s.qty}).${refund}`, { okLabel: "Annuler la vente", danger: true }))) return;
  const sref = doc(db, "sales", s.id), pref = doc(db, "products", s.productId), mref = doc(collection(db, "movements"));
  try {
    await runTransaction(db, async (tx) => {
      const [ss, ps] = await Promise.all([tx.get(sref), tx.get(pref)]);
      if (ss.data().status === "cancelled") throw new Error("Déjà annulée.");
      tx.update(sref, { status: "cancelled", cancelledAt: serverTimestamp(), cancelledBy: state.me.uid });
      if (ps.exists()) tx.update(pref, { qty: num(ps.data().qty) + num(s.qty), updatedAt: serverTimestamp() });
      tx.set(mref, { type: "in", reason: "cancel_sale", productId: s.productId, productName: s.productName, brand: s.brand || "",
        qty: s.qty, refId: s.id, date: serverTimestamp(), by: state.me.uid, byName: state.me.name });
    });
    toast("Vente annulée, stock remis.", "success");
    closeModal();
  } catch (e) { toast(friendlyError(e), "error"); }
};

// ============================================================
//  Reçu imprimable
// ============================================================
export function printReceipt(s) {
  const shop = state.shop;
  const w = window.open("", "_blank", "width=420,height=700");
  if (!w) return toast("Autorisez les fenêtres pop-up pour imprimer le reçu.", "error");
  const no = String(s.id || "").slice(0, 6).toUpperCase();
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Reçu ${esc(no)}</title>
  <style>body{font-family:system-ui,Arial,sans-serif;max-width:340px;margin:16px auto;color:#111;font-size:14px}
  h1{font-size:18px;margin:0;text-align:center}.c{text-align:center;color:#555;font-size:12px}
  hr{border:0;border-top:1px dashed #999;margin:12px 0}table{width:100%;border-collapse:collapse}
  td{padding:3px 0;vertical-align:top}.r{text-align:right}.b{font-weight:700}.big{font-size:16px}
  .sig{margin-top:36px;border-top:1px solid #999;text-align:center;font-size:12px;color:#555;padding-top:4px}</style></head><body>
  <h1>${esc(shop.name)}</h1>
  <div class="c">${esc(shop.address || "")}${shop.address && shop.phone ? " · " : ""}${esc(shop.phone || "")}</div>
  <hr><table><tr><td>Reçu n°</td><td class="r b">${esc(no)}</td></tr>
  <tr><td>Date</td><td class="r">${esc(fmtDateTime(s.date))}</td></tr>
  <tr><td>Client</td><td class="r">${esc(s.buyerName || "Anonyme")}</td></tr></table><hr>
  <table><tr><td colspan="2" class="b">${esc(s.brand || "")} ${esc(s.productName)}</td></tr>
  <tr><td>${esc(s.qty)} × ${esc(fm(s.unitPrice))}</td><td class="r b">${esc(fm(s.total))}</td></tr></table><hr>
  <table><tr><td>Total</td><td class="r b big">${esc(fm(s.total))}</td></tr>
  <tr><td>Payé</td><td class="r">${esc(fm(s.paid))}</td></tr>
  <tr><td>Reste à payer</td><td class="r b">${esc(fm(s.remaining))}</td></tr>
  ${num(s.remaining) > 0 ? `<tr><td>À solder avant le</td><td class="r">${esc(fmtDate(s.dueDate))}</td></tr>` : ""}</table>
  <div class="sig">Signature</div><p class="c">Merci pour votre confiance !</p></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 350);
}

export default {
  id: "sales", title: "Ventes", label: "Ventes", icon: "cart", roles: ["admin", "employee"], render,
};
