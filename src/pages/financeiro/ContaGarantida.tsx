import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Settings, RefreshCw, AlertTriangle, BarChart3, ListChecks } from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { useBancosContaGarantida, useMovimentosContaGarantida, useCdiHistorico, useAtualizarCdi } from "@/hooks/useContaGarantida";
import {
  calcularContaGarantida, calcularKpis, diasNoChequePorMes, dividaVsAplicadoPorData,
  distribuicaoPorBanco, jurosPagosPorMes,
} from "./conta-garantida/calculos";
import { ImportarFluxoDialog } from "./conta-garantida/ImportarFluxoDialog";
import { BancosConfigDialog } from "./conta-garantida/BancosConfigDialog";

const fmtMoney = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const CORES = ["#FF6B35", "#d9534f", "#0275d8", "#00d68f", "#ffc107", "#9c27b0"];

export default function ContaGarantida() {
  const { data: bancos = [] } = useBancosContaGarantida();
  const { data: movimentos = [] } = useMovimentosContaGarantida();
  const { data: cdiHistorico = {} } = useCdiHistorico();
  const atualizarCdi = useAtualizarCdi();

  const [importarOpen, setImportarOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [filtroBanco, setFiltroBanco] = useState("TODOS");
  const [filtroPeriodo, setFiltroPeriodo] = useState("TODOS");
  const [busca, setBusca] = useState("");

  const bancosConfig = useMemo(
    () => Object.fromEntries(bancos.map((b) => [b.nome, { taxa_mensal: b.taxa_mensal, perc_cdi: b.perc_cdi }])),
    [bancos]
  );
  const bancosLimite = useMemo(
    () => Object.fromEntries(bancos.map((b) => [b.nome, { limite: b.limite }])),
    [bancos]
  );
  const bancosExcluidos = useMemo(() => new Set(bancos.filter((b) => !b.ativo).map((b) => b.nome)), [bancos]);

  const registros = useMemo(
    () => calcularContaGarantida(movimentos, bancosConfig, cdiHistorico, bancosExcluidos),
    [movimentos, bancosConfig, cdiHistorico, bancosExcluidos]
  );

  const nomesBanco = useMemo(() => ["TODOS", ...new Set(registros.map((r) => r.banco))].sort(), [registros]);
  const periodos = useMemo(
    () => ["TODOS", ...new Set(registros.map((r) => r.data.slice(0, 7)))].sort(),
    [registros]
  );

  const registrosFiltrados = useMemo(() => {
    return registros
      .filter((r) => filtroBanco === "TODOS" || r.banco === filtroBanco)
      .filter((r) => filtroPeriodo === "TODOS" || r.data.slice(0, 7) === filtroPeriodo);
  }, [registros, filtroBanco, filtroPeriodo]);

  const registrosTabela = useMemo(() => {
    const termo = busca.trim().toUpperCase();
    if (!termo) return registrosFiltrados;
    return registrosFiltrados.filter((r) => `${r.banco} ${r.tipo} ${r.classificacao}`.toUpperCase().includes(termo));
  }, [registrosFiltrados, busca]);

  const kpis = useMemo(() => calcularKpis(registrosFiltrados, bancosLimite), [registrosFiltrados, bancosLimite]);

  const hoje = new Date();
  const alertasVencimento = useMemo(
    () =>
      bancos
        .filter((b) => b.vencimento)
        .map((b) => ({ ...b, dias: Math.round((new Date(b.vencimento! + "T00:00:00").getTime() - hoje.getTime()) / 86400000) }))
        .filter((b) => b.dias <= 30),
    [bancos]
  );

  const dadosDias = useMemo(() => diasNoChequePorMes(registrosFiltrados), [registrosFiltrados]);
  const dadosCurva = useMemo(() => dividaVsAplicadoPorData(registrosFiltrados), [registrosFiltrados]);
  const dadosBancos = useMemo(() => distribuicaoPorBanco(registrosFiltrados), [registrosFiltrados]);
  const dadosJuros = useMemo(() => jurosPagosPorMes(registrosFiltrados), [registrosFiltrados]);

  async function handleAtualizarCdi() {
    try {
      await atualizarCdi.mutateAsync();
      toast.success("CDI atualizado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao atualizar CDI.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        module="Financeiro"
        breadcrumb={["Conta Garantida"]}
        title="Conta Garantida"
        subtitle="Cheque especial e rendimento de aplicação por banco, indexado ao CDI real do Bacen. Alimentado por upload manual do Fluxo de Caixa (quebra-galho até virar dado nativo)."
        actions={
          <>
            <Button variant="outline" onClick={handleAtualizarCdi} disabled={atualizarCdi.isPending}>
              <RefreshCw className="h-4 w-4 mr-2" /> Atualizar CDI
            </Button>
            <Button variant="outline" onClick={() => setConfigOpen(true)}>
              <Settings className="h-4 w-4 mr-2" /> Configurar Bancos
            </Button>
            <Button onClick={() => setImportarOpen(true)}>
              <Upload className="h-4 w-4 mr-2" /> Importar Fluxo de Caixa
            </Button>
          </>
        }
      />

      {registros.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Upload className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            Nenhum dado importado ainda. Clique em "Importar Fluxo de Caixa" pra começar.
          </p>
        </div>
      ) : (
        <>
          {alertasVencimento.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                Vencimento próximo:{" "}
                {alertasVencimento.map((b) => `${b.nome} (${b.dias <= 0 ? "vencido" : `${b.dias}d`})`).join(", ")}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Dívida", valor: kpis.divida, cor: "text-foreground" },
              { label: "Juros Pendentes", valor: kpis.jurosPendentes, cor: "text-amber-600 dark:text-amber-400" },
              { label: "Juros Pagos", valor: kpis.jurosPagos, cor: "text-blue-600 dark:text-blue-400" },
              { label: "Total a Pagar", valor: kpis.totalPagar, cor: "text-red-600 dark:text-red-400" },
              { label: "Aplicado", valor: kpis.aplicado, cor: "text-indigo-600 dark:text-indigo-400" },
              { label: "Limite Disponível", valor: kpis.limiteDisponivel, cor: "text-emerald-600 dark:text-emerald-400" },
            ].map((k) => (
              <div key={k.label} className="card-elevated p-3">
                <p className="text-[11px] text-muted-foreground">{k.label}</p>
                <p className={`text-lg font-bold ${k.cor}`}>{fmtMoney(k.valor)}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={filtroBanco} onValueChange={setFiltroBanco}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                {nomesBanco.map((b) => <SelectItem key={b} value={b}>{b === "TODOS" ? "Todos os bancos" : b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroPeriodo} onValueChange={setFiltroPeriodo}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {periodos.map((p) => <SelectItem key={p} value={p}>{p === "TODOS" ? "Todo o período" : p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Tabs defaultValue="graficos">
            <TabsList className="grid grid-cols-2 gap-1 h-auto p-1 max-w-xs">
              <TabsTrigger value="graficos" className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Gráficos</TabsTrigger>
              <TabsTrigger value="fluxo" className="flex items-center gap-2"><ListChecks className="h-4 w-4" /> Fluxo</TabsTrigger>
            </TabsList>

            <TabsContent value="graficos" className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card-elevated p-4">
                <p className="mb-2 text-sm font-semibold">Dias no Cheque Especial por Mês</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dadosDias} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip formatter={(v: number) => [`${v} dias`, "Dias"]} />
                    <Bar dataKey="dias" fill="#FF6B35" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="card-elevated p-4">
                <p className="mb-2 text-sm font-semibold">Dívida vs. Aplicação</p>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={dadosCurva} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="data" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoney(v)} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Area type="monotone" dataKey="divida" name="Dívida" stroke="#d9534f" fill="#d9534f" fillOpacity={0.25} />
                    <Area type="monotone" dataKey="aplicado" name="Investimento" stroke="#00d68f" fill="#00d68f" fillOpacity={0.2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="card-elevated p-4">
                <p className="mb-2 text-sm font-semibold">Distribuição da Dívida por Banco</p>
                {dadosBancos.length === 0 ? (
                  <p className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">Sem dívidas ativas no período.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={dadosBancos} dataKey="valor" nameKey="banco" innerRadius={55} outerRadius={85} paddingAngle={2}>
                        {dadosBancos.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className="card-elevated p-4">
                <p className="mb-2 text-sm font-semibold">Juros Pagos por Mês</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={dadosJuros} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoney(v)} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Bar dataKey="valor" name="Juros pagos" fill="#0275d8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            <TabsContent value="fluxo" className="mt-6">
              <div className="mb-3">
                <Input placeholder="Buscar por banco, tipo ou classificação" value={busca} onChange={(e) => setBusca(e.target.value)} className="max-w-sm" />
              </div>
              <div className="card-elevated overflow-hidden">
                <div className="max-h-[60vh] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Banco</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Classificação</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead className="text-right">Saldo Devedor</TableHead>
                        <TableHead className="text-right">Dias</TableHead>
                        <TableHead className="text-right">Juros Pendente</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {registrosTabela.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum movimento encontrado.</TableCell>
                        </TableRow>
                      )}
                      {registrosTabela.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{new Date(r.data + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                          <TableCell className="font-medium">{r.banco}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{r.tipo}</Badge></TableCell>
                          <TableCell className="text-xs">{r.classificacao}</TableCell>
                          <TableCell className="text-right">{fmtMoney(r.valor)}</TableCell>
                          <TableCell className="text-right">{fmtMoney(r.saldoDevedor)}</TableCell>
                          <TableCell className="text-right">{r.dias}</TableCell>
                          <TableCell className="text-right">{fmtMoney(r.jurosPendente)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      <ImportarFluxoDialog open={importarOpen} onClose={() => setImportarOpen(false)} />
      <BancosConfigDialog open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  );
}
