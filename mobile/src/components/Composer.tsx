import React, { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { Icon } from './Icon';
import { Image } from 'expo-image';
import { useTheme, radius, space, icon } from '@/lib/theme';
import { faceFor, companionById } from '@/lib/companions';
import { Tap, haptic } from './ui';

/** Flat message field: companion face (tap to switch), text, send. */
export function Composer({ companionId, onSubmit, onPickCompanion, autoFocus, placeholder }: {
  companionId: string;
  onSubmit: (text: string) => void;
  onPickCompanion?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const t = useTheme();
  const [text, setText] = useState('');
  const c = companionById(companionId);
  const ready = !!text.trim();
  const send = () => {
    const v = text.trim();
    if (!v) return;
    haptic('medium');
    onSubmit(v);
    setText('');
  };
  return (
    <View style={[styles.box, { backgroundColor: t.surface }]}>
      <Tap label={`Companion: ${c.name}. Change`} onPress={onPickCompanion} style={styles.face} feedback="opacity">
        <Image source={faceFor(companionId)} style={{ width: 30, height: 30, borderRadius: 15 }} contentFit="cover" />
      </Tap>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder ?? `Ask ${c.name}`}
        placeholderTextColor={t.ink3}
        selectionColor={t.accentFill}
        style={[styles.input, { color: t.ink }]}
        multiline
        autoFocus={autoFocus}
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={send}
        accessibilityLabel={`Message ${c.name}`}
      />
      <Tap label="Send" onPress={send} disabled={!ready} style={[styles.send, { backgroundColor: ready ? t.accentFill : t.surface2 }]}>
        <Icon name="arrow-up" size={icon.md} color={ready ? t.accentInk : t.ink3} />
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xxs, padding: 6, borderRadius: radius.xl, borderCurve: 'continuous' },
  face: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, fontSize: 16, minHeight: 44, maxHeight: 140, paddingTop: Platform.OS === 'ios' ? 12 : 10, paddingBottom: 10 },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
