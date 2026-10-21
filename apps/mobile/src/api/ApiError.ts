export type ApiErrorKind =
  | 'badRequest'
  | 'unauthorized'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'timeout'
  | 'unavailable'
  | 'tooManyRequests';

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, readonly status?: number, readonly code?: string, readonly retryAfterSeconds?: number) {
    super('Juple API request failed.');
    this.name = 'ApiError';
  }
}
