import { createHash } from 'node:crypto';
import { normalizeWork } from './bench-epoch.mjs';

export function contextSource(uri, revision, text) {
  if (![uri, revision, text].every((value) => typeof value === 'string' && value.trim()) ||
    /[\r\n]/.test(uri + revision) || Buffer.byteLength(text) > 20000) {
    throw new Error('context needs a bounded source text, exact source identity and version/line selection');
  }
  return { uri, revision, text, sha256: createHash('sha256').update(text).digest('hex') };
}

// The invoking agent supplies its faithful transcription and retrieved evidence.
// This helper neither interprets human authority nor fetches/resolves arbitrary sources.
export function prepareWork(task, sources = []) {
  if (typeof task?.requirements !== 'string' || !task.requirements.trim()) throw new Error('task requirements must be faithfully supplied');
  if (!Array.isArray(sources) || sources.length > 12) throw new Error('too many context sources');
  let total = 0;
  const context = sources.map((source) => {
    const verified = contextSource(source.uri, source.revision, source.text);
    if (verified.sha256 !== source.sha256) throw new Error('context source digest mismatch');
    total += Buffer.byteLength(source.text);
    return `\n\n[Context: ${source.uri} | ${source.revision} | sha256 ${source.sha256}]\n${source.text}\n[End context]`;
  }).join('');
  if (total > 60000) throw new Error('context exceeds its bound; select relevant source sections explicitly, never silently truncate');
  return normalizeWork({ ...task, requirements: `${task.requirements}${context}` });
}
