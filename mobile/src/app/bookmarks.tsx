import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Icon } from '@/components/Icon';
import { useTheme, radius, space, icon } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { faviconFor, hostOf } from '@/lib/url';
import { Empty, IconButton, T, Tap, fieldStyle } from '@/components/ui';

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
      contentContainerStyle={{ padding: space.md }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<TextInput value={q} onChangeText={setQ} placeholder="Search bookmarks" placeholderTextColor={t.ink3} selectionColor={t.accentFill} style={[fieldStyle(t), { marginBottom: space.md }]} accessibilityLabel="Search bookmarks" />}
      ListEmptyComponent={<Empty text={q ? 'No matches' : 'No bookmarks'} />}
      renderItem={({ item }) => (
        <Tap label={item.title} onPress={() => { browser.navigate(browser.active().id, item.url); router.back(); }} feedback="highlight" haptics={false} style={styles.row}>
          <Image source={{ uri: faviconFor(item.url) || undefined }} style={styles.fav} contentFit="contain" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T numberOfLines={1}>{item.title}</T>
            <T kind="footnote" numberOfLines={1}>{hostOf(item.url)}</T>
          </View>
          <IconButton label={`Delete ${item.title}`} icon={<Icon name="delete" size={icon.sm} color={t.ink3} />} onPress={() => app.removeBookmark(item.id)} />
        </Tap>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingLeft: space.xs, borderRadius: radius.sm },
  fav: { width: 20, height: 20, borderRadius: 5 },
});
