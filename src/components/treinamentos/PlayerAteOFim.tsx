import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { CheckCircle2, FastForward, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  estadoInicial, percentualAssistido, registrarFim, registrarPosicao, relogio, type EstadoVideo,
} from "@/lib/treinamentos/videoAteOFim";

// =====================================================================
// PLAYER "ATÉ O FIM" (02/10/2026, mig 20260930000290)
//
// O vídeo das aulas e dos treinamentos só conta como visto quando termina —
// e não dá para adiantar: arrastar a barra para além do ponto mais distante
// já assistido volta para lá. Funciona com os três tipos que o sistema toca:
//   • arquivo (<video>, bucket ou link .mp4) — timeupdate / ended;
//   • YouTube — API de postMessage (infoDelivery traz tempo e duração;
//     "seekTo" volta);
//   • Vimeo — API de postMessage (timeupdate / ended; "setCurrentTime").
// A regra (o que conta, quando volta, quando termina) mora em
// src/lib/treinamentos/videoAteOFim.ts, com teste. `jaAssistido` (o banco já
// tem o vídeo como visto) solta o player: rever é livre.
// =====================================================================

export type FonteVideo = { tipo: "arquivo" | "youtube" | "vimeo"; src: string };

export function PlayerAteOFim({ fonte, titulo, poster, jaAssistido = false, onTerminou }: {
  fonte: FonteVideo;
  titulo: string;
  poster?: string | null;
  jaAssistido?: boolean;
  onTerminou?: () => void;
}) {
  const [estado, setEstado] = useState<EstadoVideo>(estadoInicial);
  const est = useRef(estado);
  const [aviso, setAviso] = useState(false);
  const avisoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const avisouFim = useRef(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const livre = jaAssistido;

  // Trocou de vídeo: começa do zero.
  useEffect(() => {
    est.current = estadoInicial(); setEstado(est.current); avisouFim.current = false; setAviso(false);
  }, [fonte.src]);

  const mostrarAviso = () => {
    setAviso(true);
    if (avisoTimer.current) clearTimeout(avisoTimer.current);
    avisoTimer.current = setTimeout(() => setAviso(false), 3500);
  };
  useEffect(() => () => { if (avisoTimer.current) clearTimeout(avisoTimer.current); }, []);

  const aplicar = useCallback((novo: EstadoVideo) => {
    est.current = novo;
    setEstado(novo);
    if (novo.terminou && !avisouFim.current) { avisouFim.current = true; onTerminou?.(); }
  }, [onTerminou]);

  const voltarYoutube = (t: number) => iframe.current?.contentWindow?.postMessage(
    JSON.stringify({ event: "command", func: "seekTo", args: [t, true], id: "player-ate-o-fim", channel: "widget" }), "*");
  const voltarVimeo = (t: number) => iframe.current?.contentWindow?.postMessage(JSON.stringify({ method: "setCurrentTime", value: t }), "*");

  /** Uma leitura de posição, venha de onde vier. */
  const posicao = useCallback((t: number, dur: number, voltar: (t: number) => void) => {
    const r = registrarPosicao(est.current, t, dur);
    if (r.voltarPara != null && !livre) {
      voltar(r.voltarPara);
      mostrarAviso();
      // A posição "volta" já fica registrada: a próxima leitura parte dela.
      aplicar({ ...r.estado, ultimo: r.voltarPara });
      return;
    }
    aplicar(r.estado);
  }, [aplicar, livre]);

  // ── <video> ─────────────────────────────────────────────────────────
  const noTempo = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    posicao(v.currentTime, v.duration, (t) => { v.currentTime = t; });
  };
  const noFim = () => aplicar(registrarFim(est.current));

  // ── YouTube / Vimeo ─────────────────────────────────────────────────
  const duracaoEmbed = useRef(0);
  useEffect(() => {
    if (fonte.tipo === "arquivo") return;
    duracaoEmbed.current = 0;
    const ouvir = (ev: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|vimeo\.com)$/.test(ev.origin)) return;
      if (ev.source && iframe.current && ev.source !== iframe.current.contentWindow) return;
      let d: any = ev.data; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (typeof d === "string") { try { d = JSON.parse(d); } catch { return; } }
      if (!d || typeof d !== "object") return;
      if (fonte.tipo === "youtube") {
        if (d.event === "infoDelivery" && d.info) {
          if (d.info.duration > 0) duracaoEmbed.current = d.info.duration;
          if (typeof d.info.currentTime === "number") posicao(d.info.currentTime, duracaoEmbed.current, voltarYoutube);
          if (d.info.playerState === 0) aplicar(registrarFim(est.current));
        }
        if (d.event === "onStateChange" && d.info === 0) aplicar(registrarFim(est.current));
      } else {
        if (d.event === "ready") {
          for (const value of ["timeupdate", "ended"]) iframe.current?.contentWindow?.postMessage(JSON.stringify({ method: "addEventListener", value }), "*");
        }
        if (d.event === "timeupdate" && d.data) posicao(Number(d.data.seconds), Number(d.data.duration), voltarVimeo);
        if (d.event === "ended") aplicar(registrarFim(est.current));
      }
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fonte.tipo, fonte.src, posicao]);

  const aoCarregarIframe = () => {
    // O YouTube só manda eventos depois de alguém dizer que está ouvindo.
    if (fonte.tipo === "youtube") iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "player-ate-o-fim", channel: "widget" }), "*");
  };

  const pct = livre ? 100 : percentualAssistido(estado);
  const faltam = estado.duracao > 0 ? Math.max(0, estado.duracao - estado.maximo) : null;
  const src = fonte.tipo === "youtube"
    ? `${fonte.src}?enablejsapi=1&rel=0&origin=${encodeURIComponent(window.location.origin)}`
    : fonte.tipo === "vimeo" ? `${fonte.src}?api=1` : fonte.src;

  return (
    <div className="overflow-hidden rounded-2xl bg-black shadow-sm">
      <div className="relative">
        {fonte.tipo === "arquivo" ? (
          <video ref={video} src={src} poster={poster ?? undefined} controls playsInline controlsList="nodownload"
                 className="aspect-video w-full" onTimeUpdate={noTempo} onEnded={noFim} />
        ) : (
          <iframe ref={iframe} onLoad={aoCarregarIframe} src={src} title={titulo}
                  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen
                  className="aspect-video w-full" />
        )}
        {aviso && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1.5 text-xs font-semibold text-white shadow-lg animate-in fade-in">
              <FastForward className="h-3.5 w-3.5" /> Não dá para adiantar — assista até o fim para concluir.
            </span>
          </div>
        )}
      </div>

      {/* Barra "assistido": o que falta para liberar a conclusão. */}
      <div className="flex items-center gap-3 bg-card px-4 py-2.5">
        {livre || estado.terminou ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
            <CheckCircle2 className="h-4 w-4" /> Vídeo assistido até o fim
          </span>
        ) : (
          <>
            <PlayCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full bg-primary transition-[width] duration-500")} style={{ width: `${pct}%` }} />
            </div>
            <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
              {pct}% assistido{faltam != null && faltam > 1 ? ` · faltam ${relogio(faltam)}` : ""}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
