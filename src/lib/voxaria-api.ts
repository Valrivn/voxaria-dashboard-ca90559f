export type ApiTrack = {
  id: string;
  title: string;
  artist: string;
  duration: string;
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
  title: string;
  artist: string;
  durationSec: number;
  positionSec: number;
  playing: boolean;
  art?: string;
  volume: number;
};

export type ApiLyrics = {
  title: string;
  artist: string;
  source: string;
  lines: string[];
};

type PlaybackAction = "previous" | "play_pause" | "next" | "stop";

const BASE_URL = import.meta.env.VITE_VOXARIA_API_BASE_URL;

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
  leave: "/discord/leave",
  cleanCache: "/system/audio-cache/clean",
  sessionRestore: "/system/settings/session-restore",
  volume: "/music/volume",
  lyrics: "/music/lyrics",
} as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) throw new Error("Set VITE_VOXARIA_API_BASE_URL to enable live API mode.");

  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
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

export const voxariaApi = {
  getQueue: () => request<ApiTrack[]>(ENDPOINTS.queue),
  getHistory: () => request<ApiTrack[]>(ENDPOINTS.history),
  getStatus: () => request<ApiStatus>(ENDPOINTS.status),
  getCache: () => request<ApiCache>(ENDPOINTS.cache),
  getSettings: () => request<ApiSettings>(ENDPOINTS.settings),
  getPlayer: () => request<ApiPlayer>(ENDPOINTS.player),
  search: (query: string) => request<{ ok: boolean; queued?: number }>(ENDPOINTS.search, { method: "POST", body: JSON.stringify({ query }) }),
  playback: (action: PlaybackAction) =>
    request<{ ok: boolean }>(ENDPOINTS.playback, { method: "POST", body: JSON.stringify({ action }) }),
  clearQueue: () => request<{ ok: boolean }>(ENDPOINTS.clearQueue, { method: "POST" }),
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
      body: JSON.stringify({ title, artist }),
    }),
};

export const mockData = {
  queue: [
    { id: "q1", title: "Night Circuit", artist: "Mira Kade", duration: "3:48", requestedBy: "Rex", art: "", requesterAvatar: "" },
    { id: "q2", title: "Static Bloom", artist: "Luma Echo", duration: "4:12", requestedBy: "Nyx", art: "", requesterAvatar: "" },
    { id: "q3", title: "Volt Heart", artist: "Astra Vale", duration: "2:59", requestedBy: "Kai", art: "", requesterAvatar: "" },
  ] as ApiTrack[],
  history: [
    { id: "h1", title: "Afterimage", artist: "Zero Harbor", duration: "3:22", requestedBy: "Hex", art: "", requesterAvatar: "" },
    { id: "h2", title: "Deep Current", artist: "Auraline", duration: "5:01", requestedBy: "Dax", art: "", requesterAvatar: "" },
    { id: "h3", title: "Orbit Sleep", artist: "Nori", duration: "4:06", requestedBy: "Ivy", art: "", requesterAvatar: "" },
  ] as ApiTrack[],
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