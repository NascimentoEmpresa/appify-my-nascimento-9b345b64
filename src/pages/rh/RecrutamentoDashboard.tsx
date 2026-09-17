import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
  LineChart, Line, PieChart, Pie, Legend,
} from "recharts";
import { FiltroContratos, passaNoFiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { STATUS_VAGA_MORTA } from "@/lib/recrutamento/vagaRegras";

// =====================================================================
// RECRUTAMENTO — Dashboard (RH e Diretoria — a MESMA tela nas duas rotas)
//
// 17/09/2026 (pedido do Pablo): "ver rapidamente todas as vagas em aberto
// separadas por contrato, quantas estão em aberto no contrato X; mais
// filtrável e completo; e a Diretoria vê tudo em /app/diretoria/
// recrutamento-dashboard". O que mudou:
//   • bloco VAGAS EM ABERTO POR CONTRATO no topo — solicitações e nº de
//     vagas (soma de quantidade_vagas), separando "aguardando aprovação" de
//     "em seleção", com a mais antiga em dias; clicar no contrato filtra o
//     resto do painel;
//   • barra de filtros: período, contratos (multi, o mesmo dropdown do
//     Recrutamento), fase, motivo, urgência e busca por cargo;
//   • gráficos novos: por motivo, por urgência, por cargo, tempo em aberto.
// "Em aberto" = qualquer status que não seja final (Contratado/Concluído),
// nem morto (Reprovada/Cancelada).
// =====================================================================

const db = supabase as unknown as SupabaseClient;

interface Vaga {
  id: number; cargo?: string | null; status: string; created_at: string; status_changed_at?: string | null;
  contrato?: string | null; quantidade_vagas?: number | string | null; motivo_vaga?: string | null;
  grau_urgencia?: string | null; cidade?: string | null; administrativa?: boolean | null; setor?: string | null;
  solicitante_nome?: string | null; data_inicio_prevista?: string | null;
}
interface Curriculo { id: number; vaga_id: number | null; created_at: string; tipo_candidatura?: string | null; etapa_processo?: string | null }

const STATUS_PROCESSO = [
  "Vaga aberta - Seleção de Currículos", "Em análise jurídica", "Entrevista e Avaliação",
  "Entrevista com Gestor", "Aprovado - Aguardando SST", "Encaminhado para SST (ASO)",
  "ASO Aprovado - Aguardando Informe de EPIs", "Aguardando SST e Compras", "Aguardando Confirmação Compras",
  "Compras Confirmou - Aguardando Documentação",
];
const PENDENTES = ["Pendente Operacional", "Pendente Analista", "Pendente Diretoria", "Pendente Recrutamento"];
const ehFinal = (s: string) => s === "Contratado" || s.startsWith("Concluído");
const ehMorta = (s: string) => STATUS_VAGA_MORTA.includes(s);
/** Em aberto = pendente de aprovação ou em seleção. */
const emAberto = (s: string) => !ehFinal(s) && !ehMorta(s);
const fase = (s: string): "Aguardando aprovação" | "Em seleção" | "Contratada" | "Reprovada/Cancelada" =>
  PENDENTES.includes(s) ? "Aguardando aprovação" : ehFinal(s) ? "Contratada" : ehMorta(s) ? "Reprovada/Cancelada" : "Em seleção";
const FASES = ["Aguardando aprovação", "Em seleção", "Contratada", "Reprovada/Cancelada"] as const;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const startOf = (days: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - days); return d; };
const diasDesde = (s?: string | null) => { if (!s) return 0; const d = new Date(s); return isNaN(+d) ? 0 : Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000)); };
const qtd = (v: Vaga) => { const n = Number(v.quantidade_vagas); return Number.isFinite(n) && n > 0 ? n : 1; };
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function RecrutamentoDashboard() {
  const [loading, setLoading] = useState(true);
  const [sols, setSols] = useState<Vaga[]>([]);
  const [curs, setCurs] = useState<Curriculo[]>([]);
  const [tempos, setTempos] = useState<{ etapa: string; dias: number }[]>([]);

  // ── Filtros ───────────────────────────────────────────────────
  const [periodo, setPeriodo] = useState<string>("abertas"); // abertas | 30 | 90 | 365 | YYYY-MM | ""
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [fFase, setFFase] = useState("");
  const [fMotivo, setFMotivo] = useState("");
  const [fUrgencia, setFUrgencia] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: s }, { data: c }, { data: log }] = await Promise.all([
        db.from("SISTEMA_RECRUTAMENTO").select("id,cargo,status,created_at,status_changed_at,contrato,quantidade_vagas,motivo_vaga,grau_urgencia,cidade,administrativa,setor,solicitante_nome,data_inicio_prevista").limit(5000),
        db.from("WA_CURRICULOS").select("id,vaga_id,created_at,tipo_candidatura,etapa_processo").limit(5000),
        db.from("SISTEMA_RECRUTAMENTO_STATUS_LOG").select("status_anterior,dias_no_anterior").limit(5000),
      ]);
      setSols((s ?? []) as Vaga[]);
      setCurs((c ?? []) as Curriculo[]);
      const acc: Record<string, { soma: number; n: number }> = {};
      ((log ?? []) as { status_anterior?: string; dias_no_anterior?: number | string }[]).forEach((r) => {
        const k = r.status_anterior; const v = Number(r.dias_no_anterior);
        if (!k || isNaN(v)) return;
        (acc[k] = acc[k] || { soma: 0, n: 0 }); acc[k].soma += v; acc[k].n += 1;
      });
      const ordem = [...PENDENTES, ...STATUS_PROCESSO];
      setTempos(Object.entries(acc)
        .map(([etapa, v]) => ({ etapa, dias: +(v.soma / v.n).toFixed(1) }))
        .sort((a, b) => ordem.indexOf(a.etapa) - ordem.indexOf(b.etapa)));
      setLoading(false);
    })();
  }, []);

  // Período: "abertas" = tudo que está em aberto hoje (sem olhar data);
  // 30/90/365 = criadas nos últimos N dias; "YYYY-MM" = criadas no mês; "" = tudo.
  const noPeriodo = (v: { created_at: string; status?: string }) => {
    if (periodo === "abertas") return v.status ? emAberto(v.status) : true;
    if (periodo === "") return true;
    if (/^\d+$/.test(periodo)) return new Date(v.created_at) >= startOf(Number(periodo));
    return String(v.created_at ?? "").slice(0, 7) === periodo;
  };
  const mesesOpc = useMemo(() => { const now = new Date(); const out: string[] = []; for (let i = 0; i < 12; i++) out.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7)); return out; }, []);
  const rotuloPeriodo = (p: string) => p === "abertas" ? "Vagas em aberto hoje" : p === "" ? "Todo o período" : p === "30" ? "Últimos 30 dias" : p === "90" ? "Últimos 90 dias" : p === "365" ? "Últimos 12 meses" : `${MESES[+p.split("-")[1] - 1]}/${p.split("-")[0]}`;

  const motivos = useMemo(() => [...new Set(sols.map(s => s.motivo_vaga || "").filter(Boolean))].sort(), [sols]);
  const urgencias = useMemo(() => [...new Set(sols.map(s => s.grau_urgencia || "").filter(Boolean))].sort(), [sols]);

  // O recorte de tudo que está abaixo.
  const solsF = useMemo(() => sols.filter(s =>
    noPeriodo(s)
    && passaNoFiltroContratos(s, "contrato", fContratos)
    && (!fFase || fase(s.status) === fFase)
    && (!fMotivo || (s.motivo_vaga || "") === fMotivo)
    && (!fUrgencia || (s.grau_urgencia || "") === fUrgencia)
    && (!busca || [s.cargo, s.contrato, s.cidade, s.solicitante_nome, String(s.id)].some(x => String(x ?? "").toLowerCase().includes(busca.toLowerCase())))
  ), [sols, periodo, fContratos, fFase, fMotivo, fUrgencia, busca]); // eslint-disable-line react-hooks/exhaustive-deps
  const idsF = useMemo(() => new Set(solsF.map(s => s.id)), [solsF]);
  // Currículos: os das vagas no recorte + (sem recorte de contrato/fase) os do período.
  const cursF = useMemo(() => curs.filter(c => c.vaga_id ? idsF.has(c.vaga_id) : (fContratos.length === 0 && !fFase && !fMotivo && !fUrgencia && !busca && (periodo === "abertas" || periodo === "" || noPeriodo(c)))), [curs, idsF, fContratos, fFase, fMotivo, fUrgencia, busca, periodo]); // eslint-disable-line react-hooks/exhaustive-deps
  const filtrosAtivos = [fContratos.length ? 1 : 0, fFase, fMotivo, fUrgencia, busca].filter(Boolean).length;

  // ── Vagas em aberto por contrato (o bloco do topo) ─────────────
  const porContrato = useMemo(() => {
    const m = new Map<string, { contrato: string; solicitacoes: number; vagas: number; aprovacao: number; selecao: number; maisAntiga: number; cargos: Map<string, number> }>();
    for (const s of solsF) {
      if (!emAberto(s.status)) continue;
      const k = s.contrato || (s.administrativa ? `Administrativa${s.setor ? ` · ${s.setor}` : ""}` : "Sem contrato");
      const l = m.get(k) ?? { contrato: k, solicitacoes: 0, vagas: 0, aprovacao: 0, selecao: 0, maisAntiga: 0, cargos: new Map() };
      l.solicitacoes++; l.vagas += qtd(s);
      if (fase(s.status) === "Aguardando aprovação") l.aprovacao += qtd(s); else l.selecao += qtd(s);
      l.maisAntiga = Math.max(l.maisAntiga, diasDesde(s.created_at));
      const c = s.cargo || "—"; l.cargos.set(c, (l.cargos.get(c) ?? 0) + qtd(s));
      m.set(k, l);
    }
    return [...m.values()].sort((a, b) => b.vagas - a.vagas || a.contrato.localeCompare(b.contrato));
  }, [solsF]);
  const totalAbertas = porContrato.reduce((s, c) => s + c.vagas, 0);
  const totalSolAbertas = porContrato.reduce((s, c) => s + c.solicitacoes, 0);

  // ── KPIs ──────────────────────────────────────────────────────
  const total = solsF.length;
  const emProcesso = solsF.filter(s => fase(s.status) === "Em seleção").length;
  const contratados = solsF.filter(s => ehFinal(s.status)).length;
  const reprovadas = solsF.filter(s => ehMorta(s.status)).length;
  const aguardando = solsF.filter(s => fase(s.status) === "Aguardando aprovação").length;
  const urgentes = solsF.filter(s => emAberto(s.status) && /alta|urgente/i.test(s.grau_urgencia || "")).reduce((n, s) => n + qtd(s), 0);
  const t0 = startOf(0), t7 = startOf(7);
  const curvHoje = curs.filter(c => new Date(c.created_at) >= t0).length;
  const curvSemana = curs.filter(c => new Date(c.created_at) >= t7).length;
  const geral = curs.filter(c => c.tipo_candidatura === "geral" && !c.vaga_id).length;

  // ── Séries ────────────────────────────────────────────────────
  const dias14: { dia: string; qtd: number }[] = [];
  if (/^\d{4}-\d{2}$/.test(periodo)) {
    const [y, mm] = periodo.split("-").map(Number); const nDias = new Date(y, mm, 0).getDate();
    for (let d = 1; d <= nDias; d++) { const k = `${periodo}-${String(d).padStart(2, "0")}`; dias14.push({ dia: `${d}`, qtd: curs.filter(c => dayKey(new Date(c.created_at)) === k).length }); }
  } else {
    const n = periodo === "90" ? 30 : 14;
    for (let i = n - 1; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); const k = dayKey(d); dias14.push({ dia: `${d.getDate()}/${d.getMonth() + 1}`, qtd: curs.filter(c => dayKey(new Date(c.created_at)) === k).length }); }
  }
  const statusData = [
    { nome: "Aguardando aprovação", qtd: aguardando, cor: "#f59e0b" },
    { nome: "Em seleção", qtd: emProcesso, cor: "#3b82f6" },
    { nome: "Contratadas", qtd: contratados, cor: "#16a34a" },
    { nome: "Reprovadas/Canceladas", qtd: reprovadas, cor: "#dc2626" },
  ];
  const porChave = (f: (s: Vaga) => string, soVagas = true) => {
    const m = new Map<string, number>();
    for (const s of solsF) { const k = f(s) || "—"; m.set(k, (m.get(k) ?? 0) + (soVagas ? qtd(s) : 1)); }
    return [...m.entries()].map(([nome, n]) => ({ nome, qtd: n })).sort((a, b) => b.qtd - a.qtd);
  };
  const porMotivo = porChave(s => s.motivo_vaga || "");
  const porUrgencia = porChave(s => s.grau_urgencia || "");
  const porCargo = porChave(s => s.cargo || "").slice(0, 10);
  const porStatus = porChave(s => s.status, false).slice(0, 12);
  const aging = (() => {
    const b = [["até 7 dias", 0, 7], ["8–15", 8, 15], ["16–30", 16, 30], ["31–60", 31, 60], ["mais de 60", 61, 99999]] as const;
    return b.map(([nome, a, z]) => ({ nome, qtd: solsF.filter(s => emAberto(s.status) && diasDesde(s.created_at) >= a && diasDesde(s.created_at) <= z).reduce((n, s) => n + qtd(s), 0) }));
  })();
  const porVaga: Record<number, number> = {};
  cursF.forEach(c => { if (c.vaga_id) porVaga[c.vaga_id] = (porVaga[c.vaga_id] || 0) + 1; });
  const cargoDe = (id: number) => sols.find(s => s.id === id)?.cargo || `#${id}`;
  const vagaData = Object.entries(porVaga).map(([id, n]) => ({ vaga: `${cargoDe(+id)} #${id}`, qtd: n })).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  const CAND_ETAPAS = ["ENTRADA", "TRIAGEM", "JURÍDICO", "ENTREVISTA", "ENTREVISTA GESTOR", "APROVADO", "DOCUMENTAÇÃO", "EXAME SST", "SST + COMPRAS", "COMPRAS", "ADMISSÃO", "Reprovado"];
  const etapaCor: Record<string, string> = { ENTRADA: "#64748b", TRIAGEM: "#3b82f6", "JURÍDICO": "#8b5cf6", ENTREVISTA: "#0ea5e9", "ENTREVISTA GESTOR": "#6366f1", APROVADO: "#14b8a6", "DOCUMENTAÇÃO": "#0891b2", "EXAME SST": "#f59e0b", "SST + COMPRAS": "#f59e0b", COMPRAS: "#f97316", "ADMISSÃO": "#16a34a", Reprovado: "#dc2626" };
  const etapaData = CAND_ETAPAS.map(e => ({ etapa: e, qtd: cursF.filter(c => c.etapa_processo === e).length })).filter(d => d.qtd > 0);
  const CORES = ["#0f3171", "#2563eb", "#0891b2", "#16a34a", "#eab308", "#ea580c", "#dc2626", "#9333ea", "#db2777", "#64748b"];

  const Kpi = ({ label, val, color, sub }: { label: string; val: number | string; color: string; sub?: string }) => (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
      <div style={{ fontSize: 11.5, color: "#64748b", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 4, fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color, lineHeight: 1.1 }}>{val}</div>
      {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>{sub}</div>}
    </div>
  );
  const Card = ({ title, children, h = 300, largo }: { title: string; children: ReactNode; h?: number; largo?: boolean }) => (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.06)", gridColumn: largo ? "1 / -1" : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#0f3171", marginBottom: 12 }}>{title}</div>
      <div style={{ width: "100%", height: h }}>{children}</div>
    </div>
  );
  const sel: CSSProperties = { background: "#fff", border: "1.5px solid #94a3b8", borderRadius: 10, color: "#0f172a", fontSize: 13.5, fontWeight: 700, padding: "8px 12px", outline: "none", fontFamily: "inherit" };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "linear-gradient(135deg,#fff,#f8fbff)", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f3171" }}>📊 Dashboard — Recrutamento e Seleção</div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>Vagas em aberto por contrato, fases, candidaturas e tempo por etapa — tudo no recorte dos filtros.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <select value={periodo} onChange={e => setPeriodo(e.target.value)} style={sel}>
            <option value="abertas">📌 Vagas em aberto hoje</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="365">Últimos 12 meses</option>
            {mesesOpc.map(m => <option key={m} value={m}>{rotuloPeriodo(m)}</option>)}
            <option value="">Todo o período</option>
          </select>
          <FiltroContratos linhas={sols.filter(noPeriodo)} campo="contrato" selecionados={fContratos} onChange={setFContratos} />
        </div>
      </div>

      {/* Barra de filtros */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "10px 24px 0" }}>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="🔎 Cargo, contrato, cidade, solicitante ou nº…" style={{ ...sel, fontWeight: 500, minWidth: 280, flex: 1 }} />
        <select value={fFase} onChange={e => setFFase(e.target.value)} style={sel}><option value="">Todas as fases</option>{FASES.map(f => <option key={f}>{f}</option>)}</select>
        <select value={fMotivo} onChange={e => setFMotivo(e.target.value)} style={sel}><option value="">Todos os motivos</option>{motivos.map(m => <option key={m}>{m}</option>)}</select>
        <select value={fUrgencia} onChange={e => setFUrgencia(e.target.value)} style={sel}><option value="">Toda urgência</option>{urgencias.map(u => <option key={u}>{u}</option>)}</select>
        {filtrosAtivos > 0 && <button onClick={() => { setFContratos([]); setFFase(""); setFMotivo(""); setFUrgencia(""); setBusca(""); }} style={{ ...sel, borderColor: "#fecaca", color: "#b91c1c", cursor: "pointer" }}>✕ Limpar filtros ({filtrosAtivos})</button>}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 28px" }}>
        {loading ? (
          <div style={{ padding: "60px 20px", textAlign: "center", color: "#64748b" }}>Carregando indicadores...</div>
        ) : (<>
          {/* ── Vagas em aberto por contrato ── */}
          <div style={{ background: "#fff", border: "2px solid #0f3171", borderRadius: 18, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.08)", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 900, color: "#0f3171" }}>📌 Vagas em aberto por contrato</div>
              <div style={{ fontSize: 13, color: "#475569" }}><b style={{ color: "#0f172a", fontSize: 16 }}>{totalAbertas}</b> vaga{totalAbertas === 1 ? "" : "s"} em <b>{totalSolAbertas}</b> solicitaç{totalSolAbertas === 1 ? "ão" : "ões"}, em <b>{porContrato.length}</b> contrato{porContrato.length === 1 ? "" : "s"} · clique no contrato pra filtrar o painel</div>
            </div>
            {porContrato.length === 0 ? <div style={{ color: "#64748b", fontSize: 13.5, padding: 10 }}>Nenhuma vaga em aberto neste recorte.</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 10 }}>
                {porContrato.map(c => {
                  const ativo = fContratos.length === 1 && fContratos[0] === c.contrato;
                  return (
                    <button key={c.contrato} onClick={() => setFContratos(ativo ? [] : [c.contrato])}
                      style={{ textAlign: "left", border: `1.5px solid ${ativo ? "#0f3171" : "#e2e8f0"}`, background: ativo ? "#eef4ff" : "#f8fafc", borderRadius: 14, padding: "12px 14px", cursor: "pointer", fontFamily: "inherit", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                        <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13.5, lineHeight: 1.25 }}>{c.contrato}</div>
                        <div style={{ fontSize: 26, fontWeight: 900, color: "#0f3171", lineHeight: 1 }}>{c.vagas}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11.5, fontWeight: 700 }}>
                        {c.aprovacao > 0 && <span style={{ background: "#fef3c7", color: "#b45309", borderRadius: 999, padding: "2px 9px" }}>⏳ {c.aprovacao} aguardando aprovação</span>}
                        {c.selecao > 0 && <span style={{ background: "#dbeafe", color: "#1d4ed8", borderRadius: 999, padding: "2px 9px" }}>🔎 {c.selecao} em seleção</span>}
                        <span style={{ background: c.maisAntiga > 30 ? "#fee2e2" : "#f1f5f9", color: c.maisAntiga > 30 ? "#b91c1c" : "#475569", borderRadius: 999, padding: "2px 9px" }}>mais antiga há {c.maisAntiga} d</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#475569" }}>{[...c.cargos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([cargo, n]) => `${n}× ${cargo}`).join(" · ")}{c.cargos.size > 4 ? " · …" : ""}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 18 }}>
            <Kpi label="Solicitações" val={total} color="#0f3171" sub={rotuloPeriodo(periodo)} />
            <Kpi label="Vagas em aberto" val={totalAbertas} color="#0f3171" sub={`${totalSolAbertas} solicitações`} />
            <Kpi label="Aguardando aprovação" val={aguardando} color="#f59e0b" />
            <Kpi label="Em seleção" val={emProcesso} color="#3b82f6" />
            <Kpi label="Urgentes em aberto" val={urgentes} color="#dc2626" sub="vagas com urgência alta" />
            <Kpi label="Contratadas" val={contratados} color="#16a34a" />
            <Kpi label="Reprovadas/Canceladas" val={reprovadas} color="#dc2626" />
            <Kpi label="Currículos hoje / 7 dias" val={`${curvHoje} / ${curvSemana}`} color="#f97316" />
            <Kpi label="Banco de Talentos" val={geral} color="#8b5cf6" />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(380px,1fr))", gap: 16 }}>
            <Card title="Solicitações por fase">
              <ResponsiveContainer>
                <BarChart data={statusData} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="nome" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Bar dataKey="qtd" name="Solicitações" radius={[6, 6, 0, 0]}>{statusData.map((d, i) => <Cell key={i} fill={d.cor} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Vagas por motivo">
              {porMotivo.length === 0 ? <Vazio texto="Sem dados." /> : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={porMotivo} dataKey="qtd" nameKey="nome" cx="50%" cy="50%" innerRadius={50} outerRadius={90} label={e => e.qtd}>
                      {porMotivo.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                    </Pie>
                    <Legend /><Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Vagas por urgência">
              {porUrgencia.length === 0 ? <Vazio texto="Sem dados." /> : (
                <ResponsiveContainer>
                  <BarChart data={porUrgencia} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="nome" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <Tooltip />
                    <Bar dataKey="qtd" name="Vagas" radius={[6, 6, 0, 0]}>{porUrgencia.map((d, i) => <Cell key={i} fill={/alta|urgente/i.test(d.nome) ? "#dc2626" : /m[eé]dia/i.test(d.nome) ? "#f59e0b" : "#16a34a"} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Tempo em aberto (vagas ainda abertas)">
              <ResponsiveContainer>
                <BarChart data={aging} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="nome" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Bar dataKey="qtd" name="Vagas" radius={[6, 6, 0, 0]}>{aging.map((d, i) => <Cell key={i} fill={["#16a34a", "#84cc16", "#f59e0b", "#f97316", "#dc2626"][i]} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Vagas por cargo (top 10)" h={Math.max(300, porCargo.length * 30)}>
              {porCargo.length === 0 ? <Vazio texto="Sem dados." /> : (
                <ResponsiveContainer>
                  <BarChart data={porCargo} layout="vertical" margin={{ top: 6, right: 16, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis type="category" dataKey="nome" width={160} tick={{ fontSize: 10, fill: "#475569" }} />
                    <Tooltip />
                    <Bar dataKey="qtd" name="Vagas" fill="#0f3171" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Solicitações por status (detalhado)" h={Math.max(300, porStatus.length * 28)}>
              {porStatus.length === 0 ? <Vazio texto="Sem dados." /> : (
                <ResponsiveContainer>
                  <BarChart data={porStatus} layout="vertical" margin={{ top: 6, right: 16, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis type="category" dataKey="nome" width={200} tick={{ fontSize: 9.5, fill: "#475569" }} />
                    <Tooltip />
                    <Bar dataKey="qtd" name="Solicitações" fill="#2563eb" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title={/^\d{4}-\d{2}$/.test(periodo) ? `Currículos recebidos — ${rotuloPeriodo(periodo)}` : periodo === "90" ? "Currículos recebidos — últimos 30 dias" : "Currículos recebidos — últimos 14 dias"}>
              <ResponsiveContainer>
                <LineChart data={dias14} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="qtd" name="Currículos" stroke="#f97316" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Tempo médio por etapa (dias)">
              {tempos.length === 0 ? <Vazio texto="Ainda sem transições registradas." /> : (
                <ResponsiveContainer>
                  <BarChart data={tempos} layout="vertical" margin={{ top: 6, right: 16, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis type="category" dataKey="etapa" width={150} tick={{ fontSize: 9.5, fill: "#475569" }} />
                    <Tooltip />
                    <Bar dataKey="dias" name="Dias (média)" fill="#0f3171" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Candidaturas por vaga (top 8)">
              {vagaData.length === 0 ? <Vazio texto="Nenhuma candidatura por vaga neste recorte." /> : (
                <ResponsiveContainer>
                  <BarChart data={vagaData} layout="vertical" margin={{ top: 6, right: 16, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis type="category" dataKey="vaga" width={150} tick={{ fontSize: 9.5, fill: "#475569" }} />
                    <Tooltip />
                    <Bar dataKey="qtd" name="Candidaturas" fill="#f97316" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>

            <Card title="Candidatos por etapa (kanban)">
              {etapaData.length === 0 ? <Vazio texto="Nenhum candidato no processo neste recorte." /> : (
                <ResponsiveContainer>
                  <BarChart data={etapaData} layout="vertical" margin={{ top: 6, right: 16, left: 20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis type="category" dataKey="etapa" width={130} tick={{ fontSize: 9.5, fill: "#475569" }} />
                    <Tooltip />
                    <Bar dataKey="qtd" name="Candidatos" radius={[0, 6, 6, 0]}>{etapaData.map((d, i) => <Cell key={i} fill={etapaCor[d.etapa] || "#0f3171"} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Card>
          </div>
        </>)}
      </div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#64748b", fontSize: 13 }}>{texto}</div>;
}
