import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { createStore, useStore } from '@/lib/store';
import { useTheme, radius, space, motion } from '@/lib/theme';
import { Glass, T, Tap } from './ui';

type ToastAction = { label: string; run: () => void };
type ToastState = { id: number; text: string; action?: ToastAction } | null;

const toastStore = createStore<{ toast: ToastState }>({ toast: null });
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

/** One-line confirmation above the dock ("Opened in new tab · Switch"). Replaces any toast already showing. */
export function showToast(text: string, action?: ToastAction, ms = 3200) {
  if (timer) clearTimeout(timer);
  const id = ++seq;
  toastStore.set({ toast: { id, text, action } });
  timer = setTimeout(() => { if (toastStore.get().toast?.id === id) toastStore.set({ toast: null }); }, ms);
}

export function Toast({ offset, position = 'bottom' }: { offset: number; position?: 'top' | 'bottom' }) {
  const t = useTheme();
  const toast = useStore(toastStore, (s) => s.toast);
  const [shown, setShown] = useState<ToastState>(toast);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (toast) {
      setShown(toast);
      Animated.spring(a, { toValue: 1, ...motion.spring.snappy, useNativeDriver: true }).start();
    } else {
      Animated.timing(a, { toValue: 0, duration: motion.duration.fast, easing: motion.ease, useNativeDriver: true }).start(({ finished }) => { if (finished) setShown(null); });
    }
  }, [toast, a]);
  if (!shown) return null;
  const top = position === 'top';
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [top ? -12 : 12, 0] });
  return (
    <View pointerEvents="box-none" style={[styles.wrap, top ? { top: offset } : { bottom: offset }]}>
      <Animated.View style={{ opacity: a, transform: [{ translateY }] }}>
        <Glass rounded={radius.pill} intensity={100} style={[styles.pill, !shown.action && { paddingRight: space.md }]}>
          <T kind="callout" numberOfLines={1} style={{ flexShrink: 1 }}>{shown.text}</T>
          {shown.action ? (
            <Tap label={shown.action.label} feedback="opacity" style={styles.action} onPress={() => { shown.action?.run(); toastStore.set({ toast: null }); }}>
              <T kind="callout" style={{ fontWeight: '600' }} color={t.accent}>{shown.action.label}</T>
            </Tap>
          ) : null}
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.md },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44, paddingLeft: space.md, paddingRight: space.xs, maxWidth: 420 },
  action: { height: 44, justifyContent: 'center', paddingHorizontal: space.sm },
});
