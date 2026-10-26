import React from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Cloud, Wifi, Plus, KeyRound } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { appStore } from '@/state/app';
import { PROVIDER_PRESETS, CLOUD_KINDS, LOCAL_KINDS } from '@/lib/providers';
import { Row, Section, T } from '@/components/ui';

/** Settings → Models: your providers, plus presets (cloud) and "Local on my network". */
export default function ModelsScreen() {
  const t = useTheme();
  const router = useRouter();
  const providers = useStore(appStore, (s) => s.providers);
  const def = useStore(appStore, (s) => s.settings.defaultModel);

  return (
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {providers.length ? (
        <Section title="Your models" footer="The default model powers every companion run.">
          {providers.map((p, i) => (
            <Row
              key={p.id}
              last={i === providers.length - 1}
              icon={p.local ? <Wifi size={20} color={t.ink2} /> : <Cloud size={20} color={t.ink2} />}
              title={p.name}
              subtitle={def?.providerId === p.id ? `Default · ${def.model}` : !p.local && !p.hasKey ? 'No API key yet' : `${p.models.length} model${p.models.length === 1 ? '' : 's'}`}
              right={def?.providerId === p.id ? <Check size={18} color={t.accent} /> : !p.local && !p.hasKey ? <KeyRound size={16} color={t.warn} /> : null}
              onPress={() => router.push({ pathname: '/settings/provider', params: { id: p.id } })}
            />
          ))}
        </Section>
      ) : (
        <View style={[styles.intro, { backgroundColor: t.accentSoft }]}>
          <T style={{ fontWeight: '600' }}>Connect a model to wake up your companions</T>
          <T kind="small" style={{ marginTop: 4 }}>Paste an API key from any provider below, or point OWL at Ollama / LM Studio running on a computer on your Wi-Fi. Keys stay in your phone's secure keychain.</T>
        </View>
      )}

      <Section title="Local on my network" footer="Runs on your own computer: free and private. Your phone must be on the same Wi-Fi.">
        {LOCAL_KINDS.map((k, i) => (
          <Row key={k} last={i === LOCAL_KINDS.length - 1} icon={<Wifi size={20} color={t.success} />} title={PROVIDER_PRESETS[k].name} subtitle={PROVIDER_PRESETS[k].hint} right={<Plus size={18} color={t.accent} />} onPress={() => router.push({ pathname: '/settings/provider', params: { kind: k } })} />
        ))}
      </Section>

      <Section title="Cloud providers">
        {CLOUD_KINDS.map((k, i) => (
          <Row key={k} last={i === CLOUD_KINDS.length - 1} icon={<Cloud size={20} color={t.ink2} />} title={PROVIDER_PRESETS[k].name} subtitle={PROVIDER_PRESETS[k].hint || PROVIDER_PRESETS[k].models.slice(0, 2).join(', ')} right={<Plus size={18} color={t.accent} />} onPress={() => router.push({ pathname: '/settings/provider', params: { kind: k } })} />
        ))}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  intro: { padding: 16, borderRadius: 16, marginBottom: 22 },
});
