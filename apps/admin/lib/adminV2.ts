/**
 * Admin V2: the API shapes, paths and pure rules behind the redesigned screens (대시보드, 사용자, 공지사항, 문의 관리, 비용 및 수익,
 * 앱 버전 관리). Everything here is testable without a browser; components only render what these functions decide.
 */

// ---- languages ---------------------------------------------------------------------------------------------------------------

/** The languages Juple ships (mobile i18n locale files, the Web, notices) - the API's TranslationLanguages.Supported. */
export const LANGUAGES = ['ko', 'en', 'ja', 'zh-Hans', 'zh-Hant', 'es', 'fr', 'de', 'it', 'pt-BR', 'vi', 'th', 'id', 'ru', 'tr', 'ar', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ko: '한국어',
  en: '영어',
  ja: '일본어',
  'zh-Hans': '중국어 (간체)',
  'zh-Hant': '중국어 (번체)',
  zh: '중국어',
  es: '스페인어',
  fr: '프랑스어',
  de: '독일어',
  it: '이탈리아어',
  'pt-BR': '포르투갈어 (브라질)',
  pt: '포르투갈어',
  vi: '베트남어',
  th: '태국어',
  id: '인도네시아어',
  ru: '러시아어',
  tr: '터키어',
  ar: '아랍어',
  hi: '힌디어',
  und: '알 수 없음',
};

/** A language code (or a primary subtag) as the operators read it; an unknown code is shown as it is. */
export function languageName(code: string | null | undefined): string {
  if (!code) {
    return '알 수 없음';
  }
  return LANGUAGE_NAMES[code] ?? code;
}

// ---- periods (Asia/Seoul calendar days) --------------------------------------------------------------------------------------

export type RangeKey = '7d' | '30d' | '90d' | 'custom';
export interface Period {
  readonly range: RangeKey;
  readonly from?: string;
  readonly through?: string;
}

export const RANGE_OPTIONS: readonly { readonly range: Exclude<RangeKey, 'custom'>; readonly label: string }[] = [
  { range: '7d', label: '7일' },
  { range: '30d', label: '30일' },
  { range: '90d', label: '90일' },
];

/** The API's own limit: at most 366 Seoul days per period. */
export const MAX_PERIOD_DAYS = 366;

/** Today's date in Seoul as yyyy-MM-dd, whatever the browser's own time zone is. */
export function seoulToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** null = a valid custom period; otherwise why it cannot be requested. The server checks the same rules. */
export function customPeriodProblem(from: string, through: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through) || Number.isNaN(dayNumber(from)) || Number.isNaN(dayNumber(through))) {
    return '시작일과 종료일을 모두 선택하세요.';
  }
  if (from > through) {
    return '시작일이 종료일보다 늦습니다.';
  }
  if (through > today) {
    return '오늘(한국 시간) 이후 날짜는 선택할 수 없습니다.';
  }
  if (from < '2000-01-01') {
    return '2000년 이후 날짜를 선택하세요.';
  }
  if (dayNumber(through) - dayNumber(from) + 1 > MAX_PERIOD_DAYS) {
    return `최대 ${MAX_PERIOD_DAYS}일까지 조회할 수 있습니다.`;
  }
  return null;
}

export function periodQuery(period: Period): string {
  return period.range === 'custom' && period.from && period.through
    ? `from=${encodeURIComponent(period.from)}&through=${encodeURIComponent(period.through)}`
    : `range=${period.range === 'custom' ? '30d' : period.range}`;
}

// ---- formatting --------------------------------------------------------------------------------------------------------------

export function formatNumber(value: number): string {
  return value.toLocaleString('ko-KR');
}

/** "10월 28일" (or "2025년 10월 28일" when withYear) for a yyyy-MM-dd Seoul date - no time zone shift. */
export function formatDay(date: string, withYear = false): string {
  const [year, month, day] = date.split('-').map(Number);
  return withYear ? `${year}년 ${month}월 ${day}일` : `${month}월 ${day}일`;
}

