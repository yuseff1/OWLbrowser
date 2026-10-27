import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
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

  return (
    <View style={[styles.root, { backgroundColor: t.ground, paddingTop: insets.top }]} onLayout={(e) => setRootH(e.nativeEvent.layout.height)}>
      <BlurTargetContext.Provider value={liveBlur ? blurTarget : null}>
        <Target ref={blurTarget} style={[styles.page, { marginTop, marginBottom, backgroundColor: t.ground }]} collapsable={false}>
          {mounted.map((tab) => (
            <BrowserWebView
              key={tab.id}
              tab={tab}
              visible={tab.id === active.id}
              incognito={tab.private || isolated}
              adblock={adblock}
              desktopMode={desktopMode}
              inset={pageInset}
            />
          ))}
          {!active.src ? (
            <View style={StyleSheet.absoluteFill}>
              <Home tabId={active.id} isPrivate={active.private} topInset={pageInset.top} bottomInset={pageInset.bottom} />
            </View>
          ) : null}
          {run && c && run.tabId === active.id && active.src ? (
            <ControlRing name={c.name} companionId={c.id} topInset={pageInset.top} onPress={() => agent.openSheet(true)} />
          ) : null}
        </Target>
        <BottomBar onOpenMenu={() => setMenu(true)} lift={kb.lift} liftAnim={kb.anim} position={barPosition} />
        <RunSheet lift={kb.lift} />
        <MenuSheet visible={menu} onClose={() => setMenu(false)} position={barPosition} />
      </BlurTargetContext.Provider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1 },
});
