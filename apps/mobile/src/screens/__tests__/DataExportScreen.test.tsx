import ReactTestRenderer, { act } from 'react-test-renderer';
import { ApiError } from '../../api/ApiError';
import { useAuthenticatedApi } from '../../api/useAuthenticatedApi';
import { reauthenticateSameAccount } from '../../auth/reauthentication';
import { createDataExportLinks, getDataExportSummary } from '../../dataExport/dataExportApi';
import i18n from '../../i18n';
import { DataExportScreen } from '../DataExportScreen';

jest.mock('../../api/useAuthenticatedApi', () => ({ useAuthenticatedApi: jest.fn() }));
jest.mock('../../auth/reauthentication', () => ({ reauthenticateSameAccount: jest.fn() }));
jest.mock('../../dataExport/dataExportApi', () => ({
  ...jest.requireActual('../../dataExport/dataExportApi'),
  createDataExportLinks: jest.fn(),
  getDataExportSummary: jest.fn(),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

const request = jest.fn();
const issued = (token: string) => ({
  expiresAtUtc: '2026-10-20T09:45:00Z',
  files: [{ kind: 'data' as const, number: null, fileName: 'data.zip', downloadPath: `/api/v1/data-export/downloads#${token.repeat(43)}`, photos: null, bytes: null }],
});
const buttons = (renderer: ReactTestRenderer.ReactTestRenderer, id: string) =>
  renderer.root.findAll(node => node.props.testID === id && typeof node.props.onPress === 'function');
const press = async (renderer: ReactTestRenderer.ReactTestRenderer, id: string) => {
  await act(async () => { buttons(renderer, id)[0].props.onPress(); });
};
const render = async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => { renderer = ReactTestRenderer.create(<DataExportScreen />); });
  return renderer;
};

beforeAll(async () => { await i18n.changeLanguage('en'); });
beforeEach(() => {
  jest.mocked(useAuthenticatedApi).mockReturnValue(request);
  jest.mocked(getDataExportSummary).mockResolvedValue({ links: 1, linksInTrash: 0, ownedCollections: 0, sharedCollectionsJoined: 0, comments: 0, purchases: 0, repeatPurchases: 0, photos: 0, photoBytes: 0, photoFiles: [] });
  jest.mocked(createDataExportLinks).mockResolvedValue(issued('A'));
  jest.mocked(reauthenticateSameAccount).mockResolvedValue('reauthenticated');
});
afterEach(() => { jest.clearAllMocks(); });

it('can replace consumed or interrupted download links without leaving the screen', async () => {
  const renderer = await render();
  await press(renderer, 'data-export-create');
  expect(buttons(renderer, 'data-export-download-data-0')).toHaveLength(1);
  expect(buttons(renderer, 'data-export-create')).toHaveLength(1);

  jest.mocked(createDataExportLinks).mockResolvedValue(issued('B'));
  await press(renderer, 'data-export-create');
  expect(createDataExportLinks).toHaveBeenCalledTimes(2);
  expect(buttons(renderer, 'data-export-download-data-0')).toHaveLength(1);
});

it('asks for reauthentication when replacement needs it, then obtains new links', async () => {
  const renderer = await render();
  await press(renderer, 'data-export-create');
  jest.mocked(createDataExportLinks).mockRejectedValueOnce(new ApiError('forbidden', 403, 'recentAuthenticationRequired'));
  await press(renderer, 'data-export-create');
  expect(buttons(renderer, 'data-export-download-data-0')).toHaveLength(0);
  expect(buttons(renderer, 'data-export-reauth-action')).toHaveLength(1);
  await press(renderer, 'data-export-reauth-action');
  expect(reauthenticateSameAccount).toHaveBeenCalledTimes(1);
  expect(buttons(renderer, 'data-export-download-data-0')).toHaveLength(1);
});
