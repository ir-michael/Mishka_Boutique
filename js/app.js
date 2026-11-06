// Point d'entrée : authentification, première utilisation, routage, événements globaux.
import {
  configured, auth, db, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  createUserWithEmailAndPassword, sendPasswordResetEmail, doc, getDoc, onSnapshot, writeBatch,
  updateDoc, serverTimestamp,
} from "./fb.js";
import { state, startStore, stopStore, onData, onNewMessage, DEFAULT_SHOP, unreadCount } from "./store.js";
import { actions, submits, inputs, setRender, setF, getF } from "./core.js";
import {
  esc, icon, toast, closeModal, modalOpen, formData, busy, friendlyError, confirmBox,
} from "./ui.js";
import { CATEGORIES } from "./config.js";

import dashboard from "./pages/dashboard.js";
import sales, { pendingSalesCount } from "./pages/sales.js";
import stock from "./pages/stock.js";
import orders, { arrivalsPage } from "./pages/orders.js";
import debts from "./pages/debts.js";
import movements from "./pages/movements.js";
import expenses from "./pages/expenses.js";
import reports from "./pages/reports.js";
import chat, { chatState } from "./pages/chat.js";
import settings from "./pages/settings.js";

const PAGES = [dashboard, sales, stock, orders, arrivalsPage, debts, movements, expenses, reports, chat, settings];
const CURRENCIES = ["USD", "CDF", "EUR", "XAF", "XOF", "RWF", "UGX", "KES", "TZS", "ZAR", "GBP", "CAD", "MAD", "NGN", "GHS"];
const root = document.getElementById("root");

let shellReady = false;
let profileUnsub = null;
let settingUp = false;
let missingTimer = null;
let started = null;       // uid pour lequel le store est démarré

// ============================================================
//  Écrans hors application (chargement, connexion, première utilisation…)
// ============================================================
const authCard = (inner) => `
  <div class="auth-screen"><div class="auth-card">
    <div class="auth-brand"><div class="logo">${icon("box", 26)}</div><h1>Gestion Boutique</h1><p class="muted">Ventes · Stock · Commandes · Messagerie</p></div>
    ${inner}</div></div>`;

function showSplash(text = "Chargement…") {
  shellReady = false;
  root.innerHTML = `<div class="splash"><div class="spin dark big"></div><p class="muted">${esc(text)}</p></div>`;
}

function showNotConfigured() {
  root.innerHTML = authCard(`
    <div class="notice warn"><strong>Firebase n'est pas encore configuré.</strong>
      <p>Ouvrez le fichier <code>js/config.js</code> et collez les identifiants de votre projet Firebase.
      Le pas-à-pas complet est dans <code>README.md</code> (section « Mise en route »).</p></div>`);
}

async function showLogin() {
  shellReady = false;
  let first = false;
  root.innerHTML = authCard(`<div class="center pad"><span class="spin dark"></span></div>`);
  try { first = !(await getDoc(doc(db, "meta", "setup"))).exists(); } catch { first = false; }
  root.innerHTML = authCard(first ? setupForm() : loginForm());
  root.querySelector("input")?.focus();
}

const loginForm = () => `
  <form data-submit="login" class="form" autocomplete="on">
    <label class="field"><span>Adresse email</span><input class="input" type="email" name="email" required autocomplete="username" inputmode="email"></label>
    <label class="field"><span>Mot de passe</span><input class="input" type="password" name="password" required autocomplete="current-password"></label>
    <div id="auth-error" class="form-error" hidden></div>
    <button class="btn primary block" type="submit">Se connecter</button>
    <button class="btn link-btn" type="button" data-action="forgot">Mot de passe oublié ?</button>
  </form>`;

const setupForm = () => `
  <div class="notice info"><strong>Première utilisation.</strong> Créez le compte administrateur (propriétaire). Vous créerez ensuite le compte de votre employé depuis les Paramètres.</div>
  <form data-submit="setup" class="form" autocomplete="off">
    <label class="field"><span>Nom de la boutique</span><input class="input" name="shop" required placeholder="Ex. Tech Store"></label>
    <div class="grid-2">
      <label class="field"><span>Votre nom</span><input class="input" name="name" required></label>
      <label class="field"><span>Devise</span><select class="select" name="currency">${CURRENCIES.map((c) => `<option>${c}</option>`).join("")}</select></label>
    </div>
    <label class="field"><span>Adresse email</span><input class="input" type="email" name="email" required autocomplete="username"></label>
    <label class="field"><span>Mot de passe (6 caractères minimum)</span><input class="input" type="password" name="password" minlength="6" required autocomplete="new-password"></label>
    <div id="auth-error" class="form-error" hidden></div>
    <button class="btn primary block" type="submit">Créer la boutique</button>
  </form>`;

