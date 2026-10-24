import { describeTrialNotice, dismissTrialNotice, isTrialNoticeDismissed, TRIAL_ENDING_REMINDER_MS } from '../trialNoticeModel';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
}));

const NOW = Date.parse('2026-11-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const trial = (endsInDays: number | null, overrides: Record<string, unknown> = {}) => ({
  programEnabled: true,
  status: 'trial' as const,
  trialEndsAtUtc: endsInDays === null ? null : new Date(NOW + endsInDays * DAY).toISOString(),
  ...overrides,
});

describe('describeTrialNotice', () => {
  it('says nothing while the program is off, for a subscriber, an expired account, a missing date or an unknown state', () => {
    expect(describeTrialNotice(null, NOW)).toBeNull();
    expect(describeTrialNotice(trial(20, { programEnabled: false }), NOW)).toBeNull();
    expect(describeTrialNotice(trial(20, { status: 'active' }), NOW)).toBeNull();
    expect(describeTrialNotice(trial(20, { status: 'expired' }), NOW)).toBeNull();
    expect(describeTrialNotice(trial(20, { status: null }), NOW)).toBeNull();
    expect(describeTrialNotice(trial(null), NOW)).toBeNull();
    expect(describeTrialNotice(trial(20, { trialEndsAtUtc: 'not a date' }), NOW)).toBeNull();
    expect(describeTrialNotice(trial(-1), NOW)).toBeNull();
  });

  it('welcomes a trial that has more than 7 days left and reminds in the last 7 (the end date is the server\'s)', () => {
    expect(describeTrialNotice(trial(29), NOW)?.kind).toBe('welcome');
    expect(describeTrialNotice(trial(7.5), NOW)?.kind).toBe('welcome');
    expect(describeTrialNotice(trial(7), NOW)?.kind).toBe('endingSoon');
    expect(describeTrialNotice(trial(1), NOW)?.kind).toBe('endingSoon');
    expect(describeTrialNotice(trial(29), NOW)?.endsAtUtc).toBe(new Date(NOW + 29 * DAY).toISOString());
  });
});

describe('closing the notice', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('the welcome stays closed for good; the reminder returns after a day', async () => {
    const welcome = describeTrialNotice(trial(29), NOW)!;
    const ending = describeTrialNotice(trial(3), NOW)!;
    expect(await isTrialNoticeDismissed(welcome, NOW)).toBe(false);
    expect(await isTrialNoticeDismissed(ending, NOW)).toBe(false);

    await dismissTrialNotice(welcome, NOW);
    await dismissTrialNotice(ending, NOW);

    expect(await isTrialNoticeDismissed(welcome, NOW + 20 * DAY)).toBe(true);
    expect(await isTrialNoticeDismissed(ending, NOW + TRIAL_ENDING_REMINDER_MS - 1)).toBe(true);
    expect(await isTrialNoticeDismissed(ending, NOW + TRIAL_ENDING_REMINDER_MS + 1)).toBe(false);
  });

  it('a different trial (another account) is not affected by this one being closed', async () => {
    const mine = describeTrialNotice(trial(29), NOW)!;
    const other = describeTrialNotice(trial(12), NOW)!;
    await dismissTrialNotice(mine, NOW);
    expect(await isTrialNoticeDismissed(other, NOW)).toBe(false);
  });
});
