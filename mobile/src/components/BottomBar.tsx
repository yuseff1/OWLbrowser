import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, FlatList, Keyboard, PanResponder, Platform, Share, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Icon } from './Icon';
import * as Clipboard from 'expo-clipboard';
import { useTheme, radius, space, icon, motion } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { appStore } from '@/state/app';
import { browser, browserStore, EMPTY_RUNTIME } from '@/state/browser';
import { agent, agentStore } from '@/state/agent';
import { companionById, faceFor } from '@/lib/companions';
import { displayUrl, faviconFor, hostOf, isSecure, toUrl, ENGINE_NAMES } from '@/lib/url';
import { Glass, IconButton, IconWell, T, Tap, haptic, useSqueeze } from './ui';

/**
 * Dock geometry. One glass shape, inset PAD on every side, so radii are concentric in every state:
 * outer radius = capsule radius + PAD (24 + 6 = 30). Editing drops the toolbar row; the insets stay the same.
 */
const PAD = 6;
const ADDRESS_H = 48;
const TOOLBAR_H = 48;
const CAPSULE_R = ADDRESS_H / 2;
export const DOCK_RADIUS = CAPSULE_R + PAD;
/** full dock (capsule + toolbar), excluding the edge gap / safe area */
export const DOCK_H = PAD + ADDRESS_H + TOOLBAR_H + PAD;
const EDIT_H = PAD + ADDRESS_H + PAD;
/** gap between the dock and the screen edge (sides, and top in top mode) */
export const DOCK_GAP = space.xs;
export type DockPosition = 'top' | 'bottom';
const PRIVATE_WELL = '#1E1C1A';
const PRIVATE_INK = '#F4EFE8';
const PRIVATE_INK2 = 'rgba(244,239,232,0.62)';

type Suggestion = { key: string; kind: 'search' | 'url' | 'history' | 'bookmark' | 'ask'; title: string; subtitle?: string; value: string };

/**
 * Floating liquid-glass dock: address capsule + toolbar in one glass shape, at the bottom (default) or the top.
 * Bottom: rises with the keyboard (lift comes from the screen, see useKeyboardLift). Top: stays under the status bar
 * and the suggestions open downward to the keyboard. Switching position slides the dock in from its new edge.
 */