function authError(msg) {
  const el = document.getElementById("auth-error");
  if (!el) return toast(msg, "error");
  el.textContent = msg; el.hidden = !msg;
}

submits.login = async (form) => {
  const d = formData(form);
  authError("");
  try { await busy(form.querySelector("[type=submit]"), () => signInWithEmailAndPassword(auth, d.email, d.password)); }
  catch (e) { authError(friendlyError(e)); }
};

actions.forgot = async (el) => {
  const email = el.closest("form").email.value.trim();
  if (!email) return authError("Saisissez d'abord votre adresse email ci-dessus.");
  try { await sendPasswordResetEmail(auth, email); authError(""); toast("Email de réinitialisation envoyé (vérifiez les courriers indésirables).", "success", 6000); }
  catch (e) { authError(friendlyError(e)); }
};

submits.setup = async (form) => {
  const d = formData(form);
  authError("");
  settingUp = true;
  try {
    await busy(form.querySelector("[type=submit]"), async () => {
      const cred = await createUserWithEmailAndPassword(auth, d.email, d.password);
      const batch = writeBatch(db);
      batch.set(doc(db, "users", cred.user.uid), {
        name: d.name, email: d.email.toLowerCase(), role: "admin", active: true, createdAt: serverTimestamp(),
      });
      batch.set(doc(db, "settings", "shop"), { ...DEFAULT_SHOP, name: d.shop, currency: d.currency, createdAt: serverTimestamp() });
      batch.set(doc(db, "meta", "setup"), { done: true, at: serverTimestamp(), by: cred.user.uid });
      await batch.commit();
    });
  } catch (e) {
    settingUp = false;
    const denied = e?.code === "permission-denied";
    authError(denied ? "Cette boutique est déjà configurée. Connectez-vous avec le compte existant." : friendlyError(e));
    if (denied) { try { await signOut(auth); } catch {} }
  }
  settingUp = false;
};

function showBlocked(title, text) {
  shellReady = false;
  root.innerHTML = authCard(`<div class="notice warn"><strong>${esc(title)}</strong><p>${esc(text)}</p></div>
    <button class="btn block" data-action="logout">Se déconnecter</button>`);
}

// ============================================================
//  Profil utilisateur → démarrage de l'application
// ============================================================
function watchProfile(user) {
  profileUnsub?.();
  clearTimeout(missingTimer);
  showSplash();
  profileUnsub = onSnapshot(doc(db, "users", user.uid), (snap) => {
    clearTimeout(missingTimer);
    if (!snap.exists()) {
      // Après la création du compte administrateur, le profil arrive quelques instants plus tard
      missingTimer = setTimeout(() => {
        if (!settingUp) showBlocked("Profil introuvable", "Ce compte existe mais n'est lié à aucune boutique. Contactez le propriétaire.");
      }, settingUp ? 15000 : 4000);
      return;
    }
    const p = snap.data();
    if (p.active === false) { stopStore(); started = null; showBlocked("Accès désactivé", "Votre accès a été désactivé par le propriétaire."); return; }
    const me = { uid: user.uid, email: user.email, name: p.name, role: p.role, active: true };
    if (started !== user.uid || state.me?.role !== me.role) {
      started = user.uid;
      startStore(me);
      showShell();
    } else {
      state.me = me;
      paintChrome();
    }
  }, (err) => {
    console.error(err);
    showBlocked("Connexion impossible", friendlyError(err));
  });
}

function boot() {
  if (!configured) return showNotConfigured();
  showSplash();
  onAuthStateChanged(auth, (user) => {
    profileUnsub?.(); profileUnsub = null; started = null;
    if (!user) { stopStore(); stopPresence(); return showLogin(); }
    watchProfile(user);
    startPresence();
  });
}

