'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { isSubscriptionEntryShown } from '../../../../lib/subscription';
import { useSignedInApp } from '../../AppRoot';
import { SubscriptionSection } from '../MyPageSections';
import { SettingsPage } from '../SettingsPage';

/**
 * 구독 - read-only: the one status the server reported and Google Play's own page to manage it (the Web does not sell). Exists only
 * while the paid program is live (isSubscriptionEntryShown); before that an old bookmark goes back to 내 페이지.
 */
export default function SubscriptionPage() {
  const { dictionary, entitlement } = useSignedInApp();
  const router = useRouter();
  const shown = isSubscriptionEntryShown(entitlement);
  useEffect(() => {
    if (!shown) {
      router.replace('/me');
    }
  }, [router, shown]);
  if (!shown) {
    return null;
  }
  return (
    <SettingsPage title={dictionary.subscriptionTitle}>
      <SubscriptionSection showTitle={false} />
    </SettingsPage>
  );
}
