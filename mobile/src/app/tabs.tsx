import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Icon } from '@/components/Icon';
import { useTheme, radius, space, icon, motion } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { browser, browserStore, type BrowserTab } from '@/state/browser';
import { agentStore } from '@/state/agent';
import { artFor } from '@/lib/companions';
import { appStore } from '@/state/app';
import { faviconFor, hostOf } from '@/lib/url';
import { Empty, Glass, IconButton, T, Tap, haptic } from '@/components/ui';

const TabCard = memo(function TabCard({ tab, active, working, width, onOpen, onClose }: { tab: BrowserTab; active: boolean; working: boolean; width: number; onOpen: (id: string) => void; onClose: (id: string) => void }) {
  const t = useTheme();
  const companionId = useStore(appStore, (s) => s.settings.companionId);
  const host = hostOf(tab.url);
  const title = tab.title || host || 'New tab';
  return (
    <Tap label={`Open ${title}`} onPress={() => onOpen(tab.id)} style={{ width }}>
      <View style={[styles.preview, { backgroundColor: t.surface, borderColor: active ? t.accentFill : 'transparent' }]}>
        {tab.url ? (
          <Image source={{ uri: faviconFor(tab.url) || undefined }} style={styles.bigFav} contentFit="contain" />
        ) : (
          <Image source={artFor(companionId)} style={{ width: '46%', height: '46%' }} contentFit="contain" />
        )}
        {working ? <View style={[styles.dot, { backgroundColor: t.accentFill }]} /> : null}
        <View style={styles.close}>
          <IconButton size={28} label={`Close ${title}`} tint={t.dark ? 'rgba(0,0,0,0.45)' : 'rgba(20,19,23,0.08)'} icon={<Icon name="dismiss" size={14} color={t.ink} />} onPress={() => { haptic('light'); onClose(tab.id); }} />
        </View>
      </View>
      <T kind="footnote" numberOfLines={1} color={t.ink} style={styles.title}>{title}</T>
    </Tap>
  );
});

/** Grid tab switcher with a Tabs / Private segmented pill. */
export default function TabsScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tabs = useStore(browserStore, (s) => s.tabs);
  const activeId = useStore(browserStore, (s) => s.activeId);
  const activeIsPrivate = useStore(browserStore, (s) => !!s.tabs.find((x) => x.id === s.activeId)?.private);
  const runTabId = useStore(agentStore, (s) => s.runs.find((r) => r.id === s.activeRunId)?.tabId || null);
  const [mode, setMode] = useState<'normal' | 'private'>(activeIsPrivate ? 'private' : 'normal');
  const cols = width > 700 ? 3 : 2;
  const gap = space.sm;
  const cardW = (width - space.md * 2 - gap * (cols - 1)) / cols;
  const list = useMemo(() => tabs.filter((x) => (mode === 'private' ? x.private : !x.private)), [tabs, mode]);
  const normalCount = useMemo(() => tabs.filter((x) => !x.private).length, [tabs]);

  // segmented control: the selection lozenge springs between the two halves
  const seg = useRef(new Animated.Value(mode === 'private' ? 1 : 0)).current;
  const [segW, setSegW] = useState(0);
  useEffect(() => { Animated.spring(seg, { toValue: mode === 'private' ? 1 : 0, ...motion.spring.snappy, useNativeDriver: true }).start(); }, [mode, seg]);

  const open = useCallback((id: string) => { browser.activate(id); router.back(); }, [router]);
  const close = useCallback((id: string) => browser.close(id), []);
  const add = () => { haptic('light'); browser.newTab('', { private: mode === 'private' }); router.back(); };
  const closeAll = () => {
    Alert.alert(mode === 'private' ? 'Close private tabs?' : 'Close all tabs?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close', style: 'destructive', onPress: () => { if (mode === 'private') browserStore.get().tabs.filter((x) => x.private).forEach((x) => browser.close(x.id)); else browser.closeAll(); } },
    ]);
  };
  const pick = (m: 'normal' | 'private') => { if (m !== mode) { haptic('selection'); setMode(m); } };

  return (
    <View style={{ flex: 1, backgroundColor: t.ground, paddingTop: insets.top + space.xs }}>
      <View style={[styles.seg, { backgroundColor: t.surface2 }]} onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
        {segW ? (
          <Animated.View style={[styles.segThumb, { width: (segW - 8) / 2, backgroundColor: t.dark ? t.surface : '#FFFFFF', transform: [{ translateX: seg.interpolate({ inputRange: [0, 1], outputRange: [0, (segW - 8) / 2] }) }] }]} />
        ) : null}
        {(['normal', 'private'] as const).map((m) => (
          <Tap key={m} label={m === 'private' ? 'Private tabs' : 'Tabs'} onPress={() => pick(m)} feedback="opacity" haptics={false} style={styles.segBtn}>
            <T kind="callout" style={{ fontWeight: '600' }} color={mode === m ? t.ink : t.ink2}>{m === 'private' ? 'Private' : `${normalCount} ${normalCount === 1 ? 'Tab' : 'Tabs'}`}</T>
          </Tap>
        ))}
      </View>

      <FlatList
        data={list}
        key={cols}
        numColumns={cols}
        keyExtractor={(x) => x.id}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.md, gap: space.md, paddingBottom: 120 }}
        ListEmptyComponent={<Empty text={mode === 'private' ? 'No private tabs' : 'No tabs'} />}
        renderItem={({ item }) => (
          <TabCard tab={item} active={item.id === activeId} working={runTabId === item.id} width={cardW} onOpen={open} onClose={close} />
        )}
      />

      <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <Glass rounded={radius.pill} style={styles.bar}>
          <Tap label="Close all" onPress={closeAll} feedback="opacity" style={styles.textBtn}><T kind="callout" color={t.ink2}>Close all</T></Tap>
          <IconButton label="New tab" tint={t.accentFill} icon={<Icon name="add" size={icon.lg} color={t.accentInk} />} onPress={add} />
          <Tap label="Done" onPress={() => router.back()} feedback="opacity" style={[styles.textBtn, { alignItems: 'flex-end' }]}><T kind="headline">Done</T></Tap>
        </Glass>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', alignSelf: 'center', width: 240, height: 40, borderRadius: radius.pill, padding: 4 },
  segThumb: { position: 'absolute', top: 4, left: 4, bottom: 4, borderRadius: radius.pill },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  preview: { aspectRatio: 0.82, borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bigFav: { width: 40, height: 40, borderRadius: 10 },
  dot: { position: 'absolute', left: 12, top: 12, width: 8, height: 8, borderRadius: 4 },
  close: { position: 'absolute', top: 6, right: 6 },
  title: { marginTop: space.xs, marginHorizontal: space.xxs },
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 60, paddingHorizontal: space.xs },
  textBtn: { height: 44, minWidth: 88, justifyContent: 'center', paddingHorizontal: space.sm },
});
