import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useConciliacaoPlanilhaPorMes, useDiferencasPlanilhaTodas, lerLinhasPlanilhaDoMes } from "@/hooks/useConciliacaoOrigem";
import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import DiferencasMesDialog from "./DiferencasMesDialog";
import { efeitoDasDiferencas, ponteDaPlanilhaPorMes, ROTULO_SITUACAO_PLANILHA, type BasePonte } from "./regras";

// SIS-2026-0701: mês a mês, a planilha importada (tudo o que subiu) contra o que a tela do Fluxo de Caixa lê como "Excel antigo".
// Serve para conferir o ano inteiro comparando 12 totais com os da planilha, em vez de linha a linha; o número da linha da planilha
// (coluna "Linha na planilha") leva direto à linha do Excel.
const nomeMes = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

export default function PontePlanilhaPorMes({ linhasFluxo }: { linhasFluxo: FluxoCaixaMaloteLinha[] }) {
  const [base, setBase] = useState<BasePonte>("pagamento");
  const [baixando, setBaixando] = useState<string | null>(null);
  const [mesDiferencas, setMesDiferencas] = useState<string | null>(null);
  const { data: planilha } = useConciliacaoPlanilhaPorMes(base);
  const { data: ajustes } = useDiferencasPlanilhaTodas(base);

  const ponte = useMemo(
    () => (planilha ? ponteDaPlanilhaPorMes(planilha, linhasFluxo.filter((l) => l.origem === "importacao_historica"), base) : []),
    [planilha, linhasFluxo, base],
  );
  if (planilha === null) return null; // migration 20261021000045 ainda não aplicada
  const total = ponte.reduce(
    (t, l) => ({
      planilhaEnt: t.planilhaEnt + l.planilha.entradas, planilhaSai: t.planilhaSai + l.planilha.saidas,
      erpEnt: t.erpEnt + l.erpLe.entradas, erpSai: t.erpSai + l.erpLe.saidas,
    }),
    { planilhaEnt: 0, planilhaSai: 0, erpEnt: 0, erpSai: 0 },
  );

  async function baixarMes(mes: string) {
    setBaixando(mes);
    try {
      const linhas = await lerLinhasPlanilhaDoMes(mes, base);
      if (linhas.length === 0) { toast.error("Nenhuma linha da planilha neste mês."); return; }
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas.map((l) => ({
        "Linha na planilha": l.planilha_linha,
        "ID original": l.planilha_id_original ?? "",
        "Situação no ERP": ROTULO_SITUACAO_PLANILHA[l.situacao] ?? l.situacao,
        Tipo: l.tipo === "entrada" ? "Entrada" : "Saída",
        "Data pagamento": l.data_pagamento.split("-").reverse().join("/"),
        Competência: `${l.competencia.slice(5, 7)}/${l.competencia.slice(0, 4)}`,
        Classificação: l.classificacao_texto ?? "",
        Contrato: l.contrato_texto ?? "",
        Descrição: l.descricao ?? "",
        Banco: l.banco_texto ?? "",
        Valor: l.tipo === "entrada" ? l.valor : -l.valor,
        Observação: l.observacao ?? "",
      }))), "Planilha carregada");
      XLSX.writeFile(wb, `Planilha_Fluxo_${mes}_${base}.xlsx`);
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível baixar as linhas.");
    } finally {
      setBaixando(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Ponte: planilha importada × o que o ERP lê, mês a mês</h3>
            <p className="max-w-3xl text-xs text-muted-foreground">
              Compare cada mês com o total da sua planilha (filtre a coluna de data ou de competência no Excel). Em "Fora do uso" ficam as linhas
              que subiram mas o Fluxo não mostra (ocultas porque o ERP já tinha o lançamento, ou excluídas). Em "Dif. em uso × ERP" aparece o
              que mudou depois da carga: valor ajustado no Fluxo ou linha que a tela não lê. Baixe o mês para ver o número da linha no Excel.
            </p>
          </div>
          <Select value={base} onValueChange={(v) => setBase(v as BasePonte)}>
            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pagamento">Mês pela data de pagamento</SelectItem>
              <SelectItem value="competencia">Mês pela competência</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Linhas na planilha</TableHead>
                <TableHead className="text-right">Entradas (planilha)</TableHead>
                <TableHead className="text-right">Saídas (planilha)</TableHead>
                <TableHead className="text-right">Fora do uso (linhas)</TableHead>
                <TableHead className="text-right">Entradas (ERP lê)</TableHead>
                <TableHead className="text-right">Saídas (ERP lê)</TableHead>
                <TableHead className="text-right">Dif. em uso × ERP</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ponte.length === 0 && <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">Sem dados da planilha.</TableCell></TableRow>}
              {ponte.map((l) => {
                const dif = Math.abs(l.difEntradas) > 0.005 || Math.abs(l.difSaidas) > 0.005;
                // O que os ajustes feitos no Fluxo depois da carga explicam desta diferença.
                const efeito = ajustes && dif ? efeitoDasDiferencas(ajustes, l.mes, base) : null;
                const explicada = !!efeito && efeito.qtd > 0 && Math.abs(efeito.entradas - l.difEntradas) < 0.005 && Math.abs(efeito.saidas - l.difSaidas) < 0.005;
                const sobra = efeito ? { e: Math.round((l.difEntradas - efeito.entradas) * 100) / 100, s: Math.round((l.difSaidas - efeito.saidas) * 100) / 100 } : null;
                return (
                  <TableRow key={l.mes}>
                    <TableCell className="font-medium">{nomeMes(l.mes)}</TableCell>
                    <TableCell className="text-right">{l.planilha.qtd.toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right">{formatBRL(l.planilha.entradas)}</TableCell>
                    <TableCell className="text-right">{formatBRL(l.planilha.saidas)}</TableCell>
                    <TableCell className="text-right">{l.foraDoUso.qtd > 0 ? `${l.foraDoUso.qtd.toLocaleString("pt-BR")} · ${formatBRL(l.foraDoUso.entradas - l.foraDoUso.saidas)}` : "—"}</TableCell>
                    <TableCell className="text-right">{formatBRL(l.erpLe.entradas)}</TableCell>
                    <TableCell className="text-right">{formatBRL(l.erpLe.saidas)}</TableCell>
                    <TableCell className={`text-right ${!dif || explicada ? "text-emerald-700 dark:text-emerald-300" : "font-medium text-amber-700 dark:text-amber-300"}`}>
                      {!dif ? "confere" : (
                        <button type="button" className="text-right underline decoration-dotted underline-offset-2" onClick={() => setMesDiferencas(l.mes)} title="Ver quais linhas explicam a diferença">
                          {explicada ? `Explicada por ${efeito!.qtd} ajuste(s) no Fluxo` : `${formatBRL(l.difEntradas)} / ${formatBRL(l.difSaidas)}`}
                          <span className="block text-[10px] font-normal">
                            {explicada ? "ver quais →" : sobra && efeito && efeito.qtd > 0 ? `${efeito.qtd} ajuste(s) explicam parte; sobra ${formatBRL(sobra.e)} / ${formatBRL(sobra.s)} →` : "ver quais linhas →"}
                          </span>
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" disabled={baixando === l.mes} onClick={() => baixarMes(l.mes)}>
                        <FileDown className="h-3.5 w-3.5" />{baixando === l.mes ? "Baixando…" : "Linhas"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {ponte.length > 0 && (
                <TableRow className="font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-right">{ponte.reduce((t, l) => t + l.planilha.qtd, 0).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-right">{formatBRL(total.planilhaEnt)}</TableCell>
                  <TableCell className="text-right">{formatBRL(total.planilhaSai)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right">{formatBRL(total.erpEnt)}</TableCell>
                  <TableCell className="text-right">{formatBRL(total.erpSai)}</TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      <DiferencasMesDialog mes={mesDiferencas} base={base} onClose={() => setMesDiferencas(null)} />
    </Card>
  );
}
