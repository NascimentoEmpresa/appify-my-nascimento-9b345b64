import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, Send, PartyPopper } from "lucide-react";
import { CRITERIOS_AVALIACAO, type CriterioKey } from "./types";

// Modal de avaliação multi-critério do solicitante (5 itens de 1 a 5 + comentário).
// Só grava quando os 5 critérios estão preenchidos. Reaproveitado na lista
// "Meus chamados" e na tela de acompanhamento.
export function AvaliarChamadoDialog({
  open,
  onOpenChange,
  chamado,
  onAvaliado,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamado: { id: string; numero?: string | null } | null;
  onAvaliado?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();

  const [notas, setNotas] = useState<Record<CriterioKey, number>>({} as Record<CriterioKey, number>);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erroFalta, setErroFalta] = useState(false);

  // Zera o formulário sempre que abrir/trocar de chamado.
  useEffect(() => {
    if (open) {
      setNotas({} as Record<CriterioKey, number>);
      setComentario("");
      setSucesso(false);
      setErroFalta(false);
    }
  }, [open, chamado?.id]);

  const completo = CRITERIOS_AVALIACAO.every((c) => notas[c.key] >= 1);

  const fechar = (v: boolean) => {
    if (enviando) return;
    onOpenChange(v);
  };

  const enviar = async () => {
    if (!chamado || enviando) return;
    if (!completo) {
      setErroFalta(true);
      setTimeout(() => setErroFalta(false), 500);
      toast({ title: "Avalie todos os itens", description: "Dê de 1 a 5 estrelas em cada critério.", variant: "destructive" });
      return;
    }
    setEnviando(true);
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA_AVALIACAO").insert({
      chamado_id: chamado.id,
      solicitante_id: user?.id,
      atendimento: notas.atendimento,
      tempo: notas.tempo,
      solucao: notas.solucao,
      clareza: notas.clareza,
      satisfacao: notas.satisfacao,
      comentario: comentario.trim() || null,
    });
    setEnviando(false);
    if (error) {
      toast({ title: "Erro ao enviar avaliação", description: error.message, variant: "destructive" });
      return;
    }
    setSucesso(true);
    toast({ title: "Avaliação enviada", description: "Obrigado pelo seu retorno! 🎉" });
    // Revalida tudo que depende da avaliação (lista, stats, pendentes, detalhe).
    qc.invalidateQueries({ queryKey: ["chamado-avaliacao", chamado.id] });
    qc.invalidateQueries({ queryKey: ["chamados-avaliacoes-pendentes"] });
    qc.invalidateQueries({ queryKey: ["chamados-meus"] });
    qc.invalidateQueries({ queryKey: ["chamados-meus-stats"] });
    onAvaliado?.();
    // Deixa a animação de sucesso aparecer antes de fechar.
    setTimeout(() => onOpenChange(false), 1100);
  };

  return (
    <Dialog open={open} onOpenChange={fechar}>
      <DialogContent className={`max-w-xl ${erroFalta ? "animate-shake" : ""}`}>
        {sucesso ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success/15 text-success animate-check-pop">
              <PartyPopper className="h-8 w-8" />
            </div>
            <p className="text-lg font-bold">Avaliação enviada!</p>
            <p className="text-sm text-muted-foreground">Obrigado por ajudar a melhorar o atendimento.</p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-warning" /> Avaliar chamado{chamado?.numero ? ` #${chamado.numero}` : ""}
              </DialogTitle>
              <p className="text-sm text-muted-foreground">Por favor, avalie cada item abaixo de 1 a 5 estrelas.</p>
            </DialogHeader>

            <div className="space-y-4">
              {CRITERIOS_AVALIACAO.map((c, idx) => {
                const nota = notas[c.key] ?? 0;
                const faltando = erroFalta && nota < 1;
                return (
                  <div
                    key={c.key}
                    className="animate-rise-in space-y-1.5"
                    style={{ animationDelay: `${idx * 45}ms` }}
                  >
                    <div>
                      <p className={`text-sm font-semibold ${faltando ? "text-destructive" : ""}`}>{c.titulo}</p>
                      <p className="text-xs text-muted-foreground">{c.descricao}</p>
                    </div>
                    <div className="flex items-end justify-between gap-2">
                      <span className="w-14 shrink-0 text-[10px] leading-tight text-muted-foreground">Muito ruim</span>
                      <div className="flex flex-1 justify-between gap-1.5 sm:gap-2">
                        {[1, 2, 3, 4, 5].map((n) => {
                          const ativo = n <= nota;
                          return (
                            <button
                              key={n}
                              type="button"
                              aria-label={`${c.titulo}: ${n}`}
                              onClick={() => setNotas((cur) => ({ ...cur, [c.key]: n }))}
                              className={`group flex h-11 flex-1 flex-col items-center justify-center rounded-lg border text-sm font-semibold transition-all duration-150 active:scale-90 ${
                                ativo
                                  ? "border-warning bg-warning/10 text-warning shadow-sm"
                                  : faltando
                                    ? "border-destructive/40 text-muted-foreground hover:border-destructive"
                                    : "border-border text-muted-foreground hover:border-warning/60 hover:bg-warning/5"
                              }`}
                            >
                              <Star
                                className={`h-4 w-4 transition-transform ${ativo ? "fill-warning text-warning animate-star-pop" : "text-muted-foreground/50 group-hover:scale-110"}`}
                                style={ativo ? { animationDelay: `${(n - 1) * 40}ms` } : undefined}
                              />
                              <span className="text-[11px]">{n}</span>
                            </button>
                          );
                        })}
                      </div>
                      <span className="w-14 shrink-0 text-right text-[10px] leading-tight text-muted-foreground">Excelente</span>
                    </div>
                  </div>
                );
              })}

              <div className="animate-rise-in space-y-1" style={{ animationDelay: "240ms" }}>
                <p className="text-sm font-semibold">Comentário adicional <span className="font-normal text-muted-foreground">(opcional)</span></p>
                <Textarea
                  rows={3}
                  maxLength={500}
                  placeholder="Deixe aqui sua opinião ou sugestão para melhorarmos ainda mais…"
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                />
                <p className="text-right text-[11px] text-muted-foreground">{comentario.length}/500</p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => fechar(false)} disabled={enviando}>Cancelar</Button>
              <Button
                onClick={enviar}
                disabled={enviando}
                className={`gap-2 transition-transform active:scale-95 ${completo ? "animate-pop" : ""}`}
              >
                <Send className="h-4 w-4" /> {enviando ? "Enviando…" : "Enviar avaliação"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
