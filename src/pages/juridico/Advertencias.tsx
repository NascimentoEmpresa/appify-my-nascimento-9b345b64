import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { ConversaSolicitacao } from "@/components/solicitacoes/ConversaSolicitacao";
import { FiltroContratos, passaNoFiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { ResumoDeFuncoes } from "@/components/fluxos/ResumoDeFuncoes";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie, Legend, CartesianGrid } from "recharts";

// =====================================================================
// Gestão de Advertências — Jurídico › Advertências (tela única).
//
// Encarregado cria (em Minhas Solicitações) → quem tem a ação "aprovar" no
// menu `advertencias` (Administração › Acesso por Usuário) aprova/reprova
// ("Aguardando Aprovação") → o Jurídico conclui com parecer ("Aguardando
// Jurídico") → Concluída/Reprovada. Tabela SISTEMA_SOLICITACOES_ADVERTENCIA.
//
// Histórico de quem aprovava:
//   até 15/09/2026  analista do contrato (CONTRATOS.analista), por esta tela;
//   15/09/2026      Operacional, em /app/operacional/advertencias (mig 117);
//   16/09/2026      pedido do Pablo: "tira do Operacional, deixa só pro
//                   Jurídico, e lá vai ter quem pode aprovar" → ação
//                   `aprovar` no menu que já existe (mig 124), igual ao
//                   Parecer Jurídico. A rota do Operacional saiu.
//
// A mesma tela tem a aba DASHBOARD (16/09/2026): status, grau, tipo,
// contratos, meses e tempo de resposta — sempre no recorte do
// "Filtros · Contratos", o mesmo do Recrutamento.
// =====================================================================

interface Adv {
  id: number; created_at: string; status_changed_at: string;
  solicitante_nome: string; solicitante_email: string;
  colaborador_nome: string; colaborador_cpf: string; colaborador_cargo: string; colaborador_filial: string;
  contrato: string; contrato_id: number | null;
  tipo_advertencia: string; grau: string; descricao_ocorrido: string; data_ocorrido: string;
  ja_advertencia_anterior: boolean; detalhe_anterior: string; advertencia_verbal_dada: boolean; data_advertencia_verbal: string;
  status: string; aprovado_por_nome: string; motivo_reprovacao: string;
  parecer_juridico: string; resultado: string; concluido_por_nome: string;
  excecao?: boolean; justificativa_excecao?: string;
}

const STATUS = ["Aguardando Aprovação", "Aguardando Jurídico", "Concluída", "Reprovada"];
const statusCor = (s: string): { bg: string; c: string } => ({
  "Aguardando Aprovação": { bg: "#fef3c7", c: "#b45309" },
  "Aguardando Jurídico": { bg: "#ede9fe", c: "#7c3aed" },
  "Concluída": { bg: "#dcfce7", c: "#15803d" },
  "Reprovada": { bg: "#fee2e2", c: "#b91c1c" },
}[s] || { bg: "#e0f2fe", c: "#0369a1" });
const grauCor = (g: string): string => ({ "Baixo": "#16a34a", "Médio": "#d97706", "Alto": "#dc2626" }[g] || "#64748b");
const fmtDt = (s?: string) => { if (!s) return "—"; const d = new Date(String(s).length <= 10 ? s + "T12:00:00" : s); return isNaN(+d) ? String(s) : d.toLocaleDateString("pt-BR"); };

