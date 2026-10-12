import { redirect } from 'next/navigation';

/** /me/settings was 내 페이지's 설정 tab; its 언어 and 컬렉션 잠금 are pages of the settings list now, so an existing link lands on the first. */
export default function SettingsRedirect() {
  redirect('/me/language');
}
