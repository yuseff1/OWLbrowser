import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useStore } from '@/lib/store';
import { useTheme } from '@/lib/theme';
import { app, appStore } from '@/state/app';
import { browser, browserStore } from '@/state/browser';

export default function RootLayout() {
  const t = useTheme();
  const ready = useStore(appStore, (s) => s.ready);
  const tabsReady = useStore(browserStore, (s) => s.ready);

  useEffect(() => {
    app.init().then(() => browser.init());
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
