import type { ProviderKind } from './types';

/** Same presets as desktop src/main/settings.ts PROVIDER_PRESETS. Local servers are reached over the LAN on mobile. */
export const PROVIDER_PRESETS: Record<ProviderKind, { name: string; baseUrl: string; local: boolean; models: string[]; keyUrl?: string; hint?: string }> = {
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', local: false, models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5-mini', 'google/gemini-2.5-flash', 'x-ai/grok-4-fast', 'qwen/qwen3-vl-235b-a22b-instruct'], keyUrl: 'https://openrouter.ai/keys', hint: 'One key, hundreds of models.' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', local: false, models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1'], keyUrl: 'https://platform.openai.com/api-keys' },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', local: false, models: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'], keyUrl: 'https://console.anthropic.com/settings/keys' },
  google: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', local: false, models: ['gemini-2.5-pro', 'gemini-2.5-flash'], keyUrl: 'https://aistudio.google.com/apikey' },
  xai: { name: 'xAI Grok', baseUrl: 'https://api.x.ai/v1', local: false, models: ['grok-4', 'grok-4-fast'], keyUrl: 'https://console.x.ai' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', local: false, models: ['llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct'], keyUrl: 'https://console.groq.com/keys' },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', local: false, models: ['mistral-large-latest', 'mistral-medium-latest'], keyUrl: 'https://console.mistral.ai/api-keys' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', local: false, models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys' },
  nvidia: { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', local: false, models: ['meta/llama-3.3-70b-instruct', 'nvidia/llama-3.3-nemotron-super-49b-v1'], keyUrl: 'https://build.nvidia.com' },
  ollama: { name: 'Ollama on my network', baseUrl: 'http://192.168.1.10:11434/v1', local: true, models: [], hint: 'Run `OLLAMA_HOST=0.0.0.0 ollama serve` on your computer, then use its LAN IP.' },
  lmstudio: { name: 'LM Studio on my network', baseUrl: 'http://192.168.1.10:1234/v1', local: true, models: [], hint: 'In LM Studio → Developer, enable "Serve on Local Network", then use your computer\'s LAN IP.' },
  llamacpp: { name: 'llama.cpp server on my network', baseUrl: 'http://192.168.1.10:8080/v1', local: true, models: [], hint: 'Start llama-server with --host 0.0.0.0.' },
  custom: { name: 'Custom (OpenAI-compatible)', baseUrl: 'https://', local: false, models: [] },
};

export const CLOUD_KINDS: ProviderKind[] = ['openrouter', 'openai', 'anthropic', 'google', 'xai', 'groq', 'mistral', 'deepseek', 'nvidia', 'custom'];
export const LOCAL_KINDS: ProviderKind[] = ['ollama', 'lmstudio', 'llamacpp'];