/** "10/28" - a compact axis label. */
export function shortAxisDay(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${month}/${day}`;
}

export function formatMonth(date: string): string {
  const [year, month] = date.split('-').map(Number);
  return `${year}년 ${month}월`;
}

/** An instant in Seoul time ("2026. 10. 28. 오후 3:04"). */
export function formatSeoulInstant(value: string | null | undefined): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' });
}

/** An amount in its own currency (no conversion). An invalid currency code is shown as "123.45 XYZ". */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: currency === 'KRW' || currency === 'JPY' ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString('ko-KR')} ${currency}`;
  }
}

/** "@K7MP4Q8N" - how the apps show a Juple ID today (no hyphen). */
export function atJupleId(code: string): string {
  return `@${code}`;
}

// ---- dashboard ---------------------------------------------------------------------------------------------------------------

export type DashboardMetric = 'users' | 'links' | 'signups';

export interface DashboardKpis {
  readonly totalUsers: number;
  readonly liveLinks: number;
  readonly todaySignups: number;
  readonly seoulToday: string;
  readonly timeZone: string;
  readonly generatedAtUtc: string;
}

export interface MetricPoint {
  readonly date: string;
  readonly value: number;
}

export interface MetricSeries {
  readonly metric: DashboardMetric;
  readonly from: string;
  readonly through: string;
  readonly timeZone: string;
  readonly generatedAtUtc: string;
  readonly points: readonly MetricPoint[];
  readonly definition: string;
}

export const DASHBOARD_METRICS: readonly {
  readonly metric: DashboardMetric;
  readonly kpi: keyof Pick<DashboardKpis, 'totalUsers' | 'liveLinks' | 'todaySignups'>;
  readonly title: string;
  readonly chartTitle: string;
  readonly unit: string;
  readonly chart: 'line' | 'bar';
}[] = [
  { metric: 'users', kpi: 'totalUsers', title: '전체 사용자 수', chartTitle: '전체 사용자 수 추이', unit: '명', chart: 'line' },
  { metric: 'links', kpi: 'liveLinks', title: '전체 저장 링크 수', chartTitle: '전체 저장 링크 수 추이', unit: '개', chart: 'line' },
  { metric: 'signups', kpi: 'todaySignups', title: '오늘 신규 가입자', chartTitle: '일별 신규 가입자', unit: '명', chart: 'bar' },
];

export function parseMetric(value: string | null | undefined): DashboardMetric {
  return value === 'links' || value === 'signups' ? value : 'users';
}

// ---- users -------------------------------------------------------------------------------------------------------------------

export type UserSort = 'createdDesc' | 'createdAsc' | 'linksDesc' | 'linksAsc';
export type UserSearchField = 'jupleId' | 'nickname';

export interface UserDirectoryRow {
  readonly userId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly linkCount: number;
  readonly preferredLocale: string;
  readonly language: string;
  readonly createdAtUtc: string;
}

export interface UserDirectoryPage {
  readonly items: readonly UserDirectoryRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly languages: readonly { readonly language: string; readonly users: number }[];
}

export interface UserDirectoryQuery {
  readonly search: string;
  readonly searchField: UserSearchField;
  readonly language: string;
  readonly sort: UserSort;
  readonly page: number;
  readonly pageSize: number;
}

export interface UserLinkBucket {
  readonly start: string;
  readonly saved: number;
  readonly cumulativeSaved: number;
}

