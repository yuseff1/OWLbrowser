import React from 'react';
import { Alert, ScrollView, Switch, TextInput, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Cpu, Search, Palette, ShieldCheck, Hand, Brain, Users, Bot, User, Trash2 } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { ENGINE_NAMES } from '@/lib/url';
import { companionById } from '@/lib/companions';
import { Row, Section, T } from '@/components/ui';
import type { Settings } from '@/lib/types';

function pick<T extends string>(title: string, options: Record<T, string>, current: T, onPick: (v: T) => void) {
  Alert.alert(title, undefined, [
    ...(Object.keys(options) as T[]).map((k) => ({ text: (k === current ? '✓ ' : '') + options[k], onPress: () => onPick(k) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

const THEMES: Record<Settings['theme'], string> = { system: 'Automatic', light: 'Light', dark: 'Dark' };
const APPROVAL: Record<Settings['approvalMode'], string> = {
  'ask-risky': 'Ask before risky actions',
  'ask-always': 'Ask before every tap',
  autonomous: 'Never ask (autonomous)',
};

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const s = useStore(appStore, (x) => x.settings);
  const providers = useStore(appStore, (x) => x.providers);
  const memoryCount = useStore(appStore, (x) => x.memory.length);
  const profile = useStore(appStore, (x) => x.profiles.find((p) => p.id === x.profileId));
  const model = s.defaultModel ? `${providers.find((p) => p.id === s.defaultModel!.providerId)?.name ?? '?'} · ${s.defaultModel.model}` : 'Not set up';
  const chev = <T color={t.ink3}>›</T>;

  return (
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      <Section title="You">
        <View style={[styles.nameRow, { borderBottomColor: t.line }]}>
          <User size={20} color={t.ink2} />
          <TextInput
            defaultValue={s.userName}
            onEndEditing={(e) => app.patchSettings({ userName: e.nativeEvent.text.trim() })}
            placeholder="Your name (for greetings)"
            placeholderTextColor={t.ink3}
            style={[styles.nameInput, { color: t.ink }]}
            accessibilityLabel="Your name"
          />
        </View>
        <Row icon={<Users size={20} color={profile?.color ?? t.ink2} />} title="Profile" subtitle={profile?.name} right={chev} onPress={() => router.push('/profiles')} last />
      </Section>

      <Section title="AI">
        <Row icon={<Cpu size={20} color={t.accent} />} title="Models" subtitle={model} right={chev} onPress={() => router.push('/settings/models')} />
        <Row icon={<Bot size={20} color={t.ink2} />} title="Companion" subtitle={companionById(s.companionId).name} right={chev} onPress={() => router.push('/companions')} />
        <Row icon={<Hand size={20} color={t.ink2} />} title="Approvals" subtitle={APPROVAL[s.approvalMode]} right={chev} onPress={() => pick('Approvals', APPROVAL, s.approvalMode, (v) => app.patchSettings({ approvalMode: v }))} />
        <Row icon={<Brain size={20} color={t.ink2} />} title="Memory" subtitle={`${memoryCount} item${memoryCount === 1 ? '' : 's'} on this device`} right={chev} onPress={() => router.push('/memory')} last />
      </Section>

      <Section title="Browsing">
        <Row icon={<Search size={20} color={t.ink2} />} title="Search engine" subtitle={ENGINE_NAMES[s.searchEngine]} right={chev} onPress={() => pick('Search engine', ENGINE_NAMES, s.searchEngine, (v) => app.patchSettings({ searchEngine: v }))} />
        <Row icon={<ShieldCheck size={20} color={s.adblock ? t.success : t.ink2} />} title="Block ads & trackers" right={<Switch value={s.adblock} onValueChange={(v) => app.patchSettings({ adblock: v })} trackColor={{ true: t.accent }} />} />
        <Row icon={<Palette size={20} color={t.ink2} />} title="Appearance" subtitle={THEMES[s.theme]} right={chev} onPress={() => pick('Appearance', THEMES, s.theme, (v) => app.patchSettings({ theme: v }))} last />
      </Section>

      <Section title="Privacy">
        <Row icon={<Trash2 size={20} color={t.danger} />} title="Clear history" danger onPress={() => Alert.alert('Clear browsing history?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => app.clearHistory() }])} />
        <Row icon={<Trash2 size={20} color={t.danger} />} title="Close all tabs" danger onPress={() => browser.closeAll()} last />
      </Section>

      <T kind="small" color={t.ink3} style={{ textAlign: 'center' }}>
        OWL Mobile {Constants.expoConfig?.version ?? ''} · keys are stored in the device keychain
      </T>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth },
  nameInput: { flex: 1, fontSize: 16, height: 48 },
  _r: { borderRadius: radius.md },
});
