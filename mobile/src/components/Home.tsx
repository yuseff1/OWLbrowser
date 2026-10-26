import React, { useMemo } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { Lightbulb, EyeOff, ChevronRight } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
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
  const part = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}` : part;
}

/** The OWL new-tab page: companion art, composer, ideas, favourites. Mirrors the desktop Home. */
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
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1, backgroundColor: t.ground }}
        contentContainerStyle={{ padding: 20, paddingBottom: bottomInset + 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {isPrivate ? (
          <View style={[styles.privateBadge, { backgroundColor: t.surface2 }]}>
            <EyeOff size={16} color={t.ink2} />
            <T kind="small">Private tab · no history, cookies cleared when closed</T>
          </View>
        ) : null}

        <View style={styles.hero}>
          <View style={[styles.glow, { backgroundColor: c.look.body, opacity: t.dark ? 0.22 : 0.16 }]} />
          <Image source={artFor(c.id)} style={styles.art} contentFit="contain" transition={250} accessibilityLabel={`${c.name}, your ${c.role}`} />
        </View>
        <T kind="title" style={{ textAlign: 'center' }}>{hello}</T>
        <T kind="small" style={{ textAlign: 'center', marginTop: 4, marginBottom: 20 }}>
          {c.name} · {c.role} — {c.tagline}
        </T>

        <Composer companionId={companionId} onSubmit={run} onPickCompanion={() => router.push('/companions')} />

        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.line }]}>
          <View style={styles.cardHead}>
            <Lightbulb size={16} color={c.look.body} />
            <T kind="tiny" color={t.ink2}>Ideas for {c.name}</T>
          </View>
          {c.ideas.map((idea, i) => (
            <Tap key={idea} label={idea} onPress={() => run(idea)} style={[styles.idea, i < c.ideas.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line }]}>
              <T style={{ flex: 1, fontSize: 15 }}>{idea}</T>
              <ChevronRight size={16} color={t.ink3} />
            </Tap>
          ))}
        </View>

        {bookmarks.length ? (
          <View style={{ marginTop: 24 }}>
            <T kind="tiny" color={t.ink2} style={{ marginBottom: 10, marginLeft: 4 }}>Favourites</T>
            <View style={styles.favGrid}>
              {bookmarks.map((b) => (
                <Tap key={b.id} label={b.title} onPress={() => browser.navigate(tabId, b.url)} style={styles.fav}>
                  <View style={[styles.favIcon, { backgroundColor: t.surface, borderColor: t.line }]}>
                    <Image source={{ uri: faviconFor(b.url) || undefined }} style={{ width: 28, height: 28 }} contentFit="contain" />
                  </View>
                  <T kind="small" numberOfLines={1} style={{ textAlign: 'center' }}>{b.title || hostOf(b.url)}</T>
                </Tap>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  privateBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, marginBottom: 8 },
  hero: { alignItems: 'center', justifyContent: 'center', height: 220, marginTop: 8 },
  glow: { position: 'absolute', width: 200, height: 200, borderRadius: 100, transform: [{ scaleX: 1.2 }] },
  art: { width: 210, height: 210 },
  card: { marginTop: 18, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingTop: 12, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 6 },
  idea: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, paddingHorizontal: 16, paddingVertical: 12 },
  favGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  fav: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  favIcon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
});
