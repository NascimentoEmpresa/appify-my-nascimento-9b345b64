import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, BarChart3, CheckCircle2, Clock, Shuffle, Users } from "lucide-react";
import {
  blocosDeContratos, ondeAgir, pctAdmissoes, SEGUNDOS_POR_BLOCO_REC, tons, type DadosRecPainelTv, type Tom,
} from "@/lib/tv/recPainelTv";
import { FONTE, LARANJA, TINTA, TINTA_SUAVE } from "./base";

// =====================================================================
// TV › Recrutamento e Seleção (11/11/2026, mig 20261111190000) — o layout do
// modelo do Pablo, ANIMADO: números contam até o valor, barras crescem,
// a rosca se desenha, e os contratos trocam em blocos a cada 10 s.
// Regras: src/lib/tv/recPainelTv.ts.
// =====================================================================

const ROXO = "#4f46e5";
const COR_TOM: Record<Tom, string> = { bom: "#16a34a", atencao: "#d97706", critico: "#dc2626", neutro: ROXO };
const CORES_MOTIVO = ["#ef4444", "#facc15", "#3b82f6", "#22c55e", "#a855f7", "#f97316", "#14b8a6", "#94a3b8"];
const sombra = "0 10px 30px -14px rgba(15,23,42,.28)";

/** Conta de 0 até o valor (TV fraca: passos curtos, sem depender de rAF). */
function useContagem(alvo: number, ms = 1200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const passos = 24;
    let i = 0;
    const t = window.setInterval(() => { i++; setV(Math.round((alvo * i) / passos)); if (i >= passos) window.clearInterval(t); }, ms / passos);
    return () => window.clearInterval(t);
  }, [alvo, ms]);
  return v;
}

/** true um instante depois de montar: dispara as transições de largura/altura. */
function usePronto(chave: unknown) {
  const [pronto, setPronto] = useState(false);
  useEffect(() => { setPronto(false); const t = window.setTimeout(() => setPronto(true), 60); return () => window.clearTimeout(t); }, [chave]);
  return pronto;
}

function Numero({ valor, sufixo = "" }: { valor: number; sufixo?: string }) {
  const v = useContagem(valor);
  return <>{v.toLocaleString("pt-BR")}{sufixo}</>;
}

function Kpi({ titulo, valor, sufixo, sub, tom }: { titulo: string; valor: number | null; sufixo?: string; sub: string; tom: Tom }) {
  const cor = COR_TOM[tom];
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-[24px] bg-white px-7 py-4" style={{ boxShadow: sombra, borderTop: `8px solid ${cor}` }}>
      <p className="font-extrabold leading-tight" style={{ fontSize: 20, color: TINTA }}>{titulo}</p>
      <p className="mt-1 font-black leading-none tabular-nums" style={{ fontSize: 54, color: cor }}>{valor == null ? "—" : <Numero valor={valor} sufixo={sufixo} />}</p>
      <p className="mt-1 truncate font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{sub}</p>
    </div>
  );
}

