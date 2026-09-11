/* Builds a "?a=1&b=2" query string from a plain object, skipping
 * undefined/null/empty-string values so callers can pass an options bag
 * straight through without filtering it themselves first. Returns "" (not
 * "?") when nothing is set, so callers can always do `${path}${qs(...)}`. */
export function toQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}
