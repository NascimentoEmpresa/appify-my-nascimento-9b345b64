import { useMemo, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, Building2, CircleDollarSign, Landmark, Percent, PiggyBank, Scale, Wallet } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CabecalhoIndicador, GradeCarregando, Kpi, SemDados, ultimasCompetencias } from "@/components/indicadores/IndicadoresUi";
import { useIndicadoresFaturamento } from "@/hooks/useIndicadoresFaturamento";
import { montarLucratividade, PISO_RECEITA } from "@/lib/operacional/indicadoresLucratividade";
import { fmtBRL, fmtCompacto, fmtPct, rotuloCompetencia, variacaoPct, variacaoPP } from "@/lib/operacional/painelExecutivo";

// =====================================================================
// Operacional › Indicadores › 3. LUCRATIVIDADE E ORÇAMENTO (09/11/2026)
// Mig 20261109003300. Regras: src/lib/operacional/indicadoresLucratividade.ts.
// =====================================================================

const MENU = "ope_indicadores_lucratividade";
const CORES = ["#2563eb", "#94a3b8", "#c4a77d", "#f97316", "#16a34a", "#a855f7", "#0ea5e9", "#64748b"];
const curto = (nome: string) => nome.replace(/^\s*\d+\s*-\s*/, "").slice(0, 14);

