import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { T, Tap } from './ui';
import { faceFor } from '@/lib/companions';

/** "Controlled by Hoot" — animated glowing ring drawn natively over the WebView the agent is driving. */
export function ControlRing({ name, companionId, color, onPress }: { name: string; companionId: string; color: string; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: color, shadowColor: color, opacity }]} />
      <View style={styles.pillWrap} pointerEvents="box-none">
        <Tap label={`Controlled by ${name}. Open run`} onPress={onPress} style={[styles.pill, { backgroundColor: color }]}>
          <Image source={faceFor(companionId)} style={styles.face} contentFit="contain" />
          <T style={styles.pillText} color="#fff">Controlled by {name}</T>
        </Tap>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderWidth: 3,
    borderRadius: 18,
    margin: 2,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
  pillWrap: { position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4, paddingRight: 12, height: 32, borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  face: { width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.25)' },
  pillText: { fontSize: 13, fontWeight: '600' },
});
