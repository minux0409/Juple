import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fetchAppUpdatePolicy } from './appUpdatePolicyApi';
import { openStore } from './openStore';
import {
  isOptionalUpdateSnoozed,
  loadOptionalUpdateSnooze,
  saveOptionalUpdateSnooze,
  type OptionalUpdateSnooze,
} from './optionalUpdateSnooze';
import { evaluateAppUpdate, parseInstalledBuild, platformPolicy, type PlatformVersionPolicy } from './versionPolicy';

/**
 * Latest builds whose optional prompt the person already answered in this app process ("나중에" or "업데이트"). One foreground
 * session sees an optional prompt at most once per latest build; "나중에" is additionally remembered for a day across launches.
 */
const answeredOptionalBuilds = new Set<number>();

/** For tests. */
export function resetAppUpdatePromptMemory(): void {
  answeredOptionalBuilds.clear();
}

/** A foreground return re-asks the server, but never more often than this. */
const MIN_POLICY_CHECK_INTERVAL_MS = 30_000;

/**
 * This platform's policy from the sign-in-free endpoint: read at start and again whenever the app returns to the foreground
 * (for example back from the store). A failed read keeps what was known - the app stays usable (fail open) and nothing is invented.
 */
function useFetchedUpdatePolicy(): PlatformVersionPolicy | null {
  const [policy, setPolicy] = useState<PlatformVersionPolicy | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
      return undefined;
    }
    let isMounted = true;
    let inFlight = false;
    let lastCheckedAt = 0;

    const check = () => {
      if (inFlight || Date.now() - lastCheckedAt < MIN_POLICY_CHECK_INTERVAL_MS) {
        return;
      }
      inFlight = true;
      fetchAppUpdatePolicy(Platform.OS)
        .then(result => {
          if (isMounted && result.ok) {
            lastCheckedAt = Date.now();
            setPolicy(result.policy);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
        });
    };

    check();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        check();
      }
    });
    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return policy;
}

/**
 * The app-update prompt, driven only by the server's version policy (never by store scraping or a store API, and never by numbers
 * inside the app): the installed BUILD number is compared with the policy of the CURRENT platform. The policy is read without
 * signing in (so it also works on the sign-in screen) and, once signed in, also arrives with the bootstrap response.
 * - current: nothing.
 * - optional ("업데이트가 있습니다"): 나중에 / 업데이트. 나중에 is remembered for 24 hours for that latest build; a newer latest
 *   build asks again at once.
 * - required (installed build below the server's minimum): a blocking dialog with 업데이트 only - it has no way to be closed
 *   into the app. Only the 업데이트 button starts anything: Android Back and a tap outside the card are ignored (they neither close
 *   the dialog nor open the store), and the policy is checked again when the app comes back. Snooze never applies to it.
 * A missing, malformed, unreachable or contradictory policy is "current": a server hiccup must never nag or lock anybody out.
 * 업데이트 opens THIS platform's store (Play Store app, App Store page from the server's configuration); if nothing can be
 * opened a Juple message says so and the dialog stays.
 */
export function AppUpdateGate() {
  const { t } = useTranslation();
  const { isAuthenticated, userBootstrapStatus, mobileVersionPolicy } = useAuth();
  const [, setAnswered] = useState(0);
  const [storeFailed, setStoreFailed] = useState(false);
  const [snooze, setSnooze] = useState<OptionalUpdateSnooze | null>(null);
  const [snoozeLoaded, setSnoozeLoaded] = useState(false);
  // True while "나중에" is being written: a second tap is ignored so one answer is one write.
  const isSavingLater = useRef(false);

  useEffect(() => {
    let isMounted = true;
    loadOptionalUpdateSnooze()
      .then(value => {
        if (isMounted) {
          setSnooze(value);
          setSnoozeLoaded(true);
        }
      })
      .catch(() => {
        if (isMounted) {
          setSnoozeLoaded(true);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const fetchedPolicy = useFetchedUpdatePolicy();
  const bootstrapPolicy = isAuthenticated && userBootstrapStatus === 'ready' ? platformPolicy(mobileVersionPolicy ?? null, Platform.OS) : null;
  const policy = fetchedPolicy ?? bootstrapPolicy;
  const status = evaluateAppUpdate(policy, parseInstalledBuild(DeviceInfo.getBuildNumber()));

  const update = useCallback(async () => {
    const opened = await openStore(policy, DeviceInfo.getBundleId());
    if (!opened) {
      setStoreFailed(true);
      return;
    }
    if (status === 'optional' && policy) {
      answeredOptionalBuilds.add(policy.latestBuild);
      setAnswered(count => count + 1);
    }
  }, [policy, status]);

  // "나중에": the answer is written FIRST and the dialog closes only once the storage has taken it - so what the person saw (it
  // went away) is never ahead of what is remembered, and the app being closed right after the tap cannot lose it. A failed write
  // never blocks anything: the answer still counts for this session (no repeated prompt), it just is not remembered after a restart.
  const later = useCallback(async () => {
    if (!policy || isSavingLater.current) {
      return;
    }
    isSavingLater.current = true;
    const latestBuild = policy.latestBuild;
    const now = Date.now();
    try {
      await saveOptionalUpdateSnooze(latestBuild, now);
    } finally {
      isSavingLater.current = false;
      answeredOptionalBuilds.add(latestBuild);
      setSnooze({ latestBuild, dismissedAt: now });
      setAnswered(count => count + 1);
    }
  }, [policy]);

  if (status === 'current' || policy === null) {
    return null;
  }
  if (storeFailed) {
    return (
      <ConfirmDialog
        confirmLabel={t('common.confirm')}
        destructive={false}
        message={t('appUpdate.openStoreFailed')}
        onConfirm={() => setStoreFailed(false)}
        title={t('common.notice')}
        visible
      />
    );
  }
  if (status === 'optional') {
    // Not shown until the remembered answer has been read - no flash of a prompt that was already snoozed.
    const isHidden = !snoozeLoaded
      || answeredOptionalBuilds.has(policy.latestBuild)
      || isOptionalUpdateSnoozed(snooze, policy.latestBuild, Date.now());
    return (
      <ConfirmDialog
        cancelLabel={t('appUpdate.later')}
        confirmLabel={t('appUpdate.action')}
        destructive={false}
        message={t('appUpdate.optionalMessage')}
        onCancel={() => { later().catch(() => undefined); }}
        onConfirm={() => { update().catch(() => undefined); }}
        title={t('appUpdate.optionalTitle')}
        visible={!isHidden}
      />
    );
  }
  return (
    <ConfirmDialog
      confirmLabel={t('appUpdate.action')}
      destructive={false}
      dismissable={false}
      message={t('appUpdate.requiredMessage')}
      onConfirm={() => { update().catch(() => undefined); }}
      title={t('appUpdate.requiredTitle')}
      visible
    />
  );
}
