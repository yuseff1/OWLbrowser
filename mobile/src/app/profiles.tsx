import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Trash2 } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { browser } from '@/state/browser';
import { agent, agentStore } from '@/state/agent';
import { Button, IconButton, Row, Section, T, Tap } from '@/components/ui';

const COLORS = ['#E8A317', '#4C6FFF', '#2FCB94', '#FF9A3D', '#FF6F91', '#14B8C4', '#E5484D', '#8C857D'];

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
  const [color, setColor] = useState(COLORS[1]);
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
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Section title="Profiles">
        {profiles.map((p, i) => (
          <Row
            key={p.id}
            last={i === profiles.length - 1}
            icon={<View style={[styles.dot, { backgroundColor: p.color }]}><T style={{ fontSize: 13, fontWeight: '700' }} color="#fff">{p.name.slice(0, 1).toUpperCase()}</T></View>}
            title={p.name}
            subtitle={p.isolated ? 'Isolated · cookies not kept between sessions' : 'Keeps you signed in'}
            onPress={() => switchTo(p.id)}
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {p.id === current ? <Check size={20} color={t.accent} /> : null}
                {p.id !== 'default' ? <IconButton label={`Delete ${p.name}`} icon={<Trash2 size={18} color={t.ink3} />} onPress={() => remove(p.id, p.name)} /> : null}
              </View>
            }
          />
        ))}
      </Section>

      <Section title="New profile" footer="Each profile has its own tabs, bookmarks, history, memory, companion and settings. Isolated profiles browse without persistent cookies, so sites from your other profiles can't see your sign-ins.">
        <View style={{ padding: 16, gap: 14 }}>
          <TextInput value={name} onChangeText={setName} placeholder="Name (e.g. Work)" placeholderTextColor={t.ink3} style={[styles.input, { backgroundColor: t.surface2, color: t.ink }]} accessibilityLabel="Profile name" />
          <View style={styles.colors}>
            {COLORS.map((c) => (
              <Tap key={c} label={`Colour ${c}`} onPress={() => setColor(c)} style={[styles.swatch, { backgroundColor: c, borderColor: color === c ? t.ink : 'transparent' }]} />
            ))}
          </View>
          <View style={styles.switchRow}>
            <T style={{ flex: 1 }}>Isolated (no persistent cookies)</T>
            <Switch value={isolated} onValueChange={setIsolated} trackColor={{ true: t.accent }} />
          </View>
          <Button title="Create and switch" onPress={create} />
        </View>
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  input: { height: 44, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16 },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 3 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
