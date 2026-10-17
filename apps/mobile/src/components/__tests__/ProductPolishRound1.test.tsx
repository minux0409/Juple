import ReactTestRenderer, { act } from 'react-test-renderer';
import { Image, StyleSheet, Text } from 'react-native';
import i18n from '../../i18n';
import { OwnerCrown } from '../../collections/OwnerCrown';
import { describeItemAdder } from '../../collections/itemAdder';
import { CrownIcon } from '../../icons/CrownIcon';
import { ExternalLinkIcon } from '../../icons/ExternalLinkIcon';
import { GlobeIcon } from '../../icons/GlobeIcon';
import { YouTubeIcon } from '../../icons/YouTubeIcon';
import type { ItemHistoryEntry } from '../../items/api/itemsApi';
import { colors } from '../../theme/tokens';
import { ItemAdderBadge } from '../ItemAdderBadge';
import { OpenOriginalLinkButton } from '../OpenOriginalLinkButton';
import { UserAvatar } from '../UserAvatar';
import { ParticipantAvatarStack } from '../ParticipantAvatarStack';
import { SavedLinkGridCard } from '../SavedLinkGridCard';
import { SavedLinkImageTile } from '../SavedLinkImageTile';
import { SavedLinkRow } from '../SavedLinkRow';

const OPEN = 'saved-link-open-original';
const SAVED_AT = '2026-09-24T13:06:00Z';
const timeText = new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(new Date(SAVED_AT));

function entry(overrides: Partial<ItemHistoryEntry> = {}): ItemHistoryEntry {
  return { id: 1, url: 'https://example.com/a', title: 'A saved link', memo: null, savedAtUtc: SAVED_AT, representativeImage: null, previewImageUrl: null, coverImage: null, ...overrides };
}

async function renderNode(node: React.ReactElement) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(node);
  });
  return renderer;
}

const textsOf = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAllByType(Text).map(node => node.props.children);
/** The Pressable itself (it carries onPress and the style function); its host View carries the resolved style. */
const openButtons = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAll(node => node.props.testID === OPEN && typeof node.props.onPress === 'function');

describe('saved links carry no time on the card (Item Details has it)', () => {
  it('List row and Grid card draw no time text, with or without the open button', async () => {
    const list = await renderNode(<SavedLinkRow dateDisplayMode="dateTime" isActionInFlight={false} item={entry()} onOpenOriginal={jest.fn()} />);
    const grid = await renderNode(<SavedLinkGridCard dateDisplayMode="dateTime" isActionInFlight={false} item={entry()} onOpenOriginal={jest.fn()} />);
    for (const renderer of [list, grid]) {
      const texts = textsOf(renderer);
      expect(texts).toContain('A saved link');
      expect(texts).not.toContain(timeText);
      expect(texts.some(text => typeof text === 'string' && /\d{1,2}:\d{2}/.test(text))).toBe(false);
    }
  });
});

describe('바로가기: the open-original button', () => {
  it('List: a 44dp button at the row\'s end opens the original, not Item Details, and does not bubble to the row', async () => {
    const onOpenOriginal = jest.fn();
    const renderer = await renderNode(<SavedLinkRow isActionInFlight={false} item={entry()} onOpenOriginal={onOpenOriginal} />);

    const [button] = openButtons(renderer);
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe(i18n.t('item.goToUrlA11y'));
    expect(StyleSheet.flatten(button.props.style({ pressed: false }))).toMatchObject({ width: 44, height: 44 });
    expect(renderer.root.findAllByType(ExternalLinkIcon)).toHaveLength(1);

    const stopPropagation = jest.fn();
    act(() => {
      button.props.onPress({ stopPropagation });
    });
    expect(stopPropagation).toHaveBeenCalled();
    expect(onOpenOriginal).toHaveBeenCalledTimes(1);

    // It is the row's LAST cell: after the picture and the text column, never over them.
    const row = renderer.root.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.flexDirection === 'row' && node.props.children?.length >= 3)[0];
    const kinds = row.children.map(child => (typeof child === 'string' ? 'text' : child.type === OpenOriginalLinkButton ? 'open' : 'other'));
    expect(kinds[kinds.length - 1]).toBe('open');
  });

  it('Grid: a small corner button on the meta line - its own cell, outside the picture and the title', async () => {
    const onOpenOriginal = jest.fn();
    const renderer = await renderNode(<SavedLinkGridCard isActionInFlight={false} item={entry({ previewImageUrl: 'https://cdn.example/p.jpg' })} onOpenOriginal={onOpenOriginal} />);

    const [button] = openButtons(renderer);
    expect(button.props.accessibilityLabel).toBe(i18n.t('item.goToUrlA11y'));
    expect(StyleSheet.flatten(button.props.style({ pressed: false }))).toMatchObject({ width: 28, height: 28 });
    act(() => {
      button.props.onPress({ stopPropagation: jest.fn() });
    });
    expect(onOpenOriginal).toHaveBeenCalledTimes(1);
    // Not inside the picture box (the Image's parent) and not the title text.
    const image = renderer.root.findAll(node => StyleSheet.flatten(node.props.style)?.aspectRatio === 1)[0];
    expect(image.findAll(node => node.props.testID === OPEN)).toHaveLength(0);
    const title = renderer.root.findAllByType(Text).find(node => node.props.children === 'A saved link')!;
    expect(title.findAll(node => node.props.testID === OPEN)).toHaveLength(0);
  });

  it('no button unless a caller gives the action; a locked (redacted) card never has one', async () => {
    expect(openButtons(await renderNode(<SavedLinkRow isActionInFlight={false} item={entry()} />))).toHaveLength(0);
    expect(openButtons(await renderNode(<SavedLinkGridCard isActionInFlight={false} item={entry()} />))).toHaveLength(0);
    const locked = entry({ isCollectionLocked: true, collectionId: 3, url: '' });
    expect(openButtons(await renderNode(<SavedLinkRow isActionInFlight={false} item={locked} onOpenOriginal={jest.fn()} />))).toHaveLength(0);
    expect(openButtons(await renderNode(<SavedLinkGridCard isActionInFlight={false} item={locked} onOpenOriginal={jest.fn()} />))).toHaveLength(0);
  });

  it('the 9-column image view is unchanged: picture only, no open button, no time', async () => {
    const renderer = await renderNode(<SavedLinkImageTile item={entry({ previewImageUrl: 'https://cdn.example/p.jpg' })} onPress={jest.fn()} />);
    expect(openButtons(renderer)).toHaveLength(0);
    expect(renderer.root.findAllByType(ExternalLinkIcon)).toHaveLength(0);
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
  });
});

