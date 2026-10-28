import React, { memo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { FILLED, REGULAR, type Art, type IconName } from './icons.generated';

export type { IconName };

/**
 * Microsoft Fluent UI System Icons (MIT), same set as desktop. Regular style everywhere; `filled` only for an
 * active/on state (saved star, desktop site on, stop while running). Fluent draws separate art per size, so we pick
 * the art made for the size we render at (16 → ≤16 pt, 20 → 17–21 pt, 24 → ≥22 pt) instead of scaling one drawing.
 * Pure react-native-svg (already in the native build), so this ships over the air.
 */
export const Icon = memo(function Icon({ name, size = 20, color = '#000', filled = false, style }: { name: IconName; size?: number; color?: string; filled?: boolean; style?: StyleProp<ViewStyle> }) {
  const art: Art = (filled && FILLED[name]) || REGULAR[name];
  const k = size >= 22 && art[24] ? 24 : size <= 16 && art[16] ? 16 : 20;
  const d = art[k as 16 | 20 | 24] || art[20];
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${k} ${k}`} fill={color} style={style} pointerEvents="none">
      {d.map((p, i) => <Path key={i} d={p} />)}
    </Svg>
  );
});
