// Utilitaires de test navigateur : faux Firebase injecté à la place du CDN.
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
import fs from "fs";
import path from "path";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const BASE = "http://127.0.0.1:8089/";
const core = fs.readFileSync(path.join(ROOT, "tests/fake-firebase-core.js"), "utf8");
const testConfig = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8").replace(/apiKey: "[^"]*"/, 'apiKey: "fake-key"');
const shims = {
  "firebase-app.js": ["initializeApp", "deleteApp"],
  "firebase-auth.js": ["getAuth", "onAuthStateChanged", "signInWithEmailAndPassword", "signOut", "createUserWithEmailAndPassword", "sendPasswordResetEmail", "updatePassword", "reauthenticateWithCredential", "EmailAuthProvider"],
  "firebase-firestore.js": ["initializeFirestore", "persistentLocalCache", "persistentMultipleTabManager", "collection", "doc", "getDoc", "getDocs", "setDoc", "updateDoc", "deleteDoc", "onSnapshot", "query", "orderBy", "limit", "where", "writeBatch", "runTransaction", "serverTimestamp", "increment", "arrayUnion", "addDoc", "Timestamp"],
};
export async function launch(opts = {}) {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const ctx = await browser.newContext({ serviceWorkers: "block", permissions: ["microphone"], locale: "fr-FR", timezoneId: "Africa/Lubumbashi", ...opts });
  return { browser, ctx };
}
export async function newPage(ctx, label = "page") {
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(`[${label}] pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR/.test(m.text())) page.errors.push(`[${label}] console: ${m.text()}`); });
  await page.addInitScript(core);
  await page.route("https://www.gstatic.com/firebasejs/**", (route) => {
    const f = route.request().url().split("/").pop();
    route.fulfill({ contentType: "text/javascript", body: shims[f].map((n) => `export const ${n}=window.__FB.${n};`).join("\n") });
  });
  await page.route("**/js/config.js", (route) => route.fulfill({ contentType: "text/javascript", body: testConfig }));
  await page.route(/cdn\.jsdelivr\.net/, (r) => r.abort());
  return page;
}
