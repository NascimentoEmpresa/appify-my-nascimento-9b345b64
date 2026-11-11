import { useEffect, useState, type ReactNode } from "react";
import { Crown, Landmark, Wallet } from "lucide-react";
import {
  brlCurto, brlTv, pctRecebido, resumoPresidencia, rotuloMesTv, tomMargem, tomNaoEmitido,
  type DadosCtlPainelTv, type DadosFinPainelTv, type DadosPrePainelTv, type TomGestao,
} from "@/lib/tv/gestaoTv";
import { FONTE, LARANJA, TINTA, TINTA_SUAVE } from "./base";

// =====================================================================
// TVs de gestão — Financeiro (Controle de Faturamento), Controladoria
// (Faturamento da Empresa) e Presidência (o que as outras TVs calculam).
// Mig 20261111230000; regras em src/lib/tv/gestaoTv.ts.
// =====================================================================

const COR: Record<TomGestao, string> = { bom: "#16a34a", atencao: "#d97706", critico: "#dc2626", neutro: TINTA };
const sombra = "0 10px 30px -14px rgba(15,23,42,.28)";
const pct = (v: number | null | undefined, casas = 1) => (v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);
const curto = (c: string) => c.replace(/\s+-\s+\d[\d./\s-]*$/, "").trim() || c;

function usePronto() {
  const [p, setP] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setP(true), 80); return () => window.clearTimeout(t); }, []);
  return p;
}

