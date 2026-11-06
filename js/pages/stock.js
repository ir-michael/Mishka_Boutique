import {
  db, collection, doc, writeBatch, runTransaction, serverTimestamp, setDoc, updateDoc,
} from "../fb.js";
import { state, isAdmin, productById, unitCost } from "../store.js";
import {
  esc, fm, fnum, icon, chip, empty, openModal, closeModal, toast, formData, busy, friendlyError, confirmBox,
} from "../ui.js";
import { actions, submits, getF, rerender } from "../core.js";
import { num, round2, stockValues, suggestPrice } from "../logic.js";
import { CATEGORIES } from "../config.js";

const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || "Autre";
const catOptions = (sel) => CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.label)}</option>`).join("");
const threshold = (p) => num(p.alertQty ?? state.shop.lowStock);

function render() {
  const admin = isAdmin();
  const q = getF("stock.q").toLowerCase();
  const cat = getF("stock.cat", "all");
  const lvl = getF("stock.level", "all");
  const showArch = getF("stock.arch", "") === "1";

  const base = state.products.filter((p) => showArch || !p.archived);
  const list = base.filter((p) => {
    if (cat !== "all" && (p.category || "autre") !== cat) return false;
    if (q && !`${p.brand} ${p.name} ${p.orderRef || ""}`.toLowerCase().includes(q)) return false;
    if (lvl === "low" && !(num(p.qty) > 0 && num(p.qty) <= threshold(p))) return false;
    if (lvl === "out" && num(p.qty) > 0) return false;
    return true;
  }).sort((a, b) => `${a.brand}${a.name}`.localeCompare(`${b.brand}${b.name}`));

  const sv = stockValues(state.products, state.costs);
  const lowN = state.products.filter((p) => !p.archived && num(p.qty) <= threshold(p)).length;

  return `
    <div class="page-head"><div><h2>Stock</h2><p class="muted">${list.length} référence(s) affichée(s)</p></div>
      <div class="row gap">${admin ? `<button class="btn primary" data-action="add-product">${icon("plus")} Ajouter un produit</button>` : `<button class="btn primary" data-action="new-sale">${icon("cart")} Nouvelle vente</button>`}</div></div>

    <div class="summary-bar">
      <div><span class="muted">Articles en stock</span><strong>${fnum(sv.units)}</strong></div>
      ${admin ? `<div><span class="muted">Valeur au coût</span><strong>${fm(sv.atCost)}</strong></div>` : ""}
      <div><span class="muted">Valeur de vente</span><strong>${fm(sv.atSell)}</strong></div>
      <div><span class="muted">Stock bas / épuisé</span><strong class="${lowN ? "neg" : ""}">${lowN}</strong></div>
    </div>

    <div class="toolbar">
      <div class="search">${icon("search")}<input id="stock-q" class="input" placeholder="Rechercher marque, modèle, commande…" value="${esc(getF("stock.q"))}" data-filter="stock.q"></div>
      <select class="select" data-filter="stock.cat"><option value="all">Toutes catégories</option>
        ${CATEGORIES.map((c) => `<option value="${c.id}" ${c.id === cat ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select>
      <select class="select" data-filter="stock.level">
        ${[["all", "Tout le stock"], ["low", "Stock bas"], ["out", "Épuisés"]].map(([v, l]) => `<option value="${v}" ${v === lvl ? "selected" : ""}>${l}</option>`).join("")}</select>
      ${admin ? `<label class="check"><input type="checkbox" data-filter="stock.arch" data-check ${showArch ? "checked" : ""}> Archivés</label>` : ""}
    </div>

    <section class="card flush">
      ${list.length ? `<table class="table responsive"><thead><tr>
        <th>Produit</th><th>Catégorie</th>${admin ? "<th>Commande</th>" : ""}<th class="num">Quantité</th>
        ${admin ? '<th class="num">Coût unit.</th>' : ""}<th class="num">Prix de vente</th>${admin ? '<th class="num">Marge</th>' : ""}<th class="num">Valeur</th><th></th></tr></thead><tbody>
        ${list.map((p) => {
          const c = admin ? unitCost(p.id) : null;
          const margin = c != null && c > 0 ? ((num(p.sellPrice) - c) / c) * 100 : null;
          const qty = num(p.qty);
          const level = qty <= 0 ? chip("Épuisé", "red") : qty <= threshold(p) ? chip("Stock bas", "amber") : "";
          return `<tr class="${p.archived ? "dim" : ""}">
            <td data-label="Produit"><strong>${esc(p.brand || "")} ${esc(p.name)}</strong> ${p.archived ? chip("Archivé") : ""}</td>
            <td data-label="Catégorie">${esc(catLabel(p.category))}</td>
            ${admin ? `<td data-label="Commande">${esc(p.orderRef || "—")}</td>` : ""}
            <td data-label="Quantité" class="num"><strong>${qty}</strong> ${level}</td>
            ${admin ? `<td data-label="Coût unit." class="num">${c == null ? "—" : fm(c)}</td>` : ""}
            <td data-label="Prix de vente" class="num">${fm(p.sellPrice)}</td>
            ${admin ? `<td data-label="Marge" class="num ${margin != null && margin < 0 ? "neg" : "pos"}">${margin == null ? "—" : fnum(margin) + " %"}</td>` : ""}
            <td data-label="Valeur" class="num">${fm(qty * num(p.sellPrice))}</td>
            <td class="actions">
              ${qty > 0 && !p.archived ? `<button class="btn sm primary" data-action="new-sale" data-product="${p.id}">Vendre</button>` : ""}
              ${admin ? `<button class="icon-btn" title="Modifier" data-action="edit-product" data-id="${p.id}">${icon("edit")}</button>
                <button class="icon-btn" title="Ajuster le stock" data-action="adjust-stock" data-id="${p.id}">${icon("swap")}</button>` : ""}
            </td></tr>`;
        }).join("")}</tbody></table>` : empty("Aucun produit. " + (admin ? "Ajoutez-en ou finalisez une commande." : "Le propriétaire doit d'abord entrer des produits."), "box")}
    </section>`;
}

// ---------- Ajouter / modifier un produit (admin) ----------
function productForm(p = null) {
  const c = p ? unitCost(p.id) : null;
  return `
    <form data-submit="saveProduct" class="form">
      <input type="hidden" name="id" value="${p?.id || ""}">
      <div class="grid-2">
        <label class="field"><span>Catégorie</span><select class="select" name="category">${catOptions(p?.category || "ordinateur")}</select></label>
        <label class="field"><span>Marque</span><input class="input" name="brand" value="${esc(p?.brand || "")}" placeholder="HP, Samsung, Apple…"></label>
      </div>
      <label class="field"><span>Modèle / désignation</span><input class="input" name="name" value="${esc(p?.name || "")}" placeholder="Ex. EliteBook 840 G5 i5 8Go" required></label>
      <div class="grid-3">
        ${p ? "" : `<label class="field"><span>Quantité</span><input class="input" type="number" name="qty" min="0" step="1" value="1" required></label>`}
        <label class="field"><span>Coût d'achat unitaire</span><input class="input" type="number" name="cost" min="0" step="0.01" inputmode="decimal" value="${c ?? ""}" required></label>
        <label class="field"><span>Prix de vente</span><input class="input" type="number" name="sellPrice" min="0" step="0.01" inputmode="decimal" value="${p?.sellPrice ?? ""}" required></label>
        <label class="field"><span>Alerte stock bas</span><input class="input" type="number" name="alertQty" min="0" step="1" value="${p?.alertQty ?? ""}" placeholder="${state.shop.lowStock}"></label>
      </div>
      <div class="row end gap">
        ${p ? `<button type="button" class="btn ghost" data-action="toggle-archive" data-id="${p.id}">${p.archived ? "Désarchiver" : "Archiver"}</button>` : ""}
        <button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">${icon("check")} Enregistrer</button></div>
    </form>`;
}

actions["add-product"] = () => openModal("Ajouter un produit", productForm());
actions["edit-product"] = (el) => openModal("Modifier le produit", productForm(productById(el.dataset.id)));

submits.saveProduct = async (form) => {
  const d = formData(form);
  const batch = writeBatch(db);
  const base = {
    category: d.category, brand: d.brand, name: d.name, sellPrice: round2(num(d.sellPrice)),
    alertQty: d.alertQty === "" ? null : Math.max(0, parseInt(d.alertQty, 10) || 0), updatedAt: serverTimestamp(),
  };
  const cost = round2(num(d.cost));
  try {
    if (d.id) {
      batch.update(doc(db, "products", d.id), base);
      batch.set(doc(db, "costs", d.id), { unitCost: cost }, { merge: true });
    } else {
      const ref = doc(collection(db, "products"));
      const qty = Math.max(0, parseInt(d.qty, 10) || 0);
      batch.set(ref, { ...base, qty, initialQty: qty, orderId: null, orderRef: "Ajout manuel", archived: false, createdAt: serverTimestamp() });
      batch.set(doc(db, "costs", ref.id), { unitCost: cost, orderId: null });
      if (qty > 0) batch.set(doc(collection(db, "movements")), {
        type: "in", reason: "initial", productId: ref.id, productName: d.name, brand: d.brand, qty,
        refId: ref.id, date: serverTimestamp(), by: state.me.uid, byName: state.me.name,
      });
    }
    await busy(form.querySelector("[type=submit]"), () => batch.commit());
    toast("Produit enregistré ✓", "success");
    closeModal();
  } catch (e) { toast(friendlyError(e), "error"); }
};

actions["toggle-archive"] = async (el) => {
  const p = productById(el.dataset.id);
  if (!p) return;
  try {
    await updateDoc(doc(db, "products", p.id), { archived: !p.archived, updatedAt: serverTimestamp() });
    toast(p.archived ? "Produit désarchivé." : "Produit archivé.", "success");
    closeModal();
  } catch (e) { toast(friendlyError(e), "error"); }
};

// ---------- Ajustement de stock (inventaire, casse, perte…) ----------
actions["adjust-stock"] = (el) => {
  const p = productById(el.dataset.id);
  if (!p) return;
  openModal("Ajuster le stock", `
    <form data-submit="saveAdjust" class="form">
      <input type="hidden" name="id" value="${p.id}">
      <p><strong>${esc(p.brand || "")} ${esc(p.name)}</strong><br><span class="muted">Stock actuel :</span> <strong>${p.qty}</strong></p>
      <div class="grid-2">
        <label class="field"><span>Opération</span><select class="select" name="mode">
          <option value="add">Ajouter au stock</option><option value="remove">Retirer du stock</option><option value="set">Fixer la quantité à…</option></select></label>
        <label class="field"><span>Quantité</span><input class="input" type="number" name="qty" min="0" step="1" required></label>
      </div>
      <label class="field"><span>Motif</span><select class="select" name="reason">
        <option>Inventaire / correction</option><option>Casse / défectueux</option><option>Perte / vol</option><option>Retour fournisseur</option><option>Usage personnel</option><option>Autre</option></select></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">${icon("check")} Appliquer</button></div>
    </form>`);
};

submits.saveAdjust = async (form) => {
  const d = formData(form);
  const ref = doc(db, "products", d.id);
  const n = Math.max(0, parseInt(d.qty, 10) || 0);
  try {
    await busy(form.querySelector("[type=submit]"), () => runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const cur = num(snap.data().qty);
      const next = d.mode === "add" ? cur + n : d.mode === "remove" ? cur - n : n;
      if (next < 0) throw new Error("Le stock ne peut pas être négatif.");
      const delta = next - cur;
      if (delta === 0) throw new Error("Aucun changement.");
      tx.update(ref, { qty: next, updatedAt: serverTimestamp() });
      tx.set(doc(collection(db, "movements")), {
        type: delta > 0 ? "in" : "out", reason: "adjustment", note: d.reason,
        productId: d.id, productName: snap.data().name, brand: snap.data().brand || "", qty: Math.abs(delta),
        refId: d.id, date: serverTimestamp(), by: state.me.uid, byName: state.me.name,
      });
    }));
    toast("Stock ajusté ✓", "success");
    closeModal();
  } catch (e) { toast(friendlyError(e), "error"); }
};

export default {
  id: "stock", title: "Stock", label: "Stock", icon: "box", roles: ["admin", "employee"], render,
};
