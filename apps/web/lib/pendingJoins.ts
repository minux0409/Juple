import type { AppApi } from './appApi.ts';
export interface PendingJoin {
  readonly requestId: number;
  readonly publicId: string;
  readonly name: string;
  readonly icon: string;
  readonly color: string | null;
  readonly iconImageUrl?: string | null;
  readonly iconImageVersion?: string | null;
}
export async function loadPendingJoins(api: AppApi): Promise<readonly PendingJoin[]> {
  return (await api<{ items: readonly PendingJoin[] }>({ path: '/api/v1/collections/join-requests/mine' })).items;
}
export async function cancelPendingJoin(api: AppApi, requestId: number): Promise<void> {
  await api<void>({ method: 'DELETE', path: `/api/v1/collections/join-requests/mine/${requestId}` });
}

/** Membership search stays server-side; this separate, complete list has only profile names. */
export function filterPendingJoins(items: readonly PendingJoin[], search: string): readonly PendingJoin[] {
  return items.filter(item => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
}
