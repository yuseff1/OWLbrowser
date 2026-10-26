import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Platform, Share, StyleSheet, TextInput, View, type KeyboardEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronLeft, ChevronRight, Share as ShareIcon, Copy, Lock, RotateCw, X, Search, Globe, Menu, Sparkles, ShieldCheck, EyeOff } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useTheme, radius } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { appStore } from '@/state/app';
import { browser, browserStore, EMPTY_RUNTIME } from '@/state/browser';
import { agent, agentStore } from '@/state/agent';
import { companionById, faceFor } from '@/lib/companions';
import { displayUrl, faviconFor, hostOf, isSecure, toUrl, ENGINE_NAMES } from '@/lib/url';
import { Glass, IconButton, T, Tap, haptic } from './ui';

export const BAR_HEIGHT = 112; // address pill + toolbar, excluding the home-indicator inset

type Suggestion = { key: string; kind: 'search' | 'url' | 'history' | 'bookmark' | 'ask'; title: string; subtitle?: string; value: string };

function useKeyboardHeight() {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return; // Android resizes the window (softwareKeyboardLayoutMode: resize)
    const show = Keyboard.addListener('keyboardWillShow', (e: KeyboardEvent) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h;
}

export function BottomBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const kb = useKeyboardHeight();
  const tab = useStore(browserStore, (s) => s.tabs.find((x) => x.id === s.activeId) || s.tabs[0]);
  const tabCount = useStore(browserStore, (s) => s.tabs.length);
  const rt = useStore(browserStore, (s) => s.runtime[s.activeId] || EMPTY_RUNTIME);
  const { companionId, engine, adblock } = useStore(appStore, (s) => ({ companionId: s.settings.companionId, engine: s.settings.searchEngine, adblock: s.settings.adblock }));
  const activeRun = useStore(agentStore, (s) => s.runs.find((r) => r.id === s.activeRunId) || null);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const c = companionById(companionId);

  const startEdit = () => {
    setText(tab.url);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  };
  const cancel = () => { setEditing(false); Keyboard.dismiss(); };
  const go = (value: string) => {
    if (!value.trim()) return cancel();
    browser.navigate(tab.id, value);
    cancel();
  };
  const ask = (value: string) => {
    cancel();
    agent.start(value, companionId);
  };

  const share = async () => {
    if (!tab.url) return;
    try { await Share.share(Platform.OS === 'ios' ? { url: tab.url, message: tab.title } : { message: `${tab.title}\n${tab.url}` }); } catch {}
  };

  const progress = rt.loading ? Math.max(0.08, rt.progress) : 0;

  return (
    <>
      {editing ? <Suggestions text={text} engine={engine} companionName={c.name} onPick={(s) => (s.kind === 'ask' ? ask(s.value) : go(s.value))} bottom={kb + BAR_HEIGHT + insets.bottom - 50} onCopy={async () => { await Clipboard.setStringAsync(tab.url); haptic('success'); }} canCopy={!!tab.url && text === tab.url} /> : null}
      <View style={[styles.wrap, { bottom: kb, paddingBottom: kb ? 8 : Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
        <Glass style={styles.glass} rounded={radius.xl + 4}>
          {/* address pill */}
          <View style={[styles.address, { backgroundColor: t.dark ? 'rgba(255,245,235,0.08)' : 'rgba(30,20,10,0.06)' }]}>
            {editing ? (
              <>
                <Search size={17} color={t.ink3} />
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={setText}
                  onSubmitEditing={() => go(text)}
                  onBlur={() => setEditing(false)}
                  selectTextOnFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType={Platform.OS === 'ios' ? 'web-search' : 'url'}
                  returnKeyType="go"
                  placeholder={`Search ${ENGINE_NAMES[engine]} or type a URL`}
                  placeholderTextColor={t.ink3}
                  style={[styles.input, { color: t.ink }]}
                  accessibilityLabel="Address and search bar"
                />
                {text ? <IconButton size={32} label="Clear" icon={<X size={16} color={t.ink2} />} onPress={() => setText('')} /> : null}
              </>
            ) : (
              <>
                <IconButton size={36} label="Page menu" icon={<Menu size={18} color={t.ink} />} onPress={onOpenMenu} />
                <Tap label={tab.url ? `Address: ${tab.url}. Tap to edit` : 'Search or enter website'} onPress={startEdit} style={styles.addrTap} haptics={false}>
                  {tab.private ? <EyeOff size={13} color={t.ink2} /> : tab.url ? (isSecure(tab.url) ? <Lock size={13} color={t.ink2} /> : <Globe size={13} color={t.warn} />) : <Search size={15} color={t.ink3} />}
                  <T numberOfLines={1} style={{ fontSize: 16, fontWeight: tab.url ? '500' : '400', flexShrink: 1 }} color={tab.url ? t.ink : t.ink3}>
                    {tab.url ? displayUrl(tab.url) : 'Search or enter website'}
                  </T>
                  {adblock && rt.blocked > 0 ? (
                    <View style={[styles.shield, { backgroundColor: t.accentSoft }]} accessibilityLabel={`${rt.blocked} trackers blocked`}>
                      <ShieldCheck size={11} color={t.accent} />
                      <T style={{ fontSize: 11, fontWeight: '700' }} color={t.accent}>{rt.blocked}</T>
                    </View>
                  ) : null}
                </Tap>
                {tab.url ? (
                  <IconButton size={36} label={rt.loading ? 'Stop loading' : 'Reload'} icon={rt.loading ? <X size={18} color={t.ink} /> : <RotateCw size={17} color={t.ink} />} onPress={() => (rt.loading ? browser.stop(tab.id) : browser.reload(tab.id))} />
                ) : (
                  <View style={{ width: 36 }} />
                )}
              </>
            )}
            {progress > 0 && !editing ? <View style={[styles.progress, { width: `${Math.min(100, progress * 100)}%`, backgroundColor: t.accent }]} /> : null}
          </View>

          {/* toolbar */}
          <View style={styles.toolbar}>
            <IconButton label="Back" disabled={!tab.url} icon={<ChevronLeft size={26} color={t.ink} />} onPress={() => browser.goBack(tab.id)} />
            <IconButton label="Forward" disabled={!rt.canGoForward} icon={<ChevronRight size={26} color={t.ink} />} onPress={() => browser.goForward(tab.id)} />
            <Tap
              label={activeRun ? `${c.name} is working. Open run` : `Ask ${c.name} about this page`}
              onPress={() => (activeRun ? agent.openSheet(true) : router.push('/ask'))}
              onLongPress={() => router.push('/companions')}
              style={[styles.owl, { backgroundColor: activeRun ? c.look.body : t.accentSoft }]}
            >
              <Image source={faceFor(c.id)} style={{ width: 30, height: 30 }} contentFit="contain" />
              {!activeRun ? <Sparkles size={12} color={t.accent} style={styles.spark} /> : null}
            </Tap>
            <IconButton label="Share" disabled={!tab.url} icon={<ShareIcon size={21} color={t.ink} />} onPress={share} />
            <Tap label={`${tabCount} tabs. Open tab switcher`} onPress={() => router.push('/tabs')} onLongPress={() => { haptic('medium'); browser.newTab(); }} style={styles.tabsBtn}>
              <View style={[styles.tabsBox, { borderColor: t.ink }]}>
                <T style={{ fontSize: 12, fontWeight: '700' }}>{tabCount > 99 ? '∞' : tabCount}</T>
              </View>
            </Tap>
          </View>
        </Glass>
      </View>
    </>
  );
}

function Suggestions({ text, engine, companionName, onPick, bottom, onCopy, canCopy }: { text: string; engine: string; companionName: string; onPick: (s: Suggestion) => void; bottom: number; onCopy: () => void; canCopy: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const history = useStore(appStore, (s) => s.history);
  const bookmarks = useStore(appStore, (s) => s.bookmarks);
  const items = useMemo<Suggestion[]>(() => {
    const q = text.trim().toLowerCase();
    const out: Suggestion[] = [];
    if (q) {
      const asUrl = toUrl(text, engine as any);
      const looksUrl = !asUrl.includes('?q=') && !asUrl.includes('/search?');
      if (looksUrl) out.push({ key: 'url', kind: 'url', title: hostOf(asUrl) || text, subtitle: asUrl, value: text });
      out.push({ key: 'search', kind: 'search', title: text, subtitle: `Search ${ENGINE_NAMES[engine as keyof typeof ENGINE_NAMES]}`, value: text });
      out.push({ key: 'ask', kind: 'ask', title: `Ask ${companionName}: “${text}”`, subtitle: 'Your companion does it in this tab', value: text });
    }
    const seen = new Set<string>();
    const match = (u: string, ti: string) => !q || u.toLowerCase().includes(q) || ti.toLowerCase().includes(q);
    for (const b of bookmarks) {
      if (out.length > 12) break;
      if (match(b.url, b.title) && !seen.has(b.url)) { seen.add(b.url); out.push({ key: 'b' + b.id, kind: 'bookmark', title: b.title, subtitle: b.url, value: b.url }); }
    }
    for (const h of history) {
      if (out.length > 14) break;
      if (match(h.url, h.title) && !seen.has(h.url)) { seen.add(h.url); out.push({ key: 'h' + h.url, kind: 'history', title: h.title, subtitle: h.url, value: h.url }); }
    }
    return out;
  }, [text, engine, companionName, history, bookmarks]);

  return (
    <View style={[styles.sugg, { top: insets.top, bottom, backgroundColor: t.ground }]}>
      {canCopy ? (
        <Tap label="Copy link" onPress={onCopy} style={[styles.copy, { backgroundColor: t.surface }]}>
          <Copy size={16} color={t.accent} />
          <T style={{ fontSize: 15 }} color={t.accent}>Copy link</T>
        </Tap>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={(i) => i.key}
        keyboardShouldPersistTaps="always"
        inverted
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}
        renderItem={({ item }) => (
          <Tap label={item.title} onPress={() => onPick(item)} style={styles.suggRow} haptics={false}>
            <View style={[styles.suggIcon, { backgroundColor: item.kind === 'ask' ? t.accentSoft : t.surface2 }]}>
              {item.kind === 'search' ? <Search size={16} color={t.ink2} /> : item.kind === 'ask' ? <Sparkles size={16} color={t.accent} /> : item.kind === 'url' ? <Globe size={16} color={t.ink2} /> : (
                <Image source={{ uri: faviconFor(item.value) || undefined }} style={{ width: 18, height: 18 }} contentFit="contain" />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T numberOfLines={1} style={{ fontSize: 16 }} color={item.kind === 'ask' ? t.accent : t.ink}>{item.title}</T>
              {item.subtitle ? <T kind="small" numberOfLines={1} color={t.ink3}>{item.subtitle}</T> : null}
            </View>
          </Tap>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 10 },
  glass: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 2, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  address: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: radius.pill, paddingHorizontal: 6, gap: 4, overflow: 'hidden' },
  addrTap: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, minWidth: 0 },
  input: { flex: 1, fontSize: 16, height: 44, paddingHorizontal: 4 },
  shield: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 6, height: 18, borderRadius: 9 },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2.5, borderRadius: 2 },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 54, paddingHorizontal: 4 },
  owl: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  spark: { position: 'absolute', top: 4, right: 4 },
  tabsBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tabsBox: { minWidth: 24, height: 24, borderWidth: 2, borderRadius: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  sugg: { position: 'absolute', left: 0, right: 0 },
  copy: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 12, marginBottom: 0, padding: 14, borderRadius: radius.md },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  suggIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
