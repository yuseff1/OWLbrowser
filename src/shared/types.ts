// Shared types between the main process and the Svelte UI.

export type TabState = {
  id: number;
  url: string;
  title: string;
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  pinned: boolean;
  muted: boolean;
  audible: boolean;
  sleeping: boolean;
  zoom: number;
  /** companion id when an agent controls this tab */
  agentId?: string;
  agentRunId?: string;
  internal?: 'newtab' | 'settings' | 'companions' | 'history' | 'downloads' | 'bookmarks' | 'memory' | 'routines' | 'artifact' | 'skills' | 'apps' | 'library' | 'chats' | 'agents';
  artifactId?: string;
  /** tab group this tab belongs to (WindowState.groups) */
  groupId?: string;
};

export type TabGroupColor = 'grey' | 'blue' | 'red' | 'yellow' | 'green' | 'pink' | 'purple' | 'cyan' | 'orange';
/** Chrome-style tab group: grouped tabs are always contiguous in the strip */
export type TabGroup = { id: string; title: string; color: TabGroupColor; collapsed: boolean };

export type WindowState = {
  windowId: number;
  profileId: string;
  incognito: boolean;
  tabs: TabState[];
  activeTabId: number | null;
  splitTabId: number | null;
  groups: TabGroup[];
};

export type Profile = {
  id: string;
  name: string;
  color: string;
  avatar: string; // emoji-free initial
  createdAt: number;
};

export type Bookmark = { id: string; url: string; title: string; folder?: string; createdAt: number; favicon?: string };
export type HistoryEntry = { url: string; title: string; visits: number; lastVisit: number; favicon?: string };
export type DownloadItem = {
  id: string;
  url: string;
  filename: string;
  path: string;
  received: number;
  total: number;
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted';
  startedAt: number;
};

export type ProviderKind =
  | 'openrouter' | 'openai' | 'anthropic' | 'google' | 'xai' | 'groq' | 'mistral' | 'deepseek' | 'nvidia'
  | 'ollama' | 'lmstudio' | 'llamacpp' | 'custom';

export type ModelProvider = {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  /** never sent to renderer in clear; renderer sees hasKey */
  hasKey?: boolean;
  models: string[];
  local: boolean;
  enabled: boolean;
};

export type ModelRef = { providerId: string; model: string };

export type Settings = {
  searchEngine: 'google' | 'duckduckgo' | 'bing' | 'brave' | 'perplexity' | 'kagi';
  homeWallpaper: 'aurora' | 'dusk' | 'paper' | 'none';
  theme: 'system' | 'light' | 'dark';
  adblock: boolean;
  memorySaver: boolean;
  sleepAfterMinutes: number;
  maxAwakeTabs: number;
  defaultModel: ModelRef | null;
  visionModel: ModelRef | null;
  computerUse: boolean;
  approvalMode: 'ask-risky' | 'ask-always' | 'autonomous';
  maxParallelAgents: number;
  showBookmarksBar: boolean;
  restoreSession: boolean;
  sendDoNotTrack: boolean;
};

export type CompanionLook = {
  body: string; // primary hex
  belly: string;
  accent: string;
  shape: 'round' | 'tall' | 'wide' | 'drop' | 'bean' | 'square';
  ears: 'tufts' | 'antenna' | 'none' | 'leaf' | 'horns' | 'bun';
  eyes: 'big' | 'sleepy' | 'visor' | 'glasses' | 'wink';
  prop: 'none' | 'headset' | 'scarf' | 'monocle' | 'bowtie' | 'cap' | 'pencil';
};

export type Companion = {
  id: string;
  name: string;
  role: string;
  tagline: string;
  instructions: string;
  look: CompanionLook;
  model?: ModelRef | null;
  tools: string[]; // enabled tool groups
  official: boolean;
  hired: boolean;
  createdAt: number;
};

export type AgentStep = {
  t: number;
  kind: 'thought' | 'tool' | 'result' | 'message' | 'error' | 'approval' | 'user';
  text: string;
  tool?: string;
  image?: string; // data url thumbnail
};

export type AgentRunStatus = 'queued' | 'running' | 'waiting-approval' | 'waiting-user' | 'paused' | 'done' | 'failed' | 'stopped';

export type AgentRun = {
  id: string;
  companionId: string;
  task: string;
  status: AgentRunStatus;
  steps: AgentStep[];
  tabIds: number[];
  startedAt: number;
  endedAt?: number;
  result?: string;
  routineId?: string;
  pendingApproval?: { id: string; action: string; detail: string };
  pendingQuestion?: { id: string; question: string };
  background: boolean;
  tokens: number;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string; t: number; companionId?: string };

export type MemoryItem = {
  id: string;
  kind: 'fact' | 'preference' | 'person' | 'project' | 'habit';
  text: string;
  source: string;
  createdAt: number;
  updatedAt: number;
  uses: number;
  pinned?: boolean;
};

export type Routine = {
  id: string;
  name: string;
  companionId: string;
  task: string;
  schedule: { type: 'interval'; minutes: number } | { type: 'daily'; time: string; days?: number[] };
  trigger?: { type: 'page-change'; url: string; selector?: string } | null;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  lastResult?: string;
};

export type Artifact = { id: string; title: string; html: string; createdAt: number; companionId?: string };

export type ImportSource = { browser: 'chrome' | 'edge' | 'brave' | 'opera' | 'vivaldi'; profileDir: string; profileName: string; path: string };
export type ImportResult = { bookmarks: number; history: number; passwords: number; extensions: number; searchEngines: number; errors: string[] };

export type PasswordEntry = { id: string; origin: string; username: string; createdAt: number; lastUsed?: number };
