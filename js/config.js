// ============================================================
//  CONFIGURATION — à remplir une seule fois (voir README.md)
// ============================================================

// 1) Firebase : Console Firebase > Paramètres du projet > "Vos applications" > Web (</>)
import { firebaseConfig } from "./firebase-config.local.js";
export { firebaseConfig };

// 2) Médias de la messagerie (photos, vidéos, vocaux) — gratuit avec Cloudinary
//    Laisser vide = photos et vocaux courts fonctionnent quand même (stockés dans Firestore),
//    mais les vidéos nécessitent Cloudinary.
export const cloudinary = {
  cloudName: "",     // ex : "dxxxxxxxx"
  uploadPreset: "",  // ex : "boutique_unsigned" (preset de type "Unsigned")
};

// 3) Catégories de produits et de dépenses (modifiables)
export const CATEGORIES = [
  { id: "ordinateur", label: "Ordinateurs" },
  { id: "telephone", label: "Téléphones" },
  { id: "accessoire", label: "Accessoires" },
  { id: "autre", label: "Autres" },
];

export const EXPENSE_CATEGORIES = [
  "Loyer", "Transport", "Électricité / Internet", "Salaire / Motivation",
  "Publicité", "Réparation / Entretien", "Taxes / Patente", "Autre",
];

// 4) Limites d'envoi dans la messagerie (en Mo)
export const MEDIA_LIMITS = { image: 15, video: 60, audio: 15 };