// ============================================================
//  Coque de l'application (menu, barre du haut, zone de contenu)
// ============================================================
const pagesFor = () => PAGES.filter((p) => p.roles.includes(state.me.role));
const pageLabel = (p) => (state.me.role === "employee" && p.labelEmployee) || p.label;
const currentId = () => (location.hash.replace(/^#\/?/, "").split("?")[0]) || "dashboard";
const currentPage = () => pagesFor().find((p) => p.id === currentId()) || pagesFor()[0];

function showShell() {
  const nav = pagesFor();
  const primary = ["dashboard", "sales", "stock", "chat"].filter((id) => nav.some((p) => p.id === id));
  root.innerHTML = `
    <div class="app">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><div class="logo">${icon("box", 22)}</div><div><strong id="shop-name"></strong><span class="muted small">${state.me.role === "admin" ? "Administrateur" : "Employé"}</span></div></div>
        <nav class="nav">${nav.map((p) => `<a href="#/${p.id}" data-nav="${p.id}">${icon(p.icon, 19)}<span>${esc(pageLabel(p))}</span><i class="badge" data-badge="${p.id}" hidden></i></a>`).join("")}</nav>
        <div class="side-foot"><div class="who-am-i"><div class="avatar">${esc((state.me.name || "?")[0].toUpperCase())}</div>
          <div><strong>${esc(state.me.name)}</strong><span class="muted small">${esc(state.me.email || "")}</span></div></div>
          <button class="btn ghost sm block" data-action="logout">${icon("logout", 16)} Déconnexion</button></div>
      </aside>
      <div class="scrim" data-action="close-menu"></div>
      <div class="main">
        <header class="topbar">
          <button class="icon-btn menu-btn" data-action="toggle-menu" aria-label="Menu">${icon("menu", 22)}</button>
          <h1 id="page-title"></h1>
          <span class="pill offline" id="offline-pill" hidden>${icon("alert", 14)} Hors ligne</span>
          <button class="btn sm primary" id="sync-sales" data-action="sync-sales" type="button" hidden></button>
          <button class="icon-btn" id="notif-btn" data-action="enable-notif" title="Activer les notifications" hidden aria-label="Activer les notifications">${icon("chat", 20)}</button>
        </header>
        <main id="view" class="view"></main>
      </div>
      <nav class="bottom-nav">${primary.map((id) => { const p = nav.find((x) => x.id === id); return `<a href="#/${p.id}" data-nav="${p.id}">${icon(p.icon, 22)}<span>${esc(pageLabel(p))}</span><i class="badge" data-badge="${p.id}" hidden></i></a>`; }).join("")}
        <button data-action="toggle-menu">${icon("menu", 22)}<span>Plus</span></button></nav>
    </div>`;
  shellReady = true;
  if (!location.hash) location.hash = "#/dashboard";
  paintChrome();
  renderPage(true);
  updateOnline();
  syncNotifButton();
}

/** Met à jour tout ce qui entoure la page : nom de la boutique, menu actif, pastilles. */
function paintChrome() {
  if (!shellReady) return;
  const p = currentPage();
  document.getElementById("shop-name").textContent = state.shop.name || "Ma boutique";
  document.getElementById("page-title").textContent = p.title;
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("on", a.dataset.nav === p.id));
  const unread = unreadCount();
  const counts = { chat: unread };
  if (state.me.role === "admin") counts.orders = state.notices.filter((n) => n.status === "pending" && n.arrived).length;
  document.querySelectorAll("[data-badge]").forEach((b) => {
    const n = counts[b.dataset.badge] || 0;
    b.hidden = !n; b.textContent = n > 9 ? "9+" : n;
  });
  document.title = `${unread ? `(${unread}) ` : ""}${state.shop.name || "Boutique"}`;
  updateSyncButton();
}

function updateSyncButton() {
  const button = document.getElementById("sync-sales");
  if (!button) return;
  const count = pendingSalesCount();
  button.hidden = count === 0;
  button.disabled = !navigator.onLine;
  button.textContent = navigator.onLine ? `Synchroniser (${count})` : `${count} en attente`;
}

// ---------- Rendu de la page ----------
let lastPageId = null;
function renderPage(force = false) {
  if (!shellReady) return;
  const p = currentPage();
  const view = document.getElementById("view");
  const changed = p.id !== lastPageId;
  paintChrome();
  // Messagerie : mise à jour douce (garde le brouillon, le scroll et l'enregistrement vocal)
  if (!changed && !force && p.id === "chat") { if (chatState.busy() || chatState.softUpdate()) return; }

  const act = document.activeElement;
  const keep = !changed && act && view.contains(act) && act.id ? { id: act.id, s: act.selectionStart, e: act.selectionEnd } : null;
  const scroll = window.scrollY;
  view.className = "view" + (p.fullHeight ? " full" : "");
  view.innerHTML = p.render();
  p.mount?.();
  lastPageId = p.id;
  if (changed) { window.scrollTo(0, 0); document.getElementById("sidebar")?.classList.remove("open"); document.body.classList.remove("menu-open"); }
  else window.scrollTo(0, scroll);
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch {} }
  }
}

