import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Eye, Pencil, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { RateioLinha, useJustificarRateioLinha } from "@/hooks/useMaloteDespesa";
import { useEmpresasGrupo, useContratosAtivos, useFornecedoresAtivos, useIntegrantes } from "@/hooks/useMaloteDespesa";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { useMeusContratosAnalista } from "@/hooks/useMaloteAnalistas";
import { TipoClassificacaoOrcamento } from "@/hooks/usePlanejamentoOrcamentario";

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export interface DimensoesRateio {
  empresa: boolean;
  contrato: boolean;
  fornecedor: boolean;
  integrante: boolean;
}

interface ClassificacaoOpcao {
  id: string;
  nome: string;
  tipo?: TipoClassificacaoOrcamento | null;
}

interface RateioGridProps {
  linhas: RateioLinha[];
  onChange: (linhas: RateioLinha[]) => void;
  dimensoes: DimensoesRateio;
  onDimensoesChange: (d: DimensoesRateio) => void;
  ratearPor: "percentual" | "valor";
  onRatearPorChange: (v: "percentual" | "valor") => void;
  valorTotal: number;
  mostrarClassificacao?: boolean;
  classificacoesRateaveis?: ClassificacaoOpcao[];
  distribuirIgualmente?: boolean;
  onDistribuirIgualmenteChange?: (v: boolean) => void;
  disabled?: boolean;
  // SIS-2026-0129: quando true, a coluna Contrato deixa de ser um checkbox
  // manual e passa a ser derivada do tipo da Classificação (por linha, se
  // mostrarClassificacao, ou única, via classificacaoTipoUnica) — ao
  // selecionar o Contrato, a Empresa é preenchida automaticamente.
  contratoPorClassificacao?: boolean;
  classificacaoTipoUnica?: TipoClassificacaoOrcamento | null;
  // Mostra "Total já lançado" / "Restante para ratear" (contra valorTotal) no
  // rodapé, ao lado do "Total do Rateio" — só faz sentido quando valorTotal
  // representa o total da despesa (não usado em RatearClassificacao, que já
  // tem esse resumo no topo da tela).
  mostrarResumoValorTotal?: boolean;
  // SIS-2026-0211 (complemento, pedido do Iury): o solicitante via a grade
  // editável sem nenhuma informação de orçamento — só o aprovador via essas
  // colunas na RateioAprovadorTable (read-only). Passando resolverOrcado a
  // grade acrescenta, por linha, Valor Orçado/Utilizado/Status/Justificativa
  // continuando editável — mesmo cálculo da RateioAprovadorTable. Presença de
  // `resolverOrcado` decide se as colunas aparecem.
  despesaId?: string;
  classificacaoId?: string | null;
  limiteJustificativaPct?: number | null;
  resolverOrcado?: (classificacaoId: string | null | undefined, contratoId: string | null | undefined) => number | null;
  anoMesDespesa?: string;
  podeJustificarComoAprovador?: boolean;
}

