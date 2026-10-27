import React from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronRight, KeyRound } from 'lucide-react-native';
import { useTheme, radius, space, icon } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { appStore } from '@/state/app';
import { browserStore } from '@/state/browser';
import { agent, agentStore } from '@/state/agent';
import { companionById, faceFor } from '@/lib/companions';
import { hostOf } from '@/lib/url';
import { Composer } from '@/components/Composer';
import { IconWell, T, Tap } from '@/components/ui';

/** Ask the companion to work on the current page, plus recent runs. */
export default function AskScreen() {
  const t = useTheme();
  const router = useRouter();
  const companionId = useStore(appStore, (s) => s.settings.companionId);
  const hasModel = useStore(appStore, (s) => s.providers.some((p) => p.enabled && (p.local || p.hasKey) && p.models.length));
  const tab = useStore(browserStore, (s) => s.tabs.find((x) => x.id === s.activeId));
  const runs = useStore(agentStore, (s) => s.runs);
  const c = companionById(companionId);
  const host = tab?.url ? hostOf(tab.url) : '';
  const suggestions = host
    ? ['Summarise this page', 'Key facts on this page', 'Find contact details']
    : c.ideas;

  const start = (task: string) => {
    router.back();
    setTimeout(() => agent.start(task, companionId), 150);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.ground }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        data={runs}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: space.md, paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: space.sm, marginBottom: space.xl }}>
            {!hasModel ? (
              <Tap label="Add a model" onPress={() => router.push('/settings/models')} style={[styles.warn, { backgroundColor: t.surface }]}>
                <IconWell tint={t.accentSoft}><KeyRound size={icon.md} color={t.accent} /></IconWell>
                <T style={{ flex: 1 }}>Add a model</T>
                <ChevronRight size={icon.sm} color={t.ink3} />
              </Tap>
            ) : null}
            <Composer companionId={companionId} onSubmit={start} onPickCompanion={() => router.push('/companions')} autoFocus />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs }}>
              {suggestions.map((s) => (
                <Tap key={s} label={s} onPress={() => start(s)} style={[styles.chip, { backgroundColor: t.surface }]}>
                  <T kind="callout" numberOfLines={1}>{s}</T>
                </Tap>
              ))}
            </View>
            {runs.length ? <T kind="section" style={{ marginTop: space.md, marginLeft: space.xxs }}>Recent</T> : null}
          </View>
        }
        renderItem={({ item }) => {
          const rc = companionById(item.companionId);
          return (
            <Tap label={item.task} onPress={() => { agent.view(item.id); router.back(); }} feedback="highlight" style={[styles.run, { backgroundColor: t.surface }]}>
              <Image source={faceFor(rc.id)} style={{ width: 36, height: 36, borderRadius: 18 }} contentFit="cover" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1}>{item.task}</T>
                <T kind="footnote" numberOfLines={1}>{rc.name} · {item.status}</T>
              </View>
              <ChevronRight size={icon.sm} color={t.ink3} />
            </Tap>
          );
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  warn: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, borderCurve: 'continuous' },
  chip: { maxWidth: '100%', paddingHorizontal: space.md, height: 40, justifyContent: 'center', borderRadius: radius.pill },
  run: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.lg, borderCurve: 'continuous', marginBottom: space.xs },
});
