import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/PageHeader";
import { PainelOrcamentoCompras } from "./PainelOrcamentoCompras";
import {
  useAtualizarPedidoCompra, useAtualizarValorItemPedido, useCancelarPedidoCompra, useEnviarPedidoCompra,
  usePedidoCompra, usePedidosCompra,
} from "@/hooks/useCompraPedido";
import { baixarPdfPedidoCompra } from "@/lib/suprimentos/pedidoCompraPdf";
import { EnviarPedidoFornecedor } from "@/components/suprimentos/EnviarPedidoFornecedor";
import { obterValorSugeridoUltimoPreco, converterQuantidadeDigitada } from "@/lib/suprimentos/compra";
import { Ban, Download, Eye, Loader2, Search, Send, ShieldAlert } from "lucide-react";

const ROTULOS: Record<string, string> = {
  rascunho: "Rascunho", enviado: "Enviado", aguardando_entrega: "Aguardando entrega",
  entrega_parcial: "Entrega parcial", recebido: "Recebido", cancelado: "Cancelado",
};

const VARIANTES: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  rascunho: "outline", enviado: "default", aguardando_entrega: "default",
  entrega_parcial: "secondary", recebido: "default", cancelado: "destructive",
};

const moeda = (valor: number | null | undefined) =>
  Number(valor ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function PedidosCompraSupply() {
  const [parametros, setParametros] = useSearchParams();
  const { data: pedidos = [], isLoading } = usePedidosCompra();
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("todos");
  const [pedidoId, setPedidoId] = useState<string | null>(parametros.get("pedido"));
  const { data: pedido, isLoading: carregandoPedido, error: erroPedido } = usePedidoCompra(pedidoId);
  const atualizar = useAtualizarPedidoCompra();
  const atualizarValor = useAtualizarValorItemPedido();
  const enviar = useEnviarPedidoCompra();
  const cancelar = useCancelarPedidoCompra();
  const [valoresItens, setValoresItens] = useState<Record<string, string>>({});
  const pedidoValoresSemeado = useRef<string | null>(null);
  const [formulario, setFormulario] = useState({
    local_entrega: "", forma_pagamento: "", condicoes_negociadas: "",
    frete_incluso: false, observacoes: "",
  });

  useEffect(() => {
    if (!pedido) return;
    setFormulario({
      local_entrega: pedido.local_entrega ?? "",
      forma_pagamento: pedido.forma_pagamento ?? "",
      condicoes_negociadas: pedido.condicoes_negociadas ?? "",
      frete_incluso: pedido.frete_incluso,
      observacoes: pedido.observacoes ?? "",
    });
    if (pedidoValoresSemeado.current !== pedido.id) {
      pedidoValoresSemeado.current = pedido.id;
      setValoresItens(Object.fromEntries((pedido.itens ?? []).map((item) => [
        item.id,
        obterValorSugeridoUltimoPreco(item)?.toFixed(2) ?? "",
      ])));
    }
  }, [pedido]);

  const totalEmEdicao = useMemo(() => {
    if (!pedido) return 0;
    return (pedido.itens ?? []).reduce((total, item) => {
      // Mesmo conversor do campo de quantidade: "1.234,56" precisa virar
      // 1234.56, não 0.
      const valor = converterQuantidadeDigitada(valoresItens[item.id] ?? "");
      return total + Number(item.quantidade) * (Number.isFinite(valor) ? valor : 0);
    }, 0);
  }, [pedido, valoresItens]);

  const abrir = (id: string) => {
    setPedidoId(id);
    setParametros({ pedido: id });
  };
  const fechar = () => {
    setPedidoId(null);
    setParametros({});
    pedidoValoresSemeado.current = null;
    setValoresItens({});
  };

  const filtrados = useMemo(() => pedidos.filter((p) => {
    if (status !== "todos" && p.status !== status) return false;
    const termo = `${p.numero} ${p.fornecedor_nome ?? ""}`.toLowerCase();
    return termo.includes(busca.trim().toLowerCase());
  }), [pedidos, busca, status]);

  const kpis = useMemo(() => ({
    total: pedidos.length,
    rascunho: pedidos.filter((p) => p.status === "rascunho").length,
    transito: pedidos.filter((p) => ["enviado", "aguardando_entrega"].includes(p.status)).length,
    parcial: pedidos.filter((p) => p.status === "entrega_parcial").length,
    recebido: pedidos.filter((p) => p.status === "recebido").length,
  }), [pedidos]);

  const pedirCancelamento = () => {
    if (!pedido) return;
    const motivo = window.prompt("Informe o motivo do cancelamento:");
    if (motivo?.trim()) cancelar.mutate({ id: pedido.id, motivo: motivo.trim() });
  };

  const salvarValorItem = (itemId: string, valorAtual: number | null) => {
    const texto = (valoresItens[itemId] ?? "").trim();
    const valor = texto === "" ? null : converterQuantidadeDigitada(texto);
    if (valor !== null && (!Number.isFinite(valor) || valor < 0)) return;
    if (valor === valorAtual || (valor === null && valorAtual === null)) return;
    atualizarValor.mutate({ itemId, valor });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pedidos de Compra"
        subtitle="Pedidos gerados a partir das cotações aprovadas do Malote."
      />

      {/* Fica antes da lista de propósito: a pergunta "posso emitir mais este
          pedido?" precisa ser respondida ANTES de emitir, não depois de rolar
          a página até o fim. */}
      <PainelOrcamentoCompras />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Total", kpis.total], ["Rascunhos", kpis.rascunho], ["Em trânsito", kpis.transito],
          ["Entrega parcial", kpis.parcial], ["Recebidos", kpis.recebido],
        ].map(([rotulo, valor]) => (
          <Card key={String(rotulo)}>
            <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{rotulo}</CardTitle></CardHeader>
            <CardContent><p className="text-2xl font-bold">{valor}</p></CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">{filtrados.length} pedido(s)</CardTitle>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar número ou fornecedor" className="w-72 pl-9" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {Object.entries(ROTULOS).map(([codigo, rotulo]) => (
                  <SelectItem key={codigo} value={codigo}>{rotulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Pedido</TableHead><TableHead>Fornecedor</TableHead>
              <TableHead>Entrega prevista</TableHead><TableHead className="text-right">Valor</TableHead>
              <TableHead>Status</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
              {!isLoading && filtrados.length === 0 && <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">Nenhum pedido encontrado.</TableCell></TableRow>}
              {filtrados.map((p) => (
                <TableRow key={p.id}>
                  <TableCell><div className="font-medium">{p.numero}</div><div className="text-xs text-muted-foreground">{new Date(p.created_at).toLocaleDateString("pt-BR")}</div></TableCell>
                  <TableCell>{p.fornecedor_nome ?? "—"}</TableCell>
                  <TableCell>{p.data_limite_entrega ? new Date(`${p.data_limite_entrega}T12:00:00`).toLocaleDateString("pt-BR") : "—"}</TableCell>
                  <TableCell className="text-right font-medium">{moeda(p.valor_total)}</TableCell>
                  <TableCell><Badge variant={VARIANTES[p.status]}>{ROTULOS[p.status]}</Badge></TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => abrir(p.id)}><Eye className="mr-1 h-4 w-4" />Detalhes</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!pedidoId} onOpenChange={(aberto) => !aberto && fechar()}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Pedido {pedido?.numero ?? ""}</DialogTitle></DialogHeader>
          {carregandoPedido ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : erroPedido || !pedido ? (
            /* Sem este ramo o diálogo girava para sempre quando a consulta
               falhava (RLS, pedido apagado, migration não aplicada) — a pessoa
               ficava olhando o spinner sem nunca saber o motivo. */
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <ShieldAlert className="h-10 w-10 text-destructive" />
              <p className="font-medium">Não foi possível abrir este pedido.</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {(erroPedido as Error)?.message ?? "O pedido não foi encontrado ou você não tem acesso a ele."}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={VARIANTES[pedido.status]}>{ROTULOS[pedido.status]}</Badge>
                <span className="text-sm text-muted-foreground">{pedido.fornecedor_nome}</span>
                <span className="ml-auto text-lg font-bold">
                  {moeda(pedido.status === "rascunho" ? totalEmEdicao : pedido.valor_total)}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div><Label>Local de entrega</Label><Input value={formulario.local_entrega}
                  disabled={pedido.status !== "rascunho"}
                  onChange={(e) => setFormulario({ ...formulario, local_entrega: e.target.value })} /></div>
                <div><Label>Forma de pagamento</Label><Input value={formulario.forma_pagamento}
                  disabled={pedido.status !== "rascunho"}
                  onChange={(e) => setFormulario({ ...formulario, forma_pagamento: e.target.value })} /></div>
                <div className="sm:col-span-2"><Label>Condições negociadas</Label><Textarea value={formulario.condicoes_negociadas}
                  disabled={pedido.status !== "rascunho"}
                  onChange={(e) => setFormulario({ ...formulario, condicoes_negociadas: e.target.value })} /></div>
                <label className="flex items-center gap-2 rounded-md border p-3 text-sm">
                  <input type="checkbox" checked={formulario.frete_incluso} disabled={pedido.status !== "rascunho"}
                    onChange={(e) => setFormulario({ ...formulario, frete_incluso: e.target.checked })} />
                  Frete incluso no valor negociado
                </label>
                <div className="sm:col-span-2"><Label>Observações</Label><Textarea value={formulario.observacoes}
                  disabled={pedido.status !== "rascunho"}
                  onChange={(e) => setFormulario({ ...formulario, observacoes: e.target.value })} /></div>
              </div>

              <Table>
                <TableHeader><TableRow><TableHead>Item / referência de preço</TableHead><TableHead>Qtd.</TableHead><TableHead>Unidade</TableHead><TableHead className="text-right">V. unitário</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader>
                <TableBody>{(pedido.itens ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium">{item.nome_item}</div>
                      {item.tamanho && <div className="text-xs text-muted-foreground">Tamanho: {item.tamanho}</div>}
                      {item.preco_referencia_valor != null ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Última compra: {moeda(item.preco_referencia_valor)} em {item.preco_referencia_em
                            ? new Date(item.preco_referencia_em).toLocaleDateString("pt-BR") : "data não informada"}
                          {item.preco_referencia_fornecedor_nome ? ` · ${item.preco_referencia_fornecedor_nome}` : ""}
                          {item.preco_referencia_valido_ate && (
                            <span className={new Date(`${item.preco_referencia_valido_ate}T23:59:59`) < new Date()
                              ? "ml-1 font-medium text-destructive" : "ml-1 text-emerald-700"}>
                              · válido até {new Date(`${item.preco_referencia_valido_ate}T12:00:00`).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-amber-700">Sem compra anterior: informe o valor negociado.</div>
                      )}
                    </TableCell>
                    <TableCell>{Number(item.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 3 })}</TableCell>
                    <TableCell>{item.unidade ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {pedido.status === "rascunho" ? (
                        <Input className="ml-auto w-32 text-right" inputMode="decimal"
                          aria-label={`Valor unitário de ${item.nome_item}`}
                          value={valoresItens[item.id] ?? ""}
                          onChange={(e) => setValoresItens({
                            ...valoresItens,
                            [item.id]: e.target.value.replace(/[^\d.,]/g, ""),
                          })}
                          onBlur={() => salvarValorItem(item.id, item.valor_unitario)}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
                      ) : moeda(item.valor_unitario)}
                    </TableCell>
                    {/* O campo em edição pode estar vazio ou meio digitado
                        ("1,"), e Number("1,") é NaN — sem a guarda a linha
                        mostrava "R$ NaN" enquanto o total do cabeçalho, que já
                        checava, mostrava 0. */}
                    <TableCell className="text-right font-medium">{moeda(
                      (() => {
                        const unitario = pedido.status === "rascunho"
                          ? converterQuantidadeDigitada(valoresItens[item.id] ?? "")
                          : Number(item.valor_unitario ?? 0);
                        const total = Number(item.quantidade) * unitario;
                        return Number.isFinite(total) ? total : 0;
                      })()
                    )}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
              {pedido.status === "rascunho" && (
                <p className="text-xs text-muted-foreground">
                  O valor é salvo ao sair do campo. O total do pedido é recalculado no banco a partir das linhas.
                </p>
              )}
            </div>
          )}
          <DialogFooter className="flex-wrap gap-2">
            {pedido?.status === "rascunho" && <>
              <Button variant="outline" onClick={() => atualizar.mutate({ id: pedido.id, dados: formulario })} disabled={atualizar.isPending}>Salvar dados</Button>
              {/* Grava o cabecalho ANTES de enviar: sup_compra_atualizar_pedido
                  so aceita rascunho, entao o que nao for salvo aqui vira
                  irrecuperavel no instante em que o status muda. */}
              <Button onClick={async () => {
                  await atualizar.mutateAsync({ id: pedido.id, dados: formulario });
                  enviar.mutate(pedido.id);
                }}
                disabled={enviar.isPending || atualizar.isPending || atualizarValor.isPending}>
                <Send className="mr-2 h-4 w-4" />Enviar pedido
              </Button>
            </>}
            {pedido && !["recebido", "cancelado"].includes(pedido.status) && (
              <Button variant="destructive" onClick={pedirCancelamento} disabled={cancelar.isPending}><Ban className="mr-2 h-4 w-4" />Cancelar</Button>
            )}
            {pedido && (
              <EnviarPedidoFornecedor
                pedidoId={pedido.id}
                numero={pedido.numero}
                emailSugerido={pedido.fornecedor?.email ?? null}
                // Rascunho ainda não foi emitido e cancelado não vale mais:
                // mandar qualquer um dos dois ao fornecedor confundiria mais
                // do que ajudaria. A RPC também recusa — isto só evita
                // oferecer o que seria negado.
                desabilitado={["rascunho", "cancelado"].includes(pedido.status)}
              />
            )}
            {pedido && <Button variant="outline" onClick={() => baixarPdfPedidoCompra(pedido)}><Download className="mr-2 h-4 w-4" />Baixar PDF</Button>}
            <Button variant="outline" onClick={fechar}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
