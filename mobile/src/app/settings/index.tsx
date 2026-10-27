import React from 'react';
import { Alert, ScrollView, Switch, TextInput, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Cpu, Search, Palette, ShieldCheck, Hand, Brain, Users, Bot, User, Trash2, ChevronRight, X } from 'lucide-react-native';
import { useTheme, icon, space } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { ENGINE_NAMES } from '@/lib/url';
import { companionById } from '@/lib/companions';
import { IconWell, Row, Section, T } from '@/components/ui';
import type { Settings } from '@/lib/types';

function pick<T extends string>(title: string, options: Record<T, string>, current: T, onPick: (v: T) => void) {
  Alert.alert(title, undefined, [
    ...(Object.keys(options) as T[]).map((k) => ({ text: (k === current ? '✓ ' : '') + options[k], onPress: () => onPick(k) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

const THEMES: Record<Settings['theme'], string> = { system: 'Automatic', light: 'Light', dark: 'Dark' };
const APPROVAL: Record<Settings['approvalMode'], string> = {
  'ask-risky': 'Risky actions',
  'ask-always': 'Every action',
  autonomous: 'Never',
};

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const s = useStore(appStore, (x) => x.settings);
  const providers = useStore(appStore, (x) => x.providers);
  const memoryCount = useStore(appStore, (x) => x.memory.length);
  const profile = useStore(appStore, (x) => x.profiles.find((p) => p.id === x.profileId));
  const model = s.defaultModel ? `${providers.find((p) => p.id === s.defaultModel!.providerId)?.name ?? '?'} · ${s.defaultModel.model}` : 'Not set up';
  const chev = <ChevronRight size={icon.sm} color={t.ink3} />;
  const I = { size: icon.md, color: t.ink };

  return (
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={{ padding: space.md, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
      <Section title="You">
        <View style={styles.nameRow}>
          <IconWell><User {...I} /></IconWell>
          <TextInput
            defaultValue={s.userName}
            onEndEditing={(e) => app.patchSettings({ userName: e.nativeEvent.text.trim() })}
            placeholder="Your name"
            placeholderTextColor={t.ink3}
            selectionColor={t.accentFill}
            style={[styles.nameInput, { color: t.ink, borderBottomColor: t.line }]}
            accessibilityLabel="Your name"
          />
        </View>
        <Row icon={<Users {...I} />} title="Profile" subtitle={profile?.name} right={chev} onPress={() => router.push('/profiles')} last />
      </Section>

      <Section title="AI">
        <Row icon={<Cpu {...I} />} title="Models" subtitle={model} right={chev} onPress={() => router.push('/settings/models')} />
        <Row icon={<Bot {...I} />} title="Companion" subtitle={companionById(s.companionId).name} right={chev} onPress={() => router.push('/companions')} />
        <Row icon={<Hand {...I} />} title="Ask before" subtitle={APPROVAL[s.approvalMode]} right={chev} onPress={() => pick('Ask before', APPROVAL, s.approvalMode, (v) => app.patchSettings({ approvalMode: v }))} />
        <Row icon={<Brain {...I} />} title="Memory" subtitle={memoryCount ? String(memoryCount) : undefined} right={chev} onPress={() => router.push('/memory')} last />
      </Section>

      <Section title="Browsing">
        <Row icon={<Search {...I} />} title="Search engine" subtitle={ENGINE_NAMES[s.searchEngine]} right={chev} onPress={() => pick('Search engine', ENGINE_NAMES, s.searchEngine, (v) => app.patchSettings({ searchEngine: v }))} />
        <Row icon={<ShieldCheck {...I} />} title="Block trackers" right={<Switch value={s.adblock} onValueChange={(v) => app.patchSettings({ adblock: v })} trackColor={{ true: t.accentFill, false: t.surface2 }} thumbColor="#FFFFFF" />} />
        <Row icon={<Palette {...I} />} title="Appearance" subtitle={THEMES[s.theme]} right={chev} onPress={() => pick('Appearance', THEMES, s.theme, (v) => app.patchSettings({ theme: v }))} last />
      </Section>

      <Section title="Privacy">
        <Row icon={<Trash2 size={icon.md} color={t.danger} />} title="Clear history" danger onPress={() => Alert.alert('Clear browsing history?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => app.clearHistory() }])} />
        <Row icon={<X size={icon.md} color={t.danger} />} title="Close all tabs" danger onPress={() => browser.closeAll()} last />
      </Section>

      <T kind="small" color={t.ink3} style={{ textAlign: 'center' }}>
        OWL {Constants.expoConfig?.version ?? ''}
      </T>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.md, minHeight: 60 },
  nameInput: { flex: 1, fontSize: 16, alignSelf: 'stretch', paddingRight: space.md, borderBottomWidth: StyleSheet.hairlineWidth },
});