export function BottomBar({ onOpenMenu, lift, liftAnim, position = 'bottom' }: { onOpenMenu: () => void; lift: number; liftAnim: Animated.Value; position?: DockPosition }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tab = useStore(browserStore, (s) => s.tabs.find((x) => x.id === s.activeId) || s.tabs[0]);
  const tabCount = useStore(browserStore, (s) => s.tabs.length);
  const rt = useStore(browserStore, (s) => s.runtime[s.activeId] || EMPTY_RUNTIME);
  const { companionId, engine } = useStore(appStore, (s) => ({ companionId: s.settings.companionId, engine: s.settings.searchEngine }));
  const activeRun = useStore(agentStore, (s) => s.runs.find((r) => r.id === s.activeRunId) || null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const c = companionById(companionId);
  const url = tab?.url || '';
  const squeeze = useSqueeze({ origin: position === 'top' ? 'top' : 'bottom' });

  const startEdit = () => {
    squeeze.handlers.onTouchEnd(); // release any press so the dock is square before it turns into the text field
    setText(url);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  };
  const cancel = () => { setEditing(false); Keyboard.dismiss(); };
  const go = (value: string) => {
    const v = value.trim();
    if (!v || !tab) return cancel();
    try {
      browser.navigate(tab.id, v);
    } catch (e) {
      console.warn('[owl] navigate failed', e);
    }
    cancel();
  };
  const ask = (value: string) => {
    cancel();
    agent.start(value, companionId);
  };

  // Android back while typing closes the editor instead of navigating the page.
  useEffect(() => {
    if (!editing || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { cancel(); return true; });
    return () => sub.remove();
  }, [editing]);

  // Swipe the address capsule sideways to move to the neighbouring tab (Chrome's bottom-bar gesture). The capsule's
  // content follows the finger, leaves, and the next tab's slides in from the other side; at the ends it rubber-bands.
  const swipeX = useRef(new Animated.Value(0)).current;
  const pan = useMemo(() => {
    const back = () => Animated.spring(swipeX, { toValue: 0, ...motion.spring.snappy, useNativeDriver: true }).start();
    return PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const has = !!browser.neighbour(browserStore.get().activeId, g.dx < 0 ? 1 : -1);
        swipeX.setValue(has ? g.dx * 0.7 : g.dx / (1 + Math.abs(g.dx) / 36));
      },
      onPanResponderRelease: (_, g) => {
        const dir: 1 | -1 = g.dx < 0 ? 1 : -1;
        const next = browser.neighbour(browserStore.get().activeId, dir);
        if (!next || (Math.abs(g.dx) < 56 && Math.abs(g.vx) < 0.5)) return back();
        haptic('selection');
        Animated.timing(swipeX, { toValue: -dir * 140, duration: motion.duration.press, easing: motion.ease, useNativeDriver: true }).start(() => {
          browser.activate(next.id);
          swipeX.setValue(dir * 140);
          back();
        });
      },
      onPanResponderTerminate: back,
    });
  }, [swipeX]);
  const swipeOpacity = swipeX.interpolate({ inputRange: [-140, 0, 140], outputRange: [0, 1, 0], extrapolate: 'clamp' });

  const share = async () => {
    if (!url) return;
    try { await Share.share(Platform.OS === 'ios' ? { url, message: tab.title } : { message: `${tab.title}\n${url}` }); } catch {}
  };

  // Bar only while a load is in flight and below 100%: a finished load never leaves a full bar behind.
  const progress = rt.loading && rt.progress < 1 ? Math.max(0.08, rt.progress) : 0;
  const top = position === 'top';
  const bottomPad = lift > 0 ? space.xs : Math.max(insets.bottom, space.xs);
  const ink = t.ink;
  // Private tabs: the capsule turns ink-dark in both themes (Safari / Chrome incognito cue), text goes light.
  const priv = !!tab?.private;
  const addrInk = priv ? PRIVATE_INK : ink;
  const addrInk2 = priv ? PRIVATE_INK2 : t.glass.ink2;

  // Position switch: slide in from the new edge on a spring (the old one is simply gone; exits stay quiet).
  const slide = useRef(new Animated.Value(0)).current;
  const prevPos = useRef(position);
  useEffect(() => {
    if (prevPos.current === position) return;
    prevPos.current = position;
    slide.setValue(1);
    Animated.spring(slide, { toValue: 0, ...motion.spring.sheet, useNativeDriver: true }).start();
  }, [position, slide]);
  const away = top ? -(DOCK_H + insets.top + DOCK_GAP + 24) : DOCK_H + bottomPad + 24;
  const translateY = top ? Animated.multiply(slide, away) : Animated.add(Animated.multiply(liftAnim, -1), Animated.multiply(slide, away));

  return (
    <>
      {editing ? (
        <Suggestions
          text={text}
          engine={engine}
          companionName={c.name}
          companionId={c.id}
          onPick={(s) => (s.kind === 'ask' ? ask(s.value) : go(s.value))}
          position={position}
          top={top ? insets.top + DOCK_GAP + EDIT_H + space.xxs : 0}
          bottom={top ? lift : lift + bottomPad + EDIT_H}
          onCopy={async () => { await Clipboard.setStringAsync(url); haptic('success'); cancel(); }}
          canCopy={!!url && text === url}
        />
      ) : null}
      <Animated.View
        style={[styles.wrap, top ? { top: insets.top + DOCK_GAP } : { bottom: 0, paddingBottom: bottomPad }, { opacity: slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateY }] }]}
        pointerEvents="box-none"
      >
        {/* While typing: no squeeze (a stuck press would skew the capsule inside the dock) and a dense dock, so the
            page behind never ghosts through the text field; the dock is then one clean capsule with no inner well. */}
        <Animated.View style={editing ? undefined : squeeze.style} {...(editing ? {} : squeeze.handlers)}>
          <Glass style={styles.glass} rounded={DOCK_RADIUS} live={!editing} intensity={100}>
            <View style={[styles.address, { backgroundColor: editing ? 'transparent' : priv ? PRIVATE_WELL : t.glass.well }]} {...(editing ? {} : pan.panHandlers)}>
              {editing ? (
                <>
                  <View style={styles.lead}><Icon name="search" size={icon.sm} color={t.glass.ink2} /></View>
                  <TextInput
                    ref={inputRef}
                    value={text}
                    onChangeText={setText}
                    onSubmitEditing={() => go(text)}
                    onBlur={() => setEditing(false)}
                    selectTextOnFocus
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    keyboardType={Platform.OS === 'ios' ? 'web-search' : 'url'}
                    returnKeyType="go"
                    placeholder="Search or enter address"
                    placeholderTextColor={t.glass.ink2}
                    style={[styles.input, { color: ink }]}
                    selectionColor={t.accentFill}
                    accessibilityLabel="Address and search bar"
                  />
                  {text ? <IconButton size={40} label="Clear" icon={<Icon name="dismiss" size={icon.sm} color={t.glass.ink2} />} onPress={() => setText('')} /> : <View style={{ width: 40 }} />}
                </>
              ) : (
                <>
                  <IconButton size={40} label="Menu" icon={<Icon name="more-horizontal" size={icon.md} color={addrInk} />} onPress={onOpenMenu} />
                  <Animated.View style={{ flex: 1, minWidth: 0, opacity: swipeOpacity, transform: [{ translateX: swipeX }] }}>
                    <Tap label={url ? `Address ${url}. Edit` : 'Search or enter address'} onPress={startEdit} style={styles.addrTap} haptics={false} feedback="opacity">
                      {priv ? <Icon name="tab-in-private" size={15} color={addrInk2} filled /> : url ? (isSecure(url) ? <Icon name="lock-closed" size={14} color={addrInk2} /> : <Icon name="globe" size={14} color={t.danger} />) : null}
                      <T numberOfLines={1} style={{ flexShrink: 1, fontWeight: url ? '500' : '400' }} color={url ? addrInk : addrInk2}>
                        {url ? displayUrl(url) : priv ? 'Private' : 'Search or enter address'}
                      </T>
                    </Tap>
                  </Animated.View>
                  {url ? (
                    <IconButton size={40} label={rt.loading ? 'Stop' : 'Reload'} icon={rt.loading ? <Icon name="dismiss" size={icon.md} color={addrInk} /> : <Icon name="arrow-clockwise" size={18} color={addrInk} />} onPress={() => (rt.loading ? browser.stop(tab.id) : browser.reload(tab.id))} />
                  ) : (
                    <View style={{ width: 40 }} />
                  )}
                </>
              )}
            </View>

            {!editing ? (
              <View style={styles.toolbar}>
                <IconButton label="Back" disabled={!url} icon={<Icon name="chevron-left" size={icon.lg} color={ink} />} onPress={() => browser.goBack(tab.id)} />
                <IconButton label="Forward" disabled={!rt.canGoForward} icon={<Icon name="chevron-right" size={icon.lg} color={ink} />} onPress={() => browser.goForward(tab.id)} />
                <Tap
                  label={activeRun ? `${c.name} is working. Open` : `Ask ${c.name}`}
                  onPress={() => (activeRun ? agent.openSheet(true) : router.push('/ask'))}
                  onLongPress={() => router.push('/companions')}
                  style={styles.owl}
                >
                  <Image source={faceFor(c.id)} style={{ width: 30, height: 30, borderRadius: 15 }} contentFit="cover" />
                  {activeRun ? <View style={[styles.liveDot, { backgroundColor: t.accentFill, borderColor: t.glass.fallback }]} /> : null}
                </Tap>
                <IconButton label="Share" disabled={!url} icon={<Icon name="share-android" size={icon.md} color={ink} />} onPress={share} />
                <Tap label={`${tabCount} tabs`} onPress={() => router.push('/tabs')} onLongPress={() => { haptic('medium'); browser.newTab(); }} style={styles.tabsBtn} feedback="opacity">
                  <View style={[styles.tabsBox, { borderColor: ink }]}>
                    <T style={styles.tabsNum}>{tabCount > 99 ? '∞' : tabCount}</T>
                  </View>
                </Tap>
              </View>
            ) : null}

            {/* Load progress: 2px amber line on the edge facing the page (top edge at the bottom, bottom edge at the top). */}
            {progress > 0 && !editing ? (
              <View pointerEvents="none" style={[styles.progressTrack, top ? { bottom: 0 } : { top: 0 }]}>
                <View style={[styles.progress, { width: `${Math.min(100, progress * 100)}%`, backgroundColor: t.accentFill }]} />
              </View>
            ) : null}
          </Glass>
        </Animated.View>
      </Animated.View>
    </>
  );
}

