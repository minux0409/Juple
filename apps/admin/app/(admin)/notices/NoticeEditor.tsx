'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAdmin, PageState } from '../AdminRoot';
import { failureMessage } from '../../../lib/adminModel';
import { ApiHttpError } from '../../../lib/adminApi';
import {
  NOTICE_LANGUAGES,
  localDateTime,
  type AdminNotice,
  type NoticeText,
} from '../../../lib/notices';

export function NoticeEditor({ id }: { readonly id?: number }) {
  const { api, reportFailure } = useAdmin();
  const router = useRouter();
  const [original, setOriginal] = useState<AdminNotice | null>(null);
  const [language, setLanguage] = useState('ko');
  const [texts, setTexts] = useState<NoticeText[]>([
    { language: 'ko', title: '', body: '' },
  ]);
  const [status, setStatus] = useState('Draft');
  const [important, setImportant] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [platforms, setPlatforms] = useState(7);
  const [start, setStart] = useState(() =>
    localDateTime(new Date().toISOString()),
  );
  const [end, setEnd] = useState('');
  const [url, setUrl] = useState('');
  const [reset, setReset] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (error && feedback.current) {
      feedback.current.focus({ preventScroll: true });
      feedback.current.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);
  useEffect(() => {
    if (!id) return;
    let active = true;
    api<AdminNotice>({ path: `/api/v1/admin/notices/${id}` }).then(
      (n) => {
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
      (e) => {
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
  const selected = texts.find((t) => t.language === language) ?? {
    language,
    title: '',
    body: '',
  };
  const updateText = (key: 'title' | 'body', value: string) =>
    setTexts((old) =>
      old.some((t) => t.language === language)
        ? old.map((t) => (t.language === language ? { ...t, [key]: value } : t))
        : [...old, { language, title: '', body: '', [key]: value }],
    );
  const save = async (nextStatus = status) => {
    if (pending.current) return;
    setSaved(false);
    const translations = texts.filter(
      (t) => t.language === 'ko' || t.title || t.body,
    );
    const ko = translations.find((t) => t.language === 'ko');
    if (
      !ko?.title.trim() ||
      !ko.body.trim() ||
      translations.some((t) => !t.title.trim() || !t.body.trim())
    ) {
      setError(
        '한국어 제목·본문은 필수이며, 추가 언어도 제목·본문을 함께 입력해 주세요.',
      );
      return;
    }
    const startsAt = new Date(start);
    const endsAt = end ? new Date(end) : null;
    if (
      !platforms ||
      !Number.isFinite(startsAt.getTime()) ||
      (endsAt && (!Number.isFinite(endsAt.getTime()) || endsAt <= startsAt))
    ) {
      setError('노출 플랫폼과 게시 기간을 확인해 주세요.');
      return;
    }
    let officialUrl: string | null = null;
    if (url.trim()) {
      try {
        const parsed = new URL(url.trim());
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
          throw new Error();
        officialUrl = url.trim();
      } catch {
        setError(
          '공식 안내 링크는 로그인 정보가 없는 HTTPS 주소로 입력해 주세요.',
        );
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await api<AdminNotice>({
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
          translations,
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
      setError(
        `저장하지 못했습니다.${
          e instanceof ApiHttpError ? ` (HTTP ${e.status})` : ''
        } ${failureMessage(e)}`,
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      pending.current ||
      !original ||
      !window.confirm(
        '이 공지를 삭제할까요? 운영 이력은 보존되며 사용자에게 더 이상 표시되지 않습니다.',
      )
    )
      return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await api<void>({
        method: 'DELETE',
        path: `/api/v1/admin/notices/${
          original.id
        }?version=${encodeURIComponent(original.version)}`,
      });
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
      <header className="page-header">
        <h1>{id ? '공지 수정' : '공지 작성'}</h1>
        <Link href="/notices">목록</Link>
      </header>
      <PageState
        loading={loading}
        error={original || !id ? null : error}
        onRetry={() => {
          if (id) {
            setLoading(true);
            setAttempt((a) => a + 1);
          } else setError(null);
        }}
      />
      {!loading && (!id || original) ? (
        <form
          noValidate
          aria-busy={busy}
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="notice-editor"
        >
          <fieldset disabled={busy} className="expense-form">
            <legend>게시 설정</legend>
            <label>
              게시 상태
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="Draft">초안 / 중단</option>
                <option value="Published">게시 (시작일 이후 노출)</option>
              </select>
            </label>
            <label>
              게시 시작일 (현지 시간)
              <input
                type="datetime-local"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label>
              게시 종료일 (선택, 현지 시간)
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={important}
                onChange={(e) => setImportant(e.target.checked)}
              />
              중요 공지
            </label>
            <label>
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              상단 고정 (중요 표시와 별도)
            </label>
          </fieldset>
          <fieldset disabled={busy} className="expense-form">
            <legend>노출 플랫폼</legend>
            <label>
              <input
                type="checkbox"
                checked={platforms === 7}
                onChange={(e) => setPlatforms(e.target.checked ? 7 : 0)}
              />
              전체
            </label>
            {[
              ['Web', 1],
              ['Android', 2],
              ['iOS', 4],
            ].map(([label, bit]) => (
              <label key={label}>
                <input
                  type="checkbox"
                  checked={(platforms & Number(bit)) !== 0}
                  onChange={(e) =>
                    setPlatforms((old) =>
                      e.target.checked ? old | Number(bit) : old & ~Number(bit),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>언어별 내용</legend>
            <label>
              편집 언어
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {NOTICE_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                    {lang === 'ko' ? ' (필수 / 기본)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              제목
              <input
                maxLength={200}
                value={selected.title}
                onChange={(e) => updateText('title', e.target.value)}
              />
            </label>
            <label>
              본문
              <textarea
                rows={14}
                maxLength={20000}
                value={selected.body}
                onChange={(e) => updateText('body', e.target.value)}
              />
            </label>
            <p>
              문단·줄바꿈, - 목록, 1. 목록, [링크 이름](https://...)을
              지원합니다. HTML은 실행하지 않습니다. 번역이 없는 언어는 한국어로
              표시됩니다.
            </p>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>추가 설정</legend>
            <label>
              공식 안내 링크 (선택, HTTPS)
              <input
                type="url"
                maxLength={2048}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            {id ? (
              <label>
                <input
                  type="checkbox"
                  checked={reset}
                  onChange={(e) => setReset(e.target.checked)}
                />
                기존 읽음 상태 초기화 (기본: 읽음 유지)
              </label>
            ) : null}
          </fieldset>
          <div className="notice-actions">
            <button disabled={busy} className="primary" type="submit">
              {busy ? '저장 중…' : '저장'}
            </button>
            {id && original?.status === 'Published' ? (
              <button
                disabled={busy}
                type="button"
                onClick={() => {
                  if (window.confirm('이 공지의 게시를 중단할까요?'))
                    void save('Draft');
                }}
              >
                게시 중단
              </button>
            ) : null}
            {id ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void remove();
                }}
              >
                삭제
              </button>
            ) : null}
          </div>
          <div ref={feedback} tabIndex={-1}>
            {error ? (
              <p className="state error" role="alert">
                {error}
              </p>
            ) : null}
            {saved ? (
              <p role="status">
                공지를 저장했습니다. 목록을 갱신하고 있습니다.
              </p>
            ) : null}
            {!busy && status === 'Draft' ? (
              <p>
                초안은 저장해도 사용자에게 표시되지 않습니다. 공개하려면 게시
                상태를 선택해 주세요.
              </p>
            ) : null}
          </div>
        </form>
      ) : null}
    </>
  );
}
