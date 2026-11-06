import { cloudinary } from "./config.js";

export const hasCloud = () => !!(cloudinary.cloudName && cloudinary.uploadPreset);

const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

export async function compressImage(file, maxDim = 1600, quality = 0.78) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const k = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob((b) => res(b || file), "image/jpeg", quality));
}

/** Envoie un média. Retourne { url, size }. */
export async function uploadMedia(blob, kind, onProgress) {
  if (kind === "image") blob = await compressImage(blob, hasCloud() ? 1600 : 1000, hasCloud() ? 0.8 : 0.6);
  if (hasCloud()) {
    return new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append("file", blob); fd.append("upload_preset", cloudinary.uploadPreset);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudinary.cloudName}/auto/upload`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        try { const j = JSON.parse(xhr.responseText); if (xhr.status < 300 && j.secure_url) return resolve({ url: j.secure_url, size: blob.size }); reject(new Error(j.error?.message || "Envoi impossible")); }
        catch (e) { reject(new Error("Envoi impossible")); }
      };
      xhr.onerror = () => reject(new Error("Connexion perdue pendant l'envoi"));
      xhr.send(fd);
    });
  }
  // Mode sans hébergeur : stockage direct dans Firestore (limite ~700 Ko)
  if (kind === "video") throw new Error("Les vidéos nécessitent Cloudinary (voir README, étape 5).");
  if (blob.size > 700 * 1024) throw new Error("Fichier trop lourd (700 Ko max sans Cloudinary).");
  onProgress?.(1);
  return { url: await blobToDataURL(blob), size: blob.size };
}
