import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, ArrowDown, CalendarClock, Lock, PlayCircle } from "lucide-react";
import {
  chamadosComMesmaData, desceuNaFila, somarDiasUteis, type ChamadoComPrazo,
} from "@/lib/chamados/prazoDesenvolvimento";
import { fmtData, type Chamado } from "./types";

// =====================================================================
// PRAZO DO DESENVOLVEDOR — definir / redefinir o prazo em DIAS ÚTEIS e
// iniciar o desenvolvimento (28/10/2026, migs 20261028001400/1410, chamado
// SIS-2026-0763).
//
// modo "definir": prazo da tarefa recebida (ou redefinição, que o banco só
//   aceita quando a tarefa DESCEU na fila — chamado_definir_prazo).
// modo "iniciar": marca "Em desenvolvimento"; se o prazo ainda não foi
//   definido, ele é obrigatório aqui (chamado_iniciar_desenvolvimento).
//
// Definido, o prazo fica TRAVADO — "esse prazo não poderá ser alterado,
// somente se a tarefa descer de prioridade" (Pablo). Previsão no mesmo dia
// de outro chamado ativo do dev é só AVISO, deixa seguir (pedido anterior).
// =====================================================================
export type ModoPrazo = "definir" | "iniciar";

export function IniciarDesenvolvimentoDialog({
  open,
  onOpenChange,
  chamado,
  modo = "iniciar",
  onFeito,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamado: Pick<Chamado, "id" | "numero" | "status" | "responsavel_id" | "posicao_dev" | "desenvolvimento_iniciado_em"
    | "prazo_conclusao_em" | "prazo_dias" | "prazo_posicao_fila"> | null;
  modo?: ModoPrazo;
  onFeito?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const prazoTravado = chamado?.prazo_dias != null;               // já definido
  const redefinindo = modo === "definir" && prazoTravado;          // só chega aqui se desceu
  const pedeDias = modo === "definir" || !prazoTravado;            // iniciar com prazo já definido não pergunta
  const [dias, setDias] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => { if (open) setDias(redefinindo ? String(chamado?.prazo_dias ?? "") : ""); }, [open, redefinindo, chamado?.prazo_dias]);

  const n = Number(dias);
  const diasOk = Number.isInteger(n) && n >= 1 && n <= 120;
  // Previsão mostrada: iniciando = hoje + prazo; já iniciado = início + prazo.
  // Não iniciado e só definindo: a previsão depende da fila (Painel do Desenvolvedor).
  const diasEfetivos = pedeDias ? (diasOk ? n : null) : chamado?.prazo_dias ?? null;
  const previsao = useMemo(() => {
    if (!diasEfetivos) return null;
    if (modo === "iniciar") return somarDiasUteis(new Date(), diasEfetivos);
    if (chamado?.desenvolvimento_iniciado_em) return somarDiasUteis(new Date(chamado.desenvolvimento_iniciado_em), diasEfetivos);
    return null;
  }, [diasEfetivos, modo, chamado?.desenvolvimento_iniciado_em]);

  // Outros chamados ativos do mesmo dev, para o aviso de data repetida.
  const { data: outros = [] } = useQuery({
    queryKey: ["chamados-prazos-dev", chamado?.responsavel_id],
    enabled: open && !!chamado?.responsavel_id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("CHAMADO_SISTEMA")
        .select("id, numero, assunto, prazo_conclusao_em, prazo_previsto")
        .eq("responsavel_id", chamado!.responsavel_id)
        .not("status", "in", "(concluido,reprovado,cancelado)");
      return (data ?? []) as ChamadoComPrazo[];
    },
  });
  const mesmaData = useMemo(() => chamadosComMesmaData(previsao, outros, chamado?.id), [previsao?.getTime(), outros, chamado?.id]);

  const salvar = async () => {
    if (!chamado || salvando || (pedeDias && !diasOk)) return;
    setSalvando(true);
    const { error } = modo === "iniciar"
      ? await (supabase as any).rpc("chamado_iniciar_desenvolvimento", { p_chamado_id: chamado.id, p_prazo_dias: pedeDias ? n : null })
      : await (supabase as any).rpc("chamado_definir_prazo", { p_chamado_id: chamado.id, p_dias: n });
    setSalvando(false);
    if (error) {
      toast({ title: modo === "iniciar" ? "Erro ao iniciar" : "Erro ao salvar o prazo", description: error.message, variant: "destructive" });
      return;
    }
    if (modo === "iniciar" || (redefinindo && chamado.desenvolvimento_iniciado_em)) {
      supabase.functions
        .invoke("enviar-notificacao-push", { body: { chamado_id: chamado.id, evento: modo === "iniciar" ? "desenvolvimento_iniciado" : "prazo_alterado" } })
        .catch(() => {});
    }
    onOpenChange(false);
    toast({
      title: modo === "iniciar" ? `#${chamado.numero} em desenvolvimento`
        : redefinindo ? `Prazo do #${chamado.numero} redefinido` : `Prazo do #${chamado.numero} definido`,
      description: previsao ? `Previsão de entrega: ${fmtData(previsao.toISOString())}.` : "A previsão de entrega acompanha a sua fila.",
    });
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
    onFeito?.();
  };

  const titulo = modo === "iniciar" ? "Iniciar desenvolvimento" : redefinindo ? "Redefinir prazo" : "Definir prazo";
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!salvando) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {modo === "iniciar" ? <PlayCircle className="h-5 w-5 text-info" /> : <CalendarClock className="h-5 w-5 text-info" />}
            {titulo}{chamado ? ` #${chamado.numero}` : ""}
          </DialogTitle>
        </DialogHeader>

        {modo === "iniciar" ? (
          <p className="text-sm text-muted-foreground">
            O chamado passa para <b>Em desenvolvimento</b> e o solicitante é avisado com a previsão de entrega.
          </p>
        ) : redefinindo && chamado && desceuNaFila(chamado as never) ? (
          <p className="flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
            <ArrowDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            A tarefa desceu de prioridade na fila ({chamado.prazo_posicao_fila}º → {chamado.posicao_dev}º). Por isso dá para redefinir o prazo.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Quantos dias úteis você precisa para concluir esta tarefa, de acordo com as suas prioridades?
          </p>
        )}

        {pedeDias ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prazo (dias úteis) — obrigatório</p>
            <Input type="number" min={1} max={120} inputMode="numeric" placeholder="Ex.: 3" className="w-32"
              value={dias} onChange={(e) => setDias(e.target.value)} />
            <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              Depois de salvo, o prazo fica travado. Só dá para redefinir se a tarefa descer de prioridade na fila.
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-sm">
            <Lock className="h-4 w-4 text-muted-foreground" /> Prazo definido: <b>{chamado?.prazo_dias} dia(s) útil(eis)</b>
          </p>
        )}

        {previsao && (
          <p className="text-sm">Previsão de entrega: <b>{fmtData(previsao.toISOString())}</b> <span className="text-xs text-muted-foreground">(sem fins de semana e feriados)</span></p>
        )}

        {/* Mesma data em outro chamado: só aviso — dá para seguir (pedido do Pablo). */}
        {mesmaData.length > 0 && (
          <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Já tem chamado com entrega nesse mesmo dia
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              {mesmaData.map((c) => (
                <li key={c.id} className="truncate"><span className="font-mono font-semibold">#{c.numero}</span> {c.assunto}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">O ideal é cada chamado ter a sua data. Se preferir manter, pode seguir assim mesmo.</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>Voltar</Button>
          <Button className="gap-1.5" onClick={salvar} disabled={!chamado || salvando || (pedeDias && !diasOk)}>
            {modo === "iniciar" ? <PlayCircle className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
            {salvando ? "Salvando…" : mesmaData.length ? `${titulo} mesmo assim` : titulo}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
