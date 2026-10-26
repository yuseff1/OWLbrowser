import type { Settings } from '$shared/types';
import { owl } from '$lib/api';
import { store } from '$lib/stores.svelte';

/** Patch settings optimistically; roll back and toast on failure. */
export async function patch(p: Partial<Settings>) {
  const prev = store.settings;
  if (prev) store.settings = { ...prev, ...p };
  try {
    const s = (await owl.patchSettings(p)) as Settings | null;
    if (s) store.settings = s;
  } catch (e: any) {
    store.settings = prev;
    store.toast('Couldn’t save that setting', e?.message, 'error');
  }
}

export const PROVIDER_DOMAIN: Record<string, string> = {
  openrouter: 'openrouter.ai', openai: 'openai.com', anthropic: 'anthropic.com', google: 'gemini.google.com', xai: 'x.ai',
  groq: 'groq.com', mistral: 'mistral.ai', deepseek: 'deepseek.com', nvidia: 'nvidia.com', ollama: 'ollama.com', lmstudio: 'lmstudio.ai',
};
export const favicon = (domain?: string) => (domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : '');
