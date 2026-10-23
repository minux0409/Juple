/** Delta seconds or HTTP-date, without durable client state. */
export function retryAfterSeconds(value: string | null | undefined, now = Date.now()): number {
  if (!value) return 2;
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(86400, Math.ceil(seconds))) : 2;
}

/** Display/admission hint ONLY. JWT signature validation and authorization remain on the API.
 * A refresh for the same tid/oid must not erase Retry-After. No Buffer/atob dependency on Hermes.
 */
function cooldownIdentity(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const payload = token.split('.')[1];
    if (payload && payload.length <= 65536) {
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const bytes: number[] = [];
      let buffer = 0;
      let bits = 0;
      for (const char of payload.replace(/-/g, '+').replace(/_/g, '/').replace(/(?:=)+$/, '')) {
        const value = alphabet.indexOf(char);
        if (value < 0) throw new Error('Malformed payload.');
        buffer = buffer * 64 + value;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          bytes.push(Math.floor(buffer / 2 ** bits));
          buffer %= 2 ** bits;
        }
      }
      const json = decodeURIComponent(bytes.map(value => `%${value.toString(16).padStart(2, '0')}`).join(''));
      const claims = JSON.parse(json) as { tid?: unknown; oid?: unknown } | null;
      const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof claims?.tid === 'string' && typeof claims.oid === 'string' && guid.test(claims.tid) && guid.test(claims.oid)) {
        return `account:${claims.tid.toLowerCase()}:${claims.oid.toLowerCase()}`;
      }
    }
  } catch { /* Opaque/malformed credentials still have a bounded, local fallback; never log. */ }
  return `opaque:${token}`;
}

/** Bounded cooldown for repeated calls, not an automatic retry queue. Writes are never replayed. */
export class RequestCooldown {
  private readonly deadlines = new Map<string, number>();
  private scope: string | undefined;
  private initialized = false;

  remaining(scope: string | undefined, method: string, path: string): number {
    this.select(scope);
    const key = this.key(method, path);
    const deadline = Math.max(this.deadlines.get(key) ?? 0, isBrowseRead(method, path) ? this.deadlines.get('browse') ?? 0 : 0);
    if (deadline <= Date.now()) { this.deadlines.delete(key); return 0; }
    return Math.ceil((deadline - Date.now()) / 1000);
  }

  defer(scope: string | undefined, method: string, path: string, seconds: number, limiter?: string): void {
    // An old account's in-flight response cannot overwrite the new account's cooldown state.
    if (!this.initialized) this.select(scope);
    if (cooldownIdentity(scope) !== this.scope) return;
    for (const [key, deadline] of this.deadlines) if (deadline <= Date.now()) this.deadlines.delete(key);
    if (this.deadlines.size >= 64) this.deadlines.delete(this.deadlines.keys().next().value!);
    const key = (limiter === 'browse' || limiter === 'browse-burst') && isBrowseRead(method, path) ? 'browse' : this.key(method, path);
    this.deadlines.set(key, Math.max(this.deadlines.get(key) ?? 0, Date.now() + seconds * 1000));
  }

  private select(scope: string | undefined): void {
    const identity = cooldownIdentity(scope);
    if (!this.initialized || identity !== this.scope) {
      this.deadlines.clear(); this.scope = identity; this.initialized = true;
    }
  }

  private key(method: string, path: string): string {
    return `${method}:${path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id').slice(0, 256)}`;
  }
}


/** Mirror only the server's read-only browsing allowlist; never delay login, logout or writes. */
function isBrowseRead(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  const route = path.split('?')[0];
  return /^\/api\/v1\/items\/(?:history(?:\/(?:count|sections|date))?|\d+(?:\/images)?)$/.test(route)
    || /^\/api\/v1\/collections(?:\/search-suggestions|\/\d+(?:\/(?:items(?:\/(?:sections|\d+))?|collaborators|participants|share(?:\/link)?))?)?$/.test(route);
}
