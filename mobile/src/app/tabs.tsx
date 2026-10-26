import React, { memo, useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { X, Plus, EyeOff, Globe } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { browser, browserStore, type BrowserTab } from '@/state/browser';
import { agentStore } from '@/state/agent';
import { companionById, artFor } from '@/lib/companions';
import { appStore } from '@/state/app';
import { faviconFor, hostOf } from '@/lib/url';
import { Glass, IconButton, T, Tap } from '@/components/ui';

const TabCard = memo(function TabCard({ tab, active, width, agentColor, onOpen, onClose }: { tab: BrowserTab; active: boolean; width: number; agentColor?: string; onOpen: (id: string) => void; onClose: (id: string) => void }) {
  const t = useTheme();
  const companionId = useStore(appStore, (s) => s.settings.companionId);
  const host = hostOf(tab.url);
  return (
    <Tap label={`Open tab ${tab.title || host || 'Home'}`} onPress={() => onOpen(tab.id)} style={[styles.card, { width, borderColor: active ? t.accent : agentColor || t.line, borderWidth: active || agentColor ? 2.5 : StyleSheet.hairlineWidth, backgroundColor: t.surface }]}>
      <View style={[styles.cardHead, { borderBottomColor: t.line }]}>
        {tab.url ? <Image source={{ uri: faviconFor(tab.url) || undefined }} style={styles.fav} contentFit="contain" /> : <Globe size={14} color={t.ink3} />}
        <T numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: '600' }}>{tab.title || host || 'Home'}</T>
        <IconButton size={30} label="Close tab" icon={<X size={14} color={t.ink2} />} onPress={() => onClose(tab.id)} />
      </View>
      <View style={[styles.preview, { backgroundColor: tab.private ? (t.dark ? '#201C2B' : '#ECE8F6') : t.surface2 }]}>
        {tab.url ? (
          <>
            <Image source={{ uri: faviconFor(tab.url) || undefined }} style={styles.bigFav} contentFit="contain" />
            <T kind="small" numberOfLines={2} style={{ textAlign: 'center', paddingHorizontal: 10 }}>{host}</T>
          </>
        ) : (
          <Image source={artFor(companionId)} style={{ width: '70%', height: '70%' }} contentFit="contain" />
        )}
        {tab.private ? <View style={styles.privBadge}><EyeOff size={12} color={t.ink2} /></View> : null}
      </View>
    </Tap>
  );
});

/** Grid tab switcher (Safari-style) with a Private section. */
export default function TabsScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tabs = useStore(browserStore, (s) => s.tabs);
  const activeId = useStore(browserStore, (s) => s.activeId);
  const activeIsPrivate = useStore(browserStore, (s) => !!s.tabs.find((x) => x.id === s.activeId)?.private);
  const run = useStore(agentStore, (s) => s.runs.find((r) => r.id === s.activeRunId) || null);
  const [mode, setMode] = useState<'normal' | 'private'>(activeIsPrivate ? 'private' : 'normal');
  const cols = width > 700 ? 3 : 2;
  const cardW = (width - 16 * 2 - 12 * (cols - 1)) / cols;
  const list = useMemo(() => tabs.filter((x) => (mode === 'private' ? x.private : !x.private)), [tabs, mode]);
  const agentColor = run ? companionById(run.companionId).look.body : undefined;

  const open = useCallback((id: string) => { browser.activate(id); router.back(); }, [router]);
  const close = useCallback((id: string) => browser.close(id), []);
  const add = () => { browser.newTab('', { private: mode === 'private' }); router.back(); };
  const closeAll = () => {
    Alert.alert(mode === 'private' ? 'Close all private tabs?' : 'Close all tabs?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close all', style: 'destructive', onPress: () => { if (mode === 'private') browserStore.get().tabs.filter((x) => x.private).forEach((x) => browser.close(x.id)); else browser.closeAll(); } },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.ground, paddingTop: insets.top }}>
      <FlatList
        data={list}
        key={cols}
        numColumns={cols}
        keyExtractor={(x) => x.id}
        columnWrapperStyle={{ gap: 12 }}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 80, gap: 8 }}>
            <EyeOff size={34} color={t.ink3} />
            <T style={{ fontWeight: '600' }}>{mode === 'private' ? 'Private browsing' : 'No tabs'}</T>
            <T kind="small" style={{ textAlign: 'center', maxWidth: 280 }}>{mode === 'private' ? 'Private tabs keep no history and their cookies and site data are not saved.' : 'Tap + to open a new tab.'}</T>
          </View>
        }
        renderItem={({ item }) => (
          <TabCard tab={item} active={item.id === activeId} width={cardW} agentColor={run?.tabId === item.id ? agentColor : undefined} onOpen={open} onClose={close} />
        )}
      />
      <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Glass rounded={radius.pill} style={styles.bar}>
          <Tap label="Close all" onPress={closeAll} style={styles.textBtn}><T color={t.danger} style={{ fontSize: 15 }}>Close all</T></Tap>
          <View style={[styles.seg, { backgroundColor: t.dark ? 'rgba(255,245,235,0.08)' : 'rgba(30,20,10,0.06)' }]}>
            {(['normal', 'private'] as const).map((m) => (
              <Tap key={m} label={m === 'private' ? 'Private tabs' : 'Tabs'} onPress={() => setMode(m)} style={[styles.segBtn, mode === m && { backgroundColor: t.surface }]}>
                <T style={{ fontSize: 14, fontWeight: '600' }} color={mode === m ? t.ink : t.ink2}>{m === 'private' ? 'Private' : `${tabs.filter((x) => !x.private).length} Tabs`}</T>
              </Tap>
            ))}
          </View>
          <IconButton label="New tab" icon={<Plus size={24} color={t.ink} />} onPress={add} />
          <Tap label="Done" onPress={() => router.back()} style={styles.textBtn}><T color={t.accent} style={{ fontSize: 16, fontWeight: '600' }}>Done</T></Tap>
        </Glass>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, height: 36, borderBottomWidth: StyleSheet.hairlineWidth },
  fav: { width: 14, height: 14 },
  preview: { height: 170, alignItems: 'center', justifyContent: 'center', gap: 8 },
  bigFav: { width: 44, height: 44, borderRadius: 10 },
  privBadge: { position: 'absolute', right: 8, bottom: 8 },
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 60, paddingHorizontal: 8 },
  textBtn: { height: 44, justifyContent: 'center', paddingHorizontal: 8 },
  seg: { flexDirection: 'row', borderRadius: radius.pill, padding: 3 },
  segBtn: { paddingHorizontal: 12, height: 34, borderRadius: radius.pill, justifyContent: 'center' },
});
