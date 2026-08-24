import fs from 'node:fs';

const EVIDENCE_TYPE_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;
const MIN_IDENTIFIER_LENGTH = 5;

function failConfig(message) {
  const error = new Error(message);
  error.code = 'malformed_config';
  throw error;
}

function parseConfig(raw, source) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failConfig(`${source} is not valid JSON`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    failConfig(`${source} must contain a JSON object`);
  }
  if (parsed.version !== 1) {
    failConfig(`${source} must declare version 1`);
  }
  if (!Array.isArray(parsed.identifiers)) {
    failConfig(`${source}.identifiers must be an array`);
  }

  const identifiers = parsed.identifiers.map((entry, index) => {
    const location = `${source}.identifiers[${index}]`;
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      failConfig(`${location} must be an object`);
    }
    if (typeof entry.value !== 'string' || !entry.value.trim()) {
      failConfig(`${location}.value must be a non-empty string`);
    }
    if (
      typeof entry.evidenceType !== 'string'
      || !EVIDENCE_TYPE_PATTERN.test(entry.evidenceType)
    ) {
      failConfig(`${location}.evidenceType must be a lowercase kebab-case name`);
    }
    const normalized = normalizeIdentifier(entry.value);
    if (normalized.length < MIN_IDENTIFIER_LENGTH) {
      failConfig(
        `${location}.value must contain at least ${MIN_IDENTIFIER_LENGTH} letters or digits`,
      );
    }
    return {
      value: entry.value,
      evidenceType: entry.evidenceType,
      normalized,
    };
  });

  return { version: 1, identifiers };
}

export function loadIdentifierConfig({ file, json } = {}) {
  if (file) {
    return parseConfig(fs.readFileSync(file, 'utf8'), file);
  }
  if (json) {
    return parseConfig(json, 'REDACT_SENSITIVE_CONFIG_JSON');
  }
  return { version: 1, identifiers: [] };
}

export function normalizeIdentifier(value) {
  return [...value]
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .join('')
    .toLocaleLowerCase('en-US');
}

function normalizedText(value) {
  let normalized = '';
  const offsets = [];
  for (let index = 0; index < value.length; index += 1) {
    const marker = /^\[REDACTED:[a-z][a-z0-9-]*\]/.exec(value.slice(index));
    if (marker) {
      index += marker[0].length - 1;
      continue;
    }
    const character = value[index];
    if (/[\p{L}\p{N}]/u.test(character)) {
      normalized += character.toLocaleLowerCase('en-US');
      offsets.push(index);
    }
  }
  return { normalized, offsets };
}

function isIdentifierCharacter(character) {
  return character !== undefined && /[\p{L}\p{N}]/u.test(character);
}

export function findConfiguredIdentifiers(value, identifiers) {
  const text = normalizedText(value);
  const findings = [];

  for (const identifier of identifiers) {
    let from = 0;
    while (from <= text.normalized.length - identifier.normalized.length) {
      const match = text.normalized.indexOf(identifier.normalized, from);
      if (match === -1) {
        break;
      }
      const start = text.offsets[match];
      const endOffset = match + identifier.normalized.length - 1;
      const end = text.offsets[endOffset] + 1;
      if (!isIdentifierCharacter(value[start - 1]) && !isIdentifierCharacter(value[end])) {
        findings.push({ start, end, evidenceType: identifier.evidenceType });
      }
      from = match + identifier.normalized.length;
    }
  }

  const accepted = [];
  for (const finding of findings.sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )) {
    if (accepted.length === 0 || finding.start >= accepted.at(-1).end) {
      accepted.push(finding);
    }
  }
  return accepted;
}

export function redactConfiguredIdentifiers(value, identifiers) {
  const findings = findConfiguredIdentifiers(value, identifiers);
  const counts = new Map();
  let text = '';
  let cursor = 0;

  for (const finding of findings) {
    text += `${value.slice(cursor, finding.start)}[REDACTED:${finding.evidenceType}]`;
    cursor = finding.end;
    counts.set(finding.evidenceType, (counts.get(finding.evidenceType) ?? 0) + 1);
  }
  text += value.slice(cursor);

  return {
    text,
    redactions: [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => left.category.localeCompare(right.category)),
  };
}
