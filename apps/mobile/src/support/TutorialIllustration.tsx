import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { resolveCollectionColorTile, type CollectionColorKey } from '../collections/collectionColors';
import { resolveCollectionIconComponent, type CollectionIconKey } from '../collections/collectionIcons';
import { ViewModeToggle } from '../components/ViewModeToggle';
import { ChevronIcon } from '../icons/ChevronIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { ImageIcon } from '../icons/ImageIcon';
import { InfoIcon } from '../icons/InfoIcon';
import { LinkIcon } from '../icons/LinkIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { SearchIcon } from '../icons/SearchIcon';
import { ShareIcon } from '../icons/ShareIcon';
import { useLayoutDirection } from '../i18n/layoutDirection';
import { cardShadow, colors, radii, spacing } from '../theme/tokens';
import type { TutorialPageDefinition } from './tutorialPages';

/**
 * The tutorial's illustrations: small, static, simplified Juple mini-UIs built from the app's own tokens, icons and
 * Collection tile colors - no bitmaps, no screenshots, no phone frame, nothing to download. Purely decorative: the whole
 * tree is hidden from assistive technology (the visible title and description carry every meaning), it does not respond to
 * touches and it never animates, so reduced-motion settings need no special handling. Sample content is shapes
 * and existing localized labels - never user data.
 */
export function TutorialIllustration({ pageId }: { readonly pageId: TutorialPageDefinition['id'] }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.frame}
      testID={`tutorial-illustration-${pageId}`}
    >
      {renderIllustration(pageId)}
    </View>
  );
}

function renderIllustration(pageId: TutorialPageDefinition['id']): ReactNode {
  switch (pageId) {
    case 'save':
      return <SaveIllustration />;
    case 'today':
      return <TodayIllustration />;
    case 'collections':
      return <CollectionsIllustration />;
    case 'share':
      return <ShareIllustration />;
    case 'find':
      return <FindIllustration />;
    case 'start':
      return <StartIllustration />;
  }
}

/** A saved-link row: a preview square, a title bar and a smaller address bar. */
function MiniLinkRow({ tint = colors.brandSoft, titleWidth = '72%', accent }: { readonly tint?: string; readonly titleWidth?: `${number}%`; readonly accent?: ReactNode }) {
  return (
    <View style={styles.linkRow}>
      <View style={[styles.thumb, { backgroundColor: tint }]}>
        <ImageIcon color={colors.brand} size={16} />
      </View>
      <View style={styles.linkLines}>
        <View style={[styles.bar, styles.barStrong, { width: titleWidth }]} />
        <View style={[styles.bar, styles.w45]} />
      </View>
      {accent}
    </View>
  );
}

function SaveIllustration() {
  return (
    <View style={styles.stack}>
      <View style={styles.pillRow}>
        <View style={styles.roundIcon}>
          <ShareIcon color={colors.brand} size={18} />
        </View>
        <View style={styles.urlPill}>
          <LinkIcon color={colors.textSecondary} size={14} />
          <Text allowFontScaling={false} numberOfLines={1} style={styles.urlText}>{'https://'}</Text>
        </View>
      </View>
      <ChevronIcon color={colors.border} direction="down" size={18} />
      <View style={styles.card}>
        <MiniLinkRow accent={<CheckIcon color={colors.success} size={16} />} />
      </View>
    </View>
  );
}

function TodayIllustration() {
  const { t } = useTranslation();
  return (
    <View style={styles.stack}>
      <View style={styles.tabs}>
        <View style={[styles.tab, styles.tabSelected]}>
          <Text allowFontScaling={false} numberOfLines={1} style={[styles.tabText, styles.tabTextSelected]}>{t('tabs.home')}</Text>
        </View>
        <View style={styles.tab}>
          <Text allowFontScaling={false} numberOfLines={1} style={styles.tabText}>{t('tabs.history')}</Text>
        </View>
      </View>
      <View style={styles.card}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.sectionLabel}>{t('history.today')}</Text>
        <MiniLinkRow />
        <View style={styles.rowDivider} />
        <MiniLinkRow tint={colors.surfaceMuted} titleWidth="58%" />
      </View>
      <View style={[styles.card, styles.cardCompact]}>
        <View style={[styles.bar, styles.barStrong, styles.w34]} />
      </View>
    </View>
  );
}

function CollectionTile({ icon, color, photo = false }: { readonly icon: CollectionIconKey; readonly color: CollectionColorKey; readonly photo?: boolean }) {
  const tile = resolveCollectionColorTile(color);
  const Icon = resolveCollectionIconComponent(icon);
  return (
    <View style={styles.tileColumn}>
      <View style={[styles.tile, { backgroundColor: tile.background }]}>
        {photo ? (
          <>
            <View style={[styles.photoHill, { backgroundColor: tile.icon }]} />
            <View style={styles.photoSun} />
          </>
        ) : (
          <Icon color={tile.icon} size={26} />
        )}
      </View>
      <View style={[styles.bar, styles.barStrong, styles.w70]} />
    </View>
  );
}

