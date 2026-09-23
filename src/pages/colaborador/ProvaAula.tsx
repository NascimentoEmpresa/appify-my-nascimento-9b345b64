import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, ClipboardCheck, Clock, Loader2, Lock, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  fmtDataHora, useIniciarProva, useProvaAula, useResponderProva,
  type AulaAluno, type PerguntaProva, type ResultadoProva,
} from "@/hooks/useColaboradorPortal";

// =====================================================================
// PORTAL DO COLABORADOR — prova da aula (22/09/2026)
//
// Substitui o "Quiz da aula". Quem manda é o banco (trn_prova_*): se está
// liberada (vídeo assistido, tentativas, espera), quais perguntas caíram
// nesta tentativa e em que ordem, a correção, a nota que vale e o quanto do
// gabarito aparece. Aqui é só a tela: começar, responder, ver o resultado.
//
// A tentativa fica aberta no banco: recarregar a página retoma a mesma
// (mesmas perguntas, cronômetro correndo) sem gastar tentativa.
// =====================================================================

type Respostas = Record<string, number[]>;

export function ProvaAula({ aula, cursoId }: { aula: AulaAluno; cursoId: string }) {
  const q = useProvaAula(aula.id);
  const iniciar = useIniciarProva(aula.id);
  const responder = useResponderProva(aula.id, cursoId);
  const [respostas, setRespostas] = useState<Respostas>({});
  const [resultado, setResultado] = useState<{ r: ResultadoProva; perguntas: PerguntaProva[] } | null>(null);

  const e = q.data;
  const aberta = e?.aberta ?? null;
  const cfg = e?.config;

  // Troca de tentativa: zera as marcações.
  useEffect(() => { setRespostas({}); }, [aberta?.id]);

  const restante = useCronometro(aberta?.expira_em ?? null);

  const faltam = useMemo(
    () => (aberta?.perguntas ?? []).filter((p) => !(respostas[p.id]?.length)).length,
    [aberta, respostas],
  );

  if (q.isLoading) return <Caixa><p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando a prova…</p></Caixa>;
  if (q.isError) return <Caixa><p className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Não foi possível carregar a prova."}</p></Caixa>;
  if (!e?.tem_prova || !cfg) return null;

  const comecar = async () => {
    setResultado(null);
    try { await iniciar.mutateAsync(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Não foi possível começar."); }
  };

  const enviar = async () => {
    if (!aberta) return;
    if (faltam > 0 && !window.confirm(`${faltam} pergunta(s) sem resposta contam como erradas. Enviar mesmo assim?`)) return;
    try {
      const r = await responder.mutateAsync({ tentativa_id: aberta.id, respostas });
      setResultado({ r, perguntas: aberta.perguntas });
      if (r.aprovado) toast.success(r.certificado ? `Aprovado com ${r.nota}%! Curso concluído — seu certificado foi emitido.` : `Aprovado com ${r.nota}%!`);
      else toast.error(`Você fez ${r.nota}%. O mínimo é ${r.nota_minima}%.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar.");
    }
  };

  const marcar = (p: PerguntaProva, i: number) => setRespostas((r) => {
    if (p.tipo !== "multipla") return { ...r, [p.id]: [i] };
    const atual = r[p.id] ?? [];
    return { ...r, [p.id]: atual.includes(i) ? atual.filter((x) => x !== i) : [...atual, i] };
  });

  const tentativasTxt = cfg.tentativas_max == null ? "tentativas ilimitadas" : `${e.usadas ?? 0} de ${cfg.tentativas_max} tentativa(s) usada(s)`;

  return (
    <Caixa>
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck className="h-5 w-5 text-primary" />
        <h3 className="font-display text-base font-bold">{cfg.titulo || "Prova da aula"}</h3>
        <span className="ml-auto text-xs text-muted-foreground">Mínimo {cfg.nota_minima}% · {tentativasTxt}</span>
      </div>

      {/* Resultado da tentativa que acabou de ser enviada */}
      {resultado && <Resultado dados={resultado} gabarito={cfg.gabarito} />}

      {/* Tentativa aberta */}
      {aberta && !resultado ? (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Tentativa {aberta.numero} · {aberta.perguntas.length} pergunta(s)</span>
            {restante != null && (
              <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", restante <= 60 ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground")}>
                <Clock className="h-3.5 w-3.5" /> {restante > 0 ? fmtRelogio(restante) : "tempo esgotado"}
              </span>
            )}
          </div>
          <ol className="mt-3 space-y-5">
            {aberta.perguntas.map((p, n) => (
              <li key={p.id}>
                <p className="text-sm font-semibold">
                  {n + 1}. {p.enunciado}
                  <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                    {p.tipo === "multipla" ? "marque todas as corretas · " : ""}{p.pontos} pt{p.pontos === 1 ? "" : "s"}
                  </span>
                </p>
                <div className="mt-1.5 space-y-1">
                  {p.opcoes.map((o) => {
                    const on = !!respostas[p.id]?.includes(o.i);
                    return (
                      <label key={o.i} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", on ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
                        <input type={p.tipo === "multipla" ? "checkbox" : "radio"} name={`p-${aberta.id}-${p.id}`} checked={on} onChange={() => marcar(p, o.i)} className="accent-primary" />
                        {o.texto}
                      </label>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{faltam > 0 ? `${faltam} sem resposta` : "Tudo respondido"}</p>
            <button type="button" disabled={responder.isPending} onClick={enviar}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {responder.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Enviar prova
            </button>
          </div>
        </>
      ) : (
        /* Sem tentativa aberta: situação + botão de começar */
        <div className="mt-3 space-y-3">
          {e.aprovado && !resultado && (
            <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">Você foi aprovado nesta prova com {e.nota}%.</p>
          )}
          {!e.aprovado && e.nota != null && !resultado && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">Sua nota até agora: <b>{e.nota}%</b> (mínimo {cfg.nota_minima}%).</p>
          )}
          {cfg.instrucoes && !e.historico?.length && <p className="whitespace-pre-line text-sm text-muted-foreground">{cfg.instrucoes}</p>}
          {!e.historico?.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              <li>{cfg.perguntas} pergunta(s); a nota é o percentual dos pontos.</li>
              <li>{cfg.tentativas_max == null ? "Pode refazer quantas vezes quiser" : `Você tem ${cfg.tentativas_max} tentativa(s)`}; vale {cfg.nota_vale === "ultima" ? "a nota da última" : "a maior nota"}.</li>
              {cfg.tempo_limite_min != null && <li>Tempo limite de {cfg.tempo_limite_min} min por tentativa — o relógio começa ao clicar em Começar.</li>}
              {cfg.intervalo_min != null && <li>Entre uma tentativa e outra é preciso esperar {cfg.intervalo_min} min.</li>}
            </ul>
          )}
          {e.liberada ? (
            <button type="button" disabled={iniciar.isPending} onClick={comecar}
                    className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {iniciar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : e.historico?.length ? <RotateCcw className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
              {e.historico?.length ? `Fazer de novo${e.restantes != null ? ` (${e.restantes} restante${e.restantes === 1 ? "" : "s"})` : ""}` : "Começar a prova"}
            </button>
          ) : (
            <p className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground"><Lock className="h-4 w-4 shrink-0" /> {e.motivo}</p>
          )}
          {!!e.historico?.length && (
            <div className="text-xs text-muted-foreground">
              {e.historico.map((h) => (
                <div key={h.numero} className="flex items-center gap-2">
                  {h.aprovado ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                  Tentativa {h.numero}: <b>{h.nota}%</b> · {fmtDataHora(h.enviada_em)}{h.encerramento === "tempo_esgotado" ? " · tempo esgotado" : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Caixa>
  );
}

function Resultado({ dados, gabarito }: { dados: { r: ResultadoProva; perguntas: PerguntaProva[] }; gabarito: string }) {
  const { r, perguntas } = dados;
  const itens = new Map((r.itens ?? []).map((i) => [i.id, i]));
  return (
    <div className="mt-3 space-y-3">
      <div className={cn("rounded-lg px-3 py-2 text-sm", r.aprovado ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
        <b>{r.aprovado ? "Aprovado" : "Não aprovado"}</b> — {r.nota}% ({Number(r.pontos)} de {Number(r.pontos_total)} pontos · {r.acertos} de {r.total} certas). Mínimo {r.nota_minima}%.
        {!r.aprovado && r.restantes === 0 && <div className="mt-1 text-xs">Suas tentativas acabaram. Se precisar de mais uma, procure o setor de Treinamentos.</div>}
      </div>
      {r.itens && (
        <ol className="space-y-3">
          {perguntas.map((p, n) => {
            const it = itens.get(p.id);
            if (!it) return null;
            return (
              <li key={p.id} className="rounded-lg border px-3 py-2">
                <p className="text-sm font-semibold">
                  {n + 1}. {p.enunciado}
                  {it.ok ? <span className="ml-2 text-success">✓</span> : <span className="ml-2 text-destructive">✗</span>}
                  {!it.ok && it.pontos > 0 && <span className="ml-2 text-[11px] font-normal text-muted-foreground">{Number(it.pontos)} de {Number(it.max)} pt</span>}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {p.opcoes.map((o) => {
                    const marcou = it.marcadas.includes(o.i);
                    const certa = it.corretas?.includes(o.i);
                    return (
                      <li key={o.i} className={cn("rounded px-2 py-0.5", certa && "bg-success/10 font-semibold text-success", marcou && it.corretas && !certa && "bg-destructive/10 text-destructive line-through")}>
                        {marcou ? "● " : "○ "}{o.texto}
                      </li>
                    );
                  })}
                </ul>
                {it.explicacao && <p className="mt-1 text-xs text-muted-foreground">💡 {it.explicacao}</p>}
              </li>
            );
          })}
        </ol>
      )}
      {!r.itens && gabarito === "nunca" && <p className="text-xs text-muted-foreground">Esta prova não mostra o gabarito.</p>}
      {r.itens && !r.itens.some((i) => i.corretas) && gabarito === "ao_final" && (
        <p className="text-xs text-muted-foreground">As respostas certas aparecem quando você for aprovado ou quando acabarem as tentativas.</p>
      )}
    </div>
  );
}

function Caixa({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">{children}</div>;
}

/** Segundos até `expira` (null = sem limite), atualizado a cada segundo. */
function useCronometro(expira: string | null): number | null {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    if (!expira) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expira]);
  if (!expira) return null;
  return Math.max(0, Math.round((new Date(expira).getTime() - agora) / 1000));
}

const fmtRelogio = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
