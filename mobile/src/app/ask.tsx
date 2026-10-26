import React from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronRight, KeyRound } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { appStore } from '@/state/app';
import { browserStore } from '@/state/browser';
import { agent, agentStore } from '@/state/agent';
import { companionById, faceFor } from '@/lib/companions';
import { hostOf } from '@/lib/url';
import { Composer } from '@/components/Composer';
import { T, Tap } from '@/components/ui';

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
    ? [`Summarise this page`, `What are the key facts on ${host}?`, `Find the contact details on this site`]
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
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 18 }}>
            {!hasModel ? (
              <Tap label="Set up a model" onPress={() => router.push('/settings/models')} style={[styles.warn, { backgroundColor: t.accentSoft }]}>
                <KeyRound size={18} color={t.accent} />
                <T style={{ flex: 1, fontSize: 14 }} color={t.ink}>Add an AI model first (API key or a model on your network).</T>
                <ChevronRight size={16} color={t.accent} />
              </Tap>
            ) : null}
            <T kind="small">{host ? `${c.name} will work in this tab (${host}).` : `${c.name} will work in this tab.`}</T>
            <Composer companionId={companionId} onSubmit={start} onPickCompanion={() => router.push('/companions')} autoFocus />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {suggestions.map((s) => (
                <Tap key={s} label={s} onPress={() => start(s)} style={[styles.chip, { backgroundColor: t.surface, borderColor: t.line }]}>
                  <T style={{ fontSize: 14 }}>{s}</T>
                </Tap>
              ))}
            </View>
            {runs.length ? <T kind="tiny" color={t.ink3} style={{ marginTop: 10 }}>Recent</T> : null}
          </View>
        }
        renderItem={({ item }) => {
          const rc = companionById(item.companionId);
          return (
            <Tap label={item.task} onPress={() => { agent.view(item.id); router.back(); }} style={[styles.run, { backgroundColor: t.surface, borderColor: t.line }]}>
              <Image source={faceFor(rc.id)} style={{ width: 30, height: 30 }} contentFit="contain" />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T numberOfLines={1} style={{ fontSize: 15, fontWeight: '500' }}>{item.task}</T>
                <T kind="small" numberOfLines={1}>{rc.name} · {item.status}{item.result ? ' · ' + item.result.replace(/\s+/g, ' ').slice(0, 80) : ''}</T>
              </View>
              <ChevronRight size={16} color={t.ink3} />
            </Tap>
          );
        }}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  warn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth },
  run: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
});
