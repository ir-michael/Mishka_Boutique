# Gestion Boutique — guide de mise en ligne

Application web (installable sur téléphone) pour gérer votre boutique d'appareils électroniques à distance :
commandes, arrivages, stock, ventes, créances, dépenses, bénéfices, messagerie.
Tout est **gratuit** : Firebase (base de données + connexion) et Netlify (hébergement).

Compter environ 20 minutes, une seule fois.

---

## Étape 1 — Créer le projet Firebase

1. Allez sur <https://console.firebase.google.com> et connectez-vous avec un compte Google.
2. **Ajouter un projet** → donnez un nom (ex. `ma-boutique`). Vous pouvez désactiver Google Analytics.
3. Menu **Build → Authentication → Commencer** → onglet *Sign-in method* → activez **E-mail/Mot de passe**.
4. Menu **Build → Firestore Database → Créer une base de données** → mode **production** → choisissez une région proche (ex. `eur3` ou `europe-west`).
5. Dans Firestore, onglet **Règles** : supprimez tout, collez le contenu du fichier `firestore.rules`, puis **Publier**.
   > C'est cette étape qui garantit que votre employé ne peut jamais voir les prix d'achat, les bénéfices ni les commandes. Ne pas l'oublier.
6. **Paramètres du projet (roue dentée) → Vos applications → icône Web `</>`** → enregistrez l'app. Firebase affiche un bloc `firebaseConfig` : copiez ses valeurs.
7. Copiez `js/firebase-config.local.example.js` sous le nom `js/firebase-config.local.js`, puis remplacez les `COLLER_ICI` par les valeurs correspondantes. Le fichier `firebase-config.local.js` est exclu de GitHub par `.gitignore`.

> La configuration Firebase pour le Web est chargée par le navigateur et n'est pas un mot de passe. Ne publiez jamais de clé privée de compte de service. Les règles Firestore protègent les données ; le fichier local est ignoré pour ne pas associer votre configuration au dépôt public.

## Étape 2 — Mettre le site en ligne sur Netlify

1. Allez sur <https://app.netlify.com> → créez un compte gratuit.
2. **Add new site → Deploy manually** : glissez-déposez **tout le dossier** de l'application.
   (Ou reliez un dépôt GitHub : aucune commande de build, dossier publié = `.`)
3. Netlify vous donne une adresse du type `https://xxxx.netlify.app` (modifiable dans *Site settings → Change site name*).
4. Retournez dans Firebase → **Authentication → Settings → Domaines autorisés** → ajoutez votre adresse Netlify.

### Alternative : Firebase Hosting

Le projet est déjà configuré pour Firebase Hosting. Depuis la racine du dossier, après connexion au bon projet Firebase, lancez `firebase.cmd deploy --only hosting`. Le site sera publié sur `https://<project-id>.web.app`. Ajoutez ensuite ce domaine dans **Authentication → Settings → Domaines autorisés**. L'offre sans frais inclut actuellement jusqu'à 10 Go de stockage et 10 Go de transfert par mois ; surveillez l'usage dans la console Firebase.

Après une modification des règles permettant les ventes hors ligne, publiez aussi les règles avec `firebase.cmd deploy --only firestore:rules`. Ces deux commandes mettent à jour le site et ses autorisations, sans effacer les documents déjà enregistrés dans Firestore.

## Étape 3 — Première utilisation

1. Ouvrez votre adresse Netlify : l'écran **« Première utilisation »** apparaît.
2. Créez **votre** compte (administrateur). Ce premier compte devient automatiquement le propriétaire ; l'écran ne s'affichera plus ensuite.
3. **Paramètres → Compte de l'employé** : créez le compte de votre employé (e-mail + mot de passe que vous lui communiquez).
4. **Installation mobile** :
   - Android : ouvrez le site dans Chrome, menu ⋮ → **Installer l'application** ou **Ajouter à l'écran d'accueil**.
   - iPhone/iPad : ouvrez le site dans Safari, bouton **Partager** → **Sur l'écran d'accueil**. iOS n'affiche pas toujours de fenêtre d'installation automatique.
   Le site doit être ouvert en HTTPS. Connectez-vous une première fois avec Internet sur chaque appareil.

