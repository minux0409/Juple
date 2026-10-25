/**
 * Shared spacing/radius values and the semantic colour palette (light and dark). Spacing and radii are plain constants; colours are
 * roles that answer for the theme in force - see `colors` and ThemeContext.
 */
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radii = {
  sm: 6,
  md: 8,
  /** Card-level radius (saved-link rows, grouped History sections, category cards) - this round's visual redesign bumped this from 16 to a softer, more modern 20. */
  lg: 20,
  /** Prominent elements - primary buttons. */
  xl: 24,
} as const;

/**
 * The semantic palette. Every screen reads `colors.<role>` - a role (what the colour is FOR), never a hex - and the palette answers for
 * the theme in force (light or dark, see ThemeContext): `colors` is a live view, so a style factory evaluated after a theme change
 * (themedStyles) picks the other palette without a single screen naming a theme. Roles map to the Web's CSS tokens
 * (--app-background, --app-surface, --app-text, --brand, --danger ...).
 *
 *  background / surface (card) / surfaceMuted / surfaceRaised (modal, sheet)   textPrimary / textSecondary / textMuted / textInverse
 *  border (icon stroke, outlines) / inputBorder / divider                       brand / brandSoft / onBrand
 *  danger / dangerSubtle / warning / warningText / success                      scrim / overlay / inputBackground / placeholder
 *
 * `surface` doubles as the label colour on a filled brand / danger control: it is white in Light and the dark card colour in Dark, where
 * the brand and danger fills are the lighter variants - both pairings keep text contrast above 4.5:1.
 */
export type ColorRole =
  | 'textPrimary'
  | 'textSecondary'
  | 'textMuted'
  | 'textInverse'
  | 'border'
  | 'inputBorder'
  | 'divider'
  | 'danger'
  | 'onDanger'
  | 'dangerText'
  | 'dangerBorder'
  | 'dangerSubtle'
  | 'warning'
  | 'warningText'
  | 'success'
  | 'surface'
  | 'surfaceMuted'
  | 'surfaceRaised'
  | 'background'
  | 'brand'
  | 'brandSoft'
  | 'brandText'
  | 'onBrand'
  | 'onOverlay'
  | 'scrim'
  | 'overlay'
  | 'inputBackground'
  | 'placeholder';

export type ColorScheme = 'light' | 'dark';
type Palette = Readonly<Record<ColorRole, string>>;

/**
 * Brand constants shared by both palettes (and mirrored by the Web's --brand / --danger). BRAND_PRIMARY is the violet-blue of the
 * final `e` in the Juple wordmark (assets/branding/juple-wordmark.png, the same value as the Web's --juple-violet; the wordmark's last letter measures 102/85/252); BRAND_DANGER
 * is the light coral the Dark theme already used for destructive actions.
 */
export const BRAND_PRIMARY = '#6751FC';
const BRAND_DANGER = '#FF8A8A';
const ON_DANGER = '#2B0A0A';

