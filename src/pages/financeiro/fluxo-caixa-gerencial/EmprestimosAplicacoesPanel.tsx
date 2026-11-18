import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AplicacaoFinanceiraLinha } from "@/hooks/useAplicacaoFinanceira";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { baixarExcel, type Celula } from "@/pages/financeiro/conciliacao-servicos/exportarExcel";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { AssinaturaRegra } from "@/pages/malote/AssinaturaRegra";
import { detalheAplicacoes, type LinhaEmprestimo, type PontoNatureza, type SituacaoVencimento, totaisEmprestimos, emprestimosPorInstituicao } from "./emprestimosAplicacoes";
import type { ContaGarantida, MovimentoContaGarantida } from "@/pages/financeiro/conta-garantida/regras";

// SIS-2026-XXXX (etapa 4): Empréstimos (Conta Garantida) por instituição, Aplicações detalhadas e o fluxo SEPARADO por natureza (operacional × empréstimos × aplicações).
const data = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const mesCurto = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
const ROTULO_VENC: Record<SituacaoVencimento, { texto: string; classe: string }> = {
  vencida: { texto: "Vencida", classe: "border-red-300 text-red-700" },
  vence_30: { texto: "Vence em até 30 dias", classe: "border-amber-300 text-amber-700" },
  no_prazo: { texto: "No prazo", classe: "border-emerald-300 text-emerald-700" },
  sem_vencimento: { texto: "Sem vencimento", classe: "text-muted-foreground" },
};

