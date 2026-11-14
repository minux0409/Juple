'use client';

import { useSignedInApp } from '../../AppRoot';
import { SettingsPage } from '../SettingsPage';
import { BlockedUsersPanel } from './BlockedUsersPanel';

/** /me/blocked-users: the same panel the 친구 screen shows as its 차단한 사용자 tab (kept as an address of its own for old links). */
export default function BlockedUsersPage() {
  const { dictionary } = useSignedInApp();
  return (
    <SettingsPage backHref="/me/friends" icon="People" title={dictionary.safetyBlockedUsers} width="medium">
      <BlockedUsersPanel />
    </SettingsPage>
  );
}
