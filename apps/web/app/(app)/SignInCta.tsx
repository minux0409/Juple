'use client';

import { createContext, useContext } from 'react';
import landing from '../_components/landing.module.css';
import styles from './app.module.css';

/** What the signed-out landing's main action needs from AppRoot: the existing Entra sign-in (loginRedirect) and its last failure. */
export interface SignInAction {
  readonly signIn: () => void;
  readonly notice: string | null;
}

export const SignInActionContext = createContext<SignInAction | null>(null);

/**
 * The landing's 웹에서 시작하기: starts the same Entra External ID sign-up / sign-in as before (AppRoot's signIn). A signed-in visitor
 * never sees it - "/" is then the app itself.
 */
export function SignInCta({ label }: { readonly label: string }) {
  const action = useContext(SignInActionContext);
  if (!action) {
    return null;
  }
  return (
    <div className={landing.cta}>
      {action.notice ? (
        <p className={styles.notice} role="alert">
          {action.notice}
        </p>
      ) : null}
      <button className={styles.primaryButton} onClick={action.signIn} type="button">
        {label}
      </button>
    </div>
  );
}
