import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { SISTEMAS, fmtKpi, rotuloMes, type Kpi, type RelatorioDados, type RelatorioGeralDados } from "@/pages/relatorios/sistemas";
import { periodoTv, rotuloPeriodoTv, tituloRelatorioTv, type ItemTv } from "@/lib/tv/tv";

// =====================================================================
// Relatório do ERP na TV (Sistemas › TV's, mig 20261007000014)
//
// "Compatível com TV: tela cheia, sem precisar mexer nem descer." Tudo em
// unidades da tela (vh/vw), sem rolagem: cabeçalho, números grandes, gráfico
// mês a mês e o ranking principal. "Visão geral" = um quadro por sistema.
// Os números vêm de tv_relatorio(token, item) — a mesma conta dos Relatórios
// (dir_rel_dados), só da playlist desta TV. Cache de 5 min por item: a
// playlist gira sem reconsultar a cada volta.
// PRÉVIA (Sistemas › TV's, sem token de TV): os mesmos números vêm das RPCs
// dos Relatórios com o login de quem está montando a playlist (dir_rel_*),
// com o mesmo período (periodoTv = tv_rel_periodo) e contrato.
// =====================================================================

type Sistema = { slug: string; titulo: string; kpis: Kpi[]; rotulo_item: string; mensal: RelatorioDados["mensal"] };
type Resp = (RelatorioDados & { tipo: "sistema"; slug: string; contrato: string | null })
          | { tipo: "geral"; sistemas: Sistema[]; periodo: { de: string; ate: string }; contrato: string | null };

const CACHE = new Map<string, { em: number; dados: Resp }>();
const VALIDADE_MS = 5 * 60_000;
const SERIE = ["#3b82f6", "#22c55e", "#ef4444"];
const TOM: Record<string, string> = { primary: "#60a5fa", success: "#4ade80", warning: "#fbbf24", destructive: "#f87171", info: "#38bdf8" };
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;

const ORDEM_GERAL = ["recrutamento", "demissoes", "materiais", "ferias", "medida-disciplinar", "mudanca-funcao", "chamados", "orientacoes"];

/** Prévia: busca com o login de quem está na gestão, no formato que a TV recebe. */
async function carregarPrevia(item: ItemTv): Promise<Resp> {
  const { de, ate } = periodoTv(item.rel_periodo);
  const args = { _de: de, _ate: ate, _contrato: item.rel_contrato ?? null, _meses: null };
  const contrato = item.rel_contrato_nome ?? null;
  if (item.relatorio === "geral") {
    const { data, error } = await rpc("dir_rel_geral", args);
    if (error) throw new Error(error.message);
    const g = data as RelatorioGeralDados;
    return { tipo: "geral", periodo: { de, ate }, contrato,
             sistemas: ORDEM_GERAL.filter((s) => g[s]).map((s) => ({ slug: s, titulo: g[s].titulo, kpis: g[s].kpis, rotulo_item: g[s].rotulo_item, mensal: g[s].mensal })) };
  }
  const s = SISTEMAS.find((x) => x.slug === item.relatorio);
  if (!s) throw new Error("Relatório desconhecido.");
  const { data, error } = await rpc(s.rpc, args);
  if (error) throw new Error(error.message);
  return { ...(data as RelatorioDados), tipo: "sistema", slug: s.slug, contrato };
}

export function TvRelatorio({ item, token, previa = false }: { item: ItemTv; token: string; previa?: boolean }) {
  const [dados, setDados] = useState<Resp | null>(CACHE.get(item.id)?.dados ?? null);
  const [erro, setErro] = useState<string | null>(null);

  const chavePrevia = previa ? `${item.relatorio}|${item.rel_periodo}|${item.rel_contrato ?? ""}` : "";
  useEffect(() => {
    let vivo = true;
    if (previa) {
      setDados(null); setErro(null);
      carregarPrevia(item).then((d) => { if (vivo) setDados(d); }, (e) => { if (vivo) setErro((e as Error).message); });
      return () => { vivo = false; };
    }
    const c = CACHE.get(item.id);
    if (c && Date.now() - c.em < VALIDADE_MS) { setDados(c.dados); return; }
    rpc("tv_relatorio", { p_token: token, p_item: item.id }).then(({ data, error }) => {
      if (!vivo) return;
      if (error) { setErro(error.message); return; }
      CACHE.set(item.id, { em: Date.now(), dados: data as Resp });
      setDados(data as Resp); setErro(null);
    });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, token, previa, chavePrevia]);

  const titulo = item.titulo || tituloRelatorioTv(item.relatorio);
  return (
    <div className="flex h-full w-full flex-col bg-[#0b1220] px-[3vw] py-[3vh] text-white">
      <Cabecalho titulo={titulo} periodo={rotuloPeriodoTv(item.rel_periodo)} contrato={dados?.contrato ?? null} />
      {!dados ? (
        <div className="flex flex-1 items-center justify-center text-[3vh] text-white/60">{erro ?? "Carregando números do ERP…"}</div>
      ) : dados.tipo === "geral" ? <Geral sistemas={dados.sistemas} /> : <Sistema r={dados} comContrato={!!dados.contrato} />}
    </div>
  );
}

