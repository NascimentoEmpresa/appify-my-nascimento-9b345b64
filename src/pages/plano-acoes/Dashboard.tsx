import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { usePlanoAcoes } from "@/hooks/usePlanoAcoes";
import { usePlanoAcaoPermissao } from "@/hooks/usePlanoAcaoPermissao";
import { usePlanoAcaoFilterOptions, matchResponsavel, matchTexto, manterValidos } from "@/hooks/usePlanoAcaoFilterOptions";
import type { SearchableOption } from "@/components/ui/searchable-select";
import {
  STATUS_LABELS, STATUS_COR, PRIORIDADE_LABEL, PRIORIDADE_COR,
  COMITES_FILTRO, SETORES_FILTRO, TIPO_ACAO_OPTIONS, TIPO_ACAO_LABEL,
} from "@/types/planoAcao";
import { ForbiddenCard } from "./Lista";
import { KpiCard as Kpi } from "./KpiCard";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, FileQuestion,
  Users, ListChecks, Target, Layers,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";

const COLORS = ["hsl(var(--primary))","hsl(var(--accent))","#16a34a","#f59e0b","#ef4444","#6366f1","#06b6d4","#a855f7"];
const OPCOES_TIPO: SearchableOption[] = TIPO_ACAO_OPTIONS.map(t => ({ value: t, label: TIPO_ACAO_LABEL[t] }));

