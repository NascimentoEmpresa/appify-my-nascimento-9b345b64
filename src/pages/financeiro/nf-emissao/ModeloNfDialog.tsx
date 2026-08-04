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
import { parseModeloExcel } from "./importarModeloExcel";
import { PostoMultiSelect } from "./PostoMultiSelect";

interface PreviewItemRow {
  valor: number | null;
  postos: string[];
  percentual: string;
}

interface PreviewRow {
  variacao: string;
  itens: PreviewItemRow[];
  descricao: string;
  issqnPctStr: string;
  irPctStr: string;
  cofinsPctStr: string;
  pisPctStr: string;
  csllPctStr: string;
}

interface ItemFormRow {
  postos: string[];
  percentual: string;
  identificacao_padrao: string;
  inss_categoria: InssCategoria;
  valorReferencia: string;
  issqnPct: string;
  irPct: string;
  cofinsPct: string;
  pisPct: string;
  csllPct: string;
}

const ITEM_VAZIO: ItemFormRow = {
  postos: [],
  percentual: "100",
  identificacao_padrao: "",
  inss_categoria: "normais",
  valorReferencia: "",
  issqnPct: "",
  irPct: "",
  cofinsPct: "",
  pisPct: "",
  csllPct: "",
};

interface VariacaoForm {
  id?: string;
  variacao: string;
  ordem: string;
  ativo: boolean;
  issqnPct: string;
  irPct: string;
  cofinsPct: string;
  pisPct: string;
  csllPct: string;
  descricao: string;
}

const EMPTY_VARIACAO: VariacaoForm = {
  variacao: "",
  ordem: "1",
  ativo: true,
  issqnPct: "",
  irPct: "",
  cofinsPct: "",
  pisPct: "",
  csllPct: "",
  descricao: "",
};

