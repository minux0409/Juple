/**
 * Reads display-only claims from an already-issued, already-persisted Entra ID token, entirely
 * client-side - signature validation already happened server-side/at Entra, this is only for
 * showing something like the user's email on My Page, never for authorization decisions.
 *
 * Decodes the JWT payload segment with a hand-written base64url decoder rather than relying on
 * `global.atob` (its availability under Hermes isn't guaranteed) or adding a new dependency.
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeBase64Url(segment: string): string | null {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);

  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (const char of padded) {
    if (char === '=') {
      break;
    }
    const value = BASE64_ALPHABET.indexOf(char);
    if (value === -1) {
      return null;
    }
    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  try {
    return decodeUtf8Bytes(bytes);
  } catch {
    return null;
  }
}

function decodeUtf8Bytes(bytes: readonly number[]): string {
  let result = '';
  let index = 0;
  while (index < bytes.length) {
    const byte1 = bytes[index++];
    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
    } else if (byte1 >= 0xc0 && byte1 < 0xe0 && index < bytes.length) {
      const byte2 = bytes[index++];
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
    } else if (byte1 >= 0xe0 && byte1 < 0xf0 && index + 1 < bytes.length) {
      const byte2 = bytes[index++];
      const byte3 = bytes[index++];
      result += String.fromCharCode(
        ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f),
      );
    } else if (byte1 >= 0xf0 && index + 2 < bytes.length) {
      const byte2 = bytes[index++];
      const byte3 = bytes[index++];
      const byte4 = bytes[index++];
      const codepoint =
        ((byte1 & 0x07) << 18) | ((byte2 & 0x3f) << 12) | ((byte3 & 0x3f) << 6) | (byte4 & 0x3f);
      result += String.fromCodePoint(codepoint);
    } else {
      result += String.fromCharCode(byte1);
    }
  }
  return result;
}

/** Decodes a JWT's payload segment. Returns null (never throws) on any malformed input. */
export function decodeIdTokenClaims(idToken: string): Record<string, unknown> | null {
  const segments = idToken.split('.');
  if (segments.length < 2) {
    return null;
  }

  const payloadJson = decodeBase64Url(segments[1]);
  if (payloadJson === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(payloadJson);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Checks 'email', then 'preferred_username', then 'upn', in that order. Null if none is a non-empty string. */
export function extractEmailClaim(claims: Record<string, unknown> | null): string | null {
  if (!claims) {
    return null;
  }
  for (const key of ['email', 'preferred_username', 'upn']) {
    const value = claims[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}
