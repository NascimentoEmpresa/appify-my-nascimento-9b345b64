import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Trash2, Calculator, ChevronDown, ChevronRight } from "lucide-react";
import type { PostoVigente } from "@/hooks/usePlanilhaCusto";
import { ItemInput, ItemCalculado, TotaisNf, PercentuaisFiscais, INSS_CATEGORIAS, InssCategoria } from "./calculos";
import { fmtMoney, fmtPct, Linha } from "./shared";

export type ItemForm = ItemInput & { identificacao: string };

interface ItensNfEditorProps {
  itens: ItemForm[];
  itensCalculados: ItemCalculado[];
  totais: TotaisNf;
  pctFiscais: PercentuaisFiscais | null;
  postosVigentes: PostoVigente[];
  contratoId: string;
  expandidos: Set<number>;
  mostrarPosEmissao?: boolean;
  readOnly?: boolean;
  onUpdateItem: (i: number, patch: Partial<ItemForm>) => void;
  onAddItem: () => void;
  onRemoveItem: (i: number) => void;
  onToggleExpandido: (i: number) => void;
  onSelecionarPosto: (i: number, posto: string) => void;
  onQtdColaboradoresChange: (i: number, novaQtd: number) => void;
}

const CAMPOS_BASE = [
  ["valor_contrato_exec", "Contrato Exec."],
  ["vlr_va", "VA"],
  ["vlr_vt", "VT"],
  ["vlr_materiais", "Materiais"],
  ["faltas", "Faltas"],
  ["posto_nao_implementado", "Posto não impl."],
  ["multas", "Multas"],
  ["glosas", "Glosas"],
  ["outros_descontos", "Outros desc."],
  ["qtd_colaboradores", "Qtd Colab."],
] as const;

const CAMPOS_POS_EMISSAO = [
  ["multas_pos_emissao", "Multas pós-emissão"],
  ["glosas_pos_emissao", "Glosas pós-emissão"],
  ["outros_descontos_pos_emissao", "Outros desc. pós-emissão"],
] as const;

