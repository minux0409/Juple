import { redirect } from 'next/navigation';

/** 차단한 사용자 lives in 친구 now (its 차단한 사용자 tab); an old link or bookmark lands there. */
export default function BlockedUsersPage(): never {
  redirect('/me/friends?tab=blocked');
}
