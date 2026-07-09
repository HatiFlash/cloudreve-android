// Upload de fichiers vers Cloudreve V4 (stockage local : chunks séquentiels,
// finalisation automatique après le dernier chunk).
import * as FileSystem from "expo-file-system/legacy";
import { apiBase, bearer, createUploadSession, deleteUploadSession } from "./api";
import { pushLog } from "./logstore";

export type PickedFile = { uri: string; name: string; size: number; mime: string };
export type UpProgress = (ratio: number) => void;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Décode une tranche base64 en octets (pour l'upload par chunks).
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i]);
    const b = B64.indexOf(clean[i + 1]);
    const c = B64.indexOf(clean[i + 2]);
    const d = B64.indexOf(clean[i + 3]);
    out[p++] = (a << 2) | (b >> 4);
    if (c >= 0 && i + 2 < clean.length) out[p++] = ((b & 15) << 4) | (c >> 2);
    if (d >= 0 && i + 3 < clean.length) out[p++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, p);
}

export async function uploadFile(folderUri: string, file: PickedFile, onProgress?: UpProgress): Promise<void> {
  const base = folderUri.split("?")[0].replace(/\/?$/, "/");
  const target = base + encodeURIComponent(file.name);
  pushLog(`⬆ upload « ${file.name} » (${file.size} o) → ${target}`);

  const sess = await createUploadSession(target, file.size, file.mime, Date.now());
  const chunkSize = sess.chunk_size && sess.chunk_size > 0 ? sess.chunk_size : Math.max(file.size, 1);
  const n = Math.max(1, Math.ceil(file.size / chunkSize));
  pushLog(`session ${sess.session_id.slice(0, 8)} · ${n} chunk(s) de ${chunkSize} o`);

  try {
    if (n === 1) {
      // Un seul morceau → upload binaire natif (barre de progression fiable).
      const res = await FileSystem.uploadAsync(
        `${apiBase()}/file/upload/${sess.session_id}/0`,
        file.uri,
        {
          httpMethod: "POST",
          uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          headers: {
            Authorization: "Bearer " + bearer(),
            "Content-Type": "application/octet-stream",
          },
        }
      );
      if (res.status >= 300) throw new Error(`Upload refusé (HTTP ${res.status})`);
      onProgress?.(1);
    } else {
      // Plusieurs morceaux : on lit et envoie chaque tranche séquentiellement.
      for (let i = 0; i < n; i++) {
        const offset = i * chunkSize;
        const length = Math.min(chunkSize, file.size - offset);
        const b64 = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.Base64,
          position: offset,
          length,
        });
        const bytes = base64ToBytes(b64);
        const res = await fetch(`${apiBase()}/file/upload/${sess.session_id}/${i}`, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + bearer(),
            "Content-Type": "application/octet-stream",
          },
          body: bytes as any,
        });
        if (res.status >= 300) throw new Error(`Chunk ${i} refusé (HTTP ${res.status})`);
        onProgress?.((i + 1) / n);
      }
    }
    pushLog("✓ upload terminé");
  } catch (e: any) {
    pushLog("✗ upload: " + e.message);
    await deleteUploadSession(sess.session_id, target);
    throw e;
  }
}