export function EmprestimosAplicacoesPanel({ contas, movimentos, aplicacoes, nomeBanco, filtro, referencia, natureza }: {
  contas: ContaGarantida[];
  movimentos: MovimentoContaGarantida[];
  aplicacoes: AplicacaoFinanceiraLinha[];
  nomeBanco: (bancoId: string) => string;
  filtro: { ini: string; fim: string; empresaId: string };
  referencia: string;
  /** série mensal por natureza (montada na tela, com os recebimentos e despesas do recorte) */
  natureza: PontoNatureza[];
}) {
  const [aba, setAba] = useState<"emprestimos" | "aplicacoes" | "natureza">("emprestimos");
  const emp = useMemo(() => emprestimosPorInstituicao(contas, movimentos, nomeBanco, filtro, referencia), [contas, movimentos, nomeBanco, filtro, referencia]);
  const tot = useMemo(() => totaisEmprestimos(emp.contas), [emp]);
  const apl = useMemo(() => detalheAplicacoes(aplicacoes, filtro, referencia), [aplicacoes, filtro, referencia]);
  const totApl = useMemo(() => ({
    aplicado: apl.linhas.reduce((s, l) => s + l.valorAplicado, 0), rendimento: apl.linhas.reduce((s, l) => s + l.rendimentoAcumulado, 0),
    resgatado: apl.linhas.reduce((s, l) => s + l.resgatadoPrincipal + l.resgatadoRendimento, 0), saldo: apl.linhas.reduce((s, l) => s + l.saldoAtual, 0),
  }), [apl]);

  async function exportar() {
    const cabEmp: Celula[] = ["Instituição", "Conta", "Nº", "Situação", "Limite", "Utilizado (saldo devedor)", "Disponível", "Taxa", "Vencimento", "Utilizações no período", "Amortizações no período", "Juros no período", "Juros total"];
    const cabApl: Celula[] = ["Instituição", "Nº", "Produto", "Descrição", "Aplicação em", "Aplicado", "Rendimento", "Resgatado (principal)", "Resgatado (rendimento)", "Saldo atual", "Vencimento", "Liquidez", "Situação"];
    const cabNat: Celula[] = ["Mês", "Recebimentos operacionais", "Despesas operacionais", "Resultado operacional", "Empréstimo utilizado", "Empréstimo amortizado", "Juros pagos", "Saldo devedor (fim do mês)", "Aplicado", "Resgatado das aplicações", "Rendimentos"];
    await baixarExcel(
      [
        { nome: "Empréstimos", linhas: [cabEmp, ...emp.contas.map((l): Celula[] => [l.instituicao, l.conta, l.numero, l.status, l.limite, l.utilizado, l.disponivel, l.taxa ?? "—", data(l.vencimento), l.utilizacoesNoPeriodo, l.amortizacoesNoPeriodo, l.jurosNoPeriodo, l.jurosTotal])] },
        { nome: "Aplicações", linhas: [cabApl, ...apl.linhas.map((l): Celula[] => [l.instituicao, l.numero, l.produto, l.descricao, data(l.dataAplicacao), l.valorAplicado, l.rendimentoAcumulado, l.resgatadoPrincipal, l.resgatadoRendimento, l.saldoAtual, data(l.vencimento), l.liquidez ?? "—", l.status])] },
        { nome: "Fluxo por natureza", linhas: [cabNat, ...natureza.map((p): Celula[] => [p.mes, p.recebimentosOperacionais, p.despesasOperacionais, p.resultadoOperacional, p.emprestimoUtilizado, p.emprestimoAmortizado, p.jurosPagos, p.saldoDevedorFim, p.aplicado, p.resgatadoAplicacoes, p.rendimentos])] },
      ],
      `emprestimos-aplicacoes-${referencia}.xlsx`,
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base">
          <TituloComFormula alinhar="left" titulo="Empréstimos e Aplicações Financeiras" formula={<><span className="block"><strong>Empréstimos</strong> = Conta Garantida: resgate é utilização do limite (entra no banco), amortização devolve (sai) e juros são encargo pago (sai, sem mexer no saldo devedor). Saldo devedor = resgates − amortizações, o mesmo da tela da Conta Garantida. O limite não utilizado NÃO é caixa próprio.</span><span className="block"><strong>Aplicações</strong>: aplicado, rendimento, resgatado e saldo atual como na tela de Aplicações Financeiras. A liquidez estruturada (carência, D+N) vem na etapa 2.</span><span className="block">Empréstimos e aplicações seguem só o filtro de Empresa.</span><AssinaturaRegra chamado="SIS-2026-XXXX" /></>} />
        </CardTitle>
        <div className="flex items-center gap-2">
          <Tabs value={aba} onValueChange={(v) => setAba(v as typeof aba)}>
            <TabsList><TabsTrigger value="emprestimos">Empréstimos</TabsTrigger><TabsTrigger value="aplicacoes">Aplicações</TabsTrigger><TabsTrigger value="natureza">Fluxo por natureza</TabsTrigger></TabsList>
          </Tabs>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => void exportar()}><Download className="h-3.5 w-3.5" />Excel</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {aba === "emprestimos" && (
          <>
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Limite contratado</p><p className="text-lg font-bold">{fmtMoney(tot.limite)}</p></div>
              <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Utilizado (saldo devedor)</p><p className="text-lg font-bold">{fmtMoney(tot.utilizado)}</p></div>
              <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Limite disponível</p><p className="text-lg font-bold">{fmtMoney(tot.disponivel)}</p></div>
              <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Juros pagos no período</p><p className="text-lg font-bold">{fmtMoney(tot.jurosNoPeriodo)}</p></div>
            </div>
            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Instituição / conta</TableHead><TableHead className="text-right">Limite</TableHead><TableHead className="text-right">Utilizado</TableHead><TableHead className="text-right">Disponível</TableHead>
                    <TableHead className="text-right">Utilizações</TableHead><TableHead className="text-right">Amortizações</TableHead><TableHead className="text-right">Juros</TableHead><TableHead>Taxa</TableHead><TableHead>Vencimento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emp.contas.length === 0 && <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">Nenhuma Conta Garantida cadastrada para o filtro.</TableCell></TableRow>}
                  {emp.instituicoes.map((i) => (
                    <FragmentoInstituicao key={i.instituicao} nome={i.instituicao} resumo={i} linhas={emp.contas.filter((c) => c.instituicao === i.instituicao)} />
                  ))}
                  {emp.contas.filter((c) => c.status !== "ativa").map((l) => <LinhaConta key={l.contaId} l={l} encerrada />)}
                </TableBody>
                {emp.contas.length > 0 && (
                  <TableFooter><TableRow>
                    <TableCell className="text-xs font-semibold">Total (contas ativas)</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{fmtMoney(tot.limite)}</TableCell><TableCell className="text-right text-xs font-semibold">{fmtMoney(tot.utilizado)}</TableCell><TableCell className="text-right text-xs font-semibold">{fmtMoney(tot.disponivel)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold">{fmtMoney(tot.utilizacoesNoPeriodo)}</TableCell><TableCell className="text-right text-xs font-semibold">{fmtMoney(tot.amortizacoesNoPeriodo)}</TableCell><TableCell className="text-right text-xs font-semibold">{fmtMoney(tot.jurosNoPeriodo)}</TableCell><TableCell colSpan={2} />
                  </TableRow></TableFooter>
                )}
              </Table>
            </div>
          </>
        )}

        {aba === "aplicacoes" && (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Instituição / aplicação</TableHead><TableHead>Produto</TableHead><TableHead className="text-right">Aplicado</TableHead><TableHead className="text-right">Rendimento</TableHead>
                  <TableHead className="text-right">Resgatado</TableHead><TableHead className="text-right">Saldo atual</TableHead><TableHead>Vencimento</TableHead><TableHead>Liquidez (cadastro)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apl.linhas.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nenhuma aplicação para o filtro.</TableCell></TableRow>}
                {apl.instituicoes.map((i) => (
                  <FragmentoAplicacoes key={i.instituicao} resumo={i} linhas={apl.linhas.filter((l) => l.instituicao === i.instituicao)} />
                ))}
              </TableBody>
              {apl.linhas.length > 0 && (
                <TableFooter><TableRow>
                  <TableCell className="text-xs font-semibold" colSpan={2}>Total</TableCell>
                  <TableCell className="text-right text-xs font-semibold">{fmtMoney(totApl.aplicado)}</TableCell><TableCell className="text-right text-xs font-semibold">{fmtMoney(totApl.rendimento)}</TableCell>
                  <TableCell className="text-right text-xs font-semibold">{fmtMoney(totApl.resgatado)}</TableCell><TableCell className="text-right text-xs font-semibold">{fmtMoney(totApl.saldo)}</TableCell><TableCell colSpan={2} />
                </TableRow></TableFooter>
              )}
            </Table>
          </div>
        )}

        {aba === "natureza" && (
          <div className="max-h-[55vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead rowSpan={2}>Mês</TableHead>
                  <TableHead colSpan={3} className="border-l text-center">Operacional</TableHead><TableHead colSpan={4} className="border-l text-center">Empréstimos</TableHead><TableHead colSpan={3} className="border-l text-center">Aplicações</TableHead>
                </TableRow>
                <TableRow>
                  <TableHead className="border-l text-right">Recebimentos</TableHead><TableHead className="text-right">Despesas</TableHead><TableHead className="text-right">Resultado</TableHead>
                  <TableHead className="border-l text-right">Utilizado</TableHead><TableHead className="text-right">Amortizado</TableHead><TableHead className="text-right">Juros</TableHead><TableHead className="text-right">Saldo devedor</TableHead>
                  <TableHead className="border-l text-right">Aplicado</TableHead><TableHead className="text-right">Resgatado</TableHead><TableHead className="text-right">Rendimento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {natureza.map((p) => (
                  <TableRow key={p.mes}>
                    <TableCell className="text-xs font-medium">{mesCurto(p.mes)}</TableCell>
                    <TableCell className="border-l text-right text-xs">{fmtMoney(p.recebimentosOperacionais)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(p.despesasOperacionais)}</TableCell>
                    <TableCell className={`text-right text-xs font-semibold ${p.resultadoOperacional < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtMoney(p.resultadoOperacional)}</TableCell>
                    <TableCell className="border-l text-right text-xs">{fmtMoney(p.emprestimoUtilizado)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(p.emprestimoAmortizado)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(p.jurosPagos)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(p.saldoDevedorFim)}</TableCell>
                    <TableCell className="border-l text-right text-xs">{fmtMoney(p.aplicado)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(p.resgatadoAplicacoes)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(p.rendimentos)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="px-3 py-2 text-[11px] text-muted-foreground">Empréstimo e aplicação ficam fora do resultado operacional: um empréstimo não é receita e uma aplicação não é despesa. Operacional = recebimentos das notas (pela data de pagamento) − despesas pagas.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LinhaConta({ l, encerrada = false }: { l: LinhaEmprestimo; encerrada?: boolean }) {
  const v = ROTULO_VENC[l.situacaoVencimento];
  return (
    <TableRow className={encerrada ? "opacity-60" : "bg-muted/20"}>
      <TableCell className="pl-6 text-xs">{l.conta}{encerrada ? ` (${l.instituicao}, encerrada)` : ""} <span className="text-muted-foreground">· {l.numero}</span></TableCell>
      <TableCell className="text-right text-xs">{fmtMoney(l.limite)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(l.utilizado)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(l.disponivel)}</TableCell>
      <TableCell className="text-right text-xs">{fmtMoney(l.utilizacoesNoPeriodo)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(l.amortizacoesNoPeriodo)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(l.jurosNoPeriodo)}</TableCell>
      <TableCell className="text-xs">{l.taxa ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{data(l.vencimento)} <Badge variant="outline" className={`ml-1 h-4 px-1 text-[9px] font-normal ${v.classe}`}>{v.texto}</Badge></TableCell>
    </TableRow>
  );
}

function FragmentoInstituicao({ nome, resumo, linhas }: { nome: string; resumo: { limite: number; utilizado: number; disponivel: number; utilizacoesNoPeriodo: number; amortizacoesNoPeriodo: number; jurosNoPeriodo: number }; linhas: LinhaEmprestimo[] }) {
  return (
    <>
      <TableRow className="font-semibold">
        <TableCell className="text-xs">{nome}</TableCell>
        <TableCell className="text-right text-xs">{fmtMoney(resumo.limite)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(resumo.utilizado)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(resumo.disponivel)}</TableCell>
        <TableCell className="text-right text-xs">{fmtMoney(resumo.utilizacoesNoPeriodo)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(resumo.amortizacoesNoPeriodo)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(resumo.jurosNoPeriodo)}</TableCell><TableCell colSpan={2} />
      </TableRow>
      {linhas.filter((l) => l.status === "ativa").map((l) => <LinhaConta key={l.contaId} l={l} />)}
    </>
  );
}

function FragmentoAplicacoes({ resumo, linhas }: { resumo: { instituicao: string; valorAplicado: number; rendimento: number; resgatado: number; saldoAtual: number }; linhas: ReturnType<typeof detalheAplicacoes>["linhas"] }) {
  return (
    <>
      <TableRow className="font-semibold">
        <TableCell className="text-xs" colSpan={2}>{resumo.instituicao}</TableCell>
        <TableCell className="text-right text-xs">{fmtMoney(resumo.valorAplicado)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(resumo.rendimento)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(resumo.resgatado)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(resumo.saldoAtual)}</TableCell><TableCell colSpan={2} />
      </TableRow>
      {linhas.map((l) => (
        <TableRow key={l.id} className="bg-muted/20">
          <TableCell className="pl-6 text-xs">{l.numero} <span className="text-muted-foreground">· {l.descricao}</span></TableCell>
          <TableCell className="text-xs">{l.produto}</TableCell>
          <TableCell className="text-right text-xs">{fmtMoney(l.valorAplicado)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(l.rendimentoAcumulado)}</TableCell>
          <TableCell className="text-right text-xs">{fmtMoney(l.resgatadoPrincipal + l.resgatadoRendimento)}</TableCell><TableCell className="text-right text-xs font-medium">{fmtMoney(l.saldoAtual)}</TableCell>
          <TableCell className="whitespace-nowrap text-xs">{data(l.vencimento)}</TableCell><TableCell className="text-xs">{l.liquidez ?? "—"}</TableCell>
        </TableRow>
      ))}
    </>
  );
}
