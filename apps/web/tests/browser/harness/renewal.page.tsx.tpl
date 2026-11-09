'use client';
// Test-only (copied to app/renewal-test-harness/ by tests/browser/webRenewal.browser.mjs and deleted afterwards). A local stub API only.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SignedInAppContext } from '../(app)/AppRoot';
import { ToastProvider } from '../(app)/Toaster';
import { PersonalLinkSelection, SelectModeButton } from '../(app)/LinkSelection';
import { SavedLinkList } from '../(app)/SavedLinkList';
import { RequestActionButton } from '../(app)/collections/RequestActionButton';
import { SubscriptionSection } from '../(app)/me/MyPageSections';
import { ViewModeToggle } from '../(app)/ViewModeToggle';
import { PageHeader } from '../(app)/PageHeader';
import { getAppDictionary } from '../../lib/appDictionary';
import { formatMessage, isAppLanguage, type AppLanguage } from '../../lib/appI18n';
import type { LinkView, LinkViewMode } from '../../lib/savedLinks';
import { AppShell } from './AppShell';
import { StickyControls } from '../(app)/StickyControls';
import styles from '../(app)/app.module.css';

const titles = ['A practical guide to calm, focused work on a busy week', '서울 성수동 주말 카페 산책 코스 정리', 'Recipe: crispy roasted vegetables', '旅行の持ち物チェックリスト', 'Một bài viết rất dài về cách sắp xếp liên kết theo bộ sưu tập', 'Weekend reading', 'Design system tokens', 'Short'];

function links(): readonly LinkView[] {
  return titles.map((text, index) => ({
    id: index + 1,
    locked: index === 5,
    title: index === 5 ? { kind: 'locked' } : { kind: 'text', text, technical: false },
    memo: index % 3 === 0 ? 'A memo the person wrote for this link' : null,
    site: index === 5 ? null : `site${index}.example.com`,
    siteId: null,
    thumbnailUrl: null,
    timestampUtc: '2026-11-01T00:00:00Z',
    href: `/items/${index + 1}`,
    externalUrl: index === 5 ? null : `https://site${index}.example.com/${index}`,
  }));
}

export default function Page() {
  const query = useSearchParams();
  const language: AppLanguage = isAppLanguage(query.get('lang')) ? (query.get('lang') as AppLanguage) : 'ko';
  const [mode, setMode] = useState<LinkViewMode>((query.get('view') as LinkViewMode) || 'grid');
  const dictionary = getAppDictionary(language);
  const value = useMemo(
    () => ({
      dictionary,
      locale: language,
      account: { homeAccountId: 'fixture' },
      appDownload: { googlePlayUrl: 'https://play.google.com/store/apps/details?id=com.juple.app', appStoreUrl: null },
      profile: null,
      entitlement: { programEnabled: true, status: 'trial', reason: null, trialEndsAtUtc: '2026-12-01T00:00:00Z', accessFrozenAtUtc: null, canWrite: true },
      storeSubscription: query.get('store') ? { state: 'active', platform: query.get('store') === 'unknown' ? null : query.get('store'), currentPeriodEndsAtUtc: '2026-12-01T00:00:00Z', autoRenewing: true, startedAtUtc: '2026-11-01T00:00:00Z', endedState: null, endedAtUtc: null } : null,
      dataRetention: null,
      dataExportEnabled: false,
      onSessionLost() {},
      api: async (request: { path: string; method?: string }) => {
        const calls = JSON.parse(sessionStorage.getItem('calls') || '[]');
        calls.push(`${request.method ?? 'GET'} ${request.path}`);
        sessionStorage.setItem('calls', JSON.stringify(calls));
        if (request.path.includes('unread')) return { unreadCount: 0 };
        return { items: [], nextCursor: null };
      },
    }),
    [dictionary, language, query],
  );
  return (
    <SignedInAppContext.Provider value={value as never}>
      <ToastProvider>
        <AppShell>
          <section className={styles.page}>
            <PageHeader icon="Home" title={dictionary.homeTitle} />
            <div className={styles.requestActions} data-fixture-requests>
              <RequestActionButton accessibleLabel="a" count={3} icon="Link" label={dictionary.requestsPendingSubmissions} onClick={() => undefined} testId="link-submissions" />
              <RequestActionButton accessibleLabel="b" count={12} icon="People" label={dictionary.requestsJoinRequests} onClick={() => undefined} testId="join-requests" />
            </div>
            <PersonalLinkSelection selectAllIds={links}>
              <section className={styles.surfaceSection}>
                <StickyControls>
                <div className={styles.sectionBar}>
                  <h2 className={styles.sectionTitle}>{formatMessage(dictionary.selectionSelectedCount, { count: 0 })}</h2>
                  <SelectModeButton label={dictionary.selectionSelectItems} />
                  <ViewModeToggle groupLabel={dictionary.viewModeLabel} labels={{ list: dictionary.viewList, grid: dictionary.viewGrid, image: dictionary.viewImage }} onChange={setMode} value={mode} />
                </div>
                </StickyControls>
                <SavedLinkList dictionary={dictionary} links={links()} mode={mode} />
              </section>
            </PersonalLinkSelection>
            <div data-fixture-membership>
              <SubscriptionSection />
            </div>
          </section>
        </AppShell>
      </ToastProvider>
    </SignedInAppContext.Provider>
  );
}
