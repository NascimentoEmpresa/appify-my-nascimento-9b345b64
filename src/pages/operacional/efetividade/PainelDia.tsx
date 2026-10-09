// =====================================================================
// 1. PAINEL DE EFETIVIDADE DO DIA (/app/operacional/efetividade)
//
// A operação do dia num relance: quantos a escala esperava, quantos bateram
// ponto, quem faltou, o que já está coberto e o que segue descoberto — por
// contrato. Abre no último dia que o ponto da Senior trouxe (o espelho é
// diário); escolher hoje mostra "aguardando ponto" + as faltas avisadas.
// =====================================================================
import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, BarChart3, CalendarCheck2, ChevronRight, Download, FileText, LayoutGrid, Palmtree, RefreshCw,
  Stethoscope, Trophy, UserMinus, UserX, Users, UserCheck, Clock, Fingerprint,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEfetDiaristas } from "@/hooks/useEfetividade";
import {
  agrupar, avaliarDia, chaveContrato, descoberto, pct, resumir, somaDias, statusContrato, baixarCsv, tempoSemCobertura,
  type ResumoGrupo,
} from "@/lib/efetividade";
import {
  AvisoSincronizacao, BadgeContrato, BarraFiltros, BASE_ROTA, CabecalhoEfetividade, Carregando, CelulaPct, Erro, Kpi, Secao, Vazio,
  useDiaEfetividade, useFiltros,
} from "./shared";

const ORDEM_STATUS = { critico: 0, atencao: 1, normal: 2 } as const;