function CollectionsIllustration() {
  return (
    <View style={styles.tilesRow}>
      <CollectionTile color="Blue" icon="Plane" />
      <CollectionTile color="Rose" icon="Heart" />
      <CollectionTile color="Mint" icon="Utensils" photo />
    </View>
  );
}

function ShareIllustration() {
  const { t } = useTranslation();
  const avatarTints = [colors.brandSoft, '#FBEDEE', '#E6F6EC'];
  return (
    <View style={styles.stack}>
      <View style={[styles.card, styles.shareCard]}>
        <View style={[styles.tile, styles.tileSmall, { backgroundColor: resolveCollectionColorTile('Blue').background }]}>
          <FolderIcon color={resolveCollectionColorTile('Blue').icon} size={22} />
        </View>
        <View style={styles.linkLines}>
          <View style={[styles.bar, styles.barStrong, styles.w62]} />
          <View style={styles.avatarStack}>
            {avatarTints.map((tint, index) => (
              <View key={tint} style={[styles.avatar, { backgroundColor: tint }, index > 0 && styles.avatarOverlap]}>
                <PeopleIcon color={colors.textSecondary} size={12} />
              </View>
            ))}
          </View>
        </View>
        <View style={styles.roundIcon}>
          <ShareIcon color={colors.brand} size={18} />
        </View>
      </View>
      <View style={styles.permissionPill}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.permissionText}>{t('shareSheet.permissionRead')}</Text>
      </View>
    </View>
  );
}

/** Three tiny panels, one per view mode, so List / Grid / Image read as clearly different at a glance. */
function ViewModePanels() {
  return (
    <View style={styles.panelsRow}>
      <View style={styles.panel}>
        {[0, 1, 2].map(index => (
          <View key={index} style={styles.panelListRow}>
            <View style={styles.panelThumb} />
            <View style={styles.panelLine} />
          </View>
        ))}
      </View>
      <View style={[styles.panel, styles.panelGrid]}>
        {[0, 1, 2, 3].map(index => <View key={index} style={styles.panelGridCell} />)}
      </View>
      <View style={[styles.panel, styles.panelGrid]}>
        {Array.from({ length: 9 }, (_, index) => <View key={index} style={styles.panelImageCell} />)}
      </View>
    </View>
  );
}

function FindIllustration() {
  const { t } = useTranslation();
  return (
    <View style={styles.stack}>
      <View style={styles.searchField}>
        <SearchIcon color={colors.textSecondary} size={16} />
        <Text allowFontScaling={false} numberOfLines={1} style={styles.searchText}>{t('history.searchPlaceholder')}</Text>
      </View>
      <View style={styles.controlsRow}>
        <View style={styles.sortChips}>
          <View style={[styles.chip, styles.chipSelected]}>
            <Text allowFontScaling={false} numberOfLines={1} style={[styles.chipText, styles.chipTextSelected]}>{t('collections.sortDate')}</Text>
          </View>
          <View style={styles.chip}>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.chipText}>{t('collections.sortName')}</Text>
          </View>
        </View>
        <ViewModeToggle onChange={() => undefined} showImage value="grid" />
      </View>
      <ViewModePanels />
    </View>
  );
}

function HelpRow({ label }: { readonly label: string }) {
  const direction = useLayoutDirection();
  return (
    <View style={styles.helpRow}>
      <View style={styles.helpIcon}>
        <InfoIcon color={colors.brand} size={16} />
      </View>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.helpLabel}>{label}</Text>
      <ChevronIcon color={colors.textSecondary} direction={direction === 'rtl' ? 'left' : 'right'} size={16} />
    </View>
  );
}

function StartIllustration() {
  const { t } = useTranslation();
  return (
    <View style={styles.stack}>
      <View style={styles.mark}>
        <Text allowFontScaling={false} style={styles.markText}>Juple</Text>
      </View>
      <View style={[styles.card, styles.helpCard]}>
        <HelpRow label={t('guide.title')} />
        <View style={styles.rowDivider} />
        <HelpRow label={t('guide.replayTutorial')} />
      </View>
    </View>
  );
}

const TILE = 72;

