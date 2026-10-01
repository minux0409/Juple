import ReactTestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { ParticipantAvatarStack } from '../ParticipantAvatarStack';
import { UserAvatar } from '../UserAvatar';

const person = (index: number) => ({ jupleId: `PERS${index}234`, displayName: `사람${index}`, profileImageUrl: null, profileImageVersion: null });
const people = (count: number) => Array.from({ length: count }, (_, index) => person(index));

function render(count: number, onPress = jest.fn()) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <ParticipantAvatarStack accessibilityLabel="참여자 보기" onPress={onPress} participants={people(count)} testID="stack" />,
    );
  });
  return { renderer, onPress };
}

describe('ParticipantAvatarStack - while the people are loading', () => {
  const renderLoading = (placeholderCount?: number) => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ParticipantAvatarStack accessibilityLabel="참여자 보기" onPress={jest.fn()} participants={null} placeholderCount={placeholderCount} testID="stack" />,
      );
    });
    return renderer;
  };
  const placeholders = (renderer: ReactTestRenderer.ReactTestRenderer) =>
    renderer.root.findAll(node => typeof node.type === 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith('stack-placeholder-'));

  it('draws small circles of the very same size and row - and no text at all', () => {
    const renderer = renderLoading(3);

    expect(placeholders(renderer)).toHaveLength(3);
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    expect(renderer.root.findAllByType(UserAvatar)).toHaveLength(0);
    // Same ring (32dp) as a real avatar, so nothing moves when the photos arrive.
    expect(StyleSheet.flatten(placeholders(renderer)[0].props.style)).toEqual(expect.objectContaining({ width: 32, height: 32 }));
  });

  it('is not pressable until the people are known, and never draws more than four', () => {
    const renderer = renderLoading(9);

    expect(placeholders(renderer)).toHaveLength(4);
    const row = renderer.root.findAll(node => node.props.accessibilityLabel === '참여자 보기' && node.props.accessibilityRole === 'button')[0];
    expect(row.props.disabled).toBe(true);
  });

  it('the real avatars replace the placeholders in the same row', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <ParticipantAvatarStack accessibilityLabel="참여자 보기" onPress={jest.fn()} participants={null} placeholderCount={2} testID="stack" />,
      );
    });
    act(() => {
      renderer.update(<ParticipantAvatarStack accessibilityLabel="참여자 보기" onPress={jest.fn()} participants={people(2)} testID="stack" />);
    });

    expect(placeholders(renderer)).toHaveLength(0);
    expect(renderer.root.findAllByType(UserAvatar)).toHaveLength(2);
  });
});

describe('ParticipantAvatarStack', () => {
  it('draws one small circle per person when they all fit, in order', () => {
    const { renderer } = render(3);

    const avatars = renderer.root.findAllByType(UserAvatar);
    expect(avatars.map(avatar => avatar.props.jupleId)).toEqual(['PERS0234', 'PERS1234', 'PERS2234']);
    expect(avatars.every(avatar => avatar.props.size === 28)).toBe(true);
    expect(renderer.root.findAll(node => node.props.testID === 'stack-more')).toHaveLength(0);
  });

  it('exactly four still fit; a fifth turns the last slot into "+N" for everyone left (never one person hidden behind a number)', () => {
    expect(render(4).renderer.root.findAllByType(UserAvatar)).toHaveLength(4);

    const { renderer } = render(5);
    expect(renderer.root.findAllByType(UserAvatar)).toHaveLength(3);
    const more = renderer.root.findAll(node => node.type === Text && node.props.testID === 'stack-more')[0];
    expect(more.props.children).toEqual(['+', 2]);

    const many = render(12).renderer;
    expect(many.root.findAllByType(UserAvatar)).toHaveLength(3);
    expect(many.root.findAll(node => node.type === Text && node.props.testID === 'stack-more')[0].props.children).toEqual(['+', 9]);
  });

  it('overlaps the circles with a logical (RTL-safe) margin - never the first one', () => {
    const { renderer } = render(3);

    const rings = renderer.root.findAll(node => typeof node.type === 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith('stack-avatar-'));
    const margins = rings.map(ring => StyleSheet.flatten(ring.props.style).marginStart);
    expect(margins[0]).toBeUndefined();
    expect(margins.slice(1).every(margin => typeof margin === 'number' && margin < 0)).toBe(true);
  });

  it('the whole row is one button with its label, a full touch target tall', () => {
    const { renderer, onPress } = render(3);

    const row = renderer.root.findAll(node => node.props.accessibilityLabel === '참여자 보기' && typeof node.props.onPress === 'function' && node.props.accessibilityRole === 'button')[0];
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe('참여자 보기');
    expect(StyleSheet.flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(44);
    act(() => row.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
