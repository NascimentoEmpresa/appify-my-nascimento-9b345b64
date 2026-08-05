import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useItens, LABEL_TIPO_ITEM, type TipoItem } from "@/hooks/useSupCatalogo";
import {
  useMateriaisDoFornecedor, useVincularMaterialFornecedor, useDesvincularMaterialFornecedor,
} from "@/hooks/useSupEstoque";
import { Trash2, Plus, Package } from "lucide-react";

/**
 * Quais materiais do catálogo um fornecedor fornece.
 *
 * O vínculo é com sup_item (o catálogo mestre), não texto livre: assim a
 * entrada de estoque consegue sugerir o fornecedor certo para o material que
 * está chegando, e dá para responder "quem fornece botina?" sem depender de
 * alguém ter escrito o nome igual nas duas telas.
 */
export function MateriaisFornecedorDialog({
  fornecedor, onFechar,
}: {
  fornecedor: { id: string; razao_social: string } | null;
  onFechar: () => void;
}) {
  const { data: empresaId } = useEmpresaId();
  const { data: catalogo = [] } = useItens(empresaId ?? null);
  const { data: vinculados = [], isLoading } = useMateriaisDoFornecedor(fornecedor?.id ?? null);
  const vincular = useVincularMaterialFornecedor();
  const desvincular = useDesvincularMaterialFornecedor();

  const [busca, setBusca] = useState("");
  const [codigo, setCodigo] = useState<Record<string, string>>({});

  const jaVinculados = useMemo(
    () => new Set(vinculados.map((v) => v.sup_item_id)),
    [vinculados],
  );

  const disponiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return [];
    return catalogo
      .filter((i) => !jaVinculados.has(i.id) && i.nome.toLowerCase().includes(t))
      .slice(0, 30);
  }, [catalogo, jaVinculados, busca]);

  return (
    <Dialog open={!!fornecedor} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-3xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            Materiais fornecidos
            <span className="text-sm font-normal text-muted-foreground">{fornecedor?.razao_social}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="min-w-0 space-y-4 py-1">
          <div className="min-w-0">
            <Label>Adicionar material do catálogo</Label>
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Digite para buscar: camiseta, botina, luva…"
            />
            {busca.trim() && (
              <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto overflow-x-hidden rounded-md border p-1">
                {disponiveis.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Nenhum material novo com esse nome.
                  </p>
                )}
                {disponiveis.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => {
                      if (!fornecedor) return;
                      vincular.mutate({ fornecedor_id: fornecedor.id, sup_item_id: i.id });
                      setBusca("");
                    }}
                    className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{i.nome}</span>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {LABEL_TIPO_ITEM[i.tipo as TipoItem]}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0">
            <p className="mb-2 text-sm font-semibold">
              Fornece atualmente
              <Badge variant="secondary" className="ml-2 text-[11px]">{vinculados.length}</Badge>
            </p>

            {isLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>
            ) : vinculados.length === 0 ? (
              <p className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                Nenhum material vinculado ainda. Busque acima para adicionar.
              </p>
            ) : (
              <div className="space-y-1">
                {vinculados.map((v) => (
                  <div key={v.id} className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{v.sup_item?.nome ?? "—"}</span>
                    {v.sup_item && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {LABEL_TIPO_ITEM[v.sup_item.tipo as TipoItem]}
                      </Badge>
                    )}
                    <Input
                      value={codigo[v.id] ?? v.codigo_fornecedor ?? ""}
                      onChange={(e) => setCodigo((s) => ({ ...s, [v.id]: e.target.value }))}
                      placeholder="Cód. do fornecedor"
                      className="h-8 w-40 shrink-0 text-xs"
                    />
                    <Button
                      size="icon" variant="ghost"
                      className="h-7 w-7 shrink-0 text-destructive"
                      onClick={() => {
                        if (confirm(`Desvincular "${v.sup_item?.nome}" deste fornecedor?`)) {
                          desvincular.mutate(v.id);
                        }
                      }}
                      aria-label="Desvincular"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Os materiais vêm do Catálogo de Materiais. Se algum não aparecer na busca,
            cadastre-o primeiro lá.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
