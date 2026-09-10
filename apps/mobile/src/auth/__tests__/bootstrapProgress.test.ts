import {
  bootstrapStepFraction,
  resolveBootstrapError,
  resolveBootstrapStep,
  STEP_MESSAGE_KEYS,
  type BootstrapProgressState,
} from '../bootstrapProgress';

function state(overrides: Partial<BootstrapProgressState>): BootstrapProgressState {
  return {
    sessionRestoreStep: 'sessionRestore',
    backendAuthStatus: 'notChecked',
    userBootstrapStatus: 'notStarted',
    ...overrides,
  };
}

describe('resolveBootstrapStep', () => {
  it('reports sessionRestore before anything else has started', () => {
    expect(resolveBootstrapStep(state({ sessionRestoreStep: 'sessionRestore' }))).toBe(
      'sessionRestore',
    );
  });

  it('reports entraRefresh once the session manager reaches that sub-phase', () => {
    expect(resolveBootstrapStep(state({ sessionRestoreStep: 'entraRefresh' }))).toBe(
      'entraRefresh',
    );
  });

  it('reports backendValidation once the backend check starts, regardless of the stale session restore step', () => {
    expect(
      resolveBootstrapStep(
        state({ sessionRestoreStep: 'entraRefresh', backendAuthStatus: 'checking' }),
      ),
    ).toBe('backendValidation');
    expect(
      resolveBootstrapStep(state({ backendAuthStatus: 'valid', userBootstrapStatus: 'notStarted' })),
    ).toBe('backendValidation');
  });

  it('reports userBootstrap while the user bootstrap call is in flight', () => {
    expect(
      resolveBootstrapStep(
        state({ backendAuthStatus: 'valid', userBootstrapStatus: 'checking' }),
      ),
    ).toBe('userBootstrap');
  });

  it('reports ready once user bootstrap has actually completed', () => {
    expect(
      resolveBootstrapStep(state({ backendAuthStatus: 'valid', userBootstrapStatus: 'ready' })),
    ).toBe('ready');
  });

  it('advances the progress fraction monotonically across every real step, ending at 1', () => {
    const steps = [
      state({ sessionRestoreStep: 'sessionRestore' }),
      state({ sessionRestoreStep: 'entraRefresh' }),
      state({ backendAuthStatus: 'checking' }),
      state({ backendAuthStatus: 'valid', userBootstrapStatus: 'checking' }),
      state({ backendAuthStatus: 'valid', userBootstrapStatus: 'ready' }),
    ].map(resolveBootstrapStep);

    const fractions = steps.map(bootstrapStepFraction);
    for (let i = 1; i < fractions.length; i += 1) {
      expect(fractions[i]).toBeGreaterThan(fractions[i - 1]);
    }
    expect(fractions[fractions.length - 1]).toBe(1);

    // Every step must resolve to an actual message key - the UI never has a step with nothing to say.
    for (const step of steps) {
      expect(STEP_MESSAGE_KEYS[step]).toBeTruthy();
    }
  });
});

describe('resolveBootstrapError', () => {
  it('is null while bootstrap is still progressing normally', () => {
    expect(resolveBootstrapError(state({ backendAuthStatus: 'checking' }))).toBeNull();
    expect(
      resolveBootstrapError(state({ backendAuthStatus: 'valid', userBootstrapStatus: 'checking' })),
    ).toBeNull();
  });

  it('is retryable only for a transient backend-unavailable failure', () => {
    expect(resolveBootstrapError(state({ backendAuthStatus: 'unavailable' }))).toEqual({
      messageKey: 'auth.backendUnavailable',
      canRetry: true,
    });
  });

  it('is not retryable for a genuine unauthorized/forbidden rejection or a bad device setting', () => {
    expect(resolveBootstrapError(state({ backendAuthStatus: 'unauthorized' }))?.canRetry).toBe(
      false,
    );
    expect(resolveBootstrapError(state({ backendAuthStatus: 'forbidden' }))?.canRetry).toBe(false);
    expect(
      resolveBootstrapError(
        state({ backendAuthStatus: 'valid', userBootstrapStatus: 'invalidDeviceSettings' }),
      )?.canRetry,
    ).toBe(false);
    expect(
      resolveBootstrapError(state({ backendAuthStatus: 'valid', userBootstrapStatus: 'unavailable' }))
        ?.canRetry,
    ).toBe(false);
  });
});
