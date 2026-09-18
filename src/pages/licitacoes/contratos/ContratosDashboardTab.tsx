import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KpiTile } from "@/components/financeiro/KpiTile";
import {
  FileText, Database, BarChart3, TrendingUp, PieChart as PieChartIcon, CalendarClock,
  AlertTriangle, Clock3, FileWarning, ArrowRightLeft, LineChart,
} from "lucide-react";
import type { ContratoERP } from "@/hooks/useContratosERP";
import {
  fmt, fmtData, vigenciaInfo, AVISO_VIGENCIA_LABEL, AVISO_VIGENCIA_COLOR, STATUS_LABEL,
} from "../ContratosERP";
import { useResumoPendencias } from "@/hooks/useChecklistFaturamento";
import { anoMesAtual } from "@/hooks/usePlanilhaCusto";

// SIS-2026-0325 (achado tardio — mockup do dashboard só apareceu depois da
// tela de lista já entregue): visão executiva de "Controle de Contratos",
// convivendo com a Lista via aba no topo de ContratosERP.tsx. Reaproveita
// os mesmos dados já carregados lá (contratos/agregadosPorContrato) — não
// faz fetch próprio de contrato/planilha.
//
// Duas coisas do mockup original ficaram de fora por falta de fonte de
// dado (decisão do usuário: registrar dado novo agora, resolver quando
// tiver histórico):
// - Setas de tendência (▲12% "em relação ao mês/ano anterior") — não existe
//   snapshot histórico de KPI.
// - Gráfico de linha "Valor contratado x executado" ao longo dos meses —
//   mesma razão; `contratos`/`planilha_custo` só guardam o valor vigente
//   atual, não uma série temporal.

const CORES_STATUS: Record<string, string> = {
  em_vigencia: "#10b981",
  a_vencer: "#f59e0b",
  vencido: "#f43f5e",
  finalizado: "#94a3b8",
};

interface EmpresaOpcao {
  id: string;
  nome: string;
}

export type FiltroDashboard = { aba?: "execucao_real" | "em_vigencia" | "a_vencer" | "finalizados"; empresaId?: string };

