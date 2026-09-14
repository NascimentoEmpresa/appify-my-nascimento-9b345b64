import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { ListChecks, TrendingUp, CheckCircle2, AlertTriangle, PieChart as PieChartIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { NfEmissaoItemRow, TipoNota, TIPOS_NOTA, useItensNfEmissaoEmLote, useNfsEmissao } from "@/hooks/useNfEmissao";
import { fmtMoney, statusDaNota, pendenteHaMaisDe30Dias, valorPendenteNf, StatusNota } from "@/pages/financeiro/nf-emissao/shared";

const STATUS_LABEL: Record<StatusNota, string> = {
  pago: "Pago",
  pendente: "Pendente",
  substituida: "Substituída",
  cancelada: "Cancelada",
};
const STATUS_COR: Record<StatusNota, string> = {
  pago: "#2aa978",
  pendente: "#e2a03b",
  substituida: "#6976d9",
  cancelada: "#d75a54",
};

function competenciaCurta(c: string) {
  return new Date(c + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
}

const CAMPOS_DESCONTO: { key: keyof NfEmissaoItemRow; label: string }[] = [
  { key: "faltas", label: "Faltas" },
  { key: "posto_nao_implementado", label: "Posto não implementado" },
  { key: "multas", label: "Multas antes da NF" },
  { key: "multas_pos_emissao", label: "Multas depois da NF" },
  { key: "glosas", label: "Glosas antes da NF" },
  { key: "glosas_pos_emissao", label: "Glosas depois da NF" },
  { key: "outros_descontos", label: "Outros descontos antes da NF" },
  { key: "outros_descontos_pos_emissao", label: "Outros descontos depois da NF" },
];

export default function DashboardRelatorioServicos() {
  const { data: nfs = [], isLoading } = useNfsEmissao(null, { todasEmpresas: true });
  const { data: empresas = [] } = useEmpresasGrupo();

  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroCompetencia, setFiltroCompetencia] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusNota | "todos">("todos");
  const [filtroCodigo, setFiltroCodigo] = useState<TipoNota | "todos">("todos");
  const [filtroOver30, setFiltroOver30] = useState(false);

  const competencias = useMemo(() => {
    const base = filtroEmpresa ? nfs.filter((n) => n.empresa_id === filtroEmpresa) : nfs;
    return [...new Set(base.map((n) => n.competencia))].sort().reverse();
  }, [nfs, filtroEmpresa]);

  const linhas = useMemo(() => {
    return nfs.filter((n) => {
      if (filtroEmpresa && n.empresa_id !== filtroEmpresa) return false;
      if (filtroCompetencia && n.competencia !== filtroCompetencia) return false;
      if (filtroStatus !== "todos" && statusDaNota(n) !== filtroStatus) return false;
      if (filtroCodigo !== "todos" && n.tipo_nota !== filtroCodigo) return false;
      if (filtroOver30 && !pendenteHaMaisDe30Dias(n)) return false;
      return true;
    });
  }, [nfs, filtroEmpresa, filtroCompetencia, filtroStatus, filtroCodigo, filtroOver30]);

  const { data: itensPorNf } = useItensNfEmissaoEmLote(linhas.map((n) => n.id));

  const kpis = useMemo(() => {
    let executado = 0, faturado = 0, recebido = 0, pendente = 0, descontos = 0;
    let pagas = 0;
    for (const n of linhas) {
      const itens = itensPorNf?.get(n.id) ?? [];
      executado += n.valor_contrato_exec_total;
      faturado += n.vlr_bruto_total;
      recebido += n.valor_pago ?? 0;
      pendente += valorPendenteNf(n, itens);
      descontos += n.desconto_conta_vinculada + itens.reduce((s, it) => s + CAMPOS_DESCONTO.reduce((s2, c) => s2 + (Number(it[c.key]) || 0), 0), 0);
      if (statusDaNota(n) === "pago") pagas++;
    }
    const pctPago = linhas.length ? (pagas / linhas.length) * 100 : 0;
    const pctDescontos = executado ? (descontos / executado) * 100 : 0;
    return { executado, faturado, recebido, pendente, descontos, pctPago, pctDescontos };
  }, [linhas, itensPorNf]);

  const evolucaoMensal = useMemo(() => {
    const porComp = new Map<string, { comp: string; executado: number; faturado: number; recebido: number }>();
    for (const n of linhas) {
      const atual = porComp.get(n.competencia) ?? { comp: n.competencia, executado: 0, faturado: 0, recebido: 0 };
      atual.executado += n.valor_contrato_exec_total;
      atual.faturado += n.vlr_bruto_total;
      atual.recebido += n.valor_pago ?? 0;
      porComp.set(n.competencia, atual);
    }
    return Array.from(porComp.values())
      .sort((a, b) => a.comp.localeCompare(b.comp))
      .map((x) => ({ ...x, label: competenciaCurta(x.comp) }));
  }, [linhas]);

  const donutStatus = useMemo(() => {
    const contagem: Record<StatusNota, number> = { pago: 0, pendente: 0, substituida: 0, cancelada: 0 };
    for (const n of linhas) contagem[statusDaNota(n)]++;
    return (Object.keys(contagem) as StatusNota[]).map((s) => ({ status: s, nome: STATUS_LABEL[s], valor: contagem[s] })).filter((x) => x.valor > 0);
  }, [linhas]);

  const composicaoDescontos = useMemo(() => {
    const items = CAMPOS_DESCONTO.map(({ key, label }) => {
      let valor = 0, count = 0;
      for (const n of linhas) {
        for (const it of itensPorNf?.get(n.id) ?? []) {
          const v = Number(it[key]) || 0;
          if (v !== 0) { valor += v; count++; }
        }
      }
      return { label, valor, count };
    });
    const contaVinculada = { label: "Conta vinculada", valor: linhas.reduce((s, n) => s + n.desconto_conta_vinculada, 0), count: linhas.filter((n) => n.desconto_conta_vinculada > 0).length };
    const todos = [...items, contaVinculada];
    return { items: todos, total: todos.reduce((s, x) => s + x.valor, 0), max: Math.max(1, ...todos.map((x) => x.valor)) };
  }, [linhas, itensPorNf]);

  const rankingPendencias = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const n of linhas) {
      const nome = n.contrato?.nome ?? "Sem contrato";
      const p = valorPendenteNf(n, itensPorNf?.get(n.id) ?? []);
      mapa.set(nome, (mapa.get(nome) ?? 0) + p);
    }
    const top = Array.from(mapa.entries()).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 7);
    const max = Math.max(1, ...top.map(([, v]) => v));
    return { top, max };
  }, [linhas, itensPorNf]);

  const resumoPorCompetencia = useMemo(() => {
    return evolucaoMensal
      .slice()
      .reverse()
      .slice(0, 8)
      .map((x) => {
        const nfsComp = linhas.filter((n) => n.competencia === x.comp);
        const pendente = nfsComp.reduce((s, n) => s + valorPendenteNf(n, itensPorNf?.get(n.id) ?? []), 0);
        return { ...x, pendente };
      });
  }, [evolucaoMensal, linhas, itensPorNf]);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-10 text-center">Carregando...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs">
        <Select value={filtroEmpresa || "__todas"} onValueChange={(v) => { setFiltroEmpresa(v === "__todas" ? "" : v); setFiltroCompetencia(""); }}>
          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__todas">Todas as empresas</SelectItem>
            {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroCompetencia || "__todas"} onValueChange={(v) => setFiltroCompetencia(v === "__todas" ? "" : v)}>
          <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder="Competência" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__todas">Todas</SelectItem>
            {competencias.map((c) => <SelectItem key={c} value={c}>{competenciaCurta(c)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as StatusNota | "todos")}>
          <SelectTrigger className="h-8 w-28 text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {(Object.keys(STATUS_LABEL) as StatusNota[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filtroCodigo} onValueChange={(v) => setFiltroCodigo(v as TipoNota | "todos")}>
          <SelectTrigger className="h-8 w-24 text-xs"><SelectValue placeholder="Código" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            {(Object.keys(TIPOS_NOTA) as TipoNota[]).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <button
          onClick={() => setFiltroOver30((v) => !v)}
          className={cn(
            "px-2.5 py-1.5 rounded-full border font-medium transition-colors",
            filtroOver30 ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"
          )}
        >
          Pendente há mais de 30 dias
        </button>
        <span className="text-muted-foreground ml-auto">Códigos: N · R · M · DH</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KpiTile label="Valor Executado" valor={fmtMoney(kpis.executado)} icon={<ListChecks />} cor="slate" />
        <KpiTile label="Valor Faturado" valor={fmtMoney(kpis.faturado)} icon={<TrendingUp />} cor="sky" />
        <KpiTile label="Valor Recebido" valor={fmtMoney(kpis.recebido)} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
        <KpiTile
          label="Valor Pendente"
          valor={fmtMoney(kpis.pendente)}
          sub={`${kpis.pctPago.toFixed(1).replace(".", ",")}% das notas pagas`}
          icon={<AlertTriangle />}
          cor="red"
          valorClass="text-red-600 dark:text-red-400"
        />
        <KpiTile
          label="Total de Descontos"
          valor={fmtMoney(kpis.descontos)}
          sub={kpis.executado ? `${kpis.pctDescontos.toFixed(1).replace(".", ",")}% do executado` : undefined}
          icon={<PieChartIcon />}
          cor="amber"
          valorClass="text-amber-600 dark:text-amber-400"
        />
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Evolução por competência — todas as empresas</CardTitle></CardHeader>
        <CardContent>
          {evolucaoMensal.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">Sem dados para os filtros selecionados.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={evolucaoMensal} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(v) => fmtMoney(v)} width={90} />
                <Tooltip formatter={(v: number) => fmtMoney(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="executado" name="Executado" fill="#9bb4d3" radius={[4, 4, 0, 0]} />
                <Bar dataKey="faturado" name="Faturado" fill="#315f99" radius={[4, 4, 0, 0]} />
                <Bar dataKey="recebido" name="Recebido" fill="#2aa978" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Situação das notas</CardTitle></CardHeader>
          <CardContent className="flex-1">
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={donutStatus} dataKey="valor" nameKey="nome" cx="50%" cy="50%" innerRadius={48} outerRadius={72} paddingAngle={2}>
                  {donutStatus.map((d) => <Cell key={d.status} fill={STATUS_COR[d.status]} />)}
                </Pie>
                <Tooltip formatter={(v: number, n: string) => [`${v} nota(s)`, n]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-3 mt-2 text-[11px] text-muted-foreground">
              {donutStatus.map((d) => (
                <span key={d.status} className="inline-flex items-center gap-1.5">
                  <i className="inline-block h-2 w-2 rounded-sm" style={{ background: STATUS_COR[d.status] }} />
                  {d.nome} ({d.valor})
                </span>
              ))}
              {donutStatus.length === 0 && <span>Sem notas para os filtros selecionados.</span>}
            </div>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Maiores valores pendentes por contrato</CardTitle></CardHeader>
          <CardContent className="flex-1 flex flex-col justify-evenly gap-3">
            {rankingPendencias.top.length === 0 && <p className="text-sm text-muted-foreground text-center">Nenhum valor pendente.</p>}
            {rankingPendencias.top.map(([nome, valor]) => (
              <div key={nome}>
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className="font-medium truncate" title={nome}>{nome}</span>
                  <span className="text-muted-foreground shrink-0">{fmtMoney(valor)}</span>
                </div>
                <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-amber-500" style={{ width: `${(valor / rankingPendencias.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Composição dos descontos</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Total de descontos identificados nos registros filtrados: <strong className="text-foreground">{fmtMoney(composicaoDescontos.total)}</strong>
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {composicaoDescontos.items.map((it) => (
              <div key={it.label}>
                <div className="flex items-center justify-between gap-2 text-xs mb-1">
                  <span className="font-medium truncate" title={it.label}>{it.label} <span className="text-muted-foreground font-normal">({it.count} registros)</span></span>
                  <span className="text-muted-foreground shrink-0">{fmtMoney(it.valor)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-orange-400" style={{ width: `${(it.valor / composicaoDescontos.max) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Resumo por competência</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-center">Competência</TableHead>
                <TableHead className="text-center">Faturado</TableHead>
                <TableHead className="text-center">Recebido</TableHead>
                <TableHead className="text-center">Pendente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumoPorCompetencia.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sem dados.</TableCell></TableRow>
              )}
              {resumoPorCompetencia.map((x) => (
                <TableRow key={x.comp}>
                  <TableCell className="text-center font-medium">{x.label}</TableCell>
                  <TableCell className="text-center">{fmtMoney(x.faturado)}</TableCell>
                  <TableCell className="text-center">{fmtMoney(x.recebido)}</TableCell>
                  <TableCell className="text-center">{fmtMoney(x.pendente)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
