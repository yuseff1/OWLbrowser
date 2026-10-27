import React, { createContext, memo, useCallback, useContext, useRef, type RefObject } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type PressableProps, type StyleProp, type TextProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useTheme, radius, space, type as typeScale, motion, HIT, icon as iconTok } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { appStore } from '@/state/app';

/**
 * Android can only blur what sits inside a `BlurTargetView` (expo-blur 58 / Dimezis BlurView 3, RenderNode based).
 * The browser screen wraps the page (WebViews + Home) in one and publishes its ref here; glass outside that
 * screen has no target and falls back to the dense tint.
 */
export const BlurTargetContext = createContext<RefObject<React.ComponentRef<typeof View> | null> | null>(null);

/**
 * Real blur only where it is cheap and correct: iOS, and Android 12+ (RenderNode). Below 12 expo-blur 58.0.5 still
 * runs the old software blur even with `dimezisBlurViewSdk31Plus` (expo/expo#52042, crashes on Android 9), so we never
 * hand it a target there.
 */
export const LIVE_BLUR = Platform.OS === 'ios' || (Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version >= 31);

/** Whether glass on the browser screen is actually blurring the page right now (setting on + platform can). */
export function useLiveBlur() {
  const on = useStore(appStore, (s) => s.settings.glassBlur !== false);
  return on && LIVE_BLUR;
}

/**
 * Glass for floating chrome only (address dock, menus, sheets). Recipe (glassyui + liquid-glass):
 * strong blur of what is behind (iOS BlurView; Android Dimezis blur of the BlurTargetView), a light warm tint dense
 * enough for ≥ 4.5:1 text, a sheen fading down from the top, a 1px rim, a 1px specular line on the top edge and one
 * soft two-layer shadow. Without a live blur it is the same stack over a dense warm tint.
 */
export const Glass = memo(function Glass({ style, children, intensity = 90, rounded = radius.xl, shadow = true, live = true }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode; intensity?: number; rounded?: number; shadow?: boolean; live?: boolean }) {
  const t = useTheme();
  const target = useContext(BlurTargetContext);
  const liveBlur = useLiveBlur();
  const blur = live && liveBlur && (Platform.OS === 'ios' || !!target);
  const flat = StyleSheet.flatten(style) || {};
  // Corners can be overridden per side (RunSheet squares its bottom); the blur and clip layers follow them.
  const corners = {
    borderRadius: rounded,
    borderTopLeftRadius: flat.borderTopLeftRadius,
    borderTopRightRadius: flat.borderTopRightRadius,
    borderBottomLeftRadius: flat.borderBottomLeftRadius,
    borderBottomRightRadius: flat.borderBottomRightRadius,
    borderCurve: 'continuous' as const,
  };
  return (
    <View style={[corners, shadow && { boxShadow: t.glass.shadow }, style]}>
      <View style={[StyleSheet.absoluteFill, corners, { overflow: 'hidden' }]} pointerEvents="none">
        {blur ? (
          <BlurView
            tint={Platform.OS === 'ios' ? t.glass.blurTint : t.glass.androidBlurTint}
            intensity={intensity}
            blurMethod="dimezisBlurViewSdk31Plus"
            blurReductionFactor={3}
            blurTarget={Platform.OS === 'android' ? target ?? undefined : undefined}
            style={[StyleSheet.absoluteFill, corners]}
          />
        ) : null}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: blur ? (Platform.OS === 'ios' ? t.glass.tint : t.glass.tintAndroid) : t.glass.fallback }]} />
        <LinearGradient colors={[t.glass.sheen, 'transparent']} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} style={styles.sheen} />
        <View style={[StyleSheet.absoluteFill, corners, { borderWidth: 1, borderColor: t.glass.rim }]} />
        <View style={[styles.specular, { left: rounded * 0.6, right: rounded * 0.6, backgroundColor: t.glass.highlight }]} />
      </View>
      {children}
    </View>
  );
});

/**
 * "Squeezy" liquid-glass body (iOS 26 style), RN Animated + native driver only. Press anywhere inside: the glass
 * squashes (wider, shorter); drag: it stretches along the drag and follows the finger a little (rubber band);
 * release: it wobbles back on the `jelly` spring. Uses raw touch events, so the buttons inside keep their own
 * responders and nothing is stolen from them.
 */
export function useSqueeze({ amount = 1, origin = 'center' as 'center' | 'top' | 'bottom' } = {}) {
  const press = useRef(new Animated.Value(0)).current;
  const dx = useRef(new Animated.Value(0)).current;
  const dy = useRef(new Animated.Value(0)).current;
  const start = useRef<{ x: number; y: number } | null>(null);
  const spring = (v: Animated.Value, to: number, cfg = motion.spring.jelly) => Animated.spring(v, { toValue: to, ...cfg, useNativeDriver: true }).start();

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    if (e.nativeEvent.touches && e.nativeEvent.touches.length > 1) return;
    start.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    Animated.timing(press, { toValue: 1, duration: motion.duration.press, easing: motion.ease, useNativeDriver: true }).start();
  }, [press]);
  const onTouchMove = useCallback((e: GestureResponderEvent) => {
    const s = start.current;
    if (!s) return;
    // rubber band: soft, saturating (x/(1+|x|/k))
    const rb = (d: number, k: number) => d / (1 + Math.abs(d) / k);
    dx.setValue(rb(e.nativeEvent.pageX - s.x, 90));
    dy.setValue(rb(e.nativeEvent.pageY - s.y, 70));
  }, [dx, dy]);
  const onTouchEnd = useCallback(() => {
    start.current = null;
    spring(press, 0);
    spring(dx, 0);
    spring(dy, 0);
  }, [press, dx, dy]);

  const k = amount;
  const absX = dx.interpolate({ inputRange: [-90, 0, 90], outputRange: [1, 0, 1], extrapolate: 'clamp' });
  const absY = dy.interpolate({ inputRange: [-70, 0, 70], outputRange: [1, 0, 1], extrapolate: 'clamp' });
  const scaleX = Animated.add(
    press.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + 0.022 * k] }),
    Animated.subtract(Animated.multiply(absX, 0.05 * k), Animated.multiply(absY, 0.02 * k)),
  );
  const scaleY = Animated.add(
    press.interpolate({ inputRange: [0, 1], outputRange: [1, 1 - 0.045 * k] }),
    Animated.subtract(Animated.multiply(absY, 0.05 * k), Animated.multiply(absX, 0.025 * k)),
  );
  const translateX = Animated.multiply(dx, 0.14 * k);
  const translateY = Animated.multiply(dy, 0.1 * k);
  const transformOrigin = origin === 'top' ? 'top' : origin === 'bottom' ? 'bottom' : 'center';
  return {
    handlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd },
    style: { transformOrigin, transform: [{ translateX }, { translateY }, { scaleX }, { scaleY }] },
  };
}

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
  specular: { position: 'absolute', top: 1, height: 1, borderRadius: 1 },
  sheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '55%' },
  disabled: { opacity: 0.32 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: space.md, gap: space.sm, minHeight: 60 },
  rowText: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, alignSelf: 'stretch', paddingRight: space.md, paddingVertical: space.sm, minHeight: 60 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, height: 48, borderRadius: radius.pill, paddingHorizontal: space.xl },
});
