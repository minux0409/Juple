'use client';

import { useTheme } from '../../../_components/ThemeProvider';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

/**
 * 다크 모드: one On / Off switch. On = explicit Dark, Off = explicit Light. A browser that still stores the old 시스템 설정 사용 shows the
 * theme the browser currently resolves to (the stored value is left alone until the switch is first used); from then on the choice is
 * an explicit light / dark. This browser's, applies at once, survives a reload and signing out, and is never sent to the account.
 */
export default function AppearancePage() {
  const { dictionary } = useSignedInApp();
  const { resolved, setPreference } = useTheme();
  const isDark = resolved === 'dark';
  return (
    <SettingsPage title={dictionary.appearanceTitle}>
      <div className={styles.settingsCard}>
        <div className={styles.settingsSwitchRow}>
          <span aria-hidden className={styles.settingsRowIcon}>
            <Glyph name="Moon" size={20} />
          </span>
          <span className={styles.settingsLinkLabel} id="dark-mode-label">
            {dictionary.appearanceDarkMode}
          </span>
          <button
            aria-checked={isDark}
            aria-labelledby="dark-mode-label"
            className={isDark ? styles.switchOn : styles.switchOff}
            data-dark-mode-switch
            onClick={() => setPreference(isDark ? 'light' : 'dark')}
            role="switch"
            type="button"
          >
            <span aria-hidden className={styles.switchKnob} />
          </button>
        </div>
      </div>
    </SettingsPage>
  );
}
