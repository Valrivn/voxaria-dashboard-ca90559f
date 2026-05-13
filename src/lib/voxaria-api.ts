export type ApiTrack = {
  id: string;
  title: string;
  author?: string;
  artist: string;
  length?: number;
  duration: string | number;
  requestedBy?: string;
  requesterName?: string;
  requesterAvatar?: string;
  artworkUrl?: string;
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
  url?: string | null;
  trackUrl?: string | null;
  durationSec: number;
  positionSec: number;
  startTime?: number | null;
  lastPausedAt?: number | null;
  isPaused?: boolean;
  playing: boolean;
  requesterName?: string | null;
  requesterAvatar?: string | null;
  thumbnail?: string | null;
  art?: string;
  volume: number;
};

type RawPlayerPayload = {
  success?: boolean;
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

type RawQueuePayload = {
  success?: boolean;
  data?: unknown;
  [key: string]: unknown;
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

export type ApiPitchFrame = {
  timeMs: number;
  midi: number;
};

export type ApiPitchMap = {
  title: string;
  artist: string;
  frames: ApiPitchFrame[];
};

export type ApiKaraokeResponse = {
  title?: string;
  artist?: string;
  frames?: ApiPitchFrame[];
  pitchMap?: {
    title?: string;
    artist?: string;
    frames?: ApiPitchFrame[];
  };
};

export type ApiSearchResult = {
  id: string;
  title: string;
  artist: string;
  duration?: number;
  thumbnail?: string;
};

export type ApiAuditTrack = {
  id: string;
  title: string;
  requesterAvatar?: string;
  requestedAt?: string;
  createdAt?: string;
  timestamp?: string;
};

type PlaybackAction = "previous" | "play_pause" | "next" | "stop";

export const BASE_URL = import.meta.env.VITE_VOXARIA_API_BASE_URL?.trim() || "https://unhitched-shrink-dorsal.ngrok-free.dev";
const OWNER_USER_ID = "owner";
const OWNER_API_KEY = "owner";
const ENDPOINTS = {
  queue: "/music/queue",
  history: "/music/history",
  status: "/bot/status",
  cache: "/system/audio-cache",
  settings: "/system/settings",
  player: "/music/player",
  search: "/library/search",
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
  queueShuffle: "/queue/shuffle",
  presets: "/presets",
  presetsSave: "/presets/save",
  presetsLoad: "/presets/load",
  pitchMap: "/music/pitch-map",
  searchResults: "/music/search/results",
  audit: "/api/audit",
} as const;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) throw new Error("Set VITE_VOXARIA_API_BASE_URL to enable live API mode.");

  try {
    const extraHeaders = new Headers(init?.headers);

    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        "x-user-id": OWNER_USER_ID,
        "x-api-key": OWNER_API_KEY,
        ...Object.fromEntries(extraHeaders.entries()),
      },
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`API Error: ${response.status} - ${body || response.statusText}`);
      throw new Error(`API ${response.status}: ${body || "unknown error"}`);
    }

    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  } catch (error) {
    console.error("Fetch failed:", error);
    throw error;
  }
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const toBoolean = (value: unknown): boolean | null => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
};

const pick = <T = unknown>(key: string, data: Record<string, unknown>, root: Record<string, unknown>): T | undefined => {
  if (data[key] !== undefined) return data[key] as T;
  if (root[key] !== undefined) return root[key] as T;
  return undefined;
};

