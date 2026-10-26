import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { Stack, SplashScreen, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { app, appStore } from '@/state/app';
import { browser, browserStore } from '@/state/browser';

/** Startup must never hang: if storage is slow or broken, start with defaults after this long. */
const STARTUP_TIMEOUT_MS = 6000;

let startupPromise: Promise<void> | null = null;
function startup(): Promise<void> {
  if (startupPromise) return startupPromise;
  const work = (async () => {
    try { await app.init(); } catch { /* app.init already falls back to defaults */ }
    try { await browser.init(); } catch { /* handled below */ }
  })();
  const timeout = new Promise<void>((r) => setTimeout(r, STARTUP_TIMEOUT_MS));
  startupPromise = Promise.race([work, timeout]).finally(() => {
    // Whatever happened, show the UI: never leave the user on the splash or an endless spinner.
    if (!appStore.get().ready) appStore.set({ ready: true });
    if (!browserStore.get().ready) browserStore.set({ ready: true });
    SplashScreen.hideAsync().catch(() => {});
  });
  return startupPromise;
}

export default function RootLayout() {
  const t = useTheme();
  const ready = useStore(appStore, (s) => s.ready);
  const tabsReady = useStore(browserStore, (s) => s.ready);

  useEffect(() => {
    startup();
  }, []);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(t.ground).catch(() => {});
  }, [t.ground]);

  const sheet = {
    presentation: 'modal' as const,
    headerShown: true,
    headerStyle: { backgroundColor: t.ground },
    headerTintColor: t.accent,
    headerTitleStyle: { color: t.ink },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: t.ground },
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      {ready && tabsReady ? (
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.ground } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="tabs" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
          <Stack.Screen name="ask" options={{ ...sheet, title: 'Companion' }} />
          <Stack.Screen name="bookmarks" options={{ ...sheet, title: 'Bookmarks' }} />
          <Stack.Screen name="history" options={{ ...sheet, title: 'History' }} />
          <Stack.Screen name="memory" options={{ ...sheet, title: 'Memory' }} />
          <Stack.Screen name="companions" options={{ ...sheet, title: 'Companions' }} />
          <Stack.Screen name="profiles" options={{ ...sheet, title: 'Profiles' }} />
          <Stack.Screen name="reader" options={{ ...sheet, title: 'Reader' }} />
          <Stack.Screen name="settings/index" options={{ ...sheet, title: 'Settings' }} />
          <Stack.Screen name="settings/models" options={{ ...sheet, presentation: 'card', title: 'Models' }} />
          <Stack.Screen name="settings/provider" options={{ ...sheet, presentation: 'card', title: 'Provider' }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, backgroundColor: t.ground, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.accent} />
        </View>
      )}
    </SafeAreaProvider>
  );
}

/**
 * Expo Router error boundary for the whole app: a render/runtime error shows what went wrong with a way out,
 * instead of a frozen or blank screen. Deliberately uses no app state or theme hooks (they may be what broke).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() !== 'light';
  const bg = dark ? '#12110F' : '#F5F3EF';
  const ink = dark ? '#F3EEE8' : '#1C1A17';
  const ink2 = dark ? '#B3AAA0' : '#5C5650';
  const accent = dark ? '#E8A317' : '#9A6400';

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  const startFresh = async () => {
    // Saved tabs are the most likely corrupt state; drop them (bookmarks, history and settings are kept).
    try {
      const keys = await AsyncStorage.getAllKeys();
      const tabKeys = keys.filter((k) => k.startsWith('owl:') && k.endsWith(':tabs'));
      if (tabKeys.length) await AsyncStorage.multiRemove(tabKeys);
    } catch {}
    try { await browser.init(); } catch {}
    await retry();
  };

  return (
    <View style={{ flex: 1, backgroundColor: bg, paddingTop: 72, paddingHorizontal: 24 }}>
      <Text style={{ color: ink, fontSize: 24, fontWeight: '700', marginBottom: 8 }}>OWL hit a problem</Text>
      <Text style={{ color: ink2, fontSize: 15, marginBottom: 16 }}>
        Something went wrong while drawing the screen. You can try again, or start fresh with a new tab.
      </Text>
      <ScrollView style={{ maxHeight: 220, marginBottom: 20, borderRadius: 12, backgroundColor: dark ? '#1B1916' : '#FFFFFF', padding: 12 }}>
        <Text selectable style={{ color: ink2, fontSize: 12, fontFamily: 'monospace' }}>
          {String(error?.name || 'Error')}: {String(error?.message || error)}
          {error?.stack ? '\n\n' + String(error.stack).split('\n').slice(0, 12).join('\n') : ''}
        </Text>
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={() => { retry(); }} style={{ backgroundColor: accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ color: dark ? '#141317' : '#FFFFFF', fontSize: 16, fontWeight: '600' }}>Try again</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={startFresh} style={{ borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: ink2 }}>
        <Text style={{ color: ink, fontSize: 16, fontWeight: '600' }}>Start fresh (close all tabs)</Text>
      </Pressable>
    </View>
  );
}
