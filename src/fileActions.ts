// Ouverture / téléchargement natif des fichiers — le coeur de l'app.
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import { Platform, Alert } from "react-native";
import { getDownloadUrl, FileItem } from "./api";
import { pushLog } from "./logstore";

const MIME: Record<string, string> = {
  mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo", mov: "video/quicktime",
  webm: "video/webm", m4v: "video/mp4", flv: "video/x-flv", wmv: "video/x-ms-wmv",
  mp3: "audio/mpeg", flac: "audio/flac", wav: "audio/wav", aac: "audio/aac", ogg: "audio/ogg",
  m4a: "audio/mp4", opus: "audio/opus",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  bmp: "image/bmp", heic: "image/heic", svg: "image/svg+xml",
  pdf: "application/pdf",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  tar: "application/x-tar", gz: "application/gzip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", md: "text/markdown", json: "application/json", csv: "text/csv",
};

function mimeOf(name: string): string {
  const e = name.split(".").pop()?.toLowerCase() || "";
  return MIME[e] || "application/octet-stream";
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export type Progress = (ratio: number) => void;

// Télécharge le fichier dans le cache local et renvoie l'URI locale.
export async function downloadToCache(item: FileItem, onProgress?: Progress): Promise<string> {
  const url = await getDownloadUrl(item.path);
  if (!url) throw new Error("URL de téléchargement indisponible");
  const target = FileSystem.cacheDirectory + safeName(item.name);
  pushLog("⬇ download → " + target.split("/").pop());
  const dl = FileSystem.createDownloadResumable(url, target, {}, (p) => {
    if (onProgress && p.totalBytesExpectedToWrite > 0)
      onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });
  // Garde-fou : si le serveur ne répond pas, on abandonne au lieu de tourner à l'infini.
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error("Délai dépassé (le serveur n'a pas répondu à temps)")), 90000)
  );
  const res = await Promise.race([dl.downloadAsync(), timeout]);
  if (!res?.uri) throw new Error("Échec du téléchargement");
  pushLog("✓ téléchargé (HTTP " + (res.status ?? "?") + ")");
  return res.uri;
}

// Ouvre le fichier dans l'app native adaptée (VLC/lecteur vidéo, lecteur PDF, etc.).
export async function openNative(item: FileItem, onProgress?: Progress): Promise<void> {
  const localUri = await downloadToCache(item, onProgress);
  const mime = mimeOf(item.name);
  if (Platform.OS === "android") {
    const contentUri = await FileSystem.getContentUriAsync(localUri);
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: mime,
      });
      return;
    } catch {
      // aucune app par défaut pour ce type → on retombe sur la feuille de partage
    }
  }
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(localUri, { mimeType: mime, dialogTitle: item.name });
  } else {
    Alert.alert("Impossible d'ouvrir", "Aucune application disponible pour ce type de fichier.");
  }
}

// Enregistre le fichier via la feuille de partage Android (→ Téléchargements, Drive, etc.).
export async function saveOrShare(item: FileItem, onProgress?: Progress): Promise<void> {
  const localUri = await downloadToCache(item, onProgress);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(localUri, { mimeType: mimeOf(item.name), dialogTitle: item.name });
  }
}
