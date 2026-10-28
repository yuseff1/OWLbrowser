import React, { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Platform, Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import { Icon, type IconName } from './Icon';
import { Glass, T, Tap, haptic } from './ui';
import { useTheme, radius, space, icon, motion } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { browser, browserStore } from '@/state/browser';
import { pageUiStore, type LinkTarget } from '@/state/pageui';
import { handOffDownload } from '@/lib/downloads';
import { showToast } from './Toast';

type Action = { key: string; label: string; icon: IconName; run: (l: LinkTarget) => void };

const close = () => pageUiStore.set({ link: null });
const share = (url: string) => { Share.share(Platform.OS === 'ios' ? { url } : { message: url }).catch(() => {}); };
const copy = async (text: string, what: string) => { await Clipboard.setStringAsync(text); haptic('success'); showToast(`${what} copied`); };

function openInTab(url: string, isPrivate: boolean) {
  const t = browser.newTab(url, { private: isPrivate, background: true });
  haptic('success');
  showToast(isPrivate ? 'Opened in private tab' : 'Opened in new tab', { label: 'Switch', run: () => browser.activate(t.id) });
}

/**
 * Long-press menu for links and images (Chrome's context menu, OWL-styled): the target up top, then the actions.
 * Same in-screen overlay pattern as MenuSheet (a RN Modal is another Android window the glass can't blur through).
 */
export function LinkMenu({ position = 'bottom' }: { position?: 'top' | 'bottom' }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const link = useStore(pageUiStore, (s) => s.link);
  const fromPrivate = useStore(browserStore, (s) => !!(link && s.tabs.find((x) => x.id === link.tabId)?.private));

  // Keep the last target while animating out.
  const [shownLink, setShownLink] = useState<LinkTarget | null>(link);
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (link) {
      setShownLink(link);
      haptic('medium');
      Animated.spring(a, { toValue: 1, ...motion.spring.sheet, useNativeDriver: true }).start();
    } else {
      Animated.timing(a, { toValue: 0, duration: motion.duration.fast, easing: motion.ease, useNativeDriver: true }).start(({ finished }) => { if (finished) setShownLink(null); });
    }
  }, [link, a]);

  useEffect(() => {
    if (!link || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [link]);

  if (!shownLink) return null;
  const l = shownLink;
  const top = position === 'top';

  const actions: Action[] = [];
  if (l.href) {
    if (!fromPrivate) actions.push({ key: 'new', label: 'Open in new tab', icon: 'tab-add', run: (x) => openInTab(x.href, false) });
    actions.push({ key: 'priv', label: 'Open in private tab', icon: 'tab-in-private', run: (x) => openInTab(x.href, true) });
    actions.push({ key: 'copy', label: 'Copy link', icon: 'link', run: (x) => copy(x.href, 'Link') });
    if (l.text && l.text !== l.href) actions.push({ key: 'copyText', label: 'Copy link text', icon: 'copy', run: (x) => copy(x.text, 'Text') });
    actions.push({ key: 'share', label: 'Share link', icon: 'share-android', run: (x) => share(x.href) });
    actions.push({ key: 'dl', label: 'Download link', icon: 'arrow-download', run: (x) => handOffDownload(x.href) });
  }
  if (l.src) {
    actions.push({ key: 'img', label: 'Open image in new tab', icon: 'image', run: (x) => openInTab(x.src, fromPrivate) });
    actions.push({ key: 'imgCopy', label: 'Copy image address', icon: 'copy', run: (x) => copy(x.src, 'Image address') });
    actions.push({ key: 'imgDl', label: 'Download image', icon: 'arrow-download', run: (x) => handOffDownload(x.src) });
  }

  const title = l.text || (l.href ? '' : 'Image');
  const url = l.href || l.src;
  const translateY = a.interpolate({ inputRange: [0, 1], outputRange: [top ? -32 : 32, 0] });
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={link ? 'auto' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.scrim, opacity: a }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close link menu" />
      </Animated.View>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.wrap, top ? { top: insets.top + space.xs } : { bottom: 0, paddingBottom: insets.bottom + space.xs }, { opacity: a, transformOrigin: top ? 'top' : 'bottom', transform: [{ translateY }, { scale }] }]}
      >
        <Glass rounded={radius.sheet} intensity={95} style={styles.sheet}>
          <View style={styles.head}>
            {l.src ? <Image source={{ uri: l.src }} style={[styles.thumb, { backgroundColor: t.surface2 }]} contentFit="cover" /> : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              {title ? <T kind="headline" numberOfLines={2}>{title}</T> : null}
              <T kind="footnote" numberOfLines={title ? 1 : 2} color={t.glass.ink2}>{url}</T>
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: t.line }]} />
          {actions.map((x) => (
            <Tap key={x.key} label={x.label} haptics={false} feedback="highlight" style={styles.row} onPress={() => { close(); setTimeout(() => x.run(l), 40); }}>
              <View style={styles.rowIcon}><Icon name={x.icon} size={icon.md} color={t.ink} /></View>
              <T style={{ flex: 1 }}>{x.label}</T>
            </Tap>
          ))}
        </Glass>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.xs },
  sheet: { paddingTop: space.md, paddingBottom: space.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingBottom: space.sm },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, borderCurve: 'continuous' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: space.md, marginBottom: space.xxs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 50, paddingHorizontal: space.md, marginHorizontal: space.xxs, borderRadius: radius.sm },
  rowIcon: { width: 24, alignItems: 'center' },
});
