import React, { useMemo, useState } from 'react';
import { Alert, SectionList, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Icon } from '@/components/Icon';
import { useTheme, radius, space, icon } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { faviconFor, hostOf } from '@/lib/url';
import { showToast } from '@/components/Toast';
import { Button, Empty, IconButton, T, Tap, fieldStyle, haptic } from '@/components/ui';
import type { HistoryEntry } from '@/lib/types';

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

/** Long-press: open in a background tab (private stays private), confirmed with a toast. */
function openInNewTab(url: string) {
  const t = browser.newTab(url, { private: browser.active().private, background: true });
  haptic('success');
  showToast('Opened in new tab', { label: 'Switch', run: () => browser.activate(t.id) });
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

  const clear = () => Alert.alert('Clear history?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear', style: 'destructive', onPress: () => app.clearHistory() },
  ]);

  return (
    <SectionList
      style={{ backgroundColor: t.ground }}
      sections={sections}
      keyExtractor={(h) => h.url}
      contentContainerStyle={{ padding: space.md }}
      stickySectionHeadersEnabled={false}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<TextInput value={q} onChangeText={setQ} placeholder="Search history" placeholderTextColor={t.ink3} selectionColor={t.accentFill} style={fieldStyle(t)} accessibilityLabel="Search history" />}
      ListFooterComponent={history.length ? <Button title="Clear history" kind="secondary" onPress={clear} style={{ marginTop: 16 }} /> : undefined}
      ListEmptyComponent={<Empty text={q ? 'No matches' : 'No history'} />}
      renderSectionHeader={({ section }) => <T kind="section" style={{ marginTop: space.lg, marginBottom: space.xxs, marginLeft: space.xxs }}>{section.title}</T>}
      renderItem={({ item }) => (
        <Tap label={item.title} onPress={() => { browser.navigate(browser.active().id, item.url); router.back(); }} onLongPress={() => openInNewTab(item.url)} feedback="highlight" haptics={false} style={styles.row}>
          <Image source={{ uri: faviconFor(item.url) || undefined }} style={styles.fav} contentFit="contain" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T numberOfLines={1}>{item.title}</T>
            <T kind="footnote" numberOfLines={1}>{hostOf(item.url)} · {new Date(item.lastVisit).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</T>
          </View>
          <IconButton label={`Remove ${item.title}`} icon={<Icon name="dismiss" size={icon.sm} color={t.ink3} />} onPress={() => app.removeHistory(item.url)} />
        </Tap>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingLeft: space.xs, borderRadius: radius.sm },
  fav: { width: 20, height: 20, borderRadius: 5 },
});
