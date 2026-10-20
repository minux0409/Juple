'use client';

import { useSignedInApp } from '../../AppRoot';
import { AccountSection, DataExportSection } from '../MyPageSections';
import { SettingsPage } from '../SettingsPage';

/** 계정 - how this account signs in, its sign-in e-mail and 비밀번호 재설정; 계정 삭제 is its own deliberate page (/me/account/delete). */
export default function AccountPage() {
  const { dictionary } = useSignedInApp();
  return (
    <SettingsPage title={dictionary.accountSectionTitle}>
      <AccountSection showTitle={false} />
      <DataExportSection />
    </SettingsPage>
  );
}