export const lightColors: Palette = {
  textPrimary: '#111111',
  textSecondary: '#666666',
  /** Muted helper text and disabled labels - still 4.5:1 on the light card. */
  textMuted: '#6B7280',
  /** Text on a surface of the opposite polarity (a dark toast in Light). */
  textInverse: '#FFFFFF',
  /** Icon-stroke color (e.g. an unfilled star) - deliberately NOT used for input/card borders, which use the much lighter `inputBorder` instead. */
  border: '#9A9A9A',
  /** Soft input/card border for the redesigned form fields - barely visible against `surface`, unlike the older, darker `border`. */
  inputBorder: '#DDE4EF',
  divider: '#EDF1F7',
  /** Destructive / danger actions: the same light coral in Light and Dark (one role, one colour). */
  danger: BRAND_DANGER,
  /** A label or icon on a filled `danger` surface - dark, because white on the light coral is under 3:1. */
  onDanger: ON_DANGER,
  /** Danger as TEXT / icon on a normal screen: the coral fails 4.5:1 on white, so Light uses a deeper red (>= 5.6:1 on every Light surface). */
  dangerText: '#B42318',
  /** Outline / stroke of a danger control: >= 3:1 on the Light surfaces. */
  dangerBorder: '#D92D3A',
  dangerSubtle: '#FDECEA',
  warning: '#F5A623',
  /** A warning as TEXT or a thin icon on white (신고): a darker amber that stays readable, unlike the fill-only `warning`. */
  warningText: '#9A5B00',
  success: '#0F7A3D',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F4F9',
  surfaceRaised: '#FFFFFF',
  /** Screen-level background - cool, light blue-gray so a white `surface` card reads as clearly lifted off it. */
  background: '#F7F9FC',
  /** "Juple blue" - the app's primary/CTA color (buttons, selected tab, selected pill). */
  brand: BRAND_PRIMARY,
  /** Pale brand tint - selected-chip backgrounds. */
  brandSoft: '#EEEBFF',
  /** Brand-coloured TEXT / icon / selected outline: a touch deeper than the fill so it stays >= 4.5:1 on every Light surface. */
  brandText: '#5A44EE',
  onBrand: '#FFFFFF',
  /** A label or spinner on the translucent dark layer over a picture (identical in both themes). */
  onOverlay: '#FFFFFF',
  scrim: 'rgba(16, 24, 40, 0.45)',
  overlay: 'rgba(0, 0, 0, 0.35)',
  inputBackground: '#FFFFFF',
  placeholder: '#747B87',
};

export const darkColors: Palette = {
  textPrimary: '#F2F4F7',
  textSecondary: '#A9B1BE',
  textMuted: '#8D95A3',
  textInverse: '#101318',
  border: '#6B7482',
  inputBorder: '#313846',
  divider: '#262C36',
  danger: BRAND_DANGER,
  onDanger: ON_DANGER,
  dangerText: '#FF8A8A',
  dangerBorder: '#FF8A8A',
  dangerSubtle: '#3A1F22',
  warning: '#F5A623',
  warningText: '#F5C26B',
  success: '#4CC38A',
  surface: '#181C23',
  surfaceMuted: '#20252E',
  surfaceRaised: '#1F242D',
  background: '#101318',
  brand: BRAND_PRIMARY,
  brandSoft: '#26224A',
  /** The violet fill is only ~3.4:1 on the dark cards; as text it is lifted to >= 4.5:1 on every Dark surface. */
  brandText: '#A99BFF',
  onBrand: '#FFFFFF',
  onOverlay: '#FFFFFF',
  scrim: 'rgba(0, 0, 0, 0.62)',
  overlay: 'rgba(0, 0, 0, 0.5)',
  inputBackground: '#181C23',
  placeholder: '#7D8592',
};

const palettes: Readonly<Record<ColorScheme, Palette>> = { light: lightColors, dark: darkColors };
let activeScheme: ColorScheme = 'light';
/** Bumped on every change - themedStyles rebuilds its StyleSheet when it sees a new one. */
let schemeVersion = 0;

/** Set by ThemeProvider before the tree renders with a new theme (and once at startup). Idempotent. */
export function setActiveColorScheme(scheme: ColorScheme): void {
  if (scheme !== activeScheme) {
    activeScheme = scheme;
    schemeVersion += 1;
  }
}

export function getActiveColorScheme(): ColorScheme {
  return activeScheme;
}

