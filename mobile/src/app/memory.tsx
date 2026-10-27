import React, { useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { Trash2, Plus } from 'lucide-react-native';
import { useTheme, radius, space, icon } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { app, appStore } from '@/state/app';
import { companionById } from '@/lib/companions';
import { Button, Empty, IconButton, T, fieldStyle } from '@/components/ui';

/** On-device memory: what companions remember about you. Injected into every run's system prompt. */
export default function MemoryScreen() {
  const t = useTheme();
  const memory = useStore(appStore, (s) => s.memory);
  const [text, setText] = useState('');

  const add = () => { if (app.addMemory(text, 'fact', 'user')) setText(''); };
  const clear = () => Alert.alert('Forget everything?', undefined, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Forget all', style: 'destructive', onPress: () => app.clearMemory() },
  ]);

  return (
    <FlatList
      style={{ backgroundColor: t.ground }}
      data={memory}
      keyExtractor={(m) => m.id}
      contentContainerStyle={{ padding: space.md }}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ marginBottom: space.md }}>
          <View style={styles.addRow}>
            <TextInput value={text} onChangeText={setText} placeholder="Add a memory" placeholderTextColor={t.ink3} selectionColor={t.accentFill} style={[fieldStyle(t), { flex: 1 }]} onSubmitEditing={add} returnKeyType="done" accessibilityLabel="New memory" />
            <IconButton label="Add memory" disabled={!text.trim()} tint={text.trim() ? t.accentFill : t.surface2} icon={<Plus size={icon.md} color={text.trim() ? t.accentInk : t.ink3} />} onPress={add} />
          </View>
        </View>
      }
      ListEmptyComponent={<Empty text="Nothing remembered" />}
      ListFooterComponent={memory.length ? <Button title="Forget everything" kind="secondary" onPress={clear} style={{ marginTop: 12 }} /> : undefined}
      renderItem={({ item }) => {
        const who = item.source.startsWith('agent:') ? companionById(item.source.slice(6)).name : 'You';
        return (
          <View style={[styles.row, { backgroundColor: t.surface }]}>
            <View style={{ flex: 1 }}>
              <T selectable>{item.text}</T>
              <T kind="footnote">{who} · {new Date(item.createdAt).toLocaleDateString()}</T>
            </View>
            <IconButton label="Delete memory" icon={<Trash2 size={icon.sm} color={t.ink3} />} onPress={() => app.removeMemory(item.id)} />
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: space.md, paddingVertical: space.xs, borderRadius: radius.lg, borderCurve: 'continuous', marginBottom: space.xs },
});
