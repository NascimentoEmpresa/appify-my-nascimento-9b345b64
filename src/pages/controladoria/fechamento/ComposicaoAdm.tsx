import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { RUBRICAS, type LigacoesRubrica, type RubricaLigacao } from "../faturamento/regras";
import { useSalvarAjusteAdmClassificacao, useTirarContratoAdm } from "./useAjustesAdm";
import type { ItemDetalheClassificacao } from "./regras";

// O que compõe a coluna Total Desp. Adm do Fechamento, no mesmo formato do "Contratos que compõem esta coluna" do Faturamento: os contratos
// administrativos (dá para tirar e voltar) e as classificações que estão FORA da coluna (dá para adicionar). As classificações que já estão
// na coluna ficam na tabela de cima, com o seletor de rubrica. Tudo vale só no Fechamento.
export interface ComposicaoAdmAberta {
  podeAlterar: boolean;
  globais: LigacoesRubrica | undefined;
  doFechamento: LigacoesRubrica | undefined;
  /** contratos ADMINISTRATIVO que contam na coluna */
  contratos: { id: string; nome: string; valor: number; lancamentos: number }[];
  /** contratos ADMINISTRATIVO que a Controladoria tirou da despesa administrativa do Fechamento */
  contratosFora: { id: string; nome: string; valor: number }[];
  /** classificações com despesa no período que não estão nesta coluna */
  foraDaColuna: ItemDetalheClassificacao[];
}

const LIMITE_FORA = 60;

export function ComposicaoAdmSecoes({ composicao }: { composicao: ComposicaoAdmAberta }) {
  const { podeAlterar, contratos, contratosFora, foraDaColuna } = composicao;
  const tirar = useTirarContratoAdm();
  const salvar = useSalvarAjusteAdmClassificacao();
  const [busca, setBusca] = useState("");

  const foraFiltrada = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return foraDaColuna.filter((i) => !t || i.classificacao.toLowerCase().includes(t));
  }, [foraDaColuna, busca]);

  async function mudarContrato(id: string, tirarDaDespesa: boolean) {
    try {
      await tirar.mutateAsync({ contratoId: id, tirar: tirarDaDespesa });
      toast.success(tirarDaDespesa ? "Contrato tirado da despesa administrativa do Fechamento." : "Contrato voltou a contar na despesa administrativa.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar.");
    }
  }

  async function adicionar(item: ItemDetalheClassificacao, rubrica: RubricaLigacao) {
    const ids = item.classificacaoIds;
    if (ids.length === 0) return;
    try {
      for (const id of ids) await salvar.mutateAsync({ classificacaoId: id, rubrica });
      toast.success(`${item.classificacao} agora conta em ${RUBRICAS.find((r) => r.id === rubrica)?.label ?? rubrica}, só no Fechamento.`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar.");
    }
  }

  return (
    <>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Contratos que compõem esta coluna ({contratos.length.toLocaleString("pt-BR")})</h3>
        <p className="text-[11px] text-muted-foreground">
          Centros de custo "ADMINISTRATIVO - …" das empresas, somados às saídas sem contrato.{" "}
          {podeAlterar ? "Se algum não é despesa administrativa, use “Tirar da despesa adm”: vale só para o Fechamento." : "Quem tem a ação Alterar em “Fechamento: ajustar o Total Desp. Adm” pode tirar ou voltar um contrato."}
        </p>
        <div className="max-h-56 overflow-y-auto rounded-md border">
          <Table className="text-xs tabular-nums">
            <TableBody>
              {contratos.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="break-words">{c.nome}<span className="ml-2 text-muted-foreground">{c.lancamentos} {c.lancamentos === 1 ? "lançamento" : "lançamentos"}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-right">{fmtMoney(c.valor)}</TableCell>
                  <TableCell className="w-px whitespace-nowrap text-right">
                    {podeAlterar && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={tirar.isPending} onClick={() => void mudarContrato(c.id, true)}>Tirar da despesa adm</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {contratos.length === 0 && <TableRow><TableCell colSpan={3} className="py-4 text-center text-muted-foreground">Nenhum contrato administrativo com despesa neste recorte.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>

      {contratosFora.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Contratos tirados desta coluna ({contratosFora.length.toLocaleString("pt-BR")})</h3>
          <div className="max-h-40 overflow-y-auto rounded-md border">
            <Table className="text-xs tabular-nums">
              <TableBody>
                {contratosFora.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="break-words">{c.nome}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-muted-foreground">{fmtMoney(c.valor)}</TableCell>
                    <TableCell className="w-px whitespace-nowrap text-right">
                      {podeAlterar && <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={tirar.isPending} onClick={() => void mudarContrato(c.id, false)}>Voltar a contar</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <h3 className="text-sm font-semibold">Classificações fora desta coluna ({foraDaColuna.length.toLocaleString("pt-BR")})</h3>
          <Input className="h-7 w-48 text-xs" placeholder="Buscar classificação…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Despesa deste período que não entra nesta coluna (marcada “Não é custo”, como transferência, empréstimo ou aplicação, ou em outra coluna).{" "}
          {podeAlterar ? "Para trazer uma para cá, escolha a coluna em “Adicionar em…”: vale só no Fechamento." : "Quem tem a ação Alterar pode adicionar uma classificação à coluna."}
        </p>
        <div className="max-h-56 overflow-y-auto rounded-md border">
          <Table className="text-xs tabular-nums">
            <TableBody>
              {foraFiltrada.slice(0, LIMITE_FORA).map((i) => (
                <TableRow key={i.classificacao}>
                  <TableCell className="break-words">{i.classificacao}<span className="ml-2 text-muted-foreground">{i.lancamentos} {i.lancamentos === 1 ? "lançamento" : "lançamentos"}</span></TableCell>
                  <TableCell className="whitespace-nowrap text-right">{fmtMoney(i.valor)}</TableCell>
                  <TableCell className="w-px whitespace-nowrap text-right">
                    {podeAlterar && i.classificacaoIds.length > 0 && (
                      <Select value="" onValueChange={(v) => void adicionar(i, v as RubricaLigacao)} disabled={salvar.isPending}>
                        <SelectTrigger className="h-7 w-40 text-xs"><SelectValue placeholder="Adicionar em…" /></SelectTrigger>
                        <SelectContent>{RUBRICAS.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
                      </Select>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {foraFiltrada.length === 0 && <TableRow><TableCell colSpan={3} className="py-4 text-center text-muted-foreground">Nenhuma classificação fora da coluna neste recorte.</TableCell></TableRow>}
              {foraFiltrada.length > LIMITE_FORA && <TableRow><TableCell colSpan={3} className="py-2 text-center text-muted-foreground">Mostrando as {LIMITE_FORA} maiores de {foraFiltrada.length}: use a busca para achar as outras.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
