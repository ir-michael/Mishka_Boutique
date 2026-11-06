import {
  db, collection, doc, writeBatch, addDoc, updateDoc, serverTimestamp, Timestamp,
} from "../fb.js";
import { state, isAdmin, userName } from "../store.js";
import {
  esc, fm, fnum, fmtDate, fmtDateTime, toInputDate, fromInputDate, icon, chip, empty,
  openModal, closeModal, confirmBox, toast, formData, busy, friendlyError,
} from "../ui.js";
import { actions, submits, inputs, getF, rerender } from "../core.js";
import { num, round2, orderTotals, allocateCosts, suggestPrice, toDate, sum } from "../logic.js";
import { CATEGORIES } from "../config.js";

const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "Autre";
const catOptions = (sel) => CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.label)}</option>`).join("");
const EXP_TYPES = [["transfert", "Frais de transfert"], ["motivation", "Motivation"], ["autre", "Autre dépense"]];
const expLabel = (t) => EXP_TYPES.find((e) => e[0] === t)?.[1] || "Dépense";
const noticeOf = (o) => state.notices.find((n) => n.id === o.id);

function statusOf(o) {
  if (o.status === "received") return chip("Reçue", "green");
  if (o.status === "cancelled") return chip("Annulée", "gray");
  return noticeOf(o)?.arrived ? chip("Colis arrivé", "blue") : chip("En cours", "amber");
}

const nextRef = () => {
  const d = new Date();
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `CMD-${day}-${String(state.orders.filter((o) => String(o.ref).includes(day)).length + 1).padStart(2, "0")}`;
};

// ============================================================
//  Liste des commandes (admin)
// ============================================================
function render() {
  const st = getF("orders.status", "all");
  const q = getF("orders.q").toLowerCase();
  const list = state.orders.filter((o) => {
    if (st === "arrived") { if (!(o.status === "pending" && noticeOf(o)?.arrived)) return false; }
    else if (st !== "all" && o.status !== st) return false;
    return !q || `${o.ref} ${o.supplier || ""} ${(o.lines || []).map((l) => l.brand + " " + l.name).join(" ")}`.toLowerCase().includes(q);
  });
  const pending = state.orders.filter((o) => o.status === "pending");
  const arrived = pending.filter((o) => noticeOf(o)?.arrived);

  return `
    <div class="page-head"><div><h2>Commandes</h2><p class="muted">Achats auprès des fournisseurs, de la commande à la réception</p></div>
      <button class="btn primary" data-action="new-order">${icon("plus")} Nouvelle commande</button></div>

    <div class="summary-bar">
      <div><span class="muted">En cours</span><strong>${pending.length}</strong></div>
      <div><span class="muted">Colis arrivés à finaliser</span><strong class="${arrived.length ? "neg" : ""}">${arrived.length}</strong></div>
      <div><span class="muted">Montant engagé</span><strong>${fm(sum(pending, (o) => o.totals?.totalCost))}</strong></div>
      <div><span class="muted">Commandes reçues</span><strong>${state.orders.filter((o) => o.status === "received").length}</strong></div>
    </div>

    <div class="toolbar">
      <div class="search">${icon("search")}<input id="orders-q" class="input" placeholder="Rechercher référence, fournisseur, produit…" value="${esc(getF("orders.q"))}" data-filter="orders.q"></div>
      <select class="select" data-filter="orders.status">
        ${[["all", "Toutes"], ["pending", "En cours"], ["arrived", "Colis arrivés"], ["received", "Reçues"], ["cancelled", "Annulées"]]
          .map(([v, l]) => `<option value="${v}" ${v === st ? "selected" : ""}>${l}</option>`).join("")}</select>
    </div>

    <section class="card flush">
      ${list.length ? `<table class="table responsive"><thead><tr><th>Référence</th><th>Date</th><th>Fournisseur</th><th>Contenu</th>
        <th class="num">Articles</th><th class="num">Dépenses</th><th class="num">Total</th><th>Statut</th><th></th></tr></thead><tbody>
        ${list.map((o) => {
          const t = o.totals || orderTotals(o);
          const units = sum(o.lines || [], (l) => l.qty);
          return `<tr data-action="order-detail" data-id="${o.id}">
            <td data-label="Référence"><strong>${esc(o.ref)}</strong></td>
            <td data-label="Date">${fmtDate(o.orderDate || o.createdAt)}</td>
            <td data-label="Fournisseur">${esc(o.supplier || "—")}</td>
            <td data-label="Contenu">${esc((o.lines || []).slice(0, 2).map((l) => `${l.qty}× ${l.brand} ${l.name}`.replace(/\s+/g, " ")).join(", "))}${(o.lines || []).length > 2 ? "…" : ""}</td>
            <td data-label="Articles" class="num">${fm(t.itemsTotal)} <span class="muted small">(${fnum(units)} u.)</span></td>
            <td data-label="Dépenses" class="num">${fm(t.expensesTotal + t.freightTotal)}</td>
            <td data-label="Total" class="num"><strong>${fm(t.totalCost)}</strong></td>
            <td data-label="Statut">${statusOf(o)}</td>
            <td class="actions"><button class="btn sm ghost" data-action="order-detail" data-id="${o.id}">Ouvrir</button></td></tr>`;
        }).join("")}</tbody></table>` : empty("Aucune commande. Créez-en une pour commencer.", "truck")}
    </section>`;
}

// ============================================================
//  Formulaire de commande (création / modification)
// ============================================================
const lineRow = (l = {}) => `
  <div class="line-row" data-line>
    <select class="select" name="l_cat" aria-label="Type">${catOptions(l.category || "ordinateur")}</select>
    <input class="input" name="l_brand" placeholder="Marque" value="${esc(l.brand || "")}">
    <input class="input" name="l_name" placeholder="Modèle / désignation" value="${esc(l.name || "")}" required>
    <input class="input" type="number" name="l_qty" min="1" step="1" value="${l.qty ?? 1}" inputmode="numeric" data-input="orderCalc" aria-label="Quantité" title="Quantité">
    <input class="input" type="number" name="l_price" min="0" step="0.01" value="${l.unitPrice ?? ""}" inputmode="decimal" placeholder="Prix unit." data-input="orderCalc" aria-label="Prix unitaire" title="Prix unitaire">
    <div class="line-total" data-lt>—</div>
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Supprimer la ligne">${icon("x")}</button>
  </div>`;

const expRow = (e = {}) => `
  <div class="exp-row" data-exp>
    <select class="select" name="e_type">${EXP_TYPES.map(([v, l]) => `<option value="${v}" ${v === e.type ? "selected" : ""}>${l}</option>`).join("")}</select>
    <input class="input" name="e_label" placeholder="Précision (facultatif)" value="${esc(e.label || "")}">
    <input class="input" type="number" name="e_amount" min="0" step="0.01" value="${e.amount ?? ""}" inputmode="decimal" placeholder="Montant" data-input="orderCalc" aria-label="Montant">
    <button type="button" class="icon-btn" data-action="remove-row" aria-label="Supprimer la dépense">${icon("x")}</button>
  </div>`;

function orderForm(o = null) {
  return `
  <form data-submit="saveOrder" class="form" autocomplete="off">
    <input type="hidden" name="id" value="${o?.id || ""}">
    <div class="grid-3">
      <label class="field"><span>Référence</span><input class="input" name="ref" value="${esc(o?.ref || nextRef())}" required></label>
      <label class="field"><span>Date de commande</span><input class="input" type="date" name="orderDate" value="${toInputDate(o?.orderDate || new Date())}" required></label>
      <label class="field"><span>Fournisseur <em>(facultatif)</em></span><input class="input" name="supplier" value="${esc(o?.supplier || "")}" placeholder="Nom / ville / site"></label>
    </div>

    <h4>Articles commandés</h4>
    <div class="line-head"><span>Type</span><span>Marque</span><span>Modèle</span><span>Qté</span><span>Prix unit.</span><span>Total</span><span></span></div>
    <div id="lines">${(o?.lines?.length ? o.lines : [{}]).map(lineRow).join("")}</div>
    <button type="button" class="btn ghost sm" data-action="add-line">${icon("plus", 15)} Ajouter un article</button>

    <h4>Dépenses de la commande <span class="muted small">(transfert, motivation, autres)</span></h4>
    <div id="exps">${(o?.expenses || []).map(expRow).join("")}</div>
    <button type="button" class="btn ghost sm" data-action="add-exp">${icon("plus", 15)} Ajouter une dépense</button>
    <p class="muted small">Les frais de kilo (transport) seront saisis à la réception du colis.</p>

    <label class="field"><span>Note <em>(facultatif)</em></span><textarea class="input" name="note" rows="2">${esc(o?.note || "")}</textarea></label>

    <div class="totals-box" id="order-totals"></div>
    <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
      <button class="btn primary" type="submit">${icon("check")} ${o ? "Enregistrer" : "Passer la commande"}</button></div>
  </form>`;
}

function readOrderForm(form) {
  const lines = [...form.querySelectorAll("[data-line]")].map((r) => ({
    category: r.querySelector("[name=l_cat]").value,
    brand: r.querySelector("[name=l_brand]").value.trim(),
    name: r.querySelector("[name=l_name]").value.trim(),
    qty: Math.max(0, parseInt(r.querySelector("[name=l_qty]").value, 10) || 0),
    unitPrice: round2(num(r.querySelector("[name=l_price]").value)),
  }));
  const expenses = [...form.querySelectorAll("[data-exp]")].map((r) => ({
    type: r.querySelector("[name=e_type]").value,
    label: r.querySelector("[name=e_label]").value.trim(),
    amount: round2(num(r.querySelector("[name=e_amount]").value)),
  })).filter((e) => e.amount > 0);
  return { lines, expenses };
}

function recalcOrder(form) {
  const rows = [...form.querySelectorAll("[data-line]")];
  rows.forEach((r) => {
    const t = num(r.querySelector("[name=l_qty]").value) * num(r.querySelector("[name=l_price]").value);
    r.querySelector("[data-lt]").textContent = fm(round2(t));
  });
  const { lines, expenses } = readOrderForm(form);
  const t = orderTotals({ lines, expenses });
  form.querySelector("#order-totals").innerHTML = `
    <div><span>Articles (${fnum(sum(lines, (l) => l.qty))} u.)</span><strong>${fm(t.itemsTotal)}</strong></div>
    <div><span>Dépenses</span><strong>${fm(t.expensesTotal)}</strong></div>
    <div class="grand"><span>Total de la commande</span><strong>${fm(t.totalCost)}</strong></div>`;
}

actions["new-order"] = () => { openModal("Nouvelle commande", orderForm(), { wide: true }); recalcOrder(document.querySelector("#modal-root form")); };
actions["edit-order"] = (el) => {
  const o = state.orders.find((x) => x.id === el.dataset.id);
  if (!o) return;
  openModal("Modifier la commande " + o.ref, orderForm(o), { wide: true });
  recalcOrder(document.querySelector("#modal-root form"));
};
actions["add-line"] = (el) => { const f = el.closest("form"); f.querySelector("#lines").insertAdjacentHTML("beforeend", lineRow()); recalcOrder(f); };
actions["add-exp"] = (el) => { const f = el.closest("form"); f.querySelector("#exps").insertAdjacentHTML("beforeend", expRow()); recalcOrder(f); };
actions["remove-row"] = (el) => {
  const f = el.closest("form");
  const row = el.closest("[data-line],[data-exp]");
  if (row.hasAttribute("data-line") && f.querySelectorAll("[data-line]").length === 1) return toast("Une commande doit avoir au moins un article.", "error");
  row.remove(); recalcOrder(f);
};
inputs.orderCalc = (el) => recalcOrder(el.closest("form"));

submits.saveOrder = async (form) => {
  const d = formData(form);
  const { lines, expenses } = readOrderForm(form);
  if (lines.some((l) => !l.name || l.qty <= 0)) return toast("Chaque article doit avoir un modèle et une quantité.", "error");
  const totals = orderTotals({ lines, expenses });
  const payload = {
    ref: d.ref, supplier: d.supplier, note: d.note, orderDate: Timestamp.fromDate(fromInputDate(d.orderDate)),
    lines, expenses, totals, updatedAt: serverTimestamp(),
  };
  const notice = { ref: d.ref, items: lines.map(({ category, brand, name, qty }) => ({ category, brand, name, qty })) };
  const batch = writeBatch(db);
  try {
    if (d.id) {
      batch.update(doc(db, "orders", d.id), payload);
      batch.update(doc(db, "orderNotices", d.id), notice);
    } else {
      const ref = doc(collection(db, "orders"));
      batch.set(ref, { ...payload, status: "pending", freight: null, createdAt: serverTimestamp(), createdBy: state.me.uid, createdByName: state.me.name });
      batch.set(doc(db, "orderNotices", ref.id), { ...notice, status: "pending", arrived: false, createdAt: serverTimestamp() });
    }
    await busy(form.querySelector("[type=submit]"), () => batch.commit());
    toast(d.id ? "Commande modifiée ✓" : "Commande enregistrée ✓", "success");
    closeModal();
  } catch (e) { toast(friendlyError(e), "error"); }
};

// ============================================================
//  Détail d'une commande
// ============================================================
actions["order-detail"] = (el) => openOrderDetail(el.dataset.id);

function openOrderDetail(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const t = o.totals || orderTotals(o);
  const n = noticeOf(o);
  const lots = state.products.filter((p) => p.orderId === o.id);
  const sold = state.sales.filter((s) => s.orderId === o.id && s.status !== "cancelled");
  const revenue = sum(sold, (s) => s.total);
  const cogs = sum(sold, (s) => num(state.costs[s.productId]?.unitCost) * num(s.qty));
  const stockCost = sum(lots, (p) => num(p.qty) * num(state.costs[p.id]?.unitCost));
  const unitsBought = sum(o.lines || [], (l) => l.qty);
  const unitsSold = sum(sold, (s) => s.qty);
  const recovered = round2(revenue - t.totalCost);

  openModal(`Commande ${o.ref}`, `
    <div class="detail-grid">
      <div><span class="muted">Statut</span>${statusOf(o)}</div>
      <div><span class="muted">Date</span><strong>${fmtDate(o.orderDate || o.createdAt)}</strong></div>
      <div><span class="muted">Fournisseur</span><strong>${esc(o.supplier || "—")}</strong></div>
      <div><span class="muted">Créée par</span><strong>${esc(o.createdByName || "—")}</strong></div>
    </div>
    ${o.status === "pending" && n?.arrived ? `<div class="alert info">${icon("truck")}<span><strong>Colis arrivé</strong> — signalé par ${esc(n.arrivedByName || "l'employé")} le ${fmtDateTime(n.arrivedAt)}${n.note ? ` · « ${esc(n.note)} »` : ""}</span></div>` : ""}
    ${o.note ? `<p class="muted">${esc(o.note)}</p>` : ""}

    <h4>Articles</h4>
    <table class="table compact"><thead><tr><th>Produit</th><th class="num">Qté</th><th class="num">Prix unit.</th><th class="num">Total</th>${o.status === "received" ? '<th class="num">Coût de revient</th><th class="num">Prix de vente</th>' : ""}</tr></thead><tbody>
      ${(o.lines || []).map((l) => `<tr><td>${esc(l.brand)} ${esc(l.name)} <span class="muted small">${esc(catLabel(l.category))}</span></td>
        <td class="num">${l.qty}</td><td class="num">${fm(l.unitPrice)}</td><td class="num">${fm(l.qty * l.unitPrice)}</td>
        ${o.status === "received" ? `<td class="num">${fm(l.landedUnitCost)}</td><td class="num">${fm(l.sellPrice)}</td>` : ""}</tr>`).join("")}</tbody></table>

    <h4>Dépenses</h4>
    ${(o.expenses || []).length || t.freightTotal ? `<table class="table compact"><tbody>
      ${(o.expenses || []).map((e) => `<tr><td>${esc(expLabel(e.type))}${e.label ? " — " + esc(e.label) : ""}</td><td class="num">${fm(e.amount)}</td></tr>`).join("")}
      ${t.freightTotal ? `<tr><td>Frais de kilo (transport)${o.freight?.weightKg ? ` — ${fnum(o.freight.weightKg)} kg × ${fm(o.freight.pricePerKg)}` : ""}</td><td class="num">${fm(t.freightTotal)}</td></tr>` : ""}
      </tbody></table>` : `<p class="muted">Aucune dépense enregistrée.</p>`}

    <div class="totals-box">
      <div><span>Articles</span><strong>${fm(t.itemsTotal)}</strong></div>
      <div><span>Dépenses + transport</span><strong>${fm(t.expensesTotal + t.freightTotal)}</strong></div>
      <div class="grand"><span>Coût total</span><strong>${fm(t.totalCost)}</strong></div>
    </div>

    ${o.status === "received" ? `
      <h4>Rentabilité de cette commande</h4>
      <div class="detail-grid">
        <div><span class="muted">Vendu</span><strong>${fnum(unitsSold)} / ${fnum(unitsBought)} u.</strong></div>
        <div><span class="muted">Chiffre d'affaires</span><strong>${fm(revenue)}</strong></div>
        <div><span class="muted">Bénéfice réalisé</span><strong class="${revenue - cogs < 0 ? "neg" : "pos"}">${fm(round2(revenue - cogs))}</strong></div>
        <div><span class="muted">Stock restant (au coût)</span><strong>${fm(stockCost)}</strong></div>
        <div><span class="muted">Commande amortie ?</span><strong class="${recovered >= 0 ? "pos" : "neg"}">${recovered >= 0 ? "Oui, +" + fm(recovered) : "Reste " + fm(-recovered) + " à récupérer"}</strong></div>
      </div>` : ""}

    <div class="row gap wrap end top-gap">
      ${o.status === "pending" ? `
        <button class="btn danger-ghost" data-action="cancel-order" data-id="${o.id}">Annuler la commande</button>
        <button class="btn" data-action="edit-order" data-id="${o.id}">${icon("edit")} Modifier</button>
        <button class="btn primary" data-action="receive-order" data-id="${o.id}">${icon("truck")} Finaliser la réception</button>` : ""}
    </div>`, { wide: true });
}

actions["cancel-order"] = async (el) => {
  const o = state.orders.find((x) => x.id === el.dataset.id);
  if (!o || !(await confirmBox(`Annuler la commande ${o.ref} ?`, { okLabel: "Annuler la commande", danger: true }))) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", o.id), { status: "cancelled", cancelledAt: serverTimestamp() });
  batch.update(doc(db, "orderNotices", o.id), { status: "cancelled" });
  try { await batch.commit(); toast("Commande annulée.", "success"); closeModal(); } catch (e) { toast(friendlyError(e), "error"); }
};

// ============================================================
//  Finalisation à la réception (frais de kilo + entrée en stock)
// ============================================================
actions["receive-order"] = (el) => {
  const o = state.orders.find((x) => x.id === el.dataset.id);
  if (!o) return;
  const margin = num(state.shop.defaultMargin);
  const t = orderTotals(o);
  const alloc = allocateCosts(o.lines, t.expensesTotal, "value");
  openModal(`Réception — ${o.ref}`, `
    <form data-submit="saveReceive" class="form" data-order="${o.id}">
      <input type="hidden" name="id" value="${o.id}">
      <p class="muted">Vérifiez le colis, saisissez les frais de kilo : le coût de revient de chaque produit est calculé automatiquement, puis les articles entrent en stock.</p>

      <h4>Frais de kilo (transport)</h4>
      <div class="grid-3">
        <label class="field"><span>Poids (kg)</span><input class="input" type="number" name="weightKg" min="0" step="0.01" inputmode="decimal" data-input="recvCalc"></label>
        <label class="field"><span>Prix par kg</span><input class="input" type="number" name="pricePerKg" min="0" step="0.01" inputmode="decimal" data-input="recvCalc"></label>
        <label class="field"><span>Total transport</span><input class="input" type="number" name="freightTotal" min="0" step="0.01" inputmode="decimal" value="0" data-input="recvCalc"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Répartition des frais sur les produits</span>
          <select class="select" name="method" data-input="recvCalc"><option value="value">Au prorata de la valeur d'achat</option><option value="unit">Même montant par unité</option></select></label>
        <label class="field"><span>Marge par défaut (%)</span><input class="input" type="number" name="margin" min="0" step="1" value="${margin}" data-input="recvCalc"></label>
      </div>

      <h4>Produits à entrer en stock</h4>
      <table class="table compact receive-table"><thead><tr><th>Produit</th><th class="num">Qté</th><th class="num">Achat</th><th class="num">Coût de revient</th><th class="num">Prix de vente</th></tr></thead><tbody>
        ${o.lines.map((l, i) => `<tr data-rl="${i}">
          <td>${esc(l.brand)} ${esc(l.name)}</td><td class="num">${l.qty}</td><td class="num">${fm(l.unitPrice)}</td>
          <td class="num" data-landed>${fm(alloc[i].landedUnitCost)}</td>
          <td class="num"><input class="input sm-in" type="number" name="sell_${i}" min="0" step="0.01" inputmode="decimal" data-input="recvCalc" data-auto="1" value="${suggestPrice(alloc[i].landedUnitCost, margin)}"></td></tr>`).join("")}</tbody></table>
      <div class="totals-box" id="recv-totals"></div>
      <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">${icon("check")} Confirmer et entrer en stock</button></div>
    </form>`, { wide: true });
  recalcReceive(document.querySelector("#modal-root form"));
};

function recalcReceive(form, source = "") {
  const o = state.orders.find((x) => x.id === form.dataset.order);
  if (!o) return;
  if (source === "weightKg" || source === "pricePerKg") {
    const w = num(form.weightKg.value), p = num(form.pricePerKg.value);
    if (w > 0 && p > 0) form.freightTotal.value = round2(w * p);
  }
  const t0 = orderTotals(o);
  const freight = round2(num(form.freightTotal.value));
  const extra = round2(t0.expensesTotal + freight);
  const alloc = allocateCosts(o.lines, extra, form.method.value);
  const margin = num(form.margin.value);
  o.lines.forEach((l, i) => {
    const row = form.querySelector(`[data-rl="${i}"]`);
    row.querySelector("[data-landed]").textContent = fm(alloc[i].landedUnitCost);
    const inp = row.querySelector(`[name=sell_${i}]`);
    if (source === "margin" || inp.dataset.auto === "1") { inp.value = suggestPrice(alloc[i].landedUnitCost, margin); inp.dataset.auto = "1"; }
  });
  const total = round2(t0.itemsTotal + extra);
  form.querySelector("#recv-totals").innerHTML = `
    <div><span>Articles</span><strong>${fm(t0.itemsTotal)}</strong></div>
    <div><span>Dépenses de commande</span><strong>${fm(t0.expensesTotal)}</strong></div>
    <div><span>Frais de kilo</span><strong>${fm(freight)}</strong></div>
    <div class="grand"><span>Coût total de la commande</span><strong>${fm(total)}</strong></div>`;
}

inputs.recvCalc = (el) => {
  const form = el.closest("form");
  if (el.name?.startsWith("sell_")) el.dataset.auto = "0";
  recalcReceive(form, el.name === "margin" ? "margin" : el.name);
};

submits.saveReceive = async (form) => {
  const o = state.orders.find((x) => x.id === form.dataset.order);
  if (!o) return;
  const d = formData(form);
  const freightTotal = round2(num(d.freightTotal));
  const t0 = orderTotals(o);
  const alloc = allocateCosts(o.lines, round2(t0.expensesTotal + freightTotal), d.method);
  const sells = o.lines.map((_, i) => round2(num(d["sell_" + i])));
  if (sells.some((s) => !(s > 0))) return toast("Indiquez un prix de vente pour chaque produit.", "error");
  const me = state.me;
  const batch = writeBatch(db);
  const newLines = [];
  o.lines.forEach((l, i) => {
    const pref = doc(collection(db, "products"));
    batch.set(pref, {
      category: l.category, brand: l.brand, name: l.name, qty: l.qty, initialQty: l.qty, sellPrice: sells[i],
      alertQty: null, orderId: o.id, orderRef: o.ref, archived: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, "costs", pref.id), { unitCost: alloc[i].landedUnitCost, orderId: o.id });
    batch.set(doc(collection(db, "movements")), {
      type: "in", reason: "order", productId: pref.id, productName: l.name, brand: l.brand, qty: l.qty,
      refId: o.id, note: o.ref, date: serverTimestamp(), by: me.uid, byName: me.name,
    });
    newLines.push({ ...l, productId: pref.id, landedUnitCost: alloc[i].landedUnitCost, sellPrice: sells[i] });
  });
  const totals = orderTotals({ ...o, freight: { total: freightTotal } });
  batch.update(doc(db, "orders", o.id), {
    status: "received", receivedAt: serverTimestamp(), receivedBy: me.uid, lines: newLines, totals,
    freight: { weightKg: round2(num(d.weightKg)), pricePerKg: round2(num(d.pricePerKg)), total: freightTotal },
    allocationMethod: d.method, updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, "orderNotices", o.id), { status: "received" });
  try {
    await busy(form.querySelector("[type=submit]"), () => batch.commit());
    toast(`Commande ${o.ref} reçue : ${sum(o.lines, (l) => l.qty)} article(s) en stock ✓`, "success", 5000);
    closeModal();
  } catch (e) { toast(friendlyError(e), "error"); }
};

// ============================================================
//  Page "Arrivages" (employé) : signaler qu'un colis est arrivé
// ============================================================
function renderArrivals() {
  const list = state.notices.filter((n) => n.status !== "cancelled")
    .sort((a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0));
  const todo = list.filter((n) => n.status === "pending");
  const done = list.filter((n) => n.status === "received").slice(0, 10);
  const card = (n) => `
    <div class="card arrival">
      <div class="card-head"><h3>${esc(n.ref)}</h3>
        ${n.status === "received" ? chip("Reçue et en stock", "green") : n.arrived ? chip("Arrivée — en attente du propriétaire", "blue") : chip("En route", "amber")}</div>
      <ul class="plain">${(n.items || []).map((i) => `<li><strong>${i.qty}×</strong> ${esc(i.brand)} ${esc(i.name)} <span class="muted small">${esc(catLabel(i.category))}</span></li>`).join("")}</ul>
      ${n.arrived ? `<p class="muted small">Signalé par ${esc(n.arrivedByName || "—")} le ${fmtDateTime(n.arrivedAt)}${n.note ? ` · « ${esc(n.note)} »` : ""}</p>` : ""}
      ${n.status === "pending" && !n.arrived ? `<button class="btn primary" data-action="mark-arrived" data-id="${n.id}">${icon("truck")} Signaler : colis arrivé</button>` : ""}
    </div>`;
  return `
    <div class="page-head"><div><h2>Arrivages</h2><p class="muted">Colis commandés par le propriétaire</p></div></div>
    ${todo.length ? todo.map(card).join("") : empty("Aucun colis en attente.", "truck")}
    ${done.length ? `<h4 class="top-gap">Récemment reçus</h4>${done.map(card).join("")}` : ""}`;
}

actions["mark-arrived"] = (el) => {
  const n = state.notices.find((x) => x.id === el.dataset.id);
  if (!n) return;
  openModal("Colis arrivé — " + n.ref, `
    <form data-submit="saveArrived" class="form"><input type="hidden" name="id" value="${n.id}">
      <p>Vérifiez le contenu du colis, puis confirmez. Le propriétaire sera prévenu dans la messagerie.</p>
      <label class="field"><span>Remarque <em>(facultatif)</em></span><textarea class="input" name="note" rows="3" placeholder="Ex. Tout est conforme / il manque un chargeur…"></textarea></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">${icon("check")} Confirmer l'arrivée</button></div></form>`);
};

submits.saveArrived = async (form) => {
  const d = formData(form);
  const n = state.notices.find((x) => x.id === d.id);
  const me = state.me;
  try {
    await busy(form.querySelector("[type=submit]"), async () => {
      await updateDoc(doc(db, "orderNotices", d.id), {
        arrived: true, arrivedAt: serverTimestamp(), arrivedBy: me.uid, arrivedByName: me.name, note: d.note || "",
      });
      await addDoc(collection(db, "messages"), {
        type: "text", text: `📦 Colis arrivé : ${n?.ref || ""}${d.note ? " — " + d.note : ""}`,
        senderId: me.uid, senderName: me.name, createdAt: serverTimestamp(), readBy: [me.uid],
      });
    });
    toast("Arrivée signalée ✓", "success");
    closeModal();
  } catch (e) { toast(friendlyError(e), "error"); }
};

export default { id: "orders", title: "Commandes", label: "Commandes", icon: "truck", roles: ["admin"], render };
export const arrivalsPage = { id: "arrivals", title: "Arrivages", label: "Arrivages", icon: "truck", roles: ["employee"], render: renderArrivals };
