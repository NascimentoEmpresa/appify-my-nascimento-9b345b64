import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CampoBipagem } from "@/components/suprimentos/CampoBipagem";
import { STATUS_PEDIDO, ESTILO_STATUS } from "@/hooks/useSupPedidos";
import {
  useTagsDoPedido, useTagsDisponiveis, useSaldoMaterial, useValidarTags, useBaixarPedido,
  type TipoTag, type Baixa,
} from "@/hooks/useSupEstoque";
import { Lock, List, AlertTriangle, Loader2, Tag as TagIcon, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Atualizar status + baixar o estoque do pedido.
 *
 * Espelha o modal do sistema legado (REPLICAR-MODULO-COMPRAS.md §5.6), que é
 * a peça mais complexa daquela tela, com três diferenças deliberadas:
 *
 *   • uma chamada só (sup_est_baixar) grava status e consumo na MESMA
 *     transação. No legado eram duas requisições e, se a segunda falhasse, as
 *     peças já tinham saído do estoque (§12.6);
 *   • o saldo disponível daquele material aparece ao lado de cada item, e a
 *     etiqueta de material errado é recusada — o legado não conferia nada disso;
 *   • as etiquetas são bipadas com pistola (Enter confirma), com a lista de
 *     disponíveis a um clique para quem estiver sem o leitor.
 *
 * Etiqueta já gravada aparece TRAVADA: impede o operador de trocar a etiqueta
 * de uma peça que já saiu do estoque. Só a quantidade do modo massa continua
 * editável, porque é ela que o algoritmo de delta sabe ajustar.
 */

interface ItemPedido {
  id: string; item_id: string | null; nome_item: string;
  tamanho: string | null; quantidade: number; ordem: number;
}
export interface PedidoParaBaixa {
  id: string; pedido_id: string; status: string; observacao: string | null;
  tipo_pedido: string; nome_colaborador: string; observacoes_solicitante: string | null;
  sup_pedido_item: ItemPedido[];
}

/** Estado de edição de um item do pedido dentro do modal. */
interface EstadoItem {
  tipo: TipoTag;
  novos: string[];            // etiquetas bipadas agora
  travadas: { codigo: string; quantidade: number }[]; // já gravadas
  qtdMassa: string;
}

export function ModalBaixaPedido({
  pedido, onFechar,
}: { pedido: PedidoParaBaixa | null; onFechar: () => void }) {
  const { data: jaBaixadas = [], isLoading: carregandoTags } = useTagsDoPedido(pedido?.id ?? null);
  const validar = useValidarTags();
  const baixar = useBaixarPedido();

  const [status, setStatus] = useState("");
  const [observacao, setObservacao] = useState("");
  const [itens, setItens] = useState<Record<string, EstadoItem>>({});
  const [idAtual, setIdAtual] = useState<string | null>(null);
  const [confirmandoSemBaixa, setConfirmandoSemBaixa] = useState(false);

  // Semeia o modal ao abrir/trocar de pedido, reconstruindo o que já foi
  // baixado antes — o legado fazia o mesmo, e é o que evita baixa em dobro.
  const chave = `${pedido?.id ?? ""}|${carregandoTags ? "…" : jaBaixadas.length}`;
  if (pedido && chave !== idAtual && !carregandoTags) {
    setIdAtual(chave);
    setStatus(pedido.status);
    setObservacao(pedido.observacao ?? "");
    const inicial: Record<string, EstadoItem> = {};
    for (const it of pedido.sup_pedido_item ?? []) {
      const doItem = jaBaixadas.filter((t) => t.pedido_item_id === it.id);
      const emMassa = doItem.find((t) => t.tipo === "massa");
      inicial[it.id] = {
        tipo: emMassa ? "massa" : "unico",
        novos: [],
        travadas: doItem.map((t) => ({ codigo: t.codigo, quantidade: t.quantidade })),
        qtdMassa: String(emMassa?.quantidade ?? it.quantidade),
      };
    }
    setItens(inicial);
  }

  const itensPedido = useMemo(
    () => [...(pedido?.sup_pedido_item ?? [])].sort((a, b) => a.ordem - b.ordem),
    [pedido],
  );

  const semBaixa = useMemo(
    () => itensPedido.filter((it) => {
      const e = itens[it.id];
      return !e || (e.travadas.length === 0 && e.novos.length === 0);
    }),
    [itensPedido, itens],
  );

  const alterar = (itemId: string, patch: Partial<EstadoItem>) =>
    setItens((s) => ({ ...s, [itemId]: { ...s[itemId], ...patch } }));

  /** Monta as baixas: etiquetas novas + massa já gravada cuja quantidade mudou. */
  const montarBaixas = (): Baixa[] => {
    const out: Baixa[] = [];
    for (const it of itensPedido) {
      const e = itens[it.id];
      if (!e) continue;
      if (e.tipo === "massa") {
        const qtd = Math.max(Number(e.qtdMassa || 0), 0);
        const codigo = e.novos[0] ?? e.travadas[0]?.codigo;
        if (!codigo) continue;
        const anterior = e.travadas[0]?.quantidade;
        // Só envia se é nova ou se a quantidade mudou — delta 0 não faz nada
        // no banco, mas evitar a ida já deixa a resposta mais limpa.
        if (e.novos.length > 0 || anterior !== qtd) {
          out.push({ pedido_item_id: it.id, codigo, tipo: "massa", quantidade: qtd });
        }
      } else {
        for (const c of e.novos) out.push({ pedido_item_id: it.id, codigo: c, tipo: "unico" });
      }
    }
    return out;
  };

  const enviar = async (pularAvisoDespacho = false) => {
    if (!pedido) return;
    const baixas = montarBaixas();

    const mudouStatus = status !== pedido.status;
    const mudouObs = (observacao || "") !== (pedido.observacao || "");
    if (!mudouStatus && !mudouObs && baixas.length === 0) {
      toast.info("Nada mudou.");
      return;
    }

    // Despachar com item sem etiqueta avisa, mas não trava — decisão de produto.
    if (!pularAvisoDespacho && status === "DESPACHADO" && semBaixa.length > 0) {
      setConfirmandoSemBaixa(true);
      return;
    }

    // Valida ANTES de tocar no estoque (§6.8): assim o operador vê o motivo
    // exato e nada é gravado pela metade.
    if (baixas.length > 0) {
      const novos = baixas.filter((b) =>
        itens[b.pedido_item_id]?.novos.includes(b.codigo));
      if (novos.length > 0) {
        const res = await validar.mutateAsync({
          codigos: novos.map((b) => b.codigo),
          pedido_id: pedido.id,
        });
        const ruins = res.filter((r) => !r.valido);
        if (ruins.length > 0) {
          toast.error("Etiqueta inválida — nada foi baixado.", {
            description: ruins.map((r) => `${r.codigo}: ${r.motivo}`).join(" · "),
            duration: 12000,
          });
          return;
        }
      }
    }

    await baixar.mutateAsync({
      pedido_id: pedido.id,
      status,
      observacao: observacao || null,
      baixas,
    });
    setConfirmandoSemBaixa(false);
    setIdAtual(null);
    onFechar();
  };

  const ocupado = validar.isPending || baixar.isPending;

  return (
    <>
      <Dialog open={!!pedido && !confirmandoSemBaixa} onOpenChange={(o) => { if (!o) { setIdAtual(null); onFechar(); } }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Atualizar pedido
              <span className="font-mono text-sm">{pedido?.pedido_id}</span>
              <Badge variant="secondary" className="uppercase">{pedido?.tipo_pedido}</Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-1">
            {/* Contexto */}
            <div className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                <span><span className="text-muted-foreground">Colaborador: </span>{pedido?.nome_colaborador || "—"}</span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">Status atual:</span>
                  <Badge variant="outline" className={cn(ESTILO_STATUS[pedido?.status ?? ""]?.classe)}>
                    {ESTILO_STATUS[pedido?.status ?? ""]?.rotulo ?? pedido?.status}
                  </Badge>
                </span>
              </div>
              {pedido?.observacoes_solicitante && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50/60 p-2 text-xs dark:bg-amber-950/20">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                  <p><strong>Observação do solicitante:</strong> {pedido.observacoes_solicitante}</p>
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Novo status *</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_PEDIDO.map((s) => (
                      <SelectItem key={s} value={s}>{ESTILO_STATUS[s].rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Comentário para o solicitante <span className="text-muted-foreground">(opcional)</span></Label>
                <Textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  rows={2}
                  placeholder="Ex.: falta a botina 42, prazo de 5 dias."
                />
              </div>
            </div>

            {/* Baixa de estoque */}
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                <TagIcon className="h-4 w-4 text-muted-foreground" />
                Etiquetas do estoque
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </p>
              <p className="mb-3 text-xs text-muted-foreground">
                Bipe a etiqueta de cada peça para dar baixa. O campo aceita o leitor de código
                de barras — cada leitura confirma com Enter.
              </p>

              {carregandoTags ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Carregando etiquetas…</p>
              ) : (
                <div className="space-y-3">
                  {itensPedido.map((it) => (
                    <BlocoItem
                      key={it.id}
                      item={it}
                      estado={itens[it.id]}
                      onAlterar={(patch) => alterar(it.id, patch)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setIdAtual(null); onFechar(); }}>Cancelar</Button>
            <Button disabled={ocupado} onClick={() => enviar()}>
              {ocupado ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</> : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Despacho com item sem baixa: avisa, mas deixa seguir. */}
      <Dialog open={confirmandoSemBaixa} onOpenChange={(o) => !o && setConfirmandoSemBaixa(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Despachar sem baixa completa?</DialogTitle></DialogHeader>
          <div className="flex items-start gap-3 py-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="text-sm">
              <p>
                <strong>{semBaixa.length}</strong> de <strong>{itensPedido.length}</strong> itens
                não têm etiqueta atribuída:
              </p>
              <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                {semBaixa.map((it) => <li key={it.id}>{it.nome_item}</li>)}
              </ul>
              <p className="mt-2 text-muted-foreground">
                O pedido sai sem registro de qual peça foi entregue. Dá para despachar assim mesmo.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmandoSemBaixa(false)}>Voltar e baixar</Button>
            <Button disabled={ocupado} onClick={() => enviar(true)}>Despachar assim mesmo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Uma sub-seção por item do pedido, com saldo, modo e leitura das etiquetas. */
function BlocoItem({
  item, estado, onAlterar,
}: {
  item: ItemPedido;
  estado: EstadoItem | undefined;
  onAlterar: (patch: Partial<EstadoItem>) => void;
}) {
  const { data: saldo } = useSaldoMaterial(item.item_id, item.tamanho);
  const { data: disponiveis = [] } = useTagsDisponiveis(item.item_id, item.tamanho);
  if (!estado) return null;

  const faltam = Math.max(item.quantidade - estado.travadas.length, 0);
  const semEstoque = saldo != null && saldo <= 0;

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-medium">{item.nome_item}</span>
        {item.tamanho && <Badge variant="outline">Tam. {item.tamanho}</Badge>}
        <Badge variant="secondary">{item.quantidade} un. pedida(s)</Badge>
        <Badge
          variant="outline"
          className={cn("ml-auto",
            semEstoque
              ? "border-red-400/50 text-red-600"
              : "border-emerald-400/50 text-emerald-700 dark:text-emerald-300")}
        >
          {saldo == null ? "…" : `${saldo} em estoque`}
        </Badge>
      </div>

      {/* Etiquetas já baixadas: travadas de propósito. */}
      {estado.travadas.length > 0 && (
        <div className="mb-2 space-y-1">
          {estado.travadas.map((t) => (
            <div key={t.codigo}
              className="flex items-center gap-2 rounded-md border border-emerald-400/50 bg-emerald-50 px-2 py-1.5 text-xs dark:bg-emerald-950/30">
              <Lock className="h-3 w-3 shrink-0 text-emerald-600" />
              <span className="font-mono">{t.codigo}</span>
              {estado.tipo === "massa" && <span className="text-muted-foreground">· {t.quantidade} un.</span>}
              <span className="ml-auto text-muted-foreground">já baixada</span>
            </div>
          ))}
        </div>
      )}

      {faltam === 0 && estado.tipo === "unico" ? (
        <p className="text-xs text-muted-foreground">Todas as unidades já foram baixadas.</p>
      ) : (
        <>
          <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_auto]">
            <div>
              <Label className="text-xs">Tipo de etiqueta</Label>
              <Select
                value={estado.tipo}
                // Trocar o modo preserva o que já foi bipado (§5.6).
                onValueChange={(v) => onAlterar({ tipo: v as TipoTag })}
                disabled={estado.travadas.length > 0}
              >
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unico">🔵 Única — 1 etiqueta por peça</SelectItem>
                  <SelectItem value="massa">🟠 Em massa — 1 etiqueta para várias unidades</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {estado.tipo === "massa" && (
              <div>
                <Label className="text-xs">Quantidade</Label>
                <Input
                  type="number" min={0} max={item.quantidade}
                  value={estado.qtdMassa}
                  onChange={(e) => onAlterar({ qtdMassa: e.target.value })}
                  className="h-9 w-28"
                />
              </div>
            )}
          </div>

          <p className="mb-1.5 text-xs text-muted-foreground">
            {estado.tipo === "unico"
              ? `Bipe ${faltam} etiqueta(s), uma por unidade.`
              : "Bipe 1 etiqueta e informe quantas unidades saem dela."}
          </p>

          <CampoBipagem
            codigos={estado.novos}
            onChange={(c) => onAlterar({ novos: c })}
            max={estado.tipo === "massa" ? 1 : faltam}
            autoFoco={false}
          />

          {disponiveis.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="mt-1.5 h-7 text-xs text-muted-foreground">
                  <List className="mr-1.5 h-3.5 w-3.5" /> Escolher da lista ({disponiveis.length} livres)
                </Button>
              </PopoverTrigger>
              <PopoverContent className="max-h-64 w-72 overflow-y-auto p-1">
                {disponiveis.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    disabled={estado.novos.includes(t.codigo)}
                    onClick={() => onAlterar({ novos: [...estado.novos, t.codigo] })}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:opacity-40"
                  >
                    <span className="flex-1 truncate font-mono">{t.codigo}</span>
                    {t.tamanho && <Badge variant="secondary" className="text-[10px]">{t.tamanho}</Badge>}
                    {t.tipo === "massa" && (
                      <Badge variant="outline" className="text-[10px]">{t.quantidade_massa} un.</Badge>
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}

          {semEstoque && (
            <p className="mt-1.5 text-xs text-amber-600">
              Sem saldo deste material no estoque. Dê entrada antes, ou mude o status
              para "Aguardando compra".
            </p>
          )}
        </>
      )}
    </div>
  );
}
