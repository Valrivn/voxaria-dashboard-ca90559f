import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  GripVertical,
  Disc3,
  History,
  ListMusic,
  Loader2,
  LogOut,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { mockData, voxariaApi, type ApiLyrics, type ApiPreset, type ApiTrack } from "@/lib/voxaria-api";

type NavItem = { label: string; icon: typeof Disc3 };
type LyricLine = { text: string; timeMs: number | null };

const LYRIC_OFFSET_DEFAULT_MS = 3000;
const LYRIC_HOLD_WINDOW_MS = 3000;

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

const formatTrackDuration = (duration: ApiTrack["duration"]) => {
  if (typeof duration === "number") return formatSec(duration);
  return duration;
};

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
) => (
  <article
    key={track.id}
    draggable
    onDragStart={() => onDragStart(index)}
    onDragOver={(e) => e.preventDefault()}
    onDrop={() => onDrop(index)}
    className={`grid grid-cols-[20px_38px_1fr_52px_28px_28px] items-center gap-2 rounded-md border border-border/70 bg-panel/80 p-2 transition hover:border-primary/55 hover:neon-glow ${
      isDragging ? "opacity-55" : ""
    }`}
  >
    <button
      type="button"
      className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent/35 hover:text-primary"
      aria-label="Drag queue item"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>

    {track.art ? (
      <img src={track.art} alt={`${track.title} cover`} loading="lazy" className="h-9 w-9 rounded object-cover" />
    ) : (
      <div className="flex h-9 w-9 items-center justify-center rounded border border-border bg-panel-soft">
        <Disc3 className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    )}

    <div className="min-w-0">
      <p className="truncate text-xs font-semibold text-foreground">{track.title}</p>
      <p className="truncate text-[11px] text-muted-foreground">{track.artist}</p>
    </div>

    <p className="text-[10px] text-muted-foreground">{formatTrackDuration(track.duration)}</p>

    {track.requesterAvatar ? (
      <img src={track.requesterAvatar} alt={`${track.requestedBy} avatar`} loading="lazy" className="h-7 w-7 rounded-full border border-border object-cover" />
    ) : (
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-panel-soft">
        <UserCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
    )}

    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-7 w-7 text-muted-foreground hover:bg-accent/35 hover:text-primary"
      onClick={() => onDelete(index)}
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  </article>
);

