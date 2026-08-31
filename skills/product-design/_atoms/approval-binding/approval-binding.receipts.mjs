import crypto from 'node:crypto';

export const RECEIPT_ENVELOPE_SCHEMA = 'product-design-append-only-envelope/v1';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

function verifiedPayloads({ envelopes, trustedPublicKeys, streamId }) {
  if (!Array.isArray(envelopes) || !(trustedPublicKeys instanceof Map) || typeof streamId !== 'string') {
    throw new TypeError('envelopes, trustedPublicKeys Map, and streamId are required');
  }
  const result = new Map();
  let previousDigest = null;
  let previousSequence = -1;
  for (const envelope of envelopes) {
    const fields = [
      'schema', 'streamId', 'sequence', 'previousDigest', 'payloadId',
      'payload', 'payloadDigest', 'keyId', 'signature', 'envelopeDigest',
    ];
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)
      || JSON.stringify(Object.keys(envelope).sort()) !== JSON.stringify(fields.sort())) {
      throw new Error('invalid receipt envelope shape');
    }
    if (envelope.schema !== RECEIPT_ENVELOPE_SCHEMA || envelope.streamId !== streamId
      || !Number.isSafeInteger(envelope.sequence) || envelope.sequence <= previousSequence
      || envelope.previousDigest !== previousDigest) {
      throw new Error('receipt envelope chain is invalid');
    }
    const payloadBytes = canonical(envelope.payload);
    if (digest(payloadBytes) !== envelope.payloadDigest) throw new Error('receipt payload digest mismatch');
    const signed = canonical({
      schema: envelope.schema,
      streamId: envelope.streamId,
      sequence: envelope.sequence,
      previousDigest: envelope.previousDigest,
      payloadId: envelope.payloadId,
      payloadDigest: envelope.payloadDigest,
      keyId: envelope.keyId,
    });
    const key = trustedPublicKeys.get(envelope.keyId);
    if (!key || !crypto.verify(null, Buffer.from(signed), key, Buffer.from(envelope.signature, 'base64'))) {
      throw new Error('receipt envelope signature is invalid');
    }
    const computedEnvelopeDigest = digest(canonical({
      schema: envelope.schema,
      streamId: envelope.streamId,
      sequence: envelope.sequence,
      previousDigest: envelope.previousDigest,
      payloadId: envelope.payloadId,
      payloadDigest: envelope.payloadDigest,
      keyId: envelope.keyId,
      signature: envelope.signature,
    }));
    if (computedEnvelopeDigest !== envelope.envelopeDigest || result.has(envelope.payloadId)) {
      throw new Error('receipt envelope digest or payload identity is invalid');
    }
    result.set(envelope.payloadId, payloadBytes);
    previousDigest = envelope.envelopeDigest;
    previousSequence = envelope.sequence;
  }
  return result;
}

export function createAppendOnlyEventVerifier(options) {
  const payloads = verifiedPayloads(options);
  return (event) => {
    const payloadId = event?.receiptId ?? event?.eventId ?? event?.observationId;
    return typeof payloadId === 'string' && payloads.get(payloadId) === canonical(event);
  };
}

export const createHumanReceiptVerifier = createAppendOnlyEventVerifier;
export const createSpecialistEventVerifier = createAppendOnlyEventVerifier;
export const createWalkthroughObservationVerifier = createAppendOnlyEventVerifier;
