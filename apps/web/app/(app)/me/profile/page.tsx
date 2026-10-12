import { redirect } from 'next/navigation';

/** /me/profile was the separate 프로필 편집 page; 프로필 편집 is the page 설정 opens on now (/me), so an existing link or bookmark lands there. */
export default function ProfileRedirect() {
  redirect('/me');
}
