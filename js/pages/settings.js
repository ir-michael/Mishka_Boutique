import {
  auth, db, doc, setDoc, updateDoc, serverTimestamp, updatePassword, sendPasswordResetEmail,
  createAccountWithoutSwitching, signOut,
} from "../fb.js";
import { state, isAdmin } from "../store.js";
import { esc, fmtDateTime, icon, chip, openModal, closeModal, confirmBox, toast, formData, busy, friendlyError } from "../ui.js";
import { actions, submits } from "../core.js";
import { num } from "../logic.js";

const CURRENCIES = ["USD", "CDF", "EUR", "XAF", "XOF", "RWF", "UGX", "KES", "TZS", "ZAR", "GBP", "CAD", "MAD", "NGN", "GHS"];

function employeeBlock() {
  const emp = state.users.find((u) => u.role === "employee");
  if (!emp) return `
    <section class="card"><h3>Compte de l'employé</h3>
      <p class="muted">Créez l'accès de votre travailleur. Il pourra vendre, voir le stock, signaler les arrivages, saisir des dépenses et discuter avec vous — sans voir vos coûts d'achat ni vos bénéfices.</p>
      <form data-submit="createEmployee" class="form" autocomplete="off">
        <div class="grid-2">
          <label class="field"><span>Nom</span><input class="input" name="name" required></label>
          <label class="field"><span>Email de connexion</span><input class="input" type="email" name="email" required placeholder="employe@exemple.com"></label>
        </div>
        <label class="field"><span>Mot de passe (6 caractères minimum)</span><input class="input" type="text" name="password" minlength="6" required autocomplete="off"></label>
        <div class="row end"><button class="btn primary" type="submit">${icon("plus")} Créer le compte</button></div>
      </form></section>`;
  const online = emp.lastSeen && Date.now() - (emp.lastSeen.toMillis?.() ?? 0) < 3 * 60000;
  return `
    <section class="card"><div class="card-head"><h3>Compte de l'employé</h3>${emp.active === false ? chip("Désactivé", "red") : chip("Actif", "green")}</div>
      <div class="detail-grid">
        <div><span class="muted">Nom</span><strong>${esc(emp.name)}</strong></div>
        <div><span class="muted">Email</span><strong>${esc(emp.email)}</strong></div>
        <div><span class="muted">Dernière activité</span><strong>${online ? "En ligne" : fmtDateTime(emp.lastSeen)}</strong></div>
      </div>
      <div class="row gap wrap top-gap">
        <button class="btn" data-action="rename-employee" data-id="${emp.id}">${icon("edit")} Renommer</button>
        <button class="btn" data-action="reset-employee" data-email="${esc(emp.email)}">Envoyer un lien de nouveau mot de passe</button>
        <button class="btn ${emp.active === false ? "primary" : "danger-ghost"}" data-action="toggle-employee" data-id="${emp.id}">${emp.active === false ? "Réactiver l'accès" : "Désactiver l'accès"}</button>
      </div></section>`;
}

