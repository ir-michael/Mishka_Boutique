import { firebaseConfig, cloudinary } from "./config.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  sendPasswordResetEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, getDocs,
  setDoc, updateDoc, deleteDoc, onSnapshot, query, orderBy, limit, where, writeBatch, runTransaction,
  serverTimestamp, increment, arrayUnion, addDoc, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const configured = !!firebaseConfig.apiKey && !/COLLER|YOUR_/i.test(firebaseConfig.apiKey);
export let app = null, auth = null, db = null;

if (configured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  try {
    db = initializeFirestore(app, {
      ignoreUndefinedProperties: true,
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch (e) {
    db = initializeFirestore(app, { ignoreUndefinedProperties: true });
  }
}

/** Crée un compte Auth sans déconnecter l'administrateur (application secondaire). */
export async function createAuthUser(email, password) {
  const secondary = initializeApp(firebaseConfig, "secondary-" + Date.now());
  try {
    const a = getAuth(secondary);
    const cred = await createUserWithEmailAndPassword(a, email, password);
    const uid = cred.user.uid;
    await signOut(a);
    return uid;
  } finally {
    await deleteApp(secondary);
  }
}

export const createAccountWithoutSwitching = createAuthUser;

export async function changePassword(current, next) {
  const u = auth.currentUser;
  const cred = EmailAuthProvider.credential(u.email, current);
  await reauthenticateWithCredential(u, cred);
  await updatePassword(u, next);
}

export {
  cloudinary, updatePassword, addDoc, Timestamp, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  sendPasswordResetEmail, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, query,
  orderBy, limit, where, writeBatch, runTransaction, serverTimestamp, increment, arrayUnion,
};