const normalizePlayerPayload = (payload: RawPlayerPayload): ApiPlayer => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const root = payload && typeof payload === "object" ? payload : {};

  const positionMs = toNumber(pick("position", data, root));
  const currentTimeSec = toNumber(pick("currentTime", data, root));
  const durationMs = toNumber(pick("duration", data, root));
  const totalTimeSec = toNumber(pick("totalTime", data, root));

  const positionSec = positionMs !== null ? positionMs / 1000 : currentTimeSec ?? 0;
  const durationSec = durationMs !== null ? durationMs / 1000 : totalTimeSec ?? 0;
  const isPaused = toBoolean(pick("paused", data, root)) ?? toBoolean(pick("isPaused", data, root)) ?? false;
  const playing = toBoolean(pick("playing", data, root)) ?? false;

  return {
    title: (pick<string | null>("title", data, root) ?? null) as string | null,
    artist: (pick<string | null>("artist", data, root) ?? null) as string | null,
    trackUrl: (pick<string | null>("trackUrl", data, root) ?? null) as string | null,
    url: ((pick<string | null>("trackUrl", data, root) ?? pick<string | null>("url", data, root) ?? null) as string | null),
    durationSec: Math.max(0, durationSec),
    positionSec: Math.max(0, positionSec),
    startTime: (pick<number | null>("startTime", data, root) ?? null) as number | null,
    lastPausedAt: (pick<number | null>("lastPausedAt", data, root) ?? null) as number | null,
    isPaused,
    playing,
    requesterName: (pick<string | null>("requesterName", data, root) ?? pick<string | null>("requestedBy", data, root) ?? null) as string | null,
    requesterAvatar: (pick<string | null>("requesterAvatar", data, root) ?? null) as string | null,
    thumbnail: (pick<string | null>("thumbnail", data, root) ?? pick<string | null>("art", data, root) ?? null) as string | null,
    art: (pick<string | undefined>("thumbnail", data, root) ?? pick<string | undefined>("art", data, root) ?? undefined) as string | undefined,
    volume: Math.max(0, Math.min(200, toNumber(pick("volume", data, root)) ?? 100)),
  };
};

const normalizeQueuePayload = (payload: RawQueuePayload): ApiTrack[] => {
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
  return list.map((item, index) => {
    const track = (item ?? {}) as Record<string, unknown>;
    const requesterName = (track.requesterName ?? track.requestedBy ?? "Unknown") as string;
    const title = String(track.title ?? "Unknown title");
    const author = typeof track.author === "string" && track.author.trim().length > 0
      ? track.author.trim()
      : String(track.artist ?? "Unknown artist");
    const artworkUrl = (track.artworkUrl as string | undefined) ?? (track.thumbnail as string | undefined) ?? (track.art as string | undefined) ?? undefined;
    const length = typeof track.length === "number" && Number.isFinite(track.length)
      ? track.length
      : typeof track.duration === "number" && Number.isFinite(track.duration)
        ? track.duration
        : undefined;

    return {
      id: String(track.id ?? index),
      title,
      author,
      artist: author,
      length,
      duration: (track.duration as string | number | undefined) ?? 0,
      requestedBy: requesterName,
      requesterName,
      requesterAvatar: (track.requesterAvatar as string | undefined) ?? undefined,
      artworkUrl,
      art: artworkUrl,
    };
  });
};

