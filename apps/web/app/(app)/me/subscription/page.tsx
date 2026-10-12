'use client';

import { useSignedInApp } from '../../AppRoot';
import { SubscriptionSection } from '../MyPageSections';
import { SettingsPage } from '../SettingsPage';

/** 구독 - read-only: the one status the server reported and Google Play's own page to manage it (the Web does not sell). */
export default function SubscriptionPage() {
  const { dictionary } = useSignedInApp();
  return (
    <SettingsPage title={dictionary.subscriptionTitle}>
      <SubscriptionSection showTitle={false} />
    </SettingsPage>
  );
}
