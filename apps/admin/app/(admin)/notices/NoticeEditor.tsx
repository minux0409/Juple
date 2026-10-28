'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAdmin, PageState } from '../AdminRoot';
import { failureMessage } from '../../../lib/adminModel';
import { ApiHttpError } from '../../../lib/adminApi';
import { localDateTime, type AdminNotice } from '../../../lib/notices';
import {
  LANGUAGES,
  NOTICE_STATE_LABELS,
  applyTranslation,
  editTranslation,
  formatSeoulInstant,
  languageName,
  languagesToRefresh,
  noticeFingerprint,
  noticeLanguageState,
  translationErrorLabel,
  v2Paths,
  type NoticeLanguageState,
  type NoticeTextV2,
  type NoticeTranslationBatch,
} from '../../../lib/adminV2';
import { TranslateIcon } from '../v2/Icons';
import { PageTitle, Panel } from '../v2/ui';
import { useAdminResource } from '../v2/useAdminResource';

type NoticeV2 = Omit<AdminNotice, 'translations'> & { translations: NoticeTextV2[]; sourceFingerprint?: string | null };

/**
 * 공지사항 작성/수정: the Korean original (always required - users without a translation in their language see it), and one
 * translation per supported language. Machine translation is an explicit action that only fills the form; nothing is published
 * until 저장. A translation edited by hand becomes 수동 작성 and is never replaced by 번역 갱신 (only by an explicit, confirmed 재번역).
 */
