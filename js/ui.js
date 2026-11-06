// Utilitaires d'interface : formatage, toasts, fenêtres modales, CSV.
import { state } from "./store.js";
import { toDate, num } from "./logic.js";

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function money(n, cur = state.shop.currency) {
  const v = num(n);
  try {
    return new Intl.NumberFormat("fr-FR", { style: "currency", currency: cur, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(v);
  } catch {
    return v.toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " " + cur;
  }
}
export const fm = (n) => money(n);
export const fnum = (n) => num(n).toLocaleString("fr-FR", { maximumFractionDigits: 2 });

export const fmtDate = (x) => { const d = toDate(x); return d ? d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—"; };
export const fmtTime = (x) => { const d = toDate(x); return d ? d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""; };
export const fmtDateTime = (x) => { const d = toDate(x); return d ? `${fmtDate(d)} · ${fmtTime(d)}` : "—"; };
export const toInputDate = (x = new Date()) => {
  const d = toDate(x) || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const fromInputDate = (s) => (s ? new Date(s + "T12:00:00") : null);
export const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return d; };

// ---------- Icônes (tracé Lucide simplifié) ----------
const P = {
  home: "M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  cart: "M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20a1 1 0 1 0 0 .01M18 20a1 1 0 1 0 0 .01",
  box: "M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  truck: "M1 6h13v10H1zM14 10h4l3 3v3h-7zM6 19a2 2 0 1 0 0 .01M17 19a2 2 0 1 0 0 .01",
  wallet: "M3 7a2 2 0 0 1 2-2h14v4M3 7v11a2 2 0 0 0 2 2h16V9H5a2 2 0 0 1-2-2zM17 14h.01",
  swap: "M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7",
  receipt: "M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6",
  chart: "M3 3v18h18M7 15l4-4 3 3 5-6",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2.2-1.3L14 3h-4l-.4 2.5a7 7 0 0 0-2.2 1.3l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2.2 1.3L10 21h4l.4-2.5a7 7 0 0 0 2.2-1.3l2.3 1 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z",
  plus: "M12 5v14M5 12h14",
  x: "M18 6 6 18M6 6l12 12",
  menu: "M3 6h18M3 12h18M3 18h18",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM19 11a7 7 0 0 1-14 0M12 18v3",
  send: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  clip: "M21 12l-9 9a6 6 0 0 1-8.5-8.5l9-9a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8L15 7",
  play: "M6 4l14 8-14 8z",
  pause: "M6 4h4v16H6zM14 4h4v16h-4z",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  check: "M20 6 9 17l-5-5",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  print: "M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M6 14h12v7H6z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  trend: "M3 17l6-6 4 4 8-8M15 7h6v6",
  tag: "M3 12V3h9l9 9-9 9zM7.5 7.5h.01",
};
export const icon = (name, size = 18) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || ""}"/></svg>`;

// ---------- Toasts ----------
export function toast(msg, type = "info", ms = 3500) {
  const root = document.getElementById("toasts");
  if (!root) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------- Modales ----------
export function openModal(title, bodyHtml, { wide = false } = {}) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="backdrop" data-action="backdrop">
      <div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${esc(title)}</h3>
          <button class="icon-btn" data-action="close-modal" aria-label="Fermer">${icon("x")}</button></div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  document.body.classList.add("modal-open");
  const f = root.querySelector("input:not([type=hidden]):not([readonly]), select, textarea");
  if (f && !matchMedia("(pointer:coarse)").matches) f.focus();
}
export function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
  document.body.classList.remove("modal-open");
}
export const modalOpen = () => !!document.querySelector("#modal-root .modal");

/** Boîte de confirmation → Promise<boolean> */
export function confirmBox(message, { okLabel = "Confirmer", danger = false } = {}) {
  return new Promise((resolve) => {
    const holder = document.getElementById("confirm-root");
    holder.innerHTML = `
      <div class="backdrop top"><div class="modal small" role="alertdialog">
        <div class="modal-body"><p class="confirm-text">${esc(message)}</p>
          <div class="row end gap"><button class="btn ghost" data-c="no">Annuler</button>
          <button class="btn ${danger ? "danger" : "primary"}" data-c="yes">${esc(okLabel)}</button></div></div>
      </div></div>`;
    holder.onclick = (e) => {
      const b = e.target.closest("[data-c]");
      if (!b && !e.target.classList.contains("backdrop")) return;
      holder.innerHTML = ""; holder.onclick = null;
      resolve(b?.dataset.c === "yes");
    };
  });
}

// ---------- Divers ----------
export const chip = (text, tone = "gray") => `<span class="chip ${tone}">${esc(text)}</span>`;
export const empty = (text, ic = "box") => `<div class="empty">${icon(ic, 34)}<p>${esc(text)}</p></div>`;

export function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => {
    const s = String(c ?? "").replace(/"/g, '""');
    return /[;"\n]/.test(s) ? `"${s}"` : s;
  }).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function formData(form) {
  const o = {};
  new FormData(form).forEach((v, k) => { o[k] = typeof v === "string" ? v.trim() : v; });
  return o;
}

/** Désactive un bouton pendant une action asynchrone. */
export async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.innerHTML; btn.innerHTML = '<span class="spin"></span>'; }
  try { return await fn(); }
  finally { if (btn?.isConnected) { btn.disabled = false; btn.innerHTML = btn.dataset.label; } }
}

export function friendlyError(e) {
  const c = e?.code || "";
  const map = {
    "auth/invalid-credential": "Email ou mot de passe incorrect.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/user-not-found": "Aucun compte avec cet email.",
    "auth/too-many-requests": "Trop de tentatives. Réessayez dans quelques minutes.",
    "auth/email-already-in-use": "Cet email est déjà utilisé.",
    "auth/weak-password": "Mot de passe trop faible (6 caractères minimum).",
    "auth/invalid-email": "Adresse email invalide.",
    "auth/network-request-failed": "Pas de connexion internet.",
    "auth/requires-recent-login": "Reconnectez-vous puis réessayez (sécurité).",
    "permission-denied": "Action non autorisée pour votre compte.",
    "unavailable": "Connexion indisponible. Réessayez.",
  };
  return map[c] || e?.message || "Une erreur est survenue.";
}
