// État global + abonnements temps réel Firestore.
import {
  db, collection, doc, onSnapshot, query, where, orderBy, limit,
} from "./fb.js";

export const DEFAULT_SHOP = {
  name: "Ma Boutique", currency: "USD", defaultMargin: 20, lowStock: 2, phone: "", address: "", countryCode: "243",
};

export const state = fresh();
function fresh() {
  return {
    me: null,               // { uid, name, email, role, active }
    shop: { ...DEFAULT_SHOP },
    products: [], costs: {}, sales: [], orders: [], notices: [], movements: [], expenses: [],
    users: [], messages: [],
    ready: {},
    chatLimit: 60,
  };
}

const subs = new Set();
const msgSubs = new Set();
export const onData = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const onNewMessage = (fn) => { msgSubs.add(fn); return () => msgSubs.delete(fn); };
const emit = () => subs.forEach((f) => f());

let unsubs = [];
let msgUnsub = null;
let firstMsgLoad = true;

const read = (d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) });
const list = (snap) => snap.docs.map(read);

function listen(name, q, map = list) {
  unsubs.push(onSnapshot(q, (snap) => {
    state[name] = map(snap);
    state.ready[name] = true;
    emit();
  }, (err) => console.error("Firestore [" + name + "]", err.code, err.message)));
}

function listenMessages() {
  if (msgUnsub) msgUnsub();
  const q = query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(state.chatLimit));
  msgUnsub = onSnapshot(q, (snap) => {
    state.messages = snap.docs.map((d) => ({ ...read(d), _pending: d.metadata.hasPendingWrites })).reverse();
    state.ready.messages = true;
    if (!firstMsgLoad) {
      snap.docChanges().forEach((c) => {
        if (c.type === "added") {
          const m = read(c.doc);
          if (m.senderId !== state.me?.uid && !c.doc.metadata.hasPendingWrites) msgSubs.forEach((f) => f(m));
        }
      });
    }
    firstMsgLoad = false;
    emit();
  }, (err) => console.error("Firestore [messages]", err.code, err.message));
}

export function setChatLimit(n) { state.chatLimit = n; listenMessages(); }

export function startStore(me) {
  stopStore();
  state.me = me;
  const admin = me.role === "admin";
  listen("products", collection(db, "products"));
  listen("sales", query(collection(db, "sales"), orderBy("date", "desc")));
  listen("notices", collection(db, "orderNotices"));
  listen("users", collection(db, "users"));
  unsubs.push(onSnapshot(doc(db, "settings", "shop"), (d) => {
    state.shop = { ...DEFAULT_SHOP, ...(d.exists() ? d.data() : {}) };
    state.ready.shop = true; emit();
  }));
  if (admin) {
    listen("costs", collection(db, "costs"), (s) => Object.fromEntries(s.docs.map((d) => [d.id, d.data()])));
    listen("orders", query(collection(db, "orders"), orderBy("createdAt", "desc")));
    listen("movements", query(collection(db, "movements"), orderBy("date", "desc")));
    listen("expenses", query(collection(db, "expenses"), orderBy("date", "desc")));
  } else {
    listen("expenses", query(collection(db, "expenses"), where("createdBy", "==", me.uid)),
      (s) => list(s).sort((a, b) => (b.date?.seconds || 0) - (a.date?.seconds || 0)));
  }
  firstMsgLoad = true;
  listenMessages();
}

export function stopStore() {
  unsubs.forEach((u) => u());
  unsubs = [];
  if (msgUnsub) { msgUnsub(); msgUnsub = null; }
  Object.assign(state, fresh());
}

// ---------- Sélecteurs ----------
export const isAdmin = () => state.me?.role === "admin";
export const productById = (id) => state.products.find((p) => p.id === id);
export const unitCost = (productId) => state.costs[productId]?.unitCost ?? null;
export const userName = (uid) => state.users.find((u) => u.id === uid)?.name || "—";
export const otherUser = () => state.users.find((u) => u.id !== state.me?.uid && u.active !== false) || null;
export const activeSales = () => state.sales.filter((s) => s.status !== "cancelled");
export const unreadCount = () =>
  state.messages.filter((m) => m.senderId !== state.me?.uid && !(m.readBy || []).includes(state.me?.uid)).length;