export function ItensNfEditor({
  itens,
  itensCalculados,
  totais,
  pctFiscais,
  postosVigentes,
  contratoId,
  expandidos,
  mostrarPosEmissao,
  readOnly,
  onUpdateItem,
  onAddItem,
  onRemoveItem,
  onToggleExpandido,
  onSelecionarPosto,
  onQtdColaboradoresChange,
}: ItensNfEditorProps) {
  const campos = mostrarPosEmissao ? [...CAMPOS_BASE, ...CAMPOS_POS_EMISSAO] : CAMPOS_BASE;

  return (
    <section className="rounded-xl border bg-card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Itens / Postos</div>
        {!readOnly && (
          <Button type="button" variant="outline" size="sm" onClick={onAddItem}>
            <Plus className="h-4 w-4 mr-1" /> Adicionar item
          </Button>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 px-1" />
              <TableHead className="min-w-[160px] px-2">Posto / Identificação</TableHead>
              <TableHead className="min-w-[110px] px-2">Contrato Exec.</TableHead>
              <TableHead className="min-w-[110px] px-2">Vlr Bruto</TableHead>
              <TableHead className="min-w-[110px] px-2">Vlr Líquido</TableHead>
              <TableHead className="w-8 px-1" />
              <TableHead className="w-8 px-1" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((it, i) => {
              const calc = itensCalculados[i];
              const expandido = expandidos.has(i);
              return (
                <Fragment key={i}>
                  <TableRow>
                    <TableCell className="px-1 py-1">
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onToggleExpandido(i)}>
                        {expandido ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-sm font-medium">{it.identificacao}</TableCell>
                    <TableCell className="px-2 py-1 text-sm">{fmtMoney(it.valor_contrato_exec)}</TableCell>
                    <TableCell className="px-2 py-1 text-sm">{calc ? fmtMoney(calc.vlr_bruto) : "-"}</TableCell>
                    <TableCell className="px-2 py-1 text-sm font-medium">{calc ? fmtMoney(calc.vlr_liquido) : "-"}</TableCell>
                    <TableCell className="px-1 py-1">
                      {calc && pctFiscais && (
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Ver cálculo">
                              <Calculator className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 text-sm space-y-1.5">
                            <p className="font-semibold mb-1">Detalhamento — {it.identificacao}</p>
                            <Linha label="Vlr Contrato Exec." valor={calc.valor_contrato_exec} />
                            <Linha label="Total Descontos" valor={-calc.total_descontos} />
                            <Linha label="Vlr Bruto" valor={calc.vlr_bruto} destaque />
                            <Linha label="Vlr Mão de Obra" valor={calc.vlr_mao_obra} />
                            <div className="border-t pt-1.5 space-y-1">
                              <Linha label={`ISSQN (${fmtPct(pctFiscais.issqn_pct)} s/ bruto)`} valor={-calc.issqn} />
                              <Linha
                                label={`INSS (${INSS_CATEGORIAS[it.inss_categoria].label}, ${fmtPct(INSS_CATEGORIAS[it.inss_categoria].pct)} s/ mão de obra)`}
                                valor={-calc.inss}
                              />
                              <Linha label={`IR (${fmtPct(pctFiscais.ir_pct)} s/ bruto)`} valor={-calc.ir} />
                              <Linha label={`COFINS (${fmtPct(pctFiscais.cofins_pct)} s/ bruto)`} valor={-calc.cofins} />
                              <Linha label={`PIS (${fmtPct(pctFiscais.pis_pct)} s/ bruto)`} valor={-calc.pis} />
                              <Linha label={`CSLL (${fmtPct(pctFiscais.csll_pct)} s/ bruto)`} valor={-calc.csll} />
                            </div>
                            <Linha label="Vlr Líquido" valor={calc.vlr_liquido} destaque />
                          </PopoverContent>
                        </Popover>
                      )}
                    </TableCell>
                    <TableCell className="px-1 py-1">
                      {!readOnly && (
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRemoveItem(i)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expandido && (
                    <TableRow>
                      <TableCell colSpan={7} className="bg-muted/20 px-4 py-3">
                        <div className="grid grid-cols-4 gap-3">
                          <div className="col-span-2">
                            <Label className="text-xs">Posto (Planilha de Custo)</Label>
                            <Select value="" onValueChange={(v) => onSelecionarPosto(i, v)} disabled={readOnly || !contratoId || postosVigentes.length === 0}>
                              <SelectTrigger className="h-8">
                                <SelectValue placeholder={contratoId ? "Selecionar posto para autopreencher" : "Selecione o contrato primeiro"} />
                              </SelectTrigger>
                              <SelectContent>
                                {postosVigentes.map((p) => (
                                  <SelectItem key={p.posto} value={p.posto}>
                                    {p.posto} — {fmtMoney(p.valorTotal)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-2">
                            <Label className="text-xs">Identificação</Label>
                            <Input
                              className="h-8"
                              value={it.identificacao}
                              onChange={(e) => onUpdateItem(i, { identificacao: e.target.value })}
                              disabled={readOnly}
                            />
                          </div>
                          {campos.map(([key, label]) => (
                            <div key={key}>
                              <Label className="text-xs">{label}</Label>
                              <Input
                                className="h-8"
                                type="number"
                                step={key === "qtd_colaboradores" ? "1" : "0.01"}
                                value={it[key] || ""}
                                onChange={(e) =>
                                  key === "qtd_colaboradores"
                                    ? onQtdColaboradoresChange(i, Number(e.target.value) || 0)
                                    : onUpdateItem(i, { [key]: Number(e.target.value) || 0 } as any)
                                }
                                disabled={readOnly}
                              />
                            </div>
                          ))}
                          <div className="col-span-2">
                            <Label className="text-xs">Categoria de risco (INSS)</Label>
                            <Select
                              value={it.inss_categoria}
                              onValueChange={(v) => onUpdateItem(i, { inss_categoria: v as InssCategoria })}
                              disabled={readOnly}
                            >
                              <SelectTrigger className="h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {(Object.keys(INSS_CATEGORIAS) as InssCategoria[]).map((k) => (
                                  <SelectItem key={k} value={k}>
                                    {INSS_CATEGORIAS[k].label} ({fmtPct(INSS_CATEGORIAS[k].pct)})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {pctFiscais && (
        <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <span>
            <span className="text-muted-foreground">Bruto total: </span>
            <span className="font-medium">{fmtMoney(totais.vlr_bruto_total)}</span>
          </span>
          <span>
            <span className="text-muted-foreground">ISSQN ({fmtPct(pctFiscais.issqn_pct)}): </span>
            {fmtMoney(totais.issqn_total)}
          </span>
          <span>
            <span className="text-muted-foreground">INSS: </span>
            {fmtMoney(totais.inss_total)}
          </span>
          <span>
            <span className="text-muted-foreground">IR ({fmtPct(pctFiscais.ir_pct)}): </span>
            {fmtMoney(totais.ir_total)}
          </span>
          <span>
            <span className="text-muted-foreground">COFINS ({fmtPct(pctFiscais.cofins_pct)}): </span>
            {fmtMoney(totais.cofins_total)}
          </span>
          <span>
            <span className="text-muted-foreground">PIS ({fmtPct(pctFiscais.pis_pct)}): </span>
            {fmtMoney(totais.pis_total)}
          </span>
          <span>
            <span className="text-muted-foreground">CSLL ({fmtPct(pctFiscais.csll_pct)}): </span>
            {fmtMoney(totais.csll_total)}
          </span>
          <span>
            <span className="text-muted-foreground">Líquido total: </span>
            <span className="font-semibold">{fmtMoney(totais.vlr_liquido_total)}</span>
          </span>
        </div>
      )}
    </section>
  );
}