export default function LucratividadeOrcamento() {
  const competencias = useMemo(() => ultimasCompetencias(), []);
  const [escolhida, setEscolhida] = useState<string | undefined>(undefined);
  // Abre no mês passado: o mês corrente ainda não tem as despesas lançadas.
  const competencia = escolhida ?? competencias[1];
  const base = useIndicadoresFaturamento(Number(competencia.slice(0, 4)), true);
  const d = useMemo(() => {
    if (base.carregando || !base.custos || !base.admPorMes) return null;
    const nomes = new Map([...base.contratos.entries()].map(([id, c]) => [id, c.nome]));
    return montarLucratividade({ nfs: base.nfs, contratos: nomes, custos: base.custos, admPorMes: base.admPorMes }, competencia);
  }, [base.carregando, base.custos, base.admPorMes, base.contratos, base.nfs, competencia]);
  const a = d?.atual ?? null;
  const top = d ? d.contratos.filter((c) => c.receita > 0).slice(0, 10).map((c) => ({ ...c, rotulo: curto(c.nome) })) : [];
  const totalCusto = d?.composicao.reduce((s, c) => s + c.valor, 0) ?? 0;

  return (
    <AcessoGate menu={MENU} acao="visualizar" fallback={<SemDados texto="Você não tem acesso a esta tela." />}>
      <div className="space-y-5">
        <CabecalhoIndicador numero={3} titulo="Lucratividade e Orçamento" icone={PiggyBank}
          descricao="Rentabilidade dos contratos: líquido faturado, custos do Fluxo de Caixa, margens e rateio administrativo."
          competencia={competencia} competencias={competencias} onCompetencia={setEscolhida} />
        {base.erro ? <SemDados texto="Não foi possível carregar os custos do Fluxo de Caixa. Tente novamente." /> : !d ? <GradeCarregando /> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi titulo="Receita Líquida" valor={a ? fmtBRL(a.receita) : null} icone={Landmark} cor="azul"
                variacao={variacaoPct(a?.receita, d.anterior?.receita, true)} aviso={a ? null : "Sem nota nem despesa nesta competência"} />
              <Kpi titulo="Total de Custos" valor={a ? fmtBRL(a.custo) : null} icone={Wallet} cor="laranja"
                variacao={variacaoPct(a?.custo, d.anterior?.custo, false)} aviso="Saídas do Fluxo de Caixa com contrato" />
              <Kpi titulo="Lucro Bruto" valor={a ? fmtBRL(a.lucro) : null} icone={CircleDollarSign} cor="verde"
                variacao={variacaoPct(a?.lucro, d.anterior?.lucro, true)} />
              <Kpi titulo="Margem Bruta" valor={a?.margem != null ? fmtPct(a.margem) : null} icone={Percent} cor="verde"
                variacao={variacaoPP(a?.margem, d.anterior?.margem)} />
              <Kpi titulo="Desvio Orçado × Realizado" valor={null} icone={Scale} cor="cinza" medida="sem_fonte"
                aviso="Os orçamentos de contrato ainda estão em rascunho" />
              <Kpi titulo="Rateio Administrativo" valor={a ? fmtBRL(a.rateio) : null} icone={Building2} cor="vermelho" medida="parcial"
                variacao={variacaoPct(a?.rateio, d.anterior?.rateio, false)} aviso="Saídas sem contrato do Fluxo de Caixa" />
              <Kpi titulo="Margem Líquida (após ADM)" valor={a?.margemLiquida != null ? fmtPct(a.margemLiquida) : null} icone={Percent} cor="laranja" medida="parcial"
                variacao={variacaoPP(a?.margemLiquida, d.anterior?.margemLiquida)} />
              <Kpi titulo="Contratos < 10% de Margem" valor={d.classificados ? `${d.abaixoDe10} de ${d.classificados}` : null} icone={AlertTriangle} cor="vermelho"
                aviso={`Contratos com receita de ${fmtBRL(PISO_RECEITA)} ou mais`} />
            </div>

            <Tabs defaultValue="contratos">
              <TabsList>
                <TabsTrigger value="contratos">Contratos</TabsTrigger>
                <TabsTrigger value="tabela">Tabela por Contrato</TabsTrigger>
              </TabsList>
              <TabsContent value="contratos" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="p-5 lg:col-span-2">
                    <h2 className="mb-2 font-semibold text-foreground">Margem Bruta por Contrato (Top 10 em receita)</h2>
                    {!top.length ? <SemDados texto="Nenhum contrato com receita nesta competência" /> : (
                      <ResponsiveContainer width="100%" height={300}>
                        <ComposedChart data={top} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                          <XAxis dataKey="rotulo" interval={0} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <YAxis yAxisId="r" tickFormatter={fmtCompacto} width={52} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <YAxis yAxisId="m" orientation="right" tickFormatter={(v: number) => `${v}%`} width={44} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                          <Tooltip formatter={(v: number, n: string) => [n === "Margem" ? fmtPct(v) : fmtBRL(v), n]} labelFormatter={(_l, p) => p?.[0]?.payload?.nome ?? ""} />
                          <Legend verticalAlign="top" align="right" iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 13, paddingBottom: 8 }} />
                          <Bar yAxisId="r" dataKey="receita" name="Receita" fill="#1e3a8a" radius={[4, 4, 0, 0]} maxBarSize={30} isAnimationActive={false} />
                          <Line yAxisId="m" dataKey="margem" name="Margem" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </Card>
                  <Card className="p-5">
                    <h2 className="mb-2 font-semibold text-foreground">Composição dos Custos</h2>
                    {!d.composicao.length ? <SemDados texto="Sem custo lançado nesta competência" /> : (
                      <>
                        <div className="relative mx-auto h-[190px] w-[190px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={d.composicao} dataKey="valor" nameKey="nome" innerRadius={58} outerRadius={90} stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
                                {d.composicao.map((c, i) => <Cell key={c.id} fill={CORES[i % CORES.length]} />)}
                              </Pie>
                              <Tooltip formatter={(v: number, n: string) => [fmtBRL(v), n]} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-lg font-bold tabular-nums">{fmtCompacto(totalCusto)}</span>
                            <span className="text-xs text-muted-foreground">Total</span>
                          </div>
                        </div>
                        <ul className="mt-3 space-y-1.5 text-sm">
                          {d.composicao.map((c, i) => (
                            <li key={c.id} className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CORES[i % CORES.length] }} />
                              <span className="flex-1 text-muted-foreground">{c.nome}</span>
                              <span className="tabular-nums font-medium">{fmtPct(totalCusto ? (c.valor / totalCusto) * 100 : 0, 1)}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                  </Card>
                </div>
              </TabsContent>
              <TabsContent value="tabela" className="mt-4">
                <Card className="overflow-x-auto p-2">
                  {!d.contratos.length ? <SemDados texto="Nenhum contrato com nota ou custo nesta competência" altura={120} /> : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Contrato</TableHead>
                          <TableHead className="text-right">Receita líquida</TableHead>
                          <TableHead className="text-right">Custos</TableHead>
                          <TableHead className="text-right">Lucro bruto</TableHead>
                          <TableHead className="text-right">Margem</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {d.contratos.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell className="max-w-[24rem] truncate">{c.nome}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtBRL(c.receita)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fmtBRL(c.custo)}</TableCell>
                            <TableCell className={`text-right tabular-nums ${c.lucro < 0 ? "text-red-600" : ""}`}>{fmtBRL(c.lucro)}</TableCell>
                            <TableCell className="text-right tabular-nums">{c.receita > 0 ? fmtPct(c.margem) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Card>
              </TabsContent>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {rotuloCompetencia(competencia)} · mesma conta de Controladoria › Faturamento da Empresa (líquido − despesas do Fluxo de Caixa), com a empresa, a base e o código de nota escolhidos lá.
            </p>
          </>
        )}
      </div>
    </AcessoGate>
  );
}
