import React, { useEffect, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { appStore } from '@/state/app';
import { browser, browserStore } from '@/state/browser';
import { agent, agentStore } from '@/state/agent';
import { companionById } from '@/lib/companions';
import { BrowserWebView } from '@/components/BrowserWebView';
import { BottomBar, BAR_HEIGHT } from '@/components/BottomBar';
import { Home } from '@/components/Home';
import { RunSheet } from '@/components/RunSheet';
import { MenuSheet } from '@/components/MenuSheet';
import { ControlRing } from '@/components/ControlRing';
import { useKeyboardLift } from '@/lib/keyboard';

/** The browser: live WebViews (most-recent tabs stay mounted), OWL Home for empty tabs, glass bottom bar. */
export default function BrowserScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [rootH, setRootH] = useState(0);
  const kb = useKeyboardLift(rootH);
  const tabs = useStore(browserStore, (s) => s.tabs);
  const activeId = useStore(browserStore, (s) => s.activeId);
  const alive = useStore(browserStore, (s) => s.alive);
  const { adblock, desktopMode } = useStore(appStore, (s) => ({ adblock: s.settings.adblock, desktopMode: s.settings.desktopMode }));
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

  const bottomInset = BAR_HEIGHT + Math.max(insets.bottom, 12);
  // The WebView sits under the glass bar on iOS (contentInset keeps content reachable). Android can't inset, so stop above it.
  const webBottom = Platform.OS === 'ios' ? 0 : bottomInset;
  const mounted = tabs.filter((x) => x.src && (alive.includes(x.id) || x.id === run?.tabId));
  const c = run ? companionById(run.companionId) : null;

  return (
    <View style={[styles.root, { backgroundColor: t.ground, paddingTop: insets.top }]} onLayout={(e) => setRootH(e.nativeEvent.layout.height)}>
      <View style={[styles.page, { marginBottom: webBottom }]}>
        {mounted.map((tab) => (
          <BrowserWebView
            key={tab.id}
            tab={tab}
            visible={tab.id === active.id}
            incognito={tab.private || isolated}
            adblock={adblock}
            desktopMode={desktopMode}
            bottomInset={Platform.OS === 'ios' ? bottomInset : 0}
          />
        ))}
        {!active.src ? (
          <View style={StyleSheet.absoluteFill}>
            <Home tabId={active.id} isPrivate={active.private} bottomInset={bottomInset - webBottom} />
          </View>
        ) : null}
        {run && c && run.tabId === active.id && active.src ? (
          <ControlRing name={c.name} companionId={c.id} onPress={() => agent.openSheet(true)} />
        ) : null}
      </View>
      <BottomBar onOpenMenu={() => setMenu(true)} lift={kb.lift} liftAnim={kb.anim} />
      <RunSheet lift={kb.lift} />
      <MenuSheet visible={menu} onClose={() => setMenu(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  page: { flex: 1 },
});
