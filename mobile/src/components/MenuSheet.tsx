import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Platform, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Icon } from './Icon';
import * as Clipboard from 'expo-clipboard';
import { useTheme, radius, space, icon, motion } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser, browserStore, webviews } from '@/state/browser';
import { readerStore } from '@/state/reader';
import { READ_SCRIPT } from '@/lib/agent/page-scripts';
import { Glass, IconButton, IconWell, T, Tap, haptic, useSqueeze } from './ui';
import { openFind } from './FindBar';
import { showToast } from './Toast';
import { hostOf } from '@/lib/url';
import { TEXT_SIZES } from '@/lib/page-tools';

type Item = { key: string; label: string; icon: React.ReactNode; onPress: () => void; active?: boolean; disabled?: boolean; right?: React.ReactNode };

/**
 * Page menu: bookmark, reader, desktop site, new/private tab, and the app's own screens.
 * An in-screen overlay rather than a RN <Modal>: a Modal is a separate Android window, and the glass blur can't reach
 * the page from there (expo/expo#44165). Opens from the dock's edge: up from the bottom, down from the top.
 */
export function MenuSheet({ visible, onClose, position = 'bottom' }: { visible: boolean; onClose: () => void; position?: 'top' | 'bottom' }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tab = useStore(browserStore, (s) => s.tabs.find((x) => x.id === s.activeId) || s.tabs[0]);
  const bookmarked = useStore(appStore, (s) => s.bookmarks.some((b) => b.url === tab.url));
  const { desktopMode, adblock } = useStore(appStore, (s) => ({ desktopMode: s.settings.desktopMode, adblock: s.settings.adblock }));
  const host = hostOf(tab.url);
  const zoom = useStore(appStore, (s) => (host && s.settings.siteZoom?.[host]) || 100);
  const stepZoom = (dir: 1 | -1) => {
    const next = dir > 0 ? TEXT_SIZES.find((z) => z > zoom) : [...TEXT_SIZES].reverse().find((z) => z < zoom);
    if (next && next !== zoom) { haptic('selection'); app.setSiteZoom(host, next); }
  };

  // Mounted while visible or animating out; slides up on a spring, leaves faster than it came.
  const [shown, setShown] = useState(visible);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      setShown(true);
      Animated.spring(a, { toValue: 1, ...motion.spring.sheet, useNativeDriver: true }).start();
    } else {
      Animated.timing(a, { toValue: 0, duration: motion.duration.fast, easing: motion.ease, useNativeDriver: true }).start(({ finished }) => { if (finished) setShown(false); });
    }
  }, [visible, a]);

  // Android back closes the menu first (what Modal's onRequestClose used to do).
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);
  const top = position === 'top';
  const squeeze = useSqueeze({ amount: 0.6, origin: top ? 'top' : 'bottom' });

  const nav = (path: string) => { onClose(); setTimeout(() => router.push(path as any), 60); };

  const openReader = async () => {
    onClose();
    readerStore.set({ loading: true, article: null, error: '' });
    router.push('/reader');
    try {
      const a = await webviews.eval<any>(tab.id, READ_SCRIPT, 15000);
      readerStore.set({ loading: false, article: a });
    } catch (e: any) {
      readerStore.set({ loading: false, error: e?.message || 'Could not read this page.' });
    }
  };

  const I = { size: icon.md, color: t.ink };
  const quick: Item[] = [
    { key: 'bm', label: bookmarked ? 'Saved' : 'Save', icon: <Icon name="star" {...I} color={bookmarked ? t.accent : t.ink} filled={bookmarked} />, onPress: () => { haptic('success'); app.toggleBookmark(tab.url, tab.title); }, disabled: !tab.url, active: bookmarked },
    { key: 'reader', label: 'Reader', icon: <Icon name="reading-mode-mobile" {...I} />, onPress: openReader, disabled: !tab.url },
    { key: 'desk', label: 'Desktop', icon: <Icon name="desktop" {...I} color={desktopMode ? t.accent : t.ink} filled={desktopMode} />, onPress: () => { app.patchSettings({ desktopMode: !desktopMode }); onClose(); }, active: desktopMode },
    { key: 'copy', label: 'Copy', icon: <Icon name="copy" {...I} />, onPress: async () => { await Clipboard.setStringAsync(tab.url); haptic('success'); onClose(); showToast('Link copied'); }, disabled: !tab.url },
  ];

  const zoomControl = (
    <View style={styles.stepper}>
      <IconButton size={36} label="Smaller text" disabled={zoom <= TEXT_SIZES[0]} icon={<Icon name="font-decrease" size={icon.md} color={t.ink} />} onPress={() => stepZoom(-1)} />
      <T kind="callout" style={styles.zoomNum} color={zoom === 100 ? t.ink2 : t.accent}>{zoom}%</T>
      <IconButton size={36} label="Larger text" disabled={zoom >= TEXT_SIZES[TEXT_SIZES.length - 1]} icon={<Icon name="font-increase" size={icon.md} color={t.ink} />} onPress={() => stepZoom(1)} />
    </View>
  );

  const rows: Item[] = [
    ...(tab.url ? [
      { key: 'find', label: 'Find in page', icon: <Icon name="search" {...I} />, onPress: () => { onClose(); setTimeout(openFind, 120); } },
      { key: 'zoom', label: 'Text size', icon: <Icon name="text-font-size" {...I} />, onPress: () => { if (zoom !== 100) { haptic('selection'); app.setSiteZoom(host, 100); } }, right: zoomControl },
    ] : []),
    { key: 'new', label: 'New tab', icon: <Icon name="add" {...I} />, onPress: () => { haptic('light'); browser.newTab(); onClose(); } },
    { key: 'priv', label: 'New private tab', icon: <Icon name="tab-in-private" {...I} />, onPress: () => { haptic('light'); browser.newTab('', { private: true }); onClose(); } },
    { key: 'bms', label: 'Bookmarks', icon: <Icon name="bookmark" {...I} />, onPress: () => nav('/bookmarks') },
    { key: 'hist', label: 'History', icon: <Icon name="history" {...I} />, onPress: () => nav('/history') },
    { key: 'comp', label: 'Companions', icon: <Icon name="bot" {...I} />, onPress: () => nav('/companions') },
    { key: 'mem', label: 'Memory', icon: <Icon name="brain-circuit" {...I} />, onPress: () => nav('/memory') },
    { key: 'prof', label: 'Profiles', icon: <Icon name="people" {...I} />, onPress: () => nav('/profiles') },
    { key: 'ad', label: 'Block trackers', icon: <Icon name="shield-checkmark" {...I} />, onPress: () => app.patchSettings({ adblock: !adblock }), right: <Switch value={adblock} onValueChange={(v) => app.patchSettings({ adblock: v })} trackColor={{ true: t.accentFill, false: t.surface2 }} thumbColor="#FFFFFF" /> },
    { key: 'set', label: 'Settings', icon: <Icon name="settings" {...I} />, onPress: () => nav('/settings') },
  ];

  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [top ? -40 : 40, 0] });
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  return (
    shown ? (
      <View style={StyleSheet.absoluteFill} pointerEvents={visible ? 'auto' : 'none'}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim, opacity: a }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
        </Animated.View>
        <Animated.View
          style={[styles.sheetWrap, top ? { top: insets.top + space.xs } : { bottom: 0, paddingBottom: insets.bottom + space.xs }, { opacity: a, transformOrigin: top ? 'top' : 'bottom', transform: [{ translateY }, { scale }] }]}
          pointerEvents="box-none"
        >
          <Animated.View style={squeeze.style} {...squeeze.handlers}>
            <Glass rounded={radius.sheet} intensity={95} style={styles.sheet}>
              <View style={styles.quick}>
                {quick.map((q) => (
                  <Tap key={q.key} label={q.label} onPress={q.onPress} disabled={q.disabled} style={styles.quickBtn}>
                    <IconWell size={48} tint={q.active ? t.accentSoft : t.glass.well}>{q.icon}</IconWell>
                    <T kind="caption" numberOfLines={1} color={t.ink}>{q.label}</T>
                  </Tap>
                ))}
              </View>
              <View style={[styles.divider, { backgroundColor: t.line }]} />
              <ScrollView style={{ maxHeight: 440 }} bounces={false}>
                {rows.map((r) => (
                  <Tap key={r.key} label={r.label} onPress={r.onPress} haptics={false} feedback="highlight" style={styles.row}>
                    <View style={styles.rowIcon}>{r.icon}</View>
                    <T style={{ flex: 1 }}>{r.label}</T>
                    {r.right}
                  </Tap>
                ))}
              </ScrollView>
            </Glass>
          </Animated.View>
        </Animated.View>
      </View>
    ) : null
  );
}

const styles = StyleSheet.create({
  sheetWrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.xs },
  sheet: { paddingTop: space.md, paddingBottom: space.xs },
  quick: { flexDirection: 'row', paddingHorizontal: space.xs, paddingBottom: space.sm },
  quickBtn: { flex: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.xxs },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: space.md, marginBottom: space.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50, paddingHorizontal: space.md, marginHorizontal: space.xxs, borderRadius: radius.sm },
  rowIcon: { width: 24, alignItems: 'center' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  zoomNum: { minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'], fontWeight: '600' },
});
