// Serialize registration and logout cleanup: an old in-flight register cannot land after logout's unregister.
let tail: Promise<unknown> = Promise.resolve();
let epoch = 0;
export const pushRegistrationEpoch = () => epoch;
export const invalidatePushRegistration = () => {
  epoch++;
};
export function serializePushMutation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const result = tail.then(operation, operation);
  tail = result.catch(() => undefined);
  return result;
}