5. **Hors ligne** : les écrans et données déjà chargés sont gardés sur l'appareil. Une vente saisie sans réseau apparaît dans la file « Ventes en attente de synchronisation » ; appuyez sur **Synchroniser** au retour d'Internet. Le stock est alors revérifié. Si le stock a changé entre-temps, la vente reste en attente avec une erreur, sans perdre sa saisie. La file est locale à cet appareil et au compte connecté ; ne videz pas les données du navigateur avant de l'avoir synchronisée. Les transactions de vente et les modifications de stock ne sont pas appliquées au stock partagé tant qu'elles n'ont pas été synchronisées.

6. **Changer l'icône** : remplacez les images `icons/icon-192.png`, `icons/icon-512.png` et `icons/icon-maskable-512.png` par votre logo carré aux dimensions indiquées par leurs noms. Remplacez aussi `icons/icon.svg` pour l'icône d'onglet. Gardez ces noms de fichiers, redéployez, puis retirez et réinstallez l'application sur le téléphone pour actualiser son icône. Envoyez un logo si vous souhaitez que je prépare les déclinaisons adaptées.

## Étape 4 (facultative) — Vidéos dans la messagerie

Les photos et messages vocaux fonctionnent sans rien configurer. Pour les **vidéos**, créez un compte gratuit sur <https://cloudinary.com>, puis :

1. *Settings → Upload → Upload presets → Add* : mode de signature **Unsigned**, notez le nom du preset.
2. Renseignez `cloudName` et `uploadPreset` dans `js/config.js`, puis redéployez.

> Pourquoi Cloudinary et pas Firebase Storage ? Firebase Storage exige désormais un abonnement avec carte bancaire ; Cloudinary reste gratuit sans carte.

---

## Ce que voit chaque utilisateur

| | Administrateur (vous) | Employé |
|---|---|---|
| Tableau de bord | Ventes, bénéfices, dépenses, créances, valeur du stock | Ventes et stock, **sans bénéfices** |
| Commandes (prix, frais, transport) | ✅ | ❌ (voit seulement « colis à recevoir », sans prix) |
| Arrivages / réception | ✅ | ✅ (signale « colis arrivé ») |
| Stock | Avec prix d'achat et marges | Quantités et prix de vente seulement |
| Ventes + créances | ✅ + annulation | ✅ enregistrer et encaisser un solde |
| Entrées & sorties, Rapports (bénéfice par produit / commande) | ✅ | ❌ |
| Dépenses | ✅ toutes | Ses propres saisies |
| Messagerie (texte, photo, vidéo, vocal, accusés de lecture) | ✅ | ✅ |
| Gérer les comptes, désactiver l'employé | ✅ | ❌ |

## Fonctionnement des calculs

- **Commande** : total = Σ (quantité × prix unitaire) ; on ajoute les dépenses (transfert, motivation, autres) puis, **à la réception**, les frais de kilo (transport). Ces frais sont répartis sur les articles pour donner le **coût de revient réel** de chaque produit.
- **Vente** : date automatique, acheteur facultatif (sinon anonyme), montant payé, reste et **date d'échéance** obligatoire s'il reste un solde.
- **Bénéfice** = prix de vente − coût de revient ; **bénéfice net** = bénéfice brut − dépenses de la boutique.

## Quotas gratuits Firebase (plan Spark)

50 000 lectures et 20 000 écritures par jour : très largement suffisant pour une boutique et un employé.

## Pour les développeurs

- Aucun build : HTML + JavaScript modules (`js/`), CSS (`css/style.css`), PWA (`sw.js`, `manifest.webmanifest`).
- Tests : `node --test tests/logic.test.mjs` (calculs) ; `python3 -m http.server 8089` puis `node tests/e2e.mjs` (scénario complet avec un faux Firebase, 69 vérifications).
- Déploiement des règles en ligne de commande (facultatif) : `firebase deploy --only firestore:rules`.
# Mishka_Boutique
