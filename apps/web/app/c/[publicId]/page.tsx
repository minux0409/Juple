import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDictionary, resolveLocale } from '../../../lib/i18n';
import { resolveClientPlatform } from '../../../lib/platform';
import { planSharePage } from '../../../lib/installCta';
import { androidOpenInAppUrl, canonicalShareUrl, normalizeHost, WEB_ONLY_PARAM } from '../../../lib/shareLinks';
import { buildShareMetadata, loadShareView } from '../../../lib/shareView';
import { storeConfig } from '../../../lib/storeConfig';
import { isValidPublicId, unlockCookieName } from '../../../lib/unlockCookie';
import { AutoOpenInApp } from './AutoOpenInApp';
import { InstallCta } from './InstallCta';
import { ItemList } from './ItemList';
import { LockedGate } from './LockedGate';

interface PageProps {
  readonly params: Promise<{ publicId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * A genuine runtime read, not NEXT_PUBLIC_* - this page is already dynamic (see headers() below),
 * so process.env is safely re-read on every request rather than frozen at `next build` time (see
 * lib/publicApi.ts's own remarks). No real production domain is hardcoded; the local default only
 * applies when the env var is unset (local dev).
 */
function resolveApiBaseUrl(): string {
  return process.env.JUPLE_API_BASE_URL || 'http://localhost:5092';
}

/** The locked share's grant, read server-side from its HttpOnly cookie - never sent to the client. */
async function readUnlockToken(publicId: string): Promise<string | undefined> {
  return (await cookies()).get(unlockCookieName(publicId))?.value;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { publicId } = await params;
  const requestHeaders = await headers();
  const dict = getDictionary(resolveLocale(requestHeaders.get('accept-language')));
  const host = normalizeHost(requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'));
  const view = isValidPublicId(publicId)
    ? await loadShareView(resolveApiBaseUrl(), publicId, await readUnlockToken(publicId))
    : ({ kind: 'notFound' } as const);

  return {
    // Only a readable share names itself; a locked, unknown, revoked or failing one is plain "Juple" and says nothing else
    // (no image, no memo, no item) - see buildShareMetadata.
    ...buildShareMetadata(view, host && isValidPublicId(publicId) ? canonicalShareUrl(host, publicId) : null, dict.metaDescription),
    // iOS Smart App Banner - only when a real App Store app-id is configured (see
    // lib/storeConfig.ts); no fabricated app-id, and the field is simply absent otherwise.
    ...(storeConfig.appStoreAppId
      ? { other: { 'apple-itunes-app': `app-id=${storeConfig.appStoreAppId}` } }
      : {}),
  };
}

export default async function PublicCollectionPage({ params, searchParams }: PageProps) {
  const { publicId } = await params;
  const webOnly = (await searchParams)[WEB_ONLY_PARAM] !== undefined;
  if (!isValidPublicId(publicId)) {
    notFound();
  }
  const apiBaseUrl = resolveApiBaseUrl();

  const requestHeaders = await headers();
  const locale = resolveLocale(requestHeaders.get('accept-language'));
  const dict = getDictionary(locale);
  const platform = resolveClientPlatform(requestHeaders.get('user-agent'));
  const host = normalizeHost(requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host'));
  const unlockToken = await readUnlockToken(publicId);

  const view = await loadShareView(apiBaseUrl, publicId, unlockToken);
  if (view.kind === 'notFound') {
    notFound();
  }

  const openInAppUrl = host ? androidOpenInAppUrl(host, publicId) : undefined;
  const installCta = (
    <InstallCta
      appStoreLabel={dict.appStore}
      comingSoonText={dict.installComingSoon}
      googlePlayLabel={dict.googlePlay}
      openInAppLabel={dict.openInApp}
      openInAppUrl={openInAppUrl}
      platform={platform}
      text={dict.installCtaText}
    />
  );

  // The backend could not answer: a calm, temporary state - nothing is claimed about the share, and no app handoff is tried.
  if (view.kind === 'unavailable') {
    return (
      <main>
        <p className="brand">Juple</p>
        <div className="notFound">
          <p className="notFoundTitle">{dict.unavailableTitle}</p>
          <p className="notFoundMessage">{dict.unavailableMessage}</p>
        </div>
      </main>
    );
  }

  // The install / open block sits right under the title (never only after the links), and on Android a resolved share tries the
  // installed app once (see AutoOpenInApp); a missing app or a blocked launch leaves the visitor right here.
  const plan = planSharePage(view.kind, platform, webOnly);
  const autoOpen = plan.autoHandoff && openInAppUrl ? <AutoOpenInApp guardKey={`juple-open-${publicId}`} intentUrl={openInAppUrl} /> : null;

  // Locked and not (or no longer - e.g. the password changed) unlocked: nothing about the share's content was fetched or is
  // rendered. The password is verified only through the existing server action (never in the URL, never in the intent).
  if (view.kind === 'locked') {
    return (
      <main>
        <p className="brand">Juple</p>
        {installCta}
        <LockedGate
          labels={{
            title: dict.lockedTitle,
            message: dict.lockedMessage,
            password: dict.passwordLabel,
            submit: dict.unlock,
            submitting: dict.unlocking,
            wrongPassword: dict.wrongPassword,
            tooManyAttempts: dict.tooManyAttempts,
            failed: dict.unlockFailed,
          }}
          publicId={publicId}
        />
        {autoOpen}
      </main>
    );
  }

  // A private link (공용 컬렉션 OFF): the name and the way into the app - no content was fetched, and the request itself is app-only.
  if (view.kind === 'private') {
    return (
      <main>
        <p className="brand">Juple</p>
        <h1 className="collectionName">{view.name}</h1>
        {installCta}
        <div className="notFound">
          <p className="notFoundTitle">{dict.privateTitle}</p>
          <p className="notFoundMessage">{dict.privateMessage}</p>
        </div>
        {autoOpen}
      </main>
    );
  }

  return (
    <main>
      <p className="brand">Juple</p>
      <h1 className="collectionName">{view.name}</h1>
      {installCta}
      <ItemList
        apiBaseUrl={apiBaseUrl}
        emptyLabel={dict.emptyState}
        initialItems={view.items}
        initialNextCursor={view.nextCursor}
        isLocked={view.isLocked}
        loadingLabel={dict.loading}
        loadMoreLabel={dict.loadMore}
        openLabel={dict.open}
        publicId={publicId}
      />
      <p className="footerNote">{dict.footerNote}</p>
      {autoOpen}
    </main>
  );
}
