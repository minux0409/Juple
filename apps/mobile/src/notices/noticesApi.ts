import { Platform } from 'react-native';
import type { AuthenticatedApiRequest } from '../api/useAuthenticatedApi';
export interface NoticeItem {
  readonly id: number;
  readonly language: string;
  readonly title: string;
  readonly preview: string;
  readonly publishedAtUtc: string;
  readonly isImportant: boolean;
  readonly isPinned: boolean;
  readonly isRead: boolean;
  readonly readVersion: number;
}
export interface NoticeDetail {
  readonly notice: NoticeItem;
  readonly body: string;
  readonly officialUrl: string | null;
}
export interface NoticePage {
  readonly items: readonly NoticeItem[];
  readonly nextCursor: string | null;
}

export const noticePlatform = () => (Platform.OS === 'ios' ? 'ios' : 'android');
export const noticeQuery = (language: string) =>
  `platform=${noticePlatform()}&language=${encodeURIComponent(language)}`;
export async function noticeGet<T>(
  request: AuthenticatedApiRequest,
  path: string,
): Promise<T> {
  const response = await request<T>({ method: 'GET', path });
  if (!response.body) throw new Error('Missing notice response');
  return response.body;
}
const listeners = new Set<() => void>();
export function noticeReadChanged(): void {
  for (const listener of listeners) listener();
}
export function subscribeNoticeReads(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