export function ContratosDashboardTab({
  contratos,
  empresasGrupo,
  agregadosPorContrato,
  onVerLista,
}: {
  contratos: ContratoERP[];
  empresasGrupo: EmpresaOpcao[];
  agregadosPorContrato: Map<string, { valorExecMensal: number; custoIndiretoMensal: number; lucroMensal: number; quantExecCalc: number }>;
  onVerLista: (filtro?: FiltroDashboard) => void;
}) {
  const [filtroEmpresaId, setFiltroEmpresaId] = useState("todas");
  const [filtroStatus, setFiltroStatus] = useState("todos");

  const competenciaISO = `${anoMesAtual()}-01`;
  const { data: resumoPendencias } = useResumoPendencias(competenciaISO);

  // Cada contrato ganha seu "status de vigência" (mesmo critério da coluna
  // Aviso de Vigência da Lista) — Finalizado prevalece sobre a data quando
  // o contrato já está com status "encerrado".
  const contratosComStatus = useMemo(() => {
    return contratos.map((c) => {
      const vi = vigenciaInfo(c);
      const statusDash = c.status === "encerrado" ? "finalizado" : (vi.avisoVigencia ?? "em_vigencia");
      return { contrato: c, vi, statusDash };
    });
  }, [contratos]);

  const filtrados = useMemo(() => {
    return contratosComStatus.filter((r) => {
      if (filtroEmpresaId !== "todas" && r.contrato.empresa_id !== filtroEmpresaId) return false;
      if (filtroStatus !== "todos" && r.statusDash !== filtroStatus) return false;
      return true;
    });
  }, [contratosComStatus, filtroEmpresaId, filtroStatus]);

  const kpis = useMemo(() => {
    let valorContratado = 0, valorExecutado = 0, lucroMensal = 0, custoMaisLucro = 0, aVencer = 0;
    for (const { contrato: c, statusDash } of filtrados) {
      const ag = agregadosPorContrato.get(c.id);
      valorContratado += c.valor_mensal_contratado ?? 0;
      valorExecutado += c.valor_executado_mensal ?? 0;
      lucroMensal += ag?.lucroMensal ?? 0;
      custoMaisLucro += (ag?.custoIndiretoMensal ?? 0) + (ag?.lucroMensal ?? 0);
      if (statusDash === "a_vencer") aVencer++;
    }
    return {
      total: filtrados.length,
      valorContratadoAno: valorContratado * 12,
      valorExecutadoAno: valorExecutado * 12,
      lucroMensal,
      custoMaisLucro,
      aVencer,
    };
  }, [filtrados, agregadosPorContrato]);

  const statusDonut = useMemo(() => {
    const contagem: Record<string, number> = { em_vigencia: 0, a_vencer: 0, vencido: 0, finalizado: 0 };
    for (const { statusDash } of filtrados) contagem[statusDash] = (contagem[statusDash] ?? 0) + 1;
    return [
      { chave: "em_vigencia", nome: "Em vigência", valor: contagem.em_vigencia },
      { chave: "a_vencer", nome: "A vencer", valor: contagem.a_vencer },
      { chave: "vencido", nome: "Vencido", valor: contagem.vencido },
      { chave: "finalizado", nome: "Finalizado", valor: contagem.finalizado },
    ].filter((d) => d.valor > 0);
  }, [filtrados]);

  const porEmpresa = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const { contrato: c } of filtrados) contagem.set(c.empresa_id, (contagem.get(c.empresa_id) ?? 0) + 1);
    return empresasGrupo
      .map((e) => ({ nome: e.nome, total: contagem.get(e.id) ?? 0 }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [filtrados, empresasGrupo]);

  const top5PorValor = useMemo(() => {
    return [...filtrados]
      .filter((r) => (r.contrato.valor_mensal_contratado ?? 0) > 0)
      .sort((a, b) => (b.contrato.valor_mensal_contratado ?? 0) - (a.contrato.valor_mensal_contratado ?? 0))
      .slice(0, 5)
      .map((r) => ({ nome: r.contrato.nome, valor: r.contrato.valor_mensal_contratado ?? 0 }));
  }, [filtrados]);

  const proximosVencimentos = useMemo(() => {
    return filtrados
      .filter((r) => r.statusDash === "a_vencer" || r.statusDash === "vencido")
      .sort((a, b) => (a.vi.diasParaFinalizar ?? 0) - (b.vi.diasParaFinalizar ?? 0))
      .slice(0, 8);
  }, [filtrados]);

  // "Divergência financeira": valor executado (manual, digitado no Novo
  // Contrato) foge do valor contratado em mais de 5% — não é comparado
  // contra o agregado calculado da Planilha de Custo, que já tem seu
  // próprio uso de conferência na tela de edição do contrato.
  const divergenciasFinanceiras = useMemo(() => {
    return filtrados.filter((r) => {
      const contratado = r.contrato.valor_mensal_contratado;
      const executado = r.contrato.valor_executado_mensal;
      if (!contratado || executado === null || executado === undefined) return false;
      return Math.abs(executado - contratado) / contratado > 0.05;
    }).length;
  }, [filtrados]);

  const documentosPendentes = useMemo(() => {
    if (!resumoPendencias) return 0;
    return filtrados.filter((r) => (resumoPendencias.get(r.contrato.id)?.pendentes ?? 0) > 0).length;
  }, [filtrados, resumoPendencias]);

  const contratosVencidos = filtrados.filter((r) => r.statusDash === "vencido").length;

  return (
    <div className="flex flex-col gap-4">
      {/* Filtros — Empresa/Status têm dado real; "Unidade" e "Período de
          referência" do mockup ficaram fora: não existe campo "unidade" no
          cadastro hoje, e período de referência só faria sentido de verdade
          com o histórico mensal que ainda não temos (ver nota do topo). */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filtroEmpresaId} onValueChange={setFiltroEmpresaId}>
          <SelectTrigger className="h-8 w-56 text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas as empresas</SelectItem>
            {empresasGrupo.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="em_vigencia">Em vigência</SelectItem>
            <SelectItem value="a_vencer">A vencer</SelectItem>
            <SelectItem value="vencido">Vencido</SelectItem>
            <SelectItem value="finalizado">Finalizado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiTile label="Total de Contratos" valor={String(kpis.total)} icon={<FileText />} cor="slate" onClick={() => onVerLista()} />
        <KpiTile label="Valor Contratado no Ano" valor={fmt(kpis.valorContratadoAno)} icon={<Database />} cor="sky" onClick={() => onVerLista()} />
        <KpiTile label="Valor Executado no Ano" valor={fmt(kpis.valorExecutadoAno)} icon={<BarChart3 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" onClick={() => onVerLista()} />
        <KpiTile label="Lucro Mensal" valor={fmt(kpis.lucroMensal)} icon={<TrendingUp />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" onClick={() => onVerLista()} />
        <KpiTile label="Custo + Lucro Mensal" valor={fmt(kpis.custoMaisLucro)} icon={<PieChartIcon />} cor="sky" onClick={() => onVerLista()} />
        <KpiTile
          label="Contratos a Vencer"
          valor={String(kpis.aVencer)}
          sub="nos próximos 90 dias"
          icon={<CalendarClock />}
          cor="amber"
          valorClass="text-amber-600 dark:text-amber-400"
          onClick={() => onVerLista({ aba: "a_vencer" })}
        />
      </div>

      {/* Gráficos — linha 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Contratos por Empresa</CardTitle>
            <button className="text-xs text-primary hover:underline" onClick={() => onVerLista()}>Ver detalhes →</button>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={porEmpresa} margin={{ left: -20, right: 8, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="nome" stroke="#94a3b8" fontSize={10} />
                <YAxis stroke="#94a3b8" fontSize={10} allowDecimals={false} />
                <Tooltip formatter={(v: number) => [`${v} contrato(s)`, ""]} />
                <Bar dataKey="total" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Status dos Contratos</CardTitle>
            <button className="text-xs text-primary hover:underline" onClick={() => onVerLista()}>Ver detalhes →</button>
          </CardHeader>
          <CardContent>
            {/* Total centralizado sobreposto ao donut — posicionamento
                absoluto restrito a este container (não empurra o resto do
                card pra cima com margem negativa, que colidia com a
                legenda abaixo). */}
            <div className="relative">
              <ResponsiveContainer width="100%" height={190}>
                <PieChart>
                  <Pie data={statusDonut} dataKey="valor" nameKey="nome" cx="50%" cy="50%" innerRadius={52} outerRadius={78} paddingAngle={2}>
                    {statusDonut.map((d) => <Cell key={d.chave} fill={CORES_STATUS[d.chave]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number, n: string) => [`${v} contrato(s)`, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold">{filtrados.length}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">contratos</span>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-3 mt-2 text-[11px] text-muted-foreground">
              {statusDonut.map((d) => (
                <span key={d.chave} className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CORES_STATUS[d.chave] }} />
                  {d.nome} ({d.valor})
                </span>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col items-center justify-center text-center p-4">
          <LineChart className="h-8 w-8 text-muted-foreground/40 mb-2" />
          <p className="text-xs font-semibold text-muted-foreground">Valor Contratado x Valor Executado</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            Ainda não temos histórico mensal suficiente pra este gráfico. Assim que a área começar a
            registrar os valores mês a mês, ele aparece aqui.
          </p>
        </Card>
      </div>

      {/* Gráficos/tabelas — linha 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Top 5 Contratos por Valor</CardTitle>
            <button className="text-xs text-primary hover:underline" onClick={() => onVerLista()}>Ver detalhes →</button>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={top5PorValor} layout="vertical" margin={{ left: 8, right: 32, top: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" stroke="#94a3b8" fontSize={10} tickFormatter={(v) => fmt(v)} />
                <YAxis type="category" dataKey="nome" stroke="#64748b" fontSize={10} width={120} />
                <Tooltip formatter={(v: number) => [fmt(v), "Valor mensal"]} />
                <Bar dataKey="valor" fill="#2563eb" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Próximos Vencimentos</CardTitle>
            <button className="text-xs text-primary hover:underline" onClick={() => onVerLista({ aba: "a_vencer" })}>Ver todos →</button>
          </CardHeader>
          <CardContent className="p-0">
            {proximosVencimentos.length === 0 ? (
              <p className="text-xs text-muted-foreground p-4">Nenhum contrato a vencer ou vencido.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-[10px] text-muted-foreground border-b border-border">
                  <tr>
                    <th className="text-left font-medium py-1.5 px-3">Contrato</th>
                    <th className="text-left font-medium py-1.5 px-3">Cidade</th>
                    <th className="text-right font-medium py-1.5 px-3">Dias</th>
                    <th className="text-left font-medium py-1.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {proximosVencimentos.map(({ contrato: c, vi }) => (
                    <tr key={c.id}>
                      <td className="py-1.5 px-3 font-medium">{c.nome}</td>
                      <td className="py-1.5 px-3 text-muted-foreground">{c.cidade ?? "—"}</td>
                      <td className="py-1.5 px-3 text-right">{vi.diasParaFinalizar}</td>
                      <td className="py-1.5 px-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${AVISO_VIGENCIA_COLOR[vi.avisoVigencia ?? "em_vigencia"]}`} />
                          {AVISO_VIGENCIA_LABEL[vi.avisoVigencia ?? "em_vigencia"]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">Alertas e Pendências</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <button
              className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-muted/50 transition-colors"
              onClick={() => onVerLista({ aba: "a_vencer" })}
            >
              <AlertTriangle className="h-5 w-5 text-rose-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold">{contratosVencidos} Contratos Vencidos</p>
                <p className="text-[11px] text-muted-foreground">Necessitam de ação imediata</p>
              </div>
            </button>
            <button
              className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-muted/50 transition-colors"
              onClick={() => onVerLista({ aba: "a_vencer" })}
            >
              <Clock3 className="h-5 w-5 text-amber-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold">{kpis.aVencer} Contratos a Vencer (até 90 dias)</p>
                <p className="text-[11px] text-muted-foreground">Acompanhe e planeje as renovações</p>
              </div>
            </button>
            <button
              className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-muted/50 transition-colors"
              onClick={() => onVerLista()}
            >
              <FileWarning className="h-5 w-5 text-blue-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold">{documentosPendentes} Documentos Pendentes</p>
                <p className="text-[11px] text-muted-foreground">Contratos com documentação incompleta (Checklist de Faturamento)</p>
              </div>
            </button>
            <button
              className="flex items-center gap-3 rounded-lg p-2 text-left hover:bg-muted/50 transition-colors"
              onClick={() => onVerLista()}
            >
              <ArrowRightLeft className="h-5 w-5 text-violet-500 shrink-0" />
              <div>
                <p className="text-sm font-semibold">{divergenciasFinanceiras} Divergências Financeiras</p>
                <p className="text-[11px] text-muted-foreground">Valores executados fora do previsto (mais de 5%)</p>
              </div>
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
