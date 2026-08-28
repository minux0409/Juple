/**
 * Minimal payload persisted in secure storage to restore an Entra session.
 * Never include the access token here; it stays in memory only.
 */
export interface AuthSession {
  readonly refreshToken: string;
  readonly idToken?: string;
}
