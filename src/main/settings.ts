import { JsonStore, uid } from './store';
import { secrets } from './secrets';
import type { ModelProvider, ProviderKind, Settings } from '../shared/types';
import { checkProviderUrl, maySendKey } from './net-guard';

export const DEFAULT_SETTINGS: Settings = {
  searchEngine: 'google',
  homeWallpaper: 'aurora',
  theme: 'system',
  adblock: true,
  memorySaver: true,
  sleepAfterMinutes: 20,
  maxAwakeTabs: 12,
  defaultModel: null,
  visionModel: null,
  computerUse: false,
  approvalMode: 'ask-risky',
  maxParallelAgents: 4,
  showBookmarksBar: true,
  restoreSession: true,
  sendDoNotTrack: true,
};

export const PROVIDER_PRESETS: Record<ProviderKind, { name: string; baseUrl: string; local: boolean; models: string[]; keyUrl?: string }> = {
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', local: false, models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini', 'google/gemini-2.5-flash', 'x-ai/grok-4-fast', 'qwen/qwen3-vl-235b-a22b-instruct'], keyUrl: 'https://openrouter.ai/keys' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', local: false, models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'], keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', local: false, models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  google: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', local: false, models: ['gemini-2.5-pro', 'gemini-2.5-flash'], keyUrl: 'https://aistudio.google.com/apikey' },
  xai: { name: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', local: false, models: ['grok-4', 'grok-4-fast'], keyUrl: 'https://console.x.ai' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', local: false, models: ['llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct'], keyUrl: 'https://console.groq.com/keys' },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', local: false, models: ['mistral-large-latest', 'mistral-medium-latest'], keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', local: false, models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  nvidia: { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', local: false, models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.3-nemotron-super-49b-v1'], keyUrl: 'https://build.nvidia.com' },
  ollama: { name: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', local: true, models: [] },
  lmstudio: { name: 'LM Studio (local)', baseUrl: 'http://127.0.0.1:1234/v1', local: true, models: [] },
  llamacpp: { name: 'llama.cpp server (local)', baseUrl: 'http://127.0.0.1:8080/v1', local: true, models: [] },
  custom: { name: 'Custom (OpenAI-compatible)', baseUrl: 'http://127.0.0.1:8000/v1', local: false, models: [] },
};

const settingsStore = new JsonStore<Settings>('settings', DEFAULT_SETTINGS);
const providerStore = new JsonStore<{ providers: ModelProvider[] }>('providers', {
  providers: [
    { id: 'ollama', kind: 'ollama', name: 'Ollama (local)', baseUrl: PROVIDER_PRESETS.ollama.baseUrl, models: [], local: true, enabled: true },
    { id: 'lmstudio', kind: 'lmstudio', name: 'LM Studio (local)', baseUrl: PROVIDER_PRESETS.lmstudio.baseUrl, models: [], local: true, enabled: true },
  ],
});

const listeners = new Set<(s: Settings) => void>();

/**
 * The OpenAI-style models endpoint for a provider base URL, accepting the same forms as llm.ts chatEndpoint():
 * a server root (`http://127.0.0.1:1234`, `http://localhost:11434`) → `/v1/models`, a pasted
 * `…/chat/completions` → `…/models`, Ollama's native `…:11434/api` → `/v1/models`, else `<base>/models`.
 */
export function modelsEndpoint(baseUrl: string): string {
  const b = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(b)) return b.replace(/\/chat\/completions$/i, '') + '/models';
  try {
    const u = new URL(b);
    if (u.pathname === '' || u.pathname === '/') return b + '/v1/models';
    if (/\/api$/i.test(u.pathname) && /11434/.test(u.port)) return b.replace(/\/api$/i, '') + '/v1/models';
  } catch {}
  return b + '/models';
}

/** Ollama's native model list (`/api/tags`) at the server root, whatever path the base URL carries. */
function ollamaTagsUrl(baseUrl: string): string {
  try { const u = new URL(baseUrl); return u.origin + '/api/tags'; } catch { return String(baseUrl).replace(/\/v1$/, '') + '/api/tags'; }
}

export const settings = {
  get(): Settings { return { ...DEFAULT_SETTINGS, ...settingsStore.get() }; },
  patch(p: Partial<Settings>) {
    settingsStore.update((d) => ({ ...d, ...p }));
    const s = this.get();
    listeners.forEach((l) => l(s));
    return s;
  },
  onChange(fn: (s: Settings) => void) { listeners.add(fn); return () => listeners.delete(fn); },
  flush() { settingsStore.flush(); providerStore.flush(); },
};

