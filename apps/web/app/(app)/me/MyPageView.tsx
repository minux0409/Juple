'use client';

import { accountLabel, formatJupleId } from '../../../lib/accountDisplay';
import { useSignedInApp } from '../AppRoot';
import styles from '../app.module.css';

/**
 * 내 페이지: the same identity the mobile 내 페이지 shows - the nickname (or "설정 안 됨") and the public Juple ID (@XXXX-XXXX), from
 * GET /api/v1/users/me/profile; never an email, never Microsoft Graph - and 로그아웃. Editing the profile and the other settings are
 * not part of this Web round. Without the profile (not loaded / failed) it shows the same fallback label as the side bar.
 */
export function MyPageView() {
  const { account, profile, dictionary, signOut } = useSignedInApp();
  return (
    <section className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeading}>
          <h1 className={styles.pageTitle}>{dictionary.navMyPage}</h1>
        </div>
      </div>
      <div className={styles.accountCard}>
        {profile ? (
          <>
            <p className={styles.stateMessage}>{dictionary.nickname}</p>
            <p className={profile.displayName?.trim() ? styles.stateTitle : styles.mutedValue} dir="auto">
              {profile.displayName?.trim() || dictionary.nicknameNotSet}
            </p>
            <p className={styles.stateMessage}>{dictionary.jupleIdLabel}</p>
            <p className={styles.stateTitle} dir="ltr">
              @{formatJupleId(profile.jupleId)}
            </p>
          </>
        ) : (
          <p className={styles.stateTitle} dir="auto">
            {accountLabel({ profile: null, accountName: account.name, accountUsername: account.username }, dictionary.accountFallback)}
          </p>
        )}
        <button className={styles.secondaryButton} onClick={signOut} type="button">
          {dictionary.logout}
        </button>
      </div>
    </section>
  );
}
