import crypto from 'node:crypto';

/**
 * Canonical JSON mechanics shared by binding consumers. Domain projections and
 * validation remain with their callers; this only sorts object keys and keeps
 * array order while serializing JSON-compatible values.
 *
 * This is deliberately not a raw-file hash, normalized-text hash, or the
 * stricter Bench JSON validator. Those policies retain their own ownership.
 */
export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJson(value[key])]));
  }
  return value;
}

export function digestJson(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableJson(value))).digest('hex');
}
