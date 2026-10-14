'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { isSessionLost } from '../../../../lib/authSession';
import { appendPage, canLoadMore, failLoadingMore, firstPage, startLoadingMore, type PagedState } from '../../../../lib/paging';
import {
  formatInquiryDateTime,
  inquiryListPath,
  inquiryPreview,
  inquiryStatusLabel,
  inquiryTypeLabel,
  parseInquiryPage,
  type SupportInquiry,
} from '../../../../lib/support';
import { useSignedInApp } from '../../AppRoot';
import { Glyph } from '../../Glyph';
import { LoadMore } from '../../InfiniteScroll';
import { LoadFailed } from '../../PageStates';
import { SettingsPage } from '../SettingsPage';
import styles from '../../app.module.css';

/**
 * 고객센터 (mobile CustomerCenterScreen + the inquiry history): 문의하기 opens the in-app inquiry form - no mail program involved - and
 * 문의 내역 lists the signed-in person's own inquiries, newest first, a page at a time, each opening its details (and the operator's
 * answer once there is one). The two legal documents stay below, as before.
 */
export function CustomerCenter() {
  const { dictionary } = useSignedInApp();
  return (
    <SettingsPage title={dictionary.customerCenterTitle}>
      <section className={styles.settingsSection}>
        <h2 className={styles.sectionHeading}>{dictionary.customerCenterInquiryHeading}</h2>
        <div className={styles.supportIntro}>
          <p className={styles.supportIntroText}>{dictionary.inquiryHelpNote1}</p>
          <Link className={styles.primaryAction} data-support-new href="/me/support/new">
            <Glyph name="Edit" size={16} />
            {dictionary.inquiryTabWrite}
          </Link>
        </div>
      </section>

      <section className={styles.settingsSection}>
        <h2 className={styles.sectionHeading}>{dictionary.inquiryTabHistory}</h2>
        <InquiryHistory />
      </section>

      <section className={styles.settingsSection}>
        <div className={styles.settingsCard} data-customer-center>
          <Link className={`${styles.settingsRow} ${styles.settingsRowAction}`} href="/terms">
            <span className={styles.settingsLabel}>{dictionary.customerCenterTerms}</span>
            <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
          </Link>
          <Link className={`${styles.settingsRow} ${styles.settingsRowAction}`} href="/privacy">
            <span className={styles.settingsLabel}>{dictionary.customerCenterPrivacy}</span>
            <Glyph className={styles.settingsChevron} name="Chevron" size={16} />
          </Link>
        </div>
      </section>
    </SettingsPage>
  );
}

type History = { readonly kind: 'loading' } | { readonly kind: 'failed' } | ({ readonly kind: 'loaded' } & PagedState<SupportInquiry>);

function InquiryHistory() {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const [history, setHistory] = useState<History>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let ignore = false;
    api<unknown>({ path: inquiryListPath(null) }).then(
      raw => {
        if (ignore) {
          return;
        }
        const page = parseInquiryPage(raw);
        setHistory({ kind: 'loaded', ...firstPage(page.items, page.nextCursor) });
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setHistory({ kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, onSessionLost, reloadToken]);

  const loadMore = useCallback(() => {
    if (history.kind !== 'loaded' || !canLoadMore(history)) {
      return;
    }
    const cursor = history.nextCursor;
    setHistory({ kind: 'loaded', ...startLoadingMore(history) });
    api<unknown>({ path: inquiryListPath(cursor) }).then(
      raw => {
        const page = parseInquiryPage(raw);
        setHistory(current => (current.kind === 'loaded' ? { kind: 'loaded', ...appendPage(current, page, entry => entry.inquiryId) } : current));
      },
      caught => {
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setHistory(current => (current.kind === 'loaded' ? { kind: 'loaded', ...failLoadingMore(current) } : current));
      },
    );
  }, [api, history, onSessionLost]);

  if (history.kind === 'loading') {
    return (
      <div aria-busy className={styles.settingsCard}>
        {[0, 1, 2].map(index => (
          <div aria-hidden className={styles.inquiryRowSkeleton} key={index}>
            <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
            <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
          </div>
        ))}
      </div>
    );
  }
  if (history.kind === 'failed') {
    return (
      <LoadFailed
        dictionary={dictionary}
        onRetry={() => {
          setHistory({ kind: 'loading' });
          setReloadToken(token => token + 1);
        }}
      />
    );
  }
  if (history.items.length === 0) {
    return (
      <div className={styles.inquiryEmpty} data-inquiry-empty>
        <Glyph name="Comment" size={28} />
        <p className={styles.stateMessage}>{dictionary.inquiryHistoryEmpty}</p>
      </div>
    );
  }
  return (
    <>
      <ul className={`${styles.settingsCard} ${styles.inquiryList}`} data-inquiry-list>
        {history.items.map(inquiry => (
          <li key={inquiry.inquiryId}>
            <Link className={styles.inquiryRow} href={`/me/support/${inquiry.inquiryId}`}>
              <span className={styles.inquiryRowTop}>
                <span className={styles.inquiryType}>{inquiryTypeLabel(inquiry.type, dictionary)}</span>
                <span className={inquiry.status === 'Answered' ? `${styles.statusPill} ${styles.statusPillDone}` : styles.statusPill} data-inquiry-status={inquiry.status}>
                  {inquiryStatusLabel(inquiry.status, dictionary)}
                </span>
              </span>
              <span className={styles.inquiryPreview}>{inquiryPreview(inquiry.content)}</span>
              <span className={styles.inquiryDate}>{formatInquiryDateTime(inquiry.createdAtUtc, locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore
        dictionary={dictionary}
        onLoadMore={loadMore}
        skeleton={<div className={styles.inquiryRowSkeleton}><span className={`${styles.skeletonLine} ${styles.skeleton}`} /></div>}
        state={history}
      />
    </>
  );
}
