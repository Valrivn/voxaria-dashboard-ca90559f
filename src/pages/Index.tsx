import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Disc3,
  History,
  ListMusic,
  Loader2,
  LogOut,
  Pause,
  Play,
  Search,
  Server,
  Settings2,
  SkipBack,
  SkipForward,
  Square,
  Trash2,
  UserCircle2,
  Volume2,
  Youtube,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { mockData, voxariaApi, type ApiLyrics, type ApiTrack } from "@/lib/voxaria-api";

type NavItem = { label: string; icon: typeof Disc3 };

const navItems: NavItem[] = [
  { label: "Dashboard", icon: Disc3 },
  { label: "Queue", icon: ListMusic },
  { label: "Settings", icon: Settings2 },
  { label: "Server Selector", icon: Server },
];

const formatSec = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = `${Math.floor(s % 60)}`.padStart(2, "0");
  return `${m}:${sec}`;
};

const trackTile = (track: ApiTrack, dimmed = false) => (
  <article
    key={track.id}
    className="group w-[196px] shrink-0 rounded-md border border-border/70 bg-panel-soft/70 p-2 transition hover:border-primary/45 hover:bg-muted/70"
  >
    <div className="relative mb-2 overflow-hidden rounded-sm border border-border/70 bg-panel">
      {track.art ? (
        <img src={track.art} alt={`${track.title} cover`} loading="lazy" className="h-28 w-full object-cover" />
      ) : (
        <div className="flex h-28 w-full items-center justify-center">
          <Disc3 className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <span className="absolute right-1.5 top-1.5 rounded-sm bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {track.duration}
      </span>
    </div>

    <div className="min-w-0 space-y-1">
      <p className={`truncate text-sm font-medium ${dimmed ? "text-muted-foreground" : "text-foreground"}`}>{track.title}</p>
      <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        {track.requesterAvatar ? (
          <img src={track.requesterAvatar} alt={`${track.requestedBy} avatar`} loading="lazy" className="h-5 w-5 rounded-full border border-border object-cover" />
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-panel">
            <UserCircle2 className="h-3 w-3 text-muted-foreground" />
          </div>
        )}
        <span className="truncate">{track.requestedBy}</span>
      </div>
    </div>
  </article>
);

const Index = () => {
  const queryClient = useQueryClient();
  const queueLaneRef = useRef<HTMLDivElement>(null);
  const historyLaneRef = useRef<HTMLDivElement>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [lyricsData, setLyricsData] = useState<ApiLyrics | null>(null);

  const queue = useQuery({ queryKey: ["queue"], queryFn: async () => voxariaApi.getQueue().catch(() => mockData.queue), refetchInterval: 10000 });
  const history = useQuery({ queryKey: ["history"], queryFn: async () => voxariaApi.getHistory().catch(() => mockData.history), refetchInterval: 14000 });
  const status = useQuery({ queryKey: ["status"], queryFn: async () => voxariaApi.getStatus().catch(() => mockData.status), refetchInterval: 10000 });
  const cache = useQuery({ queryKey: ["cache"], queryFn: async () => voxariaApi.getCache().catch(() => mockData.cache), refetchInterval: 15000 });
  const settings = useQuery({ queryKey: ["settings"], queryFn: async () => voxariaApi.getSettings().catch(() => mockData.settings) });
  const player = useQuery({ queryKey: ["player"], queryFn: async () => voxariaApi.getPlayer().catch(() => mockData.player), refetchInterval: 5000 });

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

  const playbackMutation = useMutation({
    mutationFn: voxariaApi.playback,
    onSuccess: refreshAll,
    onError: () => toast({ title: "Control failed", description: "Playback action could not be completed.", variant: "destructive" }),
  });

  const clearQueueMutation = useMutation({
    mutationFn: voxariaApi.clearQueue,
    onSuccess: () => {
      toast({ title: "Queue cleared" });
      refreshAll();
    },
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

  const lyricsMutation = useMutation({
    mutationFn: async () => voxariaApi.getLyrics(player.data?.title ?? "", player.data?.artist ?? ""),
    onSuccess: (data) => {
      setLyricsData(data);
      toast({ title: "Lyrics loaded", description: "Connected to lyrics endpoint." });
    },
    onError: () => {
      setLyricsData(mockData.lyrics);
      toast({ title: "Lyrics fallback", description: "Using adapter sample lyrics until API is ready." });
    },
  });

  const cacheProgress = useMemo(() => {
    if (!cache.data) return 0;
    return Math.min(100, Math.round((cache.data.sizeMb / cache.data.maxMb) * 100));
  }, [cache.data]);

  const playerProgress = useMemo(() => {
    if (!player.data || !player.data.durationSec) return 0;
    return Math.min(100, Math.round((player.data.positionSec / player.data.durationSec) * 100));
  }, [player.data]);

  const loading = queue.isLoading || history.isLoading || status.isLoading || cache.isLoading || settings.isLoading || player.isLoading;

  const scrollLane = (ref: React.RefObject<HTMLDivElement>, direction: "left" | "right") => {
    if (!ref.current) return;
    ref.current.scrollBy({ left: direction === "left" ? -460 : 460, behavior: "smooth" });
  };

  const onLaneWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    e.currentTarget.scrollLeft += e.deltaY;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative min-h-screen">
        <aside className="fixed left-0 top-0 z-20 flex h-screen w-[260px] flex-col border-r border-border/70 bg-panel/90 p-4 backdrop-blur-xl">
          <div className="mb-8 rounded-md border border-primary/35 bg-panel-soft/85 p-3 shadow-soft">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Discord Music Bot</p>
            <h1 className="text-xl font-semibold">Voxaria</h1>
          </div>

          <nav className="space-y-2">
            {navItems.map(({ label, icon: Icon }, idx) => (
              <button
                key={label}
                className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                  idx === 0
                    ? "border-primary/55 bg-accent/60 text-accent-foreground shadow-soft"
                    : "border-border/70 bg-panel-soft/65 text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </nav>

          <div className="mt-auto rounded-md border border-border/70 bg-panel-soft/75 p-3 text-xs text-muted-foreground">
            API Mode: <span className="text-foreground">Temporary Adapter</span>
          </div>
        </aside>

        <main className="ml-[260px] flex min-h-screen min-w-[1080px] w-[calc(100vw-260px)] flex-col pb-36">
          <header className="sticky top-0 z-10 border-b border-border/70 bg-background/85 p-4 backdrop-blur-xl">
            <div className="flex items-center gap-3 rounded-md border border-border/70 bg-panel-soft/70 p-2 shadow-soft">
              <Search className="ml-1 h-4 w-4 text-muted-foreground" />
              <div className="flex items-center gap-2 text-muted-foreground">
                <Youtube className="h-4 w-4" />
                <Disc3 className="h-4 w-4" />
                <span className="text-[11px]">Spotify</span>
              </div>
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search YouTube, Spotify, or paste a link..."
                className="h-10 border-none bg-transparent focus-visible:ring-0"
              />
              <Button
                className="h-10 rounded-md"
                disabled={searchMutation.isPending || !searchTerm.trim()}
                onClick={() => searchMutation.mutate(searchTerm.trim())}
              >
                {searchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </Button>
            </div>
          </header>

          <section className="space-y-4 p-4">
            <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <ListMusic className="h-5 w-5 text-primary" /> Up Next
                </h2>
                <div className="flex items-center gap-2">
                  <Badge className="bg-accent text-accent-foreground">Queue</Badge>
                  <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => scrollLane(queueLaneRef, "left")}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => scrollLane(queueLaneRef, "right")}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div
                ref={queueLaneRef}
                onWheel={onLaneWheel}
                className="flex gap-3 overflow-x-auto pb-2 [scrollbar-color:hsl(var(--primary))_transparent]"
              >
                {loading ? <p className="text-sm text-muted-foreground">Loading queue...</p> : (queue.data ?? []).map((t) => trackTile(t))}
              </div>
            </article>

            <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft backdrop-blur-xl">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <History className="h-5 w-5 text-primary" /> Session History
                </h2>
                <div className="flex items-center gap-2">
                  <Badge className="bg-muted text-muted-foreground">Recent</Badge>
                  <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => scrollLane(historyLaneRef, "left")}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => scrollLane(historyLaneRef, "right")}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div
                ref={historyLaneRef}
                onWheel={onLaneWheel}
                className="flex gap-3 overflow-x-auto pb-2 [scrollbar-color:hsl(var(--primary))_transparent]"
              >
                {loading ? <p className="text-sm text-muted-foreground">Loading history...</p> : (history.data ?? []).map((t) => trackTile(t, true))}
              </div>
            </article>

            <div className="grid grid-cols-4 gap-4">
              <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft backdrop-blur-xl">
                <h3 className="mb-3 text-base font-semibold">Server & Shard Status</h3>
                <div className="space-y-2 text-sm">
                  <p>
                    Active Shard: <span className="font-medium text-foreground">#{status.data?.activeShard ?? 0}</span>
                  </p>
                  <p>
                    Ping: <span className="font-medium text-foreground">{status.data?.pingMs ?? 42}ms</span>
                  </p>
                  <p>
                    Uptime: <span className="font-medium text-foreground">{status.data?.uptime ?? "24h 12m"}</span>
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3 w-full border-success/40 bg-success/10 text-success hover:bg-success/20"
                    onDoubleClick={() => playbackMutation.mutate("play_pause")}
                  >
                    <span className="relative mr-2 inline-flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
                    </span>
                    Double-click green to toggle song
                  </Button>
                </div>
              </article>

              <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft backdrop-blur-xl">
                <h3 className="mb-3 text-base font-semibold">Audio Cache Status</h3>
                <p className="mb-2 text-sm text-muted-foreground">Cache Size: {cache.data?.sizeMb ?? 142} MB</p>
                <Progress value={cacheProgress} className="h-2" />
                <p className="mt-2 text-xs text-muted-foreground">{cacheProgress}% of allocated capacity</p>
                <Button
                  variant="outline"
                  className="mt-4 w-full border-warning/60 bg-warning/15 text-warning hover:bg-warning/25"
                  onClick={() => cleanCacheMutation.mutate()}
                  disabled={cleanCacheMutation.isPending}
                >
                  {cleanCacheMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Clean Audio Cache
                </Button>
              </article>

              <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft backdrop-blur-xl">
                <h3 className="mb-3 text-base font-semibold">System Settings</h3>
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

              <article className="rounded-md border border-border/70 bg-panel-soft/70 p-4 shadow-soft backdrop-blur-xl">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold">Lyrics</h3>
                  <Button size="sm" variant="secondary" onClick={() => lyricsMutation.mutate()} disabled={lyricsMutation.isPending}>
                    {lyricsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Pull Lyrics"}
                  </Button>
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
                  {lyricsData?.source ? `Source: ${lyricsData.source}` : "Ready for Discord API lyrics endpoint"}
                </p>
                <div className="max-h-[130px] space-y-1 overflow-y-auto rounded-md border border-border/70 bg-panel p-2 text-xs text-muted-foreground">
                  {(lyricsData?.lines ?? ["Click Pull Lyrics to request lines for the current track."]).map((line, i) => (
                    <p key={`${line}-${i}`}>{line}</p>
                  ))}
                </div>
              </article>
            </div>
          </section>
        </main>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 z-30 border-t border-border/70 bg-panel/90 px-4 py-3 backdrop-blur-xl">
        <div className="grid grid-cols-[1.2fr_1.6fr_1fr] items-center gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {player.data?.art ? (
              <img src={player.data.art} alt="Now playing cover" className="h-14 w-14 rounded object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded border border-border bg-panel">
                <Disc3 className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{player.data?.title ?? "Night Circuit"}</p>
              <p className="truncate text-xs text-muted-foreground">{player.data?.artist ?? "Mira Kade"}</p>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-center gap-2">
              <Button size="icon" variant="secondary" className="opacity-80" onClick={() => playbackMutation.mutate("previous")}>
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button size="icon" className="h-12 w-12 rounded-full shadow-soft" onClick={() => playbackMutation.mutate("play_pause")}>
                {player.data?.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </Button>
              <Button size="icon" variant="secondary" className="opacity-80" onClick={() => playbackMutation.mutate("next")}>
                <SkipForward className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="secondary" className="opacity-70" onClick={() => playbackMutation.mutate("stop")}>
                <Square className="h-4 w-4" />
              </Button>
            </div>
            <Progress value={playerProgress} className="h-1.5" />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{formatSec(player.data?.positionSec ?? 65)}</span>
              <span>{formatSec(player.data?.durationSec ?? 252)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <div className="flex w-44 items-center gap-2">
              <Volume2 className="h-4 w-4 text-muted-foreground" />
              <Slider value={[player.data?.volume ?? 68]} max={100} step={1} onValueCommit={([v]) => volumeMutation.mutate(v)} />
            </div>
            <Separator orientation="vertical" className="h-7" />
            <Button variant="outline" onClick={() => clearQueueMutation.mutate()}>
              Clear Queue
            </Button>
            <Button variant="destructive" size="icon" onClick={() => leaveMutation.mutate()}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
