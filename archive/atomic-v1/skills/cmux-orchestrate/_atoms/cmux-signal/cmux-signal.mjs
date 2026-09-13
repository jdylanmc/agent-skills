export function surfaceTextAsData(text, metadata = {}) {
  return Object.freeze({
    kind: 'cmux_surface_text',
    trusted: false,
    instructionAuthority: 'none',
    text: String(text ?? ''),
    metadata: Object.freeze({ ...metadata }),
  });
}

export function extractSupervisionSignals(surfaceData) {
  const text = surfaceData?.text ?? '';
  return {
    kind: 'cmux_supervision_signals',
    trusted: false,
    containsPromptLikeText: /(^|\n)\s*(system|developer|user|assistant)\s*:/i.test(text),
    exitMentions: [...text.matchAll(/exit\s+(\d+)/gi)].map((m) => Number(m[1])),
    lineCount: text === '' ? 0 : text.split(/\r?\n/).length,
  };
}