export default function PainelDia() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { filtros, set, limpar } = useFiltros();
  const d = useDiaEfetividade(filtros);
  const { data: diaristas = [] } = useEfetDiaristas();

  const r = useMemo(() => resumir(d.linhas.map((l) => l.dia)), [d.linhas]);
  const rOntem = useMemo(() => resumir(d.linhasOntem.map((l) => l.dia)), [d.linhasOntem]);
  const descobertos = d.linhas.filter(descoberto);
  const coberturas = d.linhas.filter((l) => l.cobertura === "coberto").length;
  const coberturasOntem = d.linhasOntem.filter((l) => l.cobertura === "coberto").length;
  const descobertosOntem = d.linhasOntem.filter(descoberto).length;

  const porContrato = useMemo(() => {
    const g = agrupar(d.linhas, (l) => chaveContrato(l.p.c.empresa, l.p.c.filial));
    return [...g.values()]
      .filter((x) => x.previsto > 0 || x.linhas.length > 0)
      .map((x) => ({ ...x, contrato: d.contratoMap.get(x.chave), status: statusContrato(x) }))
      .sort((a, b) => ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status] || b.descobertos - a.descobertos || (a.efetividade ?? 1) - (b.efetividade ?? 1));
  }, [d.linhas, d.contratoMap]);

  // Faltas nos últimos 14 dias (a base já traz as batidas dessa janela).
  const rankingFaltas = useMemo(() => {
    if (!d.data || !d.linhas.length) return [];
    const ate = d.sincAte && d.sincAte < d.data ? d.sincAte : d.data;
    const dias = Array.from({ length: 14 }, (_, i) => somaDias(ate, -i));
    return d.linhas
      .map((l) => ({ l, faltas: dias.filter((x) => avaliarDia(l.p, x, d.sincAte).situacao === "falta").length }))
      .filter((x) => x.faltas > 0)
      .sort((a, b) => b.faltas - a.faltas || a.l.p.c.nome.localeCompare(b.l.p.c.nome, "pt-BR"))
      .slice(0, 6);
  }, [d.linhas, d.data, d.sincAte]);

  const rankingDiaristas = useMemo(() => [...diaristas]
    .map((x) => ({ ...x, total: x.confirmados + x.diarias }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total).slice(0, 6), [diaristas]);

  const aguardandoPonto = d.linhas.filter((l) => l.ocorrencia?.status === "aguardando_ponto").length;
  const descobertos2h = descobertos.filter((l) => (tempoSemCobertura(l.dia.data, l.dia.horarioPrevisto, l.ocorrencia) ?? 0) > 120).length;
  const contratosDescobertos = porContrato.filter((x) => x.descobertos > 0).length;

  const exportar = () => baixarCsv(`efetividade_${d.data}.csv`, [
    ["Contrato", "Previstos", "Presentes", "Faltas", "Atestados", "Afastamentos", "Férias", "Coberturas", "Descobertos", "Efetividade", "Status", "Sem registro de ponto"],
    ...porContrato.map((x) => [x.contrato?.nome ?? x.chave, x.previsto, x.presentes, x.faltas, x.atestados, x.afastamentos, x.ferias, x.coberturas,
      x.descobertos, pct(x.efetividade), x.status, x.semRegistro]),
  ]);

  const irPostos = (c: string) => nav(`${BASE_ROTA}/postos?${new URLSearchParams({ c, ...(d.data ? { d: d.data } : {}) })}`);
  const irFaltas = () => nav(`${BASE_ROTA}/faltas${d.data ? `?d=${d.data}` : ""}`);

  return (
    <div>
      <CabecalhoEfetividade
        titulo="Painel de Efetividade do Dia" icone={Users}
        subtitulo="A situação dos contratos pelo ponto da Senior: presenças, ausências e coberturas."
        data={d.data} sincAte={d.sincAte} ultimaSinc={d.base.data?.ultima_sincronizacao}
        onAtualizar={() => qc.invalidateQueries({ queryKey: ["efetividade"] })} atualizando={d.base.isFetching}
      />
      <BarraFiltros contratos={d.contratos} filtros={filtros} set={set} limpar={limpar} sincAte={d.sincAte} />
      <Erro erro={d.erro} />
      <AvisoSincronizacao data={d.data} sincAte={d.sincAte} />

      {d.carregando ? <Carregando /> : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
            <Kpi icon={Users} rotulo="Efetivo previsto" valor={r.previsto} anterior={rOntem.previsto} tom="info" />
            <Kpi icon={UserCheck} rotulo="Presentes" valor={r.presentes} anterior={rOntem.presentes} tom="success" />
            <Kpi icon={UserX} rotulo="Ausências" valor={r.faltas + r.atestados + r.afastamentos} anterior={rOntem.faltas + rOntem.atestados + rOntem.afastamentos} tom="destructive" melhorSobe={false} />
            <Kpi icon={RefreshCw} rotulo="Coberturas realizadas" valor={coberturas} anterior={coberturasOntem} tom="warning" />
            <Kpi icon={AlertTriangle} rotulo="Postos descobertos" valor={descobertos.length} anterior={descobertosOntem} tom="destructive" melhorSobe={false} onClick={irFaltas} />
            <Kpi icon={BarChart3} rotulo="Efetividade do dia" valor={r.efetividade == null ? null : r.efetividade * 100} sufixo="%"
              anterior={rOntem.efetividade == null ? null : rOntem.efetividade * 100} formatoDelta="pp" tom="success" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,0.9fr)]">
            <Secao titulo="Situação Geral dos Contratos" icone={FileText} sub={`Dados de ${d.data ? new Date(d.data + "T12:00:00").toLocaleDateString("pt-BR") : "—"}`}
              acoes={<Button size="sm" variant="outline" className="gap-1" onClick={exportar}><Download className="h-4 w-4" />Exportar</Button>}>
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/70 text-xs backdrop-blur">
                    <tr>
                      <th className="p-2 text-left">Contrato</th><th className="p-2">Previstos</th><th className="p-2">Presentes</th>
                      <th className="p-2">Ausências</th><th className="p-2">Coberturas</th><th className="p-2">Descobertos</th>
                      <th className="p-2">Efetividade</th><th className="p-2">Status</th><th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {porContrato.map((x) => (
                      <tr key={x.chave} className="border-t hover:bg-muted/40">
                        <td className="max-w-[260px] p-2">
                          <p className="truncate font-semibold text-primary" title={x.contrato?.nome}>{x.contrato?.nome ?? x.chave}</p>
                          {!!x.contrato?.encarregados.length && <p className="truncate text-[11px] text-muted-foreground">{x.contrato.encarregados.map((e) => e.nome).join(", ")}</p>}
                        </td>
                        <td className="p-2 text-center tabular-nums">{x.previsto}</td>
                        <td className="p-2 text-center tabular-nums text-success">{x.presentes}</td>
                        <td className="p-2 text-center tabular-nums text-destructive">{x.faltas + x.atestados + x.afastamentos}</td>
                        <td className="p-2 text-center tabular-nums text-info">{x.coberturas}</td>
                        <td className={cn("p-2 text-center font-bold tabular-nums", x.descobertos ? "text-destructive" : "text-muted-foreground")}>{x.descobertos}</td>
                        <td className="p-2 text-center"><CelulaPct v={x.efetividade} /></td>
                        <td className="p-2 text-center"><BadgeContrato s={x.status} /></td>
                        <td className="p-2 text-right"><Button size="sm" variant="outline" onClick={() => irPostos(x.chave)}>Ver detalhe</Button></td>
                      </tr>
                    ))}
                    {!porContrato.length && <tr><td colSpan={9}><Vazio texto="Nenhum contrato com os filtros escolhidos." /></td></tr>}
                  </tbody>
                </table>
              </div>
            </Secao>

            <MapaContratos grupos={porContrato} onAbrir={irPostos} />

            <div className="space-y-4">
              <Secao titulo="Resumo das Ocorrências" icone={CalendarCheck2}>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-3 text-sm">
                  <LinhaResumo icon={UserX} cor="text-destructive" r="Faltas" v={r.faltas} />
                  <LinhaResumo icon={Palmtree} cor="text-info" r="Férias" v={r.ferias} />
                  <LinhaResumo icon={Stethoscope} cor="text-violet-600" r="Atestados" v={r.atestados} />
                  <LinhaResumo icon={CalendarCheck2} cor="text-muted-foreground" r="Folgas" v={r.folgas} />
                  <LinhaResumo icon={UserMinus} cor="text-orange-600" r="Afastamentos" v={r.afastamentos} />
                  <LinhaResumo icon={RefreshCw} cor="text-warning" r="Coberturas" v={coberturas} />
                  <LinhaResumo icon={Clock} cor="text-warning" r="Aguardando ponto" v={r.aguardando} />
                  <LinhaResumo icon={Clock} cor="text-warning" r="Atrasos" v={r.atrasos} />
                  <LinhaResumo icon={Fingerprint} cor="text-muted-foreground" r="Sem registro de ponto" v={r.semRegistro}
                    dica="Ativos sem nenhuma batida em 14 dias — não usam o relógio; ficam fora do efetivo." />
                  <LinhaResumo icon={BarChart3} cor="text-success" r="Efetividade" v={pct(r.efetividade)} />
                </div>
              </Secao>

              <Secao titulo="Alertas e Ações Necessárias" icone={AlertTriangle}>
                <ul className="divide-y text-sm">
                  <Alerta n={contratosDescobertos} texto={`contrato${contratosDescobertos === 1 ? "" : "s"} com posto descoberto`} onClick={irFaltas} />
                  <Alerta n={descobertos.length} texto={`ausência${descobertos.length === 1 ? "" : "s"} sem cobertura`} onClick={irFaltas} />
                  <Alerta n={aguardandoPonto} texto={`cobertura${aguardandoPonto === 1 ? "" : "s"} aguardando ponto`} onClick={irFaltas} />
                  <Alerta n={descobertos2h} texto="ausências descobertas há mais de 2h" onClick={irFaltas} />
                  {d.sincAte && d.data && d.sincAte < somaDias(d.data, -1) && (
                    <Alerta n={1} texto={`ponto da Senior parado em ${new Date(d.sincAte + "T12:00:00").toLocaleDateString("pt-BR")} — conferir a sincronização`} />
                  )}
                  {!contratosDescobertos && !aguardandoPonto && <li className="p-3 text-center text-muted-foreground">Nada pendente com os filtros atuais. ✅</li>}
                </ul>
              </Secao>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Secao titulo="Contratos com Mais Postos Descobertos" icone={AlertTriangle}>
              <TabelaRanking cab={["Contrato", "Descob.", "Ausências", "Efetividade"]}
                linhas={[...porContrato].filter((x) => x.descobertos > 0).sort((a, b) => b.descobertos - a.descobertos).slice(0, 6)
                  .map((x) => [<button key="n" className="truncate text-left font-semibold text-primary hover:underline" onClick={() => irPostos(x.chave)}>{x.contrato?.nome ?? x.chave}</button>,
                    <b key="d" className="text-destructive">{x.descobertos}</b>, x.faltas + x.atestados + x.afastamentos, <CelulaPct key="e" v={x.efetividade} />])}
                vazio="Nenhum posto descoberto." />
            </Secao>
            <Secao titulo="Colaboradores com Mais Faltas" icone={UserX} sub="Últimos 14 dias pelo ponto">
              <TabelaRanking cab={["Colaborador", "Contrato", "Faltas"]}
                linhas={rankingFaltas.map(({ l, faltas }) => [<span key="n" className="font-semibold">{l.p.c.nome}</span>,
                  <span key="c" className="truncate text-xs text-muted-foreground">{l.p.c.contrato}</span>, <b key="f" className="text-destructive">{faltas}</b>])}
                vazio="Ninguém faltou nos últimos 14 dias." />
            </Secao>
            <Secao titulo="Diaristas (Coberturas Realizadas)" icone={Trophy}
              acoes={<Link to={`${BASE_ROTA}/faltas`} className="text-xs font-semibold text-primary hover:underline">Ver todas</Link>}>
              <TabelaRanking cab={["Diarista", "Coberturas", "Diárias"]}
                linhas={rankingDiaristas.map((x) => [<span key="n" className="font-semibold">{x.nome}</span>, x.confirmados, x.diarias])}
                vazio="Ainda sem coberturas registradas." />
            </Secao>
          </div>
        </div>
      )}
    </div>
  );
}

