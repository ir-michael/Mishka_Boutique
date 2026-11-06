// Messagerie type WhatsApp : texte, images, vidéos, messages vocaux, accusés de lecture.
import {
  db, collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp, arrayUnion,
} from "../fb.js";
import { state, otherUser, setChatLimit } from "../store.js";
import { MEDIA_LIMITS } from "../config.js";
import { uploadMedia } from "../media.js";
import { esc, icon, fmtTime, fmtDate, toast, confirmBox, openModal, closeModal } from "../ui.js";
import { actions, submits, inputs } from "../core.js";
import { toDate, startOfDay } from "../logic.js";

let rec = null;          // { recorder, stream, chunks, start, timer, cancelled }
let draft = "";
let sending = 0;         // nombre d'envois de médias en cours
let stickToBottom = true;

const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, "<br>");
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function dayLabel(d) {
  const t = startOfDay(new Date()), x = startOfDay(d);
  const diff = Math.round((t - x) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Hier";
  return fmtDate(d);
}

function bubble(m) {
  const mine = m.senderId === state.me.uid;
  const other = otherUser();
  const read = mine && other && (m.readBy || []).includes(other.id);
  const tick = mine ? `<span class="tick ${read ? "read" : ""}">${m._pending ? icon("clock", 12) : "✓✓"}</span>` : "";
  let body = "";
  if (m.type === "image") body = `<img class="chat-img" src="${esc(m.url)}" alt="Photo" loading="lazy" data-action="view-media" data-src="${esc(m.url)}" data-kind="image">`;
  else if (m.type === "video") body = `<video class="chat-video" src="${esc(m.url)}#t=0.1" controls preload="metadata" playsinline></video>`;
  else if (m.type === "audio") body = `<div class="voice" data-voice data-src="${esc(m.url)}" data-dur="${m.duration || 0}">
      <button class="voice-btn" data-action="play-voice" aria-label="Écouter">${icon("play", 16)}</button>
      <div class="voice-bar"><i></i></div><span class="voice-time">${dur(m.duration || 0)}</span></div>`;
  if (m.text) body += `<div class="txt">${linkify(m.text)}</div>`;
  const canDelete = mine || state.me.role === "admin";
  return `<div class="msg ${mine ? "mine" : "theirs"}" data-id="${m.id}">
    <div class="bubble">${!mine ? `<div class="who">${esc(m.senderName || "")}</div>` : ""}${body}
      <div class="meta">${fmtTime(m.createdAt)} ${tick}${canDelete && !m._pending ? `<button class="del" data-action="delete-msg" data-id="${m.id}" title="Supprimer" aria-label="Supprimer le message">${icon("trash", 12)}</button>` : ""}</div></div></div>`;
}

function listHtml() {
  const msgs = state.messages;
  if (!msgs.length) return `<div class="empty">${icon("chat", 34)}<p>Aucun message. Dites bonjour 👋</p></div>`;
  let last = "", out = state.messages.length >= state.chatLimit ? `<div class="center"><button class="btn sm ghost" data-action="older-msgs">Messages plus anciens</button></div>` : "";
  for (const m of msgs) {
    const d = toDate(m.createdAt) || new Date();
    const k = startOfDay(d).getTime();
    if (k !== last) { out += `<div class="day-sep"><span>${esc(dayLabel(d))}</span></div>`; last = k; }
    out += bubble(m);
  }
  return out;
}

function render() {
  const other = otherUser();
  const online = other?.lastSeen && Date.now() - (other.lastSeen.toMillis?.() ?? 0) < 3 * 60000;
  return `
    <div class="chat">
      <div class="chat-head"><div class="avatar">${esc((other?.name || "?")[0].toUpperCase())}</div>
        <div><strong>${esc(other?.name || "Messagerie")}</strong><div class="muted small">${other ? (online ? "● en ligne" : "hors ligne") : "Créez le compte employé pour discuter"}</div></div></div>
      <div class="chat-list" id="chat-list">${listHtml()}</div>
      <div class="chat-bar" id="chat-bar">${barHtml()}</div>
    </div>`;
}

function barHtml() {
  if (rec) return `<button class="icon-btn danger" data-action="rec-cancel" aria-label="Annuler">${icon("trash")}</button>
    <div class="rec"><span class="dot"></span><span id="rec-time">0:00</span><span class="muted small">Enregistrement…</span></div>
    <button class="send" data-action="rec-send" aria-label="Envoyer">${icon("send", 20)}</button>`;
  return `<label class="icon-btn" aria-label="Joindre une photo ou une vidéo" title="Photo / vidéo">${icon("clip", 22)}
      <input type="file" id="chat-file" accept="image/*,video/*" multiple hidden data-input="chatFile"></label>
    <textarea id="chat-input" class="chat-input" rows="1" placeholder="Écrire un message" data-input="chatDraft">${esc(draft)}</textarea>
    ${draft.trim() ? `<button class="send" data-action="send-text" aria-label="Envoyer">${icon("send", 20)}</button>`
      : `<button class="send" data-action="rec-start" aria-label="Message vocal" title="Message vocal">${icon("mic", 20)}</button>`}
    ${sending ? `<span class="spin dark"></span>` : ""}`;
}

function refreshBar() {
  const bar = document.getElementById("chat-bar");
  if (!bar) return;
  const keep = document.activeElement?.id === "chat-input";
  bar.innerHTML = barHtml();
  const ta = document.getElementById("chat-input");
  if (ta) { bindInput(ta); if (keep) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }
}
function autosize(ta) { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 120) + "px"; }

