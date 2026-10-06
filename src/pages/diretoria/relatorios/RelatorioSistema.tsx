import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useRelatorio } from "@/hooks/useRelatoriosDiretoria";
import { MENU_IA, sistemaPorSlug } from "./sistemas";
import TurnoverPainel from "./TurnoverPainel";
import {
  GraficoMensal, GraficoRanking, GraficoStatus, LinhaKpis, PainelIA, SeletorPeriodo, TabelaRecentes, usePeriodo,
} from "./componentes";

// =====================================================================
// DIRETORIA › RELATÓRIOS › <sistema> (mig 20261005000006)
// Uma tela para os 10 relatórios: KPIs, evolução mensal, status, rankings,
// últimos registros e análise com I.A. A RPC (dir_rel_<sistema>) cobra o
// acesso: o menu do relatório OU o Relatório Geral.
// =====================================================================

export default function RelatorioSistema({ slug }: { slug: string }) {
  // Turn-over tem tela própria no formato do Power BI (mig 20261006000003).
  // O Relatório Geral continua lendo o dir_rel_turnover padrão.
  return slug === "turnover" ? <TurnoverPainel /> : <RelatorioPadrao slug={slug} />;
}

function RelatorioPadrao({ slug }: { slug: string }) {
  const s = sistemaPorSlug(slug)!;
  const periodo = usePeriodo();
  const q = useRelatorio(s.rpc, periodo.de, periodo.ate);
  const r = q.data;
  const Icone = s.icone;

  return (
    <div className="space-y-4">
      <PageHeader title={s.titulo} subtitle={s.descricao} module="Diretoria e Presidência" breadcrumb={["Diretoria", "Relatórios", s.titulo]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to="/app/diretoria/relatorios" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          <ArrowLeft className="h-4 w-4" /> Relatório Geral
        </Link>
        <SeletorPeriodo periodo={periodo} />
      </div>

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o relatório…</Card>
      ) : q.error || !r ? (
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldAlert className="h-5 w-5 text-warning" /> {(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : (
        <>
          <LinhaKpis kpis={r.kpis} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-4 lg:col-span-2">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Icone className="h-4 w-4" style={{ color: s.cor }} /> Evolução mês a mês</p>
              <GraficoMensal r={r} />
            </Card>
            <Card className="p-4">
              <p className="mb-2 text-sm font-semibold">Por status</p>
              <GraficoStatus r={r} />
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {r.rankings.map((rk) => <GraficoRanking key={rk.titulo} titulo={rk.titulo} itens={rk.itens} cor={s.cor} />)}
          </div>
          <AcessoGate menu={MENU_IA} acao="visualizar">
            <PainelIA sistema={s.slug} de={periodo.de} ate={periodo.ate} titulo={s.titulo} />
          </AcessoGate>
          <TabelaRecentes r={r} />
        </>
      )}
    </div>
  );
}
