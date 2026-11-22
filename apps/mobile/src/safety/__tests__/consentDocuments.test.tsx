import ReactTestRenderer, { act } from 'react-test-renderer';
import { SubscriptionRights } from '../SubscriptionRights';
import { parsePublishedTerms } from '../termsDocument';
import i18n from '../../i18n';
import historical from '../../../../../backend/src/Juple.Application/Safety/LegacyPublishedTerms.json';
import { parseTermsStatus } from '../safetyApi';

const mockRequest = jest.fn();
jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: () => mockRequest }));

beforeAll(async () => { await i18n.changeLanguage('ko'); });
beforeEach(() => { mockRequest.mockReset(); });

async function mount() {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<SubscriptionRights />); });
  return renderer;
}
const button = (r: ReactTestRenderer.ReactTestRenderer, id: string) => r.root.find(node => node.props.testID === id && typeof node.props.onPress === 'function');

it('does not query, restore, create purchases or accept terms merely by rendering the pre-consent rights panel', async () => {
  const r = await mount();
  expect(mockRequest).not.toHaveBeenCalled();
  await act(async () => r.unmount());
});

it('preserves the real acceptance fact when an old client ignores additive enforcement metadata', () => {
  const status = parseTermsStatus({ currentVersion: '2026-10-14', acceptedVersion: null, isAccepted: false, enforceAcceptance: false });
  expect(status).toEqual({ currentVersion: '2026-10-14', acceptedVersion: null, isAccepted: false });
});

it.each(['google', 'apple'])('restores only server-known %s purchases without forwarding tokens or accepting terms', async platform => {
  mockRequest.mockResolvedValueOnce({ body: { outcome: 'Restored' } }).mockResolvedValueOnce({ body: { state: 'Canceled', currentPeriodEndsAtUtc: null } });
  const r = await mount();
  await act(async () => { await button(r, `terms-restore-${platform}`).props.onPress(); });
  expect(mockRequest.mock.calls.map(call => call[0])).toEqual([
    { method: 'POST', path: `/api/v1/billing/subscription-management/restore/${platform}` },
    { method: 'GET', path: '/api/v1/billing/subscription-management' },
  ]);
  await act(async () => r.unmount());
});

it('deduplicates restores, reports store failure and never routes to the service shell', async () => {
  let finish!: (value: unknown) => void;
  mockRequest.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const r = await mount();
  await act(async () => { button(r, 'terms-restore-google').props.onPress(); button(r, 'terms-restore-google').props.onPress(); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ body: { outcome: 'TemporaryFailure' } }); });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(button(r, 'terms-restore-google').props.disabled).toBe(false);
  await act(async () => r.unmount());
});

it('refuses malformed or stale canonical documents instead of using bundled agreement translations', () => {
  expect(parsePublishedTerms(null, 'new')).toBeNull();
  expect(parsePublishedTerms({ version: 'old' }, 'new')).toBeNull();
});

it('reads the actual historical version from the server without promoting it to the newer public version', () => {
  const payload = { ...historical, requestedLanguage: 'ko', canAccept: true };
  expect(parsePublishedTerms(payload, '2026-10-14')?.document.updated).toBe('2026-10-14');
  expect(parsePublishedTerms(payload, '2026-10-25')).toBeNull();
  const untranslated = parsePublishedTerms({ ...payload, requestedLanguage: 'en', canAccept: false }, '2026-10-14');
  expect(untranslated?.canAccept).toBe(false);
  expect(untranslated?.language).toBe('ko');
  expect(untranslated?.requestedLanguage).toBe('en');
});