function Painel({ icone, titulo, sub, direita, children, className = "" }: { icone: ReactNode; titulo: string; sub?: string; direita?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-[26px] bg-white px-8 py-5 ${className}`} style={{ boxShadow: sombra }}>
      <div className="mb-3 flex items-start gap-4">
        <span className="grid h-[54px] w-[54px] shrink-0 place-items-center rounded-2xl" style={{ background: "#eef2ff", color: ROXO }}>{icone}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold leading-tight" style={{ fontSize: 25, color: TINTA }}>{titulo}</p>
          {sub && <p className="font-semibold" style={{ fontSize: 19, color: TINTA_SUAVE }}>{sub}</p>}
        </div>
        {direita}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function curto(contrato: string) {
  return contrato.replace(/\s+-\s+[\d./\s-]+$/, "").replace(/\s+-\s+\d.*$/, "").trim() || contrato;
}

export function TelaRecPainel({ d, atualizado }: { d: DadosRecPainelTv; atualizado: string | null }) {
  const t = tons(d);
  const pct = pctAdmissoes(d.admissoes);
  const blocos = blocosDeContratos(d.vagas.por_contrato);
  const [bloco, setBloco] = useState(0);
  const [agora, setAgora] = useState(() => new Date());
  const ms = SEGUNDOS_POR_BLOCO_REC * 1000;
  useEffect(() => {
    if (blocos.length < 2) return;
    const id = window.setTimeout(() => setBloco((b) => (b + 1) % blocos.length), ms);
    return () => window.clearTimeout(id);
  }, [bloco, blocos.length, ms]);
  useEffect(() => { const id = window.setInterval(() => setAgora(new Date()), 15_000); return () => window.clearInterval(id); }, []);
  const atual = blocos[Math.min(bloco, blocos.length - 1)];
  const pronto = usePronto(bloco);
  const prontoGeral = usePronto("geral");

  // Escala de TODOS os contratos: um bloco de contratos pequenos não parece cheio.
  const maxVagas = Math.max(1, ...d.vagas.por_contrato.map((c) => c.solicitadas));
  const atrasoBloco = [...atual].filter((c) => c.atrasadas > 0).sort((a, b) => b.atrasadas - a.atrasadas);
  const maxAtraso = Math.max(1, ...d.vagas.por_contrato.map((c) => c.atrasadas));
  const agir = ondeAgir(d);
  const maxAdm = Math.max(1, d.admissoes.previstas);

  // Rosca dos motivos
  const totalDes = d.desistencias.total;
  const raio = 92;
  const circ = 2 * Math.PI * raio;
  let acumulado = 0;

  return (
    <div className="flex h-full w-full flex-col gap-6 px-10 pb-6 pt-6" style={{ fontFamily: FONTE, background: "linear-gradient(180deg,#f5f3ff 0%,#f8fafc 100%)" }}>
      {/* Faixa do topo */}
      <div className="relative flex shrink-0 items-center gap-6 overflow-hidden rounded-[28px] px-12 text-white" style={{ height: 130, background: "linear-gradient(110deg,#3730a3 0%,#6d28d9 60%,#7c3aed 100%)" }}>
        <div className="pointer-events-none absolute -right-20 -top-24 h-[360px] w-[360px] rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
        <div className="relative min-w-0 flex-1">
          <p className="font-bold uppercase tracking-widest opacity-85" style={{ fontSize: 20 }}>Dashboard gerencial • Diretoria Administrativa</p>
          <p className="font-black leading-tight tracking-tight" style={{ fontSize: 52 }}>TV Recrutamento e Seleção</p>
          <p className="font-semibold italic opacity-90" style={{ fontSize: 24 }}>“Onde precisamos agir para garantir o preenchimento dos postos?”</p>
        </div>
        <div className="relative shrink-0 text-right">
          <p className="font-black leading-none tabular-nums" style={{ fontSize: 76 }}>{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
          <p className="mt-1 font-semibold opacity-90" style={{ fontSize: 22 }}>{agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).replace(/^./, (c) => c.toUpperCase())}</p>
        </div>
        <div className="relative shrink-0 rounded-2xl px-5 py-3 text-center font-black uppercase leading-tight tracking-wider" style={{ fontSize: 20, background: LARANJA }}>Grupo<br />Nascimento</div>
      </div>

      {/* Os 5 números */}
      <div className="grid shrink-0 grid-cols-5 gap-6" style={{ height: 176 }}>
        <Kpi titulo="Vagas com risco de posto descoberto" valor={d.vagas.risco} sub={d.vagas.risco ? "urgentes paradas: preencher já" : "nenhuma vaga urgente atrasada"} tom={t.risco} />
        <Kpi titulo="Vagas abertas por contrato e cidade" valor={d.vagas.abertas} sub={`${d.vagas.contratos} contratos · ${d.vagas.cidades} cidades`} tom={t.abertas} />
        <Kpi titulo="Vagas acima do prazo de preenchimento" valor={d.vagas.acima_prazo} sub={`abertas há mais de ${d.vagas.prazo_dias} dias`} tom={t.prazo} />
        <Kpi titulo="Admissões previstas x concluídas" valor={pct} sufixo="%" sub={`${d.admissoes.concluidas} de ${d.admissoes.previstas} admissões no mês`} tom={t.admissoes} />
        <Kpi titulo="Desistências antes da admissão" valor={totalDes} sub={`nos últimos ${d.desistencias.dias} dias`} tom={t.desistencias} />
      </div>

      {/* Contratos (giram) + onde agir */}
      <div className="grid shrink-0 grid-cols-[1.7fr_1fr] gap-6" style={{ height: 340 }}>
        <Painel icone={<BarChart3 style={{ width: 30, height: 30 }} />} titulo="Vagas abertas por contrato e cidade"
          direita={(
            <div className="flex shrink-0 items-center gap-5 font-semibold" style={{ fontSize: 19, color: TINTA_SUAVE }}>
              <span className="flex items-center gap-2"><i className="inline-block h-4 w-4 rounded" style={{ background: ROXO }} />Solicitadas</span>
              <span className="flex items-center gap-2"><i className="inline-block h-4 w-4 rounded" style={{ background: "#a5b4fc" }} />Em preenchimento</span>
              {blocos.length > 1 && <span className="rounded-full px-3 py-0.5 font-bold text-white" style={{ background: ROXO }}>{bloco + 1}/{blocos.length}</span>}
            </div>
          )}>
          <div key={bloco} className="flex h-full flex-col justify-between" style={{ animation: "rec-entra 500ms ease-out" }}>
            {atual.length ? atual.map((c) => (
              <div key={`${c.contrato}|${c.cidade}`} className="grid grid-cols-[320px_1fr] items-center gap-5">
                <p className="truncate text-right font-bold" style={{ fontSize: 19, color: TINTA }}>{curto(c.contrato)} • {c.cidade}</p>
                <div className="space-y-1">
                  {[{ v: c.solicitadas, cor: ROXO }, { v: c.preenchimento, cor: "#a5b4fc" }].map((b, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="h-4 rounded-r-full" style={{ width: pronto ? `${(b.v / maxVagas) * 88}%` : "0%", background: b.cor, transition: `width 900ms cubic-bezier(.2,.8,.2,1) ${i * 120}ms` }} />
                      <span className="font-black tabular-nums" style={{ fontSize: 20, color: TINTA }}>{b.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )) : <p className="font-bold" style={{ fontSize: 28, color: "#16a34a" }}>Nenhuma vaga aberta.</p>}
          </div>
        </Painel>

        <Painel icone={<AlertTriangle style={{ width: 30, height: 30, color: "#dc2626" }} />} titulo="Onde agir agora">
          {agir.length ? (
            <div className="flex h-full flex-col justify-between gap-2">
              {agir.map((a, i) => (
                <div key={a.texto} className="flex items-center gap-4 rounded-2xl px-5 py-1.5" style={{ background: "#f8fafc", borderLeft: "8px solid #dc2626", animation: `rec-entra 500ms ease-out ${i * 120}ms backwards` }}>
                  <p className="flex-1 font-bold" style={{ fontSize: 20, color: TINTA }}>{a.texto}</p>
                  <p className="font-black tabular-nums" style={{ fontSize: 26, color: "#dc2626" }}><Numero valor={a.valor} /></p>
                </div>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-3 font-extrabold" style={{ fontSize: 28, color: "#16a34a" }}><CheckCircle2 style={{ width: 40, height: 40 }} /> Nada travado agora.</p>
          )}
        </Painel>
      </div>

      {/* Admissões, prazo (do bloco atual) e desistências */}
      <div className="grid shrink-0 grid-cols-3 gap-6" style={{ height: 255 }}>
        <Painel icone={<Users style={{ width: 30, height: 30 }} />} titulo="Admissões previstas x feitas" sub={`${d.admissoes.concluidas} de ${d.admissoes.previstas} concluídas no mês`}
          direita={<p className="shrink-0 font-black" style={{ fontSize: 44, color: COR_TOM[t.admissoes] }}>{pct == null ? "—" : <Numero valor={pct} sufixo="%" />}</p>}>
          <div className="flex h-full items-end justify-center gap-16 pb-2">
            {[{ r: "Previstas", v: d.admissoes.previstas, cor: ROXO }, { r: "Concluídas", v: d.admissoes.concluidas, cor: "#22c55e" }].map((b, i) => (
              <div key={b.r} className="flex h-full w-[150px] flex-col items-center justify-end">
                <p className="mb-1 font-black tabular-nums" style={{ fontSize: 26, color: TINTA }}>{b.v}</p>
                <div className="w-full shrink-0 rounded-t-2xl" style={{ height: prontoGeral ? `${Math.max(6, (b.v / maxAdm) * 62)}px` : "0px", background: b.cor, transition: `height 1000ms cubic-bezier(.2,.8,.2,1) ${i * 150}ms` }} />
                <p className="mt-2 font-bold" style={{ fontSize: 20, color: TINTA_SUAVE }}>{b.r}</p>
              </div>
            ))}
          </div>
        </Painel>

        <Painel icone={<Clock style={{ width: 30, height: 30 }} />} titulo="Vagas acima do prazo" sub={`${d.vagas.acima_prazo} no total · contratos deste bloco`}>
          <div key={bloco} className="flex h-full items-end justify-around gap-5 pb-2">
            {atrasoBloco.length ? atrasoBloco.map((c, i) => (
              <div key={`${c.contrato}|${c.cidade}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                <p className="mb-1 font-black tabular-nums" style={{ fontSize: 26, color: TINTA }}>{c.atrasadas}</p>
                <div className="w-full max-w-[120px] shrink-0 rounded-t-2xl" style={{ height: pronto ? `${Math.max(6, (c.atrasadas / maxAtraso) * 62)}px` : "0px", background: "linear-gradient(180deg,#fb923c,#f97316)", transition: `height 900ms cubic-bezier(.2,.8,.2,1) ${i * 110}ms` }} />
                <p className="mt-2 w-full truncate text-center font-bold" style={{ fontSize: 18, color: TINTA_SUAVE }}>{curto(c.contrato)}</p>
              </div>
            )) : <p className="self-center font-bold" style={{ fontSize: 24, color: "#16a34a" }}>Nenhuma vaga deste bloco acima do prazo.</p>}
          </div>
        </Painel>

        <Painel icone={<Shuffle style={{ width: 30, height: 30 }} />} titulo="Desistências antes da admissão" sub={`${totalDes} nos últimos ${d.desistencias.dias} dias, por motivo`}>
          {totalDes ? (
            <div className="flex h-full items-center gap-8">
              <svg viewBox="0 0 240 240" className="h-[160px] w-[160px] shrink-0" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="120" cy="120" r={raio} fill="none" stroke="#f1f5f9" strokeWidth="36" />
                {d.desistencias.por_motivo.map((m, i) => {
                  const frac = m.qtd / totalDes;
                  const dash = frac * circ;
                  const el = (
                    <circle key={m.motivo} cx="120" cy="120" r={raio} fill="none" stroke={CORES_MOTIVO[i % CORES_MOTIVO.length]} strokeWidth="36"
                      strokeDasharray={`${prontoGeral ? dash : 0} ${circ}`} strokeDashoffset={-acumulado}
                      style={{ transition: `stroke-dasharray 1100ms ease-out ${i * 120}ms` }} />
                  );
                  acumulado += dash;
                  return el;
                })}
                <g style={{ transform: "rotate(90deg)", transformOrigin: "120px 120px" }}>
                  <text x="120" y="118" textAnchor="middle" style={{ fontSize: 46, fontWeight: 900, fill: TINTA }}>{totalDes}</text>
                  <text x="120" y="148" textAnchor="middle" style={{ fontSize: 18, fontWeight: 700, fill: TINTA_SUAVE }}>TOTAL</text>
                </g>
              </svg>
              <div className="min-w-0 flex-1 space-y-1">
                {d.desistencias.por_motivo.slice(0, 5).map((m, i) => (
                  <div key={m.motivo} className="flex items-center gap-3" style={{ fontSize: 18 }}>
                    <i className="inline-block h-4 w-4 shrink-0 rounded" style={{ background: CORES_MOTIVO[i % CORES_MOTIVO.length] }} />
                    <span className="min-w-0 flex-1 truncate font-bold" style={{ color: TINTA }}>{m.motivo}</span>
                    <span className="font-black tabular-nums" style={{ color: TINTA }}>{Math.round((100 * m.qtd) / totalDes)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="font-bold" style={{ fontSize: 24, color: "#16a34a" }}>Nenhuma desistência nos últimos {d.desistencias.dias} dias.</p>}
        </Painel>
      </div>

      <div className="flex shrink-0 items-center gap-5" style={{ height: 34 }}>
        <div className="relative h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: blocos.length > 1 ? "#e0e7ff" : "transparent" }}>
          {blocos.length > 1 && <div key={`${bloco}-${ms}`} className="absolute inset-y-0 left-0 rounded-full" style={{ background: ROXO, animation: `tv-progresso ${ms}ms linear forwards` }} />}
        </div>
        <p className="shrink-0 font-semibold" style={{ fontSize: 18, color: TINTA_SUAVE }}>Dados do ERP · Gestão Recrutamento{atualizado ? ` · atualizado às ${atualizado}` : ""}</p>
      </div>
      <style>{"@keyframes tv-progresso { from { width: 0% } to { width: 100% } } @keyframes rec-entra { from { transform: translateY(16px) } to { transform: none } }"}</style>
    </div>
  );
}
