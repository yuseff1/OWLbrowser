import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Keyboard, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from './Icon';
import { Glass, IconButton, T, haptic } from './ui';
import { useTheme, space, icon, motion } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { browserStore, webviews } from '@/state/browser';
import { pageUiStore } from '@/state/pageui';
import { FIND_CLEAR_SCRIPT, findScript, findStepScript } from '@/lib/page-tools';
import { DOCK_GAP } from './BottomBar';

const PAD = 6;
const H = 48;

export function openFind() {
  const id = browserStore.get().activeId;
  pageUiStore.set({ find: { tabId: id, query: '', count: 0, index: -1 } });
}

export function closeFind() {
  const f = pageUiStore.get().find;
  if (!f) return;
  pageUiStore.set({ find: null });
  webviews.eval(f.tabId, FIND_CLEAR_SCRIPT, 3000).catch(() => {});
}

type Result = { count: number; index: number };

/**
 * Find in page: takes the dock's place (same glass capsule and edge) while open, rides the keyboard like the dock.
 * Matches are highlighted in amber in the page; Enter / the chevrons step through them.
 */
export function FindBar({ lift, liftAnim, position = 'bottom' }: { lift: number; liftAnim: Animated.Value; position?: 'top' | 'bottom' }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const find = useStore(pageUiStore, (s) => s.find);
  const activeId = useStore(browserStore, (s) => s.activeId);
  const activeUrl = useStore(browserStore, (s) => s.tabs.find((x) => x.id === s.activeId)?.url || '');
  const [q, setQ] = useState('');
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const top = position === 'top';
  const tabId = find?.tabId || '';
  const startUrl = useRef(activeUrl);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 60); }, []);

  // Leaving the tab or the page ends the search (the marks went with the old page).
  useEffect(() => { if (find && (activeId !== find.tabId || activeUrl !== startUrl.current)) closeFind(); }, [activeId, activeUrl, find]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeFind(); return true; });
    return () => sub.remove();
  }, []);

  const apply = (r: Result | null) => {
    const f = pageUiStore.get().find;
    if (!f) return;
    pageUiStore.set({ find: { ...f, count: r?.count || 0, index: r ? r.index : -1 } });
  };

  // Debounced search as you type.
  const seq = useRef(0);
  useEffect(() => {
    if (!tabId) return;
    const my = ++seq.current;
    const h = setTimeout(() => {
      webviews.eval<Result>(tabId, findScript(q), 6000).then((r) => { if (my === seq.current) apply(r); }).catch(() => { if (my === seq.current) apply(null); });
    }, q ? 180 : 0);
    const f = pageUiStore.get().find;
    if (f) pageUiStore.set({ find: { ...f, query: q } });
    return () => clearTimeout(h);
  }, [q, tabId]);

  const step = (dir: 1 | -1) => {
    if (!find || !find.count) return;
    haptic('selection');
    webviews.eval<Result>(tabId, findStepScript(dir), 3000).then(apply).catch(() => {});
  };

  const done = () => { Keyboard.dismiss(); closeFind(); };
  const bottomPad = lift > 0 ? space.xs : Math.max(insets.bottom, space.xs);
  const counter = !q ? '' : find && find.count ? `${find.index + 1}/${find.count}` : '0/0';

  return (
    <Animated.View
      style={[styles.wrap, top ? { top: insets.top + DOCK_GAP } : { bottom: 0, paddingBottom: bottomPad, transform: [{ translateY: Animated.multiply(liftAnim, -1) }] }]}
      pointerEvents="box-none"
    >
      <Glass rounded={H / 2 + PAD} live={false} intensity={100} style={styles.glass}>
        <View style={styles.row}>
          <View style={styles.lead}><Icon name="search" size={icon.sm} color={t.glass.ink2} /></View>
          <TextInput
            ref={inputRef}
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => step(1)}
            blurOnSubmit={false}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            placeholder="Find in page"
            placeholderTextColor={t.glass.ink2}
            selectionColor={t.accentFill}
            style={[styles.input, { color: t.ink }]}
            accessibilityLabel="Find in page"
          />
          {counter ? <T kind="footnote" color={find?.count ? t.ink2 : t.danger} style={styles.count}>{counter}</T> : null}
          <IconButton size={40} label="Previous match" disabled={!find?.count} icon={<Icon name="chevron-up" size={icon.md} color={t.ink} />} onPress={() => step(-1)} />
          <IconButton size={40} label="Next match" disabled={!find?.count} icon={<Icon name="chevron-down" size={icon.md} color={t.ink} />} onPress={() => step(1)} />
          <IconButton size={40} label="Close find" icon={<Icon name="dismiss" size={icon.md} color={t.ink} />} onPress={done} />
        </View>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: DOCK_GAP },
  glass: { padding: PAD },
  row: { flexDirection: 'row', alignItems: 'center', height: H, paddingHorizontal: 2 },
  lead: { width: 36, alignItems: 'center' },
  input: { flex: 1, fontSize: 16, height: 44, paddingHorizontal: 2, paddingVertical: 0, minWidth: 0 },
  count: { fontVariant: ['tabular-nums'], marginHorizontal: space.xxs },
});
