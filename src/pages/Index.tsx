import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Disc3,
  History,
  ListMusic,
  Loader2,
  Mic,
  MicOff,
  LogOut,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  Server,
  Settings2,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  Shuffle,
  Trophy,
  UserCircle2,
  Volume2,
  X,
  Youtube,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PitchDetector } from "pitchy";
import { toast } from "@/hooks/use-toast";
import { AuditLogViewer } from "@/components/AuditLogViewer";
import {
  ApiClientError,
  BASE_URL,
  mockData,
  setApiAuthContext,
  voxariaApi,
  type ApiKaraokeResponse,
  type ApiLyrics,
  type ApiPitchMap,
  type ApiPreset,
  type ApiSearchResult,
  type ApiTrack,
} from "@/lib/voxaria-api";

type NavItem = { label: string; icon: typeof Disc3 };
type LyricLine = { text: string; timeMs: number | null };
type SessionUser = {
  id: string;
  discordId?: string;
  sessionToken?: string;
  name: string;
  roleLevel: number;
  permissions: {
    dj: boolean;
    staff: boolean;
  };
};

const LYRIC_OFFSET_DEFAULT_MS = 3000;
const LYRIC_HOLD_WINDOW_MS = 3000;
const LYRIC_CALIBRATION_STORAGE_KEY = "voxaria.lyricCalibrationOffsetMs";
const KARAOKE_SCORE_TICK_MS = 120;
const MIN_PITCH_CLARITY = 0.78;
const OCTAVE_TOLERANCE_SEMITONES = 1;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const navItems: NavItem[] = [
  { label: "Visualizer", icon: Disc3 },
  { label: "Queue", icon: ListMusic },
  { label: "Sessions", icon: History },
  { label: "Settings", icon: Settings2 },
  { label: "Shard", icon: Server },
];

const formatSec = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = `${Math.floor(s % 60)}`.padStart(2, "0");
  return `${m}:${sec}`;
};

const formatMsToClock = (value: number | undefined) => {
  if (!Number.isFinite(value) || !value || value < 0) return "0:00";
  const totalSec = Math.floor(value / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = `${totalSec % 60}`.padStart(2, "0");
  return `${min}:${sec}`;
};

const resolveUiErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ApiClientError) {
    if (error.status === 404 && /no active voice connection/i.test(error.apiMessage)) {
      return "No active voice connection. Join a voice channel first.";
    }
    if (error.status >= 500 && /lavalink/i.test(error.apiMessage)) {
      return "Audio service unavailable (Lavalink). Please retry shortly.";
    }
    return error.apiMessage || fallback;
  }

  if (error instanceof Error && error.message?.trim()) return error.message;
  return fallback;
};

const getPresetId = (preset: ApiPreset) => preset.id ?? preset.name;

const parseLyricLine = (line: ApiLyrics["lines"][number]): LyricLine => {
  if (typeof line === "string") {
    const match = line.match(/^\s*\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]\s*(.*)$/);
    if (!match) return { text: line.trim(), timeMs: null };

    const min = Number(match[1]);
    const sec = Number(match[2]);
    const msRaw = match[3] ?? "0";
    const ms = Number(msRaw.padEnd(3, "0"));
    const text = (match[4] ?? "").trim();
    return { text, timeMs: min * 60000 + sec * 1000 + ms };
  }

  const text = line.text?.trim() ?? "";
  const timeMs = line.timeMs ?? line.timestamp ?? null;
  return { text, timeMs };
};

