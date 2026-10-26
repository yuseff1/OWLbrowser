import React, { useMemo, useState } from 'react';
import { Alert, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { X, History as HistoryIcon } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { faviconFor, hostOf } from '@/lib/url';
import { Button, IconButton, T, Tap } from '@/components/ui';
import type { HistoryEntry } from '@/lib/types';

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function HistoryScreen() {
  const t = useTheme();
  const router = useRouter();
  const history = useStore(appStore, (s) => s.history);
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? history.filter((h) => h.title.toLowerCase().includes(s) || h.url.toLowerCase().includes(s)) : history;
    const out: { title: string; data: HistoryEntry[] }[] = [];
    for (const h of list.slice(0, 600)) {
      const label = dayLabel(h.lastVisit);
      const last = out[out.length - 1];
      if (last && last.title === label) last.data.push(h); else out.push({ title: label, data: [h] });
    }
    return out;
  }, [history, q]);

  const clear = () => Alert.alert('Clear browsing history?', 'This removes history for this profile on this device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => app.clearHistory() },
  ]);

  return (
    <SectionList
      style={{ backgroundColor: t.ground }}
      sections={sections}
      keyExtractor={(h) => h.url}
      contentContainerStyle={{ padding: 16 }}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<TextInput value={q} onChangeText={setQ} placeholder="Search history" placeholderTextColor={t.ink3} style={[styles.search, { backgroundColor: t.surface2, color: t.ink }]} accessibilityLabel="Search history" />}
      ListFooterComponent={history.length ? <Button title="Clear history" kind="secondary" onPress={clear} style={{ marginTop: 16 }} /> : undefined}
      ListEmptyComponent={
        <View style={styles.empty}>
          <HistoryIcon size={34} color={t.ink3} />
          <T style={{ fontWeight: '600' }}>No history</T>
          <T kind="small">Pages you visit (outside private tabs) show up here.</T>
        </View>
      }
      renderSectionHeader={({ section }) => <T kind="tiny" color={t.ink3} style={{ marginTop: 12, marginBottom: 6, marginLeft: 4 }}>{section.title}</T>}
      renderItem={({ item }) => (
        <Tap label={item.title} onPress={() => { browser.navigate(browser.active().id, item.url); router.back(); }} style={styles.row}>
          <Image source={{ uri: faviconFor(item.url) || undefined }} style={styles.fav} contentFit="contain" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T numberOfLines={1} style={{ fontSize: 15 }}>{item.title}</T>
            <T kind="small" numberOfLines={1}>{hostOf(item.url)} · {new Date(item.lastVisit).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</T>
          </View>
          <IconButton label={`Remove ${item.title}`} icon={<X size={16} color={t.ink3} />} onPress={() => app.removeHistory(item.url)} />
        </Tap>
      )}
    />
  );
}

const styles = StyleSheet.create({
  search: { height: 44, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 },
  fav: { width: 20, height: 20, borderRadius: 4 },
  empty: { alignItems: 'center', gap: 8, marginTop: 80 },
});
