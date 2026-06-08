/**
 * Name normalization helpers used by both the matcher and the AD-prefix suggester.
 * Conservative — strips diacritics, lowercases, collapses spaces. Keeps letters only.
 */

export function normalize(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z\s'-]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface SplitName {
  firstName: string;
  lastName: string;
  fullName: string;
}

export function splitName(raw: string): SplitName | null {
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  const parts = cleaned.split(" ");
  if (parts.length === 1) {
    return { firstName: parts[0]!, lastName: "", fullName: parts[0]! };
  }
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(" "),
    fullName: parts.join(" "),
  };
}
