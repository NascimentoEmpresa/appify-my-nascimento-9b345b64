import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft, Award, CheckCircle2, ChevronDown, ChevronRight, Circle, ExternalLink, FileText, Loader2, Lock,
  MessageSquare, Paperclip, Send, Star,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { urlMidia } from "@/hooks/useTreinamentosPlataforma";
import { embedDeVideo } from "@/pages/treinamentos/treinamento/core";
import {
  avisarVideoAssistido, fmtData, fmtDataHora, registrarTempoAula, useComentar, useComentariosAula, useConcluirAula,
  useCursoColaborador, type AulaAluno,
} from "@/hooks/useColaboradorPortal";
import { ProvaAula } from "./ProvaAula";
import { Carregando, Chip, Erro, Vazio } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — o curso (player)
//
// Lista de módulos/aulas à esquerda (embaixo, no celular) e a aula aberta em
// cima: vídeo (YouTube/Vimeo por iframe, arquivo do bucket por <video>),
// descrição, materiais, CTA, prova e comentários. Concluir manda
// col_concluir_aula; se a aula tem prova, só conclui depois de passar (a
// RPC cobra — e passar na prova já conclui sozinho). A prova (ProvaAula.tsx,
// 22/09/2026) abre depois do vídeo visto até o fim: o player avisa o banco
// (video_assistido) ao chegar em 90% — <video> pelo timeupdate, YouTube e
// Vimeo pela API de postMessage de cada um. Ao fechar 100% e o curso ter modelo, o certificado sai
// sozinho e o botão aparece.
//
// Tempo assistido: um contador local acumula enquanto a aula está aberta e
// a aba visível, e manda em lotes de ~60 s (registrar_tempo). É estatística
// de engajamento, não prova de presença.
// =====================================================================

