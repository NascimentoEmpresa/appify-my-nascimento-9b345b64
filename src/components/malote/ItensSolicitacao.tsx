import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useItens, LABEL_TIPO_ITEM, type TipoItem } from "@/hooks/useSupCatalogo";
import { type ItemSolicitacao } from "@/hooks/useMaloteDespesa";
import { Plus, Trash2, Search, Package, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { converterQuantidadeDigitada } from "@/lib/suprimentos/compra";

/**
 * Os itens de uma solicitação de compra (SIS-2026-0207).
 *
 * Antes a solicitação era um valor único e um texto corrido, e o comprador
 * cotava lendo a descrição. O gerente de Suprimentos pediu a lista puxando do
 * catálogo:
 *
 *   "Quando ele chegar na parte dos materiais, dos itens, já puxado o nosso
 *    próprio banco de dados, os itens que nós temos cadastrados."
 *
 * Mas nem tudo está no catálogo, e isso é previsto — "surgiu um tapete lá na
 * licitação, nunca comprei um tapete". Por isso cada linha aceita dois modos:
 * escolher do catálogo (o normal) ou digitar a descrição (o tapete). O que
 * muda entre eles é só a presença de `sup_item_id`; o resto do fluxo trata
 * igual.
 *
 * O mesmo componente serve os dois lados: o solicitante monta a lista, e o
 * comprador vê em modo leitura na tela de cotação. A precificação item a item
 * acontece exclusivamente no Pedido de Compra.
 */

const UNIDADES = ["UN", "CX", "PC", "PAR", "KG", "L", "M", "M²", "RL", "FD"];

const LINHA_VAZIA: ItemSolicitacao = {
  sup_item_id: null, nome_item: "", quantidade: 1, unidade: "UN",
  tamanho: null, observacao: null,
};

export function ItensSolicitacao({
  itens, onChange, editavel = true,
}: {
  itens: ItemSolicitacao[];
  onChange?: (itens: ItemSolicitacao[]) => void;
  editavel?: boolean;
}) {
  const { data: empresaId } = useEmpresaId();
  const { data: catalogo = [] } = useItens(empresaId ?? null);

  const alterar = (i: number, patch: Partial<ItemSolicitacao>) =>
    onChange?.(itens.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const remover = (i: number) => onChange?.(itens.filter((_, j) => j !== i));
  const adicionar = () => onChange?.([...itens, { ...LINHA_VAZIA }]);

  if (!editavel && itens.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Esta solicitação não listou itens — o que foi pedido está na descrição.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {itens.length === 0 ? (
        <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          Nenhum item ainda. Liste o que precisa ser comprado — é o que o
          comprador vai cotar.
        </p>
      ) : (
        <div className="space-y-2">
          {itens.map((item, i) => (
            <div key={item.id ?? i} className="rounded-md border p-2">
              {editavel ? (
                <div className="space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <SeletorMaterial
                        item={item}
                        catalogo={catalogo}
                        onEscolher={(patch) => alterar(i, patch)}
                      />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                            onClick={() => remover(i)} aria-label="Remover item">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div>
                      <Label className="text-xs">Quantidade</Label>
                      <CampoQuantidade quantidade={item.quantidade}
                        onFinalizar={(quantidade) => alterar(i, { quantidade })} />
                    </div>
                    <div>
                      <Label className="text-xs">Unidade</Label>
                      <Select value={item.unidade || "UN"} onValueChange={(v) => alterar(i, { unidade: v })}>
                        <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {UNIDADES.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Tamanho</Label>
                      <Input className="mt-1 h-9" value={item.tamanho ?? ""}
                             onChange={(e) => alterar(i, { tamanho: e.target.value || null })}
                             placeholder="opcional" />
                    </div>
                    <div>
                      <Label className="text-xs">Observação</Label>
                      <Input className="mt-1 h-9" value={item.observacao ?? ""}
                             onChange={(e) => alterar(i, { observacao: e.target.value || null })}
                             placeholder="cor, marca…" />
                    </div>
                  </div>
                </div>
              ) : (
                <LinhaLeitura item={item} />
              )}
            </div>
          ))}
        </div>
      )}

      {editavel && (
        <Button type="button" variant="outline" size="sm" onClick={adicionar}>
          <Plus className="mr-2 h-4 w-4" /> Adicionar item
        </Button>
      )}

    </div>
  );
}

function CampoQuantidade({
  quantidade, onFinalizar,
}: {
  quantidade: number;
  onFinalizar: (quantidade: number) => void;
}) {
  const [texto, setTexto] = useState(String(quantidade ?? ""));
  const quantidadeConvertida = converterQuantidadeDigitada(texto);

  useEffect(() => {
    setTexto(String(quantidade ?? ""));
  }, [quantidade]);

  return (
    <>
      <Input className="mt-1 h-9" inputMode="decimal" value={texto}
        aria-invalid={quantidadeConvertida <= 0}
        onChange={(e) => setTexto(e.target.value.replace(/[^\d.,]/g, ""))}
        onBlur={() => onFinalizar(quantidadeConvertida)} />
      {quantidadeConvertida <= 0 && (
        <p className="mt-1 text-xs text-destructive">Informe uma quantidade maior que zero.</p>
      )}
    </>
  );
}

function LinhaLeitura({ item }: { item: ItemSolicitacao }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p className="font-medium">
          {item.nome_item}
          {!item.sup_item_id && (
            <Badge variant="outline" className="ml-2 text-[10px]">fora do catálogo</Badge>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {[
            `${item.quantidade} ${item.unidade}`,
            item.tamanho && `Tam. ${item.tamanho}`,
            item.observacao,
          ].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}

/**
 * Escolhe do catálogo ou digita livre. O botão do lado alterna: quem não
 * achou o material no catálogo não fica preso nele.
 */
function SeletorMaterial({
  item, catalogo, onEscolher,
}: {
  item: ItemSolicitacao;
  catalogo: { id: string; nome: string; tipo: TipoItem }[];
  onEscolher: (patch: Partial<ItemSolicitacao>) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const livre = !item.sup_item_id;

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const base = t ? catalogo.filter((c) => c.nome.toLowerCase().includes(t)) : catalogo;
    return base.slice(0, 50);
  }, [catalogo, busca]);

  if (livre) {
    return (
      <div>
        <Label className="text-xs">Material</Label>
        <div className="mt-1 flex gap-2">
          <Input className="h-9" value={item.nome_item}
                 onChange={(e) => onEscolher({ nome_item: e.target.value })}
                 placeholder="Descreva o que precisa comprar" />
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0"
                  onClick={() => { setAberto(true); }}>
            <Package className="mr-1.5 h-3.5 w-3.5" /> Catálogo
          </Button>
        </div>
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild><span /></PopoverTrigger>
          <PopoverContent className="w-80 p-2" align="start">
            <ListaCatalogo
              busca={busca} setBusca={setBusca} itens={filtrados}
              onEscolher={(c) => {
                onEscolher({ sup_item_id: c.id, nome_item: c.nome, tipo_item: c.tipo });
                setAberto(false);
              }}
            />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <div>
      <Label className="text-xs">Material</Label>
      <div className="mt-1 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-1.5">
        <span className="flex-1 truncate text-sm font-medium">{item.nome_item}</span>
        {item.tipo_item && (
          <Badge variant="secondary" className="text-[10px]">
            {LABEL_TIPO_ITEM[item.tipo_item as TipoItem] ?? item.tipo_item}
          </Badge>
        )}
        <Button type="button" variant="ghost" size="icon" className="h-6 w-6"
                onClick={() => onEscolher({ sup_item_id: null, tipo_item: null })}
                aria-label="Digitar livre">
          <PencilLine className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function ListaCatalogo({
  busca, setBusca, itens, onEscolher,
}: {
  busca: string; setBusca: (v: string) => void;
  itens: { id: string; nome: string; tipo: TipoItem }[];
  onEscolher: (c: { id: string; nome: string; tipo: TipoItem }) => void;
}) {
  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="h-8 pl-8" value={busca} onChange={(e) => setBusca(e.target.value)}
               placeholder="Buscar no catálogo…" autoFocus />
      </div>
      <div className="mt-1 max-h-56 space-y-0.5 overflow-y-auto">
        {itens.map((c) => (
          <button key={c.id} type="button" onClick={() => onEscolher(c)}
                  className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted")}>
            <span className="flex-1 truncate">{c.nome}</span>
            <Badge variant="secondary" className="text-[10px]">{LABEL_TIPO_ITEM[c.tipo]}</Badge>
          </button>
        ))}
        {itens.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nada encontrado. Feche e digite a descrição livre.
          </p>
        )}
      </div>
    </>
  );
}
