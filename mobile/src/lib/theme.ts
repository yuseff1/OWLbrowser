import { useColorScheme, Platform } from 'react-native';
import { appStore } from '@/state/app';
import { useStore } from './store';

export type Theme = {
  dark: boolean;
  ground: string;
  surface: string;
  surface2: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  accent: string;
  accentSoft: string;
  accentInk: string;
  danger: string;
  success: string;
  warn: string;
  glassFallback: string;
  glassBorder: string;
  neuBg: string;
  neuLight: string;
  neuDark: string;
  blurTint: 'systemChromeMaterialDark' | 'systemChromeMaterialLight';
};

// Warm near-black dark theme + soft paper light theme, OWL amber accent (brand: ink #141317 on amber #E8A317).
// ink/ink2 on ground ≥ 4.5:1; accent text ≥ 4.5:1 on ground in both themes (darker amber in light mode).
const dark: Theme = {
  dark: true,
  ground: '#12110F',
  surface: '#1B1916',
  surface2: '#24211D',
  ink: '#F3EEE8',
  ink2: '#B3AAA0',
  ink3: '#7A7269',
  line: 'rgba(255,240,225,0.08)',
  accent: '#E8A317',
  accentSoft: 'rgba(232,163,23,0.16)',
  accentInk: '#141317',
  danger: '#FF6B5E',
  success: '#3DD68C',
  warn: '#FFB547',
  glassFallback: Platform.OS === 'android' ? 'rgba(30,28,25,0.95)' : 'rgba(30,28,25,0.45)',
  glassBorder: 'rgba(255,245,235,0.10)',
  neuBg: '#1B1916',
  neuLight: 'rgba(255,240,225,0.06)',
  neuDark: '#000000',
  blurTint: 'systemChromeMaterialDark',
};

const light: Theme = {
  dark: false,
  ground: '#F5F3EF',
  surface: '#FFFFFF',
  surface2: '#EFECE7',
  ink: '#1C1A17',
  ink2: '#5C5650',
  ink3: '#8C857D',
  line: 'rgba(30,20,10,0.08)',
  accent: '#9A6400',
  accentSoft: 'rgba(232,163,23,0.18)',
  accentInk: '#FFFFFF',
  danger: '#D93B2E',
  success: '#12A15E',
  warn: '#B86E00',
  glassFallback: Platform.OS === 'android' ? 'rgba(250,248,245,0.97)' : 'rgba(250,248,245,0.55)',
  glassBorder: 'rgba(255,255,255,0.75)',
  neuBg: '#EFECE7',
  neuLight: 'rgba(255,255,255,0.95)',
  neuDark: '#A89F94',
  blurTint: 'systemChromeMaterialLight',
};

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const pref = useStore(appStore, (s) => s.settings.theme);
  const isDark = pref === 'system' ? scheme !== 'light' : pref === 'dark';
  return isDark ? dark : light;
}

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const type = { title: 30, h2: 20, body: 16, small: 13, tiny: 11 } as const;
