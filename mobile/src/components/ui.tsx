import React, { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type TextProps, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useTheme, radius } from '@/lib/theme';

/** Liquid-glass surface: real blur on iOS, translucent fill on Android (WebView content can't be blurred there). */
export const Glass = memo(function Glass({ style, children, intensity = 70, rounded = radius.xl }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode; intensity?: number; rounded?: number }) {
  const t = useTheme();
  return (
    <View style={[{ borderRadius: rounded, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: t.glassBorder }, style]}>
      {Platform.OS === 'ios' ? (
        <BlurView tint={t.blurTint} intensity={intensity} style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: t.glassFallback }]} />
      {children}
    </View>
  );
});

export function haptic(kind: 'light' | 'medium' | 'success' | 'warning' = 'light') {
  if (Platform.OS === 'web') return;
  if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else if (kind === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  else Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

type TapProps = PressableProps & { style?: StyleProp<ViewStyle>; haptics?: boolean; label: string };

/** Pressable with visible feedback, ≥44pt hit area and an accessibility label (icon buttons must have one). */
export const Tap = memo(function Tap({ style, haptics = true, label, onPress, children, ...rest }: TapProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={(e) => { if (haptics) haptic('light'); onPress?.(e); }}
      style={({ pressed }) => [style, pressed && styles.pressed, rest.disabled && styles.disabled]}
      {...rest}
    >
      {children as React.ReactNode}
    </Pressable>
  );
});

export const IconButton = memo(function IconButton({ icon, label, onPress, disabled, size = 44, tint }: { icon: React.ReactNode; label: string; onPress?: () => void; disabled?: boolean; size?: number; tint?: string }) {
  return (
    <Tap label={label} onPress={onPress} disabled={disabled} style={[styles.iconBtn, { width: size, height: size, borderRadius: size / 2 }, tint ? { backgroundColor: tint } : null]}>
      {icon}
    </Tap>
  );
});

export function T({ style, kind = 'body', color, ...rest }: TextProps & { kind?: 'title' | 'h2' | 'body' | 'small' | 'tiny' | 'label'; color?: string }) {
  const t = useTheme();
  const k = textKinds[kind];
  return <Text {...rest} style={[k, { color: color ?? (kind === 'small' || kind === 'tiny' ? t.ink2 : t.ink) }, style]} />;
}

const textKinds = StyleSheet.create({
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  h2: { fontSize: 20, fontWeight: '600', letterSpacing: -0.3 },
  body: { fontSize: 16, lineHeight: 22 },
  small: { fontSize: 13, lineHeight: 18 },
  tiny: { fontSize: 11, lineHeight: 14, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  label: { fontSize: 15, fontWeight: '600' },
});

/** Grouped list section (iOS Settings style). */
export function Section({ title, children, footer }: { title?: string; children: React.ReactNode; footer?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: 22 }}>
      {title ? <T kind="tiny" color={t.ink3} style={{ marginLeft: 16, marginBottom: 6 }}>{title}</T> : null}
      <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: t.line }}>{children}</View>
      {footer ? <T kind="small" color={t.ink3} style={{ marginHorizontal: 16, marginTop: 6 }}>{footer}</T> : null}
    </View>
  );
}

export function Row({ icon, title, subtitle, right, onPress, danger, last }: { icon?: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; danger?: boolean; last?: boolean }) {
  const t = useTheme();
  const body = (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T numberOfLines={1} style={{ fontSize: 16 }} color={danger ? t.danger : t.ink}>{title}</T>
        {subtitle ? <T kind="small" numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? <Tap label={title} onPress={onPress} haptics={false}>{body}</Tap> : body;
}

export function Button({ title, onPress, kind = 'primary', icon, disabled, style }: { title: string; onPress?: () => void; kind?: 'primary' | 'secondary' | 'danger' | 'ghost'; icon?: React.ReactNode; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : kind === 'secondary' ? t.surface2 : 'transparent';
  const fg = kind === 'primary' ? t.accentInk : kind === 'danger' ? '#fff' : kind === 'ghost' ? t.accent : t.ink;
  return (
    <Tap label={title} onPress={onPress} disabled={disabled} style={[styles.btn, { backgroundColor: bg }, style]}>
      {icon}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{title}</Text>
    </Tap>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.62, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.35 },
  iconBtn: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  rowIcon: { width: 28, alignItems: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: radius.pill, paddingHorizontal: 20 },
});
