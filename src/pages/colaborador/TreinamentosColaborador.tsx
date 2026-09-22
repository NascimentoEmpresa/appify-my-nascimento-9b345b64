import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Award, Bell, CalendarDays, GraduationCap, Lock, Megaphone, PlayCircle } from "lucide-react";
import { urlMidia } from "@/hooks/useTreinamentosPlataforma";
import { fmtData, fmtDataHora, useCursosColaborador, useMarcarNotificacoesLidas, type CursoAluno } from "@/hooks/useColaboradorPortal";
import { Carregando, Chip, Erro, Secao, Vazio } from "./ui";
import { cn } from "@/lib/utils";

// =====================================================================
// PORTAL DO COLABORADOR — Treinamentos (a "área do aluno" da plataforma)
//
// Lê TRN_* pela RPC col_cursos: o aluno é achado pelo empregado_id, CPF ou
// e-mail do colaborador. Vitrine com progresso, avisos, notificações e
// agenda — o que o membox mostra na home do aluno.
// =====================================================================

type Aba = "cursos" | "avisos" | "agenda";

export default function TreinamentosColaborador() {
  const q = useCursosColaborador();
  const [aba, setAba] = useState<Aba>("cursos");
  const lidas = useMarcarNotificacoesLidas();
  const naoLidas = q.data?.notificacoes.filter((n) => !n.lida).length ?? 0;

  // Abriu a aba de avisos → marca as notificações como lidas.
  useEffect(() => {
    if (aba === "avisos" && naoLidas > 0 && !lidas.isPending) lidas.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba]);

  if (q.isLoading) return <Carregando texto="Buscando seus cursos…" />;
  if (q.isError || !q.data) return <Erro erro={q.error} acao={<button className="text-sm font-semibold underline" onClick={() => q.refetch()}>Tentar de novo</button>} />;
  const { aluno, cursos, avisos, notificacoes, eventos } = q.data;

  if (!aluno) {
    return (
      <div className="space-y-4">
        <Cabecalho />
        <Vazio>
          Você ainda não tem cadastro na plataforma de treinamentos.<br />
          Quando o RH te matricular, os cursos aparecem aqui.
        </Vazio>
      </div>
    );
  }

  const concluidos = cursos.filter((c) => c.pct >= 100).length;

  return (
    <div className="space-y-4">
      <Cabecalho sub={`${cursos.length} curso(s) · ${concluidos} concluído(s)`} />

      {aluno.status === "bloqueado" && <Erro erro={new Error("Seu acesso aos treinamentos está bloqueado. Procure o RH.")} />}
      {aluno.expirado && <Erro erro={new Error(`Seu acesso aos treinamentos expirou em ${fmtData(aluno.expira_em)}. Procure o RH.`)} />}

      <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {([["cursos", "Cursos"], ["avisos", "Avisos"], ["agenda", "Agenda"]] as [Aba, string][]).map(([k, r]) => (
          <button
            key={k}
            onClick={() => setAba(k)}
            className={cn("relative h-9 rounded-lg text-sm font-semibold transition-colors", aba === k ? "bg-card shadow-sm" : "text-muted-foreground")}
          >
            {r}
            {k === "avisos" && naoLidas > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">{naoLidas}</span>}
          </button>
        ))}
      </div>

      {aba === "cursos" && (
        cursos.length === 0 ? <Vazio>Nenhum curso liberado para você ainda.</Vazio> : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {cursos.map((c) => <CartaoCurso key={c.id} curso={c} />)}
          </ul>
        )
      )}

      {aba === "avisos" && (
        <div className="space-y-4">
          <Secao titulo="Avisos" descricao="Comunicados da plataforma">
            {avisos.length === 0 ? <Vazio>Sem avisos no momento.</Vazio> : (
              <ul className="space-y-3">
                {avisos.map((a) => (
                  <li key={a.id} className="overflow-hidden rounded-xl border border-border">
                    {a.tipo === "imagem" && a.imagem_path && <img src={urlMidia(a.imagem_path) ?? undefined} alt="" className="w-full object-cover" />}
                    <div className="p-3">
                      <div className="flex items-start gap-2">
                        <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">{a.titulo}</p>
                          {a.mensagem && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{a.mensagem}</p>}
                          {a.tipo === "video" && a.video_url && <a href={a.video_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary"><PlayCircle className="h-3.5 w-3.5" /> Assistir</a>}
                          {a.url && <a href={a.url} target="_blank" rel="noreferrer" className="mt-2 block text-xs font-semibold text-primary underline">Saiba mais</a>}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
          <Secao titulo="Notificações">
            {notificacoes.length === 0 ? <Vazio>Nenhuma notificação.</Vazio> : (
              <ul className="divide-y divide-border">
                {notificacoes.map((n) => (
                  <li key={n.id} className="flex gap-3 py-2.5">
                    <Bell className={cn("mt-0.5 h-4 w-4 shrink-0", n.lida ? "text-muted-foreground" : "text-accent")} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-sm", !n.lida && "font-semibold")}>{n.titulo}</p>
                      <p className="text-sm text-muted-foreground">{n.mensagem}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{fmtDataHora(n.enviada_em)}</p>
                      {n.url && <a href={n.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary underline">Abrir</a>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Secao>
        </div>
      )}

      {aba === "agenda" && (
        <Secao titulo="Próximos eventos" descricao="Nos próximos 60 dias">
          {eventos.length === 0 ? <Vazio>Nenhum evento agendado.</Vazio> : (
            <ul className="divide-y divide-border">
              {eventos.map((e) => {
                const d = new Date(e.inicio_em);
                return (
                  <li key={e.id} className="flex gap-3 py-2.5">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white" style={{ background: e.cor || "hsl(var(--primary))" }}>
                      <div className="text-center leading-none">
                        <p className="text-lg font-bold">{d.getDate()}</p>
                        <p className="text-[10px] uppercase">{d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")}</p>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{e.titulo}</p>
                      <p className="text-xs text-muted-foreground">
                        <CalendarDays className="mr-1 inline h-3 w-3" />
                        {e.dia_inteiro ? "Dia inteiro" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        {e.local ? ` · ${e.local}` : ""}
                      </p>
                      {e.descricao && <p className="mt-1 text-xs text-muted-foreground">{e.descricao}</p>}
                      {e.url && <a href={e.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary underline">Acessar</a>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Secao>
      )}
    </div>
  );
}

function Cabecalho({ sub }: { sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/10 text-accent"><GraduationCap className="h-6 w-6" /></div>
      <div>
        <h1 className="font-display text-xl font-bold leading-tight">Meus treinamentos</h1>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function CartaoCurso({ curso: c }: { curso: CursoAluno }) {
  const capa = urlMidia(c.capa_path);
  const concluido = c.pct >= 100;
  const conteudo = (
    <>
      <div className={cn("relative bg-muted", c.capa_formato === "retrato" ? "aspect-[3/4]" : c.capa_formato === "quadrado" ? "aspect-square" : "aspect-video")}>
        {capa ? <img src={capa} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center text-muted-foreground"><GraduationCap className="h-10 w-10" /></div>}
        {c.bloqueado && (
          <div className="absolute inset-0 grid place-items-center bg-black/50 text-white">
            <div className="text-center text-xs font-semibold"><Lock className="mx-auto mb-1 h-6 w-6" />{c.em_breve ? "Em breve" : c.libera_em && c.libera_em > new Date().toISOString().slice(0, 10) ? `Libera em ${fmtData(c.libera_em)}` : "Indisponível"}</div>
          </div>
        )}
        {concluido && !c.bloqueado && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[11px] font-semibold text-white"><Award className="h-3 w-3" /> Concluído</span>}
      </div>
      <div className="p-3">
        {c.categoria && <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">{c.categoria}</p>}
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{c.nome}</p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", concluido ? "bg-success" : "bg-accent")} style={{ width: `${c.pct}%` }} />
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{c.concluidas}/{c.aulas} aulas · {c.pct}%</span>
          {c.carga_horaria_min ? <span>{Math.round(c.carga_horaria_min / 60 * 10) / 10}h</span> : null}
        </div>
        {c.certificado && <Chip tom="ok">Certificado {c.certificado}</Chip>}
      </div>
    </>
  );
  const classe = "block overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors hover:bg-muted/30";
  return (
    <li>
      {c.bloqueado ? <div className={cn(classe, "opacity-80")}>{conteudo}</div> : <Link to={`/colaborador/treinamentos/${c.id}`} className={classe}>{conteudo}</Link>}
    </li>
  );
}

