export type Kind = "video" | "audio" | "image" | "pdf" | "archive" | "doc" | "code" | "file";

export type Tint = { bg: string; fg: string };
export type Palette = {
  dark: boolean;
  bg: string; bg2: string; card: string; cardAlt: string; border: string;
  text: string; sub: string; faint: string;
  accent: string; accent2: string; accentDim: string;
  danger: string; green: string; warn: string;
  folder: Tint;
  kindTint: Record<Kind, Tint>;
};

export const dark: Palette = {
  dark: true,
  bg: "#0d1117", bg2: "#11161f", card: "#161c26", cardAlt: "#1e2632", border: "#232c3a",
  text: "#eef2f7", sub: "#8a97a8", faint: "#5b6675",
  accent: "#3d8bff", accent2: "#5b8cff", accentDim: "#16233a",
  danger: "#ff5c5c", green: "#35d18a", warn: "#ffb454",
  folder: { bg: "#242c1f", fg: "#d8c46b" },
  kindTint: {
    video: { bg: "#2a1f3d", fg: "#c08cff" },
    audio: { bg: "#1f2f3d", fg: "#5bc0ff" },
    image: { bg: "#1f3d2f", fg: "#5bd6a0" },
    pdf: { bg: "#3d1f22", fg: "#ff7a7a" },
    archive: { bg: "#3d341f", fg: "#ffcf6b" },
    doc: { bg: "#1f2a3d", fg: "#7aa8ff" },
    code: { bg: "#2a2f3d", fg: "#9fb0c8" },
    file: { bg: "#232c3a", fg: "#8a97a8" },
  },
};

// Palette claire — inspirée de l'app iOS Cloudreve (fond blanc, épuré).
export const light: Palette = {
  dark: false,
  bg: "#f4f5f7", bg2: "#ffffff", card: "#ffffff", cardAlt: "#eef0f3", border: "#e4e7ec",
  text: "#1a1f2b", sub: "#6b7684", faint: "#a3adbb",
  accent: "#2f7bf6", accent2: "#2f7bf6", accentDim: "#e7f0fe",
  danger: "#ff3b30", green: "#22a06b", warn: "#f59e0b",
  folder: { bg: "#fef6e0", fg: "#c99a1e" },
  kindTint: {
    video: { bg: "#f1e9fe", fg: "#8b3dff" },
    audio: { bg: "#e6f4fe", fg: "#0a84d1" },
    image: { bg: "#e4f7ee", fg: "#12a05e" },
    pdf: { bg: "#feeaea", fg: "#e0352b" },
    archive: { bg: "#fdf3df", fg: "#c98a10" },
    doc: { bg: "#e8f0fe", fg: "#2f6bd6" },
    code: { bg: "#eef1f5", fg: "#5b6675" },
    file: { bg: "#eef0f3", fg: "#6b7684" },
  },
};

export type ThemeMode = "system" | "light" | "dark";

export function fmtSize(n: number): string {
  if (!n) return "—";
  const u = ["o", "Ko", "Mo", "Go", "To"];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(v < 10 && i > 0 ? 1 : 0) + " " + u[i];
}

export function fmtDate(s: string): string {
  try {
    return new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return ""; }
}

export function kindOf(name: string): Kind {
  const e = name.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "mkv", "avi", "mov", "webm", "m4v", "flv", "wmv", "ts"].includes(e)) return "video";
  if (["mp3", "flac", "wav", "aac", "ogg", "m4a", "opus"].includes(e)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "svg"].includes(e)) return "image";
  if (e === "pdf") return "pdf";
  if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(e)) return "archive";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "txt", "md", "rtf"].includes(e)) return "doc";
  if (["js", "ts", "py", "go", "java", "c", "cpp", "json", "yml", "yaml", "sh", "html", "css"].includes(e)) return "code";
  return "file";
}

export const kindFeather: Record<Kind, string> = {
  video: "film", audio: "music", image: "image", pdf: "file-text",
  archive: "archive", doc: "file-text", code: "code", file: "file",
};
