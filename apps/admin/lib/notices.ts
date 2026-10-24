export const NOTICE_LANGUAGES = [
  'ko',
  'en',
  'ja',
  'zh-Hans',
  'zh-Hant',
  'es',
  'fr',
  'de',
  'it',
  'pt-BR',
  'vi',
  'th',
  'id',
  'ru',
  'tr',
  'ar',
  'hi',
] as const;
export interface NoticeText {
  language: string;
  title: string;
  body: string;
}
export interface AdminNotice {
  id: number;
  status: 'Draft' | 'Published';
  isImportant: boolean;
  isPinned: boolean;
  platforms: number;
  startsAtUtc: string;
  endsAtUtc: string | null;
  officialUrl: string | null;
  translations: NoticeText[];
  version: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  readVersion: number;
}
export function adminNoticeListPath(
  search: string,
  status: string,
  cursor: string | null,
) {
  const q = new URLSearchParams();
  if (search) q.set('search', search);
  if (status) q.set('status', status);
  if (cursor) q.set('cursor', cursor);
  return `/api/v1/admin/notices?${q}`;
}
export function localDateTime(value: string) {
  const d = new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function publicationState(
  notice: Pick<AdminNotice, 'status' | 'startsAtUtc' | 'endsAtUtc'>,
  now = Date.now(),
) {
  return notice.status === 'Draft'
    ? '초안 / 중단'
    : new Date(notice.startsAtUtc).getTime() > now
    ? '게시 예약'
    : notice.endsAtUtc && new Date(notice.endsAtUtc).getTime() <= now
    ? '게시 종료'
    : '게시 중';
}

export type AdminNoticeRow = Pick<
  AdminNotice,
  | 'id'
  | 'status'
  | 'isImportant'
  | 'isPinned'
  | 'startsAtUtc'
  | 'endsAtUtc'
  | 'createdAtUtc'
> & { title: string };
