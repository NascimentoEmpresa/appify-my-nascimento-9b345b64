import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { CheckCircle2, MessageSquareWarning, Send, SkipForward, Star, UserCheck } from "lucide-react";
import { CRITERIOS_AVALIACAO_SOLICITANTE, iniciais, type CriterioSolicitanteKey } from "./types";

// =====================================================================
// O DESENVOLVEDOR AVALIA QUEM PEDIU (20/10/2026, mig 20261020000070).
//
// Mesma mecânica da avaliação do solicitante (AvaliarChamadoDialog): 1 a 5
// por critério e comentário obrigatório quando a nota não é cheia — o CHECK
// do banco repete a regra. A diferença é que aqui cada pessoa tem a sua:
// o solicitante e cada participante extra, numa aba por pessoa.
//
// Dois modos:
//   · "concluir" — aberto pelo botão Concluir. O dev avalia e conclui, ou
//     segue com "Concluir sem avaliar" (pedido do Pablo: avaliar é o
//     caminho, mas não pode travar a entrega).
//   · "avaliar"  — chamado já concluído (ex.: concluído sozinho pelo merge
//     da PR) que ainda não teve a avaliação.
// =====================================================================

const MIN_COMENTARIO = 10;

type Notas = Partial<Record<CriterioSolicitanteKey, number>>;
interface Pessoa { user_id: string; nome: string; papel: "solicitante" | "participante" }