const styles = StyleSheet.create({
  frame: { alignItems: 'center', alignSelf: 'center', justifyContent: 'center', maxWidth: 300, minHeight: 168, width: '100%' },
  stack: { alignItems: 'center', rowGap: spacing.sm, width: '100%' },
  card: { alignSelf: 'stretch', backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.lg, borderWidth: 1, padding: spacing.sm, rowGap: spacing.sm, ...cardShadow },
  cardCompact: { paddingVertical: spacing.sm + 2 },
  shareCard: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row' },
  helpCard: { paddingVertical: spacing.xs },
  bar: { backgroundColor: colors.divider, borderRadius: 3, height: 6 },
  w34: { width: '34%' },
  w45: { width: '45%' },
  w62: { width: '62%' },
  w70: { width: '70%' },
  avatarOverlap: { marginStart: -8 },
  barStrong: { backgroundColor: colors.inputBorder, height: 8 },
  linkRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row' },
  linkLines: { flex: 1, flexShrink: 1, rowGap: 6 },
  thumb: { alignItems: 'center', borderRadius: radii.sm, height: 36, justifyContent: 'center', width: 36 },
  rowDivider: { backgroundColor: colors.divider, height: 1 },
  sectionLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
  pillRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row' },
  roundIcon: { alignItems: 'center', backgroundColor: colors.brandSoft, borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  urlPill: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.lg * 2, borderWidth: 1, columnGap: 6, flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: 8, width: 150 },
  urlText: { color: colors.textSecondary, flexShrink: 1, fontSize: 12, writingDirection: 'ltr' },
  tabs: { backgroundColor: colors.surfaceMuted, borderRadius: radii.md, columnGap: 2, flexDirection: 'row', padding: 2 },
  tab: { alignItems: 'center', borderRadius: radii.sm, justifyContent: 'center', minWidth: 84, paddingHorizontal: spacing.md, paddingVertical: 6 },
  tabSelected: { backgroundColor: colors.surface },
  tabText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  tabTextSelected: { color: colors.brand },
  tilesRow: { alignItems: 'flex-start', columnGap: spacing.md, flexDirection: 'row', justifyContent: 'center' },
  tileColumn: { alignItems: 'center', rowGap: 8, width: TILE },
  tile: { alignItems: 'center', borderRadius: radii.lg, height: TILE, justifyContent: 'center', overflow: 'hidden', width: TILE },
  tileSmall: { height: 44, width: 44 },
  photoHill: { borderRadius: 40, bottom: -26, height: 56, opacity: 0.55, position: 'absolute', start: -8, width: 90 },
  photoSun: { backgroundColor: colors.surface, borderRadius: 7, height: 14, opacity: 0.85, position: 'absolute', end: 14, top: 12, width: 14 },
  avatarStack: { flexDirection: 'row' },
  avatar: { alignItems: 'center', borderColor: colors.surface, borderRadius: 11, borderWidth: 2, height: 22, justifyContent: 'center', width: 22 },
  permissionPill: { backgroundColor: colors.brandSoft, borderRadius: radii.lg * 2, paddingHorizontal: spacing.md, paddingVertical: 4 },
  permissionText: { color: colors.brand, fontSize: 11, fontWeight: '700' },
  searchField: { alignItems: 'center', alignSelf: 'stretch', backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.md, borderWidth: 1, columnGap: spacing.sm, flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: 8 },
  searchText: { color: colors.textSecondary, flex: 1, flexShrink: 1, fontSize: 12 },
  controlsRow: { alignItems: 'center', alignSelf: 'stretch', columnGap: spacing.sm, flexDirection: 'row', justifyContent: 'space-between' },
  sortChips: { columnGap: 6, flexDirection: 'row', flexShrink: 1 },
  chip: { backgroundColor: colors.surfaceMuted, borderRadius: radii.lg * 2, flexShrink: 1, paddingHorizontal: spacing.sm + 2, paddingVertical: 5 },
  chipSelected: { backgroundColor: colors.brandSoft },
  chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  chipTextSelected: { color: colors.brand },
  panelsRow: { columnGap: spacing.sm, flexDirection: 'row', justifyContent: 'center' },
  panel: { backgroundColor: colors.surface, borderColor: colors.inputBorder, borderRadius: radii.md, borderWidth: 1, height: 64, padding: 6, rowGap: 5, width: 84 },
  panelGrid: { columnGap: 4, flexDirection: 'row', flexWrap: 'wrap' },
  panelListRow: { alignItems: 'center', columnGap: 4, flexDirection: 'row' },
  panelThumb: { backgroundColor: colors.brandSoft, borderRadius: 3, height: 12, width: 12 },
  panelLine: { backgroundColor: colors.inputBorder, borderRadius: 2, flex: 1, height: 4 },
  panelGridCell: { backgroundColor: colors.brandSoft, borderRadius: 4, height: 22, width: 31 },
  panelImageCell: { backgroundColor: colors.brandSoft, borderRadius: 2, height: 14, width: 20 },
  helpRow: { alignItems: 'center', columnGap: spacing.sm, flexDirection: 'row', minHeight: 36, paddingHorizontal: 4 },
  helpIcon: { alignItems: 'center', backgroundColor: colors.brandSoft, borderRadius: radii.sm, height: 26, justifyContent: 'center', width: 26 },
  helpLabel: { color: colors.textPrimary, flex: 1, flexShrink: 1, fontSize: 12, fontWeight: '600' },
  mark: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radii.xl, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  markText: { color: colors.surface, fontSize: 24, fontWeight: '800', letterSpacing: 0.5, writingDirection: 'ltr' },
});
