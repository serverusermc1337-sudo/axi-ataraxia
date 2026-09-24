const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE = /(?:\+\d{1,3}[\s-]?)?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,}[\s-]?\d{2,}/;
const ATTACK = /\b(ignore (all|previous)|system prompt|jailbreak|token|selfbot|massdm|raid|doxx|brute[- ]?force)\b/i;

export function personalData(text) {
  const value = text ?? "";
  if (EMAIL.test(value)) return "E-Mail";
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 8 && PHONE.test(value)) return "Telefonnummer";
  return null;
}

export function infiltration(text) {
  return ATTACK.test(text ?? "");
}

export function cleanKey(key) {
  return String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\//, "")
    .replace(/^!/, "");
}

export const KEY = /^[a-z0-9äöüß]{2,16}$/;
