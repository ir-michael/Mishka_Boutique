// Faux SDK Firebase (auth + Firestore) pour tester l'interface sans réseau.
// Les données vivent dans localStorage (partagées entre onglets) ; la session de connexion dans sessionStorage.
// N'applique PAS les règles de sécurité : celles-ci se testent avec l'émulateur Firebase ou en production.
(() => {
  const KEY = "fakefb:data", USERS = "fakefb:users";
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  let data = load(KEY, {});            // { colName: { id: doc } }
  let users = load(USERS, []);         // [{uid,email,password}]
  const listeners = new Set();
  const log = (window.__fbWrites = []);

  class Timestamp {
    constructor(ms) { this.ms = ms; this.seconds = Math.floor(ms / 1000); this.nanoseconds = (ms % 1000) * 1e6; }
    toDate() { return new Date(this.ms); } toMillis() { return this.ms; }
    static fromDate(d) { return new Timestamp(d.getTime()); } static now() { return new Timestamp(Date.now()); }
  }
  const SERVER_TS = { __sentinel: "ts" };
  const serverTimestamp = () => SERVER_TS;
  const increment = (n) => ({ __sentinel: "inc", n });
  const arrayUnion = (...v) => ({ __sentinel: "union", v });

  const enc = (v) => {
    if (v === undefined) return undefined;
    if (v instanceof Timestamp) return { __ts: v.ms };
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) { const e = enc(x); if (e !== undefined) o[k] = e; } return o; }
    return v;
  };
  const dec = (v) => {
    if (Array.isArray(v)) return v.map(dec);
    if (v && typeof v === "object") { if ("__ts" in v) return new Timestamp(v.__ts); const o = {}; for (const [k, x] of Object.entries(v)) o[k] = dec(x); return o; }
    return v;
  };
  const resolve = (prev, patch) => {            // applique sentinelles (ts, inc, union)
    const out = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v === SERVER_TS) out[k] = { __ts: Date.now() };
      else if (v && v.__sentinel === "inc") out[k] = (Number(prev?.[k]) || 0) + v.n;
      else if (v && v.__sentinel === "union") out[k] = [...new Set([...(prev?.[k] || []), ...v.v.map(enc)])];
      else { const e = enc(v); if (e !== undefined) out[k] = e; }
    }
    return out;
  };
  const save = () => { localStorage.setItem(KEY, JSON.stringify(data)); notify(); };
  const notify = () => listeners.forEach((l) => l());
  window.addEventListener("storage", (e) => { if (e.key === KEY) { data = load(KEY, {}); notify(); } if (e.key === USERS) users = load(USERS, []); });

  let seq = 0;
  const newId = () => "id" + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

  // ----- références -----
  const collection = (db, name) => ({ type: "col", name });
  const doc = (a, b, c) => {
    if (a && a.type === "col") return { type: "doc", col: a.name, id: newId() };
    return { type: "doc", col: b, id: c ?? newId() };
  };
  const where = (f, op, v) => ({ k: "where", f, op, v });
  const orderBy = (f, dir = "asc") => ({ k: "order", f, dir });
  const limit = (n) => ({ k: "limit", n });
  const query = (col, ...cs) => ({ type: "query", name: col.name, cs });

  const get = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);
  const cmpVal = (v) => (v && typeof v === "object" && "__ts" in v ? v.__ts : v);
  const match = (d, c) => {
    const a = cmpVal(get(d, c.f)), b = cmpVal(c.v instanceof Timestamp ? { __ts: c.v.ms } : c.v);
    return { "==": a === b, "!=": a !== b, ">": a > b, ">=": a >= b, "<": a < b, "<=": a <= b }[c.op];
  };
  const runQuery = (q) => {
    let rows = Object.entries(data[q.name] || {}).map(([id, d]) => ({ id, d }));
    for (const c of q.cs) if (c.k === "where") rows = rows.filter((r) => match(r.d, c));
    const ord = q.cs.filter((c) => c.k === "order");
    for (const o of [...ord].reverse()) rows.sort((x, y) => { const a = cmpVal(get(x.d, o.f)), b = cmpVal(get(y.d, o.f)); return (a > b ? 1 : a < b ? -1 : 0) * (o.dir === "desc" ? -1 : 1); });
    if (ord.length) { const f = ord[0].f; rows = rows.filter((r) => get(r.d, f) !== undefined); }
    const lim = q.cs.find((c) => c.k === "limit"); if (lim) rows = rows.slice(0, lim.n);
    return rows;
  };
  const docSnap = (col, id) => { const raw = data[col]?.[id]; return { id, exists: () => raw !== undefined, data: () => (raw === undefined ? undefined : dec(raw)), metadata: { hasPendingWrites: false } }; };
  const querySnap = (rows, prevIds) => ({
    docs: rows.map((r) => ({ id: r.id, data: () => dec(r.d), metadata: { hasPendingWrites: false } })),
    docChanges: () => rows.filter((r) => !prevIds.has(r.id)).map((r) => ({ type: "added", doc: { id: r.id, data: () => dec(r.d), metadata: { hasPendingWrites: false } } })),
  });

  const onSnapshot = (target, cb) => {
    let prev = null, prevIds = new Set(), first = true;
    const fire = () => {
      if (target.type === "doc") {
        const s = JSON.stringify(data[target.col]?.[target.id] ?? null);
        if (s === prev) return; prev = s; cb(docSnap(target.col, target.id));
      } else {
        const q = target.type === "col" ? { name: target.name, cs: [] } : target;
        const rows = runQuery(q); const s = JSON.stringify(rows);
        if (s === prev) return; prev = s; cb(querySnap(rows, first ? new Set(rows.map((r) => r.id)) : prevIds)); first = false;
        prevIds = new Set(rows.map((r) => r.id));
      }
    };
    listeners.add(fire); setTimeout(fire, 0);
    return () => listeners.delete(fire);
  };
  const getDoc = async (r) => docSnap(r.col, r.id);
  const getDocs = async (q) => querySnap(runQuery(q.type === "col" ? { name: q.name, cs: [] } : q), new Set());

  const write = (op, r, payload, opts) => {
    log.push({ op, col: r.col, id: r.id });
    const col = (data[r.col] ||= {});
    if (op === "set") col[r.id] = opts?.merge ? { ...(col[r.id] || {}), ...resolve(col[r.id], payload) } : resolve(undefined, payload);
    else if (op === "update") { if (!col[r.id]) throw Object.assign(new Error("No document to update"), { code: "not-found" }); Object.assign(col[r.id], resolve(col[r.id], payload)); }
    else if (op === "delete") delete col[r.id];
  };
  const setDoc = async (r, p, o) => { write("set", r, p, o); save(); };
  const updateDoc = async (r, p) => { write("update", r, p); save(); };
  const deleteDoc = async (r) => { write("delete", r); save(); };
  const addDoc = async (c, p) => { const r = doc(c); write("set", r, p); save(); return r; };
  const writeBatch = () => {
    const ops = [];
    const b = { set: (r, p, o) => (ops.push(["set", r, p, o]), b), update: (r, p) => (ops.push(["update", r, p]), b), delete: (r) => (ops.push(["delete", r]), b),
      commit: async () => { const snap = JSON.stringify(data); try { ops.forEach((o) => write(...o)); } catch (e) { data = JSON.parse(snap); throw e; } save(); } };
    return b;
  };
  const runTransaction = async (db, fn) => {
    const snap = JSON.stringify(data);
    const staged = [];
    const tx = { get: async (r) => docSnap(r.col, r.id), update: (r, p) => staged.push(["update", r, p]), set: (r, p, o) => staged.push(["set", r, p, o]), delete: (r) => staged.push(["delete", r]) };
    await fn(tx);
    try { staged.forEach((o) => write(...o)); } catch (e) { data = JSON.parse(snap); throw e; }
    save();
  };

  // ----- Authentification -----
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const apps = [];
  const initializeApp = (cfg, name = "[DEFAULT]") => { const a = { name, options: cfg, auth: null }; apps.push(a); return a; };
  const deleteApp = async () => {};
  const authListeners = new Map();
  const getAuth = (app) => {
    if (app.auth) return app.auth;
    const primary = app.name === "[DEFAULT]";
    const a = { app, primary, currentUser: null };
    if (primary) { const uid = sessionStorage.getItem("fakefb:uid"); const u = users.find((x) => x.uid === uid); if (u) a.currentUser = { uid: u.uid, email: u.email }; }
    app.auth = a; authListeners.set(a, new Set()); return a;
  };
  const setUser = (a, u) => {
    a.currentUser = u ? { uid: u.uid, email: u.email } : null;
    if (a.primary) { u ? sessionStorage.setItem("fakefb:uid", u.uid) : sessionStorage.removeItem("fakefb:uid"); }
    authListeners.get(a).forEach((f) => f(a.currentUser));
  };
  const onAuthStateChanged = (a, cb) => { authListeners.get(a).add(cb); setTimeout(() => cb(a.currentUser), 30); return () => authListeners.get(a).delete(cb); };
  const signInWithEmailAndPassword = async (a, email, pw) => {
    users = load(USERS, []);
    const u = users.find((x) => x.email === email.toLowerCase() && x.password === pw);
    if (!u) throw err("auth/invalid-credential"); setUser(a, u); return { user: a.currentUser };
  };
  const createUserWithEmailAndPassword = async (a, email, pw) => {
    users = load(USERS, []);
    if (pw.length < 6) throw err("auth/weak-password");
    if (users.some((x) => x.email === email.toLowerCase())) throw err("auth/email-already-in-use");
    const u = { uid: "u" + newId(), email: email.toLowerCase(), password: pw }; users.push(u); localStorage.setItem(USERS, JSON.stringify(users));
    setUser(a, u); return { user: a.currentUser };
  };
  const signOut = async (a) => setUser(a, null);
  const sendPasswordResetEmail = async (a, email) => { (window.__resetMails ||= []).push(email); };
  const updatePassword = async (u, pw) => { users = load(USERS, []); const x = users.find((y) => y.uid === u.uid); x.password = pw; localStorage.setItem(USERS, JSON.stringify(users)); };
  const reauthenticateWithCredential = async () => {};
  const EmailAuthProvider = { credential: (email, password) => ({ email, password }) };

  window.__FB = {
    Timestamp, serverTimestamp, increment, arrayUnion, collection, doc, where, orderBy, limit, query, onSnapshot, getDoc, getDocs,
    setDoc, updateDoc, deleteDoc, addDoc, writeBatch, runTransaction,
    initializeFirestore: () => ({ fake: true }), persistentLocalCache: () => ({}), persistentMultipleTabManager: () => ({}),
    initializeApp, deleteApp, getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
    sendPasswordResetEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
    __dump: () => JSON.parse(JSON.stringify(data)),
  };
})();
