import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/lib/store';
import { useTheme, space } from '@/lib/theme';
import { appStore } from '@/state/app';
import { browser, browserStore } from '@/state/browser';
import { agent, agentStore } from '@/state/agent';
import { companionById } from '@/lib/companions';
import { BrowserWebView } from '@/components/BrowserWebView';
import { BottomBar, DOCK_GAP, DOCK_H } from '@/components/BottomBar';
import { BlurTargetView } from 'expo-blur';
import { BlurTargetContext, useLiveBlur } from '@/components/ui';
import { Home } from '@/components/Home';
import { RunSheet } from '@/components/RunSheet';
import { MenuSheet } from '@/components/MenuSheet';
import { ControlRing } from '@/components/ControlRing';
import { useKeyboardLift } from '@/lib/keyboard';
import { FindBar } from '@/components/FindBar';
import { LinkMenu } from '@/components/LinkMenu';
import { Toast } from '@/components/Toast';
import { pageUiStore } from '@/state/pageui';
import { chrome, chromeStore, overviewAnim, pageFrame, pageMeasure, pageSwipeX, pendingSwipeReset, PAGE_GAP } from '@/state/chrome';
import { T } from '@/components/ui';
import { artFor } from '@/lib/companions';
import { faviconFor, hostOf } from '@/lib/url';
import type { BrowserTab } from '@/state/browser';

/** Stand-in for a neighbour tab whose WebView isn't mounted (or a new tab): its cover, favicon and title. */
function PeekCard({ tab, isNew, companionId }: { tab: BrowserTab | null; isNew: boolean; companionId: string }) {
  const t = useTheme();
  const priv = !!tab?.private;
  const ink2 = priv ? 'rgba(244,239,232,0.62)' : t.ink2;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: priv ? '#141210' : t.ground, alignItems: 'center', justifyContent: 'center', gap: space.sm }]}>
      {tab?.thumb ? <Image source={{ uri: tab.thumb }} style={[StyleSheet.absoluteFill, { opacity: 0.9 }]} contentFit="cover" /> : null}
      {!tab?.thumb ? (
        tab?.url ? <Image source={{ uri: faviconFor(tab.url) || undefined }} style={{ width: 48, height: 48, borderRadius: 12 }} contentFit="contain" />
          : <Image source={artFor(companionId)} style={{ width: 120, height: 120 }} contentFit="contain" />
      ) : null}
      {!tab?.thumb ? <T kind="footnote" color={ink2} numberOfLines={1}>{isNew ? 'New tab' : tab?.url ? (tab.title || hostOf(tab.url)) : 'New tab'}</T> : null}
    </View>
  );
}

/**
 * The browser: live WebViews (most-recent tabs stay mounted), OWL Home for empty tabs, the liquid-glass dock
 * (bottom or top, Settings → Address bar). With live blur on, the page runs under the dock so the glass can blur it:
 * iOS keeps it reachable with contentInset, Android with injected page insets (lib/insets). With blur off (or
 * Android < 12) the page stops at the dock as before.
 */
