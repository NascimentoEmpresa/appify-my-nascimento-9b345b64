import { Link } from "react-router-dom";
import { ArrowRight, Loader2, ShieldAlert } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useRelatorioGeral } from "@/hooks/useRelatoriosDiretoria";
import { fmtKpi, MENU_IA, rotuloMes, SISTEMAS, type RelatorioDados } from "./sistemas";
import { GraficoMensal, PainelIA, SeletorPeriodo, usePeriodo } from "./componentes";

// =====================================================================
// DIRETORIA E PRESIDÊNCIA › RELATÓRIO GERAL (mig 20261005000006)
//
// Pedido (05/10/2026): "RELATÓRIO GERAL vai ter relatório de TODOS os
// sistemas de solicitações … gráfico pra tudo, e I.A integrada pra gerar
// análises". Uma chamada só (dir_rel_geral) traz os 10 relatórios; aqui:
// um cartão com mini-gráfico por sistema (clique abre o relatório
// completo), a I.A, o comparativo entre sistemas e quadro + turn-over.
// =====================================================================

const SOLICITACOES = SISTEMAS.filter((s) => !["colaboradores", "turnover"].includes(s.slug));

function MiniGrafico({ r, cor }: { r: RelatorioDados; cor: string }) {
  const chave = r.mensal.series[0]?.chave ?? "total";
  return (
    <ResponsiveContainer width="100%" height={56}>
      <BarChart data={r.mensal.dados} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <Tooltip labelFormatter={(m) => rotuloMes(String(m))} formatter={(v) => [v, r.mensal.series[0]?.rotulo ?? ""]} />
        <XAxis dataKey="mes" hide />
        <Bar dataKey={chave} fill={cor} radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function RelatorioGeral() {
  const periodo = usePeriodo();
  const q = useRelatorioGeral(periodo.de, periodo.ate);
  const g = q.data;

  // Comparativo: concluídas, em andamento, recusadas e tempo de cada sistema de solicitação.
  const comparativo = g ? SOLICITACOES.map((s) => {
    const k = g[s.slug]?.kpis ?? [];
    return { nome: s.titulo, total: k[0]?.valor ?? 0, andamento: k[1]?.valor ?? 0, concluidas: k[2]?.valor ?? 0, recusadas: k[3]?.valor ?? 0, tempo: k[4]?.valor ?? null };
  }) : [];

  // Abertas por mês, uma linha por sistema.
  const meses = g?.recrutamento?.mensal.dados.map((d) => d.mes) ?? [];
  const porMes = meses.map((m) => {
    const linha: Record<string, string | number> = { mes: rotuloMes(m) };
    SOLICITACOES.forEach((s) => { linha[s.titulo] = Number(g?.[s.slug]?.mensal.dados.find((d) => d.mes === m)?.total ?? 0); });
    return linha;
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Relatório Geral" subtitle="Todos os sistemas de solicitação, o quadro de colaboradores e o turn-over — com análise por I.A."
        module="Diretoria e Presidência" breadcrumb={["Diretoria", "Relatórios", "Relatório Geral"]} />
      <div className="flex justify-end"><SeletorPeriodo periodo={periodo} /></div>

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando os 10 relatórios…</Card>
      ) : q.error || !g ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {SISTEMAS.map((s) => {
              const r = g[s.slug];
              if (!r) return null;
              const Icone = s.icone;
              const [k1, k2, k3] = r.kpis;
              return (
                <Link key={s.slug} to={`/app/diretoria/relatorios/${s.slug}`}
                  className="group rounded-xl border bg-card p-3 transition hover:-translate-y-0.5 hover:shadow-lg">
                  <div className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: `${s.cor}1a`, color: s.cor }}><Icone className="h-4 w-4" /></span>
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">{s.titulo}</p>
                    <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                  </div>
                  <p className="mt-2 text-2xl font-bold tabular-nums">{fmtKpi(k1?.valor, k1?.formato ?? "n")}</p>
                  <p className="text-[11px] text-muted-foreground">{k1?.rotulo}</p>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    {k2 && <span><b className="text-foreground">{fmtKpi(k2.valor, k2.formato)}</b> {k2.rotulo.toLowerCase()}</span>}
                    {k3 && <span><b className="text-foreground">{fmtKpi(k3.valor, k3.formato)}</b> {k3.rotulo.toLowerCase()}</span>}
                  </div>
                  <MiniGrafico r={r} cor={s.cor} />
                </Link>
              );
            })}
          </div>

          <AcessoGate menu={MENU_IA} acao="visualizar">
            <PainelIA sistema="geral" de={periodo.de} ate={periodo.ate} titulo="Relatório Geral" />
          </AcessoGate>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Solicitações por sistema no período</p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={comparativo} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="concluidas" name="Concluídas" stackId="a" fill="#16a34a" />
                  <Bar dataKey="andamento" name="Em andamento" stackId="a" fill="#f59e0b" />
                  <Bar dataKey="recusadas" name="Recusadas" stackId="a" fill="#dc2626" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Tempo médio até concluir (dias)</p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={comparativo.filter((c) => c.tempo != null)} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v} dias`, "Tempo médio"]} />
                  <Bar dataKey="tempo" fill="#0891b2" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11 }} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold">Solicitações abertas por mês, por sistema</p>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={porMes} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {SOLICITACOES.map((s) => <Line key={s.slug} type="monotone" dataKey={s.titulo} stroke={s.cor} strokeWidth={2} dot={false} />)}
              </LineChart>
            </ResponsiveContainer>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {g.colaboradores && <Card className="p-4"><p className="mb-2 text-sm font-semibold">Quadro de colaboradores</p><GraficoMensal r={g.colaboradores} /></Card>}
            {g.turnover && <Card className="p-4"><p className="mb-2 text-sm font-semibold">Turn-over</p><GraficoMensal r={g.turnover} /></Card>}
          </div>
        </>
      )}
    </div>
  );
}
