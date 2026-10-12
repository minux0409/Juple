import { redirect } from 'next/navigation';

/** /me/subscription was 내 페이지's 구독 tab; 구독 is now a section of the one 내 페이지, so an existing link or bookmark lands on it. */
export default function SubscriptionRedirect() {
  redirect('/me#subscription');
}
