import { useMemo, useState } from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BriefcaseMedical, CalendarOff, Plane, Scale, TrendingDown, TrendingUp, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarrasHorizontais, CabecalhoIndicador, GradeCarregando, Kpi, SemDados, ultimasCompetencias } from "@/components/indicadores/IndicadoresUi";
import { usePainelAtivosContratos } from "@/hooks/useAtivosContratos";
import { useCustoFaltas, useTurnoverPainel } from "@/hooks/useRelatoriosDiretoria";
import { useListaControle } from "@/hooks/useControleAfastamentos";
import { estaAberto } from "@/lib/sst/controleAfastamentos";
import { montarFaltas, montarQuadro, motivosAfastamento } from "@/lib/operacional/indicadoresPessoas";
import { rotuloCompetencia } from "@/lib/operacional/painelExecutivo";

// =====================================================================
// Operacional › Indicadores › 4. PESSOAS E CAPACIDADE (09/11/2026)
// Mig 20261109003300. Regras: src/lib/operacional/indicadoresPessoas.ts.
// Cada bloco carrega sozinho: sem acesso a uma das fontes, só ele fica vazio.
// =====================================================================

const MENU = "ope_indicadores_pessoas";
const CORES_ABC = { A: "#2563eb", B: "#f59e0b", C: "#a8a29e" };
const num = (n: number) => n.toLocaleString("pt-BR");
const pctDe = (n: number, t: number) => (t > 0 ? `${((n / t) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do total` : null);

