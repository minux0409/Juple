'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { formatMessage } from '../../../../../lib/appI18n';
import { isSessionLost } from '../../../../../lib/authSession';
import {
  canSubmitInquiry,
  inquiryDiagnostics,
  inquiryTypeLabel,
  isSupportInquiryType,
  submissionAttempt,
  SUPPORT_INQUIRIES_PATH,
  SUPPORT_INQUIRY_MAX_LENGTH,
  SUPPORT_INQUIRY_TYPES,
  type SupportInquiryType,
} from '../../../../../lib/support';
import { useSignedInApp } from '../../../AppRoot';
import { Glyph } from '../../../Glyph';
import { PillListbox } from '../../../Popover';
import { useToast } from '../../../Toaster';
import { SettingsPage } from '../../SettingsPage';
import styles from '../../../app.module.css';

/**
 * 문의하기 (mobile SupportInquiryScreen, write tab): a type and the text - nothing else is asked, nothing is attached. Send is possible
 * once both are there; the same text sent again after a failure is the SAME submission (one request id), so a flaky network never makes a
 * second inquiry; a draft that failed stays exactly as typed. Only the browser's language and "web" go along as diagnostics.
 */
export function NewInquiry() {
  const { api, dictionary, onSessionLost } = useSignedInApp();
  const router = useRouter();
  const toast = useToast();
  const typeId = useId();
  const contentId = useId();
  const [type, setType] = useState<SupportInquiryType | null>(null);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const sending = useRef(false);
  const attempt = useRef<{ readonly id: string; readonly type: SupportInquiryType; readonly content: string } | null>(null);

  const canSubmit = canSubmitInquiry(type, content, submitting);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = content.trim();
    // A second press while the first is on its way does nothing (state alone lags a frame behind a fast double click).
    if (sending.current || type === null || !canSubmitInquiry(type, content, false)) {
      return;
    }
    sending.current = true;
    setSubmitting(true);
    setFailed(false);
    attempt.current = submissionAttempt(attempt.current, type, trimmed, () => crypto.randomUUID());
    api<unknown>({
      method: 'POST',
      path: SUPPORT_INQUIRIES_PATH,
      body: { clientRequestId: attempt.current.id, type, content: trimmed, diagnostics: inquiryDiagnostics(navigator.language) },
    }).then(
      () => {
        // Only now, with the server's answer in hand, is the draft let go.
        attempt.current = null;
        toast.showNotice(dictionary.inquirySuccess);
        router.push('/me/support');
      },
      caught => {
        sending.current = false;
        setSubmitting(false);
        if (isSessionLost(caught)) {
          onSessionLost();
          return;
        }
        setFailed(true);
      },
    );
  };

  return (
    <SettingsPage backHref="/me/support" title={dictionary.inquiryTabWrite}>
      <form className={styles.inquiryForm} data-inquiry-form noValidate onSubmit={submit}>
        <div className={styles.fieldBlock}>
          <label className={styles.fieldLabel} htmlFor={typeId}>
            {dictionary.inquiryTypeLabel} <span aria-label={dictionary.inquiryRequired} className={styles.requiredMark}>*</span>
          </label>
          {/* Juple's own listbox (not the browser's select element, whose open list is the operating system's); the value is still the API's type name. */}
          <PillListbox<'' | SupportInquiryType>
            disabled={submitting}
            id={typeId}
            label={dictionary.inquiryTypeLabel}
            onChange={next => setType(isSupportInquiryType(next) ? next : null)}
            options={[{ value: '', label: dictionary.inquiryTypePlaceholder }, ...SUPPORT_INQUIRY_TYPES.map(candidate => ({ value: candidate, label: inquiryTypeLabel(candidate, dictionary) }))]}
            value={type ?? ''}
            variant="field"
          />
        </div>

        <div className={styles.fieldBlock}>
          <label className={styles.fieldLabel} htmlFor={contentId}>
            {dictionary.inquiryContentLabel} <span aria-label={dictionary.inquiryRequired} className={styles.requiredMark}>*</span>
          </label>
          <textarea
            className={`${styles.textArea} ${styles.inquiryTextArea}`}
            disabled={submitting}
            id={contentId}
            maxLength={SUPPORT_INQUIRY_MAX_LENGTH}
            onChange={event => setContent(event.target.value)}
            placeholder={dictionary.inquiryContentPlaceholder}
            required
            value={content}
          />
          <p className={styles.fieldCounter} data-inquiry-counter>
            {formatMessage(dictionary.inquiryCounter, { count: content.length, max: SUPPORT_INQUIRY_MAX_LENGTH })}
          </p>
        </div>

        <ul className={styles.inquiryNotes}>
          {[dictionary.inquiryHelpNote1, dictionary.inquiryHelpNote2].map(note => (
            <li key={note}>
              <Glyph name="Comment" size={16} />
              <span>{note}</span>
            </li>
          ))}
        </ul>

        {failed ? (
          <p className={styles.fieldError} role="alert">
            {dictionary.inquirySubmitFailed}
          </p>
        ) : null}

        <div className={styles.formActions}>
          <button aria-busy={submitting} className={styles.primaryAction} data-inquiry-submit disabled={!canSubmit} type="submit">
            {submitting ? dictionary.processing : dictionary.inquirySubmit}
          </button>
        </div>
      </form>
    </SettingsPage>
  );
}
