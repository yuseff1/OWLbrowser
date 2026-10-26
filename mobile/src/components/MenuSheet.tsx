import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Star, BookOpen, Monitor, Plus, EyeOff, Bookmark, History, Brain, Settings, Users, Copy, ShieldCheck, Bot } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser, browserStore, webviews } from '@/state/browser';
import { readerStore } from '@/state/reader';
import { READ_SCRIPT } from '@/lib/agent/page-scripts';
import { Glass, T, Tap, haptic } from './ui';

type Item = { key: string; label: string; icon: React.ReactNode; onPress: () => void; active?: boolean; disabled?: boolean };

/** Page menu: bookmark, reader, desktop site, new/private tab, and the app's own screens. */
export function MenuSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tab = useStore(browserStore, (s) => s.tabs.find((x) => x.id === s.activeId) || s.tabs[0]);
  const bookmarked = useStore(appStore, (s) => s.bookmarks.some((b) => b.url === tab.url));
  const { desktopMode, adblock } = useStore(appStore, (s) => ({ desktopMode: s.settings.desktopMode, adblock: s.settings.adblock }));
  const profile = useStore(appStore, (s) => s.profiles.find((p) => p.id === s.profileId));

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

  const quick: Item[] = [
    { key: 'bm', label: bookmarked ? 'Saved' : 'Bookmark', icon: <Star size={22} color={bookmarked ? t.warn : t.ink} fill={bookmarked ? t.warn : 'transparent'} />, onPress: () => { haptic('success'); app.toggleBookmark(tab.url, tab.title); }, disabled: !tab.url, active: bookmarked },
    { key: 'reader', label: 'Reader', icon: <BookOpen size={22} color={t.ink} />, onPress: openReader, disabled: !tab.url },
    { key: 'desk', label: desktopMode ? 'Mobile site' : 'Desktop site', icon: <Monitor size={22} color={desktopMode ? t.accent : t.ink} />, onPress: () => { app.patchSettings({ desktopMode: !desktopMode }); onClose(); }, active: desktopMode },
    { key: 'copy', label: 'Copy link', icon: <Copy size={22} color={t.ink} />, onPress: async () => { await Clipboard.setStringAsync(tab.url); haptic('success'); onClose(); }, disabled: !tab.url },
  ];

  const rows: Item[] = [
    { key: 'new', label: 'New tab', icon: <Plus size={20} color={t.ink} />, onPress: () => { browser.newTab(); onClose(); } },
    { key: 'priv', label: 'New private tab', icon: <EyeOff size={20} color={t.ink} />, onPress: () => { browser.newTab('', { private: true }); onClose(); } },
    { key: 'bms', label: 'Bookmarks', icon: <Bookmark size={20} color={t.ink} />, onPress: () => nav('/bookmarks') },
    { key: 'hist', label: 'History', icon: <History size={20} color={t.ink} />, onPress: () => nav('/history') },
    { key: 'comp', label: 'Companions', icon: <Bot size={20} color={t.ink} />, onPress: () => nav('/companions') },
    { key: 'mem', label: 'Memory', icon: <Brain size={20} color={t.ink} />, onPress: () => nav('/memory') },
    { key: 'prof', label: `Profile · ${profile?.name ?? ''}`, icon: <Users size={20} color={profile?.color ?? t.ink} />, onPress: () => nav('/profiles') },
    { key: 'ad', label: adblock ? 'Ad & tracker blocking on' : 'Ad & tracker blocking off', icon: <ShieldCheck size={20} color={adblock ? t.success : t.ink3} />, onPress: () => app.patchSettings({ adblock: !adblock }), active: adblock },
    { key: 'set', label: 'Settings', icon: <Settings size={20} color={t.ink} />, onPress: () => nav('/settings') },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + 10 }]} pointerEvents="box-none">
        <Glass rounded={radius.xl} intensity={90} style={styles.sheet}>
          <View style={styles.quick}>
            {quick.map((q) => (
              <Tap key={q.key} label={q.label} onPress={q.onPress} disabled={q.disabled} style={[styles.quickBtn, { backgroundColor: q.active ? t.accentSoft : t.dark ? 'rgba(255,245,235,0.06)' : 'rgba(30,20,10,0.05)' }]}>
                {q.icon}
                <T kind="small" numberOfLines={1} color={t.ink}>{q.label}</T>
              </Tap>
            ))}
          </View>
          <ScrollView style={{ maxHeight: 420 }} bounces={false}>
            {rows.map((r, i) => (
              <Tap key={r.key} label={r.label} onPress={r.onPress} haptics={false} style={[styles.row, i < rows.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
                <View style={{ width: 28, alignItems: 'center' }}>{r.icon}</View>
                <T style={{ fontSize: 16, flex: 1 }}>{r.label}</T>
              </Tap>
            ))}
          </ScrollView>
        </Glass>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheetWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10 },
  sheet: { paddingTop: 12, paddingBottom: 6 },
  quick: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  quickBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, height: 74, borderRadius: radius.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 16 },
});
