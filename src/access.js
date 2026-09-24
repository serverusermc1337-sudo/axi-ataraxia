import { setSetting, setting } from "./db.js";

export const PERM_IDS = ["kick", "ban", "timeout", "warn", "clear", "slowmode", "sagen", "modul", "einladen", "rollen", "bots"];

const DEFAULT = {
  member: Object.fromEntries(PERM_IDS.map((id) => [id, false])),
  mod: Object.fromEntries(PERM_IDS.map((id) => [id, ["kick", "timeout", "warn", "clear"].includes(id)])),
};

export function permMatrix() {
  try {
    const parsed = JSON.parse(setting("role_perms", ""));
    if (parsed?.mod && parsed?.member) return parsed;
  } catch {
    /* erste Füllung */
  }
  return structuredClone(DEFAULT);
}

export function setPerm(role, id, on) {
  if ((role !== "mod" && role !== "member") || !PERM_IDS.includes(id)) return false;
  const matrix = permMatrix();
  matrix[role][id] = Boolean(on);
  setSetting("role_perms", JSON.stringify(matrix));
  return true;
}

export function allows(member, perm) {
  if (!member || !PERM_IDS.includes(perm)) return false;
  if (member.id === member.guild?.ownerId) return true;
  if (member.permissions?.has("Administrator")) return true;
  const role = member.roles?.cache?.some((item) => item.name.toLowerCase() === "mod") ? "mod" : "member";
  return Boolean(permMatrix()[role]?.[perm]);
}

export function deny(perm) {
  const label = {
    kick: "Kicken",
    ban: "Sperren",
    timeout: "Timeout",
    warn: "Verwarnen",
    clear: "Nachrichten löschen",
    slowmode: "Slowmode",
    sagen: "Als Axi sagen",
    modul: "Module schalten",
    einladen: "Einladen",
    rollen: "Rollen vergeben",
    bots: "Andere Bots",
  }[perm];
  return `Dir fehlt das Recht ${label}. Der Eigner stellt das unter /recht oder im Web ein.`;
}
