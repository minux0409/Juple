'use client';
// Test-only route (copied to app/admin-v2-test-harness/[inquiryId]/page.tsx by tests/browser/adminV2.browser.mjs and removed
// afterwards): the real V2 screens inside the real AdminShell, against a fixture API. Never part of a build.
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { AdminContextProvider, AdminShell, type AdminContextValue } from '../../(admin)/AdminRoot';
import Dashboard from '../../(admin)/page';
import Users from '../../(admin)/users/page';
import Notices from '../../(admin)/notices/page';
import { NoticeEditor } from '../../(admin)/notices/NoticeEditor';
import Inquiries from '../../(admin)/inquiries/page';
import Inquiry from '../../(admin)/inquiries/[inquiryId]/page';
import Costs from '../../(admin)/costs/page';
import AppVersion from '../../(admin)/operations/app-version/page';
import Settings from '../../(admin)/settings/page';
import { noticeFingerprint } from '../../../lib/adminV2';

const day = (offset: number) => new Date(Date.UTC(2026, 9, 28 - offset)).toISOString().slice(0, 10);
const days = (count: number, value: (index: number) => number) => Array.from({ length: count }, (_, index) => ({ date: day(count - 1 - index), value: value(index) }));
const now = '2026-10-28T03:00:00+00:00';
const inquiry = {
  inquiryId: 7, status: 'Pending', type: 'Bug', user: { userId: 3, jupleId: 'K7MP4Q8N', displayName: 'Mina' },
  content: 'The app freezes when I save a long Instagram link. It happened three times today on my Galaxy.',
  answer: null, createdAtUtc: '2026-10-27T09:12:00+00:00', updatedAtUtc: null, answeredAtUtc: null,
  diagnostics: { appVersion: '1.0', buildNumber: '36', platform: 'android', osVersion: '16', deviceModel: 'SM-S936N', locale: 'en-US' },
  history: [], contentTranslation: { language: 'en', textKo: '긴 인스타그램 링크를 저장하면 앱이 멈춥니다. 오늘 갤럭시에서 세 번 발생했습니다.', translatedAtUtc: now },
  answerSourceKo: null, answerLanguage: null, answerDraft: null, suggestedLanguage: 'en',
  translation: { provider: 'AzureAITranslator', configured: true, allowed: true }, changeToken: '2026-10-27T09:12:00+00:00',
};