export function RateioGrid({
  linhas,
  onChange,
  dimensoes,
  onDimensoesChange,
  ratearPor,
  onRatearPorChange,
  valorTotal,
  mostrarClassificacao,
  classificacoesRateaveis = [],
  distribuirIgualmente,
  onDistribuirIgualmenteChange,
  disabled,
  contratoPorClassificacao,
  classificacaoTipoUnica,
  mostrarResumoValorTotal,
  despesaId,
  classificacaoId,
  limiteJustificativaPct,
  resolverOrcado,
  anoMesDespesa,
  podeJustificarComoAprovador,
}: RateioGridProps) {
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: fornecedores = [] } = useFornecedoresAtivos();
  const { data: integrantes = [] } = useIntegrantes();
  const { data: utilizadoLinhas = [] } = useUtilizadoOrcamento();
  const { data: meusContratosAnalista } = useMeusContratosAnalista();
  const justificar = useJustificarRateioLinha();

  const [dialogLinha, setDialogLinha] = useState<RateioLinha | null>(null);
  const [modoEdicaoJustificativa, setModoEdicaoJustificativa] = useState(false);
  const [textoJustificativa, setTextoJustificativa] = useState("");
  const [salvandoJustificativa, setSalvandoJustificativa] = useState(false);

  const mostrarColunasOrcamento = !!resolverOrcado;

  // Mesmo cálculo de "utilizado antes desta despesa" da RateioAprovadorTable
  // — exclui a própria despesa (senão conta 2x: uma vez pela view, outra
  // pelo valor da linha sendo editada agora).
  const utilizadoAntesPorContrato = useMemo(() => {
    const map = new Map<string, number>();
    if (!mostrarColunasOrcamento) return map;
    for (const u of utilizadoLinhas) {
      if (u.despesa_id === despesaId) continue;
      if (u.classificacao_id !== classificacaoId) continue;
      if (!u.competencia || u.competencia.slice(0, 7) !== anoMesDespesa) continue;
      const chave = u.contrato_id ?? "__sem_contrato__";
      map.set(chave, (map.get(chave) ?? 0) + (Number(u.valor) || 0));
    }
    return map;
  }, [mostrarColunasOrcamento, utilizadoLinhas, despesaId, classificacaoId, anoMesDespesa]);

  function abrirDialogJustificativa(linha: RateioLinha, edicao: boolean) {
    setDialogLinha(linha);
    setModoEdicaoJustificativa(edicao);
    setTextoJustificativa(linha.justificativa_texto ?? "");
  }

  async function salvarJustificativa() {
    if (!dialogLinha?.id) return;
    if (!textoJustificativa.trim()) {
      toast.error("Descreva a justificativa.");
      return;
    }
    setSalvandoJustificativa(true);
    try {
      await justificar.mutateAsync({ linhaId: dialogLinha.id, texto: textoJustificativa.trim() });
      toast.success("Justificativa salva.");
      setDialogLinha(null);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar justificativa.");
    } finally {
      setSalvandoJustificativa(false);
    }
  }

  function tipoClassificacaoDaLinha(linha: RateioLinha): TipoClassificacaoOrcamento | null | undefined {
    if (mostrarClassificacao) {
      return classificacoesRateaveis.find((c) => c.id === linha.classificacao_id)?.tipo;
    }
    return classificacaoTipoUnica;
  }

  function requerContrato(linha: RateioLinha): boolean {
    return contratoPorClassificacao ? tipoClassificacaoDaLinha(linha) === "contrato" : false;
  }

  const colunaContratoAtiva = contratoPorClassificacao
    ? mostrarClassificacao
      ? classificacoesRateaveis.some((c) => c.tipo === "contrato")
      : classificacaoTipoUnica === "contrato"
    : dimensoes.contrato;

  function atualizarContratoDaLinha(idx: number, contratoId: string) {
    const c = contratos.find((ct) => ct.id === contratoId);
    atualizarLinha(idx, { contrato_id: contratoId || null, empresa_id: c?.empresa_id ?? null });
  }

  const mostrarColunaContrato = colunaContratoAtiva;
  const mostrarColunaEmpresa = dimensoes.empresa || (contratoPorClassificacao && colunaContratoAtiva);

  const nenhumaDimensao = !mostrarClassificacao && !dimensoes.empresa && !colunaContratoAtiva && !dimensoes.fornecedor && !dimensoes.integrante;

  const totalRateado = useMemo(() => linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0), [linhas]);
  const percentualRateado = valorTotal > 0 ? (totalRateado / valorTotal) * 100 : 0;

  function atualizarDimensao(campo: keyof DimensoesRateio, valor: boolean) {
    onDimensoesChange({ ...dimensoes, [campo]: valor });
  }

  function adicionarLinha() {
    onChange([
      ...linhas,
      {
        classificacao_id: mostrarClassificacao ? "" : undefined,
        empresa_id: null,
        contrato_id: null,
        fornecedor_id: null,
        integrante_empregado_id: null,
        percentual: null,
        valor: 0,
        ordem: linhas.length,
      },
    ]);
  }

  function removerLinha(idx: number) {
    onChange(linhas.filter((_, i) => i !== idx));
  }

  function atualizarLinha(idx: number, patch: Partial<RateioLinha>) {
    onChange(linhas.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function distribuirValorNaLinha(idx: number, valor: number) {
    const percentual = valorTotal > 0 ? Number(((valor / valorTotal) * 100).toFixed(3)) : 0;
    atualizarLinha(idx, { valor, percentual });
  }

  function distribuirPercentualNaLinha(idx: number, percentual: number) {
    const valor = Number(((valorTotal * percentual) / 100).toFixed(2));
    atualizarLinha(idx, { valor, percentual });
  }

  function aplicarDistribuicaoIgual() {
    if (linhas.length === 0) return;
    const percentualCada = Number((100 / linhas.length).toFixed(3));
    const valorCada = Number((valorTotal / linhas.length).toFixed(2));
    onChange(
      linhas.map((l, i) => ({
        ...l,
        percentual: percentualCada,
        valor: i === linhas.length - 1 ? Number((valorTotal - valorCada * (linhas.length - 1)).toFixed(2)) : valorCada,
      }))
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">O que deseja ratear? (marque uma ou mais opções)</p>
          <div className="mt-1 flex flex-wrap gap-4">
            {!(contratoPorClassificacao && !mostrarClassificacao && classificacaoTipoUnica === "contrato") && (
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={dimensoes.empresa} onCheckedChange={(c) => atualizarDimensao("empresa", c === true)} disabled={disabled} />
                Empresa
              </label>
            )}
            {contratoPorClassificacao ? (
              colunaContratoAtiva && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Checkbox checked disabled /> Contrato (definido pela classificação)
                </span>
              )
            ) : (
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <Checkbox checked={dimensoes.contrato} onCheckedChange={(c) => atualizarDimensao("contrato", c === true)} disabled={disabled} />
                Contrato
              </label>
            )}
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox checked={dimensoes.fornecedor} onCheckedChange={(c) => atualizarDimensao("fornecedor", c === true)} disabled={disabled} />
              Fornecedor (opcional)
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox checked={dimensoes.integrante} onCheckedChange={(c) => atualizarDimensao("integrante", c === true)} disabled={disabled} />
              Integrante (opcional)
            </label>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <Label className="text-xs">Ratear por</Label>
            <Select value={ratearPor} onValueChange={(v) => onRatearPorChange(v as "percentual" | "valor")}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentual">Percentual (%)</SelectItem>
                <SelectItem value="valor">Valor (R$)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {onDistribuirIgualmenteChange && (
            <label className="flex flex-col items-end gap-1 text-xs cursor-pointer">
              Distribuir igualmente
              <Checkbox
                checked={distribuirIgualmente}
                onCheckedChange={(c) => {
                  onDistribuirIgualmenteChange(c === true);
                  if (c === true) aplicarDistribuicaoIgual();
                }}
                disabled={disabled || linhas.length === 0}
              />
            </label>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {mostrarClassificacao && <TableHead>Classificação *</TableHead>}
              {mostrarColunaEmpresa && <TableHead>Empresa {colunaContratoAtiva && !dimensoes.empresa ? "" : "*"}</TableHead>}
              {mostrarColunaContrato && <TableHead>Contrato *</TableHead>}
              <TableHead>{ratearPor === "percentual" ? "% Rateio *" : "Valor (R$) *"}</TableHead>
              {dimensoes.fornecedor && <TableHead>Fornecedor (opcional)</TableHead>}
              {dimensoes.integrante && <TableHead>Integrante (opcional)</TableHead>}
              {mostrarColunasOrcamento && (
                <>
                  <TableHead className="text-center">Valor orçado (mês)</TableHead>
                  <TableHead className="text-center">Valor utilizado + lançamento (R$)</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-center">Status justificativa</TableHead>
                  <TableHead className="w-20 text-center">Justificativa</TableHead>
                </>
              )}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={
                    2 +
                    Number(mostrarColunaEmpresa) +
                    Number(mostrarColunaContrato) +
                    Number(dimensoes.fornecedor) +
                    Number(dimensoes.integrante) +
                    Number(!!mostrarClassificacao) +
                    (mostrarColunasOrcamento ? 5 : 0)
                  }
                  className="text-center text-muted-foreground py-6"
                >
                  {nenhumaDimensao ? "Marque ao menos uma opção acima para começar." : "Nenhuma linha de rateio ainda."}
                </TableCell>
              </TableRow>
            )}
            {linhas.map((linha, idx) => (
              <TableRow key={idx}>
                {mostrarClassificacao && (
                  <TableCell>
                    <Select
                      value={linha.classificacao_id ?? ""}
                      onValueChange={(v) => {
                        const novoTipo = classificacoesRateaveis.find((c) => c.id === v)?.tipo;
                        atualizarLinha(idx, {
                          classificacao_id: v,
                          ...(contratoPorClassificacao && novoTipo !== "contrato" ? { contrato_id: null, empresa_id: null } : {}),
                        });
                      }}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 w-40 text-xs">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {classificacoesRateaveis.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                )}
                {mostrarColunaEmpresa && (
                  <TableCell>
                    {requerContrato(linha) ? (
                      <p className="h-8 flex items-center text-xs text-muted-foreground">
                        {empresas.find((e) => e.id === linha.empresa_id)?.nome ?? "Derivada do contrato"}
                      </p>
                    ) : dimensoes.empresa ? (
                      <Select value={linha.empresa_id ?? ""} onValueChange={(v) => atualizarLinha(idx, { empresa_id: v })} disabled={disabled}>
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {empresas.map((e) => (
                            <SelectItem key={e.id} value={e.id}>
                              {e.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                )}
                {mostrarColunaContrato && (
                  <TableCell>
                    {contratoPorClassificacao ? (
                      requerContrato(linha) ? (
                        <SearchableSelect
                          value={linha.contrato_id ?? ""}
                          onChange={(v) => atualizarContratoDaLinha(idx, v)}
                          options={contratos.map((c) => ({ value: c.id, label: c.nome }))}
                          placeholder="Selecione..."
                          disabled={disabled}
                          className="w-40"
                          triggerClassName="h-8 text-xs"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )
                    ) : (
                      <Select value={linha.contrato_id ?? ""} onValueChange={(v) => atualizarLinha(idx, { contrato_id: v })} disabled={disabled}>
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {contratos
                            .filter((c) => !linha.empresa_id || c.empresa_id === linha.empresa_id)
                            .map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.nome}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <Input
                    type="number"
                    step="0.01"
                    className="h-8 w-24 text-xs"
                    value={ratearPor === "percentual" ? linha.percentual ?? "" : linha.valor ?? ""}
                    onChange={(e) => {
                      const v = Number(e.target.value) || 0;
                      if (ratearPor === "percentual") distribuirPercentualNaLinha(idx, v);
                      else distribuirValorNaLinha(idx, v);
                    }}
                    disabled={disabled}
                  />
                </TableCell>
                {dimensoes.fornecedor && (
                  <TableCell>
                    <Select
                      value={linha.fornecedor_id ?? "none"}
                      onValueChange={(v) => atualizarLinha(idx, { fornecedor_id: v === "none" ? null : v })}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 w-36 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {fornecedores.map((f) => (
                          <SelectItem key={f.id} value={f.id}>
                            {f.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                )}
                {dimensoes.integrante && (
                  <TableCell>
                    <Select
                      value={linha.integrante_empregado_id ? String(linha.integrante_empregado_id) : "none"}
                      onValueChange={(v) => atualizarLinha(idx, { integrante_empregado_id: v === "none" ? null : Number(v) })}
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8 w-36 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {integrantes.map((i) => (
                          <SelectItem key={i.id} value={String(i.id)}>
                            {i.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                )}
                {mostrarColunasOrcamento &&
                  (() => {
                    const orcado = resolverOrcado!(classificacaoId, linha.contrato_id);
                    const chave = linha.contrato_id ?? "__sem_contrato__";
                    const utilizadoAntes = utilizadoAntesPorContrato.get(chave) ?? 0;
                    const utilizadoComLancamento = utilizadoAntes + (Number(linha.valor) || 0);
                    const dentroDoOrcado = orcado == null ? null : utilizadoComLancamento <= orcado;
                    const percentualLinha = orcado ? (utilizadoComLancamento / orcado) * 100 : null;
                    const precisaJustificar =
                      limiteJustificativaPct != null && percentualLinha != null && percentualLinha > limiteJustificativaPct;
                    const temJustificativa = !!linha.justificativa_texto;
                    const souAnalistaDesseContrato = !!linha.contrato_id && !!meusContratosAnalista?.has(linha.contrato_id);
                    const podeJustificarEstaLinha = souAnalistaDesseContrato || podeJustificarComoAprovador;
                    return (
                      <>
                        <TableCell className="text-center text-xs">{fmtMoney(orcado)}</TableCell>
                        <TableCell className="text-center text-xs">
                          {fmtMoney(utilizadoComLancamento)}
                          {percentualLinha != null && <span className="text-muted-foreground"> ({percentualLinha.toFixed(2)}%)</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center">
                            {dentroDoOrcado == null ? (
                              <span className="text-xs text-muted-foreground">—</span>
                            ) : dentroDoOrcado ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center">
                            {precisaJustificar ? (
                              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                                {temJustificativa ? "Justificada" : "Pendente"}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">N/A</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
                            {temJustificativa && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirDialogJustificativa(linha, false)}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {precisaJustificar && podeJustificarEstaLinha && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirDialogJustificativa(linha, true)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {!temJustificativa && !(precisaJustificar && podeJustificarEstaLinha) && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                      </>
                    );
                  })()}
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removerLinha(idx)} disabled={disabled}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {mostrarColunasOrcamento && (
        <Dialog open={!!dialogLinha} onOpenChange={(open) => !open && setDialogLinha(null)}>
          <DialogContent className="sm:max-w-md p-5">
            <DialogHeader>
              <DialogTitle className="text-base">{modoEdicaoJustificativa ? "Justificar linha do rateio" : "Justificativa"}</DialogTitle>
            </DialogHeader>
            {modoEdicaoJustificativa ? (
              <textarea
                value={textoJustificativa}
                onChange={(e) => setTextoJustificativa(e.target.value.slice(0, 500))}
                placeholder="Descreva o motivo desta linha ultrapassar o limite de justificativa..."
                className="w-full min-h-24 rounded-md border border-input bg-background p-2 text-sm"
                maxLength={500}
                autoFocus
              />
            ) : (
              <p className="text-sm whitespace-pre-wrap">{dialogLinha?.justificativa_texto}</p>
            )}
            {modoEdicaoJustificativa && (
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setDialogLinha(null)} disabled={salvandoJustificativa}>
                  Cancelar
                </Button>
                <Button size="sm" onClick={salvarJustificativa} disabled={salvandoJustificativa}>
                  {salvandoJustificativa ? "Salvando..." : "Salvar justificativa"}
                </Button>
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      )}

      {!disabled && (
        <Button variant="outline" size="sm" onClick={adicionarLinha} disabled={nenhumaDimensao} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Adicionar linha
        </Button>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        {mostrarResumoValorTotal ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>
              Total já lançado:{" "}
              <span className="font-medium text-foreground">
                {totalRateado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (
                {valorTotal ? ((totalRateado / valorTotal) * 100).toFixed(0) : 0}%)
              </span>
            </span>
            <span>
              Restante para ratear:{" "}
              <span className="font-medium text-foreground">
                {Math.max(0, valorTotal - totalRateado).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (
                {valorTotal ? (Math.max(0, (100 * (valorTotal - totalRateado)) / valorTotal)).toFixed(0) : 100}%)
              </span>
            </span>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-6 text-sm font-medium">
          <span>Total do Rateio: {percentualRateado.toFixed(2)}%</span>
          <span>Total: {totalRateado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
        </div>
      </div>
    </div>
  );
}
