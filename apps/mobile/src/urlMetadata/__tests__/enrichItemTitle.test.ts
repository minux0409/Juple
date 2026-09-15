import { enrichItemTitleFromUrlMetadata } from '../enrichItemTitle';
import { setItemPreviewImage, updateItemDetails } from '../../items/api/itemsApi';
import { resolveUrlMetadata } from '../api/urlMetadataApi';

jest.mock('../../items/api/itemsApi', () => ({
  updateItemDetails: jest.fn(),
  setItemPreviewImage: jest.fn(),
}));

jest.mock('../api/urlMetadataApi', () => ({
  resolveUrlMetadata: jest.fn(),
}));

const request = jest.fn();

describe('enrichItemTitleFromUrlMetadata', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('applies both title and preview image from the same resolved metadata', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'Resolved Title',
      source: 'openGraph',
      previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });

    await enrichItemTitleFromUrlMetadata(request, 42, 'https://example.com');

    expect(updateItemDetails).toHaveBeenCalledWith(request, 42, { title: 'Resolved Title', memo: '' });
    expect(setItemPreviewImage).toHaveBeenCalledWith(request, 42, 'https://cdn.example.com/preview.jpg');
  });

  it('applies only the preview image when no title was found', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: null,
      source: null,
      previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });

    await enrichItemTitleFromUrlMetadata(request, 42, 'https://example.com');

    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(setItemPreviewImage).toHaveBeenCalledWith(request, 42, 'https://cdn.example.com/preview.jpg');
  });

  it('applies only the title when no preview image was found', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'Resolved Title',
      source: 'openGraph',
      previewImageUrl: null,
    });

    await enrichItemTitleFromUrlMetadata(request, 42, 'https://example.com');

    expect(updateItemDetails).toHaveBeenCalledWith(request, 42, { title: 'Resolved Title', memo: '' });
    expect(setItemPreviewImage).not.toHaveBeenCalled();
  });

  it('never throws and calls neither apply when metadata resolution itself fails', async () => {
    jest.mocked(resolveUrlMetadata).mockRejectedValue(new Error('network down'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(enrichItemTitleFromUrlMetadata(request, 42, 'https://example.com')).resolves.toBeUndefined();

    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(setItemPreviewImage).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('a failed preview-image apply never affects an already-applied title (never throws)', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'Resolved Title',
      source: 'openGraph',
      previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });
    jest.mocked(updateItemDetails).mockResolvedValue(undefined);
    jest.mocked(setItemPreviewImage).mockRejectedValue(new Error('preview save failed'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(enrichItemTitleFromUrlMetadata(request, 42, 'https://example.com')).resolves.toBeUndefined();

    expect(updateItemDetails).toHaveBeenCalledWith(request, 42, { title: 'Resolved Title', memo: '' });
    warnSpy.mockRestore();
  });

  it('a failed title apply never blocks the independent preview-image apply', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({
      title: 'Resolved Title',
      source: 'openGraph',
      previewImageUrl: 'https://cdn.example.com/preview.jpg',
    });
    jest.mocked(updateItemDetails).mockRejectedValue(new Error('title save failed'));
    jest.mocked(setItemPreviewImage).mockResolvedValue(undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(enrichItemTitleFromUrlMetadata(request, 42, 'https://example.com')).resolves.toBeUndefined();

    expect(setItemPreviewImage).toHaveBeenCalledWith(request, 42, 'https://cdn.example.com/preview.jpg');
    warnSpy.mockRestore();
  });

  it('applies neither when the resolver found nothing at all', async () => {
    jest.mocked(resolveUrlMetadata).mockResolvedValue({ title: null, source: null, previewImageUrl: null });

    await enrichItemTitleFromUrlMetadata(request, 42, 'https://example.com');

    expect(updateItemDetails).not.toHaveBeenCalled();
    expect(setItemPreviewImage).not.toHaveBeenCalled();
  });
});
