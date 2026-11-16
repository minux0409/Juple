import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The one-time welcome for a NEW account's free month. Who is new is the server's answer (bootstrap `newAccountTrialGranted`, true only in
 * the response of the request that created the account with its own fresh trial), so an existing member, a re-created account given back
 * its earlier window and every other device never see it. This device only remembers the answer until the welcome has been shown, so an
 * app that is closed before Home appears still shows it on the next launch - and never again after it was closed.
 *
 * Values per Juple ID: 'pending' (told by the server, not shown yet) and 'shown'.
 */
export function welcomeTrialKey(userKey: string): string {
  return `juple.welcomeTrial.${userKey}`;
}

/** Records the server's "new account with a free month" once; never turns a 'shown' welcome back into a pending one. */
export async function rememberWelcomeTrial(userKey: string): Promise<void> {
  try {
    const key = welcomeTrialKey(userKey);
    if ((await AsyncStorage.getItem(key)) === null) {
      await AsyncStorage.setItem(key, 'pending');
    }
  } catch {
    // Best effort: without storage the welcome can still be shown in this launch.
  }
}

/**
 * The stored answer: true (pending), false (shown, or never told), or null when storage cannot be read - the caller then relies on the
 * server's answer in this launch only, so a welcome that cannot be remembered never comes back on every launch.
 */
export async function isWelcomeTrialPending(userKey: string): Promise<boolean | null> {
  try {
    return (await AsyncStorage.getItem(welcomeTrialKey(userKey))) === 'pending';
  } catch {
    return null;
  }
}

export async function markWelcomeTrialShown(userKey: string): Promise<void> {
  try {
    await AsyncStorage.setItem(welcomeTrialKey(userKey), 'shown');
  } catch {
    // Best effort.
  }
}