function LinhaResumo({ icon: I, cor, r, v, dica }: { icon: typeof Users; cor: string; r: string; v: number | string; dica?: string }) {
  return (
    <div className="flex items-center gap-2 py-1" title={dica}>
      <I className={cn("h-4 w-4 shrink-0", cor)} />
      <span className="flex-1 truncate">{r}</span>
      <b className="tabular-nums">{v}</b>
    </div>
  );
}

function Alerta({ n, texto, onClick }: { n: number; texto: string; onClick?: () => void }) {
  if (!n) return null;
  return (
    <li>
      <button onClick={onClick} className="flex w-full items-center gap-2 p-3 text-left hover:bg-muted/50">
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="flex-1"><b>{n}</b> {texto}</span>
        {onClick && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
    </li>
  );
}

function TabelaRanking({ cab, linhas, vazio }: { cab: string[]; linhas: React.ReactNode[][]; vazio: string }) {
  if (!linhas.length) return <Vazio texto={vazio} />;
  return (
    <table className="w-full table-fixed text-sm">
      <thead className="bg-muted/50 text-xs">
        <tr><th className="w-8 p-2">#</th>{cab.map((c, i) => <th key={c} className={cn("p-2", i === 0 ? "text-left" : "text-center", i === 0 && "w-1/2")}>{c}</th>)}</tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={i} className="border-t">
            <td className="p-2 text-center text-muted-foreground">{i + 1}</td>
            {l.map((c, j) => <td key={j} className={cn("truncate p-2", j === 0 ? "text-left" : "text-center tabular-nums")}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * No lugar do mapa geográfico (os contratos não têm coordenada no ERP): um
 * mosaico por contrato, tamanho pelo efetivo, cor pelo status. Clicar abre
 * o Controle de Postos do contrato.
 */
function MapaContratos({ grupos, onAbrir }: { grupos: (ResumoGrupo & { contrato?: { nome: string }; status: "normal" | "atencao" | "critico" })[]; onAbrir: (c: string) => void }) {
  const max = Math.max(1, ...grupos.map((g) => g.previsto));
  const cor = { normal: "bg-success/15 border-success/40 hover:bg-success/25", atencao: "bg-warning/15 border-warning/40 hover:bg-warning/25", critico: "bg-destructive/15 border-destructive/40 hover:bg-destructive/25" };
  return (
    <Secao titulo="Mapa de Ocorrências" icone={LayoutGrid} sub="Cada bloco é um contrato (tamanho = efetivo)">
      <div className="flex max-h-[420px] flex-wrap content-start gap-1.5 overflow-auto p-3">
        {grupos.map((g) => {
          const peso = 0.35 + 0.65 * Math.sqrt(g.previsto / max);
          const nome = (g.contrato?.nome ?? g.chave).replace(/^\d+\s*-\s*/, "");
          return (
            <button key={g.chave} onClick={() => onAbrir(g.chave)} title={`${g.contrato?.nome}\nEfetividade ${pct(g.efetividade)} · ${g.descobertos} descoberto(s)`}
              className={cn("relative flex flex-col justify-between rounded-md border p-1.5 text-left transition-colors", cor[g.status])}
              style={{ width: `${Math.round(70 + 110 * peso)}px`, height: `${Math.round(44 + 40 * peso)}px` }}>
              <span className="line-clamp-2 text-[10px] font-semibold leading-tight">{nome}</span>
              <span className="flex items-center justify-between text-[10px] tabular-nums">
                <span>{pct(g.efetividade, 0)}</span>
                {g.descobertos > 0 && <span className="rounded bg-destructive px-1 font-bold text-destructive-foreground">{g.descobertos}</span>}
              </span>
            </button>
          );
        })}
        {!grupos.length && <Vazio texto="Sem contratos." />}
      </div>
      <div className="flex flex-wrap gap-3 border-t px-3 py-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-success/40 bg-success/15" />Normal (≥ 95%)</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-warning/40 bg-warning/15" />Atenção</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-destructive/40 bg-destructive/15" />Crítico (&lt; 91% ou 5+ descobertos)</span>
        <span className="flex items-center gap-1"><span className="rounded bg-destructive px-1 font-bold text-destructive-foreground">n</span>descobertos</span>
      </div>
    </Secao>
  );
}

