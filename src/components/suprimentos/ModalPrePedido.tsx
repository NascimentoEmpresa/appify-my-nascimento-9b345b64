import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSugestaoSeparacao, useReservarSeparacao, type ItemSugerido } from "@/hooks/useSupSeparacao";
import { AlertTriangle, MapPin, PackageSearch, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Conferência do pedido e criação do pré-pedido — a tela da supervisora do
 * Estoque.
 *
 * O gerente descreveu o momento exato: "quando chegar para a Isadora, o
 * sistema já vai para o jogo automático; nessa solicitação, a Isadora vai
 * verificar se estiver tudo ok, e ela clica que está ok. Pré-pedido."
 *
 * A sugestão é calculada AO ABRIR (sup_sep_sugerir), nunca guardada. Entre
 * abrir e confirmar, outro operador pode ter levado o lote — recalcular a
 * cada abertura é o que impede reservar o que já não existe.
 *
 * A ordem dos lotes é "CA vencendo primeiro, depois entrada mais antiga", a
 * mesma de sup_est_baixar_quantidade. É o "primeiro que vence, primeiro que
 * sai" que o gerente chamou de "aquela ação do CA que está vencendo".
 */

type Escolhas = Record<string, number>;   // tag_id -> quantidade

export function ModalPrePedido({
  pedidoId, protocolo, aberto, onFechar,
}: {
  pedidoId: string | null;
  protocolo: string | null;
  aberto: boolean;
  onFechar: () => void;
}) {
  const sugestaoQ = useSugestaoSeparacao(aberto ? pedidoId : null);
  const reservar = useReservarSeparacao();
  const [escolhas, setEscolhas] = useState<Escolhas>({});
  const [observacao, setObservacao] = useState("");

  // A sugestão do servidor é o ponto de partida; a supervisora ajusta por cima.
  useEffect(() => {
    const itens = sugestaoQ.data?.itens;
    if (!itens) return;
    const inicial: Escolhas = {};
    for (const it of itens) for (const l of it.lotes) inicial[l.tag_id] = l.quantidade;
    setEscolhas(inicial);
  }, [sugestaoQ.data]);

  const itens = sugestaoQ.data?.itens ?? [];

  const resumo = useMemo(() => {
    let reservando = 0, faltando = 0;
    for (const it of itens) {
      const escolhido = it.lotes.reduce((s, l) => s + (escolhas[l.tag_id] ?? 0), 0);
      reservando += escolhido;
      faltando += Math.max(it.quantidade_pedida - it.ja_resolvido - escolhido, 0);
    }
    return { reservando, faltando };
  }, [itens, escolhas]);

  function confirmar() {
    if (!pedidoId) return;
    const reservas = itens
      .map((it) => ({
        pedido_item_id: it.pedido_item_id,
        lotes: it.lotes
          .filter((l) => (escolhas[l.tag_id] ?? 0) > 0)
          .map((l) => ({ tag_id: l.tag_id, quantidade: escolhas[l.tag_id] })),
      }))
      .filter((r) => r.lotes.length > 0);

    reservar.mutate(
      { pedido_id: pedidoId, reservas, observacao: observacao.trim() || null },
      { onSuccess: () => { setObservacao(""); onFechar(); } },
    );
  }

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Conferir e reservar {protocolo ? <span className="font-mono">{protocolo}</span> : null}
          </DialogTitle>
        </DialogHeader>

        {sugestaoQ.isLoading && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Procurando no estoque…
          </p>
        )}

        {!sugestaoQ.isLoading && itens.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Este pedido não tem itens.
          </p>
        )}

        <div className="space-y-4">
          {itens.map((it) => (
            <ItemDaSugestao
              key={it.pedido_item_id}
              item={it}
              escolhas={escolhas}
              onMudar={(tagId, q) => setEscolhas((e) => ({ ...e, [tagId]: q }))}
            />
          ))}
        </div>

        {itens.length > 0 && (
          <div className="space-y-3 border-t pt-4">
            <div className="space-y-1.5">
              <Label htmlFor="obs-prepedido">Observação (opcional)</Label>
              <Textarea
                id="obs-prepedido"
                rows={2}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                placeholder="Vai para o histórico do pedido."
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Badge variant="secondary">{resumo.reservando} unidade(s) a reservar</Badge>
              {resumo.faltando > 0 && (
                <Badge className="border-orange-400/50 bg-orange-50 text-orange-800 dark:bg-orange-950/30 dark:text-orange-300">
                  <ShoppingCart className="mr-1 h-3 w-3" />
                  {resumo.faltando} sem estoque
                </Badge>
              )}
            </div>

            {resumo.faltando > 0 && (
              <p className="text-xs text-muted-foreground">
                O que não tem saldo não impede o pré-pedido: o pedido segue com o que existe,
                e o restante fica registrado como pendente de compra.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            onClick={confirmar}
            disabled={reservar.isPending || resumo.reservando === 0}
          >
            Confirmar pré-pedido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Um item do pedido com os lotes propostos.
 *
 * Agrupado por MATERIAL de propósito: um item de 5 unidades atendido pelas
 * etiquetas antigas (tipo 'unico', uma peça cada) devolve 5 lotes, e uma
 * lista de cinco linhas quase idênticas seria ilegível para quem confere.
 */
function ItemDaSugestao({
  item, escolhas, onMudar,
}: {
  item: ItemSugerido;
  escolhas: Escolhas;
  onMudar: (tagId: string, quantidade: number) => void;
}) {
  const escolhido = item.lotes.reduce((s, l) => s + (escolhas[l.tag_id] ?? 0), 0);
  const falta = Math.max(item.quantidade_pedida - item.ja_resolvido - escolhido, 0);

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
        <div className="min-w-0">
          <p className="font-medium">
            {item.nome_item}
            {item.tamanho && <span className="ml-2 text-sm text-muted-foreground">({item.tamanho})</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            pedido: {item.quantidade_pedida}
            {item.ja_resolvido > 0 && ` · já resolvido: ${item.ja_resolvido}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{escolhido} selecionada(s)</Badge>
          {falta > 0 && (
            <Badge className="border-orange-400/50 bg-orange-50 text-orange-800 dark:bg-orange-950/30 dark:text-orange-300">
              faltam {falta}
            </Badge>
          )}
        </div>
      </div>

      {item.lotes.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <PackageSearch className="h-4 w-4 shrink-0" />
          {item.ja_resolvido >= item.quantidade_pedida
            ? "Item já atendido."
            : "Sem saldo livre no estoque — este item vai para a fila de compra."}
        </p>
      ) : (
        <div className="divide-y">
          {item.lotes.map((l) => (
            <div key={l.tag_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">{l.codigo}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{l.livre} livre(s)</span>
                  {l.localizacao && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{l.localizacao}
                    </span>
                  )}
                  {l.ca_numero && <span>CA {l.ca_numero}</span>}
                </div>
                {l.alerta && (
                  <p className={cn(
                    "mt-1 inline-flex items-center gap-1 text-xs",
                    "text-amber-700 dark:text-amber-300",
                  )}>
                    <AlertTriangle className="h-3 w-3" />
                    {l.alerta}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`q-${l.tag_id}`} className="text-xs text-muted-foreground">
                  reservar
                </Label>
                <Input
                  id={`q-${l.tag_id}`}
                  type="number"
                  min={0}
                  max={l.livre}
                  value={escolhas[l.tag_id] ?? 0}
                  onChange={(e) =>
                    onMudar(l.tag_id, Math.min(Math.max(Number(e.target.value) || 0, 0), l.livre))
                  }
                  className="w-20"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
