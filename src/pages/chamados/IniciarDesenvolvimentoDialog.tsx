import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CalendarClock, PlayCircle } from "lucide-react";
import {
  UNIDADES_PRAZO, calcularPrazo, chamadosComMesmaData, lerInputDataHora, paraInputDataHora,
  type ChamadoComPrazo, type UnidadePrazo,
} from "@/lib/chamados/prazoDesenvolvimento";
import { fmtDataHora, type Chamado } from "./types";

// =====================================================================
// INICIAR DESENVOLVIMENTO — o dev marca "Em desenvolvimento" e informa o
// PRAZO (28/10/2026, mig 20261028001400). Também serve para ALTERAR o prazo
// de um chamado já iniciado.
//
// Prazo em horas ou dias úteis vira uma data/hora (editável). Prazo é
// obrigatório para iniciar; data igual à de outro chamado ativo do mesmo dev
// só gera AVISO — "nada pode impedir também, só tem que dar um aviso e deixar
// como opcional" (Pablo). Vai pela RPC chamado_iniciar_desenvolvimento, que
// grava o evento no histórico e avisa o solicitante no sino; o push sai daqui.
// =====================================================================
export function IniciarDesenvolvimentoDialog({
  open,
  onOpenChange,
  chamado,
  onFeito,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chamado: Pick<Chamado, "id" | "numero" | "responsavel_id" | "desenvolvimento_iniciado_em" | "prazo_conclusao_em"> | null;
  onFeito?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const alterando = !!chamado?.desenvolvimento_iniciado_em;
  const [quantidade, setQuantidade] = useState("");
  const [unidade, setUnidade] = useState<UnidadePrazo>("horas");
  const [dataHora, setDataHora] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Abriu: começa vazio (iniciar) ou com o prazo atual (alterar).
  useEffect(() => {
    if (!open) return;
    setQuantidade("");
    setUnidade("horas");
    setDataHora(chamado?.prazo_conclusao_em ? paraInputDataHora(new Date(chamado.prazo_conclusao_em)) : "");
  }, [open, chamado?.prazo_conclusao_em]);

  // Quantidade + unidade preenchem a data; a data continua editável à mão.
  const aplicarQuantidade = (q: string, u: UnidadePrazo) => {
    setQuantidade(q);
    setUnidade(u);
    const p = calcularPrazo(new Date(), Number(q.replace(",", ".")), u);
    if (p) setDataHora(paraInputDataHora(p));
  };

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

  const prazo = lerInputDataHora(dataHora);
  const noPassado = !!prazo && prazo.getTime() <= Date.now();
  const mesmaData = useMemo(() => chamadosComMesmaData(prazo, outros, chamado?.id), [prazo?.getTime(), outros, chamado?.id]);

  const salvar = async () => {
    if (!chamado || !prazo || noPassado || salvando) return;
    setSalvando(true);
    const { error } = await (supabase as any).rpc("chamado_iniciar_desenvolvimento", {
      p_chamado_id: chamado.id, p_prazo: prazo.toISOString(),
    });
    setSalvando(false);
    if (error) {
      toast({ title: alterando ? "Erro ao alterar o prazo" : "Erro ao iniciar", description: error.message, variant: "destructive" });
      return;
    }
    supabase.functions
      .invoke("enviar-notificacao-push", { body: { chamado_id: chamado.id, evento: alterando ? "prazo_alterado" : "desenvolvimento_iniciado" } })
      .catch(() => {});
    onOpenChange(false);
    toast({
      title: alterando ? `Prazo do #${chamado.numero} alterado` : `#${chamado.numero} em desenvolvimento`,
      description: `Previsão de conclusão: ${fmtDataHora(prazo.toISOString())}. O solicitante foi avisado.`,
    });
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
    onFeito?.();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!salvando) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {alterando
              ? <><CalendarClock className="h-5 w-5 text-info" /> Alterar prazo{chamado ? ` #${chamado.numero}` : ""}</>
              : <><PlayCircle className="h-5 w-5 text-info" /> Iniciar desenvolvimento{chamado ? ` #${chamado.numero}` : ""}</>}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {alterando
            ? "Informe o novo prazo. O solicitante é avisado da mudança."
            : <>O chamado passa para <b>Em desenvolvimento</b> e o solicitante é avisado. Antes, informe quanto tempo vai levar para concluir.</>}
        </p>

        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quanto tempo vai levar?</p>
          <div className="flex gap-2">
            <Input type="number" min={1} inputMode="numeric" placeholder="Ex.: 4" className="w-28"
              value={quantidade} onChange={(e) => aplicarQuantidade(e.target.value, unidade)} />
            <Select value={unidade} onValueChange={(v) => aplicarQuantidade(quantidade, v as UnidadePrazo)}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {UNIDADES_PRAZO.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prazo para concluir (obrigatório)</p>
          <Input type="datetime-local" value={dataHora} onChange={(e) => setDataHora(e.target.value)} />
          {noPassado && <p className="text-xs text-destructive">O prazo tem que ser depois de agora.</p>}
        </div>

        {/* Mesma data em outro chamado: só aviso — dá para seguir (pedido do Pablo). */}
        {mesmaData.length > 0 && (
          <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Já tem chamado com prazo nesse mesmo dia
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
          <Button className="gap-1.5" onClick={salvar} disabled={!chamado || !prazo || noPassado || salvando}>
            {alterando ? <CalendarClock className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
            {salvando ? "Salvando…" : alterando ? "Salvar novo prazo" : mesmaData.length ? "Iniciar mesmo assim" : "Iniciar desenvolvimento"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