/** A read-through view of the active theme's value: property reads, key listing and spread all answer for the theme in force. */
function liveView<T extends object>(read: () => T): T {
  return new Proxy({} as T, {
    get: (_target, key) => (read() as Record<string | symbol, unknown>)[key],
    has: (_target, key) => key in read(),
    ownKeys: () => Reflect.ownKeys(read()),
    getOwnPropertyDescriptor: (_target, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(read(), key);
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
  });
}

export const colors: Palette = liveView(() => palettes[activeScheme]);

/**
 * StyleSheet.create for a theme: `factory` runs again (once) the first time the styles are read after the theme changed, so a screen's
 * `colors.surface` is evaluated for the theme in force instead of being frozen at import time. The result is read like any StyleSheet
 * (`styles.card`); a component re-renders on a theme change (ThemeProvider), which is when it reads the new one.
 */
export function themedStyles<T extends { [name: string]: ViewStyle | TextStyle | ImageStyle }>(factory: () => T): T {
  let builtFor = -1;
  let built: T = {} as T;
  const current = (): T => {
    if (builtFor !== schemeVersion) {
      built = StyleSheet.create(factory());
      builtFor = schemeVersion;
    }
    return built;
  };
  return liveView(current);
}


/**
 * Small fixed palette for category tiles (see CollectionsScreen) - deterministically picked from a
 * Collection's id (`id % categoryTilePalette.length`), never stored/user-chosen, so this stays
 * purely presentational (no new "category icon" domain feature). `icon` tints the folder glyph to
 * match its own `background`.
 */
export const categoryTilePalette = [
  { background: '#EAF1FE', icon: '#5478B0' }, // blue
  { background: '#FBEDEE', icon: '#B97278' }, // red
  { background: '#FBF3DE', icon: '#B0924E' }, // yellow
  { background: '#EAF5EE', icon: '#5C9878' }, // green
  { background: '#F1EBF7', icon: '#8A72A8' }, // purple
  { background: '#FBEEE6', icon: '#BD8863' }, // orange
] as const;

/**
 * The Collections screen's 2x2 filter (즐겨찾기 | 전체 / 내 컬렉션 | 공유 컬렉션): colors for the
 * selected / unselected STATE of a filter cell. The selected cell reuses the existing blue
 * Collection tile pair (categoryTilePalette[0], identical to the 'Blue' preset in
 * collectionColors.ts - the sky-blue card background) with its own darker icon tone as the label
 * color, so it reads as part of the same visual family; it never colors a Collection itself. The
 * unselected cell keeps a visible border and a dark-enough label so it reads as tappable, never as
 * disabled.
 */
export const collectionFilterColors = liveView(() =>
  activeScheme === 'dark'
    ? {
        selectedBackground: '#26224A',
        selectedBorder: '#A99BFF',
        selectedText: '#A99BFF',
        unselectedBackground: '#20252E',
        unselectedText: '#B4BBC7',
        unselectedBorder: '#3A4250',
      }
    : {
        selectedBackground: categoryTilePalette[0].background,
        /** The default blue folder glyph's stroke color - a crisp outline that keeps the soft fill. */
        selectedBorder: categoryTilePalette[0].icon,
        selectedText: categoryTilePalette[0].icon,
        unselectedBackground: '#F1F2F4',
        unselectedText: '#5F6368',
        unselectedBorder: '#D9DCE1',
      },
);

/**
 * Very soft card elevation (barely-there shadow, matching this round's "그림자는 약하게" - never a
 * heavy drop shadow) - spread as `...cardShadow` into a card container's style alongside its own
 * border/radius. `elevation` is Android's own shadow property; iOS uses the shadow* fields.
 */
export const cardShadow = {
  elevation: 1,
  shadowColor: '#000000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.06,
  shadowRadius: 3,
} as const;

export const minTouchTarget = 44;

/**
 * Forces LTR bidi isolation for technical/identifier text (URLs, email addresses, the Juple brand
 * name) that must never visually reorder inside an RTL (e.g. Arabic) layout - general user-facing
 * text/titles must NOT use this, since those should keep following the active locale's natural
 * reading direction. A plain object (not StyleSheet.create) so it composes into a style array
 * alongside a screen's own StyleSheet-created styles.
 */
export const ltrTextStyle = { writingDirection: 'ltr' } as const;
