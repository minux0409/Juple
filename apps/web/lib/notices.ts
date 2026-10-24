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
export const noticeQuery = (language: string) =>
  `platform=web&language=${encodeURIComponent(language)}`;
export const noticeListPath = (
  language: string,
  cursor: string | null = null,
) =>
  `/api/v1/notices?${noticeQuery(language)}${
    cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
  }`;
