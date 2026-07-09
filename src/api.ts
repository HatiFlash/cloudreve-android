// Client API Cloudreve V4 — endpoints extraits du bundle réel de l'instance.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// SecureStore n'existe pas sur le web (export de test) → repli sur AsyncStorage.
const secureGet = (k: string) =>
  Platform.OS === "web" ? AsyncStorage.getItem(k) : SecureStore.getItemAsync(k);
const secureSet = (k: string, v: string) =>
  Platform.OS === "web" ? AsyncStorage.setItem(k, v) : SecureStore.setItemAsync(k, v);
const secureDel = (k: string) =>
  Platform.OS === "web" ? AsyncStorage.removeItem(k) : SecureStore.deleteItemAsync(k);

export type FileItem = {
  type: number; // 0 = fichier, 1 = dossier
  name: string;
  size: number;
  updated_at: string;
  path: string; // uri cloudreve://my/...
  metadata?: Record<string, string>;
  primary_entity?: string;
};

const K_ACCESS = "cr_access";
const K_REFRESH = "cr_refresh";
const K_SERVER = "cr_server";
const K_USER = "cr_user";

export type Me = { id?: string; nickname: string; email: string; avatar?: string };

// Décodage base64url → texte (pour lire le payload du JWT, sans atob en RN).
const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64ToStr(b64: string): string {
  const clean = b64.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64C.indexOf(clean[i]), b = B64C.indexOf(clean[i + 1]);
    const c = B64C.indexOf(clean[i + 2]), d = B64C.indexOf(clean[i + 3]);
    const n = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    out += String.fromCharCode((n >> 16) & 255);
    if (c >= 0) out += String.fromCharCode((n >> 8) & 255);
    if (d >= 0) out += String.fromCharCode(n & 255);
  }
  try { return decodeURIComponent(escape(out)); } catch { return out; }
}
function jwtUserId(token: string): string {
  try {
    const p = JSON.parse(b64ToStr(token.split(".")[1] || ""));
    return String(p.sub || p.uid || p.user_id || p.id || p.u || "");
  } catch { return ""; }
}

export async function getUser(): Promise<Me> {
  try {
    const raw = await AsyncStorage.getItem(K_USER);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { nickname: "", email: "" };
}

// Récupère le profil frais depuis l'API (id via le JWT si pas déjà stocké).
export async function fetchMe(): Promise<Me> {
  const stored = await getUser();
  const id = stored.id || jwtUserId(accessToken);
  if (!id) return stored;
  try {
    const u = await api<any>("GET", "/user/info/" + id);
    const me: Me = {
      id,
      nickname: u?.nickname || u?.name || stored.nickname || "",
      email: u?.email || stored.email || "",
      avatar: u?.avatar || "",
    };
    await AsyncStorage.setItem(K_USER, JSON.stringify(me));
    return me;
  } catch {
    return { ...stored, id };
  }
}

// URL de l'avatar (nécessite l'en-tête d'auth) ; "" si pas d'avatar.
export function avatarUrl(me: Me): string {
  if (!me.id || !me.avatar) return "";
  return serverUrl + "/api/v4/user/avatar/" + me.id;
}

let serverUrl = "";
let accessToken = "";
let refreshToken = "";

export async function loadSession(): Promise<boolean> {
  serverUrl = (await AsyncStorage.getItem(K_SERVER)) || "";
  accessToken = (await secureGet(K_ACCESS)) || "";
  refreshToken = (await secureGet(K_REFRESH)) || "";
  return !!(serverUrl && accessToken);
}

export function getServer(): string {
  return serverUrl;
}

async function persist() {
  await AsyncStorage.setItem(K_SERVER, serverUrl);
  await secureSet(K_ACCESS, accessToken);
  await secureSet(K_REFRESH, refreshToken);
}

export async function logout() {
  serverUrl = accessToken = refreshToken = "";
  await AsyncStorage.removeItem(K_SERVER);
  await AsyncStorage.removeItem(K_USER);
  await secureDel(K_ACCESS);
  await secureDel(K_REFRESH);
}

export function serverUrlValue(): string {
  return serverUrl;
}

function normalizeServer(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(u)) u = "https://" + u;
  return u;
}

type ApiResp<T> = { code: number; msg: string; data: T };

import { pushLog as log } from "./logstore";
export { log };

async function raw<T>(method: string, path: string, body?: any, auth = true): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && accessToken) headers.Authorization = "Bearer " + accessToken;
  const url = serverUrl + "/api/v4" + path;
  log(`→ ${method} ${url}`);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e: any) {
    log(`✗ réseau: ${e.message}`);
    const err: any = new Error(
      "Serveur injoignable (" + e.message + "). Vérifie l'adresse et que le téléphone atteint le serveur."
    );
    err.network = true;
    throw err;
  }
  log(`← HTTP ${res.status}`);
  const text = await res.text();
  let json: ApiResp<T>;
  try {
    json = JSON.parse(text) as ApiResp<T>;
  } catch {
    log(`✗ réponse non-JSON: ${text.slice(0, 80)}`);
    throw new Error("Réponse inattendue du serveur (HTTP " + res.status + ")");
  }
  if (json.code !== 0) {
    log(`✗ API code ${json.code}: ${json.msg}`);
    const err: any = new Error(json.msg || "Erreur API (code " + json.code + ")");
    err.code = json.code;
    throw err;
  }
  log(`✓ ok`);
  return json.data;
}

