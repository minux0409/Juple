'use client';

import { APP_LANGUAGES, LANGUAGE_LABEL_KEYS, type LanguagePreference } from '../../../../lib/appI18n';
import { useSignedInApp } from '../../AppRoot';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

/**
 * 언어 - the mobile LanguageSettingsScreen: 시스템 설정 사용 (here the browser's languages) or one of the 17 languages, each named in
 * itself. The choice is this browser's (as the mobile one is the device's) and the app switches to it at once.
 */
export default function LanguagePage() {
  const { dictionary, languagePreference, setLanguagePreference } = useSignedInApp();
  const options: readonly LanguagePreference[] = ['system', ...APP_LANGUAGES];
  return (
    <SettingsPage title={dictionary.languageTitle}>
      <div aria-label={dictionary.languageTitle} className={styles.settingsCard} role="radiogroup">
        {options.map(option => (
          <button
            aria-checked={languagePreference === option}
            className={styles.settingsLinkRow}
            key={option}
            lang={option === 'system' ? undefined : option}
            onClick={() => {
              if (option !== languagePreference) {
                setLanguagePreference(option);
              }
            }}
            role="radio"
            type="button"
          >
            <span className={styles.settingsLinkLabel}>{dictionary[LANGUAGE_LABEL_KEYS[option]]}</span>
            {languagePreference === option ? <span aria-hidden className={styles.checkMark} /> : null}
          </button>
        ))}
      </div>
    </SettingsPage>
  );
}
