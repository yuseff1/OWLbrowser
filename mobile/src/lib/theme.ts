import { Easing, Platform, useColorScheme } from 'react-native';
import { appStore } from '@/state/app';
import { useStore } from './store';

/**
 * OWL mobile design tokens. Spec and reasoning: docs/mobile-design.md.
 * Revolut-style restraint: warm neutrals carry the app, amber (#E8A317) is the only accent and is spent on the
 * primary action, the active state and progress. No purple, no gradients, no neon. Content surfaces are flat;
 * only floating chrome (address bar, menus, sheets) is glass.
 */
export type Theme = {
  dark: boolean;
  /** screen background */
  ground: string;
  /** grouped card / list surface */
  surface: string;
  /** recessed fill: inputs, icon wells, segmented track */
  surface2: string;
  ink: string;
  /** secondary text (≥ 4.5:1 on ground) */
  ink2: string;
  /** tertiary: placeholders, chevrons, disabled glyphs */
  ink3: string;
  /** hairline separators */
  line: string;
  /** accent as text / icon colour (contrast-safe per theme) */
  accent: string;
  /** accent as a fill (buttons, progress, selected) */
  accentFill: string;
  accentSoft: string;
  /** text on accentFill */
  accentInk: string;
  danger: string;
  success: string;
  warn: string;
  scrim: string;
  glass: {
    /** tint laid over the iOS material blur (the material already darkens/lightens) */
    tint: string;
    /**
     * tint laid over the Android blur. expo-blur's native overlay (`androidBlurTint`, alpha = 0.55·intensity dark /
     * 0.78·intensity light) sits under it; together `ink` keeps ≥ 4.5:1 even over a pure white (dark theme) / black
     * (light theme) page: measured 4.9:1 / 10.3:1 at intensity 90.
     */
    tintAndroid: string;
    androidBlurTint: 'systemUltraThinMaterialDark' | 'light';
    /** secondary text / glyphs inside glass (placeholder, lock): ink at 78 %, ≥ 4.5:1 on the capsule in the worst case */
    ink2: string;
    /** opaque-ish stand-in where nothing is blurred (Android < 12, blur switched off, screens without a blur target) */
    fallback: string;
    /** 1px rim around the shape */
    rim: string;
    /** 1px specular line along the top edge */
    highlight: string;
    /** soft sheen fading down from the top edge (the "liquid" in liquid glass) */
    sheen: string;
    /** recessed fill for the capsule / wells that sit inside glass */
    well: string;
    /** elevation for floating glass */
    shadow: string;
    blurTint: 'systemChromeMaterialDark' | 'systemChromeMaterialLight';
  };
};

const dark: Theme = {
  dark: true,
  ground: '#0E0D0C',
  surface: '#1A1917',
  surface2: '#252320',
  ink: '#F5F2EE',
  ink2: '#A39C94',
  ink3: '#6E6862',
  line: 'rgba(255,248,240,0.07)',
  accent: '#E8A317',
  accentFill: '#E8A317',
  accentSoft: 'rgba(232,163,23,0.14)',
  accentInk: '#141317',
  danger: '#F2645A',
  success: '#3CC48A',
  warn: '#E8A317',
  scrim: 'rgba(0,0,0,0.45)',
  glass: {
    tint: 'rgba(24,22,20,0.38)',
    tintAndroid: 'rgba(22,20,18,0.42)',
    androidBlurTint: 'systemUltraThinMaterialDark',
    ink2: 'rgba(245,242,238,0.78)',
    fallback: 'rgba(28,26,24,0.96)',
    rim: 'rgba(255,248,240,0.12)',
    highlight: 'rgba(255,248,240,0.24)',
    sheen: 'rgba(255,248,240,0.07)',
    well: 'rgba(0,0,0,0.24)',
    shadow: '0px 1px 2px rgba(0,0,0,0.25), 0px 14px 36px -10px rgba(0,0,0,0.55)',
    blurTint: 'systemChromeMaterialDark',
  },
};

const light: Theme = {
  dark: false,
  ground: '#F6F5F2',
  surface: '#FFFFFF',
  surface2: '#EDEBE7',
  ink: '#141317',
  ink2: '#5E5953',
  ink3: '#9A948D',
  line: 'rgba(20,19,23,0.07)',
  accent: '#9A6400',
  accentFill: '#E8A317',
  accentSoft: 'rgba(232,163,23,0.16)',
  accentInk: '#141317',
  danger: '#D93B2E',
  success: '#12A15E',
  warn: '#9A6400',
  scrim: 'rgba(20,19,23,0.18)',
  glass: {
    tint: 'rgba(252,250,246,0.4)',
    tintAndroid: 'rgba(252,250,246,0.25)',
    androidBlurTint: 'light',
    ink2: 'rgba(20,19,23,0.78)',
    fallback: 'rgba(252,251,249,0.97)',
    rim: 'rgba(20,19,23,0.08)',
    highlight: 'rgba(255,255,255,0.9)',
    sheen: 'rgba(255,255,255,0.32)',
    well: 'rgba(20,19,23,0.05)',
    shadow: '0px 1px 2px rgba(0,0,0,0.06), 0px 14px 36px -12px rgba(0,0,0,0.2)',
    blurTint: 'systemChromeMaterialLight',
  },
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const pref = useStore(appStore, (s) => s.settings.theme);
  const isDark = pref === 'system' ? scheme !== 'light' : pref === 'dark';
  return isDark ? dark : light;
}

/** 4pt grid. Gutter is 16, cards pad 16, sections are 24 apart. */
export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48 } as const;

/** One radius scale: rows/inputs 12, cards 20, sheets 28, actions are pills. */
export const radius = { xs: 8, sm: 12, md: 16, lg: 20, xl: 24, sheet: 28, pill: 999 } as const;

/** Type ramp (system grotesk). One display size per screen, tight tracking on large sizes. */
export const type = {
  display: { fontSize: 32, lineHeight: 36, fontWeight: '600' as const, letterSpacing: -0.9 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '600' as const, letterSpacing: -0.4 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' as const, letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const, letterSpacing: -0.1 },
  callout: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const, letterSpacing: -0.1 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' as const, letterSpacing: 0.1 },
  section: { fontSize: 13, lineHeight: 18, fontWeight: '600' as const, letterSpacing: 0 },
} as const;

/** Lucide: one stroke weight everywhere, three sizes. */
export const icon = { stroke: 1.75, sm: 18, md: 20, lg: 24 } as const;

/** Minimum touch target. */
export const HIT = 44;

/**
 * Motion vocabulary (RN Animated, native driver). Springs for anything a finger moved or that
 * enters/leaves (sheets, bar lift, tab switcher); short strong ease-out timing for the rest.
 *  - snappy: dampingRatio ≈ 0.8, press release / chips
 *  - sheet:  dampingRatio ≈ 0.85, sheets and menus
 *  - smooth: dampingRatio = 1, keyboard lift, no overshoot
 */
export const motion = {
  spring: {
    snappy: { damping: 28, stiffness: 340, mass: 1 },
    sheet: { damping: 30, stiffness: 300, mass: 1 },
    smooth: { damping: 36, stiffness: 320, mass: 1 },
    /** liquid-glass squeeze release: dampingRatio ≈ 0.36, one visible wobble */
    jelly: { damping: 14, stiffness: 420, mass: 0.9 },
  },
  duration: { press: 110, fast: 160, base: 220, slow: 280 },
  ease: Easing.bezier(0.23, 1, 0.32, 1),
  pressScale: 0.97,
} as const;

export const isIOS = Platform.OS === 'ios';