// Retenção do modelo é opcional (nulo = usa o padrão do contrato), então "%"
// aqui é sempre string editável, convertida pra fração só na hora de salvar.
const pctToStr = (v: number | null | undefined) => (v ? String(v * 100) : "");
const pctToNum = (v: string) => (v.trim() ? Number(v) / 100 : null);

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
  const [importPreview, setImportPreview] = useState<PreviewRow[] | null>(null);

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
        postos: it.postos && it.postos.length > 0 ? it.postos : it.posto ? [it.posto] : [],
        percentual: String(it.percentual),
        identificacao_padrao: it.identificacao_padrao ?? "",
        inss_categoria: it.inss_categoria,
        valorReferencia: it.ultimo_valor_unitario != null ? String(it.ultimo_valor_unitario) : "",
        issqnPct: pctToStr(it.issqn_pct),
        irPct: pctToStr(it.ir_pct),
        cofinsPct: pctToStr(it.cofins_pct),
        pisPct: pctToStr(it.pis_pct),
        csllPct: pctToStr(it.csll_pct),
      }))
    );
  }, [form.id, itensExistentes]);

  function editar(m: NfEmissaoModeloRow) {
    setForm({
      id: m.id,
      variacao: m.variacao ?? "",
      ordem: String(m.ordem),
      ativo: m.ativo,
      issqnPct: pctToStr(m.issqn_pct),
      irPct: pctToStr(m.ir_pct),
      cofinsPct: pctToStr(m.cofins_pct),
      pisPct: pctToStr(m.pis_pct),
      csllPct: pctToStr(m.csll_pct),
      descricao: m.descricao_padrao ?? "",
    });
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
      setImportPreview(
        linhas.map((l) => ({
          variacao: l.variacao,
          // Uma nota pode juntar vários postos/unidades (ex: Veranópolis) —
          // cada item do Excel vira uma linha própria pra revisão.
          itens: l.itens.map((it) => ({ valor: it.valor, postos: it.posto ? [it.posto] : [], percentual: "100" })),
          descricao: l.descricaoSugerida ?? "",
          issqnPctStr: pctToStr(l.issqnPct),
          irPctStr: pctToStr(l.irPct),
          cofinsPctStr: pctToStr(l.cofinsPct),
          pisPctStr: pctToStr(l.pisPct),
          csllPctStr: pctToStr(l.csllPct),
        }))
      );
      setColarOpen(false);
    } catch (err: any) {
      toast.error(err.message ?? "Erro ao ler a planilha.");
    } finally {
      setImportando(false);
    }
  }

  function updatePreviewRow(
    i: number,
    patch: Partial<{
      descricao: string;
      issqnPctStr: string;
      irPctStr: string;
      cofinsPctStr: string;
      pisPctStr: string;
      csllPctStr: string;
    }>
  ) {
    setImportPreview((arr) => (arr ? arr.map((r, k) => (k === i ? { ...r, ...patch } : r)) : arr));
  }

  function updatePreviewItem(rowIdx: number, itemIdx: number, patch: Partial<PreviewItemRow>) {
    setImportPreview((arr) =>
      arr
        ? arr.map((r, k) =>
            k === rowIdx ? { ...r, itens: r.itens.map((it, ik) => (ik === itemIdx ? { ...it, ...patch } : it)) } : r
          )
        : arr
    );
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
          itens: r.itens.map((it) => ({
            posto: it.postos[0] ?? null,
            postos: it.postos.length > 0 ? it.postos : null,
            percentual: Number(it.percentual) || 100,
            valorReferencia: it.valor,
          })),
          descricao: r.descricao.trim() || null,
          issqnPct: pctToNum(r.issqnPctStr),
          irPct: pctToNum(r.irPctStr),
          cofinsPct: pctToNum(r.cofinsPctStr),
          pisPct: pctToNum(r.pisPctStr),
          csllPct: pctToNum(r.csllPctStr),
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
        issqn_pct: pctToNum(form.issqnPct),
        ir_pct: pctToNum(form.irPct),
        cofins_pct: pctToNum(form.cofinsPct),
        pis_pct: pctToNum(form.pisPct),
        csll_pct: pctToNum(form.csllPct),
        descricao_padrao: form.descricao.trim() || null,
      });
      await salvarItens.mutateAsync({
        modeloId,
        itens: itensForm.map((it) => ({
          posto: it.postos[0] ?? null,
          postos: it.postos.length > 0 ? it.postos : null,
          percentual: Number(it.percentual) || 100,
          identificacao_padrao: it.identificacao_padrao.trim() || null,
          inss_categoria: it.inss_categoria,
          ultimo_valor_unitario: it.valorReferencia.trim() ? Number(it.valorReferencia) : null,
          issqn_pct: pctToNum(it.issqnPct),
          ir_pct: pctToNum(it.irPct),
          cofins_pct: pctToNum(it.cofinsPct),
          pis_pct: pctToNum(it.pisPct),
          csll_pct: pctToNum(it.csllPct),
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
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
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
                Confira antes de criar: valor, posto e retenções são sugestões (foto do que estava na planilha) —
                ajuste ou deixe em branco/"Nenhum (manual)" onde não fizer sentido.
              </p>
              <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Variação</TableHead>
                      <TableHead className="w-64">
                        Itens (valor + posto) <span className="font-normal text-muted-foreground">— uma nota pode ter mais de um</span>
                      </TableHead>
                      <TableHead className="w-48">Descrição</TableHead>
                      <TableHead>Retenções (% — em branco usa o padrão do contrato)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {importPreview.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium align-top pt-2.5">{r.variacao}</TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1.5">
                            {r.itens.map((it, itemIdx) => (
                              <div key={itemIdx} className="flex items-center gap-1.5">
                                <span className="w-20 shrink-0 text-xs">
                                  {it.valor != null
                                    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(it.valor)
                                    : "—"}
                                </span>
                                <PostoMultiSelect
                                  postosVigentes={postosVigentes}
                                  value={it.postos}
                                  onChange={(postos) => updatePreviewItem(i, itemIdx, { postos })}
                                  placeholder="Nenhum (manual)"
                                />
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="align-top">
                          <Textarea
                            className="h-16 text-xs"
                            placeholder="—"
                            value={r.descricao}
                            onChange={(e) => updatePreviewRow(i, { descricao: e.target.value })}
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-wrap gap-1.5">
                            {(
                              [
                                ["ISSQN", "issqnPctStr"],
                                ["IR", "irPctStr"],
                                ["COFINS", "cofinsPctStr"],
                                ["PIS", "pisPctStr"],
                                ["CSLL", "csllPctStr"],
                              ] as const
                            ).map(([label, campo]) => (
                              <div key={campo} className="w-14">
                                <span className="block text-[9px] leading-tight text-muted-foreground">{label}</span>
                                <Input
                                  className="h-7 px-1.5 text-xs"
                                  type="number"
                                  step="0.01"
                                  placeholder="—"
                                  value={r[campo]}
                                  onChange={(e) => updatePreviewRow(i, { [campo]: e.target.value })}
                                />
                              </div>
                            ))}
                          </div>
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

          <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
            <Label className="text-xs">
              Retenção fiscal desta nota <span className="font-normal text-muted-foreground">(opcional — em branco usa o padrão do contrato)</span>
            </Label>
            <div className="grid grid-cols-5 gap-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">ISSQN (%)</Label>
                <Input className="h-8 text-xs" type="number" step="0.01" placeholder="padrão" value={form.issqnPct} onChange={(e) => setForm((f) => ({ ...f, issqnPct: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">IR (%)</Label>
                <Input className="h-8 text-xs" type="number" step="0.01" placeholder="padrão" value={form.irPct} onChange={(e) => setForm((f) => ({ ...f, irPct: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">COFINS (%)</Label>
                <Input className="h-8 text-xs" type="number" step="0.01" placeholder="padrão" value={form.cofinsPct} onChange={(e) => setForm((f) => ({ ...f, cofinsPct: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">PIS (%)</Label>
                <Input className="h-8 text-xs" type="number" step="0.01" placeholder="padrão" value={form.pisPct} onChange={(e) => setForm((f) => ({ ...f, pisPct: e.target.value }))} />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">CSLL (%)</Label>
                <Input className="h-8 text-xs" type="number" step="0.01" placeholder="padrão" value={form.csllPct} onChange={(e) => setForm((f) => ({ ...f, csllPct: e.target.value }))} />
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">
              Descrição <span className="font-normal text-muted-foreground">(opcional — pré-preenche o campo Descrição da NF ao abrir esta variação)</span>
            </Label>
            <Textarea
              rows={3}
              placeholder="Ex: Prestação de serviços de limpeza, conforme contrato nº..."
              value={form.descricao}
              onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Itens (postos que compõem esta nota)</Label>
              <Button size="sm" variant="ghost" onClick={addItem}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Item
              </Button>
            </div>
            {itensForm.map((it, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-2">
              <div className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3">
                  <Label className="text-[10px] text-muted-foreground">Posto(s) — pode juntar mais de um</Label>
                  <PostoMultiSelect
                    postosVigentes={postosVigentes}
                    value={it.postos}
                    onChange={(postos) => updateItem(i, { postos })}
                    placeholder="Nenhum (manual)"
                  />
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
                    placeholder={it.postos.length > 0 ? it.postos.join(" + ") : "Descrição do item"}
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

              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">
                  Retenção própria deste item (opcional — em branco usa o padrão da nota; use quando esse posto tem IR/ISSQN diferente dos demais)
                </Label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["ISSQN", "issqnPct"],
                      ["IR", "irPct"],
                      ["COFINS", "cofinsPct"],
                      ["PIS", "pisPct"],
                      ["CSLL", "csllPct"],
                    ] as const
                  ).map(([label, campo]) => (
                    <div key={campo} className="w-16">
                      <span className="block text-[9px] leading-tight text-muted-foreground">{label} (%)</span>
                      <Input
                        className="h-7 px-1.5 text-xs"
                        type="number"
                        step="0.01"
                        placeholder="padrão"
                        value={it[campo]}
                        onChange={(e) => updateItem(i, { [campo]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
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
                          issqn_pct: m.issqn_pct,
                          ir_pct: m.ir_pct,
                          cofins_pct: m.cofins_pct,
                          pis_pct: m.pis_pct,
                          csll_pct: m.csll_pct,
                          descricao_padrao: m.descricao_padrao,
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
