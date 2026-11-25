import {
  db, collection, doc, runTransaction, serverTimestamp, Timestamp,
} from "../fb.js";
import { state, isAdmin, productById } from "../store.js";
import {
  esc, fm, fmtDateTime, icon, chip, empty, openModal, closeModal,
  confirmBox, toast, formData, busy, friendlyError, toInputDate,
} from "../ui.js";
import { actions, submits, getF, periodSelect, rerender } from "../core.js";
import { num, round2, paymentStatus, remaining, inPeriod } from "../logic.js";
import { CATEGORIES } from "../config.js";

const statusLabel = (status) => {
  if (status === "pending") return chip("En opération", "amber");
  if (status === "sold") return chip("Vente conclue", "green");
  if (status === "failed") return chip("Sans vente", "gray");
  return chip(status || "Inconnu", "gray");
};

function render() {
  const period = getF("operations.period", "month");
  const status = getF("operations.status", "all");
  const list = state.operations.filter((operation) => {
    if (!inPeriod(operation.createdAt, period)) return false;
    return status === "all" || operation.status === status;
  });
  return `
    <div class="page-head"><div><h2>Opérations</h2><p class="muted">Articles confiés aux commissionnaires</p></div>
      <button class="btn primary" data-action="new-operation">${icon("plus")} Nouvelle opération</button></div>
    <div class="toolbar">${periodSelect("operations.period", "month")}
      <select class="select" data-filter="operations.status">
        ${[["all", "Tous les statuts"], ["pending", "En opération"], ["sold", "Ventes conclues"], ["failed", "Sans vente"]].map(([value, label]) =>
          `<option value="${value}" ${value === status ? "selected" : ""}>${label}</option>`).join("")}
      </select></div>
    <section class="card flush">${list.length ? `<table class="table responsive"><thead><tr><th>Date</th><th>Commissionnaire</th><th>Produit</th><th class="num">Qté</th><th>Statut</th><th></th></tr></thead><tbody>
      ${list.map((operation) => `<tr>
        <td data-label="Date">${fmtDateTime(operation.createdAt)}</td>
        <td data-label="Commissionnaire"><strong>${esc(operation.operatorName)}</strong><div class="muted small">${esc(operation.operatorPhone || "—")}</div></td>
        <td data-label="Produit">${esc(operation.brand || "")} ${esc(operation.productName)}</td>
        <td data-label="Qté" class="num">${operation.qty}</td>
        <td data-label="Statut">${statusLabel(operation.status)}</td>
        <td class="actions">${operation.status === "pending" && isAdmin() ? `<button class="btn sm primary" data-action="conclude-operation" data-id="${esc(operation.id)}">Conclure</button>
          <button class="btn sm ghost" data-action="fail-operation" data-id="${esc(operation.id)}">Sans vente</button>` : operation.status === "pending" ? chip("En attente de validation", "amber") : operation.saleId ? `<a class="btn sm ghost" href="#/sales">Voir la vente</a>` : ""}</td>
      </tr>`).join("")}</tbody></table>` : empty("Aucune opération pour cette période.", "swap")}</section>`;
}

function operationOptions() {
  return state.products.filter((product) => !product.archived && num(product.qty) > 0)
    .sort((a, b) => `${a.brand}${a.name}`.localeCompare(`${b.brand}${b.name}`))
    .map((product) => `<option value="${esc(product.id)}">${esc(product.brand || "")} ${esc(product.name)} — ${product.qty} en stock</option>`).join("");
}

actions["new-operation"] = () => openModal("Nouvelle opération", `
  <form data-submit="saveOperation" class="form">
    <div class="grid-2">
      <label class="field"><span>Nom du commissionnaire</span><input class="input" name="operatorName" required></label>
      <label class="field"><span>Numéro de téléphone</span><input class="input" name="operatorPhone" type="tel" required></label>
    </div>
    <label class="field"><span>Produit confié</span><select class="select" name="productId" required><option value="">Choisir un produit</option>${operationOptions()}</select></label>
    <label class="field"><span>Nombre d'articles</span><input class="input" type="number" name="qty" min="1" step="1" value="1" required></label>
    <label class="field"><span>Note <em>(facultatif)</em></span><input class="input" name="note"></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
      <button class="btn primary" type="submit">Enregistrer l'opération</button></div>
  </form>`);

