export type ApiErrorKind =
  | 'badRequest'
  | 'unauthorized'
  | 'forbidden'
  | 'conflict'
  | 'unavailable';

export class ApiError extends Error {
  constructor(readonly kind: ApiErrorKind, readonly status?: number) {
    super('Juple API request failed.');
    this.name = 'ApiError';
  }
}
