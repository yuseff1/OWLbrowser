import React, { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View, useColorScheme } from 'react-native';
import { Stack, SplashScreen, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LucideProvider } from 'lucide-react-native';
import { installCrashGuard } from '@/lib/crashguard';
import { useStore } from '@/lib/store';
import { useTheme, icon } from '@/lib/theme';
import { app, appStore } from '@/state/app';
import { browser, browserStore } from '@/state/browser';

/** Startup must never hang: if storage is slow or broken, start with defaults after this long. */
const STARTUP_TIMEOUT_MS = 6000;

installCrashGuard();

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
    headerTintColor: t.ink,
    headerTitleStyle: { color: t.ink, fontSize: 17, fontWeight: '600' as const },
    headerShadowVisible: false,
    contentStyle: { backgroundColor: t.ground },
  };

  return (
    <SafeAreaProvider>
      <LucideProvider strokeWidth={icon.stroke}>
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
      </LucideProvider>
    </SafeAreaProvider>
  );
}

/**
 * Expo Router error boundary for the whole app: a render/runtime error shows what went wrong with a way out,
 * instead of a frozen or blank screen. Deliberately uses no app state or theme hooks (they may be what broke).
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() !== 'light';
  const bg = dark ? '#0E0D0C' : '#F6F5F2';
  const ink = dark ? '#F5F2EE' : '#141317';
  const ink2 = dark ? '#A39C94' : '#5E5953';
  const surface = dark ? '#1A1917' : '#FFFFFF';

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  // Never deletes anything: saved tabs, history, bookmarks, settings and keys all stay. It only opens a fresh
  // tab (in case the page in the current one is what broke) and redraws.
  const newTab = async () => {
    try { browser.newTab(); } catch {}
    await retry();
  };

  return (
    <View style={{ flex: 1, backgroundColor: bg, paddingTop: 96, paddingHorizontal: 24 }}>
      <Text style={{ color: ink, fontSize: 22, fontWeight: '600', letterSpacing: -0.4, marginBottom: 6 }}>Something went wrong</Text>
      <Text style={{ color: ink2, fontSize: 15, marginBottom: 20 }}>Your tabs and data are safe.</Text>
      <ScrollView style={{ maxHeight: 160, marginBottom: 24, borderRadius: 12, backgroundColor: surface, padding: 12 }}>
        <Text selectable style={{ color: ink2, fontSize: 12, fontFamily: 'monospace' }}>
          {String(error?.name || 'Error')}: {String(error?.message || error)}
        </Text>
      </ScrollView>
      <Pressable accessibilityRole="button" onPress={() => { retry(); }} style={{ backgroundColor: '#E8A317', borderRadius: 999, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Text style={{ color: '#141317', fontSize: 16, fontWeight: '600' }}>Try again</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={newTab} style={{ borderRadius: 999, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: surface }}>
        <Text style={{ color: ink, fontSize: 16, fontWeight: '600' }}>Open a new tab</Text>
      </Pressable>
    </View>
  );
}