function render() {
  const admin = isAdmin();
  const s = state.shop;
  return `
    <div class="page-head"><div><h2>${admin ? "Paramètres" : "Mon compte"}</h2><p class="muted">${esc(state.me.name)} · ${admin ? "Administrateur" : "Employé"} · ${esc(state.me.email || "")}</p></div></div>

    ${admin ? `
    <section class="card"><h3>La boutique</h3>
      <form data-submit="saveShop" class="form">
        <div class="grid-2">
          <label class="field"><span>Nom de la boutique</span><input class="input" name="name" value="${esc(s.name)}" required></label>
          <label class="field"><span>Devise</span><select class="select" name="currency">${[...new Set([s.currency, ...CURRENCIES])].map((c) => `<option ${c === s.currency ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        </div>
        <div class="grid-3">
          <label class="field"><span>Marge par défaut (%)</span><input class="input" type="number" name="defaultMargin" min="0" step="1" value="${num(s.defaultMargin)}"></label>
          <label class="field"><span>Alerte stock bas (quantité)</span><input class="input" type="number" name="lowStock" min="0" step="1" value="${num(s.lowStock)}"></label>
          <label class="field"><span>Indicatif pays (WhatsApp)</span><input class="input" name="countryCode" value="${esc(s.countryCode || "243")}" placeholder="243"></label>
        </div>
        <div class="grid-2">
          <label class="field"><span>Téléphone <em>(sur les reçus)</em></span><input class="input" name="phone" value="${esc(s.phone || "")}"></label>
          <label class="field"><span>Adresse <em>(sur les reçus)</em></span><input class="input" name="address" value="${esc(s.address || "")}"></label>
        </div>
        <div class="row end"><button class="btn primary" type="submit">${icon("check")} Enregistrer</button></div>
      </form></section>
    ${employeeBlock()}` : ""}

    <section class="card"><h3>Mon mot de passe</h3>
      <form data-submit="changePassword" class="form" autocomplete="off">
        <label class="field"><span>Nouveau mot de passe (6 caractères minimum)</span><input class="input" type="password" name="password" minlength="6" required autocomplete="new-password"></label>
        <div class="row end"><button class="btn primary" type="submit">Changer le mot de passe</button></div>
      </form></section>

    ${admin ? `<section class="card"><h3>Sauvegarde des données</h3>
      <p class="muted">Téléchargez une copie complète (produits, ventes, commandes, dépenses, mouvements) au format JSON. À faire de temps en temps.</p>
      <button class="btn" data-action="backup">${icon("download")} Télécharger la sauvegarde</button></section>` : ""}

    <section class="card"><button class="btn danger-ghost" data-action="logout">${icon("logout")} Se déconnecter</button></section>`;
}

submits.saveShop = async (form) => {
  const d = formData(form);
  try {
    await busy(form.querySelector("[type=submit]"), () => setDoc(doc(db, "settings", "shop"), {
      name: d.name, currency: d.currency, defaultMargin: num(d.defaultMargin), lowStock: Math.max(0, parseInt(d.lowStock, 10) || 0),
      countryCode: d.countryCode.replace(/\D/g, ""), phone: d.phone, address: d.address, updatedAt: serverTimestamp(),
    }, { merge: true }));
    toast("Paramètres enregistrés ✓", "success");
  } catch (e) { toast(friendlyError(e), "error"); }
};

submits.createEmployee = async (form) => {
  const d = formData(form);
  const btn = form.querySelector("[type=submit]");
  let uid = null;
  try {
    await busy(btn, async () => {
      uid = await createAccountWithoutSwitching(d.email, d.password);
      await setDoc(doc(db, "users", uid), {
        name: d.name, email: d.email.toLowerCase(), role: "employee", active: true, createdAt: serverTimestamp(),
      });
    });
    toast("Compte employé créé ✓ Communiquez-lui son email et son mot de passe.", "success", 6000);
  } catch (e) {
    toast(uid ? "Compte créé mais profil non enregistré : " + friendlyError(e) : friendlyError(e), "error", 6000);
  }
};

actions["rename-employee"] = (el) => {
  const u = state.users.find((x) => x.id === el.dataset.id);
  openModal("Renommer l'employé", `<form data-submit="renameEmployee" class="form"><input type="hidden" name="id" value="${u.id}">
    <label class="field"><span>Nom</span><input class="input" name="name" value="${esc(u.name)}" required></label>
    <div class="row end gap"><button type="button" class="btn ghost" data-action="close-modal">Annuler</button><button class="btn primary" type="submit">Enregistrer</button></div></form>`);
};
submits.renameEmployee = async (form) => {
  const d = formData(form);
  try { await updateDoc(doc(db, "users", d.id), { name: d.name }); toast("Nom modifié ✓", "success"); closeModal(); } catch (e) { toast(friendlyError(e), "error"); }
};

actions["toggle-employee"] = async (el) => {
  const u = state.users.find((x) => x.id === el.dataset.id);
  const next = u.active === false;
  if (!next && !(await confirmBox(`Désactiver l'accès de ${u.name} ? Il ne pourra plus se connecter ni voir les données.`, { okLabel: "Désactiver", danger: true }))) return;
  try { await updateDoc(doc(db, "users", u.id), { active: next }); toast(next ? "Accès réactivé ✓" : "Accès désactivé.", "success"); } catch (e) { toast(friendlyError(e), "error"); }
};

actions["reset-employee"] = async (el) => {
  try { await sendPasswordResetEmail(auth, el.dataset.email); toast("Lien envoyé à " + el.dataset.email, "success"); } catch (e) { toast(friendlyError(e), "error"); }
};

submits.changePassword = async (form) => {
  const d = formData(form);
  try {
    await busy(form.querySelector("[type=submit]"), () => updatePassword(auth.currentUser, d.password));
    form.reset();
    toast("Mot de passe modifié ✓", "success");
  } catch (e) { toast(friendlyError(e), "error", 5000); }
};

actions.backup = () => {
  const data = {
    exportedAt: new Date().toISOString(), shop: state.shop, products: state.products, costs: state.costs, sales: state.sales,
    orders: state.orders, movements: state.movements, expenses: state.expenses,
  };
  const blob = new Blob([JSON.stringify(data, (k, v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v), 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `sauvegarde-boutique-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

actions.logout = () => signOut(auth);

export default { id: "settings", title: "Paramètres", label: "Paramètres", labelEmployee: "Mon compte", icon: "settings", roles: ["admin", "employee"], render };