function Cabecalho({ titulo, periodo, contrato }: { titulo: string; periodo: string; contrato: string | null }) {
  const [agora, setAgora] = useState(new Date());
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 30_000); return () => window.clearInterval(t); }, []);
  return (
    <div className="mb-[2.5vh] flex items-end justify-between gap-[2vw] border-b border-white/10 pb-[1.5vh]">
      <div className="min-w-0">
        <p className="truncate text-[5vh] font-black leading-none">{titulo}</p>
        <p className="mt-[0.8vh] truncate text-[2.2vh] text-white/60">{periodo}{contrato ? ` · ${contrato}` : " · todos os contratos"}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-[4.5vh] font-bold leading-none">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        <p className="mt-[0.6vh] text-[1.8vh] uppercase tracking-widest text-orange-400">Grupo Nascimento</p>
      </div>
    </div>
  );
}

function Numero({ k }: { k: Kpi }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center rounded-[1.2vh] bg-white/5 px-[1.5vw] py-[2vh]">
      <p className="truncate text-[1.9vh] uppercase tracking-wide text-white/60">{k.rotulo}</p>
      <p className="mt-[0.5vh] truncate text-[6vh] font-black leading-none tabular-nums" style={{ color: TOM[k.tom] ?? "#fff" }}>{fmtKpi(k.valor, k.formato)}</p>
      {k.dica && <p className="mt-[0.6vh] truncate text-[1.6vh] text-white/50">{k.dica}</p>}
    </div>
  );
}

function Sistema({ r, comContrato }: { r: RelatorioDados; comContrato: boolean }) {
  const series = r.mensal.series.filter((s) => s.eixo !== "direita").slice(0, 3);
  // Com contrato escolhido, o ranking "por contrato" vira uma barra só — mostra o próximo.
  const ranking = (comContrato && /contrato|filial/i.test(r.rankings[0]?.titulo ?? "") ? r.rankings[1] : null) ?? r.rankings[0];
  const top = (ranking?.itens ?? []).slice(0, 7);
  const max = Math.max(...top.map((i) => i.n), 1);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[2.5vh]">
      <div className="flex gap-[1.2vw]">{r.kpis.slice(0, 5).map((k) => <Numero key={k.rotulo} k={k} />)}</div>
      <div className="flex min-h-0 flex-1 gap-[1.5vw]">
        <div className="flex min-w-0 flex-[2] flex-col rounded-[1.2vh] bg-white/5 p-[2vh]">
          <p className="mb-[1vh] text-[2.2vh] font-semibold text-white/80">Mês a mês</p>
          <div className="min-h-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={r.mensal.dados} margin={{ top: 24, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="mes" tickFormatter={rotuloMes} tick={{ fill: "rgba(255,255,255,0.7)", fontSize: 16 }} interval={0} stroke="rgba(255,255,255,0.2)" />
                <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 14 }} allowDecimals={false} stroke="rgba(255,255,255,0.2)" width={44} />
                <Legend wrapperStyle={{ fontSize: 16, color: "#fff" }} />
                {series.map((s, i) => (
                  <Bar key={s.chave} dataKey={s.chave} name={s.rotulo} fill={SERIE[i]} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {i === 0 && <LabelList dataKey={s.chave} position="top" fill="#fff" fontSize={15} formatter={(v: number) => (v ? v : "")} />}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        {ranking && (
          <div className="flex min-w-0 flex-1 flex-col rounded-[1.2vh] bg-white/5 p-[2vh]">
            <p className="mb-[1.5vh] truncate text-[2.2vh] font-semibold text-white/80">{ranking.titulo}</p>
            <div className="flex flex-1 flex-col justify-around gap-[0.8vh]">
              {top.map((i) => (
                <div key={i.nome} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-[1vw] text-[1.9vh]">
                    <span className="truncate text-white/80">{i.nome.replace(/^\s*\d+\s*-\s*/, "")}</span>
                    <span className="shrink-0 font-bold tabular-nums">{i.n.toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="mt-[0.4vh] h-[1vh] rounded-full bg-white/10"><div className="h-full rounded-full bg-blue-500" style={{ width: `${(i.n / max) * 100}%` }} /></div>
                </div>
              ))}
              {top.length === 0 && <p className="text-[2vh] text-white/50">Nada no período.</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Geral({ sistemas }: { sistemas: Sistema[] }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-4 grid-rows-2 gap-[1.2vw]">
      {sistemas.map((s) => {
        const [total, andamento, concluidas] = s.kpis;
        const dados = s.mensal.dados.slice(-6);
        return (
          <div key={s.slug} className="flex min-h-0 min-w-0 flex-col rounded-[1.2vh] bg-white/5 p-[1.8vh]">
            <p className="truncate text-[2.3vh] font-bold">{s.titulo}</p>
            <p className="mt-[0.5vh] text-[6vh] font-black leading-none tabular-nums text-blue-400">{fmtKpi(total?.valor ?? null, "n")}</p>
            <p className="text-[1.6vh] text-white/50">{s.rotulo_item} no período</p>
            <div className="mt-[1vh] flex gap-[1vw] text-[1.8vh]">
              <span><b className="tabular-nums text-amber-400">{fmtKpi(andamento?.valor ?? null, "n")}</b> <span className="text-white/60">em andamento</span></span>
              <span><b className="tabular-nums text-green-400">{fmtKpi(concluidas?.valor ?? null, "n")}</b> <span className="text-white/60">concluídas</span></span>
            </div>
            <div className="mt-[1vh] min-h-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dados} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="mes" tickFormatter={rotuloMes} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} interval={0} stroke="rgba(255,255,255,0.15)" />
                  <Bar dataKey={s.mensal.series[0]?.chave ?? "total"} fill="#3b82f6" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
