// Shared types for OWL Mobile. Mirrors the desktop contract in ../../src/shared/types.ts
// where the concepts overlap (companions, providers, runs, memory) so data can be synced later.

export type ProviderKind =
  | 'openrouter' | 'openai' | 'anthropic' | 'google' | 'xai' | 'groq' | 'mistral' | 'deepseek' | 'nvidia'
  | 'ollama' | 'lmstudio' | 'llamacpp' | 'custom';

export type ModelProvider = {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  models: string[];
  local: boolean;
  enabled: boolean;
  /** derived at runtime from SecureStore, never persisted in clear */
  hasKey?: boolean;
};

export type ModelRef = { providerId: string; model: string };

export type CompanionLook = { body: string; belly: string; accent: string };

export type Companion = {
  id: string;
  name: string;
  role: string;
  tagline: string;
  instructions: string;
  look: CompanionLook;
  tools: string[];
  official: boolean;
  hired: boolean;
  ideas: string[];
};

export type Tab = {
  id: string;
  /** '' = OWL home (new tab page) */
  url: string;
  title: string;
  private: boolean;
  createdAt: number;
  lastActive: number;
};

export type TabRuntime = {
  loading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  blocked: number;
};

export type Bookmark = { id: string; url: string; title: string; createdAt: number };
export type HistoryEntry = { url: string; title: string; visits: number; lastVisit: number };

export type Profile = {
  id: string;
  name: string;
  color: string;
  /** isolated profiles run their web views without persistent cookies/storage */
  isolated: boolean;
  createdAt: number;
};

export type Settings = {
  searchEngine: 'google' | 'duckduckgo' | 'bing' | 'brave' | 'startpage';
  theme: 'system' | 'light' | 'dark';
  adblock: boolean;
  approvalMode: 'ask-risky' | 'ask-always' | 'autonomous';
  defaultModel: ModelRef | null;
  companionId: string;
  userName: string;
  desktopMode: boolean;
  /** where the address bar + toolbar dock sits */
  barPosition: 'top' | 'bottom';
  /** live blur of the page behind the glass chrome (Android 12+ / iOS); off = dense tint, page stops at the bar */
  glassBlur: boolean;
  /** per-site text size in percent, keyed by host (missing = 100) */
  siteZoom: Record<string, number>;
};

export type AgentStep = {
  t: number;
  kind: 'thought' | 'tool' | 'result' | 'message' | 'error' | 'approval' | 'user';
  text: string;
  tool?: string;
};

export type AgentRunStatus = 'running' | 'waiting-approval' | 'waiting-user' | 'done' | 'failed' | 'stopped';

export type AgentRun = {
  id: string;
  companionId: string;
  task: string;
  tabId: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  startedAt: number;
  endedAt?: number;
  result?: string;
  pendingApproval?: { action: string; detail: string };
  pendingQuestion?: { question: string };
  tokens: number;
};

export type MemoryItem = {
  id: string;
  kind: 'fact' | 'preference' | 'person' | 'project' | 'habit';
  text: string;
  source: string;
  createdAt: number;
};
