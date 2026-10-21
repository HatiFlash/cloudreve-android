// Upload de fichiers vers Cloudreve V4 (stockage local : chunks séquentiels,
// finalisation automatique après le dernier chunk).
import * as FileSystem from "expo-file-system/legacy";
import { apiBase, bearer, createUploadSession, deleteUploadSession } from "./api";
import { pushLog } from "./logstore";

export type PickedFile = { uri: string; name: string; size: number; mime: string };
export type UpProgress = (ratio: number) => void;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Validation linéaire : longueur exacte attendue, padding déterminé par expectedLength,
// caractères limités à l'alphabet base64 standard. Pas de regex à groupes répétés (évite
// le backtracking/RangeError sur de grosses tranches de 25 MiB).
function isValidBase64Exact(clean: string, expectedLength: number): boolean {
  const rem = expectedLength % 3;
  const padding = rem === 0 ? 0 : 3 - rem;
  if (clean.length !== 4 * Math.ceil(expectedLength / 3)) return false;
  const dataEnd = clean.length - padding;
  for (let i = 0; i < dataEnd; i++) {
    if (B64.indexOf(clean[i]) < 0) return false;
  }
  for (let i = dataEnd; i < clean.length; i++) {
    if (clean[i] !== "=") return false;
  }
  return true;
}

// Décode une tranche base64 en octets (pour l'upload par chunks).
function base64ToBytes(b64: string, expectedLength: number): Uint8Array {
  const clean = b64.replace(/\s/g, "");
  if (!isValidBase64Exact(clean, expectedLength)) {
    throw new Error("Données base64 invalides pendant l'upload");
  }
  const out = new Uint8Array(expectedLength);
  let p = 0;
  for (let i = 0; i < clean.length && p < expectedLength; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = B64.indexOf(clean[i + 2]);
    const d = B64.indexOf(clean[i + 3]);
    if (a < 0 || b < 0) throw new Error("Données base64 invalides pendant l'upload");
    out[p++] = (a << 2) | (b >> 4);
    if (c >= 0 && p < expectedLength) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0 && p < expectedLength) out[p++] = ((c & 3) << 6) | d;
  }
  if (p !== expectedLength) {
    throw new Error(`Tranche lue incomplète (${p}/${expectedLength} octets)`);
  }
  return out;
}

function assertUploadBody(status: number, text: string, label: string): void {
  let payload: unknown;
  try { payload = JSON.parse(text); } catch {
    throw new Error(`${label} : réponse JSON invalide (HTTP ${status})`);
  }
  if (!payload || typeof payload !== "object" ||
      typeof (payload as { code?: unknown }).code !== "number") {
    throw new Error(`${label} : réponse JSON inattendue (HTTP ${status})`);
  }
  const { code, msg } = payload as { code: number; msg?: string };
  if (status < 200 || status >= 300 || code !== 0) {
    throw new Error(`${label} refusé (${typeof msg === "string" && msg ? msg : `HTTP ${status}`}) — code ${code}`);
  }
}

export async function uploadFile(folderUri: string, file: PickedFile, onProgress?: UpProgress): Promise<void> {
  const base = folderUri.split("?")[0].replace(/\/?$/, "/");
  const target = base + encodeURIComponent(file.name);
  // Le picker peut donner la taille de la source, différente du cache Android.
  // On fige les octets avant de déclarer leur taille au serveur, y compris pour content://.
  if (!FileSystem.cacheDirectory) throw new Error("Cache local indisponible pour l'upload");
  const snapshot = `${FileSystem.cacheDirectory}cloudreve-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let sessionId: string | undefined;
  try {
    await FileSystem.copyAsync({ from: file.uri, to: snapshot });
    const info = await FileSystem.getInfoAsync(snapshot);
    if (!info.exists || !Number.isSafeInteger(info.size) || info.size < 0) {
      throw new Error("Taille du fichier copié indisponible");
    }
    const size = info.size;
    pushLog(`⬆ upload « ${file.name} » (${size} o) → ${target}`);
    const sess = await createUploadSession(target, size, file.mime, Date.now());
    sessionId = sess.session_id;
    const chunkSize = sess.chunk_size && sess.chunk_size > 0 ? sess.chunk_size : Math.max(size, 1);
    const n = Math.max(1, Math.ceil(size / chunkSize));
    pushLog(`session ${sess.session_id.slice(0, 8)} · ${n} chunk(s) de ${chunkSize} o`);
    if (n === 1) {
      // Un seul morceau → upload binaire natif depuis le même snapshot.
      const res = await FileSystem.uploadAsync(
        `${apiBase()}/file/upload/${sess.session_id}/0`,
        snapshot,
        {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: "Bearer " + bearer(),
            "Content-Type": "application/octet-stream",
          },
        }
      );
      assertUploadBody(res.status, res.body, "Upload");
      onProgress?.(1);
    } else {
      // Plusieurs morceaux : on lit et envoie chaque tranche séquentiellement.
      for (let i = 0; i < n; i++) {
        const offset = i * chunkSize;
        const length = Math.min(chunkSize, size - offset);
        const b64 = await FileSystem.readAsStringAsync(snapshot, {
          encoding: FileSystem.EncodingType.Base64,
          position: offset,
          length,
        });
        const bytes = base64ToBytes(b64, length);
        const res = await fetch(`${apiBase()}/file/upload/${sess.session_id}/${i}`, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + bearer(),
            "Content-Type": "application/octet-stream",
            "Content-Length": String(length),
          },
          body: bytes as any,
        });
        assertUploadBody(res.status, await res.text(), `Chunk ${i}`);
        onProgress?.((i + 1) / n);
      }
    }
    pushLog("✓ upload terminé");
  } catch (e: any) {
    pushLog("✗ upload: " + e.message);
    if (sessionId) {
      try { await deleteUploadSession(sessionId, target); } catch { /* conserver l'erreur initiale */ }
    }
    throw e;
  } finally {
    try { await FileSystem.deleteAsync(snapshot, { idempotent: true }); }
    catch { /* le nettoyage du cache ne masque jamais l'upload */ }
  }
}