describe('a link without a picture keeps its media slot', () => {
  const placeholder = (renderer: ReactTestRenderer.ReactTestRenderer) => renderer.root.findAll(node => node.props.testID === 'saved-link-thumbnail-placeholder' && typeof node.type === 'string');

  it('List: a 60dp square with the site badge (generic globe for an unknown site) where the picture would be', async () => {
    const renderer = await renderNode(<SavedLinkRow isActionInFlight={false} item={entry()} preferEffectiveThumbnail />);
    const [slot] = placeholder(renderer);
    expect(StyleSheet.flatten(slot.props.style)).toMatchObject({ width: 60, height: 60, borderRadius: 14, marginEnd: 12 });
    expect(slot.findAllByType(GlobeIcon)).toHaveLength(1);
    expect(slot.props.accessibilityElementsHidden).toBe(true);

    const youtube = await renderNode(<SavedLinkRow isActionInFlight={false} item={entry({ url: 'https://www.youtube.com/watch?v=abc' })} preferEffectiveThumbnail />);
    expect(placeholder(youtube)[0].findAllByType(YouTubeIcon)).toHaveLength(1);
  });

  it('a row with a picture has no placeholder; a picture that fails to load falls back to it (same square)', async () => {
    const renderer = await renderNode(<SavedLinkRow isActionInFlight={false} item={entry({ previewImageUrl: 'https://cdn.example/p.jpg' })} preferEffectiveThumbnail />);
    expect(placeholder(renderer)).toHaveLength(0);
    expect(StyleSheet.flatten(renderer.root.findByType(Image).props.style)).toMatchObject({ width: 60, height: 60 });

    await act(async () => {
      renderer.root.findByType(Image).props.onError();
    });
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(StyleSheet.flatten(placeholder(renderer)[0].props.style)).toMatchObject({ width: 60, height: 60 });
  });

  it('the text column starts after the slot (60 + 12) whatever the picture, so a selection mark on the slot never reaches the title', async () => {
    // The selection mark (CollectionDetails) is 22dp at spacing.xs from the card's start; the row pads spacing.md before the slot.
    const markEnd = 4 + 22;
    const withPicture = await renderNode(<SavedLinkRow isActionInFlight={false} item={entry({ previewImageUrl: 'https://cdn.example/p.jpg' })} preferEffectiveThumbnail />);
    const withoutPicture = await renderNode(<SavedLinkRow isActionInFlight={false} item={entry()} preferEffectiveThumbnail />);
    const textStart = (renderer: ReactTestRenderer.ReactTestRenderer) => {
      const row = renderer.root.findAll(node => typeof node.type === 'string' && StyleSheet.flatten(node.props.style)?.flexDirection === 'row' && node.props.children?.length >= 2)[0];
      const padding = StyleSheet.flatten(row.props.style).paddingHorizontal as number;
      const slot = StyleSheet.flatten(row.children.find(child => typeof child !== 'string')!.props.style ?? {});
      return { padding, slotWidth: (slot.width as number) ?? 60 };
    };
    for (const renderer of [withPicture, withoutPicture]) {
      const { padding, slotWidth } = textStart(renderer);
      expect(padding + slotWidth + 12).toBeGreaterThan(markEnd);
    }
    // And the slot exists in both, with the same box.
    expect(placeholder(withoutPicture)).toHaveLength(1);
    expect(placeholder(withPicture)).toHaveLength(0);
  });
});

