import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { useDecidirJustificativa, useDetalheJustificativa, useResponderJustificativa } from "@/hooks/useJustificativasValor";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { rotuloMes } from "../faturamento/useBaseFaturamento";
import { prazoVencido, ROTULO_EVENTO, ROTULO_STATUS, type Justificativa, type StatusJustificativa } from "./regras";

// SIS-2026-0807: detalhe de uma cobrança. Quem responde (modo "minhas") escreve a explicação; a Controladoria (modo "gestao") encerra, devolve ou
// cancela. Cada movimento aparece na linha do tempo (a tabela de eventos ninguém apaga).

export const COR_STATUS: Record<StatusJustificativa, string> = {
  aberta: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  respondida: "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  encerrada: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  cancelada: "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
};

const dia = (iso: string | null) => (iso ? iso.split("T")[0].split("-").reverse().join("/") : "—");
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

interface Props {
  justificativa: Justificativa | null;
  onClose: () => void;
  modo: "gestao" | "minhas";
  /** Pode agir (responder, na caixa do responsável; encerrar/devolver/cancelar, na gestão). */
  podeAgir: boolean;
  nomeContrato: (id: string) => string;
  nomeUsuario: (id: string | null) => string;
}

export function PainelJustificativa({ justificativa: j, onClose, modo, podeAgir, nomeContrato, nomeUsuario }: Props) {
  const { user } = useAuth();
  const { data: detalhe } = useDetalheJustificativa(j?.id ?? null);
  const responder = useResponderJustificativa();
  const decidir = useDecidirJustificativa();
  const [texto, setTexto] = useState("");
  useEffect(() => { setTexto(""); }, [j?.id, j?.status]);

  if (!j) return null;
  const euSouOResponsavel = !!user && user.id === j.responsavel_id;
  const ocupado = responder.isPending || decidir.isPending;

  async function enviarResposta() {
    if (!j) return;
    if (texto.trim().length < 10) { toast.error("Explique o valor com pelo menos 10 caracteres."); return; }
    try {
      await responder.mutateAsync({ id: j.id, texto: texto.trim() });
      toast.success("Resposta enviada para a Controladoria.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a resposta.");
    }
  }

  async function decisao(acao: "encerrar" | "reabrir" | "cancelar") {
    if (!j) return;
    if (acao !== "encerrar" && !texto.trim()) {
      toast.error(acao === "reabrir" ? "Explique o que falta para devolver." : "Informe o motivo do cancelamento.");
      return;
    }
    try {
      await decidir.mutateAsync({ id: j.id, acao, texto: texto.trim() || null });
      toast.success(acao === "encerrar" ? "Justificativa encerrada." : acao === "reabrir" ? "Devolvida ao responsável." : "Justificativa cancelada.");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    }
  }

  const lancamentos = detalhe?.lancamentos ?? [];
  const eventos = detalhe?.eventos ?? [];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm">{j.numero}</span>
            <Badge className={COR_STATUS[j.status]}>{ROTULO_STATUS[j.status]}</Badge>
            {prazoVencido(j) && <Badge className="bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">Prazo vencido</Badge>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            <p><span className="text-muted-foreground">Contrato:</span> <span className="font-medium">{nomeContrato(j.contrato_id)}</span></p>
            <p><span className="text-muted-foreground">Mês:</span> {rotuloMes(j.mes.slice(0, 7))} ({j.base_leitura === "pagamento" ? "data de pagamento" : "competência"})</p>
            <p><span className="text-muted-foreground">Coluna:</span> <span className="font-medium">{j.coluna_rotulo}</span>{j.valor_referencia !== null && <> · {j.coluna === "margem" ? `${j.valor_referencia.toLocaleString("pt-BR")}%` : fmtMoney(j.valor_referencia)}</>}</p>
            <p><span className="text-muted-foreground">Prazo:</span> {dia(j.prazo)}</p>
            <p><span className="text-muted-foreground">Cobrada por:</span> {nomeUsuario(j.created_by)}</p>
            <p><span className="text-muted-foreground">Responsável:</span> {nomeUsuario(j.responsavel_id)}</p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">O que a Controladoria quer saber</p>
            <p className="whitespace-pre-wrap">{j.pergunta}</p>
          </div>

          {lancamentos.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium">Lançamentos em dúvida ({lancamentos.length})</p>
              <ul className="max-h-48 divide-y overflow-y-auto rounded-md border text-xs">
                {lancamentos.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 px-2 py-1.5">
                    <span className="min-w-0">
                      <span className="font-mono">{l.id_lancamento ?? "sem ID"}</span> · {l.descricao || "sem descrição"}
                      <span className="block text-[11px] text-muted-foreground">{l.classificacao ?? "sem classificação"} · {dia(l.data_pagamento)}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{fmtMoney(l.valor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {j.resposta && (
            <div className="rounded-md border border-sky-300/60 bg-sky-50/60 p-3 dark:bg-sky-950/20">
              <p className="text-[11px] font-medium text-muted-foreground">Resposta de {nomeUsuario(j.responsavel_id)}{j.respondida_em ? ` · ${hora(j.respondida_em)}` : ""}</p>
              <p className="whitespace-pre-wrap">{j.resposta}</p>
            </div>
          )}

          {podeAgir && modo === "minhas" && j.status === "aberta" && euSouOResponsavel && (
            <div className="space-y-2">
              <Label className="text-xs">Sua resposta *</Label>
              <Textarea value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 2000))} placeholder="Explique a origem do valor, o que aconteceu no mês e, se for o caso, o que está errado." />
              <div className="flex justify-end">
                <Button size="sm" onClick={enviarResposta} disabled={ocupado}>{responder.isPending ? "Enviando…" : "Enviar resposta"}</Button>
              </div>
            </div>
          )}

          {podeAgir && modo === "gestao" && (j.status === "respondida" || j.status === "aberta" || j.status === "encerrada") && (
            <div className="space-y-2">
              <Label className="text-xs">Comentário {j.status === "respondida" ? "(obrigatório para devolver ou cancelar)" : "(obrigatório)"}</Label>
              <Textarea value={texto} onChange={(e) => setTexto(e.target.value.slice(0, 1000))} placeholder="O que falta na resposta, ou o motivo do cancelamento." />
              <div className="flex flex-wrap justify-end gap-2">
                {j.status === "respondida" && <Button size="sm" onClick={() => decisao("encerrar")} disabled={ocupado}>Encerrar (resposta ok)</Button>}
                {(j.status === "respondida" || j.status === "encerrada") && <Button size="sm" variant="outline" onClick={() => decisao("reabrir")} disabled={ocupado}>Devolver para nova resposta</Button>}
                {(j.status === "aberta" || j.status === "respondida") && <Button size="sm" variant="ghost" className="text-destructive" onClick={() => decisao("cancelar")} disabled={ocupado}>Cancelar cobrança</Button>}
              </div>
            </div>
          )}

          <div>
            <p className="mb-1 text-xs font-medium">Histórico</p>
            <ol className="space-y-1.5 border-l pl-3 text-xs">
              {eventos.map((e) => (
                <li key={e.id}>
                  <span className="font-medium">{ROTULO_EVENTO[e.tipo]}</span> · {nomeUsuario(e.ator_id)} · <span className="text-muted-foreground">{hora(e.created_at)}</span>
                  {e.texto && <p className="whitespace-pre-wrap text-muted-foreground">{e.texto}</p>}
                </li>
              ))}
              {eventos.length === 0 && <li className="text-muted-foreground">Carregando…</li>}
            </ol>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