export default function CursoColaborador() {
  const { cursoId } = useParams<{ cursoId: string }>();
  const [params, setParams] = useSearchParams();
  const q = useCursoColaborador(cursoId);

  const aulas = useMemo(() => (q.data?.modulos ?? []).flatMap((m) => m.aulas.map((a) => ({ ...a, moduloBloqueado: m.bloqueado, moduloNome: m.nome }))), [q.data]);
  const aulaIdParam = params.get("aula");
  const aulaAtual = useMemo(() => {
    if (!aulas.length) return null;
    const pedida = aulas.find((a) => a.id === aulaIdParam);
    if (pedida) return pedida;
    // Primeira aula não concluída (ou a última, se terminou tudo).
    return aulas.find((a) => !a.concluida && !a.bloqueado && !a.moduloBloqueado) ?? aulas[aulas.length - 1];
  }, [aulas, aulaIdParam]);

  const irPara = (id: string) => setParams({ aula: id }, { replace: true });

  // Fixa a aula escolhida na URL: sem isso, concluir a aula faz a "primeira
  // não concluída" mudar e a tela pularia sozinha para a próxima.
  useEffect(() => {
    if (aulaAtual && aulaAtual.id !== aulaIdParam) setParams({ aula: aulaAtual.id }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aulaAtual?.id, aulaIdParam]);
  const indice = aulaAtual ? aulas.findIndex((a) => a.id === aulaAtual.id) : -1;
  const proxima = indice >= 0 ? aulas[indice + 1] : undefined;
  const anterior = indice > 0 ? aulas[indice - 1] : undefined;

  if (q.isLoading) return <Carregando texto="Abrindo o curso…" />;
  if (q.isError || !q.data) {
    return (
      <div className="space-y-3">
        <Link to="/colaborador/treinamentos" className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="h-4 w-4" /> Meus treinamentos</Link>
        <Erro erro={q.error} />
      </div>
    );
  }
  const { curso, modulos, pct, concluidas, certificado } = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/colaborador/treinamentos" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border hover:bg-muted" aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-bold leading-tight">{curso.nome}</h1>
          <p className="text-xs text-muted-foreground">{concluidas} de {q.data.aulas} aulas · {pct}%</p>
        </div>
        {certificado && (
          <Link to={`/colaborador/treinamentos/${curso.id}/certificado`} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-xs font-semibold text-white">
            <Award className="h-4 w-4" /> Certificado
          </Link>
        )}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", pct >= 100 ? "bg-success" : "bg-accent")} style={{ width: `${pct}%` }} />
      </div>

      {pct >= 100 && !certificado && curso.emite_certificado && (
        <p className="rounded-xl bg-success/10 px-3 py-2 text-sm text-success">Curso concluído! Seu certificado está sendo emitido.</p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {aulaAtual ? (
            <AulaAberta
              key={aulaAtual.id}
              aula={aulaAtual}
              cursoId={curso.id}
              comentariosHabilitados={curso.comentarios_habilitados}
              anterior={anterior ? () => irPara(anterior.id) : undefined}
              proxima={proxima ? () => irPara(proxima.id) : undefined}
            />
          ) : (
            <Vazio>Este curso ainda não tem aulas publicadas.</Vazio>
          )}
        </div>

        <aside className="space-y-2">
          {modulos.map((m, mi) => (
            <details key={m.id} open={!!aulaAtual && m.aulas.some((a) => a.id === aulaAtual.id)} className="group rounded-2xl border border-border bg-card shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">Módulo {mi + 1} · {m.nome}</span>
                {m.bloqueado ? <Lock className="h-3.5 w-3.5 text-muted-foreground" /> : (
                  <span className="text-[11px] text-muted-foreground">{m.aulas.filter((a) => a.concluida).length}/{m.aulas.length}</span>
                )}
              </summary>
              {m.bloqueado && m.libera_em && <p className="px-3 pb-2 text-xs text-muted-foreground">Libera em {fmtData(m.libera_em)}</p>}
              <ul className="border-t border-border">
                {m.aulas.map((a, ai) => {
                  const ativa = aulaAtual?.id === a.id;
                  const travada = m.bloqueado || a.bloqueado;
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        disabled={travada}
                        onClick={() => irPara(a.id)}
                        className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                          ativa ? "bg-primary/10 text-primary" : "hover:bg-muted/60")}
                      >
                        {a.concluida ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : travada ? <Lock className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />}
                        <span className="min-w-0 flex-1 truncate">{ai + 1}. {a.nome}</span>
                        {a.carga_horaria_min ? <span className="text-[11px] text-muted-foreground">{a.carga_horaria_min} min</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </aside>
      </div>
    </div>
  );
}

// ── A aula aberta ────────────────────────────────────────────────────────

function AulaAberta({ aula, cursoId, comentariosHabilitados, anterior, proxima }: {
  aula: AulaAluno & { moduloBloqueado: boolean; moduloNome: string };
  cursoId: string; comentariosHabilitados: boolean; anterior?: () => void; proxima?: () => void;
}) {
  const concluir = useConcluirAula(cursoId);
  const qc = useQueryClient();
  // Vídeo chegou ao fim: grava e recarrega a prova (que pode ter liberado).
  const videoTerminou = async () => {
    await avisarVideoAssistido(aula.id);
    qc.invalidateQueries({ queryKey: ["colaborador", "prova", aula.id] });
  };
  const [avaliacao, setAvaliacao] = useState<number | null>(aula.avaliacao);
  const travada = aula.bloqueado || aula.moduloBloqueado;
  const temQuiz = !!aula.quiz?.length;
  const passouQuiz = temQuiz && aula.nota_quiz != null && aula.nota_quiz >= aula.nota_minima;

  // Tempo assistido: conta só com a aba visível, manda a cada 60 s e no unmount.
  const acumulado = useRef(0);
  useEffect(() => {
    if (travada) return;
    let ultimo = Date.now();
    const tick = () => {
      const agora = Date.now();
      if (document.visibilityState === "visible") acumulado.current += (agora - ultimo) / 1000;
      ultimo = agora;
      if (acumulado.current >= 60) { registrarTempoAula(aula.id, acumulado.current); acumulado.current = 0; }
    };
    const t = setInterval(tick, 5000);
    return () => {
      clearInterval(t);
      if (acumulado.current >= 5) registrarTempoAula(aula.id, acumulado.current);
      acumulado.current = 0;
    };
  }, [aula.id, travada]);

  const marcarConcluida = async () => {
    try {
      const r = await concluir.mutateAsync({ aula_id: aula.id, tempo_seg: Math.round(acumulado.current), avaliacao });
      acumulado.current = 0;
      toast.success(r.certificado ? "Aula concluída — e o curso também! Seu certificado foi emitido." : "Aula concluída.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    }
  };

  if (travada) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 font-semibold">{aula.nome}</p>
        <p className="text-sm text-muted-foreground">Esta aula ainda não foi liberada{aula.libera_em ? ` — libera em ${fmtData(aula.libera_em)}` : ""}.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Player aula={aula} onFim={videoTerminou} />

      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{aula.moduloNome}</p>
        <h2 className="mt-0.5 font-display text-xl font-bold leading-tight md:text-2xl">{aula.nome}</h2>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {aula.concluida && <Chip tom="ok">Concluída em {fmtData(aula.concluida_em)}</Chip>}
          {temQuiz && aula.nota_quiz != null && <Chip tom={passouQuiz ? "ok" : "alerta"}>Prova: {aula.nota_quiz}%</Chip>}
        </div>
        {/* Descrição (24/09/2026): parágrafos separados, texto maior e com
            largura de leitura — antes era um bloco só, apertado ao lado do vídeo. */}
        {aula.descricao && (
          <div className="mt-4 max-w-prose space-y-3 border-t border-border pt-4 text-[15px] leading-7 text-foreground/90">
            {aula.descricao.split(/\n\s*\n/).map((par, i) => <p key={i} className="whitespace-pre-line">{par.trim()}</p>)}
          </div>
        )}

        {aula.materiais.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materiais</p>
            <ul className="space-y-1">
              {aula.materiais.map((m, i) => {
                const href = m.url || urlMidia(m.path) || "#";
                return (
                  <li key={i}>
                    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted">
                      <Paperclip className="h-4 w-4 text-muted-foreground" /> {m.nome} <ExternalLink className="h-3 w-3 text-muted-foreground" />
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {aula.cta_texto && aula.cta_url && (
          <a href={aula.cta_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
            {aula.cta_texto} <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>

      {temQuiz && <ProvaAula key={aula.id} aula={aula} cursoId={cursoId} />}

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Avalie a aula</p>
            <div className="mt-1 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setAvaliacao(n)} aria-label={`${n} estrela(s)`}>
                  <Star className={cn("h-6 w-6", (avaliacao ?? 0) >= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                </button>
              ))}
            </div>
          </div>
          {!aula.concluida ? (
            <button
              type="button"
              disabled={concluir.isPending || (temQuiz && !passouQuiz)}
              onClick={marcarConcluida}
              title={temQuiz && !passouQuiz ? `Passe na prova (mínimo ${aula.nota_minima}%) para concluir` : undefined}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-gradient-accent px-5 text-sm font-semibold text-accent-foreground disabled:opacity-60"
            >
              {concluir.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Marcar como concluída
            </button>
          ) : (
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-success"><CheckCircle2 className="h-4 w-4" /> Aula concluída</p>
          )}
        </div>
        {temQuiz && !passouQuiz && !aula.concluida && (
          <p className="mt-2 text-xs text-muted-foreground">Esta aula tem prova: alcance {aula.nota_minima}% para concluí-la.</p>
        )}
        <div className="mt-3 flex justify-between border-t border-border pt-3">
          <button type="button" disabled={!anterior} onClick={anterior} className="inline-flex items-center gap-1 text-sm font-semibold text-primary disabled:opacity-40"><ArrowLeft className="h-4 w-4" /> Anterior</button>
          <button type="button" disabled={!proxima} onClick={proxima} className="inline-flex items-center gap-1 text-sm font-semibold text-primary disabled:opacity-40">Próxima aula <ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {comentariosHabilitados && <Comentarios aulaId={aula.id} />}
    </div>
  );
}

function Player({ aula, onFim }: { aula: AulaAluno; onFim?: () => void }) {
  const thumb = urlMidia(aula.thumb_path);
  const avisou = useRef(false);
  const iframe = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => { avisou.current = false; }, [aula.id]);
  const fim = () => { if (!avisou.current) { avisou.current = true; onFim?.(); } };
  const noTempo = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (v.duration > 0 && v.currentTime / v.duration >= 0.9) fim();
  };
  const emb = aula.video_url ? embedDeVideo(aula.video_url) : null;

  // YouTube/Vimeo: escuta os eventos do player embutido (postMessage).
  useEffect(() => {
    if (!emb || (emb.tipo !== "youtube" && emb.tipo !== "vimeo")) return;
    const ouvir = (ev: MessageEvent) => {
      if (!/^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|vimeo\.com)$/.test(ev.origin)) return;
      let d: any = ev.data;
      if (typeof d === "string") { try { d = JSON.parse(d); } catch { return; } }
      if (!d || typeof d !== "object") return;
      // YouTube: estado 0 = terminou; infoDelivery traz o tempo.
      if (d.event === "onStateChange" && d.info === 0) fim();
      if (d.event === "infoDelivery" && d.info) {
        if (d.info.playerState === 0) fim();
        if (d.info.duration > 0 && d.info.currentTime / d.info.duration >= 0.9) fim();
      }
      // Vimeo: pronto → assina os eventos; timeupdate traz o percentual.
      if (d.event === "ready") {
        for (const value of ["timeupdate", "ended"]) iframe.current?.contentWindow?.postMessage(JSON.stringify({ method: "addEventListener", value }), "*");
      }
      if (d.event === "ended" || (d.event === "timeupdate" && d.data?.percent >= 0.9)) fim();
    };
    window.addEventListener("message", ouvir);
    return () => window.removeEventListener("message", ouvir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aula.id, emb?.src]);
  const aoCarregarIframe = () => {
    // YouTube só manda eventos depois de alguém dizer que está ouvindo.
    if (emb?.tipo === "youtube") iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: aula.id, channel: "widget" }), "*");
  };

  if (aula.video_path) {
    const src = urlMidia(aula.video_path);
    return (
      <div className="overflow-hidden rounded-2xl bg-black">
        <video src={src ?? undefined} poster={thumb ?? undefined} controls playsInline className="aspect-video w-full" onTimeUpdate={noTempo} onEnded={fim} />
      </div>
    );
  }
  if (aula.video_url && emb) {
    if (emb.tipo === "youtube" || emb.tipo === "vimeo") {
      const src = emb.tipo === "youtube"
        ? `${emb.src}?enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`
        : `${emb.src}?api=1`;
      return (
        <div className="overflow-hidden rounded-2xl bg-black">
          <iframe ref={iframe} onLoad={aoCarregarIframe} src={src} title={aula.nome} allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen className="aspect-video w-full" />
        </div>
      );
    }
    if (emb.tipo === "arquivo") {
      return (
        <div className="overflow-hidden rounded-2xl bg-black">
          <video src={emb.src} poster={thumb ?? undefined} controls playsInline className="aspect-video w-full" onTimeUpdate={noTempo} onEnded={fim} />
        </div>
      );
    }
    if (aula.tipo_conteudo === "embed") {
      return (
        <div className="overflow-hidden rounded-2xl bg-black">
          <iframe src={aula.video_url} title={aula.nome} allowFullScreen className="aspect-video w-full" />
        </div>
      );
    }
    return (
      <a href={aula.video_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm hover:bg-muted/40">
        <ExternalLink className="h-5 w-5 text-primary" />
        <div>
          <p className="text-sm font-semibold">{aula.tipo_conteudo === "ao_vivo" ? "Entrar na aula ao vivo" : "Abrir conteúdo"}</p>
          <p className="truncate text-xs text-muted-foreground">{aula.video_url}</p>
        </div>
      </a>
    );
  }
  if (thumb) return <img src={thumb} alt="" className="aspect-video w-full rounded-2xl object-cover" />;
  return (
    <div className="grid aspect-[3/1] place-items-center rounded-2xl bg-muted text-muted-foreground">
      <FileText className="h-8 w-8" />
    </div>
  );
}

// ── Comentários ──────────────────────────────────────────────────────────

function Comentarios({ aulaId }: { aulaId: string }) {
  const q = useComentariosAula(aulaId);
  const comentar = useComentar();
  const [texto, setTexto] = useState("");

  const enviar = async () => {
    if (texto.trim().length < 2) return;
    try {
      await comentar.mutateAsync({ aula_id: aulaId, texto: texto.trim() });
      setTexto("");
      toast.success("Comentário enviado. Ele aparece para os outros depois de aprovado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível comentar.");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="flex items-center gap-2 font-display text-base font-bold"><MessageSquare className="h-4 w-4 text-primary" /> Comentários</h3>
      <div className="mt-3 flex gap-2">
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Deixe uma dúvida ou comentário sobre a aula…"
          className="min-h-[44px] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <button type="button" disabled={comentar.isPending || texto.trim().length < 2} onClick={enviar} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50" aria-label="Enviar">
          {comentar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      {q.isLoading && <p className="mt-3 text-xs text-muted-foreground">Carregando…</p>}
      {q.data && q.data.length === 0 && <p className="mt-3 text-xs text-muted-foreground">Seja o primeiro a comentar.</p>}
      <ul className="mt-3 space-y-3">
        {(q.data ?? []).map((c) => (
          <li key={c.id} className="rounded-xl bg-muted/50 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">{c.meu ? "Você" : c.autor}</p>
              <span className="text-[11px] text-muted-foreground">{fmtDataHora(c.criado_em)}</span>
            </div>
            <p className="mt-1 whitespace-pre-line text-sm">{c.texto}</p>
            {c.meu && c.status === "pendente" && <Chip tom="alerta">Aguardando aprovação</Chip>}
            {c.meu && c.status === "rejeitado" && <Chip tom="erro">Não aprovado</Chip>}
            {c.resposta && (
              <div className="mt-2 rounded-lg border-l-2 border-primary bg-card px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Resposta do instrutor</p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{c.resposta}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
