import React from 'react';
import { ScrollView, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, Cloud, Wifi, Plus, KeyRound } from 'lucide-react-native';
import { useTheme, space, radius, icon } from '@/lib/theme';
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
    <ScrollView style={{ backgroundColor: t.ground }} contentContainerStyle={{ padding: space.md, paddingBottom: space.xxxl }}>
      {providers.length ? (
        <Section title="Your models">
          {providers.map((p, i) => (
            <Row
              key={p.id}
              last={i === providers.length - 1}
              icon={p.local ? <Wifi size={icon.md} color={t.ink} /> : <Cloud size={icon.md} color={t.ink} />}
              title={p.name}
              subtitle={def?.providerId === p.id ? def.model : !p.local && !p.hasKey ? 'No key' : `${p.models.length} models`}
              right={def?.providerId === p.id ? <Check size={icon.md} color={t.accent} /> : !p.local && !p.hasKey ? <KeyRound size={icon.sm} color={t.ink3} /> : null}
              onPress={() => router.push({ pathname: '/settings/provider', params: { id: p.id } })}
            />
          ))}
        </Section>
      ) : (
        <T kind="title" style={styles.intro}>Add a model</T>
      )}

      <Section title="On your network" footer="Same Wi-Fi as this phone.">
        {LOCAL_KINDS.map((k, i) => (
          <Row key={k} last={i === LOCAL_KINDS.length - 1} icon={<Wifi size={icon.md} color={t.ink} />} title={PROVIDER_PRESETS[k].name} subtitle={PROVIDER_PRESETS[k].hint} right={<Plus size={icon.md} color={t.ink3} />} onPress={() => router.push({ pathname: '/settings/provider', params: { kind: k } })} />
        ))}
      </Section>

      <Section title="Cloud">
        {CLOUD_KINDS.map((k, i) => (
          <Row key={k} last={i === CLOUD_KINDS.length - 1} icon={<Cloud size={icon.md} color={t.ink} />} title={PROVIDER_PRESETS[k].name} right={<Plus size={icon.md} color={t.ink3} />} onPress={() => router.push({ pathname: '/settings/provider', params: { kind: k } })} />
        ))}
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  intro: { marginTop: space.xs, marginBottom: space.xl, marginLeft: space.xxs },
});
