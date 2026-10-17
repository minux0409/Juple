import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../theme/ThemeContext';
import { useTranslation } from 'react-i18next';
import { AppState, Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { fetchAppUpdatePolicy } from './appUpdatePolicyApi';
import { openStore } from './openStore';
import { evaluateAppUpdate, parseInstalledBuild, platformPolicy, type PlatformVersionPolicy } from './versionPolicy';

/**
 * Latest builds whose optional prompt the person already answered in this app process ("나중에" or "업데이트"). It lives in
 * memory only: within one running process the prompt is not repeated on every foreground return, but nothing is persisted, so
 * the next launch asks again for as long as the installed build is below the latest.
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
 * - optional ("업데이트가 있습니다"): 나중에 / 업데이트. 나중에 only closes the prompt for this running process (never stored),
 *   so every new launch asks again while the build is below the latest.
 * - required (installed build below the server's minimum): a blocking dialog with 업데이트 only - it has no way to be closed
 *   into the app. Only the 업데이트 button starts anything: Android Back and a tap outside the card are ignored (they neither close
 *   the dialog nor open the store), and the policy is checked again when the app comes back.
 * A missing, malformed, unreachable or contradictory policy is "current": a server hiccup must never nag or lock anybody out.
 * 업데이트 opens THIS platform's store (Play Store app, App Store page from the server's configuration); if nothing can be
 * opened a Juple message says so and the dialog stays.
 */
export function AppUpdateGate() {
  const { t } = useTranslation();
  useTheme(); // outside any navigator: re-render the prompt in place on a theme change
  const { isAuthenticated, userBootstrapStatus, mobileVersionPolicy } = useAuth();
  const [, setAnswered] = useState(0);
  const [storeFailed, setStoreFailed] = useState(false);

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

  // "나중에": closes the prompt for this running process only. Nothing is stored, so the next launch asks again.
  const later = useCallback(() => {
    if (!policy) {
      return;
    }
    answeredOptionalBuilds.add(policy.latestBuild);
    setAnswered(count => count + 1);
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
    const isHidden = answeredOptionalBuilds.has(policy.latestBuild);
    return (
      <ConfirmDialog
        cancelLabel={t('appUpdate.later')}
        confirmLabel={t('appUpdate.action')}
        destructive={false}
        message={t('appUpdate.optionalMessage')}
        onCancel={later}
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
