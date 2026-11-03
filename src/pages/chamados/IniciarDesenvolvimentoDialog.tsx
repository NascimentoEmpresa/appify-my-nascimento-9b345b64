import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, Lock, PlayCircle } from "lucide-react";
import {
  LIMITE_PRAZO, UNIDADES_PRAZO, calcularPrevisao, chamadosComMesmaData, mudouNaFila, prazoValido, rotuloPrazo,
  type ChamadoComPrazo, type UnidadePrazo,
} from "@/lib/chamados/prazoDesenvolvimento";
import { fmtData, fmtDataHora, type Chamado } from "./types";

// =====================================================================
// PRAZO DO DESENVOLVEDOR — iniciar o desenvolvimento com o prazo real, ou
// ajustar o prazo (28/10/2026, migs 20261028001400/1410/1900, chamado
// SIS-2026-0763).
//
// O prazo é quantidade + unidade: horas (corridas), dias úteis ou semanas —
// "determinar se o prazo vai ser em dias, horas, semanas" (Pablo).
//
// modo "iniciar": marca "Em desenvolvimento"; se o prazo ainda não foi
//   definido, ele é obrigatório aqui (chamado_iniciar_desenvolvimento).
// modo "definir": ajuste do prazo, que o banco só aceita quando a POSIÇÃO DA
//   TAREFA NA FILA MUDOU — "se meu chamado numero 5 foi pra 6, posso ajustar
//   o prazo, e vice versa" (chamado_definir_prazo).
//
// Previsão no mesmo dia de outro chamado ativo do dev: deixa seguir, mas
// PERGUNTA antes de salvar (29/10/2026, Pablo: "você já tem demandas pra
// entregar nesse dia, deseja confirmar?"). Até aqui era só a faixa amarela
// no diálogo — o #8498 foi iniciado com a mesma previsão (30/10) do #8773
// sem ninguém parar para ler. E a consulta dos outros chamados engolia o
// erro: se falhasse, o aviso sumia calado. Agora a checagem é refeita no
// banco NA HORA do clique (sem cache) e erro de consulta aparece.
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
    | "prazo_conclusao_em" | "prazo_dias" | "prazo_unidade" | "prazo_posicao_fila"> | null;
  modo?: ModoPrazo;
  onFeito?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const prazoDefinido = chamado?.prazo_dias != null;
  const ajustando = modo === "definir" && prazoDefinido;           // só chega aqui se a posição mudou
  const pedePrazo = modo === "definir" || !prazoDefinido;           // iniciar com prazo já definido não pergunta
  const [quantidade, setQuantidade] = useState("");
  const [unidade, setUnidade] = useState<UnidadePrazo>("dias");
  const [salvando, setSalvando] = useState(false);
  // Chamados com entrega no mesmo dia, achados no clique: abre a confirmação.
  const [confirmarMesmaData, setConfirmarMesmaData] = useState<ChamadoComPrazo[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmarMesmaData(null);
    setQuantidade(ajustando ? String(chamado?.prazo_dias ?? "") : "");
    setUnidade(((ajustando ? chamado?.prazo_unidade : null) ?? "dias") as UnidadePrazo);
  }, [open, ajustando, chamado?.prazo_dias, chamado?.prazo_unidade]);

  const n = Number(quantidade);
  const prazoOk = prazoValido(n, unidade);
  // O que vale para a previsão: o digitado agora ou o já definido.
  const qtdEfetiva = pedePrazo ? (prazoOk ? n : null) : chamado?.prazo_dias ?? null;
  const unidadeEfetiva = (pedePrazo ? unidade : chamado?.prazo_unidade ?? "dias") as UnidadePrazo;
  // Previsão: iniciando = agora + prazo; já iniciado = início + prazo. Não
  // iniciado e só ajustando: depende da fila (Painel do Desenvolvedor).
  const previsao = useMemo(() => {
    if (!qtdEfetiva) return null;
    if (modo === "iniciar") return calcularPrevisao(new Date(), qtdEfetiva, unidadeEfetiva);
    if (chamado?.desenvolvimento_iniciado_em) return calcularPrevisao(new Date(chamado.desenvolvimento_iniciado_em), qtdEfetiva, unidadeEfetiva);
    return null;
  }, [qtdEfetiva, unidadeEfetiva, modo, chamado?.desenvolvimento_iniciado_em]);

  // Outros chamados ativos do mesmo dev, para o aviso de data repetida.
  const buscarOutros = async (): Promise<ChamadoComPrazo[]> => {
    const { data, error } = await (supabase as any)
      .from("CHAMADO_SISTEMA")
      .select("id, numero, assunto, prazo_conclusao_em, prazo_previsto")
      .eq("responsavel_id", chamado!.responsavel_id)
      .not("status", "in", "(concluido,reprovado,cancelado)");
    if (error) throw error;
    return (data ?? []) as ChamadoComPrazo[];
  };
  const { data: outros = [] } = useQuery({
    queryKey: ["chamados-prazos-dev", chamado?.responsavel_id],
    enabled: open && !!chamado?.responsavel_id,
    queryFn: buscarOutros,
  });
  const mesmaData = useMemo(() => chamadosComMesmaData(previsao, outros, chamado?.id), [previsao?.getTime(), outros, chamado?.id]);

  const salvar = async (confirmado = false) => {
    if (!chamado || salvando || (pedePrazo && !prazoOk)) return;
    setSalvando(true);
    // Mesmo dia de outra entrega: confere no banco agora e pergunta antes.
    if (!confirmado && previsao && chamado.responsavel_id) {
      let conflitos: ChamadoComPrazo[];
      try {
        conflitos = chamadosComMesmaData(previsao, await buscarOutros(), chamado.id);
      } catch (e) {
        setSalvando(false);
        toast({ title: "Não deu para conferir as outras entregas", description: (e as Error)?.message ?? String(e), variant: "destructive" });
        return;
      }
      if (conflitos.length) {
        setSalvando(false);
        setConfirmarMesmaData(conflitos);
        return;
      }
    }
    setConfirmarMesmaData(null);
    const { error } = modo === "iniciar"
      ? await (supabase as any).rpc("chamado_iniciar_desenvolvimento", {
          p_chamado_id: chamado.id, p_quantidade: pedePrazo ? n : null, p_unidade: pedePrazo ? unidade : null,
        })
      : await (supabase as any).rpc("chamado_definir_prazo", { p_chamado_id: chamado.id, p_quantidade: n, p_unidade: unidade });
    setSalvando(false);
    if (error) {
      toast({ title: modo === "iniciar" ? "Erro ao iniciar" : "Erro ao salvar o prazo", description: error.message, variant: "destructive" });
      return;
    }
    if (modo === "iniciar" || (ajustando && chamado.desenvolvimento_iniciado_em)) {
      supabase.functions
        .invoke("enviar-notificacao-push", { body: { chamado_id: chamado.id, evento: modo === "iniciar" ? "desenvolvimento_iniciado" : "prazo_alterado" } })
        .catch(() => {});
    }
    onOpenChange(false);
    toast({
      title: modo === "iniciar" ? `#${chamado.numero} em desenvolvimento`
        : ajustando ? `Prazo do #${chamado.numero} ajustado` : `Prazo do #${chamado.numero} definido`,
      description: previsao
        ? `Previsão de entrega: ${unidadeEfetiva === "horas" ? fmtDataHora(previsao.toISOString()) : fmtData(previsao.toISOString())}.`
        : "A previsão de entrega acompanha a sua fila.",
    });
    qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0] ?? "").startsWith("chamado") });
    onFeito?.();
  };

  const titulo = modo === "iniciar" ? "Iniciar desenvolvimento" : ajustando ? "Ajustar prazo" : "Definir prazo";
  const subiu = !!chamado && mudouNaFila(chamado as never) && (chamado.posicao_dev ?? 0) < (chamado.prazo_posicao_fila ?? 0);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!salvando) onOpenChange(v); }}>
      {/* [&>*]:min-w-0: sem isso, texto longo (o assunto no aviso de data
          repetida) estica a coluna do grid do diálogo e ele estoura para a
          direita com barra de rolagem (28/10/2026). */}
      <DialogContent className="max-w-md [&>*]:min-w-0">
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
        ) : ajustando && chamado && mudouNaFila(chamado as never) ? (
          <p className="flex items-start gap-1.5 rounded-md border border-info/30 bg-info/5 p-2.5 text-xs text-info">
            {subiu ? <ArrowUp className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ArrowDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            A tarefa mudou de posição na fila ({chamado.prazo_posicao_fila}º → {chamado.posicao_dev}º). Por isso dá para ajustar o prazo
            (hoje: {rotuloPrazo(chamado.prazo_dias, chamado.prazo_unidade)}).
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Quanto tempo você precisa para concluir esta tarefa?</p>
        )}

        {pedePrazo ? (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prazo — obrigatório</p>
            <div className="flex gap-2">
              <Input type="number" min={1} max={LIMITE_PRAZO[unidade]} inputMode="numeric" placeholder="Ex.: 3" className="w-28"
                value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              <Select value={unidade} onValueChange={(v) => setUnidade(v as UnidadePrazo)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UNIDADES_PRAZO.map((u) => <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {quantidade && !prazoOk && (
              <p className="text-[11px] text-destructive">Use de 1 a {LIMITE_PRAZO[unidade]} {UNIDADES_PRAZO.find((u) => u.value === unidade)?.label.toLowerCase()}.</p>
            )}
            <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              Depois de salvo, o prazo fica travado. Só dá para ajustar se a posição da tarefa na fila mudar.
            </p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 text-sm">
            <Lock className="h-4 w-4 text-muted-foreground" /> Prazo definido: <b>{rotuloPrazo(chamado?.prazo_dias, chamado?.prazo_unidade)}</b>
          </p>
        )}

        {previsao && (
          <p className="text-sm">
            Previsão de entrega: <b>{unidadeEfetiva === "horas" ? fmtDataHora(previsao.toISOString()) : fmtData(previsao.toISOString())}</b>{" "}
            <span className="text-xs text-muted-foreground">{unidadeEfetiva === "horas" ? "(horas corridas)" : "(sem fins de semana e feriados)"}</span>
          </p>
        )}

        {/* Mesma data em outro chamado: só aviso — dá para seguir (pedido do Pablo). */}
        {mesmaData.length > 0 && (
          <div className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
            <p className="flex items-center gap-1.5 font-semibold text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" /> Já tem chamado com entrega nesse mesmo dia
            </p>
            <ul className="space-y-0.5 text-muted-foreground">
              {mesmaData.map((c) => (
                <li key={c.id} className="line-clamp-2 break-words"><span className="font-mono font-semibold">#{c.numero}</span> {c.assunto}</li>
              ))}
            </ul>
            <p className="text-muted-foreground">O ideal é cada chamado ter a sua data. Se preferir manter, pode seguir assim mesmo.</p>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={salvando}>Voltar</Button>
          <Button className="gap-1.5" onClick={() => salvar()} disabled={!chamado || salvando || (pedePrazo && !prazoOk)}>
            {modo === "iniciar" ? <PlayCircle className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
            {salvando ? "Salvando…" : titulo}
          </Button>
        </div>
      </DialogContent>

      <AlertDialog open={!!confirmarMesmaData} onOpenChange={(v) => { if (!v) setConfirmarMesmaData(null); }}>
        <AlertDialogContent className="max-w-md [&>*]:min-w-0">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0 text-warning" /> Você já tem entrega nesse dia
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  A previsão do #{chamado?.numero} cai em{" "}
                  <b>{previsao ? (unidadeEfetiva === "horas" ? fmtDataHora(previsao.toISOString()) : fmtData(previsao.toISOString())) : "—"}</b>,
                  o mesmo dia de:
                </p>
                <ul className="space-y-0.5 rounded-md border border-warning/40 bg-warning/10 p-2.5 text-xs">
                  {(confirmarMesmaData ?? []).map((c) => (
                    <li key={c.id} className="line-clamp-2 break-words"><span className="font-mono font-semibold">#{c.numero}</span> {c.assunto}</li>
                  ))}
                </ul>
                <p>Deseja confirmar mesmo assim?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar e mudar o prazo</AlertDialogCancel>
            <AlertDialogAction onClick={() => salvar(true)}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