export const providers = {
  list(): ModelProvider[] {
    return providerStore.get().providers.map((p) => ({ ...p, hasKey: secrets.has('provider:' + p.id) }));
  },
  get(id: string) { return providerStore.get().providers.find((p) => p.id === id) ?? null; },
  key(id: string) { return secrets.get('provider:' + id); },
  upsert(p: Partial<ModelProvider> & { kind: ProviderKind; apiKey?: string }) {
    const preset = PROVIDER_PRESETS[p.kind];
    if (!preset) throw new Error('Unknown provider kind');
    if (p.baseUrl) { const chk = checkProviderUrl(p.baseUrl); if (!chk.ok) throw new Error(chk.reason); }
    if (p.apiKey !== undefined && p.apiKey !== null && typeof p.apiKey !== 'string') throw new Error('Invalid API key');
    const id = p.id || uid(p.kind + '_');
    providerStore.update((d) => {
      const existing = d.providers.find((x) => x.id === id);
      const next: ModelProvider = {
        id,
        kind: p.kind,
        name: p.name || existing?.name || preset.name,
        baseUrl: (p.baseUrl || existing?.baseUrl || preset.baseUrl).replace(/\/+$/, ''),
        models: p.models ?? existing?.models ?? preset.models,
        local: p.local ?? existing?.local ?? preset.local,
        enabled: p.enabled ?? existing?.enabled ?? true,
      };
      if (existing) Object.assign(existing, next); else d.providers.push(next);
    });
    if (p.apiKey !== undefined) secrets.set('provider:' + id, p.apiKey);
    const s = settings.get();
    if (!s.defaultModel) {
      const prov = this.get(id);
      if (prov && prov.models.length && (prov.local || secrets.has('provider:' + id))) settings.patch({ defaultModel: { providerId: id, model: prov.models[0] } });
    }
    return this.list().find((x) => x.id === id);
  },
  remove(id: string) {
    providerStore.update((d) => { d.providers = d.providers.filter((p) => p.id !== id); });
    secrets.set('provider:' + id, null);
  },
  /** Ask the server which models it serves (works for Ollama, LM Studio, llama.cpp, OpenRouter, OpenAI...). */
  async discover(id: string): Promise<string[]> {
    const p = this.get(id);
    if (!p) return [];
    const key = this.key(id);
    if (!checkProviderUrl(p.baseUrl).ok) return [];
    const headers: Record<string, string> = {};
    const sendKey = !!key && maySendKey(p.baseUrl);
    if (sendKey) headers['Authorization'] = `Bearer ${key}`;
    if (p.kind === 'anthropic' && sendKey) { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
    try {
      const r = await fetch(modelsEndpoint(p.baseUrl), { headers, signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(String(r.status));
      const j: any = await r.json();
      const ids: string[] = (j.data || j.models || []).map((m: any) => m.id || m.name).filter(Boolean);
      if (ids.length) {
        const keep = p.kind === 'openrouter' ? ids.slice(0, 400) : ids;
        providerStore.update((d) => { const x = d.providers.find((y) => y.id === id); if (x) x.models = keep; });
        const s = settings.get();
        if (!s.defaultModel && (p.local || key)) settings.patch({ defaultModel: { providerId: id, model: keep[0] } });
      }
      return ids;
    } catch (e) {
      // Ollama native fallback
      if (p.kind === 'ollama') {
        try {
          const r = await fetch(ollamaTagsUrl(p.baseUrl), { signal: AbortSignal.timeout(4000) });
          if (!r.ok) return [];
          const j: any = await r.json();
          const ids: string[] = (Array.isArray(j?.models) ? j.models : []).map((m: any) => m?.name).filter((n: any) => typeof n === 'string' && n);
          if (ids.length) {
            providerStore.update((d) => { const x = d.providers.find((y) => y.id === id); if (x) x.models = ids; });
            if (!settings.get().defaultModel) settings.patch({ defaultModel: { providerId: id, model: ids[0] } });
          }
          return ids;
        } catch {}
      }
      return [];
    }
  },
  /** On startup, look for local model servers so local models "just work". */
  async autodetectLocal() {
    for (const p of providerStore.get().providers.filter((x) => x.local && x.enabled)) {
      await this.discover(p.id).catch(() => []);
    }
  },
};
