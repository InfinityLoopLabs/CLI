const DASH_PREFIX = /^-+/;

export function normalizeKey(raw: string): string {
  const trimmed = raw.replace(DASH_PREFIX, "").trim();
  if (!trimmed) {
    return "";
  }

  const tokens = trimmed.split(/[-_\s]+/).filter(Boolean);
  if (tokens.length === 0) {
    return "";
  }

  return tokens
    .map((token, index) => {
      const lower = token.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
}