async function api<T>(method: string, path: string, body?: any): Promise<T> {
  try {
    return await raw<T>(method, path, body);
  } catch (e: any) {
    // AccessToken expiré → refresh puis retry une fois
    if ((e.code === 40001 || e.code === 401) && refreshToken) {
      await doRefresh();
      return await raw<T>(method, path, body);
    }
    throw e;
  }
}

async function doRefresh() {
  const data = await raw<{ access_token: string; refresh_token: string }>(
    "POST",
    "/session/token/refresh",
    { refresh_token: refreshToken },
    false
  );
  accessToken = data.access_token;
  refreshToken = data.refresh_token;
  await persist();
}

export async function login(server: string, email: string, password: string) {
  serverUrl = normalizeServer(server);
  const data = await raw<{ token: { access_token: string; refresh_token: string }; user?: any }>(
    "POST",
    "/session/token",
    { email, password },
    false
  );
  accessToken = data.token.access_token;
  refreshToken = data.token.refresh_token;
  await persist();
  const me: Me = {
    id: data.user?.id ? String(data.user.id) : undefined,
    nickname: data.user?.nickname || data.user?.name || "",
    email: data.user?.email || email,
    avatar: data.user?.avatar || "",
  };
  try { await AsyncStorage.setItem(K_USER, JSON.stringify(me)); } catch {}
}

// Liste le contenu d'un dossier. uri par défaut = racine perso.
export async function listFiles(uri = "cloudreve://my/"): Promise<FileItem[]> {
  const data = await api<{ files: FileItem[] }>(
    "GET",
    "/file?uri=" + encodeURIComponent(uri) + "&page_size=200&order_by=name&order_direction=asc"
  );
  return data.files || [];
}

// Force une URL à passer par le serveur HTTPS configuré (évite le HTTP en clair
// vers l'IP interne, bloqué par Android). On garde chemin + query (la signature
// porte sur le chemin, pas sur l'hôte), on remplace juste l'origine.
function viaServer(url: string): string {
  if (!url) return url;
  // Manipulation purement textuelle (la classe URL est incomplète en React Native).
  if (/^https?:\/\//i.test(url)) {
    // remplace le schéma + hôte(:port) par serverUrl, garde chemin + query
    return url.replace(/^https?:\/\/[^/]+/i, serverUrl);
  }
  return serverUrl + (url.startsWith("/") ? "" : "/") + url;
}

// URL de téléchargement direct (signée) pour un fichier.
export async function getDownloadUrl(uri: string): Promise<string> {
  const data = await api<{ urls: { url: string }[] }>("POST", "/file/url", {
    uris: [uri],
    download: true,
    skip_error: true,
  });
  const rawUrl = data.urls?.[0]?.url || "";
  log("url brute: " + rawUrl.slice(0, 90));
  const finalUrl = viaServer(rawUrl);
  log("url finale: " + finalUrl.slice(0, 90));
  return finalUrl;
}

// Récupère l'URL réelle de la miniature d'un fichier (le endpoint renvoie
// {url, expires} pointant vers l'image ; "" si le fichier n'a pas de vignette).
export async function getThumb(uri: string): Promise<string> {
  try {
    const d = await api<{ url: string }>(
      "GET",
      "/file/thumb?uri=" + encodeURIComponent(uri)
    );
    return viaServer(d?.url || "");
  } catch {
    return "";
  }
}

export function authHeader(): Record<string, string> {
  return accessToken ? { Authorization: "Bearer " + accessToken } : {};
}

export function apiBase(): string {
  return serverUrl + "/api/v4";
}
export function bearer(): string {
  return accessToken;
}

export type UploadSession = {
  session_id: string;
  chunk_size: number;
  expires: number;
  upload_urls?: string[];
  storage_policy?: { id: string; type: string };
};

// Crée une session d'upload pour un fichier cible (uri cloudreve://my/dossier/nom).
export async function createUploadSession(
  uri: string,
  size: number,
  mime: string,
  lastModified: number
): Promise<UploadSession> {
  return api<UploadSession>("PUT", "/file/upload", {
    uri,
    size,
    mime_type: mime || "application/octet-stream",
    last_modified: lastModified,
  });
}

// Annule/supprime une session d'upload (nettoyage en cas d'échec).
export async function deleteUploadSession(sessionId: string, uri: string) {
  try {
    await api("DELETE", "/file/upload", { id: sessionId, uri });
  } catch {}
}

// Quota de stockage de l'utilisateur (octets).
export async function getCapacity(): Promise<{ total: number; used: number }> {
  const d = await api<{ total: number; used: number }>("GET", "/user/capacity");
  return { total: d?.total || 0, used: d?.used || 0 };
}

export async function createFolder(parentUri: string, name: string) {
  const uri = parentUri.replace(/\/+$/, "") + "/" + name;
  await api("POST", "/file/create", { type: "folder", uri });
}

export async function renameFile(uri: string, newName: string) {
  await api("POST", "/file/rename", { uri, new_name: newName });
}

export async function deleteFiles(uris: string[]) {
  await api("DELETE", "/file", { uris });
}

// Change le mot de passe (PATCH /user/setting). Lève une erreur si l'actuel est faux.
export async function changePassword(current: string, next: string) {
  await api("PATCH", "/user/setting", { current_password: current, new_password: next });
}
