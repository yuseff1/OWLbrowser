import React, { memo, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useTheme, radius, space, type as typeScale, motion, HIT, icon as iconTok } from '@/lib/theme';

/**
 * Glass for floating chrome only (address bar, menus, sheets). Recipe (glassyui + liquid-glass, kept subtle):
 * blur ~70 on iOS under a warm tint, a 1px rim, a 1px specular line on the top edge, and one soft two-layer shadow.
 * Android can't sample a WebView behind it, so it gets the same rim/highlight/shadow over a dense warm tint.
 */
export const Glass = memo(function Glass({ style, children, intensity = 70, rounded = radius.xl, shadow = true }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode; intensity?: number; rounded?: number; shadow?: boolean }) {
  const t = useTheme();
  const shape = { borderRadius: rounded, borderCurve: 'continuous' as const };
  return (
    <View style={[shape, shadow && { boxShadow: t.glass.shadow }, style]}>
      <View style={[StyleSheet.absoluteFill, shape, { overflow: 'hidden' }]} pointerEvents="none">
        {Platform.OS === 'ios' ? <BlurView tint={t.glass.blurTint} intensity={intensity} style={StyleSheet.absoluteFill} /> : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: Platform.OS === 'ios' ? t.glass.tint : t.glass.fallback }]} />
        <View style={[StyleSheet.absoluteFill, shape, { borderWidth: StyleSheet.hairlineWidth, borderColor: t.glass.rim }]} />
        <View style={[styles.specular, { left: rounded * 0.6, right: rounded * 0.6, backgroundColor: t.glass.highlight }]} />
      </View>
      {children}
    </View>
  );
});

export function haptic(kind: 'selection' | 'light' | 'medium' | 'success' | 'warning' = 'light') {
  if (Platform.OS === 'web') return;
  if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else if (kind === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  else if (kind === 'selection') Haptics.selectionAsync().catch(() => {});
  else Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

const APressable = Animated.createAnimatedComponent(Pressable);

type TapProps = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** haptic on press (off for list rows and text fields) */
  haptics?: boolean;
  label: string;
  /** scale for buttons/cards, highlight for list rows, opacity for bar glyphs */
  feedback?: 'scale' | 'highlight' | 'opacity';
};

/** Pressable with press-in feedback (≤110 ms), ≥44pt hit area via hitSlop, and an accessibility label. */
export const Tap = memo(function Tap({ style, haptics = true, label, onPress, children, feedback = 'scale', disabled, ...rest }: TapProps) {
  const t = useTheme();
  const v = useRef(new Animated.Value(0)).current;
  const to = (x: number) =>
    x
      ? Animated.timing(v, { toValue: 1, duration: motion.duration.press, easing: motion.ease, useNativeDriver: feedback !== 'highlight' }).start()
      : Animated.spring(v, { toValue: 0, ...motion.spring.snappy, useNativeDriver: feedback !== 'highlight' }).start();
  const anim =
    feedback === 'scale'
      ? { transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, motion.pressScale] }) }] }
      : feedback === 'opacity'
        ? { opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) }
        : { backgroundColor: v.interpolate({ inputRange: [0, 1], outputRange: [t.dark ? 'rgba(255,248,240,0)' : 'rgba(20,19,23,0)', t.dark ? 'rgba(255,248,240,0.06)' : 'rgba(20,19,23,0.05)'] }) };
  return (
    <APressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={6}
      disabled={disabled}
      onPressIn={() => to(1)}
      onPressOut={() => to(0)}
      onPress={(e) => { if (haptics) haptic('light'); onPress?.(e); }}
      style={[style, anim as any, disabled && styles.disabled]}
      {...rest}
    >
      {children as React.ReactNode}
    </APressable>
  );
});

/** Round icon button. Glyph 20–24, target always ≥ 44. */
export const IconButton = memo(function IconButton({ icon, label, onPress, onLongPress, disabled, size = HIT, tint }: { icon: React.ReactNode; label: string; onPress?: () => void; onLongPress?: () => void; disabled?: boolean; size?: number; tint?: string }) {
  const slop = Math.max(0, (HIT - size) / 2);
  return (
    <Tap label={label} onPress={onPress} onLongPress={onLongPress} disabled={disabled} feedback={tint ? 'scale' : 'opacity'} hitSlop={slop + 4} style={[styles.iconBtn, { width: size, height: size, borderRadius: size / 2 }, tint ? { backgroundColor: tint } : null]}>
      {icon}
    </Tap>
  );
});