export function AvaliarSolicitanteDialog({
  open, onOpenChange, chamado, modo, onConcluir, onAvaliado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamado: { id: string; numero?: string | null };
  modo: "concluir" | "avaliar";
  /** Modo concluir: depois de gravar, ao pular, ou quando não havia ninguém para avaliar. */
  onConcluir?: (resultado: "avaliou" | "pulou" | "ninguem") => Promise<void> | void;
  onAvaliado?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  const [notas, setNotas] = useState<Record<string, Notas>>({});
  const [comentarios, setComentarios] = useState<Record<string, string>>({});
  const [aba, setAba] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [tremer, setTremer] = useState(false);

  // Quem pode ser avaliado: solicitante + participantes extras, menos eu
  // (dev que abriu o próprio chamado não se avalia) e menos quem já tem nota.
  const { data: pessoas, isLoading } = useQuery({
    queryKey: ["chamado-avaliacao-dev-pessoas", chamado.id, user?.id],
    enabled: open && !!user?.id,
    queryFn: async () => {
      const sb = supabase as any;
      const [{ data: gente, error }, { data: feitas }] = await Promise.all([
        sb.rpc("chamado_participantes", { p_chamado_id: chamado.id }),
        sb.from("CHAMADO_SISTEMA_AVALIACAO_DEV").select("avaliado_id").eq("chamado_id", chamado.id),
      ]);
      if (error) throw error;
      const ja = new Set(((feitas ?? []) as Array<{ avaliado_id: string }>).map((f) => f.avaliado_id));
      return ((gente ?? []) as Array<{ user_id: string; nome: string; papel: string }>)
        .filter((p) => (p.papel === "solicitante" || p.papel === "participante") && p.user_id !== user?.id && !ja.has(p.user_id))
        .map((p) => ({ user_id: p.user_id, nome: p.nome, papel: p.papel as Pessoa["papel"] }));
    },
  });
  const lista = pessoas ?? [];

  // Zera ao abrir; a primeira aba é o solicitante (a RPC já ordena assim).
  useEffect(() => {
    if (open) { setNotas({}); setComentarios({}); setEnviando(false); }
  }, [open, chamado.id]);
  useEffect(() => {
    if (open && lista.length && (!aba || !lista.some((p) => p.user_id === aba))) setAba(lista[0].user_id);
  }, [open, lista, aba]);

  /** Situação de cada pessoa: não começou, incompleta, falta comentário ou pronta. */
  const situacao = useMemo(() => {
    const m: Record<string, "vazia" | "incompleta" | "falta_comentario" | "pronta"> = {};
    lista.forEach((p) => {
      const n = notas[p.user_id] ?? {};
      const c = (comentarios[p.user_id] ?? "").trim();
      const preenchidos = CRITERIOS_AVALIACAO_SOLICITANTE.filter((k) => (n[k.key] ?? 0) >= 1).length;
      if (preenchidos === 0 && !c) m[p.user_id] = "vazia";
      else if (preenchidos < CRITERIOS_AVALIACAO_SOLICITANTE.length) m[p.user_id] = "incompleta";
      else {
        const cheia = CRITERIOS_AVALIACAO_SOLICITANTE.every((k) => n[k.key] === 5);
        m[p.user_id] = cheia || c.length >= MIN_COMENTARIO ? "pronta" : "falta_comentario";
      }
    });
    return m;
  }, [lista, notas, comentarios]);

  const prontas = lista.filter((p) => situacao[p.user_id] === "pronta");
  const pendentesDeAcerto = lista.filter((p) => situacao[p.user_id] === "incompleta" || situacao[p.user_id] === "falta_comentario");

  const sacudir = () => { setTremer(true); setTimeout(() => setTremer(false), 500); };

  const fechar = (v: boolean) => { if (!enviando) onOpenChange(v); };

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["chamado-avaliacao-dev", chamado.id] });
    qc.invalidateQueries({ queryKey: ["chamado-avaliacao-dev-pessoas", chamado.id] });
    qc.invalidateQueries({ queryKey: ["chamados-ranking-solicitantes"] });
  };

  const enviar = async () => {
    if (enviando) return;
    // Começou a avaliar alguém e parou no meio: leva até a aba e explica.
    if (pendentesDeAcerto.length) {
      const p = pendentesDeAcerto[0];
      setAba(p.user_id); sacudir();
      toast({
        title: situacao[p.user_id] === "incompleta" ? `Falta nota para ${p.nome}` : `Conte o que faltou — ${p.nome}`,
        description: situacao[p.user_id] === "incompleta"
          ? "Dê de 1 a 5 em todos os critérios, ou apague as notas dessa pessoa."
          : `Notas abaixo de 5 pedem um comentário de pelo menos ${MIN_COMENTARIO} caracteres.`,
        variant: "destructive",
      });
      return;
    }
    if (!prontas.length) {
      sacudir();
      toast({
        title: "Ninguém avaliado ainda",
        description: modo === "concluir" ? "Avalie ao menos uma pessoa ou use \"Concluir sem avaliar\"." : "Avalie ao menos uma pessoa.",
        variant: "destructive",
      });
      return;
    }
    setEnviando(true);
    const linhas = prontas.map((p) => ({
      chamado_id: chamado.id, avaliado_id: p.user_id, avaliador_id: user?.id, papel: p.papel,
      ...notas[p.user_id], comentario: (comentarios[p.user_id] ?? "").trim() || null,
    }));
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA_AVALIACAO_DEV").insert(linhas);
    if (error) {
      setEnviando(false);
      const violou = error.message?.includes("chamado_avaliacao_comentario_obrigatorio_dev");
      toast({
        title: violou ? "Conte o que faltou" : "Erro ao gravar a avaliação",
        description: violou ? `Notas abaixo de 5 exigem um comentário de pelo menos ${MIN_COMENTARIO} caracteres.` : error.message,
        variant: "destructive",
      });
      return;
    }
    invalidar();
    toast({ title: prontas.length === 1 ? "Avaliação registrada" : `${prontas.length} avaliações registradas` });
    onAvaliado?.();
    if (modo === "concluir") await onConcluir?.("avaliou");
    setEnviando(false);
    onOpenChange(false);
  };

  const pular = async (resultado: "pulou" | "ninguem" = "pulou") => {
    if (enviando) return;
    setEnviando(true);
    await onConcluir?.(resultado);
    setEnviando(false);
    onOpenChange(false);
  };

  const atual = lista.find((p) => p.user_id === aba) ?? null;
  const notasAtual = (atual && notas[atual.user_id]) || {};
  const comentarioAtual = (atual && comentarios[atual.user_id]) || "";
  const sitAtual = atual ? situacao[atual.user_id] : "vazia";
  const precisaComentario = sitAtual === "falta_comentario" || (sitAtual === "pronta" && !CRITERIOS_AVALIACAO_SOLICITANTE.every((k) => notasAtual[k.key] === 5));
  const abaixoDe5 = CRITERIOS_AVALIACAO_SOLICITANTE.filter((k) => (notasAtual[k.key] ?? 0) >= 1 && (notasAtual[k.key] ?? 0) < 5);

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className={`max-h-[92vh] max-w-2xl overflow-y-auto ${tremer ? "animate-shake" : ""}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-info" />
            {modo === "concluir" ? "Antes de concluir: avalie quem pediu" : "Avaliar quem pediu"}
            {chamado.numero ? <span className="font-mono text-sm text-muted-foreground">#{chamado.numero}</span> : null}
          </DialogTitle>
          <DialogDescription>
            Como foi trabalhar neste chamado com quem pediu? Cada pessoa recebe a sua avaliação. A nota fica com você e com a gestão de chamados.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : lista.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-success" />
            <p className="text-sm font-semibold">Ninguém para avaliar aqui</p>
            <p className="text-xs text-muted-foreground">Todos já foram avaliados — ou você mesmo abriu este chamado.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Uma aba por pessoa, com o estado de cada avaliação. */}
            {lista.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {lista.map((p) => {
                  const s = situacao[p.user_id];
                  const ativo = p.user_id === aba;
                  return (
                    <button
                      key={p.user_id} type="button" onClick={() => setAba(p.user_id)}
                      className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs transition-colors ${
                        ativo ? "border-info bg-info/10 font-semibold" : "border-border hover:border-info/50"}`}
                    >
                      <Avatar className="h-6 w-6"><AvatarFallback className="text-[9px]">{iniciais(p.nome)}</AvatarFallback></Avatar>
                      <span className="max-w-[140px] truncate">{p.nome}</span>
                      {s === "pronta" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                        : s === "vazia" ? null
                        : <span className="h-2 w-2 rounded-full bg-warning" title="Incompleta" />}
                    </button>
                  );
                })}
              </div>
            )}

            {atual && (
              <div key={atual.user_id} className="space-y-4 rounded-xl border border-border p-4">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9"><AvatarFallback className="text-xs">{iniciais(atual.nome)}</AvatarFallback></Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{atual.nome}</p>
                    <p className="text-[11px] text-muted-foreground">{atual.papel === "solicitante" ? "Solicitante do chamado" : "Participante do chamado"}</p>
                  </div>
                </div>

                {CRITERIOS_AVALIACAO_SOLICITANTE.map((c, idx) => {
                  const nota = notasAtual[c.key] ?? 0;
                  const faltando = tremer && sitAtual === "incompleta" && nota < 1;
                  return (
                    <div key={c.key} className="animate-rise-in space-y-1.5" style={{ animationDelay: `${idx * 40}ms` }}>
                      <div>
                        <p className={`text-sm font-semibold ${faltando ? "text-destructive" : ""}`}>
                          {c.titulo} <span className="text-[10px] font-normal text-muted-foreground">({Math.round(c.peso * 100)}%)</span>
                        </p>
                        <p className="text-xs text-muted-foreground">{c.descricao}</p>
                      </div>
                      <div className="flex gap-1.5 sm:gap-2">
                        {[1, 2, 3, 4, 5].map((n) => {
                          const on = n <= nota;
                          return (
                            <button
                              key={n} type="button" aria-label={`${c.titulo}: ${n}`}
                              onClick={() => setNotas((cur) => ({ ...cur, [atual.user_id]: { ...cur[atual.user_id], [c.key]: n } }))}
                              className={`group flex h-10 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-semibold transition-all duration-150 active:scale-90 ${
                                on ? "border-warning bg-warning/10 text-warning shadow-sm"
                                  : faltando ? "border-destructive/40 text-muted-foreground"
                                  : "border-border text-muted-foreground hover:border-warning/60 hover:bg-warning/5"}`}
                            >
                              <Star className={`h-3.5 w-3.5 ${on ? "fill-warning text-warning animate-star-pop" : "text-muted-foreground/50"}`} />
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="space-y-1">
                  <p className="text-sm font-semibold">
                    Comentário{" "}
                    {precisaComentario
                      ? <span className="text-destructive">(obrigatório)</span>
                      : <span className="font-normal text-muted-foreground">(opcional)</span>}
                  </p>
                  {precisaComentario && (
                    <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
                      <MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>Menos de 5 em <b>{abaixoDe5.map((k) => k.titulo).join(", ")}</b>. Conte o que faltou — é o que ajuda a pessoa a pedir melhor da próxima vez.</span>
                    </p>
                  )}
                  <Textarea
                    rows={3} maxLength={500}
                    placeholder={precisaComentario
                      ? "Ex.: a descrição não dizia qual relatório, demorou dias para responder a dúvida…"
                      : "Algo que vale registrar sobre como foi o atendimento com esta pessoa…"}
                    value={comentarioAtual}
                    onChange={(e) => setComentarios((cur) => ({ ...cur, [atual.user_id]: e.target.value }))}
                  />
                  <p className={`text-right text-[11px] ${sitAtual === "falta_comentario" ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                    {sitAtual === "falta_comentario" ? `Faltam ${MIN_COMENTARIO - comentarioAtual.trim().length} caracteres` : `${comentarioAtual.length}/500`}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          {modo === "concluir" && lista.length === 0 ? <span /> : modo === "concluir" ? (
            <Button variant="ghost" className="gap-1.5 text-muted-foreground" disabled={enviando} onClick={() => pular("pulou")}>
              <SkipForward className="h-4 w-4" /> Concluir sem avaliar
            </Button>
          ) : (
            <Button variant="outline" disabled={enviando} onClick={() => fechar(false)}>Cancelar</Button>
          )}
          {lista.length > 0 ? (
            <Button className="gap-1.5" disabled={enviando} onClick={enviar}>
              <Send className="h-4 w-4" />
              {enviando ? "Gravando…" : modo === "concluir" ? "Avaliar e concluir" : "Enviar avaliação"}
              {lista.length > 1 && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[10px]">{prontas.length}/{lista.length}</span>}
            </Button>
          ) : modo === "concluir" ? (
            <Button className="gap-1.5" disabled={enviando} onClick={() => pular("ninguem")}><CheckCircle2 className="h-4 w-4" /> Concluir</Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
