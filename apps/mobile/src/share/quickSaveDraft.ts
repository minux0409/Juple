/**
 * Sentinel for "no category selected" on NativeIncomingShare.submitQuickSaveDraft - collection ids
 * are positive bigint identities server-side, so this value can never collide with a real one.
 * Used instead of a nullable number because TurboModule codegen maps a plain `number` parameter
 * more predictably than an optional one.
 */
export const NO_COLLECTION_ID = -1;

/** Wire values reported by NativeIncomingShare.getQuickSaveOutcome. */
export type QuickSaveOutcome =
  | 'pending'
  | 'success'
  | 'reviewRequired'
  | 'authenticationRequired'
  | 'retryableFailure'
  | 'permanentFailure';