type Kind = keyof typeof typeScale | 'h2' | 'small' | 'tiny' | 'label';
const ALIAS: Record<string, keyof typeof typeScale> = { h2: 'title', small: 'footnote', tiny: 'caption', label: 'headline' };

export function T({ style, kind = 'body', color, ...rest }: TextProps & { kind?: Kind; color?: string }) {
  const t = useTheme();
  const k = (ALIAS[kind] || kind) as keyof typeof typeScale;
  const muted = k === 'footnote' || k === 'caption' || k === 'section';
  return <Text {...rest} style={[typeScale[k], { color: color ?? (muted ? t.ink2 : t.ink) }, style]} />;
}

/** Grouped list (Revolut-style): sentence-case header, one flat rounded surface, inset hairlines. */
export function Section({ title, children, footer }: { title?: string; children: React.ReactNode; footer?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: space.xl }}>
      {title ? <T kind="section" style={{ marginLeft: space.xxs, marginBottom: space.xs }}>{title}</T> : null}
      <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden' }}>{children}</View>
      {footer ? <T kind="footnote" color={t.ink3} style={{ marginHorizontal: space.xxs, marginTop: space.xs }}>{footer}</T> : null}
    </View>
  );
}

/** Icon in a soft circle: the tile every list row leads with. */
export function IconWell({ children, tint, size = 36 }: { children: React.ReactNode; tint?: string; size?: number }) {
  const t = useTheme();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint ?? t.surface2, alignItems: 'center', justifyContent: 'center' }}>{children}</View>;
}

export function Row({ icon, title, subtitle, right, onPress, danger, last }: { icon?: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; danger?: boolean; last?: boolean }) {
  const t = useTheme();
  const body = (
    <View style={styles.row}>
      {icon ? <IconWell tint={danger ? 'transparent' : undefined}>{icon}</IconWell> : null}
      <View style={[styles.rowText, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T numberOfLines={1} color={danger ? t.danger : t.ink}>{title}</T>
          {subtitle ? <T kind="footnote" numberOfLines={1}>{subtitle}</T> : null}
        </View>
        {right}
      </View>
    </View>
  );
  return onPress ? <Tap label={title} onPress={onPress} haptics={false} feedback="highlight">{body}</Tap> : body;
}

export function Button({ title, onPress, kind = 'primary', icon, disabled, style }: { title: string; onPress?: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; icon?: React.ReactNode; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accentFill : kind === 'secondary' ? t.surface2 : 'transparent';
  const fg = kind === 'primary' ? t.accentInk : kind === 'danger' ? t.danger : kind === 'ghost' ? t.accent : t.ink;
  return (
    <Tap label={title} onPress={onPress} disabled={disabled} style={[styles.btn, { backgroundColor: bg }, style]}>
      {icon}
      <Text style={[typeScale.headline, { color: fg, fontSize: 16 }]}>{title}</Text>
    </Tap>
  );
}

/** Empty state: one short line, nothing else. */
export function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <T kind="callout" color={t.ink3} style={{ textAlign: 'center', marginTop: 96 }}>{text}</T>;
}

/** Recessed search/text field used by list screens. */
export const fieldStyle = (t: ReturnType<typeof useTheme>) => ({ height: HIT, borderRadius: radius.sm, paddingHorizontal: space.sm + 2, fontSize: 16, backgroundColor: t.surface2, color: t.ink });

export const ICON = iconTok;

const styles = StyleSheet.create({
  specular: { position: 'absolute', top: 0, height: StyleSheet.hairlineWidth * 2, opacity: 0.9, borderRadius: 1 },
  disabled: { opacity: 0.32 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.md, gap: space.sm, minHeight: 60 },
  rowText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'stretch', paddingRight: space.md, paddingVertical: space.sm, minHeight: 60 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, height: 48, borderRadius: radius.pill, paddingHorizontal: space.xl },
});
