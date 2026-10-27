import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme, radius, space } from '@/lib/theme';
import { T, Tap } from './ui';
import { faceFor } from '@/lib/companions';

/** Shown over the tab a companion is driving: a quiet amber edge and one pill to open the run. */
export function ControlRing({ name, companionId, onPress }: { name: string; companionId: string; color?: string; onPress: () => void }) {
  const t = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: t.accentFill, opacity }]} />
      <View style={styles.pillWrap} pointerEvents="box-none">
        <Tap label={`${name} is working. Open`} onPress={onPress} style={[styles.pill, { backgroundColor: t.dark ? '#1A1917' : '#FFFFFF', boxShadow: t.glass.shadow }]}>
          <Image source={faceFor(companionId)} style={styles.face} contentFit="cover" />
          <T kind="footnote" style={{ fontWeight: '600' }} color={t.ink}>{name}</T>
          <View style={[styles.dot, { backgroundColor: t.accentFill }]} />
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderRadius: radius.lg, margin: 2 },
  pillWrap: { position: 'absolute', top: space.sm, left: 0, right: 0, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingLeft: 4, paddingRight: space.sm, height: 36, borderRadius: 18 },
  face: { width: 28, height: 28, borderRadius: 14 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