function Suggestions({ text, engine, companionName, companionId, onPick, position, top, bottom, onCopy, canCopy }: { text: string; engine: string; companionName: string; companionId: string; onPick: (s: Suggestion) => void; position: DockPosition; top: number; bottom: number; onCopy: () => void; canCopy: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const history = useStore(appStore, (s) => s.history);
  const bookmarks = useStore(appStore, (s) => s.bookmarks);
  const items = useMemo<Suggestion[]>(() => {
    const q = text.trim().toLowerCase();
    const out: Suggestion[] = [];
    if (q) {
      let asUrl = '';
      try { asUrl = toUrl(text, engine as any); } catch { asUrl = ''; }
      const looksUrl = !!asUrl && !asUrl.includes('?q=') && !asUrl.includes('/search?');
      if (looksUrl) out.push({ key: 'url', kind: 'url', title: hostOf(asUrl) || text, subtitle: asUrl, value: text });
      out.push({ key: 'search', kind: 'search', title: text, subtitle: ENGINE_NAMES[engine as keyof typeof ENGINE_NAMES], value: text });
      out.push({ key: 'ask', kind: 'ask', title: text, subtitle: `Ask ${companionName}`, value: text });
    }
    const seen = new Set<string>();
    const match = (u: string, ti: string) => !q || (u || '').toLowerCase().includes(q) || (ti || '').toLowerCase().includes(q);
    for (const b of bookmarks) {
      if (out.length > 12) break;
      if (b && match(b.url, b.title) && !seen.has(b.url)) { seen.add(b.url); out.push({ key: 'b' + b.id, kind: 'bookmark', title: b.title || b.url, subtitle: hostOf(b.url), value: b.url }); }
    }
    for (const h of history) {
      if (out.length > 14) break;
      if (h && match(h.url, h.title) && !seen.has(h.url)) { seen.add(h.url); out.push({ key: 'h' + h.url, kind: 'history', title: h.title || h.url, subtitle: hostOf(h.url), value: h.url }); }
    }
    return out;
  }, [text, engine, companionName, history, bookmarks]);

  return (
    // One opaque sheet over the WHOLE screen while editing (status bar to the bottom edge, under the dock and the
    // keyboard too), so no page ever shows between the capsule and the keyboard or while the dock rides up. The list
    // itself stops at the dock: bottom dock = grows up from the bar (inverted, best match nearest the thumb); top dock
    // = opens downward from under it to the keyboard.
    <View style={[styles.sugg, { top: 0, bottom: 0, paddingTop: position === 'top' ? top : insets.top, backgroundColor: t.ground }]}>
      <FlatList
        style={{ flex: 1, marginBottom: bottom }}
        data={items}
        keyExtractor={(i) => i.key}
        keyboardShouldPersistTaps="always"
        inverted={position !== 'top'}
        contentContainerStyle={{ paddingHorizontal: space.xs, paddingVertical: space.xs }}
        ListHeaderComponent={canCopy ? (
          <Tap label="Copy link" onPress={onCopy} style={styles.suggRow} haptics={false} feedback="highlight">
            <IconWell><Icon name="copy" size={icon.sm} color={t.ink} /></IconWell>
            <T style={{ flex: 1 }}>Copy link</T>
          </Tap>
        ) : undefined}
        renderItem={({ item }) => (
          <Tap label={item.kind === 'ask' ? `Ask ${companionName}: ${item.title}` : item.title} onPress={() => onPick(item)} style={styles.suggRow} haptics={false} feedback="highlight">
            <IconWell tint={item.kind === 'ask' ? t.accentSoft : undefined}>
              {item.kind === 'search' ? <Icon name="search" size={icon.sm} color={t.ink} /> : item.kind === 'ask' ? <Image source={faceFor(companionId)} style={{ width: 24, height: 24, borderRadius: 12 }} contentFit="cover" /> : item.kind === 'url' ? <Icon name="globe" size={icon.sm} color={t.ink} /> : (
                <Image source={{ uri: faviconFor(item.value) || undefined }} style={{ width: 18, height: 18, borderRadius: 4 }} contentFit="contain" />
              )}
            </IconWell>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T numberOfLines={1}>{item.title}</T>
              {item.subtitle ? <T kind="footnote" numberOfLines={1} color={item.kind === 'ask' ? t.accent : t.ink2}>{item.subtitle}</T> : null}
            </View>
          </Tap>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: DOCK_GAP },
  glass: { padding: PAD },
  address: { flexDirection: 'row', alignItems: 'center', height: ADDRESS_H, borderRadius: CAPSULE_R, borderCurve: 'continuous', paddingHorizontal: 4, overflow: 'hidden' },
  lead: { width: 40, alignItems: 'center' },
  addrTap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, minWidth: 0 },
  input: { flex: 1, fontSize: 16, height: 44, paddingHorizontal: 2, paddingVertical: 0 },
  progressTrack: { position: 'absolute', left: DOCK_RADIUS, right: DOCK_RADIUS, height: 2, borderRadius: 1, overflow: 'hidden' },
  progress: { height: 2, borderRadius: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: TOOLBAR_H, paddingHorizontal: 2 },
  owl: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  liveDot: { position: 'absolute', bottom: 4, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  tabsBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tabsBox: { minWidth: 22, height: 22, borderWidth: 1.75, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  tabsNum: { fontSize: 11, lineHeight: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  sugg: { position: 'absolute', left: 0, right: 0 },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 56, paddingVertical: space.xs, paddingHorizontal: space.xs, borderRadius: radius.sm },
});
