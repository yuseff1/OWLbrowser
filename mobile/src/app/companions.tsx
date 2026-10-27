import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Check } from 'lucide-react-native';
import { useTheme, radius, space } from '@/lib/theme';
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
      columnWrapperStyle={{ gap: space.sm }}
      contentContainerStyle={{ padding: space.md, gap: space.sm }}
      renderItem={({ item }) => {
        const on = item.id === current;
        return (
          <Tap
            label={`${item.name}, ${item.role}${on ? ', selected' : ''}`}
            onPress={() => { haptic('selection'); app.patchSettings({ companionId: item.id }); router.back(); }}
            style={[styles.card, { backgroundColor: t.surface, borderColor: on ? t.accentFill : 'transparent' }]}
          >
            <View style={styles.art}>
              <Image source={artFor(item.id)} style={{ width: '72%', height: '72%' }} contentFit="contain" />
              {on ? <View style={[styles.check, { backgroundColor: t.accentFill }]}><Check size={14} color={t.accentInk} /></View> : null}
            </View>
            <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>
              <T kind="headline">{item.name}</T>
              <T kind="footnote" numberOfLines={1}>{item.role}</T>
            </View>
          </Tap>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: radius.lg, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 2 },
  art: { height: 140, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