export default function PlanoAcoesDashboard() {
  const { data: rows = [], isLoading } = usePlanoAcoes();
  const { can, loading } = usePlanoAcaoPermissao();

  // Comitê/Setor saem de listas fixas (SIS-2026-0612); o dropdown antigo de
  // "Setor" lia a coluna `setor`, sempre vazia, e foi removido.
  const [fComite, setFComite] = useState<string[]>([]);
  const [fArea, setFArea] = useState<string[]>([]);
  const [fTipo, setFTipo] = useState<string[]>([]);
  const [fResp, setFResp] = useState<string[]>([]);
  const [fEmpresa, setFEmpresa] = useState<string[]>([]);
  const { responsaveis, empresas } = usePlanoAcaoFilterOptions(rows);

  // manterValidos devolve a mesma referência quando nada muda — sem re-render.
  useEffect(() => {
    setFComite(prev => manterValidos(prev, COMITES_FILTRO));
    setFArea(prev => manterValidos(prev, SETORES_FILTRO));
    setFResp(prev => manterValidos(prev, responsaveis));
    setFEmpresa(prev => manterValidos(prev, empresas));
  }, [responsaveis, empresas]);

  const filteredRows = useMemo(() => rows.filter(r => {
    if (!matchTexto(r.comite, fComite)) return false;
    if (!matchTexto(r.area, fArea)) return false;
    if (fTipo.length > 0 && !fTipo.includes(r.tipo_acao)) return false;
    if (!matchResponsavel(r, fResp)) return false;
    if (fEmpresa.length > 0 && !fEmpresa.includes(r.empresa_id)) return false;
    return true;
  }), [rows, fComite, fArea, fTipo, fResp, fEmpresa]);

  const stats = useMemo(() => {
    const byStatus = new Map<string, number>();
    const byPrior = new Map<string, number>();
    const byArea = new Map<string, number>();
    const byComite = new Map<string, number>();
    const byResp = new Map<string, number>();
    let semResp = 0, semDatas = 0, pendEvid = 0, atrasadas = 0, validadas = 0, aguard = 0;
    filteredRows.forEach(r => {
      byStatus.set(r.status_normalizado, (byStatus.get(r.status_normalizado) ?? 0) + 1);
      const p = r.prioridade_normalizada ?? "nao_informada";
      byPrior.set(p, (byPrior.get(p) ?? 0) + 1);
      if (r.area) byArea.set(r.area, (byArea.get(r.area) ?? 0) + 1);
      if (r.comite) byComite.set(r.comite, (byComite.get(r.comite) ?? 0) + 1);
      const resp = r.responsavel_nome_origem ?? "Sem responsável";
      byResp.set(resp, (byResp.get(resp) ?? 0) + 1);
      if (r.pendencia_responsavel) semResp++;
      if (r.pendencia_datas) semDatas++;
      if (r.pendencia_evidencia) pendEvid++;
      if (r.status_normalizado === "atrasada") atrasadas++;
      if (r.status_normalizado === "concluida_validada") validadas++;
      if (r.status_normalizado === "aguardando_validacao") aguard++;
    });
    return { byStatus, byPrior, byArea, byComite, byResp, semResp, semDatas, pendEvid, atrasadas, validadas, aguard };
  }, [filteredRows]);

  if (loading) return null;
  if (!can("dashboard")) return <ForbiddenCard />;

  const total = filteredRows.length;
  const dataStatus = Array.from(stats.byStatus.entries()).map(([k, v]) => ({ name: STATUS_LABELS[k] ?? k, value: v, key: k }));
  const dataArea = Array.from(stats.byArea.entries()).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
  const dataComite = Array.from(stats.byComite.entries()).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
  const dataResp = Array.from(stats.byResp.entries()).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value).slice(0, 10);
  const dataPrior = Array.from(stats.byPrior.entries()).map(([k, v]) => ({ name: PRIORIDADE_LABEL[k] ?? k, value: v, key: k }));

  return (
    <div>
      <PageHeader
        title="Dashboard — Plano de Ações"
        subtitle="Visão executiva consolidada do gerenciamento de tarefas Nascimento"
        module="Plano de Ações"
        breadcrumb={["Dashboard"]}
        actions={<Link to="/app/plano-acoes" className="text-sm text-primary hover:underline">Ver lista completa →</Link>}
      />

      <Card className="mb-4 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SearchableMultiSelect value={fComite} onChange={setFComite} options={COMITES_FILTRO} placeholder="Todos os comitês" searchPlaceholder="Buscar comitê..." maxBadges={2} />
          <SearchableMultiSelect value={fArea} onChange={setFArea} options={SETORES_FILTRO} placeholder="Todos os setores" searchPlaceholder="Buscar setor..." maxBadges={2} />
          <SearchableMultiSelect value={fTipo} onChange={setFTipo} options={OPCOES_TIPO} placeholder="Todos os tipos" searchPlaceholder="Buscar tipo..." maxBadges={2} />
          <SearchableMultiSelect value={fResp} onChange={setFResp} options={responsaveis} placeholder="Todos os responsáveis" searchPlaceholder="Buscar responsável..." maxBadges={2} />
          <SearchableMultiSelect value={fEmpresa} onChange={setFEmpresa} options={empresas} placeholder="Todas as empresas" searchPlaceholder="Buscar empresa..." maxBadges={2} />
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{filteredRows.length} de {rows.length} ações</p>
      </Card>


      {/* KPIs */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Total de ações" value={total} icon={ListChecks} />
        <Kpi label="Em andamento" value={stats.byStatus.get("em_andamento") ?? 0} icon={Activity} tone="primary" />
        <Kpi label="A definir / Não iniciadas" value={(stats.byStatus.get("a_definir") ?? 0) + (stats.byStatus.get("nao_iniciada") ?? 0)} icon={FileQuestion} />
        <Kpi label="Atrasadas" value={stats.atrasadas} icon={AlertTriangle} tone="destructive" />
        <Kpi label="Concluídas validadas" value={stats.validadas} icon={CheckCircle2} tone="success" />
        <Kpi label="Aguardando validação" value={stats.aguard} icon={Clock} tone="warning" />
        <Kpi label="Pend. evidência (legado)" value={stats.pendEvid} icon={Clock} tone="warning" />
        <Kpi label="Sem responsável" value={stats.semResp} icon={Users} tone="warning" />
        <Kpi label="Sem datas planejadas" value={stats.semDatas} icon={Target} tone="warning" />
        <Kpi label="Comitês ativos" value={stats.byComite.size} icon={Layers} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Ações por status</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataStatus} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={170} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0,6,6,0]}>
                  {dataStatus.map((e, i) => <Cell key={i} fill={STATUS_COR_HEX(e.key)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Ações por prioridade</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dataPrior} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {dataPrior.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Top 10 responsáveis</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dataResp} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
                <Tooltip />
                <Bar dataKey="value" fill="hsl(var(--accent))" radius={[0,6,6,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Ações por área / comitê</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Áreas</p>
              <div className="space-y-1.5">
                {dataArea.map(a => (
                  <div key={a.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{a.name}</span>
                    <Badge variant="secondary" className="text-[10px]">{a.value}</Badge>
                  </div>
                ))}
                {dataArea.length === 0 && <p className="text-xs text-muted-foreground">Sem áreas cadastradas.</p>}
              </div>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Comitês</p>
              <div className="space-y-1.5">
                {dataComite.map(a => (
                  <div key={a.name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{a.name}</span>
                    <Badge variant="secondary" className="text-[10px]">{a.value}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </div>
      {isLoading && <p className="mt-4 text-center text-xs text-muted-foreground">Carregando dados...</p>}
    </div>
  );
}

function STATUS_COR_HEX(key: string) {
  switch (key) {
    case "em_andamento": return "hsl(var(--primary))";
    case "atrasada": return "#ef4444";
    case "concluida_validada": return "#16a34a";
    case "concluida_pendente_evidencia":
    case "aguardando_validacao": return "#f59e0b";
    case "nao_iniciada":
    case "a_definir": return "#94a3b8";
    case "cancelada": return "#475569";
    default: return "hsl(var(--primary))";
  }
}
