import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';
import { motion } from './theme';

/**
 * How far floating bottom chrome must rise to sit on top of the keyboard.
 *
 * Android (SDK 58) is edge-to-edge: `softwareKeyboardLayoutMode: "resize"` no longer shrinks the window, so the
 * keyboard simply covers anything anchored to the bottom (the address bar used to stay hidden behind it).
 * We take the keyboard's top edge from the event and compare it with the bottom of our own root view, so on a
 * device that *does* still resize, the lift comes out as 0 instead of double-counting.
 *
 * `rootHeight` is the height of the full-screen root view (it starts at screen y = 0 in edge-to-edge).
 */
export function useKeyboardLift(rootHeight: number) {
  const [kbTop, setKbTop] = useState<number | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const lift = kbTop == null || !rootHeight ? 0 : Math.max(0, Math.round(rootHeight - kbTop));

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => {
      const c = e.endCoordinates;
      const top = Number.isFinite(c.screenY) && c.screenY > 0 ? c.screenY : Dimensions.get('window').height - c.height;
      setKbTop(top);
    };
    const s1 = Keyboard.addListener(showEvt, onShow);
    // iOS: follow the keyboard as it changes height (emoji / predictive bar).
    const s2 = Platform.OS === 'ios' ? Keyboard.addListener('keyboardWillChangeFrame', onShow) : null;
    const s3 = Keyboard.addListener(hideEvt, () => setKbTop(null));
    return () => { s1.remove(); s2?.remove(); s3.remove(); };
  }, []);

  useEffect(() => {
    Animated.spring(anim, { toValue: lift, ...motion.spring.smooth, useNativeDriver: true }).start();
  }, [lift, anim]);

  return { lift, anim, open: kbTop != null };
}
