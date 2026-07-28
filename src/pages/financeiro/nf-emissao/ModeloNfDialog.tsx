import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ClipboardPaste, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import { ContratoERP } from "@/hooks/useContratosERP";
import { PostoVigente } from "@/hooks/usePlanilhaCusto";
import {
  NfEmissaoModeloRow,
  useModelosNf,
  useItensModeloNf,
  useSalvarModeloNf,
  useSalvarModeloItens,
  useExcluirModeloNf,
  useCriarVariacoesEmLote,
  useImportarVariacoesDoExcel,
} from "@/hooks/useNfEmissaoModelo";
import { INSS_CATEGORIAS, InssCategoria } from "./calculos";
import { parseModeloExcel, VariacaoImportada } from "./importarModeloExcel";

const SEM_POSTO = "__manual__";

interface ItemFormRow {
  posto: string;
  percentual: string;
  identificacao_padrao: string;
  inss_categoria: InssCategoria;
  valorReferencia: string;
}

const ITEM_VAZIO: ItemFormRow = {
  posto: SEM_POSTO,
  percentual: "100",
  identificacao_padrao: "",
  inss_categoria: "normais",
  valorReferencia: "",
};

interface VariacaoForm {
  id?: string;
  variacao: string;
  ordem: string;
  ativo: boolean;
}

const EMPTY_VARIACAO: VariacaoForm = { variacao: "", ordem: "1", ativo: true };

