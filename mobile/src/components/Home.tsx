import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { EyeOff } from 'lucide-react-native';
import { useTheme, radius, space } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { appStore } from '@/state/app';
import { agent } from '@/state/agent';
import { browser } from '@/state/browser';
import { artFor, companionById } from '@/lib/companions';
import { faviconFor, hostOf } from '@/lib/url';
import { Composer } from './Composer';
import { T, Tap } from './ui';

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

/** New-tab page: the companion, one field, a few starting points, favourites. Nothing else. */
export function Home({ tabId, isPrivate, bottomInset }: { tabId: string; isPrivate: boolean; bottomInset: number }) {
  const t = useTheme();
  const router = useRouter();
  const { companionId, userName } = useStore(appStore, (s) => ({ companionId: s.settings.companionId, userName: s.settings.userName }));
  const bookmarks = useStore(appStore, (s) => s.bookmarks.slice(0, 8));
  const c = companionById(companionId);
  const hello = useMemo(() => greeting(userName), [userName]);

  const run = (task: string) => {
    browser.activate(tabId);
    agent.start(task, companionId);
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.ground }}
      contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.xxxl, paddingBottom: bottomInset + space.xl }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Image source={artFor(c.id)} style={styles.art} contentFit="contain" transition={200} accessibilityLabel={c.name} />
      <View style={styles.titleRow}>
        {isPrivate ? <EyeOff size={20} color={t.ink2} /> : null}
        <T kind="display" style={{ textAlign: 'center' }}>{isPrivate ? 'Private' : hello}</T>
      </View>

      <Composer companionId={companionId} onSubmit={run} onPickCompanion={() => router.push('/companions')} />

      <View style={[styles.ideas, { backgroundColor: t.surface }]}>
        {c.ideas.slice(0, 3).map((idea, i) => (
          <Tap key={idea} label={idea} onPress={() => run(idea)} feedback="highlight" style={styles.idea}>
            <View style={[styles.ideaInner, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line }]}>
              <T kind="callout" numberOfLines={2} color={t.ink2}>{idea}</T>
            </View>
          </Tap>
        ))}
      </View>

      {bookmarks.length ? (
        <View style={styles.favGrid}>
          {bookmarks.map((b) => (
            <Tap key={b.id} label={b.title || hostOf(b.url)} onPress={() => browser.navigate(tabId, b.url)} style={styles.fav}>
              <View style={[styles.favIcon, { backgroundColor: t.surface }]}>
                <Image source={{ uri: faviconFor(b.url) || undefined }} style={{ width: 24, height: 24, borderRadius: 5 }} contentFit="contain" />
              </View>
              <T kind="caption" numberOfLines={1} style={{ textAlign: 'center' }}>{b.title || hostOf(b.url)}</T>
            </Tap>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  art: { width: 112, height: 112, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, marginTop: space.md, marginBottom: space.xl },
  ideas: { marginTop: space.sm, borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden' },
  idea: { paddingHorizontal: space.md },
  ideaInner: { minHeight: 52, justifyContent: 'center', paddingVertical: space.sm },
  favGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md, marginTop: space.xl },
  fav: { width: '25%', alignItems: 'center', gap: space.xs, paddingHorizontal: space.xxs },
  favIcon: { width: 56, height: 56, borderRadius: radius.md, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
});
