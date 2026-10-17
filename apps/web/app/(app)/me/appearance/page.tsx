'use client';

import { useTheme } from '../../../_components/ThemeProvider';
import { useSignedInApp } from '../../AppRoot';
import { SettingsPage } from '../SettingsPage';
import type { AppDictionary } from '../../../../lib/appI18n';
import { THEME_PREFERENCES, type ThemePreference } from '../../../../lib/theme';
import styles from '../../app.module.css';

function optionLabel(option: ThemePreference, dictionary: AppDictionary): string {
  return option === 'system' ? dictionary.appearanceSystem : option === 'light' ? dictionary.appearanceLight : dictionary.appearanceDark;
}

/**
 * 화면 모드: 시스템 설정 사용 (the browser's own light / dark, followed live) / 라이트 / 다크 - the same radio list as 언어. The choice is this
 * browser's, applies at once, survives a reload and signing out, and is never sent to the account.
 */
export default function AppearancePage() {
  const { dictionary } = useSignedInApp();
  const { preference, setPreference } = useTheme();
  return (
    <SettingsPage title={dictionary.appearanceTitle}>
      <div aria-label={dictionary.appearanceTitle} className={styles.settingsCard} role="radiogroup">
        {THEME_PREFERENCES.map(option => (
          <button aria-checked={preference === option} className={styles.settingsLinkRow} data-theme-option={option} key={option} onClick={() => setPreference(option)} role="radio" type="button">
            <span className={styles.settingsLinkLabel}>{optionLabel(option, dictionary)}</span>
            {preference === option ? <span aria-hidden className={styles.checkMark} /> : null}
          </button>
        ))}
      </div>
    </SettingsPage>
  );
}
