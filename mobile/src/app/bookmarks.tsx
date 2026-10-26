import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Trash2, Star } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { faviconFor, hostOf } from '@/lib/url';
import { IconButton, T, Tap } from '@/components/ui';

export default function BookmarksScreen() {
  const t = useTheme();
  const router = useRouter();
  const bookmarks = useStore(appStore, (s) => s.bookmarks);
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? bookmarks.filter((b) => b.title.toLowerCase().includes(s) || b.url.toLowerCase().includes(s)) : bookmarks;
  }, [bookmarks, q]);

  return (
    <FlatList
      style={{ backgroundColor: t.ground }}
      data={list}
      keyExtractor={(b) => b.id}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<TextInput value={q} onChangeText={setQ} placeholder="Search bookmarks" placeholderTextColor={t.ink3} style={[styles.search, { backgroundColor: t.surface2, color: t.ink }]} accessibilityLabel="Search bookmarks" />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Star size={34} color={t.ink3} />
          <T style={{ fontWeight: '600' }}>No bookmarks yet</T>
          <T kind="small" style={{ textAlign: 'center' }}>Open the page menu (☰ in the address bar) and tap Bookmark.</T>
        </View>
      }
      renderItem={({ item }) => (
        <Tap label={item.title} onPress={() => { browser.navigate(browser.active().id, item.url); router.back(); }} style={[styles.row, { backgroundColor: t.surface, borderColor: t.line }]}>
          <Image source={{ uri: faviconFor(item.url) || undefined }} style={styles.fav} contentFit="contain" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T numberOfLines={1} style={{ fontSize: 15, fontWeight: '500' }}>{item.title}</T>
            <T kind="small" numberOfLines={1}>{hostOf(item.url)}</T>
          </View>
          <IconButton label={`Delete ${item.title}`} icon={<Trash2 size={18} color={t.ink3} />} onPress={() => app.removeBookmark(item.id)} />
        </Tap>
      )}
    />
  );
}

const styles = StyleSheet.create({
  search: { height: 44, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 14, paddingVertical: 6, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  fav: { width: 22, height: 22, borderRadius: 4 },
  empty: { alignItems: 'center', gap: 8, marginTop: 80, paddingHorizontal: 30 },
});