submits.saveOperation = async (form) => {
  const d = formData(form);
  const qty = parseInt(d.qty, 10);
  const product = productById(d.productId);
  if (!product) return toast("Choisissez un produit.", "error");
  if (!(qty > 0) || qty > num(product.qty)) return toast(`Stock insuffisant (${product.qty} disponible).`, "error");
  const me = state.me;
  const operationRef = doc(collection(db, "operations"));
  const movementRef = doc(collection(db, "movements"));
  const productRef = doc(db, "products", product.id);
  try {
    await busy(form.querySelector("[type=submit]"), () => runTransaction(db, async (tx) => {
      const snap = await tx.get(productRef);
      const current = snap.data();
      if (!current || num(current.qty) < qty) throw new Error("Stock insuffisant.");
      tx.update(productRef, { qty: num(current.qty) - qty, updatedAt: serverTimestamp() });
      tx.set(operationRef, {
        operatorName: d.operatorName, operatorPhone: d.operatorPhone, note: d.note || "",
        productId: product.id, productName: product.name, brand: product.brand || "", category: product.category || "autre",
        qty, status: "pending", saleId: null, createdBy: me.uid, createdByName: me.name,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      tx.set(movementRef, {
        type: "out", reason: "operation", refId: operationRef.id,
        productId: product.id, productName: product.name, brand: product.brand || "", qty,
        note: `À ${d.operatorName}`, date: serverTimestamp(), by: me.uid, byName: me.name,
      });
    }));
    toast("Opération enregistrée. Les articles sont réservés.", "success");
    closeModal();
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

actions["fail-operation"] = async (el) => {
  const operation = state.operations.find((item) => item.id === el.dataset.id);
  if (!operation || operation.status !== "pending") return;
  if (!(await confirmBox(`Confirmer que cette opération n'a donné aucune vente ? ${operation.qty} article(s) seront remis au stock.`, { okLabel: "Sans vente", danger: true }))) return;
  const operationRef = doc(db, "operations", operation.id);
  const productRef = doc(db, "products", operation.productId);
  const movementRef = doc(collection(db, "movements"));
  try {
    await runTransaction(db, async (tx) => {
      const [operationSnap, productSnap] = await Promise.all([tx.get(operationRef), tx.get(productRef)]);
      if (!operationSnap.exists() || operationSnap.data().status !== "pending") throw new Error("Cette opération n'est plus en attente.");
      const product = productSnap.exists() ? productSnap.data() : null;
      tx.update(operationRef, { status: "failed", failedAt: serverTimestamp(), failedBy: state.me.uid, failedByName: state.me.name, updatedAt: serverTimestamp() });
      if (product) tx.update(productRef, { qty: num(product.qty) + operation.qty, updatedAt: serverTimestamp() });
      tx.set(movementRef, {
        type: "in", reason: "operation_return", refId: operation.id,
        productId: operation.productId, productName: operation.productName, brand: operation.brand || "", qty: operation.qty,
        note: `Retour de ${operation.operatorName}`, date: serverTimestamp(), by: state.me.uid, byName: state.me.name,
      });
    });
    toast("Opération terminée sans vente. Stock remis.", "success");
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

actions["conclude-operation"] = (el) => {
  const operation = state.operations.find((item) => item.id === el.dataset.id);
  if (!operation || operation.status !== "pending") return;
  openModal("Conclure l'opération", `
    <form data-submit="completeOperation" class="form">
      <input type="hidden" name="id" value="${esc(operation.id)}">
      <p><strong>${esc(operation.operatorName)}</strong> — ${esc(operation.brand || "")} ${esc(operation.productName)} × ${operation.qty}</p>
      <div class="grid-2">
        <label class="field"><span>Prix unitaire</span><input class="input" type="number" name="unitPrice" min="0" step="0.01" value="${esc(productById(operation.productId)?.sellPrice ?? "")}" required></label>
        <label class="field"><span>Montant payé</span><input class="input" type="number" name="paid" min="0" step="0.01" value="0" required></label>
      </div>
      <label class="field"><span>Acheteur <em>(facultatif)</em></span><input class="input" name="buyerName" value="${esc(operation.operatorName)}"></label>
      <label class="field"><span>Téléphone <em>(facultatif)</em></span><input class="input" name="buyerPhone" type="tel" value="${esc(operation.operatorPhone)}"></label>
      <label class="field"><span>Date pour solder le reste <em>(si crédit)</em></span><input class="input" type="date" name="dueDate" value="${toInputDate(new Date(Date.now() + 7 * 86400000))}" min="${toInputDate()}"></label>
      <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button>
        <button class="btn primary" type="submit">Créer la vente</button></div>
    </form>`);
};

submits.completeOperation = async (form) => {
  const d = formData(form);
  const operation = state.operations.find((item) => item.id === d.id);
  if (!operation || operation.status !== "pending") return toast("Cette opération n'est plus en attente.", "error");
  const qty = num(operation.qty);
  const unitPrice = round2(num(d.unitPrice));
  const paid = round2(num(d.paid));
  const total = round2(qty * unitPrice);
  if (!(unitPrice >= 0) || !(paid >= 0) || paid > total) return toast("Vérifiez les montants de vente.", "error");
  const rest = remaining(total, paid);
  if (rest > 0 && !d.dueDate) return toast("Indiquez une date pour solder le reste.", "error");
  const me = state.me;
  const saleId = doc(collection(db, "sales")).id;
  const saleRef = doc(db, "sales", saleId);
  const operationRef = doc(db, "operations", operation.id);
  try {
    await busy(form.querySelector("[type=submit]"), () => runTransaction(db, async (tx) => {
      const snap = await tx.get(operationRef);
      if (!snap.exists() || snap.data().status !== "pending") throw new Error("Cette opération n'est plus en attente.");
      tx.set(saleRef, {
        productId: operation.productId, productName: operation.productName, brand: operation.brand || "", category: operation.category || "autre",
        orderId: null, qty, unitPrice, total, buyerName: d.buyerName || "", buyerPhone: d.buyerPhone || "",
        paid, remaining: rest, status: paymentStatus(total, paid),
        dueDate: rest > 0 ? Timestamp.fromDate(new Date(d.dueDate + "T12:00:00")) : null,
        payments: paid > 0 ? [{ amount: paid, date: Timestamp.now(), by: me.uid, byName: me.name }] : [],
        createdBy: me.uid, createdByName: me.name, date: serverTimestamp(),
        operationId: operation.id, operatorName: operation.operatorName,
      });
      tx.update(operationRef, { status: "sold", saleId, concludedAt: serverTimestamp(), concludedBy: me.uid, concludedByName: me.name, updatedAt: serverTimestamp() });
    }));
    closeModal();
    rerender();
    toast("Opération conclue : vente créée automatiquement.", "success", 6000);
  } catch (error) { toast(friendlyError(error), "error", 5000); }
};

export default { id: "operations", title: "Opérations", label: "Opérations", labelEmployee: "Opérations", icon: "swap", roles: ["admin", "employee"], render };