import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { rotuloMes } from "../faturamento/useBaseFaturamento";
import { ROTULO_TIPO_LANCAMENTO, type LancamentoRetirada, type ResultadoMes, type TipoLancamento, type TotalPeriodo } from "./regras";

// SIS-2026-0872: janelas que mostram DE ONDE VEM cada valor da tela (como os detalhamentos do Fechamento da Empresa).

const dataBR = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const COR_TIPO: Record<TipoLancamento, string> = { coluna_socio: "bg-orange-100 text-orange-800", investimentos: "bg-violet-100 text-violet-800", obras: "bg-rose-100 text-rose-800" };

function TabelaLancamentos({ lancamentos, mostrarDono = false }: { lancamentos: LancamentoRetirada[]; mostrarDono?: boolean }) {
  const total = Math.round(lancamentos.reduce((s, l) => s + l.valor, 0) * 100) / 100;
  return (
    <div className="max-h-[38vh] overflow-auto rounded-md border">
      <Table className="text-xs">
        <TableHeader className="sticky top-0 bg-muted/60">
          <TableRow>
            <TableHead>Data</TableHead>{mostrarDono && <TableHead>Dono</TableHead>}<TableHead>Tipo</TableHead><TableHead>Centro de custo</TableHead><TableHead>Classificação</TableHead><TableHead>Descrição</TableHead><TableHead className="text-right">Valor (R$)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lancamentos.length === 0 && <TableRow><TableCell colSpan={mostrarDono ? 7 : 6} className="py-6 text-center text-muted-foreground">Nenhum lançamento.</TableCell></TableRow>}
          {lancamentos.map((l, i) => (
            <TableRow key={i}>
              <TableCell className="whitespace-nowrap">{dataBR(l.data)}</TableCell>
              {mostrarDono && <TableCell className="whitespace-nowrap font-medium">{l.socioNome}</TableCell>}
              <TableCell><span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${COR_TIPO[l.tipo]}`}>{ROTULO_TIPO_LANCAMENTO[l.tipo]}</span></TableCell>
              <TableCell className="max-w-[170px] truncate" title={l.origem}>{l.origem || "—"}</TableCell>
              <TableCell className="max-w-[130px] truncate" title={l.classificacao}>{l.classificacao || "—"}</TableCell>
              <TableCell className="max-w-[240px] truncate" title={l.descricao}>{l.descricao || "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-right">{fmtMoney(l.valor)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        {lancamentos.length > 0 && <TableFooter><TableRow><TableCell colSpan={mostrarDono ? 6 : 5} className="font-semibold">{lancamentos.length} lançamento(s)</TableCell><TableCell className="text-right font-semibold">{fmtMoney(total)}</TableCell></TableRow></TableFooter>}
      </Table>
    </div>
  );
}

const textoPeriodo = (meses: string[]) => (meses.length === 1 ? rotuloMes(meses[0]) : `${rotuloMes(meses[0])} a ${rotuloMes(meses[meses.length - 1])}`);

// ── Retiradas antecipadas de UM sócio ───────────────────────────────────────────────────────────────────────────────────────────────
export function DialogRetiradasSocio({ socio, meses, lancamentos, onClose }: {
  socio: TotalPeriodo["socios"][number] | null; meses: string[]; lancamentos: LancamentoRetirada[]; onClose: () => void;
}) {
  const doSocio = useMemo(() => lancamentos.filter((l) => !!socio && l.socioId === socio.socioId), [lancamentos, socio]);
  if (!socio) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Retiradas antecipadas de {socio.nome} | {textoPeriodo(meses)}</DialogTitle>
          <DialogDescription>De onde vem o valor que sai da parte do sócio no lucro.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-4">
          {[
            ["Coluna do sócio no Fechamento da Empresa", socio.retiradaColuna, "Saídas do Fluxo de Caixa lançadas no contrato ADMINISTRATIVO SÓCIOS do sócio — é o mesmo número da coluna dele na aba “Resumo Mensal com Sócios”."],
            ["Investimentos (integrante = o sócio)", socio.retiradaInvestimentos, "Parte das saídas dos contratos INVESTIMENTOS em que o integrante do lançamento é este sócio. No Fechamento da Empresa elas ficam na coluna Investimentos, para todos juntos."],
            ["Obras Adm (integrante = o sócio)", socio.retiradaObras, "Parte das saídas dos contratos OBRAS ADM em que o integrante do lançamento é este sócio."],
          ].map(([r, v, t]) => (
            <div key={r as string} className="rounded-md border p-2" title={t as string}>
              <p className="text-[11px] leading-tight text-muted-foreground">{r as string}</p>
              <p className="text-base font-bold">{fmtMoney(v as number)}</p>
            </div>
          ))}
          <div className="rounded-md border bg-orange-50 p-2 dark:bg-orange-950/20">
            <p className="text-[11px] text-muted-foreground">Total das retiradas</p>
            <p className="text-base font-bold text-orange-600">{fmtMoney(socio.retiradas)}</p>
          </div>
        </div>
        <p className="rounded-md bg-muted/50 p-2 text-xs leading-relaxed">
          <strong>Por que é maior do que a coluna dele no Fechamento da Empresa?</strong> Lá a coluna do sócio mostra só o contrato ADMINISTRATIVO SÓCIOS dele. Aqui, além dela, entra o que Investimentos e Obras Adm
          têm com ele como <strong>integrante</strong> (por pessoa, não por centro de custo). A diferença é a soma de Investimentos e Obras Adm da lista abaixo. A parte de Investimentos e Obras Adm cujo integrante
          é a “Empresa” não é do sócio: consome o lucro antes da divisão.
        </p>
        <p className="text-xs font-semibold">Investimentos e Obras Adm com {socio.nome} como integrante</p>
        <TabelaLancamentos lancamentos={doSocio.filter((l) => l.tipo !== "coluna_socio")} />
        <p className="text-xs font-semibold">Despesas do contrato ADMINISTRATIVO SÓCIOS dele (coluna do Fechamento da Empresa)</p>
        <TabelaLancamentos lancamentos={doSocio.filter((l) => l.tipo === "coluna_socio")} />
      </DialogContent>
    </Dialog>
  );
}

// ── Como o Lucro a Distribuir é formado ─────────────────────────────────────────────────────────────────────────────────────────────
export function DialogComposicaoLucro({ aberto, meses, total, resultados, consumo, onClose }: {
  aberto: boolean; meses: string[]; total: TotalPeriodo; resultados: ResultadoMes[]; consumo: LancamentoRetirada[]; onClose: () => void;
}) {
  if (!aberto) return null;
  const linha = (rotulo: string, f: (r: ResultadoMes) => number, t: number, negrito = false, negativa = false) => (
    <TableRow className={negrito ? "bg-muted/40 font-semibold" : ""}>
      <TableCell className="whitespace-nowrap">{rotulo}</TableCell>
      {resultados.map((r) => <TableCell key={r.mes} className="whitespace-nowrap text-right">{negativa ? "−" : ""}{fmtMoney(negativa ? Math.abs(f(r)) : f(r))}</TableCell>)}
      {resultados.length > 1 && <TableCell className="whitespace-nowrap text-right font-semibold">{negativa ? "−" : ""}{fmtMoney(negativa ? Math.abs(t) : t)}</TableCell>}
    </TableRow>
  );
  const consumoEmpresa = consumo.filter((l) => l.socioId === "empresa");
  const semIntegrante = consumo.filter((l) => l.socioId === "sem_integrante");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Como o Lucro a Distribuir é formado | {textoPeriodo(meses)}</DialogTitle>
          <DialogDescription>Do Resultado do Fechamento da Empresa até o que cabe a cada sócio, mês a mês.</DialogDescription>
        </DialogHeader>
        <div className="overflow-x-auto rounded-md border">
          <Table className="text-xs">
            <TableHeader className="bg-muted/60">
              <TableRow><TableHead /> {resultados.map((r) => <TableHead key={r.mes} className="text-right">{rotuloMes(r.mes)}</TableHead>)}{resultados.length > 1 && <TableHead className="text-right">Total</TableHead>}</TableRow>
            </TableHeader>
            <TableBody>
              {linha("Resultado após Outras Receitas", (r) => r.resultadoAposOutrasReceitas, total.resultadoAposOutrasReceitas)}
              {linha("(−) Tributos sobre o Resultado", (r) => r.tributos, total.tributos, false, true)}
              {linha("(=) Resultado do Período", (r) => r.resultadoAntesRetiradas, total.resultadoAntesRetiradas, true)}
              {linha("(−) Empresa em Investimentos", (r) => r.consumoEmpresa.investimentos, total.consumoDetalhe.investimentos, false, true)}
              {linha("(−) Empresa em Obras Adm", (r) => r.consumoEmpresa.obras, total.consumoDetalhe.obras, false, true)}
              {linha("(−) Sem integrante (conta como Empresa)", (r) => r.consumoEmpresa.semIntegrante, total.consumoDetalhe.semIntegrante, false, true)}
              {linha("(=) Lucro a Distribuir", (r) => r.lucroDistribuir, total.lucroDistribuir, true)}
            </TableBody>
          </Table>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
          <li><strong>Resultado após Outras Receitas</strong> e <strong>Tributos</strong> são os da aba “Resumo Mensal com Sócios” do Fechamento da Empresa. O Resultado do Período é antes das colunas dos sócios, de Investimentos e de Obras Adm
            (no Fechamento da Empresa elas já foram descontadas no Resultado Gerencial Líquido; aqui elas são as retiradas de cada sócio, por isso não se desconta duas vezes).</li>
          <li><strong>Empresa em Investimentos / Obras Adm</strong>: saídas desses contratos em que o integrante do lançamento é “Empresa”. São gasto da empresa e saem do lucro <em>antes</em> da divisão entre os sócios.</li>
          <li><strong>Sem integrante</strong>: lançamento de Investimentos/Obras Adm sem integrante (ou com um colaborador que não é sócio). Conta como gasto da Empresa; corrija o integrante no Fluxo de Caixa para atribuir a um sócio.</li>
          <li>Mês negativo é abatido: o Lucro a Distribuir do mês pode ser negativo e o total do período soma tudo.</li>
          <li>A parte de cada sócio é o <strong>percentual × Lucro a Distribuir</strong>; do que ele recebe saem as retiradas antecipadas dele, e o que sobra é o saldo a retirar (complemento).</li>
        </ul>
        <p className="text-xs font-semibold">O que a Empresa consumiu ({fmtMoney(consumoEmpresa.reduce((s, l) => s + l.valor, 0))})</p>
        <TabelaLancamentos lancamentos={consumoEmpresa} />
        {semIntegrante.length > 0 && (
          <>
            <p className="text-xs font-semibold text-amber-700">Sem integrante ({fmtMoney(semIntegrante.reduce((s, l) => s + l.valor, 0))}) — corrija no Fluxo de Caixa</p>
            <TabelaLancamentos lancamentos={semIntegrante} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