describe('the Owner crown rides on the avatar\'s top end corner', () => {
  const owner = { jupleId: 'OWNR1234', displayName: '방장' };
  const adder = (kind: 'me' | 'owner' | 'member', isCollectionOwner: boolean) =>
    describeItemAdder({ kind, jupleId: owner.jupleId, displayName: owner.displayName, isCollectionOwner }, i18n.t.bind(i18n))!;

  it('an adder who owns the Collection gets the crown on the avatar - also when it is the signed-in user; others none', async () => {
    const asOwner = await renderNode(<ItemAdderBadge adder={adder('owner', true)} avatarSize={16} />);
    const asMeOwner = await renderNode(<ItemAdderBadge adder={adder('me', true)} avatarSize={16} />);
    const member = await renderNode(<ItemAdderBadge adder={adder('member', false)} avatarSize={16} />);
    const meNotOwner = await renderNode(<ItemAdderBadge adder={adder('me', false)} avatarSize={16} />);
    for (const renderer of [asOwner, asMeOwner]) {
      expect(renderer.root.findAllByType(CrownIcon)).toHaveLength(1);
      const crown = renderer.root.findAll(node => node.props.testID === 'saved-link-adder-owner' && typeof node.type === 'string')[0];
      // On the avatar's wrapper (an absolute chip at the top END corner), not a separate item after it.
      expect(StyleSheet.flatten(crown.props.style)).toMatchObject({ position: 'absolute' });
      expect(StyleSheet.flatten(crown.props.style).end).toBeLessThan(0);
      expect(StyleSheet.flatten(crown.props.style).top).toBeLessThan(0);
      expect(crown.props.importantForAccessibility).toBe('no-hide-descendants');
      // The wrapper that holds the crown holds exactly the one avatar it marks.
      let wrapper = crown.parent!;
      while (wrapper.findAllByType(UserAvatar).length === 0) {
        wrapper = wrapper.parent!;
      }
      expect(wrapper.findAllByType(UserAvatar)).toHaveLength(1);
      expect(wrapper.findAllByType(CrownIcon)).toHaveLength(1);
    }
    expect(member.root.findAllByType(CrownIcon)).toHaveLength(0);
    expect(meNotOwner.root.findAllByType(CrownIcon)).toHaveLength(0);
    // The words (who, and that they own it) stay in the accessibility label.
    expect(asOwner.root.findByProps({ testID: 'saved-link-added-by' }).props.accessibilityLabel).toContain('방장');
  });

  it('the crown is a legible chip even on a 16dp avatar, and scales with a large one', async () => {
    const small = await renderNode(<OwnerCrown avatarSize={16} />);
    const large = await renderNode(<OwnerCrown avatarSize={48} />);
    expect(small.root.findByType(CrownIcon).props.size).toBe(10);
    expect(large.root.findByType(CrownIcon).props.size).toBe(20);
    expect(small.root.findByType(CrownIcon).props.color).toBe(colors.warning);
  });

  it('participant stack: the Owner\'s circle has the crown (the signed-in user included, first); the others none', async () => {
    const people = [
      { jupleId: 'OWNR1234', displayName: '나', role: 'owner' },
      { jupleId: 'MEMB1234', displayName: '멤버', role: 'contributor' },
      { jupleId: 'VIEW1234', displayName: '뷰어', role: 'viewer' },
    ];
    const renderer = await renderNode(<ParticipantAvatarStack accessibilityLabel="참여자" onPress={jest.fn()} participants={people} testID="stack" />);
    expect(renderer.root.findAllByType(CrownIcon)).toHaveLength(1);
    const ring = renderer.root.findByProps({ testID: 'stack-avatar-OWNR1234' });
    expect(ring.findAllByType(CrownIcon)).toHaveLength(1);
    expect(renderer.root.findByProps({ testID: 'stack-avatar-MEMB1234' }).findAllByType(CrownIcon)).toHaveLength(0);
    // Earlier circles paint above later ones, so the crown is never hidden by the overlap.
    expect(StyleSheet.flatten(ring.props.style).zIndex).toBeGreaterThan(StyleSheet.flatten(renderer.root.findByProps({ testID: 'stack-avatar-MEMB1234' }).props.style).zIndex as number);
  });

  it('a stack with no Owner (a personal Collection never has one) draws no crown', async () => {
    const renderer = await renderNode(<ParticipantAvatarStack accessibilityLabel="참여자" onPress={jest.fn()} participants={[{ jupleId: 'MEMB1234', displayName: '멤버' }]} testID="stack" />);
    expect(renderer.root.findAllByType(CrownIcon)).toHaveLength(0);
  });
});
