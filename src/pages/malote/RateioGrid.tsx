import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2 } from "lucide-react";
import { RateioLinha } from "@/hooks/useMaloteDespesa";
import { useEmpresasGrupo, useContratosAtivos, useFornecedoresAtivos, useIntegrantes } from "@/hooks/useMaloteDespesa";

export interface DimensoesRateio {
  empresa: boolean;
  contrato: boolean;
  fornecedor: boolean;
  integrante: boolean;
}

interface ClassificacaoOpcao {
  id: string;
  nome: string;
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
}: RateioGridProps) {
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: fornecedores = [] } = useFornecedoresAtivos();
  const { data: integrantes = [] } = useIntegrantes();

  const nenhumaDimensao = !dimensoes.empresa && !dimensoes.contrato && !dimensoes.fornecedor && !dimensoes.integrante;

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
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox checked={dimensoes.empresa} onCheckedChange={(c) => atualizarDimensao("empresa", c === true)} disabled={disabled} />
              Empresa
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <Checkbox checked={dimensoes.contrato} onCheckedChange={(c) => atualizarDimensao("contrato", c === true)} disabled={disabled} />
              Contrato
            </label>
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
              {dimensoes.empresa && <TableHead>Empresa *</TableHead>}
              {dimensoes.contrato && <TableHead>Contrato *</TableHead>}
              <TableHead>{ratearPor === "percentual" ? "% Rateio *" : "Valor (R$) *"}</TableHead>
              {dimensoes.fornecedor && <TableHead>Fornecedor (opcional)</TableHead>}
              {dimensoes.integrante && <TableHead>Integrante (opcional)</TableHead>}
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={2 + Number(dimensoes.empresa) + Number(dimensoes.contrato) + Number(dimensoes.fornecedor) + Number(dimensoes.integrante) + Number(!!mostrarClassificacao)}
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
                    <Select value={linha.classificacao_id ?? ""} onValueChange={(v) => atualizarLinha(idx, { classificacao_id: v })} disabled={disabled}>
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
                {dimensoes.empresa && (
                  <TableCell>
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
                  </TableCell>
                )}
                {dimensoes.contrato && (
                  <TableCell>
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

      {!disabled && (
        <Button variant="outline" size="sm" onClick={adicionarLinha} disabled={nenhumaDimensao} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Adicionar linha
        </Button>
      )}

      <div className="flex justify-end gap-6 text-sm font-medium">
        <span>Total do Rateio: {percentualRateado.toFixed(2)}%</span>
        <span>Total: {totalRateado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</span>
      </div>
    </div>
  );
}
