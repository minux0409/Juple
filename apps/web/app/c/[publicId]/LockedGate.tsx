'use client';

import { useActionState } from 'react';
import { unlockSharedCollection, type UnlockFormState } from './actions';

interface LockedGateProps {
  readonly publicId: string;
  readonly labels: {
    readonly title: string;
    readonly message: string;
    readonly password: string;
    readonly submit: string;
    readonly submitting: string;
    readonly wrongPassword: string;
    readonly tooManyAttempts: string;
    readonly failed: string;
  };
}

const initialState: UnlockFormState = { error: null };

/**
 * Shown for a locked share before its password is proven - the server has sent no name, no links,
 * no count. Submitting posts to a Server Action (a plain form POST, so it also works before
 * hydration); the password never reaches browser storage or the page HTML.
 */
export function LockedGate({ publicId, labels }: LockedGateProps) {
  const [state, formAction, pending] = useActionState(unlockSharedCollection.bind(null, publicId), initialState);

  const errorMessage =
    state.error === 'invalidPassword'
      ? labels.wrongPassword
      : state.error === 'throttled'
        ? labels.tooManyAttempts
        : state.error === 'failed'
          ? labels.failed
          : null;

  return (
    <section className="lockedGate" aria-labelledby="locked-gate-title">
      <div className="lockedIcon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.75">
          <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
          <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" strokeLinecap="round" />
        </svg>
      </div>
      <h1 className="lockedTitle" id="locked-gate-title">{labels.title}</h1>
      <p className="lockedMessage">{labels.message}</p>
      <form action={formAction} className="lockedForm">
        <label className="visuallyHidden" htmlFor="collection-password">{labels.password}</label>
        <input
          autoComplete="current-password"
          className="lockedInput"
          id="collection-password"
          maxLength={64}
          name="password"
          placeholder={labels.password}
          required
          type="password"
        />
        {errorMessage ? <p className="lockedError" role="alert">{errorMessage}</p> : null}
        <button className="lockedButton" disabled={pending} type="submit">
          {pending ? labels.submitting : labels.submit}
        </button>
      </form>
    </section>
  );
}
