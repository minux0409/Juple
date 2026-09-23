import { COLLECTION_ICON_KEYS, resolveCollectionIconComponent } from '../collectionIcons';

describe('collection icon resolver', () => {
  it('resolves every persisted icon key and uses Folder for unknown values', () => {
    for (const key of COLLECTION_ICON_KEYS) {
      expect(resolveCollectionIconComponent(key)).toBeTruthy();
    }
    expect(resolveCollectionIconComponent('unknown')).toBe(resolveCollectionIconComponent('Folder'));
  });
});
