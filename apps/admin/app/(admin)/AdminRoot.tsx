'use client';

import type { PublicClientApplication } from '@azure/msal-browser';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createAdminApi, type AdminApi } from '../../lib/adminApi';
import type { AdminConfig } from '../../lib/adminConfig';
import { adminPaths, failureMessage, type AdminMe } from '../../lib/adminModel';
import { statusAfterAccessCheck, statusAfterInitialize, statusAfterPageFailure, type AdminSessionStatus } from '../../lib/adminSession';
import { acquireApiToken, getMsal, resolveSignedInAccount, signIn, signOut } from '../../lib/msalClient';
import { activeHref, FOOTER_NAVIGATION, NAVIGATION, type NavEntry, type NavIcon } from '../../lib/navigation';
import { strings } from '../../lib/strings';
import { DashboardIcon, InboxIcon, LogoutIcon, MegaphoneIcon, MenuIcon, PhoneIcon, PulseIcon, ShieldIcon, UsersIcon, WalletIcon } from './v2/Icons';
import { WorkspaceDates } from './workspace/WorkspaceDates';

export interface AdminContextValue {
  readonly api: AdminApi;
  readonly me: AdminMe;
  readonly config: AdminConfig;
  /** A page call failed: a lost session or a revoked grant leaves the admin shell at once (adminSession.statusAfterPageFailure). */
  readonly reportFailure: (error: unknown) => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) {
    throw new Error('useAdmin is only available inside a confirmed admin session.');
  }
  return value;
}