function Moldura({ cor, cor2, icone, area, titulo, selo, atualizado, children }: {
  cor: string; cor2: string; icone: ReactNode; area: string; titulo: string; selo: string; atualizado: string | null; children: ReactNode;
}) {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => { const t = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(t); }, []);
  return (
    <div className="flex h-full w-full flex-col gap-6 px-10 pb-5 pt-6" style={{ fontFamily: FONTE, background: "#f4f4f5" }}>
      <div className="relative flex shrink-0 items-center gap-6 overflow-hidden rounded-[28px] px-12 text-white" style={{ height: 130, background: `linear-gradient(110deg, ${cor} 0%, ${cor2} 100%)` }}>
        <span className="grid h-[84px] w-[84px] shrink-0 place-items-center rounded-[22px]" style={{ background: "rgba(255,255,255,0.16)" }}>{icone}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold uppercase tracking-widest opacity-85" style={{ fontSize: 20 }}>{area}</p>
          <p className="truncate font-black leading-tight tracking-tight" style={{ fontSize: 50 }}>{titulo}</p>
        </div>
        <span className="shrink-0 rounded-full bg-white px-5 py-1.5 font-bold uppercase tracking-wide" style={{ fontSize: 20, color: cor }}>{selo}</span>
        <p className="shrink-0 font-black leading-none tabular-nums" style={{ fontSize: 72 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
        <div className="shrink-0 rounded-2xl px-5 py-3 text-center font-black uppercase leading-tight tracking-wider" style={{ fontSize: 19, background: LARANJA }}>Grupo<br />Nascimento</div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      <p className="shrink-0 font-semibold" style={{ fontSize: 17, color: TINTA_SUAVE }}>Dados do ERP{atualizado ? ` · atualizado às ${atualizado}` : ""}</p>
    </div>
  );
}

function Kpi({ titulo, valor, sub, tom = "neutro" }: { titulo: string; valor: string; sub?: string; tom?: TomGestao }) {
  return (
    <div className="flex min-w-0 flex-col justify-center rounded-[24px] bg-white px-7 py-4" style={{ boxShadow: sombra, borderTop: `8px solid ${tom === "neutro" ? "#cbd5e1" : COR[tom]}` }}>
      <p className="truncate font-extrabold" style={{ fontSize: 21, color: TINTA_SUAVE }}>{titulo}</p>
      <p className="truncate font-black tabular-nums" style={{ fontSize: 50, color: COR[tom] }}>{valor}</p>
      {sub && <p className="truncate font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{sub}</p>}
    </div>
  );
}

function Bloco({ titulo, children, className = "" }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-[26px] bg-white px-8 py-5 ${className}`} style={{ boxShadow: sombra }}>
      <p className="mb-3 truncate font-extrabold" style={{ fontSize: 25, color: TINTA }}>{titulo}</p>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** Colunas por mês, com até 3 séries lado a lado. */
function ColunasMes({ dados, series }: { dados: { mes: string; [k: string]: number | string }[]; series: { chave: string; rotulo: string; cor: string }[] }) {
  const pronto = usePronto();
  const max = Math.max(1, ...dados.flatMap((d) => series.map((s) => Math.abs(Number(d[s.chave]) || 0))));
  return (
    <div className="flex h-full flex-col">
      <div className="mb-2 flex gap-5">
        {series.map((s) => <span key={s.chave} className="flex items-center gap-2 font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}><i className="inline-block h-4 w-4 rounded" style={{ background: s.cor }} />{s.rotulo}</span>)}
      </div>
      <div className="flex min-h-0 flex-1 items-end gap-3">
        {dados.map((d, i) => (
          <div key={d.mes} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex flex-1 items-end justify-center gap-1">
              {series.map((s, j) => {
                const v = Number(d[s.chave]) || 0;
                return <div key={s.chave} className="w-full max-w-[26px] rounded-t-md" style={{ height: pronto ? `${Math.max(2, (Math.max(v, 0) / max) * 100)}%` : "0%", background: v < 0 ? "#dc2626" : s.cor, transition: `height 900ms cubic-bezier(.2,.8,.2,1) ${i * 50 + j * 80}ms` }} />;
              })}
            </div>
            <p className="mt-1 text-center font-bold" style={{ fontSize: 15, color: TINTA_SUAVE }}>{rotuloMesTv(d.mes)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Lista({ itens, vazio }: { itens: { nome: string; valor: string; sub?: string; tom?: TomGestao }[]; vazio: string }) {
  if (!itens.length) return <p className="font-bold" style={{ fontSize: 23, color: "#16a34a" }}>{vazio}</p>;
  return (
    <div className="space-y-2.5">
      {itens.map((x) => (
        <div key={x.nome} className="flex items-baseline justify-between gap-4 border-b border-slate-100 pb-2" style={{ fontSize: 21 }}>
          <span className="min-w-0 truncate font-bold" style={{ color: TINTA }}>{x.nome}{x.sub && <span className="ml-2 font-semibold" style={{ color: TINTA_SUAVE, fontSize: 17 }}>{x.sub}</span>}</span>
          <span className="shrink-0 font-black tabular-nums" style={{ color: COR[x.tom ?? "neutro"] }}>{x.valor}</span>
        </div>
      ))}
    </div>
  );
}

// ── Financeiro ─────────────────────────────────────────────────────────
export function TelaFinPainel({ d, atualizado }: { d: DadosFinPainelTv; atualizado: string | null }) {
  const k = d.kpis;
  const rec = pctRecebido(k);
  return (
    <Moldura cor="#047857" cor2="#064e3b" icone={<Wallet style={{ width: 46, height: 46 }} />} area="Financeiro" titulo="Controle de Faturamento"
      selo={`Competência ${rotuloMesTv(d.competencia)}`} atualizado={atualizado}>
      <div className="grid h-full grid-rows-[160px_1fr] gap-6">
        <div className="grid grid-cols-5 gap-6">
          <Kpi titulo="Valor executável" valor={brlCurto(k?.executavel)} sub={`${k?.vigentes ?? 0} contratos vigentes`} />
          <Kpi titulo="Valor faturado" valor={brlCurto(k?.faturado)} sub={`${k?.lancadas ?? 0} faturados · ${k?.parciais ?? 0} parciais`} />
          <Kpi titulo="Não emitido" valor={brlCurto(k?.nao_emitido)} sub={`${k?.pendentes ?? 0} contrato(s) sem lançamento`} tom={tomNaoEmitido(k)} />
          <Kpi titulo="Valor recebido" valor={brlCurto(k?.recebido)} sub={rec != null ? `${pct(rec)} do faturado` : undefined} />
          <Kpi titulo="Inadimplência" valor={brlCurto(d.inadimplencia?.valor)} sub={d.inadimplencia ? `${d.inadimplencia.notas} nota(s) vencida(s) · ${brlCurto(d.inadimplencia.mais_de_90)} há +90 dias` : undefined}
            tom={!d.inadimplencia ? "neutro" : d.inadimplencia.mais_de_90 > 0 ? "critico" : d.inadimplencia.valor > 0 ? "atencao" : "bom"} />
        </div>
        <div className="grid min-h-0 grid-cols-[1.4fr_1fr] gap-6">
          <Bloco titulo="Executável × faturado × recebido, mês a mês">
            <ColunasMes dados={d.evolucao} series={[{ chave: "executavel", rotulo: "Executável", cor: "#a7f3d0" }, { chave: "faturado", rotulo: "Faturado", cor: "#059669" }, { chave: "recebido", rotulo: "Recebido", cor: "#1e3a8a" }]} />
          </Bloco>
          <Bloco titulo="Notas pendentes nesta competência">
            <Lista vazio="Todos os contratos vigentes com nota lançada."
              itens={d.pendentes.slice(0, 8).map((p) => ({ nome: curto(p.contrato), sub: p.status === "FATURADO_PARCIAL" ? "parcial" : "sem nota", valor: brlTv(p.nao_emitido), tom: "atencao" as TomGestao }))} />
          </Bloco>
        </div>
      </div>
    </Moldura>
  );
}

// ── Controladoria ──────────────────────────────────────────────────────
export function TelaCtlPainel({ d, atualizado }: { d: DadosCtlPainelTv; atualizado: string | null }) {
  const k = d.kpis;
  return (
    <Moldura cor="#1e3a8a" cor2="#0b1f4d" icone={<Landmark style={{ width: 46, height: 46 }} />} area="Controladoria" titulo="Faturamento da Empresa"
      selo={`Competência ${rotuloMesTv(d.competencia)}`} atualizado={atualizado}>
      <div className="grid h-full grid-rows-[160px_1fr] gap-6">
        <div className="grid grid-cols-5 gap-6">
          <Kpi titulo="Faturado (bruto)" valor={brlCurto(k?.bruto)} sub={`${k?.notas ?? 0} notas · ${k?.contratos ?? 0} contratos`} />
          <Kpi titulo="Líquido" valor={brlCurto(k?.liquido)} sub={`conta vinculada ${brlCurto(k?.conta_vinculada)}`} />
          <Kpi titulo="Recebido" valor={brlCurto(k?.recebido)} sub={`a receber ${brlCurto(k?.a_receber)}`} />
          <Kpi titulo="Despesas" valor={brlCurto(k?.despesas)} sub="saídas dos contratos no Fluxo de Caixa" />
          <Kpi titulo="Lucro · margem" valor={brlCurto(k?.lucro)} sub={`margem ${pct(k?.margem)}`} tom={tomMargem(k?.margem)} />
        </div>
        <div className="grid min-h-0 grid-cols-[1.4fr_1fr_1fr] gap-6">
          <Bloco titulo="Líquido × despesas × lucro, mês a mês">
            <ColunasMes dados={d.evolucao} series={[{ chave: "liquido", rotulo: "Líquido", cor: "#93c5fd" }, { chave: "despesas", rotulo: "Despesas", cor: "#f59e0b" }, { chave: "lucro", rotulo: "Lucro", cor: "#16a34a" }]} />
          </Bloco>
          <Bloco titulo="Onde a empresa mais ganha">
            <Lista vazio="Sem contrato com receita no mês." itens={d.melhores.filter((c) => c.lucro > 0).map((c) => ({ nome: curto(c.contrato), sub: pct(c.margem), valor: brlCurto(c.lucro), tom: tomMargem(c.margem) }))} />
          </Bloco>
          <Bloco titulo="Onde a margem está menor">
            <Lista vazio="Nenhum contrato com prejuízo no mês." itens={d.piores.slice(0, 6).map((c) => ({ nome: curto(c.contrato), sub: pct(c.margem), valor: brlCurto(c.lucro), tom: tomMargem(c.margem) }))} />
          </Bloco>
        </div>
      </div>
    </Moldura>
  );
}

// ── Presidência ────────────────────────────────────────────────────────
export function TelaPrePainel({ d, atualizado }: { d: DadosPrePainelTv; atualizado: string | null }) {
  const r = resumoPresidencia(d);
  const cobertura = r.postos.contratados > 0 ? Math.round((r.postos.cobertos / r.postos.contratados) * 1000) / 10 : null;
  return (
    <Moldura cor="#7c2d12" cor2="#431407" icone={<Crown style={{ width: 46, height: 46 }} />} area="Presidência" titulo="Visão da alta liderança"
      selo={d.controladoria?.competencia ? `Resultado ${rotuloMesTv(d.controladoria.competencia)}` : "Grupo"} atualizado={atualizado}>
      <div className="grid h-full grid-rows-[160px_1fr] gap-6">
        <div className="grid grid-cols-5 gap-6">
          <Kpi titulo="Lucratividade geral" valor={pct(r.margem)} sub={`lucro ${brlCurto(r.lucro)} sobre ${brlCurto(r.liquido)}`} tom={tomMargem(r.margem)} />
          <Kpi titulo="Contratos vermelhos" valor={String(r.vermelhos.length)} sub="2+ indicadores críticos" tom={r.vermelhos.length ? "critico" : "bom"} />
          <Kpi titulo="Postos contratados × cobertos" valor={cobertura != null ? pct(cobertura) : "—"} sub={`${r.postos.cobertos} de ${r.postos.contratados} · ${r.postos.contratos} contrato(s) com falta`}
            tom={cobertura == null ? "neutro" : cobertura >= 98 ? "bom" : cobertura >= 95 ? "atencao" : "critico"} />
          <Kpi titulo="Glosas e retenções" valor={brlCurto(r.glosas.valor + (r.retencoes ?? 0))} sub={`glosas ${brlCurto(r.glosas.valor)} (90 d) · retido ${brlCurto(r.retencoes)}`} tom={r.glosas.valor > 0 ? "atencao" : "neutro"} />
          <Kpi titulo="Notas pendentes e vencidas" valor={brlCurto((r.notasPendentes?.valor ?? 0) + (r.inadimplencia?.valor ?? 0))}
            sub={`não emitido ${brlCurto(r.notasPendentes?.valor)} · vencido ${brlCurto(r.inadimplencia?.valor)}`}
            tom={(r.inadimplencia?.mais_de_90 ?? 0) > 0 ? "critico" : (r.notasPendentes?.valor ?? 0) > 0 ? "atencao" : "bom"} />
        </div>
        <div className="grid min-h-0 grid-cols-4 gap-6">
          <Bloco titulo="Onde a empresa perde dinheiro">
            <Lista vazio="Nenhum contrato abaixo de 10% de margem." itens={r.piores.map((c) => ({ nome: curto(c.contrato), sub: pct(c.margem), valor: brlCurto(c.lucro), tom: tomMargem(c.margem) }))} />
          </Bloco>
          <Bloco titulo="Contratos que exigem decisão">
            <Lista vazio="Nenhum contrato vermelho." itens={r.vermelhos.slice(0, 6).map((l) => ({ nome: curto(l.nome), valor: `${l.criticos} críticos`, tom: "critico" as TomGestao }))} />
          </Bloco>
          <Bloco titulo="Salários e benefícios × orçamento">
            <p className="font-black tabular-nums" style={{ fontSize: 60, color: r.salarios.desvio == null ? TINTA : r.salarios.desvio > 5 ? COR.critico : COR.bom }}>
              {r.salarios.desvio == null ? "—" : `${r.salarios.desvio > 0 ? "+" : ""}${pct(r.salarios.desvio)}`}
            </p>
            <p className="font-semibold" style={{ fontSize: 21, color: TINTA_SUAVE }}>do orçado na Planilha de Custo, no total</p>
            <p className="mt-4 font-bold" style={{ fontSize: 24, color: r.salarios.acima ? COR.critico : COR.bom }}>{r.salarios.acima} de {r.salarios.total} contratos acima de +5%</p>
          </Bloco>
          <Bloco titulo="Clientes insatisfeitos">
            <Lista vazio="Nenhuma notificação de cliente em 90 dias." itens={r.insatisfeitos.map((c) => ({ nome: curto(c.contrato), valor: `${c.qtd} notificação(ões)`, tom: c.qtd >= 3 ? "critico" as TomGestao : "atencao" as TomGestao }))} />
          </Bloco>
        </div>
      </div>
    </Moldura>
  );
}
