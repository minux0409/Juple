'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { accountLabel, formatJupleId } from '../../../lib/accountDisplay';
import { isSafeHttpUrl } from '../../../lib/savedLinks';
import { useSignedInApp } from '../AppRoot';
import { ConfirmDialog } from '../ConfirmDialog';
import { Glyph } from '../Glyph';
import { LinkImage } from '../LinkImage';
import { AccountSection, DangerZoneSection, SettingsSection, SubscriptionSection } from './MyPageSections';
import styles from '../app.module.css';

/**
 * 내 페이지 as one page, top to bottom: the profile header (photo, nickname or 설정 안 됨, Juple ID | 프로필 편집, 로그아웃 - asked
 * first, as on mobile, and nowhere else in the app), then 설정, 구독, 계정 and, apart, 위험 구역. 친구 and 삭제 이력 are main
 * destinations of their own (side bar), not part of this page.
 */
export function MyPageView() {
  const { account, profile, dictionary, signOut } = useSignedInApp();
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const photoUrl = profile?.profileImageUrl && isSafeHttpUrl(profile.profileImageUrl) ? profile.profileImageUrl : null;

  // An old section address (/me/subscription -> /me#subscription) lands on its section: the page renders after the session is
  // ready, later than the browser's own scroll to the fragment.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) {
      document.getElementById(id)?.scrollIntoView({ block: 'start' });
    }
  }, []);

  return (
    <section className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{dictionary.navMyPage}</h1>
      </div>
      <div className={styles.myPage}>
        <div className={styles.profileCard}>
          <LinkImage alt={dictionary.profilePhoto} className={styles.profilePhoto} fallback={null} src={photoUrl} />
          <div className={styles.profileText}>
            {profile ? (
              <>
                <span className={profile.displayName?.trim() ? styles.profileName : styles.profileNameMuted} dir="auto">
                  {profile.displayName?.trim() || dictionary.nicknameNotSet}
                </span>
                <span className={styles.profileId} dir="ltr">
                  {dictionary.jupleIdLabel} @{formatJupleId(profile.jupleId)}
                </span>
              </>
            ) : (
              <span className={styles.profileName} dir="auto">
                {accountLabel({ profile: null, accountName: account.name, accountUsername: account.username }, dictionary.accountFallback)}
              </span>
            )}
          </div>
          <div className={styles.profileActions}>
            {profile ? (
              <Link className={styles.settingsAction} href="/me/profile">
                <Glyph name="Edit" size={16} />
                {dictionary.profileEdit}
              </Link>
            ) : null}
            <button className={styles.subtleAction} onClick={() => setConfirmSignOut(true)} type="button">
              <Glyph name="Logout" size={16} />
              {dictionary.logout}
            </button>
          </div>
        </div>

        <SettingsSection />
        <SubscriptionSection />
        <AccountSection />
        <DangerZoneSection />
      </div>
      <ConfirmDialog
        cancelLabel={dictionary.cancel}
        confirmLabel={dictionary.logout}
        message={dictionary.signOutConfirmMessage}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          signOut();
        }}
        open={confirmSignOut}
        title={dictionary.signOutConfirmTitle}
      />
    </section>
  );
}
