import { createContext, useCallback, useContext, useId, useMemo, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { InputAccessoryView, Keyboard, Platform, Text, TextInput, View } from 'react-native';
import { Pressable } from './Pressable';
import { ChevronIcon } from '../icons/ChevronIcon';
import { colors, minTouchTarget, spacing, themedStyles } from '../theme/tokens';

/**
 * iOS's keyboard has no built-in way to close it or to move between fields (Android has its system back and the IME's own
 * next / done key). Every ThemedTextInput therefore gets a toolbar above the iOS keyboard: [↑ previous] [↓ next] ... [완료].
 *
 * - 완료 only puts the keyboard away: what was typed stays in the field, nothing is saved or sent (that is still the screen's own
 *   button), and Return keeps its meaning (a new line in a multi-line field, the field's own submit otherwise).
 * - ↑ / ↓ move to the previous / next editable field of the same SCOPE, in reading order (top to bottom, then left to right, by
 *   their position on screen); a dialog opens a scope of its own (KeyboardFieldScope), so they never jump to a field behind it.
 *   With no field in that direction the button is shown disabled.
 * - Android: nothing - its keyboard already does all of this.
 */

/** The mounted field (React Native's TextInput instance). */
export type TextInputHandle = ComponentRef<typeof TextInput>;

interface KeyboardField {
  readonly ref: RefObject<TextInputHandle | null>;
  readonly isEditable: () => boolean;
}

type FieldScope = Set<KeyboardField>;

const rootScope: FieldScope = new Set();
const FieldScopeContext = createContext<FieldScope>(rootScope);

/** Wraps a dialog's content: its fields are one group of their own for the keyboard's ↑ / ↓. */
export function KeyboardFieldScope({ children }: { readonly children: ReactNode }) {
  const scope = useMemo<FieldScope>(() => new Set(), []);
  return <FieldScopeContext.Provider value={scope}>{children}</FieldScopeContext.Provider>;
}

interface PlacedField {
  readonly field: KeyboardField;
  readonly x: number;
  readonly y: number;
}

/** Fields on the same line within this many points count as one row (then left to right). */
const SAME_ROW_TOLERANCE = 4;

function measure(field: KeyboardField): Promise<PlacedField | null> {
  const node = field.ref.current;
  if (!node || !field.isEditable()) {
    return Promise.resolve(null);
  }
  return new Promise(resolve => {
    try {
      node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { field, x, y } : null));
    } catch {
      resolve(null);
    }
  });
}

/** The scope's editable, laid-out fields in reading order. */
export async function orderedFields(scope: ReadonlySet<KeyboardField>): Promise<readonly KeyboardField[]> {
  const placed = (await Promise.all([...scope].map(measure))).filter((entry): entry is PlacedField => entry !== null);
  placed.sort((a, b) => (Math.abs(a.y - b.y) > SAME_ROW_TOLERANCE ? a.y - b.y : a.x - b.x));
  return placed.map(entry => entry.field);
}

interface KeyboardToolbar {
  /** The field's inputAccessoryViewID (iOS), undefined elsewhere. */
  readonly nativeID: string | undefined;
  /** Rendered beside the field: the toolbar itself (iOS), null elsewhere. */
  readonly element: ReactNode;
  /** Called when the field gains focus - works out whether ↑ / ↓ have somewhere to go. */
  readonly onFieldFocus: () => void;
  /** Registers the field for ↑ / ↓ while it is mounted. */
  readonly register: () => () => void;
}

export function useKeyboardToolbar(ref: RefObject<TextInputHandle | null>, isEditable: () => boolean, enabled: boolean): KeyboardToolbar {
  const { t } = useTranslation();
  const scope = useContext(FieldScopeContext);
  const id = useId();
  const field = useMemo<KeyboardField>(() => ({ ref, isEditable }), [ref, isEditable]);
  const [neighbours, setNeighbours] = useState<{ readonly previous: boolean; readonly next: boolean }>({ previous: false, next: false });
  const isActive = Platform.OS === 'ios' && enabled;

  const register = useCallback(() => {
    if (!isActive) {
      return () => undefined;
    }
    scope.add(field);
    return () => {
      scope.delete(field);
    };
  }, [isActive, scope, field]);

  const onFieldFocus = useCallback(() => {
    if (!isActive) {
      return;
    }
    orderedFields(scope).then(order => {
      const index = order.indexOf(field);
      setNeighbours({ previous: index > 0, next: index >= 0 && index < order.length - 1 });
    }).catch(() => undefined);
  }, [isActive, scope, field]);

  const move = useCallback((step: -1 | 1) => {
    orderedFields(scope).then(order => {
      const target = order[order.indexOf(field) + step];
      target?.ref.current?.focus();
    }).catch(() => undefined);
  }, [scope, field]);

  if (!isActive) {
    return { nativeID: undefined, element: null, onFieldFocus, register };
  }

  const nativeID = `juple-keyboard-toolbar-${id}`;
  return {
    nativeID,
    onFieldFocus,
    register,
    element: (
      <InputAccessoryView backgroundColor={colors.surfaceMuted} nativeID={nativeID}>
        <View style={styles.bar}>
          <Pressable
            accessibilityLabel={t('keyboard.previous')}
            accessibilityRole="button"
            accessibilityState={{ disabled: !neighbours.previous }}
            disabled={!neighbours.previous}
            onPress={() => move(-1)}
            style={styles.arrow}
            testID="keyboard-toolbar-previous"
          >
            <ChevronIcon color={neighbours.previous ? colors.brandText : colors.border} direction="up" size={22} />
          </Pressable>
          <Pressable
            accessibilityLabel={t('keyboard.next')}
            accessibilityRole="button"
            accessibilityState={{ disabled: !neighbours.next }}
            disabled={!neighbours.next}
            onPress={() => move(1)}
            style={styles.arrow}
            testID="keyboard-toolbar-next"
          >
            <ChevronIcon color={neighbours.next ? colors.brandText : colors.border} direction="down" size={22} />
          </Pressable>
          <View style={styles.spacer} />
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => Keyboard.dismiss()} style={styles.done} testID="keyboard-toolbar-done">
            <Text style={styles.doneLabel}>{t('keyboard.done')}</Text>
          </Pressable>
        </View>
      </InputAccessoryView>
    ),
  };
}

const styles = themedStyles(() => ({
  bar: {
    alignItems: 'center',
    borderTopColor: colors.inputBorder,
    borderTopWidth: 1,
    flexDirection: 'row',
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
  },
  arrow: { alignItems: 'center', height: minTouchTarget, justifyContent: 'center', width: minTouchTarget },
  spacer: { flex: 1 },
  done: { justifyContent: 'center', minHeight: minTouchTarget, paddingHorizontal: spacing.md },
  doneLabel: { color: colors.brandText, fontSize: 16, fontWeight: '700' },
}));
