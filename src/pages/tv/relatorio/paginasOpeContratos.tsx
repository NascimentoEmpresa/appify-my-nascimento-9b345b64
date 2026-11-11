import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Clock, Coins, ListChecks, MessageSquareWarning, PieChart, RefreshCw,
  Target, TrendingUp, Users, type LucideIcon,
} from "lucide-react";
import { MARGEM_PADRAO, type LinhaContrato, type StatusInd } from "@/lib/operacional/indicadoresContratos";
import {
  alertaPrincipal, CONTRATOS_POR_TELA, glosasPorCausa, linhasDaTv, SEGUNDOS_POR_CONTRATO, totaisOpe, type DadosOpeContratosTv,
} from "@/lib/tv/opeContratosTv";
import { FONTE, LogoTv, TINTA, TINTA_SUAVE } from "./base";

// =====================================================================
// TV › Operacional — "TV da Gerência Operacional" (11/11/2026, refeita no
// modelo do Pablo): os 7 totais, a tabela "Contratos que precisam de ação"
// (a ÚNICA parte que troca: 5 contratos a cada 10 s, do pior para o melhor),
// "Onde agir agora" e 4 gráficos fixos dos contratos que mais pedem atenção.
// Contas: src/lib/operacional/indicadoresContratos.ts e src/lib/tv/opeContratosTv.ts.
// Regra das TVs: "ruim" só quando é verdadeiro; sem base fica cinza.
// =====================================================================

