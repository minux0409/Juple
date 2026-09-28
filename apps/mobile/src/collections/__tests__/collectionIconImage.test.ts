import i18n from '../../i18n';
import { ApiError } from '../../api/ApiError';
import { removeCollectionIconImage, setCollectionIconImage, type Collection } from '../api/collectionsApi';
import { applyCollectionIconImageChange, getIconImageSaveErrorMessage, KEEP_ICON_IMAGE } from '../collectionIconImage';

jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn() }));
jest.mock('../api/collectionsApi', () => ({
  setCollectionIconImage: jest.fn(),
  removeCollectionIconImage: jest.fn(),
}));

beforeAll(async () => {
  await i18n.changeLanguage('ko');
});

const request = jest.fn() as never;
const collection = (iconImageUrl: string | null): Collection => ({
  id: 4,
  name: 'Trip',
  isFavorite: false,
  itemCount: 0,
  createdAtUtc: '',
  updatedAtUtc: '',
  icon: 'Folder',
  color: null,
  iconImageUrl,
});

describe('applyCollectionIconImageChange', () => {
  afterEach(() => jest.clearAllMocks());

  it('keep: no request at all', async () => {
    const current = collection('https://blob.example.test/a.jpg');
    expect(await applyCollectionIconImageChange(request, current, KEEP_ICON_IMAGE)).toBe(current);
    expect(setCollectionIconImage).not.toHaveBeenCalled();
    expect(removeCollectionIconImage).not.toHaveBeenCalled();
  });

  it('set: uploads the picked photo and returns the updated Collection', async () => {
    const updated = collection('https://blob.example.test/new.jpg');
    jest.mocked(setCollectionIconImage).mockResolvedValue(updated);
    const asset = { uri: 'file:///p.jpg', type: 'image/jpeg', fileName: 'p.jpg' };

    expect(await applyCollectionIconImageChange(request, collection(null), { kind: 'set', asset })).toBe(updated);
    expect(setCollectionIconImage).toHaveBeenCalledWith(request, 4, asset);
  });

  it('remove: only asks the server when there is a photo to remove', async () => {
    jest.mocked(removeCollectionIconImage).mockResolvedValue(collection(null));
    await applyCollectionIconImageChange(request, collection('https://blob.example.test/a.jpg'), { kind: 'remove' });
    expect(removeCollectionIconImage).toHaveBeenCalledWith(request, 4);

    jest.clearAllMocks();
    await applyCollectionIconImageChange(request, collection(null), { kind: 'remove' });
    expect(removeCollectionIconImage).not.toHaveBeenCalled();
  });

  it('says a rejected file is the wrong kind, and anything else is a generic retry', () => {
    const t = i18n.getFixedT('ko');
    expect(getIconImageSaveErrorMessage(new ApiError('badRequest', 400), t)).toBe(t('collections.iconPhotoInvalid'));
    expect(getIconImageSaveErrorMessage(new Error('network'), t)).toBe(t('collections.iconPhotoSaveFallback'));
  });
});
