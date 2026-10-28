import React from 'react';
import { Alert, ScrollView, Switch, TextInput, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { Icon } from '@/components/Icon';
import { useTheme, icon, space } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { ENGINE_NAMES } from '@/lib/url';
import { companionById } from '@/lib/companions';
import { IconWell, LIVE_BLUR, Row, Section, T } from '@/components/ui';
import type { Settings } from '@/lib/types';

function pick<T extends string>(title: string, options: Record<T, string>, current: T, onPick: (v: T) => void) {
  Alert.alert(title, undefined, [
    ...(Object.keys(options) as T[]).map((k) => ({ text: (k === current ? '✓ ' : '') + options[k], onPress: () => onPick(k) })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

const THEMES: Record<Settings['theme'], string> = { system: 'Automatic', light: 'Light', dark: 'Dark' };
const BAR_POS: Record<Settings['barPosition'], string> = { bottom: 'Bottom', top: 'Top' };
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
  const chev = <Icon name="chevron-right" size={icon.sm} color={t.ink3} />;
  const I = { size: icon.md, color: t.ink };

  return (
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={{ padding: space.md, paddingBottom: space.xxxl }} keyboardShouldPersistTaps="handled">
      <Section title="You">
        <View style={styles.nameRow}>
          <IconWell><Icon name="person" {...I} /></IconWell>
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
        <Row icon={<Icon name="people" {...I} />} title="Profile" subtitle={profile?.name} right={chev} onPress={() => router.push('/profiles')} last />
      </Section>

      <Section title="AI">
        <Row icon={<Icon name="developer-board" {...I} />} title="Models" subtitle={model} right={chev} onPress={() => router.push('/settings/models')} />
        <Row icon={<Icon name="bot" {...I} />} title="Companion" subtitle={companionById(s.companionId).name} right={chev} onPress={() => router.push('/companions')} />
        <Row icon={<Icon name="hand-left" {...I} />} title="Ask before" subtitle={APPROVAL[s.approvalMode]} right={chev} onPress={() => pick('Ask before', APPROVAL, s.approvalMode, (v) => app.patchSettings({ approvalMode: v }))} />
        <Row icon={<Icon name="brain-circuit" {...I} />} title="Memory" subtitle={memoryCount ? String(memoryCount) : undefined} right={chev} onPress={() => router.push('/memory')} last />
      </Section>

      <Section title="Browsing">
        <Row icon={<Icon name="search" {...I} />} title="Search engine" subtitle={ENGINE_NAMES[s.searchEngine]} right={chev} onPress={() => pick('Search engine', ENGINE_NAMES, s.searchEngine, (v) => app.patchSettings({ searchEngine: v }))} />
        <Row icon={<Icon name="shield-checkmark" {...I} />} title="Block trackers" right={<Switch value={s.adblock} onValueChange={(v) => app.patchSettings({ adblock: v })} trackColor={{ true: t.accentFill, false: t.surface2 }} thumbColor="#FFFFFF" />} />
        <Row icon={<Icon name="color" {...I} />} title="Appearance" subtitle={THEMES[s.theme]} right={chev} onPress={() => pick('Appearance', THEMES, s.theme, (v) => app.patchSettings({ theme: v }))} last />
      </Section>

      <Section title="Address bar" footer={LIVE_BLUR ? 'Live blur lets the page show through the bar, softly blurred. Turn it off if pages feel slow; the bar then sits on a solid tint.' : 'Live blur needs Android 12 or later; the bar uses a solid tint here.'}>
        <Row
          icon={s.barPosition === 'top' ? <Icon name="document-header" {...I} /> : <Icon name="document-footer" {...I} />}
          title="Address bar position"
          subtitle={BAR_POS[s.barPosition === 'top' ? 'top' : 'bottom']}
          right={chev}
          onPress={() => pick('Address bar position', BAR_POS, s.barPosition === 'top' ? 'top' : 'bottom', (v) => app.patchSettings({ barPosition: v }))}
        />
        <Row icon={<Icon name="drop" {...I} />} title="Live blur" right={<Switch value={LIVE_BLUR && s.glassBlur !== false} disabled={!LIVE_BLUR} onValueChange={(v) => app.patchSettings({ glassBlur: v })} trackColor={{ true: t.accentFill, false: t.surface2 }} thumbColor="#FFFFFF" />} last />
      </Section>

      <Section title="Privacy">
        <Row icon={<Icon name="delete" size={icon.md} color={t.danger} />} title="Clear history" danger onPress={() => Alert.alert('Clear browsing history?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => app.clearHistory() }])} />
        <Row icon={<Icon name="dismiss" size={icon.md} color={t.danger} />} title="Close all tabs" danger onPress={() => browser.closeAll()} last />
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
