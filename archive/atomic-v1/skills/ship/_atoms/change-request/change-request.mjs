const PUBLISHABLE = new Set(['verified', 'incomplete', 'handed-back']);

/** Re-read current run authority before each external effect, never a cached grant. */
export function deliveryEffectAllowed(state, effect) {
  return PUBLISHABLE.has(state?.outcome)
    && state?.authority?.status === 'active'
    && state.authority[effect] === true;
}

/**
 * The caller supplies official-provider transports and a live state reader.
 * This boundary performs no merge, approval, force push or handoff.
 */
export async function publishChangeRequest({ readState, push, create }) {
  const stopped = (pushed) => ({ outcome: 'withheld-by-outcome', pushed });
  if (!deliveryEffectAllowed(readState(), 'publish')) return stopped(false);
  let pushed = false;
  try {
    const result = await push();
    if (result?.status !== 'pushed') return { outcome: 'publication-failed', pushed };
    pushed = true;
    if (!deliveryEffectAllowed(readState(), 'publish')) return stopped(pushed);
    const publication = await create();
    if (publication?.outcome !== 'published'
      || typeof publication.identifier !== 'string' || !publication.identifier.trim()) {
      return { outcome: 'publication-failed', pushed };
    }
    return { ...publication, pushed };
  } catch {
    return { outcome: 'publication-failed', pushed };
  }
}