const Index = () => {
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [requestTerm, setRequestTerm] = useState("");
  const [lyricsData, setLyricsData] = useState<ApiLyrics | null>(null);
  const [activeLine, setActiveLine] = useState(0);
  const [lyricsUnavailable, setLyricsUnavailable] = useState(false);
  const [uiVolume, setUiVolume] = useState(100);
  const [manualOffsetMs, setManualOffsetMs] = useState(LYRIC_OFFSET_DEFAULT_MS);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const animationFrameRef = useRef<number | null>(null);
  const lyricsContainerRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef(0);
  const currentPositionRef = useRef<HTMLSpanElement | null>(null);
  const totalDurationRef = useRef<HTMLSpanElement | null>(null);

  const queue = useQuery({ queryKey: ["queue"], queryFn: voxariaApi.getQueue, refetchInterval: 10000 });
  const history = useQuery({ queryKey: ["history"], queryFn: async () => voxariaApi.getHistory().catch(() => mockData.history), refetchInterval: 14000 });
  const status = useQuery({ queryKey: ["status"], queryFn: async () => voxariaApi.getStatus().catch(() => mockData.status), refetchInterval: 10000 });
  const cache = useQuery({ queryKey: ["cache"], queryFn: async () => voxariaApi.getCache().catch(() => mockData.cache), refetchInterval: 15000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => voxariaApi.getSettings().catch(() => mockData.settings) });
  const player = useQuery({ queryKey: ["player"], queryFn: voxariaApi.getPlayer, refetchInterval: 5000 });
  const presets = useQuery({ queryKey: ["presets"], queryFn: voxariaApi.getPresets, refetchInterval: 30000 });

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["queue"] });
    void queryClient.invalidateQueries({ queryKey: ["history"] });
    void queryClient.invalidateQueries({ queryKey: ["status"] });
    void queryClient.invalidateQueries({ queryKey: ["cache"] });
    void queryClient.invalidateQueries({ queryKey: ["player"] });
  };

  const searchMutation = useMutation({
    mutationFn: async (query: string) => voxariaApi.search(query),
    onSuccess: () => {
      toast({ title: "Queued", description: "Search request sent to Voxaria." });
      refreshAll();
    },
    onError: () => toast({ title: "Search failed", description: "Could not reach backend endpoint.", variant: "destructive" }),
  });

  const requestMutation = useMutation({
    mutationFn: async (query: string) => voxariaApi.search(query),
    onSuccess: () => {
      toast({ title: "Request submitted", description: "Song request pushed to queue." });
      setRequestTerm("");
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
    },
    onError: () => toast({ title: "Request failed", description: "Could not submit request.", variant: "destructive" }),
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
    mutationFn: voxariaApi.summonBot,
    onSuccess: () => toast({ title: "Summon sent", description: "Voxaria join request sent." }),
    onError: () => toast({ title: "Summon failed", description: "Could not send join request.", variant: "destructive" }),
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

  const savePresetMutation = useMutation({
    mutationFn: (name: string) => voxariaApi.savePreset(name),
    onSuccess: () => {
      toast({ title: "Preset saved" });
      setPresetName("");
      setSavePresetOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["presets"] });
    },
    onError: () => toast({ title: "Save failed", description: "Could not save preset.", variant: "destructive" }),
  });

  const loadPresetMutation = useMutation({
    mutationFn: (name: string) => voxariaApi.loadPreset(name),
    onSuccess: () => {
      toast({ title: "Preset loaded" });
      void queryClient.invalidateQueries({ queryKey: ["queue"] });
      void queryClient.invalidateQueries({ queryKey: ["player"] });
    },
    onError: () => toast({ title: "Load failed", description: "Could not load preset.", variant: "destructive" }),
  });

  const lyricsMutation = useMutation({
    mutationFn: async ({ title, artist }: { title: string; artist: string }) => voxariaApi.getLyrics(title, artist),
    onSuccess: (data) => {
      if (!data.lines?.length) {
        setLyricsData(null);
        setLyricsUnavailable(true);
        setActiveLine(0);
        return;
      }

      setLyricsUnavailable(false);
      setLyricsData(data);
      setActiveLine(0);
      toast({ title: "Lyrics synced", description: "Live lyrics loaded." });
    },
    onError: () => {
      setLyricsData(null);
      setLyricsUnavailable(true);
      setActiveLine(0);
      toast({ title: "Service Unavailable", description: "Lyrics service is currently unreachable." });
    },
  });

  const currentTrack = useMemo(
    () => ({
      title: (player.data?.title ?? "").trim(),
      artist: (player.data?.artist ?? "").trim(),
    }),
    [player.data?.title, player.data?.artist],
  );

  const currentTrackKey = `${currentTrack.title}::${currentTrack.artist}`;
  const normalizedLyrics = useMemo(() => (lyricsData?.lines ?? []).map(parseLyricLine).filter((line) => line.text.length > 0), [lyricsData?.lines]);

  useEffect(() => {
    if (!currentTrack.title && !currentTrack.artist) {
      setLyricsData(null);
      setLyricsUnavailable(true);
      setActiveLine(0);
      return;
    }

    lyricsMutation.mutate({ title: currentTrack.title, artist: currentTrack.artist });
  }, [currentTrackKey]);

  useEffect(() => {
    activeLineRef.current = activeLine;
  }, [activeLine]);

  useEffect(() => {
    if (!player.data) return;
    if (!normalizedLyrics.length) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      return;
    }

    const fallbackStart = Date.now() - Math.max(0, player.data.positionSec ?? 0) * 1000;
    const startTime = player.data.startTime ?? fallbackStart;

    const frame = () => {
      const now = Date.now();
      const paused = Boolean(player.data.isPaused);
      const rawMs = paused
        ? Math.max(0, (player.data.lastPausedAt ?? now) - startTime)
        : Math.max(0, now - startTime);

      const adjustedMs = Math.max(0, rawMs - manualOffsetMs);

      if (currentPositionRef.current) {
        currentPositionRef.current.textContent = formatSec(adjustedMs / 1000);
      }

      if (totalDurationRef.current) {
        totalDurationRef.current.textContent = formatSec(player.data.durationSec ?? 0);
      }

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

      animationFrameRef.current = requestAnimationFrame(frame);
    };

    animationFrameRef.current = requestAnimationFrame(frame);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [player.data?.startTime, player.data?.positionSec, player.data?.durationSec, player.data?.isPaused, player.data?.lastPausedAt, manualOffsetMs, normalizedLyrics]);

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
    return Math.min(100, Math.round((Math.max(player.data.positionSec, 0) / player.data.durationSec) * 100));
  }, [player.data?.positionSec, player.data?.durationSec]);

  const displayVolume = useMemo(() => Math.min(200, Math.max(0, Math.round(uiVolume))), [uiVolume]);
  const boostActive = displayVolume > 100;

  const loading = queue.isLoading || status.isLoading || cache.isLoading || settings.isLoading || player.isLoading;
  const playerUnavailable = player.isError;
  const queueUnavailable = queue.isError;
  const lyricsServiceUnavailable = lyricsMutation.isError;

  const saveCurrentQueueAsPreset = (name: string) => {
    const label = name.trim();
    if (!label) {
      toast({ title: "Name required", description: "Enter a playlist name before saving.", variant: "destructive" });
      return;
    }
    savePresetMutation.mutate(label);
  };

  const loadPreset = (preset: ApiPreset) => loadPresetMutation.mutate(preset.name);

  const handleDrop = useCallback(
    (newIndex: number) => {
      if (dragIndex === null || dragIndex === newIndex) return;
      reorderQueueMutation.mutate({ oldIndex: dragIndex, newIndex });
      setDragIndex(null);
    },
    [dragIndex, reorderQueueMutation],
  );

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
                onClick={() => searchMutation.mutate(searchTerm.trim())}
              >
                {searchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </Button>
              <Button
                className="h-10 rounded-md neon-glow"
                disabled={summonBotMutation.isPending}
                onClick={() => summonBotMutation.mutate()}
              >
                {summonBotMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Summon Bot"}
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

                    <Button
                    variant="outline"
                    className="border-primary/55 text-primary hover:bg-accent/40"
                    onClick={() => lyricsMutation.mutate({ title: currentTrack.title, artist: currentTrack.artist })}
                    disabled={lyricsMutation.isPending || (!currentTrack.title && !currentTrack.artist)}
                  >
                    Refresh Lyrics
                  </Button>
                </div>

                  <div className="mb-3 rounded-md border border-primary/45 bg-panel/65 px-3 py-2">
                    <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Manual Offset</span>
                      <span className="font-semibold text-primary neon-text">{(manualOffsetMs / 1000).toFixed(1)}s</span>
                    </div>
                    <Slider
                      value={[manualOffsetMs]}
                      min={-5000}
                      max={15000}
                      step={100}
                      onValueChange={([v]) => setManualOffsetMs(v)}
                      className="neon-glow"
                    />
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
                        onClick={() => setActiveLine(idx)}
                        className={`block w-full rounded-sm border-l-4 px-2 py-1.5 text-left text-xl font-bold leading-relaxed transition ${
                          idx === activeLine
                            ? "border-primary bg-accent/35 text-primary neon-glow neon-text"
                            : "border-transparent text-foreground/85 hover:bg-muted/50 hover:text-foreground"
                        }`}
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

              <aside className="flex min-h-[520px] flex-col gap-4 rounded-md border border-border/70 bg-panel-soft/70 p-3 shadow-soft">
                <section className="rounded-md border border-primary/40 bg-panel/80 p-3 neon-glow">
                  <h3 className="mb-2 text-sm font-semibold text-primary">Request Song</h3>
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!requestTerm.trim()) return;
                      requestMutation.mutate(requestTerm.trim());
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
                    <Badge className="bg-accent text-accent-foreground">{(queue.data ?? []).length} tracks</Badge>
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
                {player.data?.art ? (
                  <img
                    src={player.data.art}
                    alt={`${player.data?.title ?? "Current song"} thumbnail`}
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
            </article>

            <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft">
              <h3 className="mb-2 text-sm font-semibold">Recent History</h3>
              <div className="space-y-2 overflow-y-auto" style={{ maxHeight: 132 }}>
                {(history.data ?? []).slice(0, 3).map((track) => queueRow(track))}
              </div>
            </article>

            <article className="rounded-xl border border-primary/35 bg-panel-soft/70 p-4 shadow-soft neon-edge">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-primary">Saved Playlists</h3>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-primary/55 text-primary hover:bg-accent/35"
                  onClick={() => setSavePresetOpen(true)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Save Current Queue
                </Button>
              </div>

              <div className="space-y-2">
                {(presets.data ?? []).length ? (
                  (presets.data ?? []).map((preset, idx) => (
                    <div key={`${preset.name}-${idx}`} className="flex items-center justify-between rounded-md border border-border/70 bg-panel/80 p-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">{preset.name}</p>
                        <p className="text-[11px] text-muted-foreground">{preset.tracks ?? 0} tracks</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 border-primary/55 text-primary hover:bg-accent/35" onClick={() => loadPreset(preset)}>
                        Load
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="rounded-md border border-border/70 bg-panel/70 px-3 py-2 text-xs text-muted-foreground">No saved playlists yet.</p>
                )}
              </div>
            </article>
          </section>
        </main>
      </div>

      <Dialog open={savePresetOpen} onOpenChange={setSavePresetOpen}>
        <DialogContent className="max-w-sm border-primary/35 bg-panel text-foreground">
          <DialogHeader>
            <DialogTitle className="text-primary">Save queue as preset</DialogTitle>
            <DialogDescription>Name this playlist to save it as a preset.</DialogDescription>
          </DialogHeader>

          <Input
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            placeholder="e.g. Late Night Coding"
            className="bg-panel-soft/70"
            autoFocus
          />

          <DialogFooter>
            <Button variant="outline" className="border-primary/45 text-primary hover:bg-accent/35" onClick={() => setSavePresetOpen(false)}>
              Cancel
            </Button>
            <Button className="neon-glow" onClick={() => saveCurrentQueueAsPreset(presetName)} disabled={!presetName.trim() || savePresetMutation.isPending}>
              Save Playlist
            </Button>
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
                {player.data?.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
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