async function postJson<TResponse, TBody extends Record<string, unknown>>(
  path: string,
  body: TBody,
  guildId: string,
  userId?: string,
): Promise<TResponse> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "true",
        "x-user-id": userId?.trim() || OWNER_USER_ID,
        "x-guild-id": guildId,
        "x-api-key": OWNER_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({} as { error?: string }));
      const fallbackMessage = typeof err === "object" && err && "error" in err ? String(err.error) : response.statusText;
      console.error(`API Error: ${response.status} - ${fallbackMessage}`);
      throw new Error(fallbackMessage || "Network response was not ok");
    }

    return response.json() as Promise<TResponse>;
  } catch (error) {
    console.error("Fetch failed:", error);
    throw error;
  }
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
  getQueue: async () => {
    const payload = await request<RawQueuePayload>(ENDPOINTS.queue);
    return normalizeQueuePayload(payload);
  },
  getHistory: () => request<ApiTrack[]>(ENDPOINTS.history),
  getStatus: () => request<ApiStatus>(ENDPOINTS.status),
  getCache: () => request<ApiCache>(ENDPOINTS.cache),
  getSettings: () => request<ApiSettings>(ENDPOINTS.settings),
  getPlayer: async () => {
    const payload = await request<RawPlayerPayload>(ENDPOINTS.player);
    return normalizePlayerPayload(payload);
  },
  search: (query: string, guildId: string, userId?: string) =>
    postJson<{ ok: boolean; queued?: number }, { query: string; guildId: string }>(
      "/music/search",
      { query, guildId },
      guildId,
      userId,
    ),
  requestSong: (query: string, guildId: string, userId?: string) =>
    postJson<{ ok: boolean; queued?: number }, { query: string; guildId: string }>(
      "/music/request",
      { query, guildId },
      guildId,
      userId,
    ),
  playback: (action: PlaybackAction) =>
    request<{ ok: boolean }>(ENDPOINTS.playback, { method: "POST", body: JSON.stringify({ action }) }),
  clearQueue: () => request<{ ok: boolean }>(ENDPOINTS.clearQueue, { method: "POST" }),
  summonBot: (guildId: string, userId?: string) =>
    postJson<{ ok: boolean; message?: string }, { guildId: string }>(ENDPOINTS.join, { guildId }, guildId, userId),
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
  fetchLyrics: async (query: string) => {
    if (!query?.trim()) throw new Error("Missing search query for lyrics");

    try {
      const response = await fetch(`${BASE_URL}${ENDPOINTS.lyrics}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
        },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`fetchLyrics failed: HTTP ${response.status}`, errorText || response.statusText);
        throw new Error("Failed to fetch lyrics");
      }

      return response.json() as Promise<{ lyrics?: string }>;
    } catch (error) {
      console.error("fetchLyrics request failed:", error);
      throw error;
    }
  },
  startKaraoke: async (guildId: string, trackUrl: string) => {
    if (!guildId?.trim() || !trackUrl?.trim()) throw new Error("Missing guildId or trackUrl");

    try {
      const response = await fetch(`${BASE_URL}/music/karaoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "true",
          "x-guild-id": guildId,
        },
        body: JSON.stringify({ guildId, trackUrl: trackUrl.trim() }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        console.error(`startKaraoke failed: HTTP ${response.status}`, errorText || response.statusText);
        throw new Error("Failed to generate pitch map");
      }

      return response.json() as Promise<ApiKaraokeResponse>;
    } catch (error) {
      console.error("startKaraoke request failed:", error);
      throw error;
    }
  },
  reorderQueue: (oldIndex: number, newIndex: number) =>
    request<{ ok: boolean }>(ENDPOINTS.queueReorder, {
      method: "POST",
      body: JSON.stringify({ oldIndex, newIndex }),
    }),
  deleteQueueItem: (index: number) => request<{ ok: boolean }>(`${ENDPOINTS.queueDelete}/${index}`, { method: "DELETE" }),
  previousTrack: () => request<{ ok: boolean }>(ENDPOINTS.previousTrack, { method: "POST" }),
  shuffleQueue: () => request<{ ok: boolean }>(ENDPOINTS.queueShuffle, { method: "POST" }),
  getPresets: () => request<ApiPreset[]>(ENDPOINTS.presets),
  savePreset: (name: string) => request<{ ok: boolean; preset?: ApiPreset }>(ENDPOINTS.presetsSave, { method: "POST", body: JSON.stringify({ name }) }),
  loadPreset: (name: string) => request<{ ok: boolean }>(ENDPOINTS.presetsLoad, { method: "POST", body: JSON.stringify({ name }) }),
  getPitchMap: (title: string, artist: string) =>
    request<ApiPitchMap>(ENDPOINTS.pitchMap, {
      method: "POST",
      body: JSON.stringify({ title, artist }),
    }),
  searchCatalog: (query: string) =>
    request<ApiSearchResult[]>(ENDPOINTS.searchResults, {
      method: "POST",
      body: JSON.stringify({ query }),
    }),
  getAuditLog: () => request<ApiAuditTrack[]>(ENDPOINTS.audit),
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
