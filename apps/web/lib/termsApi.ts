import type { AppApi } from './appApi.ts';
import { isTermsRequired, parseTermsStatus, type TermsStatus } from './safety.ts';

/** Keeps action-specific purchase refusals separate from global terms enforcement. */
export function createTermsAwareApi(rawApi: AppApi, handlers: {
  onRequired: () => void;
  onStatus: (status: TermsStatus) => void;
  onOtherError: (error: unknown) => void;
}) {
  let generation = 0;
  const request: AppApi = async options => {
    const epoch = generation;
    try { return await rawApi(options); }
    catch (error) {
      if (epoch === generation) {
        if (isTermsRequired(error)) {
          handlers.onRequired();
          rawApi<unknown>({ method: 'GET', path: '/api/v1/users/me/terms' }).then(raw => {
            if (epoch !== generation) return;
            const status = parseTermsStatus(raw);
            if (status) handlers.onStatus(status);
          }).catch(() => undefined);
        }
        handlers.onOtherError(error);
      }
      throw error;
    }
  };
  return { request, invalidateSession: () => { generation++; } };
}