function fixture(path: string, method = 'GET', body?: unknown): unknown {
  const url = new URL(path, 'https://fixture.invalid');
  const p = url.pathname;
  (window as unknown as { calls: unknown[] }).calls.push({ method, path, body });
  if (p.endsWith('/dashboard/kpis')) return { totalUsers: 1284, liveLinks: 48210, todaySignups: 17, seoulToday: '2026-10-28', timeZone: 'Asia/Seoul', generatedAtUtc: now };
  if (p.endsWith('/dashboard/series')) {
    const metric = url.searchParams.get('metric');
    const count = url.searchParams.get('range') === '7d' ? 7 : url.searchParams.get('range') === '90d' ? 90 : 30;
    // Like the API, every series ends exactly at its KPI (1,284 / 48,210 / 17).
    const points = metric === 'signups' ? days(count, i => (i === count - 1 ? 17 : [3, 0, 5, 12, 2, 8][i % 6])) : metric === 'links' ? days(count, i => 48210 - (count - 1 - i) * 74) : days(count, i => 1284 - (count - 1 - i) * 6);
    return { metric, from: points[0].date, through: points[points.length - 1].date, timeZone: 'Asia/Seoul', generatedAtUtc: now, points, definition: '정의 문장 (fixture)' };
  }
  if (p.endsWith('/users/directory')) {
    const items = Array.from({ length: 20 }, (_, i) => ({ userId: i + 1, jupleId: `K7MP${String(4000 + i)}`, displayName: i % 3 ? `사용자 ${i + 1}` : null, linkCount: 400 - i * 13, preferredLocale: i % 4 ? 'ko-KR' : 'en-US', language: i % 4 ? 'ko' : 'en', createdAtUtc: `2026-0${(i % 9) + 1}-1${i % 9}T03:00:00+00:00` }));
    return { items, page: Number(url.searchParams.get('page') ?? 1), pageSize: 20, total: 1284, languages: [{ language: 'ko', users: 960 }, { language: 'en', users: 280 }, { language: 'ja', users: 44 }] };
  }
  if (p.includes('/link-history')) {
    const buckets = Array.from({ length: 75 }, (_, i) => ({ start: day(74 - i), saved: [0, 2, 5, 1, 0, 9, 3][i % 7], cumulativeSaved: 0 }));
    let total = 0;
    for (const bucket of buckets) { total += bucket.saved; bucket.cumulativeSaved = total; }
    return { userId: Number(p.split('/')[5]), jupleId: 'K7MP4000', displayName: '사용자 1', createdAtUtc: '2026-08-15T03:00:00+00:00', signupDate: buckets[0].start, through: '2026-10-28', granularity: url.searchParams.get('granularity') ?? 'day', liveLinks: total - 4, savedSinceSignup: total, buckets };
  }
  if (p.endsWith('/notices/translation-status')) return { provider: 'AzureAITranslator', configured: true, languages: ['ko'] };
  if (p.endsWith('/notices/translations') && method === 'POST') {
    const requested = (body as { languages?: string[] }).languages ?? [];
    const sent = body as { title: string; body: string };
    return noticeFingerprint(sent.title, sent.body).then(sourceFingerprint => ({ provider: 'AzureAITranslator', sourceFingerprint, translatedAtUtc: now, results: requested.map(language => language === 'ar' ? { language, status: 'failed', title: null, body: null, errorCode: 'throttled' } : { language, status: 'translated', title: `[${language}] 서버 점검 안내`, body: `[${language}] 본문`, errorCode: null }) }));
  }
  if (p.endsWith('/admin/notices')) return { items: [{ id: 9, title: '서버 점검 안내', status: 'Published', isImportant: true, isPinned: false, startsAtUtc: now, endsAtUtc: null, createdAtUtc: now, languageCount: 3 }], nextCursor: null };
  if (/\/admin\/notices\/9$/.test(p)) return { id: 9, status: 'Published', isImportant: true, isPinned: false, platforms: 7, startsAtUtc: now, endsAtUtc: null, officialUrl: null, version: 'AQ==', createdAtUtc: now, updatedAtUtc: now, readVersion: 1, sourceFingerprint: 'a'.repeat(64),
    translations: [{ language: 'ko', title: '서버 점검 안내', body: '10월 30일 새벽 2시부터 30분간 점검합니다.', origin: 'Source' }, { language: 'en', title: 'Maintenance', body: 'Maintenance on Oct 30.', origin: 'Machine', sourceFingerprint: 'b'.repeat(64), translatedAtUtc: now }, { language: 'ja', title: '点検', body: '点検します。', origin: 'Manual', translatedAtUtc: now }] };
  if (/\/support\/inquiries$/.test(p)) return { items: [{ inquiryId: 7, status: 'Pending', type: 'Bug', user: inquiry.user, contentPreview: inquiry.content.slice(0, 80), platform: 'android', createdAtUtc: inquiry.createdAtUtc, updatedAtUtc: null, answeredAtUtc: null, locale: 'en-US', contentLanguage: 'en' }, { inquiryId: 6, status: 'InProgress', type: 'Account', user: null, contentPreview: 'ログインできません', platform: 'ios', createdAtUtc: '2026-10-26T01:00:00+00:00', updatedAtUtc: null, answeredAtUtc: null, locale: 'ja-JP', contentLanguage: null }], nextCursor: null };
  if (p.endsWith('/answer-translation')) return { language: 'en', text: 'Thank you. We fixed the issue in version 1.0 (37).', provider: 'AzureAITranslator' };
  if (/\/support\/inquiries\/7(\/.*)?$/.test(p)) return inquiry;
  if (p.endsWith('/expenses/configuration')) return { enabled: true, azureSyncEnabled: true, evidenceScanningConfigured: false, azureScopes: [{ scope: '/subscriptions/0000/resourceGroups/rg-juple-prod', environment: 'PROD' }], pricing: { monthlyUsdReferencePrice: 1.99, currency: 'USD', trialDays: 30 } };
  if (p.endsWith('/costs/history')) return { scope: 's', environment: 'PROD', todayUtc: '2026-10-28', months: ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'].map((month, i) => ({ month, isCurrent: i === 5, synced: i !== 1, lastSyncAtUtc: i !== 1 ? now : null, syncStatus: i !== 1 ? 'Succeeded' : 'Never', failureCode: null, amounts: i !== 1 ? [{ currency: 'KRW', amount: [41200, 0, 52300, 61800, 70450, 58210][i] }] : [] })) };
  if (p.endsWith('/azure-report')) return { scope: 's', month: (body as { month: string }).month, through: '2026-10-27', lastSyncAtUtc: now, syncStatus: 'Succeeded', failureCode: null, totals: [{ currency: 'KRW', current: 58210, previousSameDays: 60110, previousFullMonth: 70450, changePercent: -3.2 }], services: [{ date: '2026-10-01', label: 'Azure Container Apps', currency: 'KRW', amount: 30100 }, { date: '2026-10-02', label: 'Azure Container Apps', currency: 'KRW', amount: 1200 }, { date: '2026-10-01', label: 'SQL Database', currency: 'KRW', amount: 18800 }, { date: '2026-10-01', label: 'Storage', currency: 'KRW', amount: 8110 }], resources: { status: 'notRequested', points: [] }, forecast: { status: 'notRequested', points: [] } };
  if (p.endsWith('/workspace/revenue')) return { billingProgramEnabled: false, amountsAvailable: false, explanation: '현재 Billing에는 구매의 최신 권한 상태만 있습니다.', currentPurchaseStates: [] };
  if (p.endsWith('/operations/app-version')) return { android: { platform: 'android', enabled: true, latestBuild: 34, minimumSupportedBuild: 24, storeUrl: 'https://play.google.com/store/apps/details?id=com.juple.app', source: 'database', version: 'AAAAAAAAB9E=', updatedAtUtc: now, updatedByAdminUserId: null, configuredLatestBuild: 33, configuredMinimumSupportedBuild: 24, canEdit: true }, ios: { platform: 'ios', enabled: false, latestBuild: 0, minimumSupportedBuild: 0, storeUrl: null, source: 'configuration', version: null, updatedAtUtc: null, updatedByAdminUserId: null, configuredLatestBuild: 0, configuredMinimumSupportedBuild: 0, canEdit: true } };
  if (p.endsWith('/workspace/configuration')) return { enabled: true, timeZone: 'Asia/Seoul', maxDays: 366 };
  throw new Error(`fixture has no answer for ${method} ${p}`);
}

export default function Harness() {
  const params = useSearchParams();
  const page = params.get('page') ?? 'dashboard';
  const value = useMemo<AdminContextValue>(() => ({
    api: async <T,>(request: { method?: string; path: string; body?: unknown }) => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return (await fixture(request.path, request.method, request.body)) as T;
    },
    me: { userId: 1, role: 'Owner' },
    config: {} as AdminContextValue['config'],
    reportFailure: () => undefined,
  }), []);
  useEffect(() => {
    document.documentElement.dataset.v2Harness = page;
  }, [page]);
  if (typeof window !== 'undefined') {
    (window as unknown as { calls: unknown[] }).calls ??= [];
  }
  const screens: Record<string, React.ReactNode> = {
    dashboard: <Dashboard />, users: <Users />, notices: <Notices />, notice: <NoticeEditor id={9} />, inquiries: <Inquiries />,
    inquiry: <Inquiry />, costs: <Costs />, 'app-version': <AppVersion />, settings: <Settings />,
  };
  return (
    <AdminContextProvider value={value}>
      <AdminShell me={value.me} onSignOut={() => undefined}>{screens[page]}</AdminShell>
    </AdminContextProvider>
  );
}
