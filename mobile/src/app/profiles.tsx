import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Trash2 } from 'lucide-react-native';
import { useTheme, space, icon } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { agent, agentStore } from '@/state/agent';
import { Button, IconButton, Row, Section, T, Tap, fieldStyle } from '@/components/ui';

const COLORS = ['#E8A317', '#3CC48A', '#14B8C4', '#FF9A3D', '#F2645A', '#8C857D'];

/**
 * Profiles keep separate tabs, bookmarks, history, memory and settings.
 * "Isolated" profiles also run every page without persistent cookies/storage (WebView incognito),
 * because mobile WebViews share one cookie jar per app and can't hold several persistent jars.
 */
export default function ProfilesScreen() {
  const t = useTheme();
  const router = useRouter();
  const profiles = useStore(appStore, (s) => s.profiles);
  const current = useStore(appStore, (s) => s.profileId);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[2]);
  const [isolated, setIsolated] = useState(true);

  const switchTo = async (id: string) => {
    if (id === current) return;
    const run = agentStore.get().activeRunId;
    if (run) agent.stop(run);
    await app.switchProfile(id);
    await browser.reloadForProfile();
    router.back();
  };

  const create = async () => {
    const p = app.addProfile(name || 'Work', color, isolated);
    setName('');
    await switchTo(p.id);
  };

  const remove = (id: string, n: string) => Alert.alert(`Delete “${n}”?`, 'Its tabs, bookmarks, history and memory are deleted from this device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => { await app.removeProfile(id); await browser.reloadForProfile(); } },
  ]);

  return (
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={{ padding: space.md }} keyboardShouldPersistTaps="handled">
      <Section title="Profiles">
        {profiles.map((p, i) => (
          <Row
            key={p.id}
            last={i === profiles.length - 1}
            icon={<View style={[styles.dot, { backgroundColor: p.color }]}><T style={{ fontSize: 13, fontWeight: '700' }} color="#fff">{p.name.slice(0, 1).toUpperCase()}</T></View>}
            title={p.name}
            subtitle={p.isolated ? 'Isolated' : undefined}
            onPress={() => switchTo(p.id)}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {p.id === current ? <Check size={icon.md} color={t.accent} /> : null}
                {p.id !== 'default' ? <IconButton label={`Delete ${p.name}`} icon={<Trash2 size={icon.sm} color={t.ink3} />} onPress={() => remove(p.id, p.name)} /> : null}
              </View>
            }
          />
        ))}
      </Section>

      <Section title="New profile" footer="Isolated profiles don't keep cookies.">
        <View style={{ padding: space.md, gap: space.md }}>
          <TextInput value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={t.ink3} selectionColor={t.accentFill} style={fieldStyle(t)} accessibilityLabel="Profile name" />
          <View style={styles.colors}>
            {COLORS.map((c) => (
              <Tap key={c} label={`Colour ${c}`} onPress={() => { setColor(c); }} haptics={false} style={[styles.swatch, { borderColor: color === c ? t.ink : 'transparent' }]}><View style={[styles.swatchInner, { backgroundColor: c }]} /></Tap>
            ))}
          </View>
          <View style={styles.switchRow}>
            <T style={{ flex: 1 }}>Isolated</T>
            <Switch value={isolated} onValueChange={setIsolated} trackColor={{ true: t.accentFill, false: t.surface2 }} thumbColor="#FFFFFF" />
          </View>
          <Button title="Create" onPress={create} />
        </View>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatchInner: { width: 32, height: 32, borderRadius: 16 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
});
