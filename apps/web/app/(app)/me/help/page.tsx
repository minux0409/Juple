'use client';

import { TOUR_GUIDES } from '../../../../lib/tour';
import { useSignedInApp } from '../../AppRoot';
import { useTour } from '../../TourProvider';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

/**
 * 도움말 > 기능 가이드: every guide can be started here at any time. Short title, one line, and 가이드 보기 - the text of a step is shown
 * on the page itself by the tour. Guides for features the browser does not have (the share menu, the 1x1 Home screen shortcut) are
 * not listed; one line says some guides exist only in the mobile app.
 */
export default function HelpPage() {
  const { dictionary } = useSignedInApp();
  const { start } = useTour();
  return (
    <SettingsPage subtitle={dictionary.tourHelpIntro} title={dictionary.tourHelpTitle}>
      <div className={`${styles.settingsCard} ${styles.guideList}`} data-guide-list>
        {TOUR_GUIDES.map(guide => (
          <div className={styles.guideRow} key={guide.id}>
            <div className={styles.guideRowText}>
              <h2 className={styles.guideRowTitle}>{dictionary[`tourGuide_${guide.id}_Title`]}</h2>
              <p className={styles.guideRowSummary}>{dictionary[`tourGuide_${guide.id}_Summary`]}</p>
            </div>
            <button
              aria-label={`${dictionary.tourStart}: ${dictionary[`tourGuide_${guide.id}_Title`]}`}
              className={styles.settingsAction}
              data-guide-start={guide.id}
              onClick={() => start(guide.id)}
              type="button"
            >
              {dictionary.tourStart}
            </button>
          </div>
        ))}
      </div>
      <p className={styles.settingsNote}>{dictionary.tourMobileOnlyNote}</p>
    </SettingsPage>
  );
}
