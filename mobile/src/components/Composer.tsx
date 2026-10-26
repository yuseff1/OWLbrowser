import React, { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { ArrowUp } from 'lucide-react-native';
import { Image } from 'expo-image';
import { useTheme, radius } from '@/lib/theme';
import { faceFor, companionById } from '@/lib/companions';
import { Tap, haptic } from './ui';

/** Soft neumorphic composer: "Work with Hoot…". */
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
  const send = () => {
    const v = text.trim();
    if (!v) return;
    haptic('medium');
    onSubmit(v);
    setText('');
  };
  return (
    <View
      style={[
        styles.outer,
        {
          backgroundColor: t.neuBg,
          shadowColor: t.neuDark,
          borderColor: t.dark ? 'rgba(255,240,225,0.06)' : 'rgba(255,255,255,0.9)',
        },
      ]}
    >
      {/* the light edge of the neumorphic pair */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.highlight, { borderColor: t.neuLight }]} />
      <Tap label={`Choose companion (now ${c.name})`} onPress={onPickCompanion} style={[styles.face, { backgroundColor: c.look.body + '33' }]}>
        <Image source={faceFor(companionId)} style={{ width: 30, height: 30 }} contentFit="contain" />
      </Tap>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder ?? `Work with ${c.name}…`}
        placeholderTextColor={t.ink3}
        style={[styles.input, { color: t.ink }]}
        multiline
        autoFocus={autoFocus}
        returnKeyType="send"
        submitBehavior="submit"
        onSubmitEditing={send}
        accessibilityLabel={`Message ${c.name}`}
      />
      <Tap label="Send" onPress={send} disabled={!text.trim()} style={[styles.send, { backgroundColor: text.trim() ? t.accent : t.surface2 }]}>
        <ArrowUp size={20} color={text.trim() ? t.accentInk : t.ink3} strokeWidth={2.5} />
      </Tap>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 8,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 6, height: 8 },
    shadowOpacity: Platform.OS === 'ios' ? 0.35 : 0,
    shadowRadius: 16,
    elevation: 4,
  },
  highlight: { borderRadius: radius.xl, borderTopWidth: 1, borderLeftWidth: 1 },
  face: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, fontSize: 17, minHeight: 40, maxHeight: 140, paddingTop: Platform.OS === 'ios' ? 10 : 8, paddingBottom: 8 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
