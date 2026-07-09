// Petit bus de logs partagé (visible dans l'app, pas de console sur mobile).
type Sub = (lines: string[]) => void;
let lines: string[] = [];
const subs = new Set<Sub>();

export function pushLog(line: string) {
  const ts = new Date().toLocaleTimeString("fr-FR");
  lines = [...lines.slice(-60), `${ts}  ${line}`];
  subs.forEach((s) => s(lines));
}

export function clearLog() {
  lines = [];
  subs.forEach((s) => s(lines));
}

export function subscribe(fn: Sub): () => void {
  subs.add(fn);
  fn(lines);
  return () => subs.delete(fn);
}
