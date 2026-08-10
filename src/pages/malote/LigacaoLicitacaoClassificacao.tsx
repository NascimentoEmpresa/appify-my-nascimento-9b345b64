import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, ArrowUpDown, Info } from "lucide-react";
import { toast } from "sonner";
import {
  useLigacoesLicitacaoClassificacao,
  useSalvarLigacaoLicitacaoClassificacao,
  useExcluirLigacaoLicitacaoClassificacao,
  LigacaoLicitacaoClassificacao,
} from "@/hooks/useMaloteLicitacaoClassificacaoLink";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { CLASSIFICACOES_LICITACAO, labelClassificacaoLicitacao } from "@/lib/planilhaCustoClassificacoes";

type Coluna = "licitacao" | "malote";

interface FormState {
  id?: string;
  campoPlanilhaCusto: string;
  classificacaoMaloteId: string;
}

export function LigacaoLicitacaoClassificacao({ podeEditar }: { podeEditar: boolean }) {
  const { data: ligacoes = [], isLoading } = useLigacoesLicitacaoClassificacao();
  const { data: classificacoesMalote = [] } = useClassificacoesOrcamentoAdmin();
  const salvar = useSalvarLigacaoLicitacaoClassificacao();
  const excluir = useExcluirLigacaoLicitacaoClassificacao();

  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<FormState | null>(null);
  const [ordem, setOrdem] = useState<{ coluna: Coluna; asc: boolean }>({ coluna: "licitacao", asc: true });

  const opcoesLicitacao = CLASSIFICACOES_LICITACAO.map((c) => ({ value: c.campo, label: c.label, hint: c.grupo }));
  const opcoesMalote = classificacoesMalote.map((c) => ({ value: c.id, label: c.nome }));

  const ordenadas = useMemo(() => {
    const copia = [...ligacoes];
    copia.sort((a, b) => {
      const va = ordem.coluna === "licitacao" ? labelClassificacaoLicitacao(a.campo_planilha_custo) : a.classificacao_malote?.nome ?? "";
      const vb = ordem.coluna === "licitacao" ? labelClassificacaoLicitacao(b.campo_planilha_custo) : b.classificacao_malote?.nome ?? "";
      return ordem.asc ? va.localeCompare(vb, "pt-BR") : vb.localeCompare(va, "pt-BR");
    });
    return copia;
  }, [ligacoes, ordem]);

  function alternarOrdem(coluna: Coluna) {
    setOrdem((o) => (o.coluna === coluna ? { coluna, asc: !o.asc } : { coluna, asc: true }));
  }

  function abrirNovo() {
    setEditando({ campoPlanilhaCusto: "", classificacaoMaloteId: "" });
    setOpen(true);
  }

  function abrirEditar(l: LigacaoLicitacaoClassificacao) {
    setEditando({ id: l.id, campoPlanilhaCusto: l.campo_planilha_custo, classificacaoMaloteId: l.classificacao_malote_id });
    setOpen(true);
  }

  async function handleSalvar() {
    if (!editando?.campoPlanilhaCusto) {
      toast.error("Selecione a Classificação Licitação.");
      return;
    }
    if (!editando?.classificacaoMaloteId) {
      toast.error("Selecione a Classificação Malote.");
      return;
    }
    try {
      await salvar.mutateAsync({
        id: editando.id,
        campo_planilha_custo: editando.campoPlanilhaCusto,
        classificacao_malote_id: editando.classificacaoMaloteId,
      });
      toast.success("Ligação salva.");
      setOpen(false);
    } catch (e: any) {
      if (e.code === "23505") {
        toast.error("Essa Classificação Licitação já está vinculada — use editar para alterar.");
      } else {
        toast.error(e.message ?? "Erro ao salvar ligação.");
      }
    }
  }

  async function handleExcluir(id: string) {
    if (!confirm("Excluir esta ligação?")) return;
    try {
      await excluir.mutateAsync(id);
      toast.success("Ligação excluída.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Relações Cadastradas</CardTitle>
          <CardDescription>Gerencie as ligações entre classificações de licitação e classificações do malote.</CardDescription>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={abrirNovo} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Adicionar ligação
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="h-9 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => alternarOrdem("licitacao")}>
                    Classificação Licitação <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="h-9 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => alternarOrdem("malote")}>
                    Classificação Malote <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                {podeEditar && <TableHead className="h-9 py-2 text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && ordenadas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Nenhuma ligação cadastrada ainda.
                  </TableCell>
                </TableRow>
              )}
              {ordenadas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="py-1.5">{labelClassificacaoLicitacao(l.campo_planilha_custo)}</TableCell>
                  <TableCell className="py-1.5">{l.classificacao_malote?.nome ?? "—"}</TableCell>
                  {podeEditar && (
                    <TableCell className="py-1.5 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(l)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExcluir(l.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar ligação" : "Adicionar ligação"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Selecione as classificações para criar a ligação.</p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div>
              <Label>
                Classificação Licitação <span className="text-destructive">*</span>
              </Label>
              <SearchableSelect
                value={editando?.campoPlanilhaCusto ?? ""}
                onChange={(v) => setEditando((s) => (s ? { ...s, campoPlanilhaCusto: v } : s))}
                options={opcoesLicitacao}
                placeholder="Selecione a classificação..."
                searchPlaceholder="Buscar..."
                disabled={!!editando?.id}
              />
            </div>
            <span className="pb-2.5 text-muted-foreground">→</span>
            <div>
              <Label>
                Classificação Malote <span className="text-destructive">*</span>
              </Label>
              <Select
                value={editando?.classificacaoMaloteId ?? ""}
                onValueChange={(v) => setEditando((s) => (s ? { ...s, classificacaoMaloteId: v } : s))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a classificação..." />
                </SelectTrigger>
                <SelectContent>
                  {opcoesMalote.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-muted-foreground">
              Atenção: cada classificação de licitação pode ter apenas uma classificação de malote vinculada. Caso a
              classificação de licitação já esteja na lista de relações cadastradas, utilize a opção editar para
              alterar a classificação do malote. Não é permitido criar mais de uma ligação para a mesma classificação
              de licitação.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSalvar} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Adicionar ligação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
