import { StyleSheet, View } from 'react-native';
import { BellIcon } from '../icons/BellIcon';
import { CheckIcon } from '../icons/CheckIcon';
import { CloseIcon } from '../icons/CloseIcon';
import { CommentIcon } from '../icons/CommentIcon';
import { FolderIcon } from '../icons/FolderIcon';
import { LinkIcon } from '../icons/LinkIcon';
import { PeopleIcon } from '../icons/PeopleIcon';
import { SmileyPlusIcon } from '../icons/SmileyPlusIcon';
import { colors } from '../theme/tokens';

/**
 * A neutral, type-specific glyph in a soft circle - shown where no person may (or can) be shown: an
 * approval request (who proposed is never revealed), its result, a public-link add, a banner. Never
 * a made-up avatar. Decorative: the text next to it already says what happened.
 */
export function NotificationTypeIcon({ type, size = 40 }: { readonly type: string | null; readonly size?: number }) {
  const glyph = Math.round(size * 0.5);
  const color = colors.brand;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.circle, { borderRadius: size / 2, height: size, width: size }]}
      testID={`notification-type-icon-${type ?? 'unknown'}`}
    >
      {renderGlyph(type, glyph, color)}
    </View>
  );
}

function renderGlyph(type: string | null, size: number, color: string) {
  switch (type) {
    case 'friendRequest':
    case 'collectionInvitation':
      return <PeopleIcon color={color} size={size} />;
    case 'collectionItemsAdded':
    case 'collectionLinkShared':
      return <LinkIcon color={color} size={size} />;
    case 'collectionItemReaction':
      return <SmileyPlusIcon color={color} size={size} />;
    case 'collectionItemComment':
      return <CommentIcon color={color} size={size} />;
    case 'collectionLinkSubmission':
      return <FolderIcon color={color} size={size} />;
    case 'collectionLinkSubmissionApproved':
      return <CheckIcon color={color} size={size} />;
    case 'collectionLinkSubmissionRejected':
      return <CloseIcon color={color} size={size} />;
    default:
      return <BellIcon color={color} size={size} />;
  }
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', backgroundColor: colors.brandSoft, justifyContent: 'center' },
});
