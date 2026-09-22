import { ArrowRightLeft, Palmtree, TriangleAlert } from "lucide-react";
import { fmtData, useHistoricoColaborador } from "@/hooks/useColaboradorPortal";
import { Carregando, Chip, Erro, Secao, Vazio, tomStatus } from "./ui";

// =====================================================================
// PORTAL DO COLABORADOR — Histórico
// Férias (solicitações), trocas de função e advertências já decididas —
// tudo do próprio colaborador, pela RPC col_historico.
// =====================================================================

export default function HistoricoColaborador() {
  const q = useHistoricoColaborador();
  if (q.isLoading) return <Carregando />;
  if (q.isError || !q.data) return <Erro erro={q.error} acao={<button className="text-sm font-semibold underline" onClick={() => q.refetch()}>Tentar de novo</button>} />;
  const { ferias, trocas_funcao, advertencias } = q.data;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl font-bold">Meu histórico</h1>

      <Secao titulo="Férias" descricao="Solicitações feitas pelo seu encarregado ou pelo RH">
        {ferias.length === 0 ? <Vazio>Nenhuma solicitação de férias registrada.</Vazio> : (
          <ul className="divide-y divide-border">
            {ferias.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-success/10 text-success"><Palmtree className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{fmtData(f.saida)} → {fmtData(f.retorno)}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.dias ?? 0} dia(s){f.vendidos ? ` · ${f.vendidos} vendido(s)` : ""} · pedido em {fmtData(f.criado_em)}
                  </p>
                  {f.motivo_reprovacao && <p className="mt-0.5 text-xs text-destructive">{f.motivo_reprovacao}</p>}
                </div>
                <Chip tom={tomStatus(f.status)}>{f.status}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Trocas de função">
        {trocas_funcao.length === 0 ? <Vazio>Nenhuma troca de função registrada.</Vazio> : (
          <ul className="divide-y divide-border">
            {trocas_funcao.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ArrowRightLeft className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t.cargo_atual ?? "—"} → {t.cargo_novo}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.posto ? `${t.posto} · ` : ""}{t.data_pretendida ? `a partir de ${fmtData(t.data_pretendida)}` : `pedido em ${fmtData(t.criado_em)}`}
                  </p>
                </div>
                <Chip tom={tomStatus(t.status)}>{t.status}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Ocorrências" descricao="Advertências já decididas">
        {advertencias.length === 0 ? <Vazio>Nenhuma ocorrência registrada.</Vazio> : (
          <ul className="divide-y divide-border">
            {advertencias.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-600"><TriangleAlert className="h-5 w-5" /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{a.tipo ?? "Advertência"}{a.grau ? ` · grau ${a.grau.toLowerCase()}` : ""}</p>
                  <p className="text-xs text-muted-foreground">Ocorrido em {fmtData(a.data)}</p>
                </div>
                <Chip tom={tomStatus(a.resultado)}>{a.resultado ?? a.status}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Secao>
    </div>
  );
}
