import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, PackageCheck, PackageX, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePermissoes } from "@/context/PermissoesContext";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ESTILO_STATUS } from "@/hooks/useSupPedidos";
import { ModalBaixaPedido, type PedidoParaBaixa } from "@/components/suprimentos/ModalBaixaPedido";

// =====================================================================
// O pedido de materiais do candidato, aberto pelo "Compras" do kanban
// (15/10/2026, mig 20261015000011).
//
// Pablo: "ao clicar em compras no kanban já é pra abrir automaticamente o
// pedido, mostrar o status dele etc.; o compras pode colocar observações,
// atualizar o status". O pedido nasce no envio para SST + COMPRAS; aqui o RH
// acompanha (rec_pedido_candidato — o RH não lê sup_pedido direto) e quem é
// do Compras atualiza status/observação pelo MESMO modal de Pedidos de
// Materiais (ModalBaixaPedido, que também baixa o estoque).
// Admissão "sem pedido" mostra o motivo e se o Compras já deu ciência.
// =====================================================================

const sb = supabase as any;

interface PedidoCandidato {
  dispensado: boolean; dispensa_motivo: string | null; obs_rh: string | null;
  compras_ok: boolean | null; compras_por: string | null; compras_em: string | null; compras_obs: string | null;
  compras_visto_em: string | null; compras_visto_por: string | null;
  pedido: (PedidoParaBaixa & {
    created_at: string; contrato_nome: string | null; posto_nome: string | null; funcao_nome: string | null;
    historico: { acao: string; status_anterior: string | null; status_novo: string | null; observacao: string | null; por: string | null; em: string; campo: string | null }[];
  }) | null;
}

const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");
const rotulo = (s?: string | null) => (s ? ESTILO_STATUS[s]?.rotulo ?? s : "—");

export function usePedidoCandidato(candidatoId: number | null) {
  return useQuery({
    queryKey: ["rec-pedido-candidato", candidatoId],
    enabled: !!candidatoId,
    staleTime: 15_000,
    queryFn: async (): Promise<PedidoCandidato | null> => {
      const { data, error } = await sb.rpc("rec_pedido_candidato", { p_candidato_id: candidatoId });
      if (error) throw error;
      return data ?? null;
    },
  });
}

