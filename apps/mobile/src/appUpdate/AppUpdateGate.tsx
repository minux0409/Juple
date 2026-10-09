import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { useAuth } from '../auth/AuthContext';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { openStore } from './openStore';
import { evaluateAppUpdate, parseInstalledBuild, platformPolicy } from './versionPolicy';

/**
 * Latest builds whose optional prompt the person already answered in this app process ("나중에" or "업데이트"). One foreground
 * session sees an optional prompt at most once per latest build - the next one is for a newer build (or the next cold start).
 */
const answeredOptionalBuilds = new Set<number>();

/** For tests. */
export function resetAppUpdatePromptMemory(): void {
  answeredOptionalBuilds.clear();
}

/**
 * The app-update prompt, driven only by the server's version policy from the bootstrap response (never by store scraping or
 * a store API, and never by numbers inside the app): the installed BUILD number is compared with the policy of the CURRENT
 * platform.
 * - current: nothing.
 * - optional ("업데이트가 있습니다"): 나중에 / 업데이트, shown once per session per latest build.
 * - required (installed build below the server's minimum): a blocking dialog with 업데이트 only - it has no way to be closed
 *   into the app. The back button only reopens the store.
 * A missing, malformed or contradictory policy is "current": a server hiccup must never nag or lock anybody out.
 * 업데이트 opens THIS platform's store (Play Store app, App Store page from the server's configuration); if nothing can be
 * opened a Juple message says so and the dialog stays.
 */
export function AppUpdateGate() {
  const { t } = useTranslation();
  const { isAuthenticated, userBootstrapStatus, mobileVersionPolicy } = useAuth();
  const [, setAnswered] = useState(0);
  const [storeFailed, setStoreFailed] = useState(false);

  const policy = isAuthenticated && userBootstrapStatus === 'ready' ? platformPolicy(mobileVersionPolicy ?? null, Platform.OS) : null;
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

  const later = useCallback(() => {
    if (policy) {
      answeredOptionalBuilds.add(policy.latestBuild);
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
    return (
      <ConfirmDialog
        cancelLabel={t('appUpdate.later')}
        confirmLabel={t('appUpdate.action')}
        destructive={false}
        message={t('appUpdate.optionalMessage')}
        onCancel={later}
        onConfirm={() => { update().catch(() => undefined); }}
        title={t('appUpdate.optionalTitle')}
        visible={!answeredOptionalBuilds.has(policy.latestBuild)}
      />
    );
  }
  return (
    <ConfirmDialog
      confirmLabel={t('appUpdate.action')}
      destructive={false}
      message={t('appUpdate.requiredMessage')}
      onConfirm={() => { update().catch(() => undefined); }}
      title={t('appUpdate.requiredTitle')}
      visible
    />
  );
}