export function NoticeEditor({ id }: { readonly id?: number }) {
  const { api, reportFailure } = useAdmin();
  const router = useRouter();
  const translation = useAdminResource<{ provider: string; configured: boolean }>(v2Paths.noticeTranslationStatus, 300_000);
  const [original, setOriginal] = useState<NoticeV2 | null>(null);
  const [texts, setTexts] = useState<NoticeTextV2[]>([{ language: 'ko', title: '', body: '', origin: 'Source' }]);
  const [language, setLanguage] = useState<string>('en');
  const [status, setStatus] = useState('Draft');
  const [important, setImportant] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [platforms, setPlatforms] = useState(7);
  const [start, setStart] = useState(() => localDateTime(new Date().toISOString()));
  const [end, setEnd] = useState('');
  const [url, setUrl] = useState('');
  const [reset, setReset] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false);
  const [translating, setTranslating] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlyMap<string, string>>(new Map());
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const korean = texts.find(text => text.language === 'ko') ?? { language: 'ko', title: '', body: '' };

  useEffect(() => {
    if (error && feedback.current) {
      feedback.current.focus({ preventScroll: true });
      feedback.current.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);

  // The fingerprint of the Korean text as it is NOW, to tell which machine translations were made from an older original.
  useEffect(() => {
    let active = true;
    if (!korean.title.trim() || !korean.body.trim()) {
      queueMicrotask(() => active && setFingerprint(null));
      return () => {
        active = false;
      };
    }
    void noticeFingerprint(korean.title, korean.body).then(value => active && setFingerprint(value));
    return () => {
      active = false;
    };
  }, [korean.title, korean.body]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    api<NoticeV2>({ path: `/api/v1/admin/notices/${id}` }).then(
      n => {
        if (!active) return;
        setOriginal(n);
        setTexts(n.translations);
        setStatus(n.status);
        setImportant(n.isImportant);
        setPinned(n.isPinned);
        setPlatforms(n.platforms);
        setStart(localDateTime(n.startsAtUtc));
        setEnd(n.endsAtUtc ? localDateTime(n.endsAtUtc) : '');
        setUrl(n.officialUrl ?? '');
        setLoading(false);
        setError(null);
        setReset(false);
      },
      e => {
        if (active) {
          reportFailure(e);
          setError(failureMessage(e));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, id, reportFailure, attempt]);

  const failedSet = useMemo(() => new Set(failed.keys()), [failed]);
  const states = useMemo(
    () => new Map<string, NoticeLanguageState>(LANGUAGES.filter(code => code !== 'ko').map(code => [code, noticeLanguageState(texts.find(text => text.language === code), fingerprint, failed.has(code))])),
    [texts, fingerprint, failed],
  );
  const selected = texts.find(text => text.language === language) ?? { language, title: '', body: '' };
  const selectedState = states.get(language) ?? 'missing';
  const configured = translation.data?.configured === true;
  const staleCount = [...states.values()].filter(state => state === 'stale').length;

  const translate = async (languages: readonly string[]) => {
    if (!languages.length || !korean.title.trim() || !korean.body.trim()) {
      setNotice(korean.title.trim() && korean.body.trim() ? '갱신할 번역이 없습니다.' : '한국어 제목과 본문을 먼저 입력하세요.');
      return;
    }
    setNotice(null);
    setTranslating(new Set(languages));
    try {
      const batch = await api<NoticeTranslationBatch>({ method: 'POST', path: v2Paths.noticeTranslations, body: { title: korean.title, body: korean.body, languages } });
      setTexts(previous => batch.results.reduce((next, result) => applyTranslation(next, result, batch.sourceFingerprint), previous));
      setFailed(previous => {
        const next = new Map(previous);
        for (const result of batch.results) {
          if (result.status === 'translated') next.delete(result.language);
          else next.set(result.language, result.errorCode ?? 'unknown');
        }
        return next;
      });
      const failures = batch.results.filter(result => result.status === 'failed').length;
      setNotice(failures ? `${batch.results.length - failures}개 언어를 번역했고 ${failures}개 언어는 실패했습니다. 저장하기 전에 확인하세요.` : `${batch.results.length}개 언어를 번역했습니다. 확인 후 저장하세요.`);
    } catch (e) {
      reportFailure(e);
      const code = e instanceof ApiHttpError && e.status === 409 ? 'translationNotConfigured' : e instanceof ApiHttpError && e.status === 429 ? 'translationBusy' : null;
      setNotice(code ? translationErrorLabel(code) : `번역하지 못했습니다. ${failureMessage(e)}`);
    } finally {
      setTranslating(new Set());
    }
  };

  const retranslateSelected = () => {
    if (selectedState === 'manual' && !window.confirm(`${languageName(language)} 번역은 직접 작성(수정)한 내용입니다. 자동 번역으로 덮어쓸까요?`)) {
      return;
    }
    void translate([language]);
  };

  const save = async (nextStatus = status) => {
    if (pending.current) return;
    setSaved(false);
    const translations = texts.filter(t => t.language === 'ko' || t.title || t.body);
    const ko = translations.find(t => t.language === 'ko');
    if (!ko?.title.trim() || !ko.body.trim() || translations.some(t => !t.title.trim() || !t.body.trim())) {
      setError('한국어 제목·본문은 필수이며, 추가 언어도 제목·본문을 함께 입력해 주세요.');
      return;
    }
    const startsAt = new Date(start);
    const endsAt = end ? new Date(end) : null;
    if (!platforms || !Number.isFinite(startsAt.getTime()) || (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt))) {
      setError('노출 플랫폼과 게시 기간을 확인해 주세요.');
      return;
    }
    let officialUrl: string | null = null;
    if (url.trim()) {
      try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error();
        officialUrl = url.trim();
      } catch {
        setError('공식 안내 링크는 로그인 정보가 없는 HTTPS 주소로 입력해 주세요.');
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api<NoticeV2>({
        method: id ? 'PUT' : 'POST',
        path: `/api/v1/admin/notices${id ? `/${id}` : ''}`,
        body: {
          status: nextStatus,
          isImportant: important,
          isPinned: pinned,
          platforms,
          startsAtUtc: startsAt.toISOString(),
          endsAtUtc: endsAt ? endsAt.toISOString() : null,
          officialUrl,
          translations: translations.map(t => ({
            language: t.language,
            title: t.title,
            body: t.body,
            origin: t.language === 'ko' ? 'Source' : t.origin === 'Machine' ? 'Machine' : 'Manual',
            sourceFingerprint: t.language !== 'ko' && t.origin === 'Machine' ? t.sourceFingerprint ?? null : null,
          })),
          version: original?.version ?? null,
          resetRead: reset,
        },
      });
      setOriginal(result);
      setStatus(result.status);
      setReset(false);
      setSaved(true);
      router.replace(`/notices?saved=${result.id}`);
      router.refresh();
    } catch (e) {
      reportFailure(e);
      setError(`저장하지 못했습니다.${e instanceof ApiHttpError ? ` (HTTP ${e.status})` : ''} ${failureMessage(e)}`);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const remove = async () => {
    if (pending.current || !original || !window.confirm('이 공지를 삭제할까요? 운영 이력은 보존되며 사용자에게 더 이상 표시되지 않습니다.')) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api<void>({ method: 'DELETE', path: `/api/v1/admin/notices/${original.id}?version=${encodeURIComponent(original.version)}` });
      router.replace('/notices');
    } catch (e) {
      reportFailure(e);
      setError(failureMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle actions={<Link href="/notices">목록</Link>} eyebrow="공지사항" title={id ? '공지 수정' : '공지 작성'} />
      <PageState
        error={original || !id ? null : error}
        loading={loading}
        onRetry={() => {
          if (id) {
            setLoading(true);
            setAttempt(a => a + 1);
          } else setError(null);
        }}
      />
      {!loading && (!id || original) ? (
        <form
          aria-busy={busy}
          className="notice-editor v2-notice-editor"
          noValidate
          onSubmit={e => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="v2-notice-grid">
            <Panel className="v2-notice-source" title="한국어 원본">
              <fieldset disabled={busy}>
                <label>
                  제목
                  <input maxLength={200} onChange={e => setTexts(old => editTranslation(old, 'ko', 'title', e.target.value))} value={korean.title} />
                </label>
                <label>
                  내용
                  <textarea maxLength={20000} onChange={e => setTexts(old => editTranslation(old, 'ko', 'body', e.target.value))} rows={12} value={korean.body} />
                </label>
                <p className="v2-footnote">문단·줄바꿈, - 목록, 1. 목록, [링크 이름](https://...)을 지원합니다. HTML은 실행하지 않습니다.</p>
              </fieldset>
              <fieldset className="v2-form-grid" disabled={busy}>
                <legend>게시 설정</legend>
                <label>
                  게시 상태
                  <select onChange={e => setStatus(e.target.value)} value={status}>
                    <option value="Draft">초안 / 중단</option>
                    <option value="Published">게시 (시작일 이후 노출)</option>
                  </select>
                </label>
                <label>
                  게시 시작 (현지 시간)
                  <input onChange={e => setStart(e.target.value)} required type="datetime-local" value={start} />
                </label>
                <label>
                  게시 종료 (선택)
                  <input onChange={e => setEnd(e.target.value)} type="datetime-local" value={end} />
                </label>
                <div className="v2-checks">
                  <label><input checked={important} onChange={e => setImportant(e.target.checked)} type="checkbox" /> 중요 공지</label>
                  <label><input checked={pinned} onChange={e => setPinned(e.target.checked)} type="checkbox" /> 상단 고정</label>
                </div>
                <div className="v2-checks" role="group" aria-label="노출 플랫폼">
                  <label><input checked={platforms === 7} onChange={e => setPlatforms(e.target.checked ? 7 : 0)} type="checkbox" /> 전체</label>
                  {([['Web', 1], ['Android', 2], ['iOS', 4]] as const).map(([label, bit]) => (
                    <label key={label}>
                      <input checked={(platforms & bit) !== 0} onChange={e => setPlatforms(old => (e.target.checked ? old | bit : old & ~bit))} type="checkbox" /> {label}
                    </label>
                  ))}
                </div>
                <label className="v2-span">
                  공식 안내 링크 (선택, HTTPS)
                  <input maxLength={2048} onChange={e => setUrl(e.target.value)} type="url" value={url} />
                </label>
                {id ? (
                  <label className="v2-span">
                    <span><input checked={reset} onChange={e => setReset(e.target.checked)} type="checkbox" /> 기존 읽음 상태 초기화 (기본: 읽음 유지)</span>
                  </label>
                ) : null}
              </fieldset>
            </Panel>

            <Panel
              actions={
                <button disabled={busy || !configured || translating.size > 0} onClick={() => void translate(languagesToRefresh(texts, fingerprint, failedSet))} type="button">
                  <TranslateIcon size={16} /> 번역 갱신
                </button>
              }
              className="v2-notice-translations"
              title="언어별 번역"
            >
              <p className={configured ? 'v2-footnote' : 'v2-callout'}>
                {translation.loading
                  ? '번역 제공자 상태를 확인하는 중…'
                  : configured
                    ? `자동 번역: ${translation.data?.provider}. 번역 갱신은 번역이 없거나, 실패했거나, 원문이 바뀐 자동 번역만 다시 번역합니다. 직접 수정한 번역은 바꾸지 않습니다.`
                    : '자동 번역 제공자가 설정되지 않았습니다. 번역문을 직접 입력할 수 있으며, 번역이 없는 언어의 사용자에게는 한국어 원본이 표시됩니다.'}
              </p>
              {staleCount ? <p className="v2-callout">원문이 바뀐 뒤 갱신되지 않은 자동 번역 {staleCount}개 언어가 있습니다.</p> : null}
              <div className="v2-language-list" role="listbox" aria-label="번역 언어">
                {LANGUAGES.filter(code => code !== 'ko').map(code => {
                  const state = states.get(code) ?? 'missing';
                  return (
                    <button aria-selected={code === language} className="v2-language" key={code} onClick={() => setLanguage(code)} role="option" type="button">
                      <span>{languageName(code)}</span>
                      <span className={`v2-badge v2-state-${state}`}>{translating.has(code) ? '번역 중…' : NOTICE_STATE_LABELS[state]}</span>
                    </button>
                  );
                })}
              </div>
              <fieldset className="v2-translation-editor" disabled={busy}>
                <legend>
                  {languageName(language)} · {NOTICE_STATE_LABELS[selectedState]}
                  {selected.translatedAtUtc ? <span className="v2-muted"> · {formatSeoulInstant(selected.translatedAtUtc)}</span> : null}
                </legend>
                {failed.has(language) ? <p className="v2-field-error">{translationErrorLabel(failed.get(language))}</p> : null}
                <label>
                  제목
                  <input maxLength={200} onChange={e => setTexts(old => editTranslation(old, language, 'title', e.target.value))} value={selected.title} />
                </label>
                <label>
                  내용
                  <textarea maxLength={20000} onChange={e => setTexts(old => editTranslation(old, language, 'body', e.target.value))} rows={9} value={selected.body} />
                </label>
                <div className="v2-actions">
                  <button disabled={!configured || translating.size > 0} onClick={retranslateSelected} type="button">
                    <TranslateIcon size={16} /> 이 언어 재번역
                  </button>
                  {selected.title || selected.body ? (
                    <button onClick={() => setTexts(old => old.filter(text => text.language !== language))} type="button">
                      번역 지우기
                    </button>
                  ) : null}
                </div>
              </fieldset>
            </Panel>
          </div>

          <div className="notice-actions v2-actions">
            <button className="primary" disabled={busy} type="submit">
              {busy ? '저장 중…' : '저장'}
            </button>
            {id && original?.status === 'Published' ? (
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm('이 공지의 게시를 중단할까요?')) void save('Draft');
                }}
                type="button"
              >
                게시 중단
              </button>
            ) : null}
            {id ? (
              <button className="danger" disabled={busy} onClick={() => void remove()} type="button">
                삭제
              </button>
            ) : null}
          </div>
          <div ref={feedback} tabIndex={-1}>
            {error ? <p className="state error" role="alert">{error}</p> : null}
            {notice ? <p className="v2-footnote" role="status">{notice}</p> : null}
            {saved ? <p role="status">공지를 저장했습니다. 목록을 갱신하고 있습니다.</p> : null}
            {!busy && status === 'Draft' ? <p className="v2-footnote">초안은 저장해도 사용자에게 표시되지 않습니다. 공개하려면 게시 상태를 선택해 주세요.</p> : null}
          </div>
        </form>
      ) : null}
    </>
  );
}
