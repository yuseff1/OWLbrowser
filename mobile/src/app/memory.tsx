import React, { useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { Brain, Trash2, Plus } from 'lucide-react-native';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { companionById } from '@/lib/companions';
import { Button, IconButton, T } from '@/components/ui';

/** On-device memory: what companions remember about you. Injected into every run's system prompt. */
export default function MemoryScreen() {
  const t = useTheme();
  const memory = useStore(appStore, (s) => s.memory);
  const [text, setText] = useState('');

  const add = () => { if (app.addMemory(text, 'fact', 'user')) setText(''); };
  const clear = () => Alert.alert('Forget everything?', 'Companions will no longer remember anything about you in this profile.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Forget all', style: 'destructive', onPress: () => app.clearMemory() },
  ]);

  return (
    <FlatList
      style={{ backgroundColor: t.ground }}
      data={memory}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ padding: 16 }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ marginBottom: 14, gap: 10 }}>
          <T kind="small">Stored only on this device, per profile. Companions save things with “remember”, and read them before every task.</T>
          <View style={styles.addRow}>
            <TextInput value={text} onChangeText={setText} placeholder="Add something to remember…" placeholderTextColor={t.ink3} style={[styles.input, { backgroundColor: t.surface2, color: t.ink }]} onSubmitEditing={add} returnKeyType="done" accessibilityLabel="New memory" />
            <IconButton label="Add memory" disabled={!text.trim()} tint={text.trim() ? t.accent : t.surface2} icon={<Plus size={20} color={text.trim() ? t.accentInk : t.ink3} />} onPress={add} />
          </View>
        </View>
      }
      ListEmptyComponent={
        <View style={styles.empty}>
          <Brain size={34} color={t.ink3} />
          <T style={{ fontWeight: '600' }}>Nothing remembered yet</T>
        </View>
      }
      ListFooterComponent={memory.length ? <Button title="Forget everything" kind="secondary" onPress={clear} style={{ marginTop: 12 }} /> : undefined}
      renderItem={({ item }) => {
        const who = item.source.startsWith('agent:') ? companionById(item.source.slice(6)).name : 'You';
        return (
          <View style={[styles.row, { backgroundColor: t.surface, borderColor: t.line }]}>
            <View style={{ flex: 1 }}>
              <T style={{ fontSize: 15 }} selectable>{item.text}</T>
              <T kind="small" color={t.ink3}>{item.kind} · {who} · {new Date(item.createdAt).toLocaleDateString()}</T>
            </View>
            <IconButton label="Delete memory" icon={<Trash2 size={18} color={t.ink3} />} onPress={() => app.removeMemory(item.id)} />
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, height: 44, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingVertical: 8, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginBottom: 8 },
  empty: { alignItems: 'center', gap: 8, marginTop: 60 },
});
