import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { AssinaturaRegra } from "@/pages/malote/AssinaturaRegra";
import { periodosDeInsuficiencia, resumoGerencial, type PontoAnalise } from "./analiseGerencial";

// SIS-2026-0893 (etapa 4): comparativo mensal (recebimentos operacionais × despesas pagas × utilização de capital de giro), evolução da necessidade de
// capital de giro, cobertura das despesas, dependência de recursos bancários e os meses de maior insuficiência de caixa.
const mesCurto = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
const milhoes = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M` : Math.abs(v) >= 1_000 ? `${Math.round(v / 1_000)}k` : String(Math.round(v)));
const pct = (v: number | null, casas = 1) => (v === null ? "—" : `${(v * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const pctVar = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);

export function AnaliseGerencialPanel({ pontos }: { pontos: PontoAnalise[] }) {
  const resumo = useMemo(() => resumoGerencial(pontos), [pontos]);
  const insuficiencia = useMemo(() => periodosDeInsuficiencia(pontos, 3), [pontos]);
  const dados = useMemo(() => pontos.map((p) => ({ ...p, rotulo: mesCurto(p.mes) })), [pontos]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          <TituloComFormula alinhar="left" titulo="Análises Gerenciais (12 meses)" formula={<>
            <span className="block"><strong>Resultado</strong> = recebimentos das notas (pela data de pagamento) − despesas pagas. Empréstimo e aplicação ficam de fora.</span>
            <span className="block"><strong>Necessidade de capital de giro</strong> do mês = quanto as despesas passaram dos recebimentos. <strong>Utilização de capital de giro</strong> = utilização líquida da Conta Garantida (utilizado − amortizado).</span>
            <span className="block"><strong>Cobertura</strong> = recebimentos ÷ despesas. <strong>Dependência de recursos bancários</strong> = utilização líquida de crédito ÷ despesas.</span>
            <AssinaturaRegra chamado="SIS-2026-0893" /></>} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Cobertura das despesas (12 meses)</p><p className="text-lg font-bold">{pct(resumo.coberturaPeriodo)}</p><p className="text-[11px] text-muted-foreground">recebimentos ÷ despesas</p></div>
          <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Dependência de recursos bancários</p><p className="text-lg font-bold">{pct(resumo.dependenciaPeriodo)}</p><p className="text-[11px] text-muted-foreground">crédito líquido ÷ despesas</p></div>
          <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Meses com déficit operacional</p><p className="text-lg font-bold">{resumo.mesesComDeficit} de {pontos.length}</p><p className="text-[11px] text-muted-foreground">{resumo.mesDoMaiorDeficit ? `maior: ${mesCurto(resumo.mesDoMaiorDeficit)} (${fmtMoney(resumo.maiorDeficit)})` : "nenhum"}</p></div>
          <div className="rounded-md border p-3"><p className="text-[11px] text-muted-foreground">Saldo devedor (fim da série)</p><p className="text-lg font-bold">{fmtMoney(resumo.saldoDevedorFim)}</p><p className={`text-[11px] ${resumo.variacaoSaldoDevedor > 0 ? "text-red-600" : "text-emerald-600"}`}>{resumo.variacaoSaldoDevedor > 0 ? "+" : ""}{fmtMoney(resumo.variacaoSaldoDevedor)} no período</p></div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-semibold">Recebimentos × Despesas × Utilização de capital de giro</p>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dados}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={milhoes} tick={{ fontSize: 10 }} width={42} />
                  <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="recebimentos" name="Recebimentos" fill="#16a34a" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="despesas" name="Despesas pagas" fill="#f97316" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="utilizacaoCapitalGiro" name="Utilização de capital de giro" fill="#2563eb" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold">Evolução da necessidade de capital de giro</p>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dados}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={milhoes} tick={{ fontSize: 10 }} width={42} />
                  <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="necessidadeCapitalGiro" name="Necessidade do mês (déficit operacional)" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="saldoDevedorFim" name="Saldo devedor (fim do mês)" stroke="#1e3a8a" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]">
          <div className="max-h-[50vh] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead><TableHead className="text-right">Faturamento líq.</TableHead><TableHead className="text-right">Recebimentos</TableHead><TableHead className="text-right">Despesas</TableHead>
                  <TableHead className="text-right">Resultado</TableHead><TableHead className="text-right">Cobertura</TableHead><TableHead className="text-right">Dep. bancária</TableHead><TableHead className="text-right">Var. receb.</TableHead><TableHead className="text-right">Var. desp.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pontos.map((p) => (
                  <TableRow key={p.mes}>
                    <TableCell className="text-xs font-medium">{mesCurto(p.mes)}</TableCell>
                    <TableCell className="text-right text-xs">{fmtMoney(p.faturamentoLiquido)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(p.recebimentos)}</TableCell><TableCell className="text-right text-xs">{fmtMoney(p.despesas)}</TableCell>
                    <TableCell className={`text-right text-xs font-semibold ${p.resultado < 0 ? "text-red-600" : "text-emerald-600"}`}>{fmtMoney(p.resultado)}</TableCell>
                    <TableCell className="text-right text-xs">{pct(p.cobertura, 0)}</TableCell><TableCell className="text-right text-xs">{pct(p.dependenciaBancaria, 0)}</TableCell>
                    <TableCell className="text-right text-xs">{pctVar(p.variacaoRecebimentosPct)}</TableCell><TableCell className="text-right text-xs">{pctVar(p.variacaoDespesasPct)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold">Maiores insuficiências de caixa</p>
            {insuficiencia.length === 0 ? (
              <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900">Nenhum mês com despesas acima dos recebimentos na série.</p>
            ) : (
              <ol className="space-y-2">
                {insuficiencia.map((p, i) => (
                  <li key={p.mes} className="rounded-md border p-2 text-xs">
                    <p className="font-semibold">{i + 1}º · {mesCurto(p.mes)} — déficit {fmtMoney(p.deficit)}</p>
                    <p className="text-muted-foreground">cobertura {pct(p.cobertura, 0)} · {p.financiadoPorCredito === null ? "" : `${pct(p.financiadoPorCredito, 0)} financiado por crédito`}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