const ROXO = "#6d28d9";
const COR: Record<StatusInd, string> = { ok: "#16a34a", atencao: "#d97706", critico: "#dc2626", sem_dado: "#94a3b8", sem_fonte: "#94a3b8" };
const FUNDO: Record<StatusInd, string> = { ok: "#dcfce7", atencao: "#fef3c7", critico: "#fee2e2", sem_dado: "#f1f5f9", sem_fonte: "#f1f5f9" };
const sombra = "0 10px 30px -14px rgba(15,23,42,.28)";
const pct = (v: number | null | undefined, sinal = false) =>
  v == null ? "—" : `${sinal && v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const curto = (n: string) => n.replace(/\s+-\s+\d[\d./\s-]*$/, "").replace(/\s+-\s+\d.*$/, "").trim() || n;
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function usePronto(chave: unknown) {
  const [p, setP] = useState(false);
  useEffect(() => { setP(false); const t = window.setTimeout(() => setP(true), 60); return () => window.clearTimeout(t); }, [chave]);
  return p;
}

/** Último bloco mostrado: ao voltar à TV, segue do seguinte. */
let ultimoBloco = -1;

function Kpi({ titulo, valor, sub, status, Icone }: { titulo: string; valor: string; sub: string; status: StatusInd; Icone: LucideIcon }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[22px] bg-white px-4 py-4" style={{ boxShadow: sombra }}>
      <p className="font-extrabold leading-tight" style={{ fontSize: 20, color: TINTA }}>{titulo}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full" style={{ background: FUNDO[status], color: COR[status] }}><Icone style={{ width: 24, height: 24 }} /></span>
        <p className="truncate font-black leading-none tabular-nums" style={{ fontSize: 34, color: COR[status] }}>{valor}</p>
      </div>
      <p className="mt-2 truncate font-semibold" style={{ fontSize: 16, color: TINTA_SUAVE }}>{sub}</p>
    </div>
  );
}

function Painel({ Icone, titulo, children, direita }: { Icone: LucideIcon; titulo: string; children: ReactNode; direita?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-[24px] bg-white px-7 py-5" style={{ boxShadow: sombra }}>
      <div className="mb-3 flex items-center gap-3">
        <span className="grid h-[44px] w-[44px] place-items-center rounded-xl" style={{ background: "#ede9fe", color: ROXO }}><Icone style={{ width: 26, height: 26 }} /></span>
        <p className="flex-1 truncate font-extrabold" style={{ fontSize: 25, color: TINTA }}>{titulo}</p>
        {direita}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function Pilula({ texto, status }: { texto: string; status: StatusInd }) {
  return <span className="inline-block min-w-[92px] rounded-full px-3 py-0.5 text-center font-black tabular-nums" style={{ fontSize: 19, background: FUNDO[status], color: COR[status] }}>{texto}</span>;
}

export function TelaOpeContratos({ d, atualizado }: { d: DadosOpeContratosTv; cor?: string; atualizado: string | null }) {
  const linhas = linhasDaTv(d);
  const t = totaisOpe(d, linhas);
  const blocos: LinhaContrato[][] = [];
  for (let i = 0; i < linhas.length; i += CONTRATOS_POR_TELA) blocos.push(linhas.slice(i, i + CONTRATOS_POR_TELA));
  if (!blocos.length) blocos.push([]);
  const [bloco, setBloco] = useState(() => (ultimoBloco + 1) % blocos.length);
  const [agora, setAgora] = useState(() => new Date());
  const ms = SEGUNDOS_POR_CONTRATO * 1000;
  useEffect(() => { ultimoBloco = bloco; }, [bloco]);
  useEffect(() => {
    if (blocos.length < 2) return;
    const id = window.setTimeout(() => setBloco((b) => (b + 1) % blocos.length), ms);
    return () => window.clearTimeout(id);
  }, [bloco, blocos.length, ms]);
  useEffect(() => { const id = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(id); }, []);
  const prontoGeral = usePronto("geral");

  const atual = blocos[Math.min(bloco, blocos.length - 1)];
  // Gráficos fixos: os 4 contratos que mais pedem atenção (o topo da lista).
  const topo = linhas.slice(0, 4);
  const faltaPostos = Math.max(t.postos.contratados - t.postos.cobertos, 0);
  const comReclamacao = linhas.filter((l) => l.ind.reclamacoes.status === "atencao" || l.ind.reclamacoes.status === "critico").length;
  const agir = [
    { texto: `${faltaPostos.toLocaleString("pt-BR")} postos sem cobertura`, v: faltaPostos, Icone: Users, s: "critico" as StatusInd },
    { texto: `${t.lucratividade.abaixo} contratos com margem baixa`, v: t.lucratividade.abaixo, Icone: BarChart3, s: "atencao" as StatusInd },
    { texto: `${brl(t.glosas.valor)} em glosas`, v: t.glosas.valor, Icone: Coins, s: "critico" as StatusInd },
    { texto: `${comReclamacao} contratos com risco de desgaste`, v: comReclamacao, Icone: AlertTriangle, s: "atencao" as StatusInd },
  ].filter((a) => a.v > 0);
  const causas = glosasPorCausa(d);
  const totalGlosa = causas.reduce((a, c) => a + c.valor, 0);
  const CORES_CAUSA = [ROXO, "#fb923c", "#c4b5fd", "#cbd5e1"];
  const raio = 80; const circ = 2 * Math.PI * raio; let acum = 0;
  const comp = `${MESES[Number(d.competencia.slice(5, 7)) - 1]}/${d.competencia.slice(0, 4)}`;
  const maxPostos = Math.max(1, ...topo.map((l) => { const c = d.contratos.find((x) => x.id === l.id); return c?.postos?.contratados ?? 0; }));
  const lucros = topo.map((l) => l.ind.lucratividade.valor).filter((v): v is number => v != null);
  const maxLucro = Math.max(MARGEM_PADRAO * 1.5, ...lucros.map((v) => Math.abs(v)));
  const ft = topo.flatMap((l) => [l.ind.faltas.valor ?? 0, l.ind.turnover.valor ?? 0]);
  const maxFt = Math.max(1, ...ft);

  return (
    <div className="flex h-full w-full flex-col gap-5 px-9 pb-4 pt-5" style={{ fontFamily: FONTE, background: "linear-gradient(180deg,#f5f3ff 0%,#f8fafc 100%)" }}>
      {/* Topo */}
      <div className="relative flex shrink-0 items-center gap-6 overflow-hidden rounded-[26px] px-8 text-white" style={{ height: 124, background: "linear-gradient(110deg,#4c1d95 0%,#6d28d9 55%,#7c3aed 100%)" }}>
        <LogoTv altura={70} />
        <div className="min-w-0 flex-1 border-l border-white/30 pl-6">
          <p className="font-bold uppercase tracking-widest opacity-85" style={{ fontSize: 18 }}>Dashboard gerencial • Grupo Nascimento</p>
          <p className="font-black leading-tight tracking-tight" style={{ fontSize: 48 }}>TV da Gerência Operacional</p>
          <p className="font-semibold opacity-90" style={{ fontSize: 21 }}>Quais contratos precisam de ação para garantir cobertura e resultado?</p>
        </div>
        <p className="flex shrink-0 items-center gap-2 font-semibold" style={{ fontSize: 21 }}><CalendarDays style={{ width: 26, height: 26 }} />{agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).replace(/^./, (c) => c.toUpperCase())}</p>
        <p className="flex shrink-0 items-center gap-2 border-l border-white/30 pl-6 font-black tabular-nums" style={{ fontSize: 58 }}><Clock style={{ width: 40, height: 40 }} />{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
      </div>

      {/* Os 7 totais */}
      <div className="grid shrink-0 grid-cols-7 gap-4" style={{ height: 150 }}>
        <Kpi titulo="Postos contratados x cobertos" valor={pct(t.postos.pct)} sub={`${t.postos.contratados.toLocaleString("pt-BR")} contratados • ${t.postos.cobertos.toLocaleString("pt-BR")} cobertos`} status={t.postos.status} Icone={CheckCircle2} />
        <Kpi titulo="Lucratividade por contrato (%)" valor={pct(t.lucratividade.margem)} sub={`${t.lucratividade.abaixo} contratos abaixo da meta`} status={t.lucratividade.status} Icone={TrendingUp} />
        <Kpi titulo="Custo direto acima do orçado (%)" valor={pct(t.custo.desvio, true)} sub={`${t.custo.acima} contratos acima do orçamento`} status={t.custo.status} Icone={TrendingUp} />
        <Kpi titulo="Glosas por contrato" valor={t.glosas.valor >= 10000 ? `R$ ${(t.glosas.valor / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : brl(t.glosas.valor)} sub={`${t.glosas.contratos} contratos afetados · 90 dias`} status={t.glosas.status} Icone={Coins} />
        <Kpi titulo="Faltas por contrato (%)" valor={pct(t.faltas.pct)} sub="atestados sobre os dias de trabalho" status={t.faltas.status} Icone={Users} />
        <Kpi titulo="Turnover por contrato (%)" valor={pct(t.turnover.pct)} sub={`meta ${pct(3.4)} ao mês`} status={t.turnover.status} Icone={RefreshCw} />
        <Kpi titulo="Reclamações ou baixa satisfação" valor={String(t.reclamacoes.qtd)} sub={`${t.reclamacoes.contratos} contratos em atenção · 90 dias`} status={t.reclamacoes.status} Icone={MessageSquareWarning} />
      </div>

      {/* Tabela (troca) + onde agir */}
      <div className="grid shrink-0 grid-cols-[1.75fr_1fr] gap-5" style={{ height: 372 }}>
        <Painel Icone={ListChecks} titulo="Contratos que precisam de ação"
          direita={blocos.length > 1 ? <span className="rounded-full px-3 py-0.5 font-bold text-white" style={{ fontSize: 18, background: ROXO }}>{bloco + 1}/{blocos.length}</span> : undefined}>
          <div className="grid grid-cols-[2.2fr_1fr_1fr_1fr_2.2fr] items-center gap-3 rounded-xl px-4 py-2 font-extrabold" style={{ fontSize: 18, background: "#f1f5f9", color: TINTA_SUAVE }}>
            <span>Contrato</span><span className="text-center">Cobertura</span><span className="text-center">Lucro</span><span className="text-center">Custo x orçado</span><span>Principal alerta</span>
          </div>
          <div key={bloco} style={{ animation: "ope-entra 500ms ease-out" }}>
            {atual.map((l) => {
              const al = alertaPrincipal(l);
              return (
                <div key={l.id} className="grid grid-cols-[2.2fr_1fr_1fr_1fr_2.2fr] items-center gap-3 border-b border-slate-100 px-4 py-1.5">
                  <span className="truncate font-black" style={{ fontSize: 22, color: TINTA }}>{curto(l.nome)}</span>
                  <span className="text-center"><Pilula texto={l.ind.postos.valor != null ? pct(l.ind.postos.valor) : "—"} status={l.ind.postos.status} /></span>
                  <span className="text-center"><Pilula texto={pct(l.ind.lucratividade.valor)} status={l.ind.lucratividade.status} /></span>
                  <span className="text-center"><Pilula texto={pct(l.ind.custo.valor, true)} status={l.ind.custo.status} /></span>
                  <span className="flex min-w-0 items-center gap-2 font-bold" style={{ fontSize: 20, color: TINTA }}>
                    {al ? <AlertTriangle className="shrink-0" style={{ width: 24, height: 24, color: COR[al.status] }} /> : <CheckCircle2 className="shrink-0" style={{ width: 24, height: 24, color: COR.ok }} />}
                    <span className="truncate">{al?.texto ?? "Dentro do esperado"}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </Painel>
        <Painel Icone={Target} titulo="Onde agir agora">
          {agir.length ? (
            <div className="flex h-full flex-col justify-around gap-2">
              {agir.map((a, i) => (
                <div key={a.texto} className="flex items-center gap-4 rounded-xl px-5 py-2.5" style={{ background: FUNDO[a.s], borderLeft: `8px solid ${COR[a.s]}`, animation: `ope-entra 500ms ease-out ${i * 120}ms backwards` }}>
                  <a.Icone className="shrink-0" style={{ width: 28, height: 28, color: COR[a.s] }} />
                  <p className="font-extrabold" style={{ fontSize: 23, color: TINTA }}>{a.texto}</p>
                </div>
              ))}
            </div>
          ) : <p className="flex items-center gap-3 font-extrabold" style={{ fontSize: 26, color: COR.ok }}><CheckCircle2 style={{ width: 36, height: 36 }} /> Nada travado agora.</p>}
        </Painel>
      </div>

      {/* 4 gráficos fixos */}
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-5">
        <Painel Icone={BarChart3} titulo="Postos contratados x cobertos">
          <div className="flex h-full flex-col justify-around">
            {topo.map((l, i) => {
              const c = d.contratos.find((x) => x.id === l.id);
              const ct = c?.postos?.contratados ?? 0; const cb = Math.min(c?.postos?.cobertos ?? 0, ct);
              return (
                <div key={l.id} className="grid grid-cols-[110px_1fr] items-center gap-3">
                  <p className="truncate text-right font-bold" style={{ fontSize: 17, color: TINTA }}>{curto(l.nome)}</p>
                  <div className="space-y-1">
                    {[{ v: cb, cor: ROXO }, { v: ct, cor: "#d4d4d8" }].map((b, j) => (
                      <div key={j} className="flex items-center gap-2">
                        <div className="h-3.5 rounded-r" style={{ width: prontoGeral ? `${(b.v / maxPostos) * 80}%` : "0%", background: b.cor, transition: `width 900ms ease-out ${i * 80 + j * 100}ms` }} />
                        <span className="font-bold tabular-nums" style={{ fontSize: 15, color: TINTA_SUAVE }}>{b.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="flex justify-center gap-5 font-semibold" style={{ fontSize: 15, color: TINTA_SUAVE }}>
              <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded" style={{ background: ROXO }} />Cobertos</span>
              <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded" style={{ background: "#d4d4d8" }} />Contratados</span>
            </div>
          </div>
        </Painel>

        <Painel Icone={BarChart3} titulo="Lucratividade por contrato">
          <div className="relative flex h-full items-center justify-around gap-3 px-2">
            <div className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed" style={{ top: `${50 - (MARGEM_PADRAO / maxLucro) * 45}%`, borderColor: ROXO }}>
              <span className="absolute -top-6 right-0 font-bold" style={{ fontSize: 15, color: ROXO }}>Meta {MARGEM_PADRAO}%</span>
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-slate-200" />
            {topo.map((l, i) => {
              const v = l.ind.lucratividade.valor;
              const h = v == null ? 0 : (Math.abs(v) / maxLucro) * 45;
              return (
                <div key={l.id} className="relative flex h-full min-w-0 flex-1 flex-col items-center">
                  <div className="absolute left-1/2 w-[46px] -translate-x-1/2 rounded" style={{
                    background: v == null ? "#e2e8f0" : v < 0 ? "#f87171" : "#22c55e",
                    height: prontoGeral ? `${h}%` : "0%", transition: `height 900ms ease-out ${i * 100}ms`,
                    ...(v != null && v < 0 ? { top: "50%" } : { bottom: "50%" }),
                  }} />
                  <span className="absolute font-black tabular-nums" style={{ fontSize: 16, color: v != null && v < 0 ? COR.critico : TINTA, ...(v != null && v < 0 ? { top: `${52 + h}%` } : { bottom: `${52 + h}%` }) }}>{v == null ? "—" : pct(v)}</span>
                  <span className="absolute bottom-0 w-full truncate text-center font-bold" style={{ fontSize: 15, color: TINTA_SUAVE }}>{curto(l.nome)}</span>
                </div>
              );
            })}
          </div>
        </Painel>

        <Painel Icone={PieChart} titulo="Glosas • principais causas">
          {totalGlosa > 0 ? (
            <div className="flex h-full items-center gap-4">
              <svg viewBox="0 0 200 200" className="h-[170px] w-[170px] shrink-0" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="100" cy="100" r={raio} fill="none" stroke="#f1f5f9" strokeWidth="34" />
                {causas.map((c, i) => {
                  const dash = (c.valor / totalGlosa) * circ;
                  const el = <circle key={c.causa} cx="100" cy="100" r={raio} fill="none" stroke={CORES_CAUSA[i % 4]} strokeWidth="34" strokeDasharray={`${prontoGeral ? dash : 0} ${circ}`} strokeDashoffset={-acum} style={{ transition: `stroke-dasharray 1000ms ease-out ${i * 120}ms` }} />;
                  acum += dash;
                  return el;
                })}
                <g style={{ transform: "rotate(90deg)", transformOrigin: "100px 100px" }}>
                  <text x="100" y="100" textAnchor="middle" style={{ fontSize: 22, fontWeight: 900, fill: TINTA }}>{brl(totalGlosa)}</text>
                  <text x="100" y="124" textAnchor="middle" style={{ fontSize: 15, fontWeight: 700, fill: TINTA_SUAVE }}>em glosas</text>
                </g>
              </svg>
              <div className="min-w-0 flex-1 space-y-2">
                {causas.map((c, i) => (
                  <div key={c.causa} style={{ fontSize: 16 }}>
                    <p className="flex items-center gap-2 font-bold" style={{ color: TINTA }}><i className="inline-block h-3.5 w-3.5 shrink-0 rounded" style={{ background: CORES_CAUSA[i % 4] }} /><span className="truncate">{c.causa}</span><span className="ml-auto">{Math.round((100 * c.valor) / totalGlosa)}%</span></p>
                    <p className="pl-5 font-semibold" style={{ color: TINTA_SUAVE }}>{brl(c.valor)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="font-bold" style={{ fontSize: 22, color: COR.ok }}>Nenhuma glosa nos últimos 90 dias.</p>}
        </Painel>

        <Painel Icone={Users} titulo="Faltas e turnover por contrato">
          <div className="flex h-full flex-col">
            <div className="flex min-h-0 flex-1 items-end justify-around gap-3">
              {topo.map((l, i) => (
                <div key={l.id} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                  <div className="flex flex-1 items-end justify-center gap-1.5">
                    {[{ v: l.ind.faltas.valor, cor: "#fb923c" }, { v: l.ind.turnover.valor, cor: ROXO }].map((b, j) => (
                      <div key={j} className="flex h-full w-[30px] flex-col items-center justify-end">
                        <span className="font-black tabular-nums" style={{ fontSize: 14, color: TINTA }}>{b.v == null ? "—" : pct(b.v)}</span>
                        <div className="w-full shrink-0 rounded-t" style={{ height: prontoGeral ? `${Math.max(3, ((b.v ?? 0) / maxFt) * 110)}px` : "0px", background: b.cor, transition: `height 900ms ease-out ${i * 80 + j * 100}ms` }} />
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 truncate text-center font-bold" style={{ fontSize: 15, color: TINTA_SUAVE }}>{curto(l.nome)}</p>
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-center gap-5 font-semibold" style={{ fontSize: 15, color: TINTA_SUAVE }}>
              <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded" style={{ background: "#fb923c" }} />Faltas</span>
              <span className="flex items-center gap-1.5"><i className="inline-block h-3 w-3 rounded" style={{ background: ROXO }} />Turnover</span>
            </div>
          </div>
        </Painel>
      </div>

      <div className="flex shrink-0 items-center gap-5" style={{ height: 26 }}>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full" style={{ background: blocos.length > 1 ? "#ede9fe" : "transparent" }}>
          {blocos.length > 1 && <div key={`${bloco}-${ms}`} className="absolute inset-y-0 left-0 rounded-full" style={{ background: ROXO, animation: `tv-progresso ${ms}ms linear forwards` }} />}
        </div>
        <p className="shrink-0 font-semibold" style={{ fontSize: 16, color: TINTA_SUAVE }}>Competência {comp} · postos: posição de hoje · glosas e reclamações: 90 dias{atualizado ? ` · atualizado às ${atualizado}` : ""}</p>
      </div>
      <style>{"@keyframes tv-progresso { from { width: 0% } to { width: 100% } } @keyframes ope-entra { from { transform: translateY(14px) } to { transform: none } }"}</style>
    </div>
  );
}