const queueRow = (
  track: ApiTrack,
  index: number,
  onDelete: (index: number) => void,
  onDragStart: (index: number) => void,
  onDrop: (newIndex: number) => void,
  isDragging: boolean,
  canManageQueue: boolean,
) => (
  <article
    key={track.id}
    draggable={canManageQueue}
    onDragStart={() => canManageQueue && onDragStart(index)}
    onDragOver={(e) => e.preventDefault()}
    onDrop={() => canManageQueue && onDrop(index)}
    className={`grid items-center gap-2 rounded-md border border-border/70 bg-panel/80 p-2 transition hover:border-primary/55 hover:neon-glow ${
      canManageQueue ? "grid-cols-[20px_38px_1fr_52px_28px_28px]" : "grid-cols-[38px_1fr_52px_28px]"
    } ${
      isDragging ? "opacity-55" : ""
    }`}
  >
    {canManageQueue && (
      <button
        type="button"
        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent/35 hover:text-primary"
        aria-label="Drag queue item"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    )}

    {track.artworkUrl ? (
      <img src={track.artworkUrl} alt={`${track.title} cover`} loading="lazy" className="h-9 w-9 rounded object-cover" />
    ) : (
      <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-panel-soft">
        <Disc3 className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    )}

    <div className="min-w-0">
      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
      <p className="truncate text-[11px] text-muted-foreground">{track.author}</p>
    </div>

    <p className="text-[10px] text-muted-foreground">{formatMsToClock(track.length)}</p>

    {track.requesterAvatar ? (
      <img
        src={track.requesterAvatar}
        alt={`${track.requesterName ?? track.requestedBy ?? "Requester"} avatar`}
        loading="lazy"
        className="h-7 w-7 rounded-full border border-border object-cover"
      />
    ) : (
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-panel-soft">
        <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    )}

    {canManageQueue && (
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-muted-foreground hover:bg-accent/35 hover:text-primary"
        onClick={() => onDelete(index)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    )}
  </article>
);

const Index = () => {
  const queryClient = useQueryClient();
  const API_BASE_URL = BASE_URL;

  const [searchTerm, setSearchTerm] = useState("");
  const [requestTerm, setRequestTerm] = useState("");
  const [lyricsData, setLyricsData] = useState<ApiLyrics | null>(null);
  const [activeLine, setActiveLine] = useState(0);
  const [lyricsUnavailable, setLyricsUnavailable] = useState(false);
  const [uiVolume, setUiVolume] = useState(100);
  const [syncOffsetMs, setSyncOffsetMs] = useState(() => {
    if (typeof window === "undefined") return LYRIC_OFFSET_DEFAULT_MS;
    const stored = window.localStorage.getItem(LYRIC_CALIBRATION_STORAGE_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? parsed : LYRIC_OFFSET_DEFAULT_MS;
  });
  const [rttCompensationMs, setRttCompensationMs] = useState(0);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [lyricsOpen, setLyricsOpen] = useState(true);
  const [karaokeEnabled, setKaraokeEnabled] = useState(false);
  const [karaokeScore, setKaraokeScore] = useState(0);
  const [karaokeCombo, setKaraokeCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [scoreSummaryOpen, setScoreSummaryOpen] = useState(false);
  const [detectedPitchHz, setDetectedPitchHz] = useState<number | null>(null);
  const [playlistBuilderQuery, setPlaylistBuilderQuery] = useState("");
  const [debouncedPlaylistQuery, setDebouncedPlaylistQuery] = useState("");
  const [playlistImportUrl, setPlaylistImportUrl] = useState("");
  const [newPresetName, setNewPresetName] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [isFetchingLyrics, setIsFetchingLyrics] = useState(false);
  const [isGeneratingKaraoke, setIsGeneratingKaraoke] = useState(false);
  const [currentPitchMap, setCurrentPitchMap] = useState<ApiPitchMap | null>(null);
  const [interpolatedPositionMs, setInterpolatedPositionMs] = useState(0);

  const animationFrameRef = useRef<number | null>(null);
  const karaokeAnimationRef = useRef<number | null>(null);
  const karaokeIntervalRef = useRef<number | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef(0);
  const smoothTimeRef = useRef(0);
  const currentPositionRef = useRef<HTMLSpanElement | null>(null);
  const totalDurationRef = useRef<HTMLSpanElement | null>(null);
  const karaokeStartTimeRef = useRef<number | null>(null);
  const karaokeScoreRef = useRef(0);
  const karaokeComboRef = useRef(0);
  const karaokeMaxComboRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pitchDetectorRef = useRef<PitchDetector<number[]> | null>(null);
  const micByteBufferRef = useRef<Uint8Array | null>(null);
  const latestPitchHzRef = useRef<number | null>(null);
  const backendClockRef = useRef({ positionMs: 0, receivedAt: 0, paused: true, durationMs: 0 });
  const lastClockEmitRef = useRef(0);

  const [sessionUsers, setSessionUsers] = useState<SessionUser[]>([
    {
      id: "u1",
      discordId: "u1",
      name: "Astra",
      roleLevel: 2,
      permissions: { dj: true, staff: true },
    },
    {
      id: "u2",
      discordId: "u2",
      name: "Kai",
      roleLevel: 1,
      permissions: { dj: true, staff: false },
    },
    {
      id: "u3",
      discordId: "u3",
      name: "Nyx",
      roleLevel: 0,
      permissions: { dj: false, staff: false },
    },
  ]);
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null);

  const queue = useQuery({ queryKey: ["queue"], queryFn: voxariaApi.getQueue, refetchInterval: 10000 });
  const history = useQuery({ queryKey: ["history"], queryFn: async () => voxariaApi.getHistory().catch(() => mockData.history), refetchInterval: 14000 });
  const status = useQuery({ queryKey: ["status"], queryFn: async () => voxariaApi.getStatus().catch(() => mockData.status), refetchInterval: 10000 });
  const cache = useQuery({ queryKey: ["cache"], queryFn: async () => voxariaApi.getCache().catch(() => mockData.cache), refetchInterval: 15000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => voxariaApi.getSettings().catch(() => mockData.settings) });
  const player = useQuery({
    queryKey: ["player"],
    queryFn: async () => {
      const startedAt = Date.now();
      try {
        const data = await voxariaApi.getPlayer();
        const elapsed = Math.max(0, Date.now() - startedAt);
        setRttCompensationMs(elapsed / 2);
        return data;
      } catch (error) {
        console.error("Player polling failed:", error);
        throw error;
      }
    },
    refetchInterval: 1000,
  });
  const presets = useQuery({ queryKey: ["presets"], queryFn: voxariaApi.getPresets, refetchInterval: 30000 });
  const activeGuildId = useMemo(() => {
    const settingsData = (settings.data as {
      guildId?: string;
      loggedInUser?: { discordId?: string; sessionToken?: string };
      sessionToken?: string;
    } | undefined) ?? {};

    const fromSettings = settingsData.guildId?.trim();
    if (fromSettings) return fromSettings;
    const fromEnv = import.meta.env.VITE_VOXARIA_GUILD_ID?.trim();
    if (fromEnv) return fromEnv;
    return "owner";
  }, [settings.data]);
  const activeUserDiscordId = useMemo(
    () => {
      const settingsData = (settings.data as {
        loggedInUser?: { discordId?: string; sessionToken?: string };
        sessionToken?: string;
      } | undefined) ?? {};

      return (
        currentUser?.discordId?.trim() ||
        settingsData.loggedInUser?.discordId?.trim() ||
        currentUser?.id?.trim() ||
        "owner"
      );
    },
    [currentUser?.discordId, currentUser?.id, settings.data],
  );
  const activeSessionToken = useMemo(() => {
    const settingsData = (settings.data as {
      loggedInUser?: { discordId?: string; sessionToken?: string };
      sessionToken?: string;
    } | undefined) ?? {};

    return (
      currentUser?.sessionToken?.trim() ||
      settingsData.sessionToken?.trim() ||
      settingsData.loggedInUser?.sessionToken?.trim() ||
      undefined
    );
  }, [currentUser?.sessionToken, settings.data]);

  useEffect(() => {
    setApiAuthContext({
      guildId: activeGuildId,
      userId: activeUserDiscordId,
      sessionToken: activeSessionToken,
    });
  }, [activeGuildId, activeSessionToken, activeUserDiscordId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedPlaylistQuery(playlistBuilderQuery.trim());
    }, 500);

    return () => window.clearTimeout(timer);
  }, [playlistBuilderQuery]);

  const playlistSearch = useQuery({
    queryKey: ["playlist-search", debouncedPlaylistQuery],
    enabled: debouncedPlaylistQuery.length > 1,
    queryFn: async () => {
      try {
        return await voxariaApi.searchOnly(debouncedPlaylistQuery);
      } catch (error) {
        console.error("Catalog search failed:", error);
        return [];
      }
    },
    staleTime: 10000,
    retry: 1,
  });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["queue"] });
    void queryClient.invalidateQueries({ queryKey: ["history"] });
    void queryClient.invalidateQueries({ queryKey: ["status"] });
    void queryClient.invalidateQueries({ queryKey: ["cache"] });
    void queryClient.invalidateQueries({ queryKey: ["player"] });
  };

  const searchMutation = useMutation({
    mutationFn: async ({ query, guildId }: { query: string; guildId: string }) => voxariaApi.search(query, guildId),
    onSuccess: () => {
      toast({ title: "Queued", description: "Search request sent to Voxaria." });
      refreshAll();
    },
    onError: () => toast({ title: "Search failed", description: "Could not reach backend endpoint.", variant: "destructive" }),
  });

  const requestMutation = useMutation({
    mutationFn: async ({ query, guildId }: { query: string; guildId: string }) => voxariaApi.requestSong(query, guildId),
    onSuccess: () => {
      toast({ title: "Request submitted", description: "Song request pushed to queue." });
      setRequestTerm("");
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: (error) => {
      console.log("Song request failed:", error instanceof Error ? error.message : error);
      toast({
        title: "Request failed",
        description: resolveUiErrorMessage(error, "Could not submit request."),
        variant: "destructive",
      });
    },
  });

  const playbackMutation = useMutation({
    mutationFn: voxariaApi.playback,
    onSuccess: refreshAll,
    onError: () => toast({ title: "Control failed", description: "Playback action could not be completed.", variant: "destructive" }),
  });

  const previousTrackMutation = useMutation({
    mutationFn: voxariaApi.previousTrack,
    onSuccess: refreshAll,
    onError: () => toast({ title: "Control failed", description: "Could not jump to previous track.", variant: "destructive" }),
  });

  const clearQueueMutation = useMutation({
    mutationFn: voxariaApi.clearQueue,
    onSuccess: () => {
      toast({ title: "Queue cleared" });
      refreshAll();
    },
  });

  const summonBotMutation = useMutation({
    mutationFn: ({ guildId }: { guildId: string }) => voxariaApi.summonBot(guildId),
    onSuccess: () => toast({ title: "Summon sent", description: "Voxaria join request sent." }),
    onError: (error) =>
      toast({
        title: "Summon failed",
        description: resolveUiErrorMessage(error, "Could not send join request."),
        variant: "destructive",
      }),
  });

  const leaveMutation = useMutation({
    mutationFn: voxariaApi.leaveVoice,
    onSuccess: () => toast({ title: "Disconnected", description: "Voxaria left the voice channel." }),
  });

  const cleanCacheMutation = useMutation({
    mutationFn: voxariaApi.cleanAudioCache,
    onSuccess: () => {
      toast({ title: "Cache cleaned", description: "Audio cache clean command sent." });
      void queryClient.invalidateQueries({ queryKey: ["cache"] });
    },
  });

  const sessionRestoreMutation = useMutation({
    mutationFn: voxariaApi.setSessionRestore,
    onSuccess: (d) => {
      toast({ title: `Session Restore ${d.enabled ? "enabled" : "disabled"}` });
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const volumeMutation = useMutation({ mutationFn: voxariaApi.setVolume, onSuccess: refreshAll });

  const reorderQueueMutation = useMutation({
    mutationFn: ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => voxariaApi.reorderQueue(oldIndex, newIndex),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["queue"] }),
    onError: () => toast({ title: "Reorder failed", description: "Could not reorder queue item.", variant: "destructive" }),
  });

  const deleteQueueItemMutation = useMutation({
    mutationFn: (index: number) => voxariaApi.deleteQueueItem(index),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["queue"] }),
    onError: () => toast({ title: "Delete failed", description: "Could not remove queue item.", variant: "destructive" }),
  });

  const createPresetMutation = useMutation({
    mutationFn: (name: string) => voxariaApi.createPreset(name),
    onSuccess: async (_response, name) => {
      toast({ title: "Playlist created" });
      const trimmedName = name.trim();
      setNewPresetName("");
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      const refreshed = (queryClient.getQueryData(["presets"]) as ApiPreset[] | undefined) ?? [];
      const created = refreshed.find((preset) => preset.name === trimmedName);
      if (created) setActivePresetId(getPresetId(created));
    },
    onError: () => toast({ title: "Create failed", description: "Could not create playlist.", variant: "destructive" }),
  });

  const deletePresetMutation = useMutation({
    mutationFn: (presetId: string) => voxariaApi.deletePreset(presetId),
    onSuccess: () => {
      toast({ title: "Playlist deleted" });
      void queryClient.invalidateQueries({ queryKey: ["presets"] });
    },
    onError: () => toast({ title: "Delete failed", description: "Could not delete playlist.", variant: "destructive" }),
  });

  const addTrackToPresetMutation = useMutation({
    mutationFn: ({ presetId, track }: { presetId: string; track: ApiSearchResult }) =>
      voxariaApi.addTrackToPreset(presetId, track),
    onSuccess: async () => {
      toast({ title: "Track added" });
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      await queryClient.refetchQueries({ queryKey: ["presets"], type: "active" });
    },
    onError: () => toast({ title: "Add failed", description: "Could not add track to playlist.", variant: "destructive" }),
  });

  const removeTrackFromPresetMutation = useMutation({
    mutationFn: ({ presetId, trackIndex }: { presetId: string; trackIndex: number }) =>
      voxariaApi.removeTrackFromPreset(presetId, trackIndex),
    onSuccess: async () => {
      toast({ title: "Track removed" });
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      await queryClient.refetchQueries({ queryKey: ["presets"], type: "active" });
    },
    onError: () => toast({ title: "Remove failed", description: "Could not remove track.", variant: "destructive" }),
  });

  const importPlaylistToPresetMutation = useMutation({
    mutationFn: ({ presetId, url }: { presetId: string; url: string }) => voxariaApi.importPlaylistToPreset(presetId, url),
    onSuccess: async (response) => {
      const addedCount = response?.added ?? 0;
      toast({
        title: "Playlist imported",
        description: `Added ${addedCount} track${addedCount === 1 ? "" : "s"}.`,
      });
      setPlaylistImportUrl("");
      await queryClient.invalidateQueries({ queryKey: ["presets"] });
      await queryClient.refetchQueries({ queryKey: ["presets"], type: "active" });
    },
    onError: () =>
      toast({
        title: "Import failed",
        description: "Could not import playlist URL.",
        variant: "destructive",
      }),
  });

  const shuffleQueueMutation = useMutation({
    mutationFn: voxariaApi.shuffleQueue,
    onSuccess: () => {
      toast({ title: "Queue shuffled" });
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: () => toast({ title: "Shuffle failed", description: "Could not shuffle queue.", variant: "destructive" }),
  });

  const currentTrack = useMemo(
    () => ({
      title: (player.data?.cleanedTitle ?? player.data?.title ?? "").trim(),
      artist: (player.data?.cleanedArtist ?? player.data?.artist ?? "").trim(),
      url: (player.data?.trackUrl ?? player.data?.url ?? player.data?.uri ?? "").trim(),
    }),
    [player.data?.cleanedTitle, player.data?.title, player.data?.cleanedArtist, player.data?.artist, player.data?.trackUrl, player.data?.url, player.data?.uri],
  );

  const currentTrackKey = `${currentTrack.title}::${currentTrack.artist}`;
  const normalizedLyrics = useMemo(() => (lyricsData?.lines ?? []).map(parseLyricLine).filter((line) => line.text.length > 0), [lyricsData?.lines]);
  const presetsData = presets.data ?? [];
  const activePreset = useMemo(
    () => presetsData.find((preset) => getPresetId(preset) === activePresetId) ?? null,
    [presetsData, activePresetId],
  );
  const activePresetTracks = activePreset?.items ?? [];

  useEffect(() => {
    setLyricsData(null);
    setLyricsUnavailable(false);
    setActiveLine(0);
    setCurrentPitchMap(null);
  }, [currentTrackKey]);

  const coercePitchMap = (payload: ApiKaraokeResponse): ApiPitchMap | null => {
    const candidate = payload.pitchMap ?? payload;
    if (!candidate?.frames?.length) return null;
    return {
      title: candidate.title ?? currentTrack.title,
      artist: candidate.artist ?? currentTrack.artist,
      frames: candidate.frames,
    };
  };

  const refreshLyrics = async () => {
    if (!currentTrack.title) {
      toast({ title: "No track playing", description: "Wait for a track before refreshing lyrics.", variant: "destructive" });
      return;
    }

    setIsFetchingLyrics(true);
    try {
      const response = await voxariaApi.fetchLyrics(currentTrack.title, currentTrack.artist, activeGuildId);
      const lyricsText = response?.lyrics?.trim();

      if (!lyricsText) {
        setLyricsData(null);
        setLyricsUnavailable(true);
        setActiveLine(0);
        toast({ title: "Failed to find lyrics", variant: "destructive" });
        return;
      }

      setLyricsData({
        title: currentTrack.title,
        artist: currentTrack.artist || "Unknown artist",
        source: "On-demand",
        lines: lyricsText.split(/\r?\n/).filter((line) => line.trim().length > 0),
      });
      setLyricsUnavailable(false);
      setActiveLine(0);
      toast({ title: "Lyrics synced", description: "Lyrics refreshed successfully." });
    } catch (error) {
      console.error("Refresh lyrics failed:", error);
      setLyricsData(null);
      setLyricsUnavailable(true);
      setActiveLine(0);
      toast({ title: "Failed to find lyrics", variant: "destructive" });
    } finally {
      setIsFetchingLyrics(false);
    }
  };

  useEffect(() => {
    activeLineRef.current = activeLine;
  }, [activeLine]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LYRIC_CALIBRATION_STORAGE_KEY, `${Math.round(syncOffsetMs)}`);
  }, [syncOffsetMs]);

  useEffect(() => {
    if (!player.data) return;

    const now = performance.now();
    const positionMs = Math.max(0, Math.round((player.data.positionSec ?? 0) * 1000));
    const durationMs = Math.max(0, Math.round((player.data.durationSec ?? 0) * 1000));
    const paused = Boolean(player.data.isPaused ?? !player.data.playing);

    backendClockRef.current = {
      positionMs,
      receivedAt: now,
      paused,
      durationMs,
    };

    smoothTimeRef.current = positionMs;
    setInterpolatedPositionMs(positionMs);
  }, [player.data?.positionSec, player.data?.durationSec, player.data?.isPaused, player.data?.playing]);

  useEffect(() => {
    const tick = () => {
      const now = performance.now();
      const { positionMs, receivedAt, paused, durationMs } = backendClockRef.current;
      const elapsed = paused ? 0 : now - receivedAt;
      const nextMs = durationMs > 0 ? Math.min(durationMs, positionMs + elapsed) : Math.max(0, positionMs + elapsed);

      smoothTimeRef.current = nextMs;

      if (now - lastClockEmitRef.current >= 33) {
        lastClockEmitRef.current = now;
        setInterpolatedPositionMs(nextMs);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const adjustedMs = Math.max(0, interpolatedPositionMs - rttCompensationMs - syncOffsetMs);
    smoothTimeRef.current = adjustedMs;

    if (currentPositionRef.current) {
      currentPositionRef.current.textContent = formatSec(adjustedMs / 1000);
    }

    if (totalDurationRef.current) {
      totalDurationRef.current.textContent = formatSec(player.data?.durationSec ?? 0);
    }

    if (!normalizedLyrics.length) return;

    const fallbackIndex = Math.min(normalizedLyrics.length - 1, Math.floor(adjustedMs / LYRIC_HOLD_WINDOW_MS));
    const nextIndex = normalizedLyrics.findIndex((line, idx) => {
      const start = line.timeMs ?? idx * LYRIC_HOLD_WINDOW_MS;
      const nextStart = normalizedLyrics[idx + 1]?.timeMs ?? Number.POSITIVE_INFINITY;
      const end = Math.min(start + LYRIC_HOLD_WINDOW_MS, nextStart);
      return adjustedMs >= start && adjustedMs < end;
    });

    const resolved = nextIndex >= 0 ? nextIndex : fallbackIndex;
    if (resolved !== activeLineRef.current) {
      activeLineRef.current = resolved;
      setActiveLine(resolved);
      const target = lyricsContainerRef.current?.querySelector<HTMLElement>(`[data-lyric-index='${resolved}']`);
      target?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [interpolatedPositionMs, normalizedLyrics, player.data?.durationSec, rttCompensationMs, syncOffsetMs]);

  useEffect(() => {
    if (typeof player.data?.volume === "number") {
      setUiVolume(Math.min(200, Math.max(0, player.data.volume)));
    }
  }, [player.data?.volume]);

  const cacheProgress = useMemo(() => {
    if (!cache.data) return 0;
    return Math.min(100, Math.round((cache.data.sizeMb / cache.data.maxMb) * 100));
  }, [cache.data]);

  const playerProgress = useMemo(() => {
    if (!player.data || !player.data.durationSec) return 0;
    const currentSec = Math.max(interpolatedPositionMs / 1000, 0);
    return Math.min(100, Math.round((currentSec / player.data.durationSec) * 100));
  }, [interpolatedPositionMs, player.data?.durationSec]);

  const displayVolume = useMemo(() => Math.min(200, Math.max(0, Math.round(uiVolume))), [uiVolume]);
  const boostActive = displayVolume > 100;

  const loading = queue.isLoading || status.isLoading || cache.isLoading || settings.isLoading || player.isLoading;
  const playerUnavailable = player.isError;
  const queueUnavailable = queue.isError;
  const lyricsServiceUnavailable = false;
  const isKaraokeActive = karaokeEnabled;
  const canManageQueue = Boolean(currentUser?.permissions.dj || currentUser?.permissions.staff);
  const canViewStaffTab = (currentUser?.roleLevel ?? 0) >= 2;
  const manageableUsers = useMemo(
    () => sessionUsers.filter((user) => user.id !== currentUser?.id),
    [sessionUsers, currentUser?.id],
  );

  const createPreset = () => {
    const label = newPresetName.trim();
    if (!label) {
      toast({ title: "Name required", description: "Enter a playlist name.", variant: "destructive" });
      return;
    }
    createPresetMutation.mutate(label);
  };

  const addTrackToActivePreset = (track: ApiSearchResult) => {
    if (!activePreset) {
      toast({ title: "Select a playlist", description: "Create or pick a playlist first.", variant: "destructive" });
      return;
    }

    const presetId = getPresetId(activePreset);
    addTrackToPresetMutation.mutate({ presetId, track });
  };

  const removeTrackFromActivePreset = (trackIndex: number) => {
    if (!activePreset) return;
    const presetId = getPresetId(activePreset);
    removeTrackFromPresetMutation.mutate({ presetId, trackIndex });
  };

  const handleDeployToQueue = async (tracks: any[]) => {
    if (!tracks || tracks.length === 0) {
      toast({ title: "No tracks available to deploy.", variant: "destructive" });
      return;
    }

    toast({ title: "Deploying playlist to live Discord queue..." });

    try {
      const authHeaders = activeSessionToken ? { Authorization: `Bearer ${activeSessionToken}` } : {};

      for (const track of tracks) {
        await fetch(`${API_BASE_URL}/music/request`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "true",
            "x-guild-id": activeGuildId,
            "x-user-id": activeUserDiscordId,
            ...authHeaders,
          },
          body: JSON.stringify({
            query: track.url || track.title,
          }),
        });
      }
      toast({ title: "Entire playlist successfully appended to the live queue!" });
    } catch (error) {
      toast({ title: "An error occurred while deploying the playlist.", variant: "destructive" });
    }
  };

  const importExternalPlaylist = () => {
    if (!activePreset) {
      toast({ title: "Select a playlist", description: "Create or pick a playlist first.", variant: "destructive" });
      return;
    }

    const url = playlistImportUrl.trim();
    if (!url) {
      toast({ title: "URL required", description: "Paste a playlist URL to import.", variant: "destructive" });
      return;
    }

    const presetId = getPresetId(activePreset);
    importPlaylistToPresetMutation.mutate({ presetId, url });
  };

  const deletePreset = (preset: ApiPreset) => {
    const presetId = getPresetId(preset);
    deletePresetMutation.mutate(presetId, {
      onSuccess: () => {
        if (activePresetId === presetId) {
          const remaining = presetsData.filter((item) => getPresetId(item) !== presetId);
          setActivePresetId(remaining[0] ? getPresetId(remaining[0]) : null);
        }
      },
    });
  };

  const handleLyricSync = (idx: number, lineTimeMs: number | null) => {
    const clickedLineTime = lineTimeMs ?? idx * LYRIC_HOLD_WINDOW_MS;
    const currentSmoothTime = smoothTimeRef.current;
    const newOffset = clickedLineTime - currentSmoothTime;

    setSyncOffsetMs(newOffset);
    setActiveLine(idx);
    toast({ title: "Syncing...", description: "Lyric calibration updated." });
  };

  const handleDrop = useCallback(
    (newIndex: number) => {
      if (!canManageQueue) return;
      if (dragIndex === null || dragIndex === newIndex) return;
      reorderQueueMutation.mutate({ oldIndex: dragIndex, newIndex });
      setDragIndex(null);
    },
    [canManageQueue, dragIndex, reorderQueueMutation],
  );

  const toggleUserPermission = (userId: string, permission: "dj" | "staff") => {
    setSessionUsers((prev) =>
      prev.map((user) =>
        user.id === userId
          ? {
              ...user,
              permissions: {
                ...user.permissions,
                [permission]: !user.permissions[permission],
              },
            }
          : user,
      ),
    );
  };

  const loginWithDiscord = () => {
    const nextUser = sessionUsers[0] ?? null;
    setCurrentUser(nextUser);
    toast({
      title: nextUser ? "Connected" : "No session users",
      description: nextUser ? `Logged in as ${nextUser.name}.` : "No users are available in this session.",
    });
  };

  const logoutDiscord = () => {
    setCurrentUser(null);
    toast({ title: "Logged out", description: "Role-gated controls are now hidden." });
  };

  const getNearestPitchSemitone = useCallback((frames: ApiPitchMap["frames"], atMs: number) => {
    if (!frames.length) return null;

    let nearest = frames[0];
    for (let i = 1; i < frames.length; i += 1) {
      const candidate = frames[i];
      if (Math.abs(candidate.timeMs - atMs) < Math.abs(nearest.timeMs - atMs)) nearest = candidate;
    }

    return nearest.midi % 12;
  }, []);

  const startKaraoke = async () => {
    if (isGeneratingKaraoke) return;
    if (!activeGuildId || !currentTrack.url) {
      toast({
        title: "Karaoke unavailable",
        description: "Current track URL is missing, so karaoke processing cannot start.",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingKaraoke(true);
    try {
      const karaokePayload = await voxariaApi.startKaraoke(activeGuildId, currentTrack.url);
      const nextPitchMap = coercePitchMap(karaokePayload);
      if (!nextPitchMap) throw new Error("Pitch map unavailable");

      setCurrentPitchMap(nextPitchMap);

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const detector = PitchDetector.forNumberArray(analyser.fftSize);
      detector.clarityThreshold = MIN_PITCH_CLARITY;

      mediaStreamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      pitchDetectorRef.current = detector;
      micByteBufferRef.current = new Uint8Array(analyser.fftSize);

      setKaraokeEnabled(true);
      setKaraokeScore(0);
      setKaraokeCombo(0);
      setMaxCombo(0);
      karaokeScoreRef.current = 0;
      karaokeComboRef.current = 0;
      karaokeMaxComboRef.current = 0;
      karaokeStartTimeRef.current = Date.now();
      setScoreSummaryOpen(false);
      toast({ title: "Karaoke ready", description: "Pitch map generated and karaoke mode started." });
    } catch (error) {
      console.error("Start karaoke failed:", error);
      toast({ title: "Karaoke failed", description: "Could not generate karaoke pitch map.", variant: "destructive" });
    } finally {
      setIsGeneratingKaraoke(false);
    }
  };

  const stopKaraoke = useCallback(() => {
    if (karaokeAnimationRef.current) cancelAnimationFrame(karaokeAnimationRef.current);
    if (karaokeIntervalRef.current) window.clearInterval(karaokeIntervalRef.current);
    karaokeAnimationRef.current = null;
    karaokeIntervalRef.current = null;

    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    pitchDetectorRef.current = null;
    micByteBufferRef.current = null;
    latestPitchHzRef.current = null;
    setDetectedPitchHz(null);
    setKaraokeEnabled(false);
  }, []);

  const detectedNoteLabel = useMemo(() => {
    if (!detectedPitchHz) return "--";
    const midi = Math.round(12 * Math.log2(detectedPitchHz / 440) + 69);
    return NOTE_NAMES[((midi % 12) + 12) % 12];
  }, [detectedPitchHz]);

  useEffect(() => {
    if (!presetsData.length) {
      setActivePresetId(null);
      return;
    }

    if (!activePresetId || !presetsData.some((preset) => getPresetId(preset) === activePresetId)) {
      setActivePresetId(getPresetId(presetsData[0]));
    }
  }, [presetsData, activePresetId]);

  useEffect(() => {
    karaokeScoreRef.current = karaokeScore;
  }, [karaokeScore]);

  useEffect(() => {
    karaokeComboRef.current = karaokeCombo;
  }, [karaokeCombo]);

  useEffect(() => {
    karaokeMaxComboRef.current = maxCombo;
  }, [maxCombo]);

  useEffect(() => {
    if (!karaokeEnabled || !analyserRef.current || !pitchDetectorRef.current || !micByteBufferRef.current) return;

    const analyzer = analyserRef.current;
    const detector = pitchDetectorRef.current;
    const byteBuffer = micByteBufferRef.current;

    const detectFrame = () => {
      analyzer.getByteTimeDomainData(byteBuffer as unknown as Uint8Array<ArrayBuffer>);
      const normalizedSamples = Array.from(byteBuffer, (sample) => (sample - 128) / 128);
      const [pitchHz, clarity] = detector.findPitch(normalizedSamples, audioContextRef.current?.sampleRate ?? 44100);

      if (pitchHz > 0 && clarity >= MIN_PITCH_CLARITY) {
        latestPitchHzRef.current = pitchHz;
        setDetectedPitchHz(pitchHz);
      } else {
        latestPitchHzRef.current = null;
        setDetectedPitchHz(null);
      }

      karaokeAnimationRef.current = requestAnimationFrame(detectFrame);
    };

    karaokeAnimationRef.current = requestAnimationFrame(detectFrame);
    return () => {
      if (karaokeAnimationRef.current) cancelAnimationFrame(karaokeAnimationRef.current);
      karaokeAnimationRef.current = null;
    };
  }, [karaokeEnabled]);

  useEffect(() => {
    if (!karaokeEnabled || !currentPitchMap?.frames?.length) return;

    const toSemitone = (pitchHz: number) => {
      const midi = Math.round(12 * Math.log2(pitchHz / 440) + 69);
      return ((midi % 12) + 12) % 12;
    };

    karaokeIntervalRef.current = window.setInterval(() => {
      const nowMs = smoothTimeRef.current;
      const targetSemitone = getNearestPitchSemitone(currentPitchMap.frames, nowMs);
      const sungHz = latestPitchHzRef.current;

      if (targetSemitone === null || !sungHz) {
        if (karaokeComboRef.current !== 0) {
          karaokeComboRef.current = 0;
          setKaraokeCombo(0);
        }
        return;
      }

      const sungSemitone = toSemitone(sungHz);
      const delta = Math.abs(sungSemitone - targetSemitone);
      const wrappedDelta = Math.min(delta, 12 - delta);
      const onNote = wrappedDelta <= OCTAVE_TOLERANCE_SEMITONES;

      if (onNote) {
        const nextCombo = karaokeComboRef.current + 1;
        const gain = 100 + nextCombo * 8;
        const nextScore = karaokeScoreRef.current + gain;

        karaokeComboRef.current = nextCombo;
        karaokeScoreRef.current = nextScore;
        karaokeMaxComboRef.current = Math.max(karaokeMaxComboRef.current, nextCombo);

        setKaraokeCombo(nextCombo);
        setKaraokeScore(nextScore);
        setMaxCombo(karaokeMaxComboRef.current);
      } else if (karaokeComboRef.current !== 0) {
        karaokeComboRef.current = 0;
        setKaraokeCombo(0);
      }
    }, KARAOKE_SCORE_TICK_MS);

    return () => {
      if (karaokeIntervalRef.current) window.clearInterval(karaokeIntervalRef.current);
      karaokeIntervalRef.current = null;
    };
  }, [karaokeEnabled, currentPitchMap, getNearestPitchSemitone]);

  useEffect(() => {
    if (!karaokeEnabled || !player.data?.durationSec) return;

    const endWatcher = window.setInterval(() => {
      const ended = smoothTimeRef.current >= player.data.durationSec * 1000;
      if (!ended) return;

      stopKaraoke();
      setScoreSummaryOpen(true);
      toast({ title: "Song complete", description: "Karaoke score summary is ready." });
      window.clearInterval(endWatcher);
    }, 400);

    return () => window.clearInterval(endWatcher);
  }, [karaokeEnabled, player.data?.durationSec, stopKaraoke]);

  useEffect(() => () => stopKaraoke(), [stopKaraoke]);

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-background p-4 text-foreground">
        <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col gap-4">
          <div className="flex items-center justify-end">
            <Button className="neon-glow" onClick={loginWithDiscord}>
              Login with Discord
            </Button>
          </div>

          <article className="relative flex min-h-[520px] flex-1 flex-col rounded-md border border-primary/35 bg-panel-soft/75 p-5 shadow-soft neon-edge">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xl font-bold text-primary">Expanded Visualizer</h2>
                <p className="text-sm text-muted-foreground">
                  {playerUnavailable
                    ? "Service Unavailable"
                    : `${player.data?.title ?? "No track playing"} — ${player.data?.artist ?? "Unknown artist"}`}
                </p>
              </div>

              <Button
                variant="outline"
                className="border-primary/55 text-primary hover:bg-accent/40"
                onClick={() => void refreshLyrics()}
                disabled={isFetchingLyrics || !currentTrack.title}
              >
                {isFetchingLyrics ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh Lyrics"}
              </Button>
            </div>

            <div className="mb-3 rounded-md border border-primary/45 bg-accent/25 px-3 py-2 text-sm text-primary neon-glow">
              {lyricsServiceUnavailable
                ? "Service Unavailable"
                : lyricsUnavailable
                  ? "Lyrics not available"
                  : `Source: ${lyricsData?.source || "Unknown"}`}
            </div>

            <div ref={lyricsContainerRef} className="h-full overflow-y-auto pr-2">
              <div className="space-y-2">
                {normalizedLyrics.length ? (
                  normalizedLyrics.map((line, idx) => (
                    <button
                      key={`${line.text}-${idx}`}
                      data-lyric-index={idx}
                      data-lyric-time={line.timeMs ?? idx * LYRIC_HOLD_WINDOW_MS}
                      onClick={() => handleLyricSync(idx, line.timeMs)}
                      className={`block w-full rounded-sm border-l-4 px-2 py-1.5 text-left text-xl font-bold leading-relaxed transition ${
                        idx === activeLine
                          ? "border-l-[4px] bg-accent/35 text-primary neon-glow neon-text"
                          : "border-transparent text-foreground/85 hover:bg-muted/50 hover:text-foreground"
                      }`}
                      style={
                        idx === activeLine
                          ? {
                              borderLeftColor: "#39ff14",
                              textShadow: "0 0 10px rgba(57, 255, 20, 0.8)",
                            }
                          : undefined
                      }
                    >
                      {line.text}
                    </button>
                  ))
                ) : (
                  <p className="rounded-sm border border-border/60 bg-panel/70 px-3 py-2 text-sm text-muted-foreground">
                    {lyricsServiceUnavailable ? "Service Unavailable" : "Lyrics not available"}
                  </p>
                )}
              </div>
            </div>
          </article>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen lg:pl-[240px]">
        <aside className="fixed left-0 top-0 z-20 hidden h-screen w-[240px] flex-col border-r border-border/70 bg-panel/90 p-4 backdrop-blur-xl lg:flex">
          <div className="mb-8 rounded-md border border-primary/40 bg-panel-soft/85 p-3 shadow-soft neon-glow">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Discord Music Bot</p>
            <h1 className="text-xl font-semibold text-primary">Voxaria</h1>
          </div>

          <nav className="space-y-2">
            {navItems.map(({ label, icon: Icon }, idx) => (
              <button
                key={label}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                  idx === 0
                    ? "border-primary/65 bg-accent/70 text-accent-foreground shadow-soft neon-glow"
                    : "border-border/70 bg-panel-soft/65 text-muted-foreground hover:border-primary/55 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto rounded-md border border-border/70 bg-panel-soft/75 p-3 text-xs text-muted-foreground">
            <p>Status: <span className="text-success">{status.data?.online ? "Online" : "Offline"}</span></p>
            <p>Shard #{status.data?.activeShard ?? 0} · {status.data?.pingMs ?? 0}ms</p>
          </div>
        </aside>

        <main className="flex min-h-screen flex-col pb-36">
          <header className="sticky top-0 z-10 border-b border-border/70 bg-background/85 p-4 backdrop-blur-xl">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-panel-soft/70 p-2 shadow-soft">
              <Search className="ml-1 h-4 w-4 text-primary" />
              <div className="flex items-center gap-2 text-muted-foreground">
                <Youtube className="h-4 w-4 text-primary" />
                <Disc3 className="h-4 w-4 text-primary" />
                <span className="text-[11px]">Spotify</span>
              </div>
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search songs..."
                className="h-10 min-w-[220px] flex-1 border-none bg-transparent focus-visible:ring-0"
              />
              <Button
                className="h-10 rounded-md neon-glow"
                disabled={searchMutation.isPending || !searchTerm.trim()}
                onClick={() => searchMutation.mutate({ query: searchTerm.trim(), guildId: activeGuildId })}
              >
                {searchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </Button>
              <Button
                className="h-10 rounded-md neon-glow"
                disabled={summonBotMutation.isPending}
                onClick={() => summonBotMutation.mutate({ guildId: activeGuildId })}
              >
                {summonBotMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Summon Bot"}
              </Button>
              <Button variant="outline" className="h-10 border-primary/55 text-primary hover:bg-accent/35" onClick={logoutDiscord}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <section className="flex-1 p-4">
            <div className="grid h-full gap-4 xl:grid-cols-[1.8fr_380px]">
              <article className="relative flex min-h-[520px] flex-col rounded-md border border-primary/35 bg-panel-soft/75 p-5 shadow-soft neon-edge">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-bold text-primary">Expanded Visualizer</h2>
                    <p className="text-sm text-muted-foreground">
                      {playerUnavailable
                        ? "Service Unavailable"
                        : `${player.data?.title ?? "No track playing"} — ${player.data?.artist ?? "Unknown artist"}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant={karaokeEnabled ? "secondary" : "outline"}
                      className="border-primary/55 text-primary hover:bg-accent/40"
                      onClick={() => (karaokeEnabled ? stopKaraoke() : void startKaraoke())}
                      disabled={isGeneratingKaraoke}
                    >
                      {isGeneratingKaraoke ? <Loader2 className="h-4 w-4 animate-spin" /> : karaokeEnabled ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                      {isGeneratingKaraoke ? "Processing..." : karaokeEnabled ? "Stop Karaoke" : "Start Karaoke"}
                    </Button>
                    <Button
                    variant="outline"
                    className="border-primary/55 text-primary hover:bg-accent/40"
                    onClick={() => void refreshLyrics()}
                    disabled={isFetchingLyrics || !currentTrack.title}
                  >
                    {isFetchingLyrics ? <Loader2 className="h-4 w-4 animate-spin" /> : "Refresh Lyrics"}
                  </Button>
                  </div>
                </div>

                <div className="mb-3 rounded-md border border-primary/45 bg-accent/25 px-3 py-2 text-sm text-primary neon-glow">
                  {lyricsServiceUnavailable
                    ? "Service Unavailable"
                    : lyricsUnavailable
                      ? "Lyrics not available"
                      : `Source: ${lyricsData?.source || "Unknown"}`}
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2 rounded-md border border-border/70 bg-panel/70 p-2 text-xs">
                  <div className="rounded-sm border border-border/70 bg-panel-soft/70 px-2 py-1">
                    <p className="text-muted-foreground">Score</p>
                    <p className="text-sm font-semibold text-primary">{karaokeScore.toLocaleString()}</p>
                  </div>
                  <div className="rounded-sm border border-border/70 bg-panel-soft/70 px-2 py-1">
                    <p className="text-muted-foreground">Combo</p>
                    <p className="text-sm font-semibold text-primary">x{karaokeCombo}</p>
                  </div>
                  <div className="rounded-sm border border-border/70 bg-panel-soft/70 px-2 py-1">
                    <p className="text-muted-foreground">Detected Note</p>
                    <p className="text-sm font-semibold text-primary">{detectedNoteLabel}</p>
                  </div>
                  <div className="rounded-sm border border-border/70 bg-panel-soft/70 px-2 py-1">
                    <p className="text-muted-foreground">Pitch Map</p>
                    <p className="text-sm font-semibold text-primary">{currentPitchMap?.frames?.length ? "Ready" : "Unavailable"}</p>
                  </div>
                </div>

                {isKaraokeActive && (
                  <Collapsible open={lyricsOpen} onOpenChange={setLyricsOpen} className="min-h-0 flex-1 rounded-md border border-border/70 bg-panel/75">
                    <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-primary hover:bg-accent/25">
                      <span className="flex items-center gap-2"><Music size={18} /> Live Karaoke Lyrics</span>
                      {lyricsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="h-[380px] border-t border-border/70 px-2 py-2">
                      <div ref={lyricsContainerRef} className="h-full overflow-y-auto pr-2">
                        <div className="space-y-2">
                          {normalizedLyrics.length ? (
                            normalizedLyrics.map((line, idx) => (
                              <button
                                key={`${line.text}-${idx}`}
                                data-lyric-index={idx}
                                data-lyric-time={line.timeMs ?? idx * LYRIC_HOLD_WINDOW_MS}
                                onClick={() => handleLyricSync(idx, line.timeMs)}
                                className={`block w-full rounded-sm border-l-4 px-2 py-1.5 text-left text-xl font-bold leading-relaxed transition ${
                                  idx === activeLine
                                    ? "border-l-[4px] bg-accent/35 text-primary neon-glow neon-text"
                                    : "border-transparent text-foreground/85 hover:bg-muted/50 hover:text-foreground"
                                }`}
                                style={
                                  idx === activeLine
                                    ? {
                                        borderLeftColor: "#39ff14",
                                        textShadow: "0 0 10px rgba(57, 255, 20, 0.8)",
                                      }
                                    : undefined
                                }
                              >
                                {line.text}
                              </button>
                            ))
                          ) : (
                            <p className="rounded-sm border border-border/60 bg-panel/70 px-3 py-2 text-sm text-muted-foreground">
                              {lyricsServiceUnavailable ? "Service Unavailable" : "Lyrics not available"}
                            </p>
                          )}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </article>

              <aside className="flex min-h-[520px] flex-col gap-4 rounded-md border border-border/70 bg-panel-soft/70 p-3 shadow-soft">
                <section className="rounded-md border border-primary/40 bg-panel/80 p-3 neon-glow">
                  <h3 className="mb-2 text-sm font-semibold text-primary">Request Song</h3>
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!requestTerm.trim()) return;
                      requestMutation.mutate({ query: requestTerm.trim(), guildId: activeGuildId });
                    }}
                  >
                    <Input
                      value={requestTerm}
                      onChange={(e) => setRequestTerm(e.target.value)}
                      placeholder="Type song title, artist, or URL..."
                      className="h-9 bg-panel-soft/60"
                    />
                    <Button className="h-9 w-full neon-glow" disabled={requestMutation.isPending || !requestTerm.trim()}>
                      {requestMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request"}
                    </Button>
                  </form>
                </section>

                <section className="flex min-h-0 flex-1 flex-col rounded-md border border-primary/40 bg-panel/80 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-primary">Upcoming Queue</h3>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-accent text-accent-foreground">{(queue.data ?? []).length} tracks</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-primary/55 text-primary hover:bg-accent/35"
                        onClick={() => shuffleQueueMutation.mutate()}
                        disabled={shuffleQueueMutation.isPending}
                      >
                        <Shuffle className="h-3.5 w-3.5" /> Shuffle
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 overflow-y-auto pr-1">
                    {queueUnavailable ? (
                      <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">Service Unavailable</p>
                    ) : (
                      (queue.data ?? []).map((track, index) =>
                        queueRow(
                          track,
                          index,
                          (idx) => deleteQueueItemMutation.mutate(idx),
                          (idx) => setDragIndex(idx),
                          handleDrop,
                          dragIndex === index,
                          canManageQueue,
                        ),
                      )
                    )}
                  </div>
                </section>
              </aside>
            </div>
          </section>

          <section className="grid gap-4 px-4 pb-4 lg:grid-cols-5">
            <article className="rounded-[12px] border border-primary/35 bg-panel-soft/70 p-4 shadow-soft backdrop-blur-xl neon-edge">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-primary">Now Playing</h3>
                <Badge className="bg-accent text-accent-foreground">Live</Badge>
              </div>

              <div className="flex items-center gap-3 rounded-md border border-border/70 bg-panel/70 p-3">
                {player.data?.thumbnail || player.data?.art ? (
                  <img
                    src={player.data?.thumbnail ?? player.data?.art ?? ""}
                    alt={`${player.data?.title ?? "Current song"} album cover`}
                    loading="lazy"
                    className="h-14 w-14 rounded-md border border-border/70 object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-md border border-border/70 bg-panel-soft">
                    <Disc3 className="h-5 w-5 text-primary" />
                  </div>
                )}

                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{playerUnavailable ? "Service Unavailable" : player.data?.title ?? "No track playing"}</p>
                  <p className="truncate text-xs text-muted-foreground">{playerUnavailable ? "Service Unavailable" : player.data?.artist ?? "Waiting for backend data"}</p>
                  <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {player.data?.requesterAvatar ? (
                      <img
                        src={player.data.requesterAvatar}
                        alt={`${player.data?.requesterName ?? "Requester"} avatar`}
                        loading="lazy"
                        className="h-4 w-4 rounded-full border border-border object-cover"
                      />
                    ) : (
                      <UserCircle2 className="h-4 w-4" />
                    )}
                    <span className="truncate">Requested by {player.data?.requesterName?.trim() || "Unknown"}</span>
                  </div>
                </div>
              </div>
            </article>

            <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
              <h3 className="mb-2 text-sm font-semibold">Audio Cache Status</h3>
              <p className="mb-2 text-xs text-muted-foreground">Cache Size: {cache.data?.sizeMb ?? 142} MB</p>
              <Progress value={cacheProgress} className="h-2" />
              <Button
                variant="outline"
                className="mt-3 w-full border-primary/50 text-primary hover:bg-accent/40"
                onClick={() => cleanCacheMutation.mutate()}
                disabled={cleanCacheMutation.isPending}
              >
                {cleanCacheMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Clean Audio Cache
              </Button>
            </article>

            <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
              <Tabs defaultValue="system" className="space-y-3">
                <TabsList className="h-9 w-full justify-start">
                  <TabsTrigger value="system">System</TabsTrigger>
                  {canViewStaffTab && <TabsTrigger value="staff">Staff</TabsTrigger>}
                </TabsList>

                <TabsContent value="system" className="mt-0">
                  <h3 className="mb-2 text-sm font-semibold">System Settings</h3>
                  <div className="flex items-center justify-between rounded-md border border-border/70 bg-panel p-3">
                    <div>
                      <p className="text-sm font-medium">Enable Session Restore</p>
                      <p className="text-xs text-muted-foreground">Restore queue/session after reconnect.</p>
                    </div>
                    <Switch
                      checked={settings.data?.sessionRestoreEnabled ?? false}
                      onCheckedChange={(value) => sessionRestoreMutation.mutate(value)}
                      disabled={sessionRestoreMutation.isPending}
                    />
                  </div>
                </TabsContent>

                {canViewStaffTab && (
                  <TabsContent value="staff" className="mt-0 space-y-2">
                    <h3 className="text-sm font-semibold">Session Permissions</h3>
                    {manageableUsers.length ? (
                      manageableUsers.map((user) => (
                        <div key={user.id} className="rounded-md border border-border/70 bg-panel p-2.5">
                          <div className="mb-2 flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">{user.name}</p>
                            <Badge variant="outline" className="border-primary/40 text-primary">Role {user.roleLevel}</Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex items-center justify-between rounded-md border border-border/70 px-2 py-1.5">
                              <span className="text-xs text-muted-foreground">DJ</span>
                              <Switch
                                checked={user.permissions.dj}
                                onCheckedChange={() => toggleUserPermission(user.id, "dj")}
                              />
                            </div>
                            <div className="flex items-center justify-between rounded-md border border-border/70 px-2 py-1.5">
                              <span className="text-xs text-muted-foreground">Staff</span>
                              <Switch
                                checked={user.permissions.staff}
                                onCheckedChange={() => toggleUserPermission(user.id, "staff")}
                              />
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                        No other users in this session.
                      </p>
                    )}
                  </TabsContent>
                )}
              </Tabs>
            </article>

            <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
              <h3 className="mb-2 text-sm font-semibold">Recent History</h3>
              <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 132 }}>
                {(history.data ?? []).slice(0, 3).map((track, index) =>
                  queueRow(track, index, () => undefined, () => undefined, () => undefined, false, false),
                )}
              </div>
            </article>

            <AuditLogViewer />

            <article className="rounded-xl border border-primary/35 bg-panel-soft/70 p-4 shadow-soft neon-edge">
              <h3 className="mb-2 text-sm font-semibold text-primary">Playlist Presets</h3>
              <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                Playlist Builder now edits saved playlists only. It no longer pushes tracks to the live queue.
              </p>
            </article>
          </section>

          <section className="px-4 pb-4">
            <Tabs defaultValue="playlist-builder" className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
              <TabsList className="mb-3 h-9">
                <TabsTrigger value="playlist-builder">Playlist Builder</TabsTrigger>
              </TabsList>

              <TabsContent value="playlist-builder" className="mt-0 space-y-3">
                <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
                  <aside className="rounded-md border border-border/70 bg-panel/80 p-3">
                    <h3 className="mb-2 text-sm font-semibold text-primary">Saved Playlists</h3>
                    <div className="mb-3 grid grid-cols-[1fr_auto] gap-2">
                      <Input
                        value={newPresetName}
                        onChange={(e) => setNewPresetName(e.target.value)}
                        placeholder="New playlist name"
                        className="h-9 bg-panel-soft/60"
                      />
                      <Button
                        size="sm"
                        className="h-9 neon-glow"
                        onClick={createPreset}
                        disabled={!newPresetName.trim() || createPresetMutation.isPending}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="space-y-2" style={{ maxHeight: 360, overflowY: "auto" }}>
                      {presetsData.length ? (
                        presetsData.map((preset, idx) => {
                          const presetId = getPresetId(preset);
                          const isActive = activePresetId === presetId;
                          return (
                            <div
                              key={`${presetId}-${idx}`}
                              className={`flex items-center justify-between rounded-md border p-2 transition ${
                                isActive ? "border-primary/55 bg-accent/30" : "border-border/70 bg-panel-soft/70"
                              }`}
                            >
                              <button
                                type="button"
                                className="min-w-0 flex-1 text-left"
                                onClick={() => setActivePresetId(presetId)}
                              >
                                <p className="truncate text-xs font-semibold text-foreground">{preset.name}</p>
                                <p className="text-[11px] text-muted-foreground">{preset.tracks ?? preset.items?.length ?? 0} tracks</p>
                              </button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:bg-accent/35 hover:text-primary"
                                onClick={() => deletePreset(preset)}
                                disabled={deletePresetMutation.isPending}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          );
                        })
                      ) : (
                        <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                          No saved playlists yet.
                        </p>
                      )}
                    </div>
                  </aside>

                  <section className="rounded-md border border-border/70 bg-panel/80 p-3">
                    <h3 className="mb-2 text-sm font-semibold text-primary">Active Editor</h3>
                    {activePreset ? (
                      <>
                        <p className="mb-2 text-xs text-muted-foreground">Editing: {activePreset.name}</p>
                        <div className="relative mb-3">
                          <Input
                            value={playlistBuilderQuery}
                            onChange={(e) => setPlaylistBuilderQuery(e.target.value)}
                            placeholder="Search catalog and add tracks to this playlist..."
                            className="h-9 bg-panel-soft/60"
                          />

                          {playlistBuilderQuery.trim().length > 1 && (
                            <div className="absolute left-0 right-0 z-20 mt-1 max-h-56 space-y-2 overflow-y-auto rounded-md border border-border/70 bg-panel p-2 shadow-lg">
                              {playlistSearch.isLoading ? (
                                <p className="rounded-md border border-border/70 bg-panel-soft/70 px-3 py-2 text-xs text-muted-foreground">
                                  Searching...
                                </p>
                              ) : playlistSearch.isError ? (
                                <p className="rounded-md border border-border/70 bg-panel-soft/70 px-3 py-2 text-xs text-muted-foreground">
                                  Service Unavailable
                                </p>
                              ) : (playlistSearch.data ?? []).length ? (
                                (playlistSearch.data ?? []).map((track) => (
                                  <div key={track.id} className="flex items-center gap-2 rounded-md border border-border/70 bg-panel-soft/70 p-2">
                                    {track.thumbnail ? (
                                      <img src={track.thumbnail} alt={`${track.title} thumbnail`} loading="lazy" className="h-10 w-10 rounded object-cover" />
                                    ) : (
                                      <div className="flex h-10 w-10 items-center justify-center rounded border border-border/70 bg-panel">
                                        <Disc3 className="h-4 w-4 text-muted-foreground" />
                                      </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                                      <p className="truncate text-[11px] text-muted-foreground">{track.artist}</p>
                                    </div>
                                    <Button
                                      size="icon"
                                      className="h-8 w-8 neon-glow"
                                      onClick={() => addTrackToActivePreset(track)}
                                      disabled={addTrackToPresetMutation.isPending}
                                      aria-label={`Add ${track.title} to playlist`}
                                    >
                                      <Plus className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))
                              ) : (
                                <p className="rounded-md border border-border/70 bg-panel-soft/70 px-3 py-2 text-xs text-muted-foreground">
                                  No matches found.
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="mb-3 rounded-md border border-primary/35 bg-accent/20 p-3">
                          <p className="mb-2 text-xs font-semibold text-primary">Import External Playlist</p>
                          <div className="flex items-center gap-2">
                            <Input
                              value={playlistImportUrl}
                              onChange={(e) => setPlaylistImportUrl(e.target.value)}
                              placeholder="Paste YouTube or Spotify playlist URL"
                              className="h-9 bg-panel-soft/60"
                            />
                            <Button
                              type="button"
                              onClick={importExternalPlaylist}
                              disabled={importPlaylistToPresetMutation.isPending}
                              className="h-9"
                            >
                              {importPlaylistToPresetMutation.isPending ? (
                                <span className="inline-flex items-center gap-2">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  Importing...
                                </span>
                              ) : (
                                "Import Playlist"
                              )}
                            </Button>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeployToQueue(activePresetTracks as any[])}
                          className="w-full mb-4 p-3 bg-neonGreen text-black font-bold rounded-xl hover:bg-neonGreen/80 transition-all flex items-center justify-center gap-2"
                        >
                          <Play size={18} /> Deploy Playlist to Live Bot Queue
                        </button>

                        <div className="space-y-2" style={{ maxHeight: 260, overflowY: "auto" }}>
                          {activePresetTracks.length ? (
                            activePresetTracks.map((track, index) => (
                              <div key={`${track.id}-${index}`} className="flex items-center justify-between rounded-md border border-border/70 bg-panel-soft/70 p-2">
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
                                  <p className="truncate text-[11px] text-muted-foreground">{track.artist}</p>
                                </div>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-muted-foreground hover:bg-accent/35 hover:text-primary"
                                  onClick={() => removeTrackFromActivePreset(index)}
                                  disabled={removeTrackFromPresetMutation.isPending}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))
                          ) : (
                            <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                              No tracks in this playlist yet.
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">
                        Create a playlist on the left to start editing.
                      </p>
                    )}
                  </section>
                </div>
              </TabsContent>
            </Tabs>
          </section>
        </main>
      </div>

      <Dialog open={scoreSummaryOpen} onOpenChange={setScoreSummaryOpen}>
        <DialogContent className="max-w-sm border-primary/35 bg-panel text-foreground">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary"><Trophy className="h-5 w-5" /> Score Summary</DialogTitle>
            <DialogDescription>Party of 1 run complete.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-border/70 bg-panel-soft/70 p-3">
              <p className="text-xs text-muted-foreground">Final Score</p>
              <p className="text-lg font-semibold text-primary">{karaokeScore.toLocaleString()}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-panel-soft/70 p-3">
              <p className="text-xs text-muted-foreground">Best Combo</p>
              <p className="text-lg font-semibold text-primary">x{maxCombo}</p>
            </div>
          </div>
          <DialogFooter>
            <Button className="neon-glow" onClick={() => setScoreSummaryOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <footer className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/70 bg-panel/90 px-4 py-3 backdrop-blur-xl">
        <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-[1.2fr_1.6fr_1fr]">
          <div className="flex min-w-0 items-center gap-3">
            {player.data?.art ? (
              <img src={player.data.art} alt="Now playing cover" className="h-14 w-14 rounded object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded border border-border bg-panel">
                <Disc3 className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{playerUnavailable ? "Service Unavailable" : player.data?.title ?? "No track playing"}</p>
              <p className="truncate text-xs text-muted-foreground">{playerUnavailable ? "Service Unavailable" : player.data?.artist ?? "Unknown artist"}</p>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-center gap-2">
              <Button size="icon" variant="secondary" className="border border-primary/35 text-primary hover:bg-accent/35" onClick={() => previousTrackMutation.mutate()}>
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button size="icon" className="h-12 w-12 rounded-full neon-glow" onClick={() => playbackMutation.mutate("play_pause")}>
                {player.data?.isPaused === false ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
              <Button size="icon" variant="secondary" className="border border-primary/35 text-primary hover:bg-accent/35" onClick={() => playbackMutation.mutate("next")}>
                <SkipForward className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="secondary" className="border border-primary/35 text-primary hover:bg-accent/35" onClick={() => playbackMutation.mutate("stop")}>
                <Square className="h-4 w-4" />
              </Button>
            </div>
            <Progress value={playerProgress} className="h-1.5" />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span ref={currentPositionRef}>{formatSec(player.data?.positionSec ?? 0)}</span>
              <span ref={totalDurationRef}>{formatSec(player.data?.durationSec ?? 0)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <div className="flex w-44 items-center gap-2">
              <Volume2 className="h-4 w-4 text-primary" />
              <Slider
                value={[displayVolume]}
                max={200}
                step={1}
                onValueChange={([v]) => setUiVolume(v)}
                onValueCommit={([v]) => volumeMutation.mutate(v)}
                className="neon-glow rounded-full"
              />
              <span className={`w-12 text-right text-sm font-semibold text-primary ${boostActive ? "animate-pulse neon-text-boost" : "neon-text"}`}>
                {displayVolume}%
              </span>
            </div>
            <Separator orientation="vertical" className="hidden h-7 md:block" />
            <Button variant="outline" className="border-primary/55 text-primary hover:bg-accent/35" onClick={() => clearQueueMutation.mutate()}>
              Clear Queue
            </Button>
            <Button variant="outline" className="border-primary/55 text-primary hover:bg-accent/35" size="icon" onClick={() => leaveMutation.mutate()}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </footer>

      {loading && (
        <div className="pointer-events-none fixed right-4 top-4 z-40 rounded-md border border-primary/45 bg-panel px-3 py-1 text-xs text-primary neon-glow">
          Syncing live data...
        </div>
      )}
    </div>
  );
};

export default Index;
