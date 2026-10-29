import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, FlatList, PanResponder, Platform, StyleSheet, View, useWindowDimensions, type PanResponderGestureState } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Icon } from '@/components/Icon';
import { useTheme, radius, space, icon, motion, flingVelocity } from '@/lib/theme';
import { overviewAnim, pageFrame, pageMeasure } from '@/state/chrome';
import { useStore } from '@/lib/store';
import { browser, browserStore, type BrowserTab } from '@/state/browser';
import { agentStore } from '@/state/agent';
import { artFor } from '@/lib/companions';
import { appStore } from '@/state/app';
import { faviconFor, hostOf } from '@/lib/url';
import { Empty, Glass, IconButton, T, Tap, haptic } from '@/components/ui';

/**
 * Tab card: header (favicon, title, close) over a cover — the page's og:image when it has one, else its favicon on a
 * soft well. Swipe sideways to close (Chrome), tap to open. Private cards are always dark, whatever the theme.
 */
const TabCard = memo(function TabCard({ tab, active, working, width, onOpen, onClose, coverRef, coverOpacity }: { tab: BrowserTab; active: boolean; working: boolean; width: number; onOpen: (id: string) => void; onClose: (id: string) => void; coverRef: (id: string, r: View | null) => void; coverOpacity?: Animated.Value }) {
  const t = useTheme();
  const companionId = useStore(appStore, (s) => s.settings.companionId);
  const host = hostOf(tab.url);
  const title = tab.title || host || 'New tab';
  const [thumbOk, setThumbOk] = useState(true);
  const x = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);

  const pan = useMemo(() => {
    const horizontal = (_: unknown, g: PanResponderGestureState) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6;
    const back = () => { setDragging(false); Animated.spring(x, { toValue: 0, ...motion.spring.snappy, useNativeDriver: true }).start(); };
    return PanResponder.create({
      onMoveShouldSetPanResponder: horizontal,
      onMoveShouldSetPanResponderCapture: horizontal,
      onPanResponderGrant: () => setDragging(true),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => x.setValue(g.dx),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) > width * 0.38 || (Math.abs(g.vx) > 0.75 && Math.abs(g.dx) > 24)) {
          const dir = Math.sign(g.dx || g.vx) || 1;
          haptic('light');
          Animated.spring(x, { toValue: dir * (width * 1.6), velocity: flingVelocity(g.vx), ...motion.spring.commit, overshootClamping: true, restDisplacementThreshold: 1, restSpeedThreshold: 40, useNativeDriver: true }).start(() => onClose(tab.id));
        } else back();
      },
      onPanResponderTerminate: back,
    });
  }, [x, width, onClose, tab.id]);

  const priv = tab.private;
  const surface = priv ? '#1E1C1A' : t.surface;
  const well = priv ? '#2A2724' : t.surface2;
  const ink = priv ? '#F4EFE8' : t.ink;
  const ink2 = priv ? 'rgba(244,239,232,0.62)' : t.ink2;
  const opacity = x.interpolate({ inputRange: [-width, 0, width], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  const showThumb = !!tab.thumb && thumbOk;

  return (
    <Animated.View {...pan.panHandlers} style={{ width, zIndex: dragging ? 2 : 0, opacity, transform: [{ translateX: x }] }}>
      <Tap label={`Open ${title}`} onPress={() => onOpen(tab.id)} feedback="scale" haptics={false}>
        {/* the card being zoomed into / out of appears around the landing page (its whole body fades with the zoom) */}
        <Animated.View style={[styles.card, { backgroundColor: surface, borderColor: active ? t.accentFill : priv ? 'rgba(255,255,255,0.06)' : t.line }, coverOpacity ? { opacity: coverOpacity } : null]}>
          <View style={styles.cardHead}>
            {tab.url ? (
              <Image source={{ uri: faviconFor(tab.url) || undefined }} style={styles.fav} contentFit="contain" />
            ) : priv ? (
              <Icon name="tab-in-private" size={16} color={ink2} />
            ) : null}
            <T kind="footnote" numberOfLines={1} color={ink} style={styles.cardTitle}>{title}</T>
            <IconButton size={28} label={`Close ${title}`} icon={<Icon name="dismiss" size={16} color={ink2} />} onPress={() => { haptic('light'); onClose(tab.id); }} />
          </View>
          <Animated.View ref={(r: any) => coverRef(tab.id, r)} collapsable={false} style={[styles.cover, { backgroundColor: well }]}>
            {showThumb ? (
              <Image source={{ uri: tab.thumb }} style={StyleSheet.absoluteFill} contentFit="cover" transition={120} onError={() => setThumbOk(false)} />
            ) : tab.url ? (
              <View style={styles.coverFallback}>
                <Image source={{ uri: faviconFor(tab.url) || undefined }} style={styles.bigFav} contentFit="contain" />
                <T kind="caption" numberOfLines={1} color={ink2}>{host}</T>
              </View>
            ) : (
              <Image source={artFor(companionId)} style={{ width: '50%', height: '50%' }} contentFit="contain" />
            )}
            {working ? <View style={[styles.dot, { backgroundColor: t.accentFill, borderColor: surface }]} /> : null}
          </Animated.View>
        </Animated.View>
      </Tap>
    </Animated.View>
  );
});

