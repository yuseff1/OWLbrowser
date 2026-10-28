import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import { WebView } from '@/components/WebViewBase';
import { useRouter } from 'expo-router';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/lib/theme';
import { useStore } from '@/lib/store';
import { readerStore } from '@/state/reader';
import { browser } from '@/state/browser';
import { IconButton, T } from '@/components/ui';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Minimal markdown-ish → HTML for the READ_SCRIPT output (headings, lists, links, tables as rows). */
function toHtml(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inList = false;
  const inline = (s: string) => esc(s).replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { if (inList) { out.push('</ul>'); inList = false; } continue; }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { if (inList) { out.push('</ul>'); inList = false; } const n = Math.min(4, h[1].length + 1); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    if (l.startsWith('- ')) { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(l.slice(2))}</li>`); continue; }
    if (inList) { out.push('</ul>'); inList = false; }
    if (l.includes(' | ')) { out.push(`<p class="row">${l.split(' | ').map(inline).join('<span class="sep">·</span>')}</p>`); continue; }
    out.push(`<p>${inline(l)}</p>`);
  }
  if (inList) out.push('</ul>');
  return out.join('\n');
}

export default function ReaderScreen() {
  const t = useTheme();
  const router = useRouter();
  const { loading, article, error } = useStore(readerStore, (s) => s);
  const [size, setSize] = useState(19);
  const initial = useRef(true);

  const html = useMemo(() => {
    if (!article) return '';
    const bg = t.dark ? '#14120F' : '#FBF8F2';
    const ink = t.dark ? '#EDE6DC' : '#22201C';
    const muted = t.dark ? '#A79E92' : '#6B645B';
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      body{margin:0;background:${bg};color:${ink};font:${size}px/1.65 -apple-system,'Charter','Georgia',serif;-webkit-text-size-adjust:none}
      main{max-width:680px;margin:0 auto;padding:22px 22px 80px}
      .site{font:600 12px -apple-system,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:${muted}}
      h1{font:700 1.55em/1.2 -apple-system,system-ui,sans-serif;letter-spacing:-.02em;margin:.3em 0 .4em}
      h2,h3,h4{font-family:-apple-system,system-ui,sans-serif;line-height:1.3;margin:1.4em 0 .4em}
      .by{color:${muted};font-size:.8em;margin-bottom:1.4em}
      img.hero{width:100%;border-radius:14px;margin:0 0 1.2em}
      a{color:${t.accent}} p{margin:0 0 1em} li{margin:.3em 0} .row{font-size:.85em;color:${muted}} .sep{margin:0 .5em}
    </style></head><body><main>
      <div class="site">${esc(article.site || '')}</div>
      <h1>${esc(article.title || '')}</h1>
      ${article.byline ? `<div class="by">${esc(article.byline)}</div>` : ''}
      ${article.hero ? `<img class="hero" src="${esc(article.hero)}" alt="">` : ''}
      ${toHtml(article.text || '')}
    </main></body></html>`;
  }, [article, t, size]);

  if (loading) return <View style={[styles.center, { backgroundColor: t.ground }]}><ActivityIndicator color={t.accent} /></View>;
  if (error || !article) return <View style={[styles.center, { backgroundColor: t.ground }]}><T kind="small">{error || 'Nothing to read on this page.'}</T></View>;

  return (
    <View style={{ flex: 1, backgroundColor: t.ground }}>
      <View style={[styles.tools, { borderBottomColor: t.line }]}>
        <IconButton label="Smaller text" icon={<Icon name="font-decrease" size={20} color={t.ink} />} onPress={() => setSize((s) => Math.max(14, s - 1))} />
        <IconButton label="Larger text" icon={<Icon name="font-increase" size={22} color={t.ink} />} onPress={() => setSize((s) => Math.min(28, s + 1))} />
      </View>
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: article.url }}
        key={size}
        style={{ flex: 1, backgroundColor: 'transparent' }}
        onShouldStartLoadWithRequest={(req: { url: string }) => {
          if (initial.current || req.url === article.url || !/^https?:/.test(req.url)) return true;
          // links open in the browser tab
          browser.navigate(browser.active().id, req.url);
          router.back();
          return false;
        }}
        onLoadEnd={() => { initial.current = false; }}
        onOpenWindow={(e: any) => Linking.openURL(e.nativeEvent.targetUrl).catch(() => {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  tools: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
