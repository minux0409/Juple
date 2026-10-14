import { notFound } from 'next/navigation';

/**
 * Public-only launch mode rewrites every path outside its allow-list here (lib/publicOnly.ts / proxy.ts): the site's own 404 page,
 * with a 404 status. A dedicated route outside the signed-in app group, so no part of the signed-in app is ever rendered for it.
 */
export default function PublicOnlyNotFound() {
  notFound();
}