export function ModeloNfDialog({
  open,
  onClose,
  contrato,
  postosVigentes,
}: {
  open: boolean;
  onClose: () => void;
  contrato: ContratoERP;
  postosVigentes: PostoVigente[];
}) {
  const { data: modelos = [] } = useModelosNf(contrato.id);
  const salvarModelo = useSalvarModeloNf();
  const salvarItens = useSalvarModeloItens();
  const excluirModelo = useExcluirModeloNf();
  const criarEmLote = useCriarVariacoesEmLote();
  const importarExcel = useImportarVariacoesDoExcel();

  const [form, setForm] = useState<VariacaoForm>(EMPTY_VARIACAO);
  const { data: itensExistentes = [] } = useItensModeloNf(form.id);
  const [itensForm, setItensForm] = useState<ItemFormRow[]>([ITEM_VAZIO]);
  const [colarOpen, setColarOpen] = useState(false);
  const [colarTexto, setColarTexto] = useState("");
  const [buscaModelo, setBuscaModelo] = useState("");
  const [importando, setImportando] = useState(false);
  const [importPreview, setImportPreview] = useState<(VariacaoImportada & { posto: string; percentual: string })[] | null>(null);

  const modelosFiltrados = useMemo(() => {
    const termo = buscaModelo.trim().toLowerCase();
    if (!termo) return modelos;
    return modelos.filter((m) => (m.variacao ?? "").toLowerCase().includes(termo));
  }, [modelos, buscaModelo]);

  useEffect(() => {
    if (!open) {
      setForm(EMPTY_VARIACAO);
      setItensForm([ITEM_VAZIO]);
      setColarOpen(false);
      setColarTexto("");
      setImportPreview(null);
    }
  }, [open]);

  useEffect(() => {
    if (!form.id) return;
    if (itensExistentes.length === 0) return;
    setItensForm(
      itensExistentes.map((it) => ({
        posto: it.posto ?? SEM_POSTO,
        percentual: String(it.percentual),
        identificacao_padrao: it.identificacao_padrao ?? "",
        inss_categoria: it.inss_categoria,
        valorReferencia: it.ultimo_valor_unitario != null ? String(it.ultimo_valor_unitario) : "",
      }))
    );
  }, [form.id, itensExistentes]);

  function editar(m: NfEmissaoModeloRow) {
    setForm({ id: m.id, variacao: m.variacao ?? "", ordem: String(m.ordem), ativo: m.ativo });
  }

  function novaVariacao() {
    setForm({ ...EMPTY_VARIACAO, ordem: String(modelos.length + 1) });
    setItensForm([ITEM_VAZIO]);
  }

  async function handleColarLista() {
    const nomes = colarTexto
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (nomes.length === 0) {
      toast.error("Cole ao menos uma variação (uma por linha).");
      return;
    }
    try {
      const qtd = await criarEmLote.mutateAsync({
        empresa_id: contrato.empresa_id,
        contrato_id: contrato.id,
        nomes,
        ordemInicial: modelos.length + 1,
      });
      toast.success(`${qtd} variação(ões) criada(s). Vincule posto/% onde fizer sentido.`);
      setColarTexto("");
      setColarOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar variações em lote.");
    }
  }

  async function handleArquivoImport(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (!arquivo) return;
    setImportando(true);
    try {
      const linhas = await parseModeloExcel(arquivo, postosVigentes);
      if (linhas.length === 0) {
        toast.error("Nenhuma variação encontrada nessa planilha.");
        return;
      }
      setImportPreview(linhas.map((l) => ({ ...l, posto: l.postoSugerido ?? SEM_POSTO, percentual: "100" })));
      setColarOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao ler a planilha.");
    } finally {
      setImportando(false);
    }
  }

  function updatePreviewRow(i: number, patch: Partial<{ posto: string; percentual: string }>) {
    setImportPreview((arr) => (arr ? arr.map((r, k) => (k === i ? { ...r, ...patch } : r)) : arr));
  }

  async function handleConfirmarImport() {
    if (!importPreview) return;
    try {
      const qtd = await importarExcel.mutateAsync({
        empresa_id: contrato.empresa_id,
        contrato_id: contrato.id,
        ordemInicial: modelos.length + 1,
        linhas: importPreview.map((r) => ({
          variacao: r.variacao,
          posto: r.posto === SEM_POSTO ? null : r.posto,
          percentual: Number(r.percentual) || 100,
          valorReferencia: r.valorReferencia,
        })),
      });
      toast.success(`${qtd} variação(ões) importada(s). Confira os postos vinculados.`);
      setImportPreview(null);
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao importar.");
    }
  }

  function addItem() {
    setItensForm((arr) => [...arr, ITEM_VAZIO]);
  }
  function removeItem(i: number) {
    setItensForm((arr) => (arr.length > 1 ? arr.filter((_, k) => k !== i) : arr));
  }
  function updateItem(i: number, patch: Partial<ItemFormRow>) {
    setItensForm((arr) => arr.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  }

  async function handleSalvar() {
    if (!form.variacao.trim()) {
      toast.error("Informe o nome da variação (ex: Prédio I).");
      return;
    }
    try {
      const modeloId = await salvarModelo.mutateAsync({
        id: form.id,
        empresa_id: contrato.empresa_id,
        contrato_id: contrato.id,
        variacao: form.variacao.trim(),
        ordem: Number(form.ordem) || 1,
        ativo: form.ativo,
      });
      await salvarItens.mutateAsync({
        modeloId,
        itens: itensForm.map((it) => ({
          posto: it.posto === SEM_POSTO ? null : it.posto,
          percentual: Number(it.percentual) || 100,
          identificacao_padrao: it.identificacao_padrao.trim() || null,
          inss_categoria: it.inss_categoria,
          ultimo_valor_unitario: it.valorReferencia.trim() ? Number(it.valorReferencia) : null,
        })),
      });
      toast.success("Modelo salvo.");
      setForm(EMPTY_VARIACAO);
      setItensForm([ITEM_VAZIO]);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar modelo.");
    }
  }

  async function handleExcluir(id: string) {
    try {
      await excluirModelo.mutateAsync(id);
      toast.success("Variação removida do modelo.");
      if (form.id === id) setForm(EMPTY_VARIACAO);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modelo de NFs — {contrato.nome}</DialogTitle>
          <DialogDescription>
            Cadastre aqui as notas fixas que este contrato emite toda competência (ex: "Prédio I"/"Prédio II"). Ao
            abrir "Nova NF", o analista poderá escolher uma dessas variações e os itens já virão pré-preenchidos a
            partir da planilha de custo vigente. Valores financeiros (VA/VT/materiais/faltas etc.) continuam sendo
            preenchidos manualmente todo mês.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Popular variações em lote</p>
            <div className="flex gap-2">
              <label className="cursor-pointer">
                <input type="file" accept=".xlsm,.xlsx" className="hidden" onChange={handleArquivoImport} disabled={importando} />
                <span className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs font-medium hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" /> {importando ? "Lendo..." : "Importar do Excel"}
                </span>
              </label>
              <Button size="sm" variant="outline" onClick={() => setColarOpen((v) => !v)}>
                <ClipboardPaste className="h-4 w-4 mr-1" /> {colarOpen ? "Cancelar" : "Colar lista"}
              </Button>
            </div>
          </div>

          {colarOpen && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Cole aqui a coluna "Variação" da aba "Lista NFs" da planilha deste contrato — uma por linha. Cria
                todas de uma vez, sem posto vinculado (%, posto e categoria você ajusta depois, editando cada uma).
              </p>
              <Textarea
                rows={6}
                placeholder={"Prédio I\nPrédio II"}
                value={colarTexto}
                onChange={(e) => setColarTexto(e.target.value)}
              />
              <Button size="sm" onClick={handleColarLista} disabled={criarEmLote.isPending}>
                Criar {colarTexto.split("\n").map((l) => l.trim()).filter(Boolean).length || ""} variação(ões)
              </Button>
            </div>
          )}

          {importPreview && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Confira antes de criar: o valor é só uma referência (foto do que estava na planilha), e o posto é uma
                sugestão — ajuste ou deixe "Nenhum (manual)" onde não fizer sentido.
              </p>
              <div className="max-h-[35vh] overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variação</TableHead>
                      <TableHead>Valor de referência</TableHead>
                      <TableHead>Posto sugerido</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{r.variacao}</TableCell>
                        <TableCell className="text-xs">
                          {r.valorReferencia != null
                            ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(r.valorReferencia)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Select value={r.posto} onValueChange={(v) => updatePreviewRow(i, { posto: v })}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SEM_POSTO}>Nenhum (manual)</SelectItem>
                              {postosVigentes.map((p) => (
                                <SelectItem key={p.posto} value={p.posto}>
                                  {p.posto}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleConfirmarImport} disabled={importarExcel.isPending}>
                  Confirmar importação ({importPreview.length})
                </Button>
                <Button size="sm" variant="outline" onClick={() => setImportPreview(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">{form.id ? `Editando: ${form.variacao}` : "Nova variação"}</p>
            {!form.id && (
              <Button size="sm" variant="outline" onClick={novaVariacao}>
                <Plus className="h-4 w-4 mr-1" /> Nova variação
              </Button>
            )}
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <Label className="text-xs">Variação</Label>
              <Input
                placeholder="Ex: Prédio I"
                value={form.variacao}
                onChange={(e) => setForm((f) => ({ ...f, variacao: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Ordem</Label>
              <Input type="number" value={form.ordem} onChange={(e) => setForm((f) => ({ ...f, ordem: e.target.value }))} />
            </div>
            <div className="flex items-end gap-2 pb-1.5">
              <Switch checked={form.ativo} onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: v }))} />
              <Label className="text-xs">Ativo</Label>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Itens (postos que compõem esta nota)</Label>
              <Button size="sm" variant="ghost" onClick={addItem}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Item
              </Button>
            </div>
            {itensForm.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end rounded-lg border p-2">
                <div className="col-span-3">
                  <Label className="text-[10px] text-muted-foreground">Posto</Label>
                  <Select value={it.posto} onValueChange={(v) => updateItem(i, { posto: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SEM_POSTO}>Nenhum (manual)</SelectItem>
                      {postosVigentes.map((p) => (
                        <SelectItem key={p.posto} value={p.posto}>
                          {p.posto}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] text-muted-foreground">% do posto</Label>
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    step="1"
                    value={it.percentual}
                    onChange={(e) => updateItem(i, { percentual: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] text-muted-foreground" title="Referência informativa (não é usada em cálculo automático)">
                    Valor executado (ref.)
                  </Label>
                  <Input
                    className="h-8 text-xs"
                    type="number"
                    step="0.01"
                    placeholder="R$"
                    value={it.valorReferencia}
                    onChange={(e) => updateItem(i, { valorReferencia: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] text-muted-foreground">Rótulo (opcional)</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder={it.posto !== SEM_POSTO ? it.posto : "Descrição do item"}
                    value={it.identificacao_padrao}
                    onChange={(e) => updateItem(i, { identificacao_padrao: e.target.value })}
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-[10px] text-muted-foreground">Categoria INSS</Label>
                  <Select value={it.inss_categoria} onValueChange={(v) => updateItem(i, { inss_categoria: v as InssCategoria })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(INSS_CATEGORIAS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1 flex justify-end">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeItem(i)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSalvar} disabled={salvarModelo.isPending || salvarItens.isPending}>
              {form.id ? <Pencil className="h-4 w-4 mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              {form.id ? "Salvar alterações" : "Adicionar variação"}
            </Button>
            {form.id && (
              <Button size="sm" variant="outline" onClick={() => setForm(EMPTY_VARIACAO)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>

        {modelos.length > 8 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder={`Buscar entre ${modelos.length} variações…`}
              value={buscaModelo}
              onChange={(e) => setBuscaModelo(e.target.value)}
            />
          </div>
        )}

        <div className="rounded-xl border overflow-hidden">
          <div className="max-h-[40vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ordem</TableHead>
                <TableHead>Variação</TableHead>
                <TableHead>Ativo</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {modelosFiltrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6 text-sm">
                    {modelos.length === 0 ? "Nenhuma variação cadastrada ainda para este contrato." : "Nenhuma variação encontrada com esse filtro."}
                  </TableCell>
                </TableRow>
              )}
              {modelosFiltrados.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.ordem}</TableCell>
                  <TableCell className="font-medium">{m.variacao || "-"}</TableCell>
                  <TableCell>
                    <Switch
                      checked={m.ativo}
                      onCheckedChange={(v) =>
                        salvarModelo.mutate({
                          id: m.id,
                          empresa_id: m.empresa_id,
                          contrato_id: m.contrato_id,
                          variacao: m.variacao,
                          ordem: m.ordem,
                          ativo: v,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => editar(m)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleExcluir(m.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