export default function Advertencias() {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const meuNome = empregado?.nome || (user?.user_metadata as any)?.nome || user?.email || "Usuário";
  const souJuridico = empregado?.setor === "JURIDICO" && empregado?.situacao === "Trabalhando";
  // Quem aprova/reprova: ação "aprovar" no menu advertencias (Acesso por Usuário).
  const { data: temAprovar } = useScreenAccess("advertencias", "aprovar");
  const podeAprovar = !!temAprovar;
  // Quem conclui com parecer: o Jurídico — e o aprovador também pode.
  const podeConcluir = souJuridico || podeAprovar;

  const [rows, setRows] = useState<Adv[]>([]);
  const [loading, setLoading] = useState(true);
  const [visao, setVisao] = useState<"lista" | "dashboard">("lista");
  const [aba, setAba] = useState("Aguardando Aprovação");
  const [busca, setBusca] = useState("");
  // Filtros · Contratos (14/09/2026): multi, com contagem — era um select de um só.
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  // modais de ação
  const [reprovar, setReprovar] = useState<Adv | null>(null);
  const [motivoRep, setMotivoRep] = useState("");
  const [concluir, setConcluir] = useState<Adv | null>(null);
  const [parecer, setParecer] = useState("");
  const [resultado, setResultado] = useState("Advertência aplicada");
  const [detalhe, setDetalhe] = useState<Adv | null>(null);

  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600); };

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("SISTEMA_SOLICITACOES_ADVERTENCIA").select("*").order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Recorte do "Filtros · Contratos": vale pros KPIs, pra lista e pro dashboard.
  const noRecorte = useMemo(() => rows.filter(r => passaNoFiltroContratos(r, "contrato", fContratos)), [rows, fContratos]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of noRecorte) c[r.status] = (c[r.status] || 0) + 1; return c; }, [noRecorte]);
  const filtradas = useMemo(() => noRecorte.filter(r => {
    if (aba && r.status !== aba) return false;
    if (busca) { const q = busca.toLowerCase(); return [r.colaborador_nome, r.contrato, r.tipo_advertencia, r.grau, r.solicitante_nome].some(x => String(x || "").toLowerCase().includes(q)); }
    return true;
  }), [noRecorte, aba, busca]);

  // ── Dashboard (16/09/2026) ─────────────────────────────────────────
  const dash = useMemo(() => {
    const porChave = (f: (a: Adv) => string) => {
      const m = new Map<string, number>();
      for (const a of noRecorte) { const k = f(a) || "—"; m.set(k, (m.get(k) || 0) + 1); }
      return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((x, y) => y.n - x.n);
    };
    const porStatus = STATUS.map(s => ({ nome: s, n: counts[s] || 0 })).filter(x => x.n > 0);
    const porGrau = ["Baixo", "Médio", "Alto"].map(g => ({ nome: g, n: noRecorte.filter(a => a.grau === g).length }));
    const porTipo = porChave(a => a.tipo_advertencia);
    const porContrato = porChave(a => a.contrato).slice(0, 12);
    const porResultado = porChave(a => a.status === "Concluída" ? (a.resultado || "Sem resultado") : "").filter(x => x.nome !== "—");
    // Últimos 12 meses (pela abertura), empilhado por status final.
    const meses: { chave: string; rotulo: string; abertas: number; concluidas: number; reprovadas: number; pendentes: number }[] = [];
    const hoje = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
      meses.push({ chave: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, rotulo: d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", ""), abertas: 0, concluidas: 0, reprovadas: 0, pendentes: 0 });
    }
    for (const a of noRecorte) {
      const k = String(a.created_at || "").slice(0, 7);
      const m = meses.find(x => x.chave === k); if (!m) continue;
      m.abertas++;
      if (a.status === "Concluída") m.concluidas++; else if (a.status === "Reprovada") m.reprovadas++; else m.pendentes++;
    }
    // Tempo médio (dias) da abertura até a decisão final.
    const dias = (a: Adv) => (+new Date(a.status_changed_at || a.created_at) - +new Date(a.created_at)) / 86400000;
    const finais = noRecorte.filter(a => a.status === "Concluída" || a.status === "Reprovada");
    const tempoMedio = finais.length ? finais.reduce((s, a) => s + Math.max(0, dias(a)), 0) / finais.length : 0;
    const pendentes = noRecorte.filter(a => a.status === "Aguardando Aprovação" || a.status === "Aguardando Jurídico");
    const pendentesVelhas = pendentes.filter(a => (+hoje - +new Date(a.created_at)) / 86400000 > 7).length;
    const taxaReprovacao = finais.length ? Math.round((noRecorte.filter(a => a.status === "Reprovada").length / finais.length) * 100) : 0;
    const excecoes = noRecorte.filter(a => a.excecao).length;
    const reincidentes = (() => { const m = new Map<string, number>(); for (const a of noRecorte) { const k = a.colaborador_cpf || a.colaborador_nome; if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m.values()].filter(n => n > 1).length; })();
    return { porStatus, porGrau, porTipo, porContrato, porResultado, meses, tempoMedio, pendentes: pendentes.length, pendentesVelhas, taxaReprovacao, excecoes, reincidentes };
  }, [noRecorte, counts]);

  const aprovarAdv = async (a: Adv) => {
    if (!confirm(`Aprovar a advertência de ${a.colaborador_nome}? Segue para o parecer do Jurídico.`)) return;
    const { error } = await (supabase as any).from("SISTEMA_SOLICITACOES_ADVERTENCIA").update({ status: "Aguardando Jurídico", aprovado_por_nome: meuNome }).eq("id", a.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    toast("Advertência aprovada — segue para o parecer.", "ok"); load();
  };
  const confirmarReprovar = async () => {
    if (!reprovar) return;
    if (!motivoRep.trim()) { toast("Informe o motivo da reprovação.", "err"); return; }
    const { error } = await (supabase as any).from("SISTEMA_SOLICITACOES_ADVERTENCIA").update({ status: "Reprovada", motivo_reprovacao: motivoRep.trim(), aprovado_por_nome: meuNome }).eq("id", reprovar.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setReprovar(null); setMotivoRep(""); toast("Advertência reprovada.", "ok"); load();
  };
  const confirmarConcluir = async () => {
    if (!concluir) return;
    const { error } = await (supabase as any).from("SISTEMA_SOLICITACOES_ADVERTENCIA").update({ status: "Concluída", parecer_juridico: parecer.trim() || null, resultado, concluido_por_nome: meuNome }).eq("id", concluir.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setConcluir(null); setParecer(""); setResultado("Advertência aplicada"); toast("Advertência concluída.", "ok"); load();
  };

  const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 14, boxShadow: "0 8px 24px rgba(15,23,42,.05)" };
  const kpiBox = (label: string, n: number | string, cor: string) => (
    <div style={{ ...card, flex: 1, minWidth: 150, borderTop: `3px solid ${cor}` }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor, marginTop: 3 }}>{n}</div>
    </div>
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 16, background: "linear-gradient(135deg,#fff,#f8fbff)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f3171" }}>⚠️ Gestão de Advertências</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {podeAprovar
              ? "O que os encarregados pediram chega aqui. Aprove ou reprove; o aprovado segue para o parecer do Jurídico."
              : "O que os encarregados pediram. Quem aprova é definido em Administração › Acesso por Usuário (ação Aprovar); o Jurídico conclui com parecer."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
            {(["lista", "dashboard"] as const).map(v => (
              <button key={v} onClick={() => setVisao(v)} style={{ border: "none", padding: "8px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", background: visao === v ? "#0f3171" : "#fff", color: visao === v ? "#fff" : "#475569" }}>
                {v === "lista" ? "☰ Lista" : "📊 Dashboard"}
              </button>
            ))}
          </div>
          <ResumoDeFuncoes fluxo="advertencia" />
          <button onClick={() => load()} style={{ border: "none", borderRadius: 9, fontWeight: 700, cursor: "pointer", fontSize: 12, padding: "8px 14px", background: "#0f3171", color: "#fff" }}>↻ Atualizar</button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 28px" }}>
        {/* Filtros · Contratos — o mesmo do Recrutamento; recorta KPIs, lista e dashboard. */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <FiltroContratos linhas={rows} campo="contrato" selecionados={fContratos} onChange={setFContratos} />
          {fContratos.length > 0 && <span style={{ fontSize: 12, color: "#64748b" }}>{noRecorte.length} de {rows.length} advertência(s) no recorte</span>}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          {kpiBox(podeAprovar ? "Aguardando você" : "Aguardando aprovação", counts["Aguardando Aprovação"] || 0, "#d97706")}
          {kpiBox("Aguardando parecer", counts["Aguardando Jurídico"] || 0, "#7c3aed")}
          {kpiBox("Concluídas", counts["Concluída"] || 0, "#15803d")}
          {kpiBox("Reprovadas", counts["Reprovada"] || 0, "#dc2626")}
        </div>

        {visao === "dashboard" ? (
          loading ? <div style={{ padding: 50, textAlign: "center", color: "#94a3b8" }}>Carregando…</div> : noRecorte.length === 0 ? <div style={{ ...card, padding: 46, textAlign: "center", color: "#94a3b8" }}>Nenhuma advertência no recorte.</div> : (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              {kpiBox("Total no recorte", noRecorte.length, "#0f3171")}
              {kpiBox("Pendentes", dash.pendentes, "#d97706")}
              {kpiBox("Pendentes há +7 dias", dash.pendentesVelhas, dash.pendentesVelhas ? "#dc2626" : "#64748b")}
              {kpiBox("Tempo médio até decisão", dash.tempoMedio ? `${dash.tempoMedio.toFixed(1)} d` : "—", "#2563eb")}
              {kpiBox("Taxa de reprovação", `${dash.taxaReprovacao}%`, "#b91c1c")}
              {kpiBox("Fora do prazo (exceções)", dash.excecoes, dash.excecoes ? "#b45309" : "#64748b")}
              {kpiBox("Colaboradores reincidentes", dash.reincidentes, dash.reincidentes ? "#7c3aed" : "#64748b")}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14, marginBottom: 14 }}>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Por status</div>
                <ResponsiveContainer width="100%" height={230}>
                  <PieChart>
                    <Pie data={dash.porStatus} dataKey="n" nameKey="nome" innerRadius={55} outerRadius={85} paddingAngle={2}>
                      {dash.porStatus.map(x => <Cell key={x.nome} fill={statusCor(x.nome).c} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => [v, "advertências"]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Por grau</div>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={dash.porGrau} margin={{ left: 0, right: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                    <Tooltip formatter={(v: any) => [v, "advertências"]} />
                    <Bar dataKey="n" radius={[6, 6, 0, 0]}>{dash.porGrau.map(x => <Cell key={x.nome} fill={grauCor(x.nome)} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Resultado das concluídas</div>
                {dash.porResultado.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 12, padding: 30, textAlign: "center" }}>Nenhuma concluída no recorte.</div> : (
                  <ResponsiveContainer width="100%" height={230}>
                    <PieChart>
                      <Pie data={dash.porResultado} dataKey="n" nameKey="nome" outerRadius={85}>
                        {dash.porResultado.map((x, i) => <Cell key={x.nome} fill={["#15803d", "#d97706", "#64748b", "#dc2626", "#2563eb"][i % 5]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => [v, "advertências"]} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div style={{ ...card, marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Abertas por mês (últimos 12 meses)</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dash.meses} margin={{ left: 0, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="concluidas" name="Concluídas" stackId="a" fill="#15803d" />
                  <Bar dataKey="reprovadas" name="Reprovadas" stackId="a" fill="#dc2626" />
                  <Bar dataKey="pendentes" name="Pendentes" stackId="a" fill="#d97706" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14 }}>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Por tipo de advertência</div>
                <ResponsiveContainer width="100%" height={Math.max(200, dash.porTipo.length * 34)}>
                  <BarChart data={dash.porTipo} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis type="category" dataKey="nome" width={150} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => [v, "advertências"]} />
                    <Bar dataKey="n" fill="#0f3171" radius={[0, 6, 6, 0]} label={{ position: "right", fontSize: 11 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 8 }}>Por contrato (top 12)</div>
                <ResponsiveContainer width="100%" height={Math.max(200, dash.porContrato.length * 34)}>
                  <BarChart data={dash.porContrato} layout="vertical" margin={{ left: 10, right: 30 }}>
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis type="category" dataKey="nome" width={190} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => [v, "advertências"]} />
                    <Bar dataKey="n" fill="#7c3aed" radius={[0, 6, 6, 0]} label={{ position: "right", fontSize: 11 }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )) : (<>
        <div style={{ ...card, marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {STATUS.map(s => (
            <button key={s} onClick={() => setAba(s)} style={{ padding: "6px 12px", borderRadius: 18, fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${aba === s ? "#0f3171" : "#e2e8f0"}`, background: aba === s ? "#0f3171" : "#fff", color: aba === s ? "#fff" : "#475569" }}>
              {s}{counts[s] ? ` (${counts[s]})` : ""}
            </button>
          ))}
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar colaborador, contrato, tipo…" style={{ marginLeft: "auto", height: 36, border: "1px solid #cbd5e1", borderRadius: 9, padding: "0 11px", fontSize: 13, minWidth: 220 }} />
        </div>

        {loading ? <div style={{ padding: 50, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
          : filtradas.length === 0 ? <div style={{ ...card, padding: 46, textAlign: "center", color: "#94a3b8" }}>Nenhuma advertência neste status.</div>
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14 }}>
                {filtradas.map(a => { const sc = statusCor(a.status); const mostraAprovar = podeAprovar && a.status === "Aguardando Aprovação"; const mostraConcluir = podeConcluir && a.status === "Aguardando Jurídico"; return (
                  <div key={a.id} style={{ ...card, borderLeft: `4px solid ${grauCor(a.grau)}`, display: "flex", flexDirection: "column", ...(a.excecao ? { border: "1.5px solid #fbbf24", borderLeft: `4px solid ${grauCor(a.grau)}`, background: "#fffdf7" } : {}) }}>
                    {a.excecao && <div style={{ background: "#fef3c7", color: "#b45309", fontSize: 11, fontWeight: 800, padding: "5px 9px", borderRadius: 7, marginBottom: 8, overflowWrap: "break-word", wordBreak: "break-word" }}>⚠️ EXCEÇÃO — aplicada fora do prazo de 3 dias{a.justificativa_excecao ? `: ${a.justificativa_excecao}` : ""}</div>}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13.5 }}>{a.colaborador_nome}</div>
                      <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: sc.bg, color: sc.c, whiteSpace: "nowrap" }}>{a.status}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{a.colaborador_cargo || "—"}{a.contrato ? ` · ${a.contrato}` : ""}</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#f1f5f9", color: "#334155" }}>{a.tipo_advertencia || "—"}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: "#fff", color: grauCor(a.grau), border: `1px solid ${grauCor(a.grau)}` }}>Grau {a.grau || "—"}</span>
                      <span style={{ fontSize: 11, color: "#64748b" }}>Ocorrido: {fmtDt(a.data_ocorrido)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.4, maxHeight: 60, overflow: "hidden", overflowWrap: "break-word", wordBreak: "break-word" }}>{a.descricao_ocorrido || "—"}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>Solicitante: {a.solicitante_nome || "—"} · #{a.id}</div>
                    {a.status === "Reprovada" && a.motivo_reprovacao && <div style={{ fontSize: 11.5, color: "#b91c1c", marginTop: 6, background: "#fef2f2", borderRadius: 8, padding: "6px 9px" }}>Reprovada: {a.motivo_reprovacao}</div>}
                    {a.status === "Concluída" && <div style={{ fontSize: 11.5, color: "#15803d", marginTop: 6, background: "#f0fdf4", borderRadius: 8, padding: "6px 9px" }}>Resultado: <b>{a.resultado || "—"}</b>{a.parecer_juridico ? ` · ${a.parecer_juridico}` : ""}</div>}
                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      <button onClick={() => setDetalhe(a)} style={{ border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, padding: "7px 12px", background: "#eef4ff", color: "#0f3171" }}>Detalhes</button>
                      {mostraAprovar && <>
                        <button onClick={() => aprovarAdv(a)} style={{ border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, padding: "7px 12px", background: "#16a34a", color: "#fff" }}>Aprovar</button>
                        <button onClick={() => { setReprovar(a); setMotivoRep(""); }} style={{ border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, padding: "7px 12px", background: "#fee2e2", color: "#b91c1c" }}>Reprovar</button>
                      </>}
                      {mostraConcluir && <button onClick={() => { setConcluir(a); setParecer(""); setResultado("Advertência aplicada"); }} style={{ border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: 12, padding: "7px 12px", background: "#7c3aed", color: "#fff" }}>Concluir</button>}
                      {a.status === "Aguardando Aprovação" && !mostraAprovar && <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center" }}>Aguardando quem aprova</span>}
                      {a.status === "Aguardando Jurídico" && !mostraConcluir && <span style={{ fontSize: 11, color: "#94a3b8", alignSelf: "center" }}>Aguardando o parecer do Jurídico</span>}
                    </div>
                  </div>
                ); })}
              </div>
            )}
        </>)}
      </div>

      {/* Detalhe */}
      {detalhe && (
        <div onClick={e => { if (e.target === e.currentTarget) setDetalhe(null); }} style={{ position: "fixed", inset: 0, zIndex: 700, background: "rgba(15,23,42,.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: "100%", maxWidth: 620, maxHeight: "92vh", overflowY: "auto", position: "relative" }}>
            <button onClick={() => setDetalhe(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{detalhe.colaborador_nome}</div>
            <div style={{ fontSize: 12.5, color: "#475569", marginBottom: 12 }}>{detalhe.colaborador_cargo || "—"} · CPF {detalhe.colaborador_cpf || "—"}{detalhe.contrato ? ` · ${detalhe.contrato}` : ""}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {[["Tipo", detalhe.tipo_advertencia], ["Grau", detalhe.grau], ["Data do ocorrido", fmtDt(detalhe.data_ocorrido)], ["Status", detalhe.status], ["Advertência verbal já foi dada para o mesmo fato?", detalhe.advertencia_verbal_dada ? "Sim" : "Não"], ["Data da advertência verbal", detalhe.advertencia_verbal_dada ? fmtDt(detalhe.data_advertencia_verbal) : "—"], ["Solicitante", detalhe.solicitante_nome], ["Aprovado/decidido por", detalhe.aprovado_por_nome || "—"]].map(([l, v]) => (
                <div key={String(l)} style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 9, padding: "7px 10px" }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>{l}</div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#334155", marginTop: 2 }}>{String(v || "—")}</div>
                </div>
              ))}
            </div>
            {detalhe.excecao && (
              <div style={{ marginTop: 12, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#b45309", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 3 }}>⚠️ Exceção de prazo</div>
                <div style={{ fontSize: 12.5, color: "#92400e", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word" }}>{detalhe.justificativa_excecao || "Aplicada fora do prazo de 3 dias."}</div>
              </div>
            )}
            <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", margin: "14px 0 4px" }}>Descrição do ocorrido</div>
            <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "break-word", background: "#f8fafc", borderRadius: 9, padding: "9px 12px" }}>{detalhe.descricao_ocorrido || "—"}</div>
            {detalhe.detalhe_anterior && <><div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", margin: "12px 0 4px" }}>Advertência anterior</div><div style={{ fontSize: 12.5, color: "#475569" }}>{detalhe.detalhe_anterior}</div></>}
            {detalhe.parecer_juridico && <><div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", margin: "12px 0 4px" }}>Parecer do Jurídico</div><div style={{ fontSize: 12.5, color: "#475569" }}>{detalhe.parecer_juridico}</div></>}

            {/* O encarregado que pediu a advertência escreve do lado dele, em
                Minhas Solicitações. É o mesmo fio — sem este bloco, ele
                perguntava e ninguém via. */}
            <div style={{ marginTop: 16 }}>
              <ConversaSolicitacao
                modulo="advertencia" entidadeId={detalhe.id}
                aviso="Quem solicitou a advertência lê e responde por Encarregados › Minhas Solicitações."
              />
            </div>
          </div>
        </div>
      )}

      {/* Reprovar */}
      {reprovar && (
        <div onClick={e => { if (e.target === e.currentTarget) setReprovar(null); }} style={{ position: "fixed", inset: 0, zIndex: 710, background: "rgba(15,23,42,.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: "100%", maxWidth: 480 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Reprovar advertência</div>
            <textarea value={motivoRep} onChange={e => setMotivoRep(e.target.value)} rows={4} placeholder="Motivo da reprovação…" style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 9, padding: "9px 11px", fontSize: 13, boxSizing: "border-box" }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => setReprovar(null)} style={{ border: "1px solid #e2e8f0", borderRadius: 9, background: "#fff", color: "#475569", fontWeight: 700, fontSize: 12, padding: "8px 14px", cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarReprovar} style={{ border: "none", borderRadius: 9, background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: 12, padding: "8px 14px", cursor: "pointer" }}>Reprovar</button>
            </div>
          </div>
        </div>
      )}

      {/* Concluir (Jurídico) */}
      {concluir && (
        <div onClick={e => { if (e.target === e.currentTarget) setConcluir(null); }} style={{ position: "fixed", inset: 0, zIndex: 710, background: "rgba(15,23,42,.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: "100%", maxWidth: 480 }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>Concluir advertência</div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Resultado</label>
            <select value={resultado} onChange={e => setResultado(e.target.value)} style={{ width: "100%", height: 38, border: "1px solid #cbd5e1", borderRadius: 9, padding: "0 11px", fontSize: 13, margin: "4px 0 10px" }}>
              {["Advertência aplicada", "Suspensão aplicada", "Arquivada / sem medida", "Encaminhada para demissão"].map(o => <option key={o}>{o}</option>)}
            </select>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Parecer do Jurídico</label>
            <textarea value={parecer} onChange={e => setParecer(e.target.value)} rows={4} placeholder="Observações / fundamentação (opcional)…" style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: 9, padding: "9px 11px", fontSize: 13, boxSizing: "border-box", marginTop: 4 }} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button onClick={() => setConcluir(null)} style={{ border: "1px solid #e2e8f0", borderRadius: 9, background: "#fff", color: "#475569", fontWeight: 700, fontSize: 12, padding: "8px 14px", cursor: "pointer" }}>Cancelar</button>
              <button onClick={confirmarConcluir} style={{ border: "none", borderRadius: 9, background: "#7c3aed", color: "#fff", fontWeight: 700, fontSize: 12, padding: "8px 14px", cursor: "pointer" }}>Concluir</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (<div key={t.id} style={{ padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.12)", background: t.t === "ok" ? "#ecfdf3" : t.t === "err" ? "#fef2f2" : "#eff6ff", color: t.t === "ok" ? "#15803d" : t.t === "err" ? "#b91c1c" : "#1d4ed8", border: `1px solid ${t.t === "ok" ? "#86efac" : t.t === "err" ? "#fecaca" : "#bfdbfe"}` }}>{t.msg}</div>))}
      </div>
    </div>
  );
}
