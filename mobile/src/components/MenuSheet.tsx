import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Star, BookOpen, Monitor, Plus, EyeOff, Bookmark, History, Brain, Settings, Users, Copy, ShieldCheck, Bot } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme, radius, space, icon, motion } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser, browserStore, webviews } from '@/state/browser';
import { readerStore } from '@/state/reader';
import { READ_SCRIPT } from '@/lib/agent/page-scripts';
import { Glass, IconWell, T, Tap, haptic } from './ui';

type Item = { key: string; label: string; icon: React.ReactNode; onPress: () => void; active?: boolean; disabled?: boolean; right?: React.ReactNode };

/** Page menu: bookmark, reader, desktop site, new/private tab, and the app's own screens. */
export function MenuSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tab = useStore(browserStore, (s) => s.tabs.find((x) => x.id === s.activeId) || s.tabs[0]);
  const bookmarked = useStore(appStore, (s) => s.bookmarks.some((b) => b.url === tab.url));
  const { desktopMode, adblock } = useStore(appStore, (s) => ({ desktopMode: s.settings.desktopMode, adblock: s.settings.adblock }));

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
    { key: 'bm', label: bookmarked ? 'Saved' : 'Save', icon: <Star {...I} color={bookmarked ? t.accent : t.ink} fill={bookmarked ? t.accent : 'transparent'} />, onPress: () => { haptic('success'); app.toggleBookmark(tab.url, tab.title); }, disabled: !tab.url, active: bookmarked },
    { key: 'reader', label: 'Reader', icon: <BookOpen {...I} />, onPress: openReader, disabled: !tab.url },
    { key: 'desk', label: 'Desktop', icon: <Monitor {...I} color={desktopMode ? t.accent : t.ink} />, onPress: () => { app.patchSettings({ desktopMode: !desktopMode }); onClose(); }, active: desktopMode },
    { key: 'copy', label: 'Copy', icon: <Copy {...I} />, onPress: async () => { await Clipboard.setStringAsync(tab.url); haptic('success'); onClose(); }, disabled: !tab.url },
  ];

  const rows: Item[] = [
    { key: 'new', label: 'New tab', icon: <Plus {...I} />, onPress: () => { haptic('light'); browser.newTab(); onClose(); } },
    { key: 'priv', label: 'New private tab', icon: <EyeOff {...I} />, onPress: () => { haptic('light'); browser.newTab('', { private: true }); onClose(); } },
    { key: 'bms', label: 'Bookmarks', icon: <Bookmark {...I} />, onPress: () => nav('/bookmarks') },
    { key: 'hist', label: 'History', icon: <History {...I} />, onPress: () => nav('/history') },
    { key: 'comp', label: 'Companions', icon: <Bot {...I} />, onPress: () => nav('/companions') },
    { key: 'mem', label: 'Memory', icon: <Brain {...I} />, onPress: () => nav('/memory') },
    { key: 'prof', label: 'Profiles', icon: <Users {...I} />, onPress: () => nav('/profiles') },
    { key: 'ad', label: 'Block trackers', icon: <ShieldCheck {...I} />, onPress: () => app.patchSettings({ adblock: !adblock }), right: <Switch value={adblock} onValueChange={(v) => app.patchSettings({ adblock: v })} trackColor={{ true: t.accentFill, false: t.surface2 }} thumbColor="#FFFFFF" /> },
    { key: 'set', label: 'Settings', icon: <Settings {...I} />, onPress: () => nav('/settings') },
  ];

  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [40, 0] });
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim, opacity: a }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>
      <Animated.View style={[styles.sheetWrap, { paddingBottom: insets.bottom + space.xs, opacity: a, transform: [{ translateY }, { scale }] }]} pointerEvents="box-none">
        <Glass rounded={radius.sheet} intensity={80} style={styles.sheet}>
          <View style={styles.quick}>
            {quick.map((q) => (
              <Tap key={q.key} label={q.label} onPress={q.onPress} disabled={q.disabled} style={styles.quickBtn}>
                <IconWell size={48} tint={q.active ? t.accentSoft : t.dark ? 'rgba(255,248,240,0.07)' : 'rgba(20,19,23,0.05)'}>{q.icon}</IconWell>
                <T kind="caption" numberOfLines={1} color={t.ink2}>{q.label}</T>
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
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.xs },
  sheet: { paddingTop: space.md, paddingBottom: space.xs },
  quick: { flexDirection: 'row', paddingHorizontal: space.xs, paddingBottom: space.sm },
  quickBtn: { flex: 1, alignItems: 'center', gap: space.xs, paddingVertical: space.xxs },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: space.md, marginBottom: space.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50, paddingHorizontal: space.md, marginHorizontal: space.xxs, borderRadius: radius.sm },
  rowIcon: { width: 24, alignItems: 'center' },
});