function fimDoMes(c: string): string {
  const [a, m] = c.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export default function PessoasCapacidade() {
  const competencias = useMemo(() => ultimasCompetencias(), []);
  const [escolhida, setEscolhida] = useState<string | undefined>(undefined);
  const competencia = escolhida ?? competencias[1];
  const ano = Number(competencia.slice(0, 4));

  const ativos = usePainelAtivosContratos();
  const faltasQ = useCustoFaltas(`${competencia}-01`, fimDoMes(competencia));
  const afastQ = useListaControle();
  const turnQ = useTurnoverPainel({ ano, meses: null, contrato: null, causas: null });

  const quadro = useMemo(() => (ativos.data ? montarQuadro(ativos.data) : null), [ativos.data]);
  const faltas = useMemo(() => (faltasQ.data ? montarFaltas(faltasQ.data.notas, competencia) : null), [faltasQ.data, competencia]);
  const motivos = useMemo(() => (afastQ.data ? motivosAfastamento(afastQ.data.map((a) => ({ motivo: a.motivo, aberto: estaAberto(a) }))) : null), [afastQ.data]);
  const totalContratos = quadro ? quadro.contratosExcedente + quadro.contratosDeficit + quadro.contratosEquilibrados : 0;

  return (
    <AcessoGate menu={MENU} acao="visualizar" fallback={<SemDados texto="Você não tem acesso a esta tela." />}>
      <div className="space-y-5">
        <CabecalhoIndicador numero={4} titulo="Pessoas e Capacidade" icone={Users}
          descricao="Quadro de colaboradores por contrato, faltas descontadas nas notas e afastamentos."
          competencia={competencia} competencias={competencias} onCompetencia={setEscolhida} />

        {!quadro ? (ativos.isError ? <SemDados texto="Sem acesso ao quadro de RH › Ativos/Contratos." altura={120} /> : <GradeCarregando n={6} />) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <Kpi titulo="Headcount Previsto" valor={num(quadro.previsto)} icone={UserPlus} cor="azul" aviso="Planilha de custo, hoje" />
            <Kpi titulo="Headcount Atual" valor={num(quadro.atual)} icone={UserCheck} cor="verde" aviso="Trabalhando, hoje" />
            <Kpi titulo="Excedente" valor={num(quadro.excedente)} icone={TrendingUp} cor="vermelho" aviso="Sobra posto a posto" />
            <Kpi titulo="Déficit" valor={num(quadro.deficit)} icone={TrendingDown} cor="laranja" aviso="Falta posto a posto" />
            <Kpi titulo="Afastados" valor={num(quadro.afastados)} icone={BriefcaseMedical} cor="azul" />
            <Kpi titulo="Féristas" valor={num(quadro.feristas)} icone={Plane} cor="azul" />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <Kpi titulo="Contratos com Excedente" valor={quadro ? num(quadro.contratosExcedente) : null} icone={TrendingUp} cor="vermelho" aviso={quadro ? pctDe(quadro.contratosExcedente, totalContratos) : null} />
          <Kpi titulo="Contratos com Déficit" valor={quadro ? num(quadro.contratosDeficit) : null} icone={TrendingDown} cor="laranja" aviso={quadro ? pctDe(quadro.contratosDeficit, totalContratos) : null} />
          <Kpi titulo="Contratos Equilibrados" valor={quadro ? num(quadro.contratosEquilibrados) : null} icone={Scale} cor="verde" aviso={quadro ? pctDe(quadro.contratosEquilibrados, totalContratos) : null} />
          <Kpi titulo="Total de Faltas" valor={faltas ? num(faltas.total) : null} icone={CalendarOff} cor="vermelho" aviso={faltasQ.isError ? "Sem acesso a Custo de Faltas" : "Descontadas nas notas da competência"} />
          <Kpi titulo="Contratos com Faltas" valor={faltas ? num(faltas.contratosComFaltas) : null} icone={UserMinus} cor="laranja" />
          <Kpi titulo="Top 10 Contratos" valor={faltas?.top10 != null ? `${faltas.top10.toLocaleString("pt-BR")}%` : null} icone={Users} cor="azul" aviso="das faltas" />
        </div>

        <Tabs defaultValue="geral">
          <TabsList>
            <TabsTrigger value="geral">Visão Geral</TabsTrigger>
            <TabsTrigger value="contrato">Por Contrato</TabsTrigger>
            <TabsTrigger value="faltas">Faltas (ABC)</TabsTrigger>
            <TabsTrigger value="turnover">Turnover</TabsTrigger>
          </TabsList>
          <TabsContent value="geral" className="mt-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-5">
                <h2 className="mb-2 font-semibold text-foreground">Evolução do Efetivo ({ano})</h2>
                {!turnQ.data?.mensal?.length ? <SemDados texto={turnQ.isError ? "Sem acesso ao Turn-over" : "Carregando"} /> : (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={turnQ.data.mensal} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                      <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <YAxis width={48} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => [num(v), "Efetivo"]} />
                      <Line dataKey="efetivo" name="Efetivo" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                <p className="mt-2 text-xs text-muted-foreground">Efetivo do mês, como em Relatórios › Turn-over. O previsto não tem histórico.</p>
              </Card>
              <Card className="p-5">
                <h2 className="mb-2 font-semibold text-foreground">Distribuição de Faltas (ABC)</h2>
                {!faltas?.total ? <SemDados texto={faltas ? "Nenhuma falta descontada nesta competência" : "Carregando"} /> : (
                  <>
                    <div className="relative mx-auto h-[170px] w-[170px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={faltas.abc.filter((x) => x.faltas > 0)} dataKey="faltas" nameKey="classe" innerRadius={52} outerRadius={80} stroke="hsl(var(--card))" strokeWidth={2} isAnimationActive={false}>
                            {faltas.abc.filter((x) => x.faltas > 0).map((x) => <Cell key={x.classe} fill={CORES_ABC[x.classe]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number, n: string) => [`${num(v)} faltas`, `Classe ${n}`]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-xl font-bold tabular-nums">{num(faltas.total)}</span>
                        <span className="text-xs text-muted-foreground">Faltas</span>
                      </div>
                    </div>
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {faltas.abc.map((x) => (
                        <li key={x.classe} className="flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: CORES_ABC[x.classe] }} />
                          <span className="flex-1 text-muted-foreground">Classe {x.classe} · {x.contratos} contrato(s)</span>
                          <span className="tabular-nums font-medium">{num(x.faltas)} ({((x.faltas / faltas.total) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%)</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Card>
              <Card className="p-5">
                <h2 className="mb-1 font-semibold text-foreground">Principais Motivos de Afastamento</h2>
                <p className="mb-4 text-xs text-muted-foreground">Casos em aberto em SST › Controle de Afastamentos.</p>
                {!motivos ? <SemDados texto={afastQ.isError ? "Sem acesso ao Controle de Afastamentos" : "Carregando"} /> : !motivos.length ? <SemDados texto="Nenhum afastamento em aberto" /> : (
                  <BarrasHorizontais itens={motivos} formatar={num} />
                )}
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="contrato" className="mt-4">
            <Card className="overflow-x-auto p-2">
              {!quadro?.contratos.length ? <SemDados texto="Sem contratos com planilha de custo" altura={120} /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contrato</TableHead>
                      <TableHead className="text-right">Previsto</TableHead>
                      <TableHead className="text-right">Atual</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quadro.contratos.map((c) => (
                      <TableRow key={c.nome}>
                        <TableCell className="max-w-[26rem] truncate">{c.nome}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(c.previsto)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(c.atual)}</TableCell>
                        <TableCell className={`text-right tabular-nums ${c.saldo < 0 ? "text-orange-600" : c.saldo > 0 ? "text-red-600" : ""}`}>{c.saldo > 0 ? `+${c.saldo}` : c.saldo}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>
          <TabsContent value="faltas" className="mt-4">
            <Card className="overflow-x-auto p-2">
              {!faltas?.porContrato.length ? <SemDados texto="Nenhuma falta descontada nesta competência" altura={120} /> : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Contrato</TableHead><TableHead className="text-right">Faltas</TableHead><TableHead className="text-right">Classe</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {faltas.porContrato.map((c) => (
                      <TableRow key={c.nome}>
                        <TableCell className="max-w-[26rem] truncate">{c.nome}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(c.faltas)}</TableCell>
                        <TableCell className="text-right font-semibold" style={{ color: CORES_ABC[c.classe] }}>{c.classe}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>
          <TabsContent value="turnover" className="mt-4">
            <Card className="overflow-x-auto p-2">
              {!turnQ.data?.mensal?.length ? <SemDados texto={turnQ.isError ? "Sem acesso ao Turn-over" : "Carregando"} altura={120} /> : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Mês</TableHead><TableHead className="text-right">Efetivo</TableHead><TableHead className="text-right">Demissões</TableHead><TableHead className="text-right">Turnover</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {turnQ.data.mensal.map((m) => (
                      <TableRow key={m.mes}>
                        <TableCell>{m.mes}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(m.efetivo)}</TableCell>
                        <TableCell className="text-right tabular-nums">{num(m.demissoes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.taxa != null ? `${m.taxa.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </TabsContent>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          Quadro, afastados e féristas: posição de hoje (RH › Ativos/Contratos). Faltas: notas de {rotuloCompetencia(competencia)}. Turnover: ano de {ano}.
        </p>
      </div>
    </AcessoGate>
  );
}
