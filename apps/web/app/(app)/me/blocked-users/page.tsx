import { redirect } from 'next/navigation';

/** 차단한 사용자 is no longer a screen anywhere in Friends; an old link or bookmark lands on the ordinary Friends screen. */
export default function BlockedUsersPage(): never {
  redirect('/me/friends');
}
