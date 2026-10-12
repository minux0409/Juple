import { redirect } from 'next/navigation';

/** /me/settings was 내 페이지's 설정 tab; 설정 is now a section of the one 내 페이지, so an existing link or bookmark lands on it. */
export default function SettingsRedirect() {
  redirect('/me#settings');
}