/** Entrée envoie (sur ordinateur) ; Maj+Entrée = retour à la ligne. À rappeler à chaque reconstruction de la barre. */
function bindInput(ta) {
  autosize(ta);
  ta.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer:coarse)").matches) { e.preventDefault(); actions["send-text"](); }
  };
}

/** Appelé par le routeur après chaque rendu de la page. */
function mount() {
  const list = document.getElementById("chat-list");
  if (!list) return;
  list.onscroll = () => { stickToBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80; };
  if (stickToBottom) list.scrollTop = list.scrollHeight;
  bindInput(document.getElementById("chat-input"));
  markRead();
}

export function markRead() {
  if (document.hidden || !state.me) return;
  const unread = state.messages.filter((m) => m.senderId !== state.me.uid && !(m.readBy || []).includes(state.me.uid) && !m._pending);
  unread.slice(0, 40).forEach((m) => {
    m.readBy = [...(m.readBy || []), state.me.uid]; // évite les doubles écritures avant le retour serveur
    updateDoc(doc(db, "messages", m.id), { readBy: arrayUnion(state.me.uid) }).catch(() => {});
  });
}

// ---------- Texte ----------
inputs.chatDraft = (el) => {
  const had = !!draft.trim();
  draft = el.value;
  autosize(el);
  if (had !== !!draft.trim()) refreshBar(); // bascule micro ↔ envoyer
};

actions["send-text"] = async () => {
  const text = draft.trim();
  if (!text) return;
  draft = "";
  stickToBottom = true;
  refreshBar();
  await post({ type: "text", text });
};

async function post(payload) {
  const me = state.me;
  try {
    await addDoc(collection(db, "messages"), {
      text: "", ...payload, senderId: me.uid, senderName: me.name, createdAt: serverTimestamp(), readBy: [me.uid],
    });
  } catch (e) { toast("Message non envoyé : " + (e.code === "permission-denied" ? "accès refusé" : "vérifiez la connexion"), "error"); }
}

// ---------- Photos & vidéos ----------
inputs.chatFile = async (el) => {
  const files = [...el.files];
  el.value = "";
  for (const f of files) await sendFile(f, f.type.startsWith("video/") ? "video" : "image");
};

async function sendFile(file, type, extra = {}) {
  const limit = (MEDIA_LIMITS[type] || 15) * 1048576;
  if (file.size > limit) return toast(`Fichier trop lourd (max ${Math.round(limit / 1048576)} Mo).`, "error", 5000);
  sending++; refreshBar();
  try {
    // media.js réduit les photos, envoie vers Cloudinary (ou stocke dans Firestore si non configuré)
    const { url } = await uploadMedia(file, type);
    stickToBottom = true;
    await post({ type, url, ...extra });
  } catch (e) {
    console.error(e);
    toast("Envoi impossible : " + (e.message || "erreur réseau"), "error", 6000);
  } finally { sending--; refreshBar(); }
}