/** Portrait covers, closer to the page's own shape so the zoom from the live page reads as one object (Safari). */
const COVER_ASPECT = 0.8;
type Frame = { x: number; y: number; w: number; h: number };

/**
 * Grid tab switcher with a Tabs / Private segmented pill.
 * Safari's zoom: the route is a transparent modal over the browser, so the live page itself scales down into the
 * current tab's card (overviewAnim drives the page container on the browser screen) while the grid fades in around it;
 * opening a card zooms the page back up from that card's frame. Exits are quicker than entrances.
 */
export default function TabsScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tabs = useStore(browserStore, (s) => s.tabs);
  const activeId = useStore(browserStore, (s) => s.activeId);
  const activeIsPrivate = useStore(browserStore, (s) => !!s.tabs.find((x) => x.id === s.activeId)?.private);
  const runTabId = useStore(agentStore, (s) => s.runs.find((r) => r.id === s.activeRunId)?.tabId || null);
  const [mode, setMode] = useState<'normal' | 'private'>(activeIsPrivate ? 'private' : 'normal');
  const cols = width > 700 ? 3 : 2;
  const gap = space.sm;
  const cardW = (width - space.md * 2 - gap * (cols - 1)) / cols;
  const list = useMemo(() => tabs.filter((x) => (mode === 'private' ? x.private : !x.private)), [tabs, mode]);
  const normalCount = useMemo(() => tabs.filter((x) => !x.private).length, [tabs]);
  const privateCount = tabs.length - normalCount;

  // segmented control: the selection lozenge springs between the two halves
  const seg = useRef(new Animated.Value(mode === 'private' ? 1 : 0)).current;
  const [segW, setSegW] = useState(0);
  useEffect(() => { Animated.spring(seg, { toValue: mode === 'private' ? 1 : 0, ...motion.spring.snappy, useNativeDriver: true }).start(); }, [mode, seg]);

  // Open scrolled to the current tab (rows have a fixed height, so the offset is known without measuring).
  const listRef = useRef<FlatList<BrowserTab>>(null);
  const rowH = 40 + (cardW - 8) / COVER_ASPECT + 4 + 3 + space.md;
  useEffect(() => {
    const i = list.findIndex((x) => x.id === activeId);
    if (i < cols * 2) return;
    const h = setTimeout(() => listRef.current?.scrollToOffset({ offset: Math.max(0, Math.floor(i / cols) * rowH - rowH * 0.5), animated: false }), 0);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // ---- zoom transition ----
  const grid = useRef(new Animated.Value(0)).current;
  const coverFade = useRef(new Animated.Value(0)).current;
  const [zoomId, setZoomId] = useState<string | null>(activeId);
  const covers = useRef(new Map<string, any>()).current;
  const coverRef = useCallback((id: string, r: View | null) => { if (r) covers.set(id, r); else covers.delete(id); }, [covers]);
  const measure = (id: string) => new Promise<Frame | null>((resolve) => {
    const v = covers.get(id);
    if (!v?.measureInWindow) return resolve(null);
    v.measureInWindow((x: number, y: number, w: number, h: number) => resolve(w > 0 ? { x, y, w, h } : null));
  });
  const springTo = (v: Animated.Value, toValue: number) => Animated.spring(v, { toValue, ...motion.spring.zoom, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.01, useNativeDriver: true });
  const frameFor = (f: Frame) => ({ s: f.w / pageFrame.w, tx: f.x - pageFrame.x, ty: f.y - pageFrame.y });
  const closing = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      // let the list lay out (and scroll to the current tab) before measuring
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 16))));
      await pageMeasure.current?.();
      const f = await measure(activeId);
      if (!alive) return;
      const anims: Animated.CompositeAnimation[] = [
        Animated.timing(grid, { toValue: 1, duration: motion.duration.slow, easing: motion.ease, useNativeDriver: true }),
        Animated.timing(overviewAnim.progress, { toValue: 1, duration: motion.duration.base, easing: motion.ease, useNativeDriver: true }),
      ];
      if (f && pageFrame.w > 0) {
        const z = frameFor(f);
        anims.push(
          springTo(overviewAnim.scale, z.s), springTo(overviewAnim.tx, z.tx), springTo(overviewAnim.ty, z.ty),
          // the page hands over to the card as it lands (the card's cover is the page's own image)
          Animated.timing(overviewAnim.pageFade, { toValue: 0, duration: motion.duration.fast, delay: 200, easing: motion.ease, useNativeDriver: true }),
          Animated.timing(coverFade, { toValue: 1, duration: motion.duration.fast, delay: 170, easing: motion.ease, useNativeDriver: true }),
        );
      } else {
        coverFade.setValue(1);
        anims.push(
          springTo(overviewAnim.scale, 0.9),
          Animated.timing(overviewAnim.pageFade, { toValue: 0, duration: motion.duration.base, easing: motion.ease, useNativeDriver: true }),
        );
      }
      Animated.parallel(anims).start();
    })();
    return () => {
      alive = false;
      // however this screen goes away, the browser page must come back whole
      [overviewAnim.scale, overviewAnim.tx, overviewAnim.ty, overviewAnim.pageFade, overviewAnim.progress].forEach((v) => v.stopAnimation());
      overviewAnim.scale.setValue(1); overviewAnim.tx.setValue(0); overviewAnim.ty.setValue(0);
      overviewAnim.pageFade.setValue(1); overviewAnim.progress.setValue(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Zoom the page back up: from the card of `id` (or from slightly small, for a tab without a card yet). */
  const zoomOut = useCallback(async (id: string | null) => {
    if (closing.current) return;
    closing.current = true;
    const f = id ? await measure(id) : null;
    [overviewAnim.scale, overviewAnim.tx, overviewAnim.ty, overviewAnim.pageFade].forEach((v) => v.stopAnimation());
    if (f && pageFrame.w > 0) {
      const z = frameFor(f);
      overviewAnim.scale.setValue(z.s); overviewAnim.tx.setValue(z.tx); overviewAnim.ty.setValue(z.ty);
      setZoomId(id);
      coverFade.setValue(1);
    } else {
      overviewAnim.scale.setValue(0.92);
      overviewAnim.tx.setValue(pageFrame.w * 0.04); overviewAnim.ty.setValue(pageFrame.h * 0.04);
    }
    overviewAnim.pageFade.setValue(0);
    Animated.parallel([
      Animated.timing(overviewAnim.pageFade, { toValue: 1, duration: 90, easing: motion.ease, useNativeDriver: true }),
      Animated.timing(coverFade, { toValue: 0, duration: 120, easing: motion.ease, useNativeDriver: true }),
      Animated.timing(grid, { toValue: 0, duration: motion.duration.fast, easing: motion.ease, useNativeDriver: true }),
      Animated.timing(overviewAnim.progress, { toValue: 0, duration: motion.duration.base, easing: motion.ease, useNativeDriver: true }),
      springTo(overviewAnim.scale, 1), springTo(overviewAnim.tx, 0), springTo(overviewAnim.ty, 0),
    ]).start(() => router.back());
  }, [router]);

  // Android back from the overview zooms into the current tab like Done.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { zoomOut(browserStore.get().activeId); return true; });
    return () => sub.remove();
  }, [zoomOut]);

  const open = useCallback((id: string) => { browser.activate(id); zoomOut(id); }, [zoomOut]);
  const close = useCallback((id: string) => browser.close(id), []);
  const add = () => { haptic('light'); browser.newTab('', { private: mode === 'private' }); zoomOut(null); };
  const closeAll = () => {
    Alert.alert(mode === 'private' ? 'Close private tabs?' : 'Close all tabs?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Close', style: 'destructive', onPress: () => { haptic('warning'); if (mode === 'private') browser.closePrivate(); else browser.closeAll(); } },
    ]);
  };
  const pick = (m: 'normal' | 'private') => { if (m !== mode) { haptic('selection'); setMode(m); } };

  return (
    <Animated.View style={{ flex: 1, paddingTop: insets.top + space.xs, opacity: grid }}>
      <View style={[styles.seg, { backgroundColor: t.surface2 }]} onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
        {segW ? (
          <Animated.View style={[styles.segThumb, { width: (segW - 8) / 2, backgroundColor: t.dark ? t.surface : '#FFFFFF', transform: [{ translateX: seg.interpolate({ inputRange: [0, 1], outputRange: [0, (segW - 8) / 2] }) }] }]} />
        ) : null}
        {(['normal', 'private'] as const).map((m) => (
          <Tap key={m} label={m === 'private' ? 'Private tabs' : 'Tabs'} onPress={() => pick(m)} feedback="opacity" haptics={false} style={styles.segBtn}>
            <T kind="callout" style={{ fontWeight: '600' }} color={mode === m ? t.ink : t.ink2}>{m === 'private' ? (privateCount ? `${privateCount} Private` : 'Private') : `${normalCount} ${normalCount === 1 ? 'Tab' : 'Tabs'}`}</T>
          </Tap>
        ))}
      </View>

      <FlatList
        ref={listRef}
        data={list}
        key={cols}
        numColumns={cols}
        keyExtractor={(x) => x.id}
        columnWrapperStyle={{ gap }}
        contentContainerStyle={{ paddingHorizontal: space.md, paddingTop: space.md, gap: space.md, paddingBottom: 120 }}
        removeClippedSubviews={false}
        ListEmptyComponent={<Empty text={mode === 'private' ? 'No private tabs' : 'No tabs'} />}
        renderItem={({ item }) => (
          <TabCard tab={item} active={item.id === activeId} working={runTabId === item.id} width={cardW} onOpen={open} onClose={close} coverRef={coverRef} coverOpacity={item.id === zoomId ? coverFade : undefined} />
        )}
      />

      <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <Glass rounded={radius.pill} style={styles.bar}>
          <Tap label="Close all" onPress={closeAll} disabled={!list.length || (list.length === 1 && !list[0].url)} feedback="opacity" style={styles.textBtn}><T kind="callout" color={t.ink2}>Close all</T></Tap>
          <IconButton label="New tab" tint={t.accentFill} icon={<Icon name="add" size={icon.lg} color={t.accentInk} />} onPress={add} />
          <Tap label="Done" onPress={() => zoomOut(browserStore.get().activeId)} feedback="opacity" style={[styles.textBtn, { alignItems: 'flex-end' }]}><T kind="headline">Done</T></Tap>
        </Glass>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  seg: { flexDirection: 'row', alignSelf: 'center', width: 240, height: 40, borderRadius: radius.pill, padding: 4 },
  segThumb: { position: 'absolute', top: 4, left: 4, bottom: 4, borderRadius: radius.pill },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, borderCurve: 'continuous', borderWidth: 1.5, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, height: 40, paddingLeft: space.sm, paddingRight: 4 },
  cardTitle: { flex: 1, fontWeight: '600' },
  fav: { width: 16, height: 16, borderRadius: 4 },
  cover: { aspectRatio: COVER_ASPECT, marginHorizontal: 4, marginBottom: 4, borderRadius: radius.lg - 4, borderCurve: 'continuous', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  coverFallback: { alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm },
  bigFav: { width: 40, height: 40, borderRadius: 10 },
  dot: { position: 'absolute', left: 10, top: 10, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 60, paddingHorizontal: space.xs },
  textBtn: { height: 44, minWidth: 88, justifyContent: 'center', paddingHorizontal: space.sm },
});