export interface UserLinkHistory {
  readonly userId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
  readonly createdAtUtc: string;
  readonly signupDate: string;
  readonly through: string;
  readonly granularity: 'day' | 'month';
  readonly liveLinks: number;
  readonly savedSinceSignup: number;
  readonly buckets: readonly UserLinkBucket[];
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** The next sort when a sortable header is clicked: newest/most first, then the reverse. */
export function nextSort(current: UserSort, column: 'created' | 'links'): UserSort {
  if (column === 'created') {
    return current === 'createdDesc' ? 'createdAsc' : 'createdDesc';
  }
  return current === 'linksDesc' ? 'linksAsc' : 'linksDesc';
}

export function sortDirection(current: UserSort, column: 'created' | 'links'): 'ascending' | 'descending' | 'none' {
  if (column === 'created') {
    return current === 'createdDesc' ? 'descending' : current === 'createdAsc' ? 'ascending' : 'none';
  }
  return current === 'linksDesc' ? 'descending' : current === 'linksAsc' ? 'ascending' : 'none';
}

// ---- notices -----------------------------------------------------------------------------------------------------------------

export type TranslationOrigin = 'Source' | 'Machine' | 'Manual';

export interface NoticeTextV2 {
  language: string;
  title: string;
  body: string;
  origin?: TranslationOrigin | null;
  sourceFingerprint?: string | null;
  translatedAtUtc?: string | null;
}

export interface NoticeTranslationResult {
  readonly language: string;
  readonly status: 'translated' | 'failed';
  readonly title: string | null;
  readonly body: string | null;
  readonly errorCode: string | null;
}

export interface NoticeTranslationBatch {
  readonly provider: string;
  readonly sourceFingerprint: string;
  readonly translatedAtUtc: string;
  readonly results: readonly NoticeTranslationResult[];
}

/**
 * What one language of a notice is, compared with the CURRENT Korean original (sourceFingerprint of the Korean text as saved -
 * or as the last translation request saw it). Manual translations are never overwritten automatically.
 */
export type NoticeLanguageState = 'source' | 'missing' | 'machine' | 'stale' | 'manual' | 'failed';

export function noticeLanguageState(text: NoticeTextV2 | undefined, currentFingerprint: string | null, failed: boolean): NoticeLanguageState {
  if (text?.language === 'ko') {
    return 'source';
  }
  if (failed && !(text?.title || text?.body)) {
    return 'failed';
  }
  if (!text || !text.title.trim() || !text.body.trim()) {
    return failed ? 'failed' : 'missing';
  }
  if (text.origin === 'Machine') {
    return currentFingerprint && text.sourceFingerprint === currentFingerprint ? 'machine' : 'stale';
  }
  return 'manual';
}

export const NOTICE_STATE_LABELS: Readonly<Record<NoticeLanguageState, string>> = {
  source: '원본',
  missing: '번역 없음',
  machine: '자동 번역',
  stale: '원문 변경됨',
  manual: '수동 작성',
  failed: '번역 실패',
};

/**
 * The API's fingerprint of a Korean original (NoticeService.SourceFingerprint): SHA-256, lower-case hex, of the trimmed title,
 * a line feed and the trimmed body. Used to tell whether a machine translation was made from the text as it is now.
 */
export async function noticeFingerprint(title: string, body: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${title.trim()}\n${body.trim()}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** "번역 갱신": languages without a translation, failed ones and machine translations of an older original. Manual ones are left alone. */
export function languagesToRefresh(texts: readonly NoticeTextV2[], currentFingerprint: string | null, failed: ReadonlySet<string>): string[] {
  return LANGUAGES.filter(language => language !== 'ko').filter(language => {
    const state = noticeLanguageState(texts.find(text => text.language === language), currentFingerprint, failed.has(language));
    return state === 'missing' || state === 'failed' || state === 'stale';
  });
}

/** Applies one translation result to the texts: a success becomes a Machine translation of the given original. */
export function applyTranslation(texts: readonly NoticeTextV2[], result: NoticeTranslationResult, fingerprint: string): NoticeTextV2[] {
  if (result.status !== 'translated' || result.title === null || result.body === null) {
    return [...texts];
  }
  const next: NoticeTextV2 = { language: result.language, title: result.title, body: result.body, origin: 'Machine', sourceFingerprint: fingerprint };
  return texts.some(text => text.language === result.language)
    ? texts.map(text => (text.language === result.language ? next : text))
    : [...texts, next];
}

/** Editing a translation by hand makes it Manual (it is then never replaced by "번역 갱신"). */
export function editTranslation(texts: readonly NoticeTextV2[], language: string, key: 'title' | 'body', value: string): NoticeTextV2[] {
  const exists = texts.some(text => text.language === language);
  const edited = (text: NoticeTextV2): NoticeTextV2 =>
    language === 'ko' ? { ...text, [key]: value, origin: 'Source', sourceFingerprint: null } : { ...text, [key]: value, origin: 'Manual', sourceFingerprint: null };
  return exists
    ? texts.map(text => (text.language === language ? edited(text) : text))
    : [...texts, edited({ language, title: '', body: '' })];
}

export const TRANSLATION_ERROR_LABELS: Readonly<Record<string, string>> = {
  translationNotConfigured: '번역 제공자가 설정되지 않았습니다.',
  inquiryTranslationNotAllowed: '문의 번역이 허용되지 않았습니다 (개인정보 처리방침 검토 후 운영 설정에서 활성화).',
  translationBusy: '다른 번역이 진행 중입니다. 잠시 후 다시 시도하세요.',
  throttled: '번역 요청이 많아 잠시 제한되었습니다.',
  providerRejected: '번역 제공자가 요청을 거부했습니다 (키·한도 확인).',
  unavailable: '번역 제공자에 연결할 수 없습니다.',
  timeout: '번역 응답 시간이 초과되었습니다.',
  invalidResponse: '번역 응답을 읽을 수 없습니다.',
  tooLong: '번역하기에 너무 긴 글입니다.',
  resultOutOfBounds: '번역 결과가 공지 길이 제한을 넘습니다. 직접 수정하세요.',
  busy: '다른 번역이 진행 중입니다.',
};

export function translationErrorLabel(code: string | null | undefined): string {
  if (!code) {
    return '번역하지 못했습니다.';
  }
  return TRANSLATION_ERROR_LABELS[code] ?? TRANSLATION_ERROR_LABELS[code.replace(/^translation_/, '')] ?? `번역하지 못했습니다 (${code}).`;
}

// ---- reports (신고 관리: a tab of 문의 관리, its own data) --------------------------------------------------------------------

/** 미처리 first by default, then the rest. There is deliberately no mixed "all": what is still open is never buried among handled reports. */
export const REPORT_FILTERS = [
  { filter: 'Open', label: '미처리' },
  { filter: 'InReview', label: '검토 중' },
  { filter: 'Dismissed', label: '조치 없음' },
  { filter: 'Actioned', label: '처리 완료' },
] as const;
export type ReportFilter = (typeof REPORT_FILTERS)[number]['filter'];

export function parseReportFilter(value: string | null): ReportFilter {
  return REPORT_FILTERS.find(entry => entry.filter === value)?.filter ?? 'Open';
}

const REPORT_STATUS_LABELS: Readonly<Record<string, string>> = { Pending: '접수', InReview: '검토 중', Reviewed: '검토됨', Dismissed: '조치 없음', Actioned: '처리 완료' };
const REPORT_TARGET_LABELS: Readonly<Record<string, string>> = { Collection: '컬렉션', Item: '링크', Comment: '댓글', User: '사용자' };
const REPORT_REASON_LABELS: Readonly<Record<string, string>> = {
  Spam: '스팸·광고',
  SexualOrInappropriate: '부적절한 콘텐츠',
  Harassment: '괴롭힘·악용',
  IntellectualProperty: '저작권 침해 의심',
  Other: '기타',
  HateOrAbuse: '혐오 또는 악용',
  Illegal: '불법 콘텐츠',
  ScamOrMaliciousLink: '사기 또는 악성 링크',
};

export const reportStatusLabel = (status: string): string => REPORT_STATUS_LABELS[status] ?? status;
export const reportTargetLabel = (type: string): string => REPORT_TARGET_LABELS[type] ?? type;
export const reportReasonLabel = (reason: string): string => REPORT_REASON_LABELS[reason] ?? reason;

export interface ReportPerson {
  readonly userId: number;
  readonly jupleId: string;
  readonly displayName: string | null;
}

export interface ReportRow {
  readonly reportId: number;
  readonly createdAtUtc: string;
  readonly targetType: string;
  readonly targetId: number;
  readonly collectionId: number | null;
  readonly snapshotTitle: string | null;
  readonly reason: string;
  readonly status: string;
  readonly source: string;
  readonly reporter: ReportPerson | null;
  readonly adminActionTaken: boolean;
}

export interface ReportDetail {
  readonly reportId: number;
  readonly createdAtUtc: string;
  readonly targetType: string;
  readonly targetId: number;
  readonly collectionId: number | null;
  readonly reason: string;
  readonly details: string | null;
  readonly status: string;
  readonly source: string;
  readonly reporter: ReportPerson | null;
  readonly targetUser: ReportPerson | null;
  readonly snapshotTitle: string | null;
  readonly snapshotUrl: string | null;
  readonly currentTitle: string | null;
  readonly currentUrl: string | null;
  readonly targetExists: boolean;
  readonly canRestrict: boolean;
  readonly isRestricted: boolean;
  readonly restrictedAtUtc: string | null;
  readonly reviewedAtUtc: string | null;
  readonly reviewedBy: ReportPerson | null;
  readonly note: string | null;
  readonly priorReports: readonly { readonly reportId: number; readonly createdAtUtc: string; readonly reason: string; readonly status: string; readonly source: string }[];
  readonly history: readonly { readonly adminUserId: number; readonly adminJupleId: string | null; readonly action: string; readonly detail: string | null; readonly createdAtUtc: string }[];
}

/** Who reported, for an operator: a person, the automatic check, or an account since deleted. */
export function reportReporterLabel(row: { readonly source: string; readonly reporter: ReportPerson | null }): string {
  if (row.source === 'AutoFilter') {
    return '자동 검사';
  }
  return row.reporter ? atJupleId(row.reporter.jupleId) : '탈퇴한 사용자';
}

export function reportFailureMessage(code: string | null | undefined): string | null {
  if (code === 'reportRestrictionActive') {
    return '공유 제한이 적용 중입니다. 먼저 제한을 해제해 주세요.';
  }
  return code === 'reportNotRestrictable' ? '컬렉션 또는 링크 신고만 공유를 제한할 수 있습니다.' : null;
}

// ---- inquiries ---------------------------------------------------------------------------------------------------------------

export interface InquiryTranslationState {
  readonly provider: string;
  readonly configured: boolean;
  readonly allowed: boolean;
}

export interface InquiryDetailV2 {
  readonly inquiryId: number;
  readonly status: string;
  readonly type: string;
  readonly user: { readonly userId: number; readonly jupleId: string; readonly displayName: string | null } | null;
  readonly content: string;
  readonly answer: string | null;
  readonly createdAtUtc: string;
  readonly updatedAtUtc: string | null;
  readonly answeredAtUtc: string | null;
  readonly diagnostics: { readonly appVersion: string | null; readonly buildNumber: string | null; readonly platform: string | null; readonly osVersion: string | null; readonly deviceModel: string | null; readonly locale: string | null };
  readonly history: readonly { readonly adminUserId: number; readonly adminJupleId: string | null; readonly action: string; readonly detail: string | null; readonly createdAtUtc: string }[];
  readonly contentTranslation: { readonly language: string | null; readonly textKo: string; readonly translatedAtUtc: string } | null;
  readonly answerSourceKo: string | null;
  readonly answerLanguage: string | null;
  readonly answerDraft: { readonly sourceKo: string | null; readonly translated: string | null; readonly language: string | null; readonly savedAtUtc: string } | null;
  readonly suggestedLanguage: string;
  readonly translation: InquiryTranslationState | null;
  readonly changeToken: string;
}

export interface InquiryRowV2 {
  readonly inquiryId: number;
  readonly status: string;
  readonly type: string;
  readonly user: { readonly userId: number; readonly jupleId: string; readonly displayName: string | null } | null;
  readonly contentPreview: string;
  readonly platform: string | null;
  readonly createdAtUtc: string;
  readonly answeredAtUtc: string | null;
  readonly locale?: string | null;
  readonly contentLanguage?: string | null;
}

export type InquiryFilter = 'Open' | 'Answered' | 'all';

export const INQUIRY_FILTERS_V2: readonly { readonly filter: InquiryFilter; readonly label: string }[] = [
  { filter: 'Open', label: '미답변' },
  { filter: 'Answered', label: '답변 완료' },
  { filter: 'all', label: '전체' },
];

export function parseInquiryFilterV2(value: string | null): InquiryFilter {
  return value === 'Answered' || value === 'all' ? value : 'Open';
}

/** The device locale's language in the list ("원문 언어"): the detected language once translated, else the locale. */
export function inquiryLanguage(row: Pick<InquiryRowV2, 'locale' | 'contentLanguage'>): string {
  if (row.contentLanguage) {
    return languageName(row.contentLanguage);
  }
  return row.locale ? `${languageName(row.locale.split(/[-_]/)[0].toLowerCase())} (기기 설정)` : '알 수 없음';
}

export interface AnswerDraftState {
  readonly language: string;
  readonly sourceKo: string;
  readonly translated: string;
  /** The Korean text the current translation was made from (null = written by hand). */
  readonly translatedFrom: string | null;
  /** The admin confirmed a translation that is not the machine output of the current Korean text. */
  readonly manualConfirmed: boolean;
}

/**
 * Whether the answer can be sent, and if not why. A Korean answer is sent as written; any other language needs a translation
 * that belongs to the current Korean text - or the admin's explicit confirmation of a hand-written / edited one.
 */
export function answerBlocker(state: AnswerDraftState): string | null {
  const source = state.sourceKo.trim();
  if (!source) {
    return '한국어 답변을 입력하세요.';
  }
  if (source.length > 8000) {
    return '답변은 8000자 이하로 입력하세요.';
  }
  if (state.language === 'ko') {
    return null;
  }
  const translated = state.translated.trim();
  if (!translated) {
    return `${languageName(state.language)} 번역문이 없습니다. 번역하거나 직접 입력하세요.`;
  }
  if (translated.length > 8000) {
    return '번역문은 8000자 이하로 입력하세요.';
  }
  if (state.translatedFrom?.trim() !== source && !state.manualConfirmed) {
    return '번역문이 현재 한국어 답변에서 만들어지지 않았습니다. 다시 번역하거나 번역문을 확인했다고 표시하세요.';
  }
  return null;
}

/** The PUT .../answer body of the translation workflow: what the person reads, its Korean original, its language and the change token. */
export function answerSendBody(state: AnswerDraftState, changeToken: string) {
  const sourceKo = state.sourceKo.trim();
  return {
    answer: state.language === 'ko' ? sourceKo : state.translated.trim(),
    sourceKo,
    language: state.language,
    expectedUpdatedAtUtc: changeToken,
  };
}

// ---- costs -------------------------------------------------------------------------------------------------------------------

export interface CurrencyAmount {
  readonly currency: string;
  readonly amount: number;
}

export interface MonthlyCost {
  readonly month: string;
  readonly isCurrent: boolean;
  readonly synced: boolean;
  readonly lastSyncAtUtc: string | null;
  readonly syncStatus: string;
  readonly failureCode: string | null;
  readonly amounts: readonly CurrencyAmount[];
}

export interface CostHistory {
  readonly scope: string;
  readonly environment: string;
  readonly todayUtc: string;
  readonly months: readonly MonthlyCost[];
}

export interface AzureReport {
  readonly scope: string;
  readonly month: string;
  readonly through: string;
  readonly lastSyncAtUtc: string | null;
  readonly syncStatus: string;
  readonly failureCode: string | null;
  readonly totals: readonly { readonly currency: string; readonly current: number | null; readonly previousSameDays: number | null; readonly previousFullMonth: number | null; readonly changePercent: number | null }[];
  readonly services: readonly { readonly date: string; readonly label: string; readonly currency: string; readonly amount: number }[];
}

/** The currencies of a history, most-used first (the chart shows one currency at a time - amounts are never converted). */
export function costCurrencies(history: CostHistory): string[] {
  const counts = new Map<string, number>();
  for (const month of history.months) {
    for (const amount of month.amounts) {
      counts.set(amount.currency, (counts.get(amount.currency) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([currency]) => currency);
}

/** One currency's monthly values; an unsynced month is null (unknown), a synced month without rows is 0. */
export function monthlyValues(history: CostHistory, currency: string): (number | null)[] {
  return history.months.map(month => (month.synced ? month.amounts.find(amount => amount.currency === currency)?.amount ?? 0 : null));
}

export interface ServiceCost {
  readonly service: string;
  readonly currency: string;
  readonly amount: number;
  readonly days: number;
}

/** The month's daily service rows summed per service and currency, largest first. */
export function serviceTotals(report: AzureReport): ServiceCost[] {
  const totals = new Map<string, ServiceCost>();
  for (const row of report.services) {
    const key = `${row.label}\u0000${row.currency}`;
    const previous = totals.get(key);
    totals.set(key, { service: row.label, currency: row.currency, amount: (previous?.amount ?? 0) + row.amount, days: (previous?.days ?? 0) + 1 });
  }
  return [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.amount - a.amount);
}

/** The first day of the current UTC month (Azure billing months are UTC dates). */
export function currentUtcMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

// ---- app versions ------------------------------------------------------------------------------------------------------------

/** How the apps treat an installed build under a policy - the same rules as the mobile AppUpdateGate (c < min forced, c < latest optional). */
export function updatePolicyText(latestBuild: number, minimumSupportedBuild: number): string {
  if (latestBuild <= 0 && minimumSupportedBuild <= 0) {
    return '정책 없음 - 업데이트 안내를 하지 않습니다.';
  }
  const parts: string[] = [];
  if (minimumSupportedBuild > 0) {
    parts.push(`빌드 ${minimumSupportedBuild} 미만: 강제 업데이트`);
  }
  if (latestBuild > minimumSupportedBuild) {
    parts.push(minimumSupportedBuild > 0 ? `${minimumSupportedBuild}~${latestBuild - 1}: 업데이트 안내` : `${latestBuild} 미만: 업데이트 안내`);
  }
  parts.push(`${latestBuild} 이상: 안내 없음`);
  return parts.join(' · ');
}

// ---- paths -------------------------------------------------------------------------------------------------------------------

export const v2Paths = {
  kpis: '/api/v1/admin/dashboard/kpis',
  series: (metric: DashboardMetric, period: Period) => `/api/v1/admin/dashboard/series?metric=${metric}&${periodQuery(period)}`,
  users: (query: UserDirectoryQuery) => {
    const params = new URLSearchParams({ sort: query.sort, page: String(query.page), pageSize: String(query.pageSize) });
    if (query.search.trim()) {
      params.set('search', query.search.trim());
      params.set('searchField', query.searchField);
    }
    if (query.language) {
      params.set('language', query.language);
    }
    return `/api/v1/admin/users/directory?${params}`;
  },
  userHistory: (userId: number, granularity: 'day' | 'month') => `/api/v1/admin/users/${encodeURIComponent(String(userId))}/link-history?granularity=${granularity}`,
  noticeTranslationStatus: '/api/v1/admin/notices/translation-status',
  noticeTranslations: '/api/v1/admin/notices/translations',
  inquiries: (filter: InquiryFilter, cursor: string | null) => {
    const params = new URLSearchParams();
    if (filter !== 'all') {
      params.set('status', filter);
    }
    if (cursor) {
      params.set('cursor', cursor);
    }
    const query = params.toString();
    return `/api/v1/admin/support/inquiries${query ? `?${query}` : ''}`;
  },
  inquiry: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}`,
  reports: (filter: ReportFilter, cursor: string | null) => {
    const params = new URLSearchParams({ status: filter });
    if (cursor) {
      params.set('cursor', cursor);
    }
    return `/api/v1/admin/reports?${params}`;
  },
  report: (id: number) => `/api/v1/admin/reports/${encodeURIComponent(String(id))}`,
  reportStatus: (id: number) => `/api/v1/admin/reports/${encodeURIComponent(String(id))}/status`,
  reportRestriction: (id: number) => `/api/v1/admin/reports/${encodeURIComponent(String(id))}/restriction`,
  reportRestrictionLift: (id: number) => `/api/v1/admin/reports/${encodeURIComponent(String(id))}/restriction/lift`,
  inquiryContentTranslation: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}/content-translation`,
  inquiryDraft: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}/answer-draft`,
  inquiryAnswerTranslation: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}/answer-translation`,
  inquiryAnswer: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}/answer`,
  inquiryStatus: (id: number) => `/api/v1/admin/support/inquiries/${encodeURIComponent(String(id))}/status`,
  costHistory: (months: '6' | '12' | 'all') => `/api/v1/admin/costs/history?months=${months}`,
  expenseConfiguration: '/api/v1/admin/expenses/configuration',
  azureReport: '/api/v1/admin/expenses/azure-report',
  revenue: '/api/v1/admin/workspace/revenue',
} as const;
