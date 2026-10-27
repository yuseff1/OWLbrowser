import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Check, ExternalLink, RefreshCw } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { PROVIDER_PRESETS } from '@/lib/providers';
import { discoverModels, testModel } from '@/lib/agent/llm';
import { Button, Row, Section, T, Tap } from '@/components/ui';
import type { ProviderKind } from '@/lib/types';

/** Add / edit one provider: base URL, API key (SecureStore), model discovery, test, set default. */
export default function ProviderScreen() {
  const t = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; kind?: string }>();
  const existing = useStore(appStore, (s) => (params.id ? s.providers.find((p) => p.id === params.id) : undefined));
  const def = useStore(appStore, (s) => s.settings.defaultModel);
  const kind = (existing?.kind || params.kind || 'openrouter') as ProviderKind;
  const preset = PROVIDER_PRESETS[kind];
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl || preset.baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>(existing?.models || preset.models);
  const [manual, setManual] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<'' | 'save' | 'discover' | 'test'>('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const providerId = existing?.id;

  useEffect(() => { if (existing) setModels(existing.models); }, [existing?.models]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (extra: { models?: string[] } = {}) => {
    const p = await app.upsertProvider({ id: providerId, kind, baseUrl, models: extra.models ?? models, ...(apiKey ? { apiKey } : {}) });
    setApiKey('');
    if (!providerId) router.setParams({ id: p.id, kind: undefined } as any);
    return p;
  };

  const discover = async () => {
    setBusy('discover'); setStatus(null);
    try {
      const p = await save();
      const ids = await discoverModels(p);
      if (ids.length) { setModels(ids); await app.upsertProvider({ id: p.id, kind, models: ids }); setStatus({ ok: true, text: `Found ${ids.length} models.` }); }
      else setStatus({ ok: false, text: 'The server returned no models.' });
    } catch (e: any) {
      setStatus({ ok: false, text: `Couldn't list models: ${e?.message || e}. ${preset.local ? 'Check the IP/port and that the server listens on your network.' : 'Check the key.'}` });
    } finally { setBusy(''); }
  };

  const useModel = async (m: string) => {
    const p = await save();
    app.patchSettings({ defaultModel: { providerId: p.id, model: m } });
  };

  const test = async () => {
    setBusy('test'); setStatus(null);
    const p = await save();
    const m = def?.providerId === p.id ? def.model : models[0];
    if (!m) { setBusy(''); setStatus({ ok: false, text: 'Add or discover a model first.' }); return; }
    const r = await testModel({ providerId: p.id, model: m });
    setStatus(r.ok ? { ok: true, text: `${m} replied “${r.text}” in ${r.ms} ms.` } : { ok: false, text: r.error || 'Failed' });
    setBusy('');
  };

  const remove = () => Alert.alert(`Remove ${existing?.name}?`, 'Its API key is deleted from this device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => { await app.removeProvider(providerId!); router.back(); } },
  ]);

  const shown = filter ? models.filter((m) => m.toLowerCase().includes(filter.toLowerCase())) : models;

  return (
    <>
      <Stack.Screen options={{ title: existing?.name || preset.name }} />
      <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {preset.hint ? <T kind="small" style={{ marginBottom: 14 }}>{preset.hint}</T> : null}
        <Section title={preset.local ? 'Server address' : 'Connection'}>
          <View style={styles.field}>
            <T kind="tiny" color={t.ink3}>Base URL</T>
            <TextInput value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={[styles.input, { color: t.ink, backgroundColor: t.surface2 }]} accessibilityLabel="Base URL" />
          </View>
          {!preset.local || kind === 'custom' ? (
            <View style={styles.field}>
              <T kind="tiny" color={t.ink3}>API key {existing?.hasKey ? '(saved — type to replace)' : ''}</T>
              <TextInput value={apiKey} onChangeText={setApiKey} placeholder={existing?.hasKey ? '••••••••••••' : 'Paste your key'} placeholderTextColor={t.ink3} autoCapitalize="none" autoCorrect={false} secureTextEntry style={[styles.input, { color: t.ink, backgroundColor: t.surface2 }]} accessibilityLabel="API key" />
              {preset.keyUrl ? (
                <Tap label="Get a key" onPress={() => Linking.openURL(preset.keyUrl!)} style={styles.link}>
                  <ExternalLink size={14} color={t.accent} />
                  <T kind="small" color={t.accent}>Get a key</T>
                </Tap>
              ) : null}
            </View>
          ) : null}
          <View style={[styles.field, { flexDirection: 'row', gap: 10 }]}>
            <Button title="Save" kind="secondary" onPress={async () => { setBusy('save'); await save(); setBusy(''); setStatus({ ok: true, text: 'Saved.' }); }} style={{ flex: 1 }} />
            <Button title="Test" onPress={test} style={{ flex: 1 }} />
          </View>
          {busy ? <ActivityIndicator color={t.accent} style={{ marginBottom: 12 }} /> : null}
          {status ? <T kind="small" color={status.ok ? t.success : t.danger} style={{ paddingHorizontal: 16, paddingBottom: 14 }}>{status.text}</T> : null}
        </Section>

        <Section title="Models" footer="Tap a model to make it the default for all companions.">
          <View style={[styles.field, { flexDirection: 'row', gap: 8 }]}>
            <TextInput value={filter || manual} onChangeText={(v) => { setFilter(v); setManual(v); }} placeholder="Filter or type a model id" placeholderTextColor={t.ink3} autoCapitalize="none" autoCorrect={false} style={[styles.input, { flex: 1, color: t.ink, backgroundColor: t.surface2 }]} accessibilityLabel="Model id" />
            <Button title="Discover" kind="secondary" icon={<RefreshCw size={14} color={t.ink} />} onPress={discover} />
          </View>
          {manual && !models.includes(manual) ? (
            <Row title={`Use “${manual}”`} subtitle="Add this model id" onPress={async () => { const next = [manual, ...models]; setModels(next); await save({ models: next }); await useModel(manual); setManual(''); setFilter(''); }} />
          ) : null}
          {shown.slice(0, 200).map((m, i) => {
            const on = def?.providerId === providerId && def?.model === m;
            return <Row key={m} last={i === Math.min(shown.length, 200) - 1} title={m} right={on ? <Check size={18} color={t.accent} /> : null} onPress={() => useModel(m)} />;
          })}
          {!shown.length ? <T kind="small" style={{ padding: 16 }}>No models</T> : null}
        </Section>

        {existing ? <Button title="Remove provider" kind="ghost" onPress={remove} /> : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  field: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 6 },
  input: { height: 44, borderRadius: radius.sm, paddingHorizontal: 14, fontSize: 16 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
});
