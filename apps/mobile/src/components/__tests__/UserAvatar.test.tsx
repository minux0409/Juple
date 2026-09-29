import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, Text } from 'react-native';
import { UserIcon } from '../../icons/UserIcon';
import { forgetProfileImage, rememberLocalProfileImage, resetProfileImageCacheForTests } from '../../profile/profileImageCache';
import { avatarInitial, UserAvatar } from '../UserAvatar';

type Props = Parameters<typeof UserAvatar>[0];

async function render(props: Props) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<UserAvatar {...props} />);
  });
  return renderer;
}

async function update(renderer: ReactTestRenderer.ReactTestRenderer, props: Props) {
  await act(async () => {
    renderer.update(<UserAvatar {...props} />);
  });
}

const shownUri = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findByType(Image).props.source.uri;

beforeEach(() => resetProfileImageCacheForTests());

describe('UserAvatar', () => {
  it('shows the photo as a circle of the requested size', async () => {
    const renderer = await render({ jupleId: 'K7MP4Q8N', displayName: '피카츄', imageUrl: 'https://blob/a?sig=1', imageVersion: 'v1', size: 56 });

    const image = renderer.root.findByType(Image);
    expect(image.props.source.uri).toBe('https://blob/a?sig=1');
    const container = renderer.root.findByProps({ testID: 'user-avatar-image' });
    expect(container.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ borderRadius: 28, height: 56, width: 56 })]));
  });

  it('without a photo, shows the first character of the nickname', async () => {
    const renderer = await render({ jupleId: 'K7MP4Q8N', displayName: 'pikachu' });

    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findByType(Text).props.children).toBe('P');
  });

  it('without a photo or a nickname, shows a person glyph', async () => {
    const renderer = await render({ jupleId: 'K7MP4Q8N', displayName: null });

    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    expect(renderer.root.findAllByType(UserIcon)).toHaveLength(1);
  });

  it('keeps the first URL for the same photo version, so a fresh signed URL never re-downloads it', async () => {
    const renderer = await render({ jupleId: 'K7MP4Q8N', imageUrl: 'https://blob/a?sig=1', imageVersion: 'v1' });
    await update(renderer, { jupleId: 'K7MP4Q8N', imageUrl: 'https://blob/a?sig=2', imageVersion: 'v1' });

    expect(shownUri(renderer)).toBe('https://blob/a?sig=1');
  });

  it('switches to the new photo as soon as the version changes', async () => {
    const renderer = await render({ jupleId: 'K7MP4Q8N', imageUrl: 'https://blob/a?sig=1', imageVersion: 'v1' });
    await update(renderer, { jupleId: 'K7MP4Q8N', imageUrl: 'https://blob/b?sig=3', imageVersion: 'v2' });

    expect(shownUri(renderer)).toBe('https://blob/b?sig=3');
  });

  it('falls back to the initial once the photo is removed', async () => {
    const renderer = await render({ jupleId: 'K7MP4Q8N', displayName: 'Zoë', imageUrl: 'https://blob/a?sig=1', imageVersion: 'v1' });
    forgetProfileImage('K7MP4Q8N');
    await update(renderer, { jupleId: 'K7MP4Q8N', displayName: 'Zoë', imageUrl: null, imageVersion: null });

    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findByType(Text).props.children).toBe('Z');
  });

  it('a kept URL that fails to load gives way to the fresh URL, then to the initial', async () => {
    const renderer = await render({ jupleId: 'K7MP4Q8N', displayName: 'kim', imageUrl: 'https://blob/a?sig=1', imageVersion: 'v1' });
    await update(renderer, { jupleId: 'K7MP4Q8N', displayName: 'kim', imageUrl: 'https://blob/a?sig=2', imageVersion: 'v1' });
    expect(shownUri(renderer)).toBe('https://blob/a?sig=1');

    await act(async () => {
      renderer.root.findByType(Image).props.onError();
    });
    expect(shownUri(renderer)).toBe('https://blob/a?sig=2');

    await act(async () => {
      renderer.root.findByType(Image).props.onError();
    });
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findByType(Text).props.children).toBe('K');
  });

  it("right after saving, shows the user's own just-picked file for the new version", async () => {
    rememberLocalProfileImage('K7MP4Q8N', 'v9', 'file:///picked.jpg');
    const renderer = await render({ jupleId: 'K7MP4Q8N', imageUrl: 'https://blob/new?sig=1', imageVersion: 'v9' });

    expect(shownUri(renderer)).toBe('file:///picked.jpg');
  });

  it('is hidden from assistive technology - the name next to it already says who it is', async () => {
    const renderer = await render({ jupleId: 'K7MP4Q8N', displayName: 'kim' });

    expect(renderer.root.findByProps({ testID: 'user-avatar-fallback' }).props.accessibilityElementsHidden).toBe(true);
  });
});

describe('avatarInitial', () => {
  it('never splits an emoji or a Hangul syllable, and ignores surrounding spaces', () => {
    expect(avatarInitial('  피카츄')).toBe('피');
    expect(avatarInitial('😀 smile')).toBe('😀');
    expect(avatarInitial('')).toBeNull();
    expect(avatarInitial(null)).toBeNull();
  });
});
