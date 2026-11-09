import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CircleDollarSign, Clock3, FileText, Percent, Receipt, TrendingUp, Wallet } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarrasHorizontais, CabecalhoIndicador, GradeCarregando, Kpi, SemDados, ultimasCompetencias } from "@/components/indicadores/IndicadoresUi";
import { useIndicadoresFaturamento } from "@/hooks/useIndicadoresFaturamento";
import { montarFaturamento, type LinhaTabela } from "@/lib/operacional/indicadoresFaturamento";
import { fmtBRL, fmtCompacto, rotuloCompetencia, rotuloEixo, variacaoPct } from "@/lib/operacional/painelExecutivo";

// =====================================================================
// Operacional › Indicadores › 2. FATURAMENTO E RECEBIMENTOS (09/11/2026)
// Mig 20261109003300. Base e regras: src/lib/operacional/indicadoresFaturamento.ts.
// =====================================================================

const MENU = "ope_indicadores_faturamento";
const hojeIso = () => new Date().toISOString().slice(0, 10);

function TabelaTotais({ linhas, rotulo }: { linhas: LinhaTabela[]; rotulo: string }) {
  if (!linhas.length) return <SemDados texto="Nenhuma nota nesta competência" altura={120} />;
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{rotulo}</TableHead>
            <TableHead className="text-right">Notas</TableHead>
            <TableHead className="text-right">Bruto</TableHead>
            <TableHead className="text-right">Líquido</TableHead>
            <TableHead className="text-right">Recebido</TableHead>
            <TableHead className="text-right">A receber</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {linhas.map((l) => (
            <TableRow key={l.chave}>
              <TableCell className="max-w-[22rem] truncate">{l.nome}</TableCell>
              <TableCell className="text-right tabular-nums">{l.notas}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtBRL(l.bruto)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtBRL(l.liquido)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtBRL(l.recebido)}</TableCell>
              <TableCell className="text-right tabular-nums">{fmtBRL(l.aReceber)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function FaturamentoRecebimentos() {
  const competencias = useMemo(() => ultimasCompetencias(), []);
  const [escolhida, setEscolhida] = useState<string | undefined>(undefined);
  const ano = Number((escolhida ?? competencias[0]).slice(0, 4));
  const base = useIndicadoresFaturamento(ano, false);

  // Abre na competência mais nova com nota; a pessoa troca à vontade.
  const padrao = useMemo(() => (base.carregando ? undefined : montarFaturamento(base.nfs, base.contratos, competencias[0], hojeIso()).ultimaComNota), [base.carregando, base.nfs, base.contratos, competencias]);
  const competencia = escolhida ?? padrao ?? competencias[0];
  const d = useMemo(() => (base.carregando ? null : montarFaturamento(base.nfs, base.contratos, competencia, hojeIso())), [base.carregando, base.nfs, base.contratos, competencia]);

  return (
    <AcessoGate menu={MENU} acao="visualizar" fallback={<SemDados texto="Você não tem acesso a esta tela." />}>
      <div className="space-y-5">
        <CabecalhoIndicador numero={2} titulo="Faturamento e Recebimentos" icone={Receipt}
          descricao="Notas emitidas, recebidas e o saldo a receber, com a mesma base de Controladoria › Faturamento da Empresa."
          competencia={competencia} competencias={competencias} onCompetencia={setEscolhida} />
        {!d ? <GradeCarregando /> : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi titulo="Valor Faturado (Bruto)" valor={d.atual.notas ? fmtBRL(d.atual.bruto) : null} icone={TrendingUp} cor="azul"
                variacao={variacaoPct(d.atual.bruto, d.anterior.bruto, true)} aviso={d.atual.notas ? null : "Nenhuma nota nesta competência"} />
              <Kpi titulo="Valor Líquido" valor={d.atual.notas ? fmtBRL(d.atual.liquido) : null} icone={CircleDollarSign} cor="verde"
                variacao={variacaoPct(d.atual.liquido, d.anterior.liquido, true)} />
              <Kpi titulo="Valor Recebido" valor={d.atual.notas ? fmtBRL(d.atual.recebido) : null} icone={Wallet} cor="azul"
                variacao={variacaoPct(d.atual.recebido, d.anterior.recebido, true)} aviso="Das notas desta competência" />
              <Kpi titulo="Saldo a Receber" valor={d.atual.notas ? fmtBRL(d.atual.aReceber) : null} icone={Clock3} cor="laranja"
                variacao={variacaoPct(d.atual.aReceber, d.anterior.aReceber, false)} aviso="Das notas desta competência" />
              <Kpi titulo="% Faturado no Prazo" valor={null} icone={Percent} cor="cinza" medida="sem_fonte" aviso="O ERP não registra o prazo de faturamento" />
              <Kpi titulo="PMR (Prazo Médio de Recebimento)" valor={d.pmr != null ? `${d.pmr} dias` : null} icone={Clock3} cor="azul"
                variacao={d.pmr != null && d.pmrAnterior != null ? { texto: `${d.pmr - d.pmrAnterior > 0 ? "+" : ""}${d.pmr - d.pmrAnterior} dias`, seta: d.pmr > d.pmrAnterior ? "sobe" : d.pmr < d.pmrAnterior ? "desce" : "igual", sentido: d.pmr > d.pmrAnterior ? "pior" : d.pmr < d.pmrAnterior ? "melhor" : "neutro" } : null}
                aviso={d.pmr == null ? "Nenhuma nota desta competência paga ainda" : "Emissão até o pagamento, notas já pagas"} />
              <Kpi titulo="Inadimplência (> 90 dias)" valor={fmtBRL(d.vencido90)} icone={AlertTriangle} cor="vermelho" medida="parcial"
                aviso="Posição de hoje; vencimento estimado: emissão + 30 dias" />
              <Kpi titulo="Notas Emitidas" valor={String(d.atual.notas)} icone={FileText} cor="azul"
                variacao={d.anterior.notas ? { texto: `${d.atual.notas - d.anterior.notas >= 0 ? "+" : ""}${d.atual.notas - d.anterior.notas}`, seta: d.atual.notas > d.anterior.notas ? "sobe" : d.atual.notas < d.anterior.notas ? "desce" : "igual", sentido: "neutro" } : null} />
            </div>

            <Tabs defaultValue="mensal">
              <TabsList>
                <TabsTrigger value="mensal">Resumo Mensal</TabsTrigger>
                <TabsTrigger value="contrato">Por Contrato</TabsTrigger>
                <TabsTrigger value="cliente">Por Cliente</TabsTrigger>
              </TabsList>
              <TabsContent value="mensal" className="mt-4">
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="p-5 lg:col-span-2">
                    <h2 className="mb-2 font-semibold text-foreground">Faturamento × Recebimento</h2>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={d.serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.6} />
                        <XAxis dataKey="competencia" tickFormatter={rotuloEixo} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={fmtCompacto} width={52} tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v: number, n: string) => [fmtBRL(v), n]} labelFormatter={(l: string) => rotuloCompetencia(l)} />
                        <Legend verticalAlign="top" align="right" iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 13, paddingBottom: 8 }} />
                        <Bar dataKey="bruto" name="Faturado" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                        <Bar dataKey="recebido" name="Recebido" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                        <Line dataKey="aReceber" name="Saldo a receber" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </Card>
                  <Card className="p-5">
                    <h2 className="mb-1 font-semibold text-foreground">Saldo a Receber por Faixa de Vencimento</h2>
                    <p className="mb-4 text-xs text-muted-foreground">Todas as notas em aberto, posição de hoje. Vencimento estimado: emissão + 30 dias.</p>
                    <BarrasHorizontais itens={d.aging} formatar={fmtBRL} destaque="> 90 dias" />
                  </Card>
                </div>
              </TabsContent>
              <TabsContent value="contrato" className="mt-4"><Card className="p-2"><TabelaTotais linhas={d.porContrato} rotulo="Contrato" /></Card></TabsContent>
              <TabsContent value="cliente" className="mt-4"><Card className="p-2"><TabelaTotais linhas={d.porCliente} rotulo="Cliente" /></Card></TabsContent>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              {rotuloCompetencia(competencia)} · empresa, base e código de nota são os escolhidos em Controladoria › Faturamento da Empresa.
            </p>
          </>
        )}
      </div>
    </AcessoGate>
  );
}
