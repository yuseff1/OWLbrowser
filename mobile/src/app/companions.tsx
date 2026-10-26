import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { COMPANIONS, artFor } from '@/lib/companions';
import { T, Tap, haptic } from '@/components/ui';

/** Pick which owl you work with. Same crew as desktop. */
export default function CompanionsScreen() {
  const t = useTheme();
  const router = useRouter();
  const current = useStore(appStore, (s) => s.settings.companionId);
  return (
    <FlatList
      style={{ backgroundColor: t.ground }}
      data={COMPANIONS}
      keyExtractor={(c) => c.id}
      numColumns={2}
      columnWrapperStyle={{ gap: 12 }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      renderItem={({ item }) => {
        const on = item.id === current;
        return (
          <Tap
            label={`${item.name}, ${item.role}${on ? ', selected' : ''}`}
            onPress={() => { haptic('success'); app.patchSettings({ companionId: item.id }); router.back(); }}
            style={[styles.card, { backgroundColor: t.surface, borderColor: on ? item.look.body : t.line, borderWidth: on ? 2.5 : StyleSheet.hairlineWidth }]}
          >
            <View style={[styles.art, { backgroundColor: item.look.body + (t.dark ? '26' : '1F') }]}>
              <Image source={artFor(item.id)} style={{ width: '88%', height: '88%' }} contentFit="contain" />
              {on ? <View style={[styles.check, { backgroundColor: item.look.body }]}><Check size={14} color="#fff" strokeWidth={3} /></View> : null}
            </View>
            <View style={{ padding: 12, gap: 2 }}>
              <T style={{ fontSize: 17, fontWeight: '700' }}>{item.name}</T>
              <T kind="small" color={item.look.body} style={{ fontWeight: '600' }}>{item.role}</T>
              <T kind="small" numberOfLines={3}>{item.tagline}</T>
            </View>
          </Tap>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: radius.lg, overflow: 'hidden' },
  art: { height: 150, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