let raf = 0;
const scheduleRender = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => renderPage()); };
setRender(() => renderPage(true));
onData(scheduleRender);
window.addEventListener("hashchange", () => { lastPageId = null; renderPage(true); });

// ============================================================
//  Événements globaux (délégation)
// ============================================================
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const name = el.dataset.action;
  if (name === "backdrop") { if (e.target === el && !el.classList.contains("top")) closeModal(); return; }
  const fn = actions[name];
  if (!fn) return;
  if (el.tagName === "A" && !el.getAttribute("href")) e.preventDefault();
  Promise.resolve(fn(el, e)).catch((err) => { console.error(err); toast(friendlyError(err), "error"); });
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-submit]");
  if (!form) return;
  e.preventDefault();
  const fn = submits[form.dataset.submit];
  if (fn) Promise.resolve(fn(form, e)).catch((err) => { console.error(err); toast(friendlyError(err), "error"); });
});

function onField(e) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  // fichiers : événement "change" ; tout le reste : "input"
  const isFile = t.type === "file";
  if ((e.type === "change") !== isFile) return;

  const f = t.closest("[data-filter]");
  if (f) { setF(f.dataset.filter, f.hasAttribute("data-check") ? (f.checked ? "1" : "") : f.value); renderPage(true); return; }
  const i = t.closest("[data-input]");
  if (i && inputs[i.dataset.input]) inputs[i.dataset.input](i, e);
}
document.addEventListener("input", onField);
document.addEventListener("change", onField);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalOpen()) closeModal();
});

// ---------- Actions du coque ----------
actions["set-filter"] = (el) => { setF(el.dataset.key, el.dataset.value); renderPage(true); };
actions["close-modal"] = () => closeModal();
actions["toggle-menu"] = () => {
  const open = document.getElementById("sidebar").classList.toggle("open");
  document.body.classList.toggle("menu-open", open);
};
actions["close-menu"] = () => { document.getElementById("sidebar")?.classList.remove("open"); document.body.classList.remove("menu-open"); };
document.addEventListener("click", (e) => { if (e.target.closest(".sidebar [data-nav]")) actions["close-menu"](); });

// ============================================================
//  Présence, connexion réseau, notifications
// ============================================================
let presenceTimer = null;
function ping() {
  if (document.hidden || !state.me || !navigator.onLine) return;
  updateDoc(doc(db, "users", state.me.uid), { lastSeen: serverTimestamp() }).catch(() => {});
}
function startPresence() { stopPresence(); presenceTimer = setInterval(ping, 60000); setTimeout(ping, 4000); }
function stopPresence() { clearInterval(presenceTimer); presenceTimer = null; }
document.addEventListener("visibilitychange", () => { if (!document.hidden) { ping(); renderPage(); } });

function updateOnline() {
  const pill = document.getElementById("offline-pill");
  if (pill) pill.hidden = navigator.onLine;
  updateSyncButton();
}
window.addEventListener("online", () => {
  updateOnline();
  toast(pendingSalesCount() ? "Connexion rétablie. Cliquez sur « Synchroniser » pour envoyer les ventes en attente." : "Connexion rétablie.", "success", 5000);
});
window.addEventListener("offline", () => {
  updateOnline();
  toast("Hors ligne : les ventes seront gardées sur cet appareil. Les autres écritures compatibles seront synchronisées au retour du réseau.", "info", 6000);
});

function syncNotifButton() {
  const b = document.getElementById("notif-btn");
  if (b) b.hidden = !("Notification" in window) || Notification.permission !== "default";
}
actions["enable-notif"] = async () => {
  if (!("Notification" in window)) return;
  const r = await Notification.requestPermission();
  syncNotifButton();
  toast(r === "granted" ? "Notifications activées ✓" : "Notifications refusées.", r === "granted" ? "success" : "info");
};

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.04; o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.12);
    setTimeout(() => ctx.close(), 400);
  } catch {}
}

onNewMessage((m) => {
  const onChat = currentId() === "chat" && !document.hidden;
  if (onChat) return;
  const body = m.type === "image" ? "📷 Photo" : m.type === "video" ? "🎥 Vidéo" : m.type === "audio" ? "🎤 Message vocal" : m.text;
  toast(`💬 ${m.senderName} : ${body}`, "info", 5000);
  beep();
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(m.senderName || "Nouveau message", { body, tag: "chat", icon: "icons/icon-192.png" }); } catch {}
  }
});

// ============================================================
//  Service worker (installation sur téléphone + démarrage rapide)
// ============================================================
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

window.__app = { state, getF }; // utile pour le débogage dans la console
boot();