export function AdminRoot({ config, children }: { config: AdminConfig | null; children: React.ReactNode }) {
  const [status, setStatus] = useState<AdminSessionStatus>(config ? 'initializing' : 'configMissing');
  const [me, setMe] = useState<AdminMe | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [msal, setMsal] = useState<PublicClientApplication | null>(null);
  // Bumped by 다시 시도 on the "failed" screen: the access check runs again.
  const [checkAttempt, setCheckAttempt] = useState(0);

  // Built only once MSAL is ready, so no token is ever asked for before it.
  const api = useMemo(
    () =>
      config && msal
        ? createAdminApi({
            apiBaseUrl: config.apiBaseUrl,
            getAccessToken: ({ forceRefresh }) => acquireApiToken(msal, config, forceRefresh),
          })
        : null,
    [config, msal],
  );

  useEffect(() => {
    if (!config) {
      return;
    }
    let cancelled = false;
    getMsal(config)
      .then(async instance => {
        const account = await resolveSignedInAccount(instance);
        if (!cancelled) {
          setMsal(instance);
          setStatus(statusAfterInitialize(account !== null));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailure(strings.unknownError);
          setStatus('signedOut');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // Signed in: ask the API - never anything local - whether this person is an active admin. State changes only in the callbacks.
  useEffect(() => {
    if (status !== 'checking' || !api) {
      return;
    }
    let cancelled = false;
    api<AdminMe>({ path: adminPaths.me })
      .then(result => {
        if (!cancelled) {
          const next = statusAfterAccessCheck({ me: result });
          setMe(next === 'ready' ? result : null);
          setFailure(null);
          setStatus(next);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMe(null);
          setFailure(failureMessage(error));
          setStatus(statusAfterAccessCheck({ error }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status, api, checkAttempt]);

  const retryAccessCheck = useCallback(() => {
    setFailure(null);
    setStatus('checking');
    setCheckAttempt(value => value + 1);
  }, []);

  const startSignIn = useCallback(() => {
    if (msal && config) {
      setStatus('redirecting');
      signIn(msal, config).catch(() => {
        setFailure(strings.unknownError);
        setStatus('signedOut');
      });
    }
  }, [msal, config]);

  const startSignOut = useCallback(() => {
    setMe(null);
    if (msal) {
      setStatus('redirecting');
      signOut(msal).catch(() => setStatus('signedOut'));
    }
  }, [msal]);

  const reportFailure = useCallback((error: unknown) => {
    const next = statusAfterPageFailure(error);
    if (next) {
      setMe(null);
      setFailure(next === 'signedOut' ? strings.sessionExpired : null);
      setStatus(next);
    }
  }, []);

  const contextValue = useMemo(
    () => (api && me && config ? { api, me, config, reportFailure } : null),
    [api, me, config, reportFailure],
  );

  switch (status) {
    case 'configMissing':
      return <Notice message={strings.configMissing} />;
    case 'initializing':
    case 'redirecting':
      return <Notice message={strings.loading} />;
    case 'checking':
      return <Notice message={strings.checkingAccess} />;
    case 'signedOut':
      return (
        <Notice message={failure ?? strings.signInPrompt}>
          <button className="primary" onClick={startSignIn} type="button">
            {strings.signIn}
          </button>
        </Notice>
      );
    case 'forbidden':
      // Nothing else: no navigation, no admin content - only the refusal and a way out.
      return (
        <Notice message={strings.forbidden}>
          <button onClick={startSignOut} type="button">
            {strings.signOut}
          </button>
        </Notice>
      );
    case 'failed':
      return (
        <Notice message={failure ?? strings.unknownError}>
          <button className="primary" onClick={retryAccessCheck} type="button">
            {strings.retry}
          </button>
          <button onClick={startSignOut} type="button">
            {strings.signOut}
          </button>
        </Notice>
      );
    case 'ready':
      return contextValue ? (
        <AdminContext.Provider value={contextValue}>
          <WorkspaceDates><AdminShell me={contextValue.me} onSignOut={startSignOut}>
            {children}
          </AdminShell></WorkspaceDates>
        </AdminContext.Provider>
      ) : (
        <Notice message={strings.loading} />
      );
  }
}

function Notice({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <main className="centered">
      <h1 className="brand">{strings.appName}</h1>
      <p role="status">{message}</p>
      {children ? <div className="actions">{children}</div> : null}
    </main>
  );
}

/**
 * The confirmed-session context for a component tree. AdminRoot is its only production user (after GET /admin/me succeeded);
 * the browser rendering test mounts pages with a fixture API through it. It grants nothing: every API call is still
 * authorized by the API itself.
 */
export function AdminContextProvider({ value, children }: { readonly value: AdminContextValue; readonly children: React.ReactNode }) {
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

const NAV_ICONS: Readonly<Record<NavIcon, (props: { size?: number }) => React.ReactNode>> = {
  dashboard: DashboardIcon,
  users: UsersIcon,
  notices: MegaphoneIcon,
  inquiries: InboxIcon,
  costs: WalletIcon,
  appVersion: PhoneIcon,
  account: ShieldIcon,
  system: PulseIcon,
};

/** The V2 frame: a sidebar (an icon rail on tablets, a drawer on phones) and the page. */
export function AdminShell({ me, onSignOut, children }: { me: AdminMe; onSignOut: () => void; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = activeHref(pathname);
  return (
    <div className="v2-shell">
      <header className="v2-topbar">
        <button aria-controls="v2-sidebar" aria-expanded={open} aria-label="메뉴" className="v2-icon-button" onClick={() => setOpen(value => !value)} type="button">
          <MenuIcon />
        </button>
        <span className="v2-brand-text">{strings.appName}</span>
      </header>
      <aside className={open ? 'v2-sidebar open' : 'v2-sidebar'} id="v2-sidebar">
        <div className="v2-brand">
          <span aria-hidden="true" className="v2-brand-mark">J</span>
          <span className="v2-brand-text">{strings.appName}</span>
        </div>
        <nav aria-label="관리자 메뉴" className="v2-nav">
          <ul>
            {NAVIGATION.map(entry => (
              <NavItem current={current} entry={entry} key={entry.href} onNavigate={() => setOpen(false)} />
            ))}
          </ul>
        </nav>
        <div className="v2-sidebar-footer">
          <ul>
            {FOOTER_NAVIGATION.map(entry => (
              <NavItem current={current} entry={entry} key={entry.href} onNavigate={() => setOpen(false)} />
            ))}
          </ul>
          <div className="v2-account">
            <span className="v2-role" title={me.role === 'Owner' ? strings.roleOwner : strings.roleAdmin}>
              {me.role === 'Owner' ? strings.roleOwner : strings.roleAdmin}
            </span>
            <button aria-label={strings.signOut} className="v2-nav-link v2-signout" onClick={onSignOut} title={strings.signOut} type="button">
              <LogoutIcon />
              <span className="v2-nav-label">{strings.signOut}</span>
            </button>
          </div>
        </div>
      </aside>
      {open ? <button aria-label="메뉴 닫기" className="v2-scrim" onClick={() => setOpen(false)} type="button" /> : null}
      <main className="v2-content">{children}</main>
    </div>
  );
}

function NavItem({ entry, current, onNavigate }: { entry: NavEntry; current: string | null; onNavigate: () => void }) {
  const Icon = NAV_ICONS[entry.icon];
  return (
    <li>
      <Link aria-current={current === entry.href ? 'page' : undefined} className="v2-nav-link" href={entry.href} onClick={onNavigate} title={entry.label}>
        <Icon size={20} />
        <span className="v2-nav-label">{entry.label}</span>
      </Link>
    </li>
  );
}

/**
 * One API read for a page: loading / error / data, with reload. A failure that ends the admin session is passed to AdminRoot;
 * any other one stays on the page (message + retry). No value is kept beyond the page.
 */
export function useAdminQuery<T>(path: string | null): {
  readonly data: T | null;
  readonly error: string | null;
  readonly loading: boolean;
  readonly reload: () => void;
} {
  const { api, reportFailure } = useAdmin();
  const [attempt, setAttempt] = useState(0);
  const requestId = `${path}#${attempt}`;
  // The answer of the LAST finished request. Data is shown only for the same path (a reload keeps it visible while it runs).
  const [state, setState] = useState<{ requestId: string; path: string | null; data: T | null; error: string | null }>({
    requestId: '',
    path: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!path) {
      return;
    }
    let cancelled = false;
    api<T>({ path })
      .then(data => {
        if (!cancelled) {
          setState({ requestId, path, data, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          reportFailure(error);
          setState({ requestId, path, data: null, error: failureMessage(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, reportFailure, path, requestId]);

  const reload = useCallback(() => setAttempt(value => value + 1), []);
  const finished = state.requestId === requestId;
  return {
    data: state.path === path ? state.data : null,
    error: finished ? state.error : null,
    loading: Boolean(path) && !finished,
    reload,
  };
}

export function PageState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <div className="state error" role="alert">
        <p>{error}</p>
        <button onClick={onRetry} type="button">
          {strings.retry}
        </button>
      </div>
    );
  }
  return loading ? <p className="state">{strings.loading}</p> : null;
}