export function PedidoComprasCandidato({ candidatoId, nome, onFechar }: { candidatoId: number | null; nome?: string; onFechar: () => void }) {
  const qc = useQueryClient();
  const { can } = usePermissoes();
  const podeAtualizar = can("alterar", undefined, "sup_pedidos_materiais");
  const podeAbrirFila = can("visualizar", undefined, "sup_pedidos_materiais");
  const { data, isLoading, error, refetch, isFetching } = usePedidoCandidato(candidatoId);
  const [baixa, setBaixa] = useState<PedidoParaBaixa | null>(null);
  const p = data?.pedido ?? null;
  const est = p ? ESTILO_STATUS[p.status] : null;

  return (
    <>
      <Dialog open={!!candidatoId && !baixa} onOpenChange={(v) => { if (!v) onFechar(); }}>
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Compras — {nome ?? "candidato"}
              {p && <span className="font-mono text-base">{p.pedido_id}</span>}
              {p && <Badge variant="outline" className={est?.classe}>{rotulo(p.status)}</Badge>}
            </DialogTitle>
            <DialogDescription>Pedido de materiais gerado no envio para SST + COMPRAS.</DialogDescription>
          </DialogHeader>

          {isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando o pedido…</p>
            : error ? <p className="text-sm text-destructive">{(error as Error).message}</p>
            : !data ? null : (
              <div className="space-y-4 text-sm">
                {/* Situação do Compras no processo */}
                <div className={`rounded-lg border px-3 py-2 ${data.compras_ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
                  {data.compras_ok
                    ? <>✓ {data.dispensado ? "Compras ciente" : "Compras aprovou"} — {data.compras_por ?? "—"} em {fmt(data.compras_em)}{data.compras_obs ? ` · ${data.compras_obs}` : ""}</>
                    : <>Aguardando o Compras{data.compras_visto_em ? ` · visto por ${data.compras_visto_por ?? "—"} em ${fmt(data.compras_visto_em)}` : " · ainda não visto"}</>}
                </div>

                {data.dispensado && (
                  <div className="flex gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-orange-900">
                    <PackageX className="mt-0.5 h-4 w-4 shrink-0" />
                    <p><b>Nova admissão sem pedido do Compras.</b> Motivo informado pelo Recrutamento: {data.dispensa_motivo ?? "—"}</p>
                  </div>
                )}
                {data.obs_rh && <p className="rounded-lg bg-muted/50 px-3 py-2"><b>Observação do Recrutamento:</b> {data.obs_rh}</p>}

                {!data.dispensado && !p && (
                  <p className="rounded-lg border border-dashed px-3 py-3 text-muted-foreground">
                    Nenhum pedido de materiais ligado a este candidato ainda. Ele é gerado quando o Recrutamento envia para SST + COMPRAS com o enxoval da função.
                  </p>
                )}

                {p && (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <p><span className="text-muted-foreground">Pedido:</span> <b className="font-mono">{p.pedido_id}</b></p>
                      <p><span className="text-muted-foreground">Criado em:</span> {fmt(p.created_at)}</p>
                      <p className="sm:col-span-2"><span className="text-muted-foreground">Contrato / posto / função:</span> {[p.contrato_nome, p.posto_nome, p.funcao_nome].filter(Boolean).join(" › ") || "—"}</p>
                      {p.observacao && <p className="sm:col-span-2"><span className="text-muted-foreground">Observação do Compras:</span> {p.observacao}</p>}
                      {p.observacoes_solicitante && <p className="whitespace-pre-wrap sm:col-span-2"><span className="text-muted-foreground">Obs. do solicitante:</span> {p.observacoes_solicitante}</p>}
                    </div>

                    <div className="rounded-lg border">
                      <p className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Itens</p>
                      {(p.sup_pedido_item ?? []).map((i) => (
                        <div key={i.id} className="flex justify-between gap-2 border-b px-3 py-1.5 last:border-b-0">
                          <span>{i.nome_item}</span>
                          <span className="shrink-0 text-muted-foreground">{i.tamanho ? `Tam. ${i.tamanho} · ` : ""}Qtd. {i.quantidade}</span>
                        </div>
                      ))}
                    </div>

                    <div>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Histórico do pedido</p>
                      <ol className="space-y-2 border-l pl-4">
                        {(p.historico ?? []).map((h, k) => (
                          <li key={k} className="relative">
                            <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                            <p className="font-medium">
                              {h.acao === "CRIADO" ? "Pedido criado"
                                : h.status_novo && h.status_novo !== h.status_anterior ? `${rotulo(h.status_anterior)} → ${rotulo(h.status_novo)}`
                                : h.campo ? `Alterado: ${h.campo}` : h.acao}
                            </p>
                            <p className="text-xs text-muted-foreground">{h.por ?? "—"} · {fmt(h.em)}</p>
                            {h.observacao && <p className="text-xs">{h.observacao}</p>}
                          </li>
                        ))}
                      </ol>
                    </div>
                  </>
                )}

                <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                  <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
                    <RefreshCw className={`mr-1.5 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Atualizar
                  </Button>
                  {p && podeAbrirFila && (
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/app/suprimentos/pedidos-materiais?busca=${encodeURIComponent(p.pedido_id)}`}><ExternalLink className="mr-1.5 h-4 w-4" /> Abrir em Pedidos de Materiais</Link>
                    </Button>
                  )}
                  {p && podeAtualizar && (
                    <Button size="sm" onClick={() => setBaixa(p)}><PackageCheck className="mr-1.5 h-4 w-4" /> Atualizar status / observação</Button>
                  )}
                </div>
              </div>
            )}
        </DialogContent>
      </Dialog>

      {/* O mesmo modal de Pedidos de Materiais: status + observação (+ baixa do estoque). */}
      <ModalBaixaPedido pedido={baixa} onFechar={() => {
        setBaixa(null);
        qc.invalidateQueries({ queryKey: ["rec-pedido-candidato", candidatoId] });
        qc.invalidateQueries({ queryKey: ["rec-pedidos-vaga"] });
      }} />
    </>
  );
}
