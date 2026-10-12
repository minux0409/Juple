import { redirect } from 'next/navigation';

/** /me/account was 내 페이지's 계정 tab; 계정 is now a section of the one 내 페이지, so an existing link or bookmark lands on it (계정 삭제 stays at /me/account/delete). */
export default function AccountRedirect() {
  redirect('/me#account');
}