// ---------- Messages vocaux ----------
actions["rec-start"] = async () => {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("Enregistrement vocal non pris en charge par ce navigateur.", "error");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32000 });
    rec = { recorder, stream, chunks: [], start: Date.now(), cancelled: false, mime: recorder.mimeType || mime || "audio/webm" };
    recorder.ondataavailable = (e) => e.data.size && rec?.chunks.push(e.data);
    recorder.start();
    rec.timer = setInterval(() => {
      const el = document.getElementById("rec-time");
      if (el && rec) el.textContent = dur((Date.now() - rec.start) / 1000);
      if (rec && Date.now() - rec.start > 5 * 60000) actions["rec-send"]();
    }, 250);
    refreshBar();
  } catch (e) {
    toast(e.name === "NotAllowedError" ? "Autorisez le micro dans le navigateur pour envoyer des vocaux." : "Micro indisponible.", "error", 5000);
  }
};

function stopRec() {
  if (!rec) return null;
  const r = rec; rec = null;
  clearInterval(r.timer);
  return new Promise((resolve) => {
    r.recorder.onstop = () => { r.stream.getTracks().forEach((t) => t.stop()); resolve(r); };
    if (r.recorder.state !== "inactive") r.recorder.stop(); else resolve(r);
  });
}

actions["rec-cancel"] = async () => { await stopRec(); refreshBar(); };

actions["rec-send"] = async () => {
  const seconds = rec ? (Date.now() - rec.start) / 1000 : 0;
  const r = await stopRec();
  refreshBar();
  if (!r) return;
  if (seconds < 1) return toast("Message vocal trop court.", "info");
  const ext = r.mime.includes("mp4") ? "m4a" : r.mime.includes("ogg") ? "ogg" : "webm";
  const blob = new Blob(r.chunks, { type: r.mime });
  await sendFile(new File([blob], `vocal.${ext}`, { type: r.mime }), "audio", { duration: Math.round(seconds) });
};

// Lecture d'un message vocal (un seul à la fois)
let playing = null;
actions["play-voice"] = (el) => {
  const box = el.closest("[data-voice]");
  if (playing && playing.box === box) { playing.audio.pause(); return; }
  if (playing) { playing.audio.pause(); }
  const audio = new Audio(box.dataset.src);
  const bar = box.querySelector(".voice-bar i"), time = box.querySelector(".voice-time"), btn = box.querySelector(".voice-btn");
  const total = Number(box.dataset.dur) || 0;
  const setIcon = (n) => { btn.innerHTML = icon(n, 16); };
  audio.ontimeupdate = () => {
    const d = isFinite(audio.duration) ? audio.duration : total;
    if (d) bar.style.width = (audio.currentTime / d) * 100 + "%";
    time.textContent = dur(audio.currentTime);
  };
  const end = () => { setIcon("play"); if (playing?.audio === audio) playing = null; if (audio.ended) { bar.style.width = "0"; time.textContent = dur(total); } };
  audio.onpause = end; audio.onended = end;
  audio.onerror = () => { toast("Lecture impossible.", "error"); end(); };
  playing = { audio, box };
  setIcon("pause");
  audio.play().catch(end);
};

// ---------- Divers ----------
actions["delete-msg"] = async (el) => {
  if (!(await confirmBox("Supprimer ce message pour tout le monde ?", { okLabel: "Supprimer", danger: true }))) return;
  try { await deleteDoc(doc(db, "messages", el.dataset.id)); } catch { toast("Suppression impossible.", "error"); }
};
actions["older-msgs"] = () => setChatLimit(state.chatLimit + 60);
actions["view-media"] = (el) => {
  openModal("Photo", `<img class="viewer" src="${esc(el.dataset.src)}" alt="Photo"><div class="row end top-gap"><a class="btn" href="${esc(el.dataset.src)}" target="_blank" rel="noopener">Ouvrir l'original</a></div>`, { wide: true });
};

export const chatState = {
  /** Faut-il laisser le routeur re-rendre la page ? On évite de casser un enregistrement ou une saisie. */
  busy: () => !!rec,
  /** Mise à jour douce quand de nouveaux messages arrivent (garde le brouillon et le scroll). */
  softUpdate() {
    const list = document.getElementById("chat-list");
    if (!list) return false;
    list.innerHTML = listHtml();
    if (stickToBottom) list.scrollTop = list.scrollHeight;
    markRead();
    const head = document.querySelector(".chat-head .muted.small");
    const other = otherUser();
    if (head && other) head.textContent = other.lastSeen && Date.now() - (other.lastSeen.toMillis?.() ?? 0) < 3 * 60000 ? "● en ligne" : "hors ligne";
    return true;
  },
};

export default { id: "chat", title: "Messagerie", label: "Messagerie", icon: "chat", roles: ["admin", "employee"], render, mount, fullHeight: true };