export default function BrowserScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [rootH, setRootH] = useState(0);
  const kb = useKeyboardLift(rootH);
  const tabs = useStore(browserStore, (s) => s.tabs);
  const activeId = useStore(browserStore, (s) => s.activeId);
  const alive = useStore(browserStore, (s) => s.alive);
  const { adblock, desktopMode, barPosition } = useStore(appStore, (s) => ({ adblock: s.settings.adblock, desktopMode: s.settings.desktopMode, barPosition: s.settings.barPosition === 'top' ? 'top' as const : 'bottom' as const }));
  const liveBlur = useLiveBlur();
  const blurTarget = useRef<React.ComponentRef<typeof View> | null>(null);
  const isolated = useStore(appStore, (s) => !!s.profiles.find((p) => p.id === s.profileId)?.isolated);
  const run = useStore(agentStore, (s) => s.runs.find((r) => r.id === s.activeRunId) || null);
  const finding = useStore(pageUiStore, (s) => !!s.find);
  const peek = useStore(chromeStore, (s) => s.peek);
  const companionId = useStore(appStore, (s) => s.settings.companionId);
  const { width: screenW } = useWindowDimensions();
  const span = screenW + PAGE_GAP;
  // A committed bar swipe switched tabs: the new tab now renders as active, so bring the page offset back to 0 in the
  // same commit (the old page was already off screen, the new one already at 0 — nothing visibly moves).
  useLayoutEffect(() => {
    if (!pendingSwipeReset.current) return;
    pendingSwipeReset.current = false;
    pageSwipeX.setValue(0);
    chrome.setPeek(null);
  }, [activeId]);
  // The tab overview measures the page before zooming it into a card.
  const pageRef = useRef<React.ComponentRef<typeof View> | null>(null);
  useEffect(() => {
    pageMeasure.current = () => new Promise<void>((resolve) => {
      const v = pageRef.current as any;
      if (!v?.measureInWindow) return resolve();
      v.measureInWindow((x: number, y: number, w: number, h: number) => { Object.assign(pageFrame, { x, y, w, h }); resolve(); });
    });
    return () => { pageMeasure.current = null; };
  }, []);
  const active = tabs.find((x) => x.id === activeId) || tabs[0] || { id: '', url: '', src: '', private: false, title: '', nonce: 0, createdAt: 0, lastActive: 0 };

  // Android hardware back: close sheet → page back → home
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (agentStore.get().sheetOpen) { agent.openSheet(false); return true; }
      const s = browserStore.get();
      const tab = s.tabs.find((x) => x.id === s.activeId);
      if (tab?.url) { browser.goBack(tab.id); return true; }
      return false;
    });
    return () => sub.remove();
  }, []);

  const top = barPosition === 'top';
  // How much of the page the dock covers, measured from the page's own edges (the page starts under the status bar).
  const chromeTop = top ? DOCK_GAP + DOCK_H + space.xxs : 0;
  const chromeBottom = top ? insets.bottom : Math.max(insets.bottom, DOCK_GAP) + DOCK_H + space.xxs;
  // Page under the dock: always on iOS (contentInset), on Android only with live blur (else nothing to blur, and
  // stopping at the dock is the safer layout). The top dock never covers the bottom nav-bar strip.
  const underlay = Platform.OS === 'ios' || liveBlur;
  const marginTop = underlay ? 0 : chromeTop;
  const marginBottom = underlay ? (top ? chromeBottom : 0) : chromeBottom;
  const insetTop = underlay ? chromeTop : 0;
  const insetBottom = underlay && !top ? chromeBottom : 0;
  const pageInset = useMemo(() => ({ top: insetTop, bottom: insetBottom }), [insetTop, insetBottom]);
  const mounted = tabs.filter((x) => x.src && (alive.includes(x.id) || x.id === run?.tabId));
  const c = run ? companionById(run.companionId) : null;
  const Target = liveBlur && Platform.OS === 'android' ? BlurTargetView : View;
  const peekId = peek?.id || null;
  const peekTab = peekId && peekId !== 'new' ? tabs.find((x) => x.id === peekId) || null : null;
  const peekMounted = !!peekTab && !!peekTab.src && mounted.some((x) => x.id === peekTab.id);
  const peekX = peek ? Animated.add(pageSwipeX, peek.dir * span) : pageSwipeX;
  const pageZoom = { opacity: overviewAnim.pageFade, transformOrigin: 'top left', transform: [{ translateX: overviewAnim.tx }, { translateY: overviewAnim.ty }, { scale: overviewAnim.scale }] };

  return (
    <View style={[styles.root, { backgroundColor: t.ground, paddingTop: insets.top }]} onLayout={(e) => setRootH(e.nativeEvent.layout.height)}>
      <BlurTargetContext.Provider value={liveBlur ? blurTarget : null}>
        {/* Zoom wrapper: the tab overview scales the live page into its card (and back) from here. */}
        <Animated.View ref={pageRef} style={[styles.page, { marginTop, marginBottom }, pageZoom as any]} collapsable={false}>
        <Target ref={blurTarget} style={[styles.page, { backgroundColor: t.ground }]} collapsable={false}>
          {mounted.map((tab) => {
            const isActive = tab.id === active.id;
            const isPeek = peekMounted && tab.id === peekId;
            return (
              <Animated.View key={tab.id} style={[StyleSheet.absoluteFill, { transform: [{ translateX: isActive ? pageSwipeX : isPeek ? peekX : 0 }] }]} pointerEvents={isPeek ? 'none' : 'box-none'}>
                <BrowserWebView
                  tab={tab}
                  visible={isActive || isPeek}
                  incognito={tab.private || isolated}
                  adblock={adblock}
                  desktopMode={desktopMode}
                  inset={pageInset}
                />
              </Animated.View>
            );
          })}
          {!active.src ? (
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: pageSwipeX }] }]}>
              <Home tabId={active.id} isPrivate={active.private} topInset={pageInset.top} bottomInset={pageInset.bottom} />
            </Animated.View>
          ) : null}
          {peek && !peekMounted ? (
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { transform: [{ translateX: peekX }] }]}>
              <PeekCard tab={peekTab} isNew={peekId === 'new'} companionId={companionId} />
            </Animated.View>
          ) : null}
          {run && c && run.tabId === active.id && active.src ? (
            <ControlRing name={c.name} companionId={c.id} topInset={pageInset.top} onPress={() => agent.openSheet(true)} />
          ) : null}
        </Target>
        </Animated.View>
        {finding ? (
          <FindBar lift={kb.lift} liftAnim={kb.anim} position={barPosition} />
        ) : (
          <BottomBar onOpenMenu={() => { chrome.expand(); setMenu(true); }} lift={kb.lift} liftAnim={kb.anim} position={barPosition} canCompact={underlay && !!active.src && !run} />
        )}
        <Toast position={barPosition} offset={top ? insets.top + DOCK_GAP + DOCK_H + space.sm : Math.max(insets.bottom, DOCK_GAP) + DOCK_H + space.sm} />
        <RunSheet lift={kb.lift} />
        <MenuSheet visible={menu} onClose={() => setMenu(false)} position={barPosition} />
        <LinkMenu position={barPosition} />
      </BlurTargetContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1 },
});
