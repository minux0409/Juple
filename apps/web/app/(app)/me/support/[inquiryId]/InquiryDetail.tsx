'use client';

import { useEffect, useState } from 'react';
import { isSessionLost } from '../../../../../lib/authSession';
import {
  formatInquiryDateTime,
  inquiryPath,
  inquiryStatusLabel,
  inquiryTypeLabel,
  isInquiryNotFound,
  parseInquiry,
  parseInquiryId,
  type SupportInquiry,
} from '../../../../../lib/support';
import { useSignedInApp } from '../../../AppRoot';
import { LoadFailed, Notice } from '../../../PageStates';
import { SettingsPage } from '../../SettingsPage';
import styles from '../../../app.module.css';

type State = { readonly kind: 'loading' } | { readonly kind: 'failed' } | { readonly kind: 'notFound' } | { readonly kind: 'loaded'; readonly inquiry: SupportInquiry };

/**
 * 문의 상세 (mobile SupportInquiryDetailScreen): the type, the status (spelled out, never a colour alone), when it was received, the
 * text, and the operator's answer - or "waiting for an answer". Someone else's id is a plain "not found" (the server answers 404 for it).
 * Everything is rendered as TEXT: an inquiry or an answer is never interpreted as markup.
 */
export function InquiryDetail({ inquiryIdParam }: { readonly inquiryIdParam: string }) {
  const { api, dictionary, locale, onSessionLost } = useSignedInApp();
  const inquiryId = parseInquiryId(inquiryIdParam);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (inquiryId === null) {
      return undefined;
    }
    let ignore = false;
    api<unknown>({ path: inquiryPath(inquiryId) }).then(
      raw => {
        if (ignore) {
          return;
        }
        const inquiry = parseInquiry(raw);
        setState(inquiry ? { kind: 'loaded', inquiry } : { kind: 'failed' });
      },
      caught => {
        if (ignore) {
          return;
        }
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setState(isInquiryNotFound(caught) ? { kind: 'notFound' } : { kind: 'failed' });
      },
    );
    return () => {
      ignore = true;
    };
  }, [api, inquiryId, onSessionLost, reloadToken]);

  const resolved: State = inquiryId === null ? { kind: 'notFound' } : state;

  return (
    <SettingsPage backHref="/me/support" title={dictionary.inquiryDetailTitle}>
      {resolved.kind === 'loading' ? (
        <div aria-busy className={styles.inquiryDetailSkeleton}>
          <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
          <span className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
          <span className={`${styles.skeletonLine} ${styles.skeleton}`} />
        </div>
      ) : null}
      {resolved.kind === 'notFound' ? <Notice message={dictionary.inquiryNotFound} /> : null}
      {resolved.kind === 'failed' ? (
        <LoadFailed
          dictionary={dictionary}
          onRetry={() => {
            setState({ kind: 'loading' });
            setReloadToken(token => token + 1);
          }}
        />
      ) : null}
      {resolved.kind === 'loaded' ? <InquiryBody dictionary={dictionary} inquiry={resolved.inquiry} locale={locale} /> : null}
    </SettingsPage>
  );
}

function InquiryBody({ inquiry, dictionary, locale }: { readonly inquiry: SupportInquiry; readonly dictionary: ReturnType<typeof useSignedInApp>['dictionary']; readonly locale: string }) {
  const answered = inquiry.status === 'Answered' && inquiry.answer !== null;
  return (
    <article className={styles.inquiryDetail} data-inquiry-detail>
      <div className={styles.inquiryDetailHead}>
        <span className={styles.inquiryType}>{inquiryTypeLabel(inquiry.type, dictionary)}</span>
        <span className={inquiry.status === 'Answered' ? `${styles.statusPill} ${styles.statusPillDone}` : styles.statusPill} data-inquiry-status={inquiry.status}>
          {inquiryStatusLabel(inquiry.status, dictionary)}
        </span>
      </div>
      <section className={styles.inquirySection}>
        <h2 className={styles.inquirySectionTitle}>{dictionary.inquiryContentHeading}</h2>
        <p className={styles.inquiryMeta}>
          {dictionary.inquiryReceivedAt} {formatInquiryDateTime(inquiry.createdAtUtc, locale)}
        </p>
        <p className={styles.inquiryText} data-inquiry-content>
          {inquiry.content}
        </p>
      </section>
      <section className={`${styles.inquirySection} ${styles.inquiryAnswer}`}>
        <h2 className={styles.inquirySectionTitle}>{dictionary.inquiryAnswerHeading}</h2>
        {answered ? (
          <>
            {inquiry.answeredAtUtc ? (
              <p className={styles.inquiryMeta}>
                {dictionary.inquiryAnsweredAt} {formatInquiryDateTime(inquiry.answeredAtUtc, locale)}
              </p>
            ) : null}
            <p className={styles.inquiryText} data-inquiry-answer>
              {inquiry.answer}
            </p>
          </>
        ) : (
          <p className={styles.inquiryAwaiting} data-inquiry-awaiting>
            {dictionary.inquiryAwaitingAnswer}
          </p>
        )}
      </section>
    </article>
  );
}
