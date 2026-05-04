export type ApiTrack = {
  id: string;
  title: string;
  artist: string;
  duration: string | number;
  requestedBy: string;
  requesterAvatar?: string;
  art?: string;
};

export type ApiStatus = {
  activeShard: number;
  pingMs: number;
  uptime: string;
  online: boolean;
};

export type ApiCache = {
  sizeMb: number;
  maxMb: number;
};

export type ApiSettings = {
  sessionRestoreEnabled: boolean;
};

export type ApiPlayer = {
  title: string | null;
  artist: string | null;
  durationSec: number;
  positionSec: number;
  startTime?: number | null;
  lastPausedAt?: number | null;
  isPaused?: boolean;
  playing: boolean;
  art?: string;
  volume: number;
};

export type ApiPreset = {
  id?: string;
  name: string;
  tracks?: number;
};

export type ApiLyrics = {
  title: string;
  artist: string;
  source: string;
  lines: Array<string | { text: string; timeMs?: number; timestamp?: number }>;
};

type PlaybackAction = "previous" | "play_pause" | "next" | "stop";

const BASE_URL = "https://unhitched-shrink-dorsal.ngrok-free.dev";
const ENDPOINTS = {
  queue: "/music/queue",
  history: "/music/history",
  status: "/bot/status",
  cache: "/system/audio-cache",
  settings: "/system/settings",
  player: "/music/player",
  search: "/music/search",
  playback: "/music/playback",
  clearQueue: "/music/queue/clear",
  join: "/discord/join",
  leave: "/discord/leave",
  cleanCache: "/system/audio-cache/clean",
  sessionRestore: "/system/settings/session-restore",
  volume: "/music/volume",
  lyrics: "/music/lyrics",
  queueReorder: "/queue/reorder",
  queueDelete: "/queue",
  previousTrack: "/player/previous",
  presets: "/presets",
  presetsSave: "/presets/save",
  presetsLoad: "/presets/load",
} as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) throw new Error("Set VITE_VOXARIA_API_BASE_URL to enable live API mode.");

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "true",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API ${response.status}: ${body || "unknown error"}`);
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
}

const cleanLyricsTitle = (title: string) =>
  title
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/official\s*video/gi, " ")
    .replace(/lyrics?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

export const voxariaApi = {
  getQueue: () => request<ApiTrack[]>(ENDPOINTS.queue),
  getHistory: () => request<ApiTrack[]>(ENDPOINTS.history),
  getStatus: () => request<ApiStatus>(ENDPOINTS.status),
  getCache: () => request<ApiCache>(ENDPOINTS.cache),
  getSettings: () => request<ApiSettings>(ENDPOINTS.settings),
  getPlayer: () => request<ApiPlayer>(ENDPOINTS.player),
  search: (query: string) =>
    request<{ ok: boolean; queued?: number }>(ENDPOINTS.search, { method: "POST", body: JSON.stringify({ query }) }),
  playback: (action: PlaybackAction) =>
    request<{ ok: boolean }>(ENDPOINTS.playback, { method: "POST", body: JSON.stringify({ action }) }),
  clearQueue: () => request<{ ok: boolean }>(ENDPOINTS.clearQueue, { method: "POST" }),
  summonBot: () => request<{ ok: boolean }>(ENDPOINTS.join, { method: "POST" }),
  leaveVoice: () => request<{ ok: boolean }>(ENDPOINTS.leave, { method: "POST" }),
  cleanAudioCache: () => request<{ ok: boolean; removedMb?: number }>(ENDPOINTS.cleanCache, { method: "POST" }),
  setSessionRestore: (enabled: boolean) =>
    request<{ ok: boolean; enabled: boolean }>(ENDPOINTS.sessionRestore, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }),
  setVolume: (volume: number) =>
    request<{ ok: boolean; volume: number }>(ENDPOINTS.volume, {
      method: "POST",
      body: JSON.stringify({ volume }),
    }),
  getLyrics: (title: string, artist: string) =>
    request<ApiLyrics>(ENDPOINTS.lyrics, {
      method: "POST",
      body: JSON.stringify({ title: cleanLyricsTitle(title), artist }),
    }),
  reorderQueue: (oldIndex: number, newIndex: number) =>
    request<{ ok: boolean }>(ENDPOINTS.queueReorder, {
      method: "POST",
      body: JSON.stringify({ oldIndex, newIndex }),
    }),
  deleteQueueItem: (index: number) => request<{ ok: boolean }>(`${ENDPOINTS.queueDelete}/${index}`, { method: "DELETE" }),
  previousTrack: () => request<{ ok: boolean }>(ENDPOINTS.previousTrack, { method: "POST" }),
  getPresets: () => request<ApiPreset[]>(ENDPOINTS.presets),
  savePreset: (name: string) => request<{ ok: boolean; preset?: ApiPreset }>(ENDPOINTS.presetsSave, { method: "POST", body: JSON.stringify({ name }) }),
  loadPreset: (name: string) => request<{ ok: boolean }>(ENDPOINTS.presetsLoad, { method: "POST", body: JSON.stringify({ name }) }),
};

export const mockData = {
  queue: [
    {
      id: "q1",
      title: "Night Circuit",
      artist: "Mira Kade",
      duration: "3:48",
      requestedBy: "Rex",
      art: "",
      requesterAvatar: "",
    },
    {
      id: "q2",
      title: "Static Bloom",
      artist: "Luma Echo",
      duration: "4:12",
      requestedBy: "Nyx",
      art: "",
      requesterAvatar: "",
    },
    {
      id: "q3",
      title: "Volt Heart",
      artist: "Astra Vale",
      duration: "2:59",
      requestedBy: "Kai",
      art: "",
      requesterAvatar: "",
    },
  ] as ApiTrack[],
  history: [] as ApiTrack[],
  status: { activeShard: 0, pingMs: 42, uptime: "24h 12m", online: true } as ApiStatus,
  cache: { sizeMb: 142, maxMb: 300 } as ApiCache,
  settings: { sessionRestoreEnabled: true } as ApiSettings,
  player: {
    title: "Night Circuit",
    artist: "Mira Kade",
    durationSec: 252,
    positionSec: 65,
    playing: true,
    volume: 68,
  } as ApiPlayer,
  lyrics: {
    title: "Night Circuit",
    artist: "Mira Kade",
    source: "Temporary adapter",
    lines: [
      "Streetlights whisper in the static glow",
      "Pulse of midnight running through the low",
      "Neon hearts and engines in the rain",
      "We keep moving through electric veins",
    ],
  } as ApiLyrics,
};
