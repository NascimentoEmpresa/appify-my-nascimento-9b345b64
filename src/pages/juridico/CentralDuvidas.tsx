import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { usePermissoes } from "@/context/PermissoesContext";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FioDuvida } from "@/components/juridico/FioDuvida";
import { DashboardDuvidas } from "@/components/juridico/DashboardDuvidas";
import { CATEGORIAS_DUVIDA as CATEGORIAS, agruparComplementos, complementoPendente, infoAvaliacao, type Complemento, type Duvida } from "@/lib/juridico/duvidas";

// =====================================================================
// JURÍDICO — Parecer Jurídico (gestão das dúvidas)
// Fluxo: pergunta (Central de Serviços) → 'Aberta' → Diretor Administrativo /
// aprovador aprova ('Aprovada') ou reprova ('Reprovada' + motivo) → o Jurídico
// responde as 'Aprovada' → 'Respondida' (entra na biblioteca pública).
// Quem aprova (15/09/2026): a ação "aprovar" do menu "duvidas", marcada em
// Administração › Acesso por Usuário — o botão "Quem aprova/responde" e a
// tabela JUR_DUVIDAS_APROVADORES saíram de cena (migration 20260930000119).
// Quem responde (17/09/2026, mig 173): a ação "responder" do mesmo menu, também
// no Acesso por Usuário — setor JURIDICO / JUR_DUVIDAS_RESPONSAVEIS saíram.
// DEPOIS DA RESPOSTA (17/09/2026, mig 20260930000170): quem perguntou avalia
// (resolveu / em parte / não resolveu) e pode perguntar mais no mesmo fio,
// sem nova aprovação; o Jurídico complementa ali. Card "Pedem complemento" =
// fios cujo último item é uma pergunta. Componente: FioDuvida.
//
// LAYOUT (18/09/2026, pedido do Pablo): a mesma cara da Central de Orientações
// Jurídicas (central-servicos/OrientacoesJuridicas.tsx) — hero azul com busca
// grande e pílulas de contagem, abas segmentadas por etapa, chips de
// categoria, cards em grade que abrem no lugar. O que muda é o conteúdo: aqui
// aparece o NOME de quem perguntou e os botões de aprovar/reprovar/responder.
// =====================================================================

// JUR_DUVIDAS* não estão no types.ts gerado; mesmo padrão de comite-etica/db.ts.
const db = supabase as unknown as SupabaseClient;

const fmtDt = (s?: string) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR"); };
const fmtDtHora = (s?: string) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR") + " às " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
const statusInfo = (s: string): { bg: string; c: string; label: string } => ({
  "Aberta": { bg: "#fff7ed", c: "#ea580c", label: "Aguardando aprovação" },
  "Aprovada": { bg: "#ede9fe", c: "#7c3aed", label: "Aguardando resposta" },
  "Respondida": { bg: "#dcfce7", c: "#15803d", label: "Respondida" },
  "Reprovada": { bg: "#fee2e2", c: "#b91c1c", label: "Reprovada" },
}[s] || { bg: "#e0f2fe", c: "#0369a1", label: s });
const ASK_RESET = { titulo: "", categoria: "", pergunta: "" };

/** Cor fixa por categoria — a mesma da Central de Orientações. */
const COR_CAT: Record<string, { bg: string; c: string }> = {
  Trabalhista: { bg: "#dbeafe", c: "#1d4ed8" }, Contratos: { bg: "#fef3c7", c: "#b45309" },
  Processos: { bg: "#ede9fe", c: "#6d28d9" }, Tributário: { bg: "#dcfce7", c: "#15803d" },
  Cível: { bg: "#ffe4e6", c: "#be123c" }, Administrativo: { bg: "#e0f2fe", c: "#0369a1" },
  Compliance: { bg: "#fae8ff", c: "#a21caf" }, LGPD: { bg: "#ccfbf1", c: "#0f766e" }, Outros: { bg: "#f1f5f9", c: "#475569" },
};
const corCat = (c?: string | null) => COR_CAT[c ?? ""] ?? { bg: "#f1f5f9", c: "#475569" };

type Aba = "todas" | "aprovacao" | "resposta" | "complementar" | "respondidas" | "reprovadas" | "minhas";

export default function CentralDuvidas() {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const { can } = usePermissoes();
  const autor = empregado?.nome || user?.user_metadata?.nome || user?.email || "Usuário";
  const podeGerenciar = can("alterar", undefined, "duvidas");
  const { data: temAprovar } = useScreenAccess("duvidas", "aprovar");
  // Quem responde (17/09/2026, mig 173): a ação "responder" do menu, marcada
  // no Acesso por Usuário — antes era setor JURIDICO / JUR_DUVIDAS_RESPONSAVEIS.
  const { data: temResponder } = useScreenAccess("duvidas", "responder");
  // Dashboard de avaliações e categorias (17/09/2026, mig 176): menu fantasma
  // `duvidas_dashboard`, marcado no Acesso por Usuário — só quem tem vê a aba.
  const { data: temDashboard } = useScreenAccess("duvidas_dashboard", "visualizar");
  const [visao, setVisao] = useState<"lista" | "dashboard">("lista");

  const [duvidas, setDuvidas] = useState<Duvida[]>([]);
  // Fio de complementos por dúvida (17/09/2026) — ver lib/juridico/duvidas.ts.
  const [fios, setFios] = useState<Map<number, Complemento[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<Aba>("todas");
  const [fCat, setFCat] = useState("");
  const [aberta, setAberta] = useState<number | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  const [askModal, setAskModal] = useState(false);
  const [ask, setAsk] = useState({ ...ASK_RESET });
  const [respAlvo, setRespAlvo] = useState<Duvida | null>(null);
  const [resp, setResp] = useState("");
  const [reprAlvo, setReprAlvo] = useState<Duvida | null>(null);
  const [motivoRep, setMotivoRep] = useState("");

  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600); };

  const podeAprovar = !!temAprovar;
  const podeResponder = !!temResponder;

  const load = useCallback(async () => {
    setLoading(true);
    const [d, c] = await Promise.all([
      db.from("JUR_DUVIDAS").select("*").order("created_at", { ascending: false }).limit(1000),
      db.from("JUR_DUVIDAS_COMPLEMENTOS").select("*").order("id", { ascending: false }).limit(1000),
    ]);
    setDuvidas(d.data ?? []); setFios(agruparComplementos(c.data ?? [])); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const enviarPergunta = async () => {
    if (!ask.titulo.trim() || !ask.pergunta.trim()) { toast("Preencha o título e a pergunta.", "err"); return; }
    const { error } = await db.from("JUR_DUVIDAS").insert({ titulo: ask.titulo.trim(), pergunta: ask.pergunta.trim(), categoria: ask.categoria || null, autor_id: user?.id ?? null, autor_nome: autor, status: "Aberta" });
    if (error) { toast("Erro ao enviar: " + error.message, "err"); return; }
    setAskModal(false); setAsk({ ...ASK_RESET }); toast("Dúvida enviada (passa por aprovação).", "ok"); load();
  };

  const aprovar = async (d: Duvida) => {
    const { error } = await db.from("JUR_DUVIDAS").update({ status: "Aprovada", aprovado_por: autor, aprovado_em: new Date().toISOString(), motivo_reprovacao: null, updated_at: new Date().toISOString() }).eq("id", d.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    toast("Dúvida aprovada — segue para o Jurídico responder.", "ok"); load();
  };
  const confirmarReprovar = async () => {
    if (!reprAlvo) return;
    if (!motivoRep.trim()) { toast("Informe o motivo da reprovação.", "err"); return; }
    const { error } = await db.from("JUR_DUVIDAS").update({ status: "Reprovada", motivo_reprovacao: motivoRep.trim(), aprovado_por: autor, aprovado_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", reprAlvo.id);
    if (error) { toast("Erro: " + error.message, "err"); return; }
    setReprAlvo(null); setMotivoRep(""); toast("Dúvida reprovada.", "ok"); load();
  };

  const abrirResponder = (d: Duvida) => { setRespAlvo(d); setResp(d.resposta ?? ""); };
  const responder = async () => {
    if (!respAlvo) return;
    if (!resp.trim()) { toast("Escreva a resposta.", "err"); return; }
    const { error } = await db.from("JUR_DUVIDAS").update({ resposta: resp.trim(), status: "Respondida", respondido_por: autor, respondido_em: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", respAlvo.id);
    if (error) { toast("Erro ao responder: " + error.message, "err"); return; }
    setRespAlvo(null); setResp(""); toast("Resposta publicada na biblioteca.", "ok"); load();
  };
  const excluir = async (d: Duvida) => {
    if (!confirm(`Excluir a dúvida "${d.titulo}"?`)) return;
    const { error } = await db.from("JUR_DUVIDAS").delete().eq("id", d.id);
    if (error) { toast("Erro ao excluir: " + error.message, "err"); return; }
    setDuvidas(x => x.filter(i => i.id !== d.id)); toast("Dúvida excluída.", "ok");
  };

  // Biblioteca de respostas já dadas — o Jurídico reaproveita ao responder.
  const respondidasLib = duvidas.filter(d => d.status === "Respondida" && d.resposta);
  const pedeComplemento = (d: Duvida) => d.status === "Respondida" && complementoPendente(fios.get(d.id) ?? []);
  const nAberta = duvidas.filter(d => d.status === "Aberta").length;
  const nAprovada = duvidas.filter(d => d.status === "Aprovada").length;
  const nResp = duvidas.filter(d => d.status === "Respondida").length;
  const nReprov = duvidas.filter(d => d.status === "Reprovada").length;
  // Respondidas em que quem perguntou pediu mais e o Jurídico ainda não complementou.
  const nComplementar = duvidas.filter(pedeComplemento).length;
  const nMinhas = duvidas.filter(d => d.autor_id === user?.id).length;
  // O que está parado na MINHA etapa — é o que a pílula do hero destaca.
  const minhaFila = (podeAprovar ? nAberta : 0) + (podeResponder ? nAprovada + nComplementar : 0);

  const base = useMemo(() => duvidas.filter(d => {
    if (aba === "aprovacao") return d.status === "Aberta";
    if (aba === "resposta") return d.status === "Aprovada";
    if (aba === "respondidas") return d.status === "Respondida";
    if (aba === "complementar") return pedeComplemento(d);
    if (aba === "reprovadas") return d.status === "Reprovada";
    if (aba === "minhas") return d.autor_id === user?.id;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [duvidas, fios, aba, user?.id]);
  const filtradas = base.filter(d => {
    if (fCat && d.categoria !== fCat) return false;
    if (busca) { const q = busca.toLowerCase(); return [d.titulo, d.pergunta, d.resposta, d.categoria, d.autor_nome].some(x => (x || "").toLowerCase().includes(q)); }
    return true;
  });
  // Contagem por categoria do recorte atual, pros chips.
  const porCat = useMemo(() => { const m = new Map<string, number>(); for (const d of base) { const c = d.categoria || "Outros"; m.set(c, (m.get(c) || 0) + 1); } return m; }, [base]);
  const categoriasComItens = CATEGORIAS.filter(c => porCat.get(c));

  const ABAS: { k: Aba; icone: string; label: string; n: number; alerta?: boolean }[] = [
    { k: "todas", icone: "📋", label: "Todas", n: duvidas.length },
    { k: "aprovacao", icone: "🕒", label: "Aguardando aprovação", n: nAberta, alerta: podeAprovar && nAberta > 0 },
    { k: "resposta", icone: "⚖️", label: "Aguardando resposta", n: nAprovada, alerta: podeResponder && nAprovada > 0 },
    { k: "complementar", icone: "💬", label: "Pedem complemento", n: nComplementar, alerta: podeResponder && nComplementar > 0 },
    { k: "respondidas", icone: "✅", label: "Respondidas", n: nResp },
    { k: "reprovadas", icone: "⛔", label: "Reprovadas", n: nReprov },
    { k: "minhas", icone: "🙋", label: "Minhas", n: nMinhas },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <style>{`
        .oj-fi{width:100%;height:44px;border:1.5px solid #94a3b8;border-radius:12px;padding:0 13px;font-size:14.5px;background:#fff;box-sizing:border-box;color:#0f172a;font-family:inherit}
        textarea.oj-fi{height:auto;padding:11px 13px;resize:vertical}
        .oj-fi::placeholder{color:#64748b}
        .oj-fi:focus{outline:none;border-color:#0f3171;box-shadow:0 0 0 4px rgba(15,49,113,.14)}
        .oj-fg{margin-bottom:16px} .oj-fg label{display:block;font-size:13px;font-weight:800;color:#1e293b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px}
        .oj-btn{border:none;border-radius:12px;font-weight:800;cursor:pointer;font-size:13px;padding:10px 18px;font-family:inherit}
        .oj-chip{border:1.5px solid #e2e8f0;border-radius:999px;font-size:13px;font-weight:700;padding:7px 14px;cursor:pointer;background:#fff;color:#334155;display:inline-flex;align-items:center;gap:6px;font-family:inherit;transition:.15s}
        .oj-chip:hover{border-color:#0f3171}
        .oj-chip.on{background:#0f3171;color:#fff;border-color:#0f3171}
        .oj-chip small{font-weight:800;font-size:11px;background:rgba(15,23,42,.08);border-radius:999px;padding:1px 7px}
        .oj-chip.on small{background:rgba(255,255,255,.22)}
        .oj-card{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:18px 20px;box-shadow:0 8px 24px rgba(15,23,42,.05);transition:.15s;display:flex;flex-direction:column;gap:8px;min-width:0}
        .oj-card:hover{box-shadow:0 14px 34px rgba(15,23,42,.1);transform:translateY(-1px);border-color:#cbd5e1}
        .oj-card.open{grid-column:1 / -1;transform:none}
        .oj-clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
        .oj-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
        .oj-modal{background:#fff;border-radius:18px;padding:28px 30px;width:100%;max-width:680px;max-height:92vh;overflow-y:auto;position:relative;box-shadow:0 20px 50px rgba(15,23,42,.22)}
        .oj-seg{display:inline-flex;background:#e2e8f0;border-radius:999px;padding:4px;gap:4px;flex-wrap:wrap}
        .oj-seg button{border:none;border-radius:999px;padding:9px 16px;font-size:13.5px;font-weight:800;cursor:pointer;background:transparent;color:#475569;font-family:inherit;display:inline-flex;align-items:center;gap:8px;position:relative}
        .oj-seg button.on{background:#fff;color:#0f3171;box-shadow:0 2px 8px rgba(15,23,42,.12)}
        .oj-seg button .dot{width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 2px #fff}
        .oj-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:999px;white-space:nowrap}
      `}</style>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        {/* ── Hero ── */}
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 24, padding: "34px 36px 30px", background: "linear-gradient(135deg,#0f3171 0%,#1d4ed8 55%,#2563eb 100%)", color: "#fff", boxShadow: "0 24px 60px rgba(15,49,113,.28)", marginBottom: 20 }}>
          <div style={{ position: "absolute", right: -60, top: -70, width: 320, height: 320, borderRadius: "50%", background: "rgba(255,255,255,.07)" }} />
          <div style={{ position: "absolute", right: 120, bottom: -120, width: 260, height: 260, borderRadius: "50%", background: "rgba(255,255,255,.05)" }} />
          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ maxWidth: 720 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase", opacity: .8 }}>Jurídico · Conhecimento</div>
              <h1 style={{ margin: "6px 0 8px", fontSize: 34, fontWeight: 900, lineHeight: 1.1, letterSpacing: "-.5px" }}>⚖️ Parecer Jurídico</h1>
              <p style={{ margin: 0, fontSize: 15, opacity: .92, lineHeight: 1.5 }}>Aprovação das dúvidas e respostas do Jurídico. Respondidas viram a biblioteca pública da Central de Serviços — sem o nome de quem perguntou.</p>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {temDashboard && (
                <button className="oj-btn" onClick={() => setVisao(v => v === "lista" ? "dashboard" : "lista")}
                  style={{ background: "rgba(255,255,255,.16)", color: "#fff", border: "1.5px solid rgba(255,255,255,.4)", padding: "13px 20px", fontSize: 14.5, whiteSpace: "nowrap" }}>
                  {visao === "dashboard" ? "☰ Lista" : "📊 Dashboard"}
                </button>
              )}
              <button className="oj-btn" onClick={() => { setAsk({ ...ASK_RESET }); setAskModal(true); }}
                style={{ background: "#fff", color: "#0f3171", padding: "13px 22px", fontSize: 14.5, boxShadow: "0 12px 28px rgba(0,0,0,.18)", whiteSpace: "nowrap" }}>
                + Nova dúvida
              </button>
            </div>
          </div>
          <div style={{ position: "relative", marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 280, position: "relative" }}>
              <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18 }}>🔎</span>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Pesquisar: assunto, palavra-chave, resposta, quem perguntou…"
                style={{ width: "100%", height: 54, borderRadius: 16, border: "none", padding: "0 16px 0 48px", fontSize: 15.5, boxSizing: "border-box", color: "#0f172a", boxShadow: "0 10px 30px rgba(0,0,0,.18)", outline: "none", fontFamily: "inherit" }} />
            </div>
            <select className="oj-fi" style={{ width: 220, height: 54, borderRadius: 16, border: "none", fontSize: 15, fontWeight: 700 }} value={fCat} onChange={e => setFCat(e.target.value)}>
              <option value="">Todas as categorias</option>{CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ position: "relative", marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              ...(minhaFila > 0 ? [["🔔", `${minhaFila} na sua fila`, true]] : []),
              ["🕒", `${nAberta} aguardando aprovação`],
              ["⚖️", `${nAprovada} aguardando resposta`],
              ["💬", `${nComplementar} pedem complemento`],
              ["✅", `${nResp} respondida${nResp === 1 ? "" : "s"}`],
              ["⛔", `${nReprov} reprovada${nReprov === 1 ? "" : "s"}`],
            ].map(([i, t, forte]) => (
              <span key={String(t)} style={{ background: forte ? "#fff" : "rgba(255,255,255,.14)", color: forte ? "#0f3171" : "#fff", border: forte ? "1px solid #fff" : "1px solid rgba(255,255,255,.25)", borderRadius: 999, padding: "6px 13px", fontSize: 12.5, fontWeight: forte ? 900 : 700 }}>{i} {t}</span>
            ))}
          </div>
        </div>

        {visao === "dashboard" && temDashboard ? <DashboardDuvidas duvidas={duvidas} /> : (<>
          {/* ── Abas + categorias ── */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <div className="oj-seg">
              {ABAS.map(a => (
                <button key={a.k} className={aba === a.k ? "on" : ""} onClick={() => { setAba(a.k); setAberta(null); }}>
                  {a.icone} {a.label} <small style={{ opacity: .7 }}>{a.n}</small>
                  {a.alerta && <span className="dot" />}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button className={"oj-chip" + (fCat === "" ? " on" : "")} onClick={() => setFCat("")}>Todas <small>{base.length}</small></button>
              {categoriasComItens.map(c => (
                <button key={c} className={"oj-chip" + (fCat === c ? " on" : "")} onClick={() => setFCat(fCat === c ? "" : c)}
                  style={fCat === c ? undefined : { borderColor: corCat(c).bg, background: corCat(c).bg, color: corCat(c).c }}>{c} <small>{porCat.get(c)}</small></button>
              ))}
            </div>
          </div>

          {(podeAprovar || podeResponder) && (
            <div style={{ background: "#eff6ff", border: "1.5px solid #bfdbfe", borderRadius: 16, padding: "12px 16px", fontSize: 13.5, color: "#1d4ed8", marginBottom: 14 }}>
              {podeAprovar && <>Você <b>aprova/reprova</b> as dúvidas em <b>Aguardando aprovação</b>. </>}
              {podeResponder && <>Você <b>responde</b> as em <b>Aguardando resposta</b> e os complementos em <b>Pedem complemento</b>.</>}
            </div>
          )}

          {/* ── Lista ── */}
          {loading ? <div style={{ padding: 50, textAlign: "center", color: "#64748b", fontSize: 14 }}>Carregando…</div>
            : filtradas.length === 0 ? (
              <div style={{ background: "#fff", border: "1px dashed #cbd5e1", borderRadius: 18, padding: 46, textAlign: "center", color: "#64748b", fontSize: 14 }}>Nenhuma dúvida neste filtro.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 14 }}>
                {filtradas.map(d => {
                  const open = aberta === d.id;
                  const si = statusInfo(d.status);
                  const cc = corCat(d.categoria);
                  const av = infoAvaliacao(d.avaliacao);
                  const pend = pedeComplemento(d);
                  const naMinhaFila = (d.status === "Aberta" && podeAprovar) || ((d.status === "Aprovada" || pend) && podeResponder);
                  const nFio = (fios.get(d.id) ?? []).length;
                  return (
                    <div key={d.id} className={"oj-card" + (open ? " open" : "")} style={naMinhaFila && !open ? { borderColor: si.c, boxShadow: `0 0 0 3px ${si.bg}` } : undefined}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                          <span className="oj-badge" style={{ background: si.bg, color: si.c }}>{si.label}</span>
                          <span className="oj-badge" style={{ background: cc.bg, color: cc.c }}>{d.categoria || "Outros"}</span>
                          {av && <span className="oj-badge" style={{ background: av.bg, color: av.cor }}>{av.emoji} {av.rotulo}</span>}
                          {pend && <span className="oj-badge" style={{ background: "#ede9fe", color: "#7c3aed" }}>💬 Pede complemento</span>}
                        </div>
                        <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>{fmtDt(d.created_at)}</span>
                      </div>

                      <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 16.5, lineHeight: 1.25 }}>{d.titulo}</div>
                      <div style={{ fontSize: 12.5, color: "#64748b" }}>por <b style={{ color: "#334155" }}>{d.autor_nome || "—"}</b> · {fmtDtHora(d.created_at)}</div>

                      <div className={open ? "" : "oj-clamp"} style={{ fontSize: 13.5, color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{d.pergunta}</div>

                      {open && d.status === "Respondida" && d.resposta && (
                        <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 14, padding: "13px 15px" }}>
                          <div style={{ fontSize: 12, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 5 }}>
                            ✅ Resposta do Jurídico<span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: "#4d7c0f" }}> · {d.respondido_por || "Jurídico"}{d.respondido_em ? " · " + fmtDt(d.respondido_em) : ""}</span>
                          </div>
                          <div style={{ fontSize: 14.5, color: "#0f172a", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{d.resposta}</div>
                        </div>
                      )}
                      {/* Avaliação de quem perguntou + fio de complementos (17/09/2026). */}
                      {open && d.status === "Respondida" && (
                        <FioDuvida duvida={d} fio={fios.get(d.id) ?? []} userId={user?.id} autorNome={autor}
                          podeResponder={podeResponder} mostrarNomes onMudou={load} toast={toast} />
                      )}
                      {d.status === "Reprovada" && d.motivo_reprovacao && (
                        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "9px 12px", fontSize: 12.5, color: "#b91c1c" }}>Reprovada por {d.aprovado_por || "—"}: {d.motivo_reprovacao}</div>
                      )}

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 4, flexWrap: "wrap" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {d.status === "Aberta" && podeAprovar && <>
                            <button className="oj-btn" onClick={() => aprovar(d)} style={{ background: "#16a34a", color: "#fff", padding: "8px 14px" }}>✓ Aprovar</button>
                            <button className="oj-btn" onClick={() => { setReprAlvo(d); setMotivoRep(""); }} style={{ background: "#fee2e2", color: "#b91c1c", padding: "8px 14px" }}>Reprovar</button>
                          </>}
                          {d.status === "Aprovada" && podeResponder && <button className="oj-btn" onClick={() => abrirResponder(d)} style={{ background: "#7c3aed", color: "#fff", padding: "8px 14px" }}>✓ Responder</button>}
                          {open && d.status === "Respondida" && podeResponder && <button className="oj-btn" onClick={() => abrirResponder(d)} style={{ background: "#f1f5f9", color: "#475569", padding: "8px 14px" }}>Editar resposta</button>}
                          {open && (podeResponder || podeGerenciar) && <button className="oj-btn" onClick={() => excluir(d)} style={{ background: "none", color: "#dc2626", padding: "8px 10px" }}>Excluir</button>}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {nFio > 0 && <span style={{ fontSize: 12, color: "#64748b" }}>💬 {nFio} no fio</span>}
                          <button onClick={() => setAberta(open ? null : d.id)} className="oj-btn"
                            style={{ background: open ? "#f1f5f9" : pend ? "#7c3aed" : "#0f3171", color: open ? "#475569" : "#fff", padding: "8px 14px" }}>
                            {open ? "Fechar" : d.status === "Respondida" ? (pend ? "💬 Ver e complementar" : "Ver resposta →") : "Abrir →"}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </>)}
      </div>

      {/* Nova dúvida */}
      {askModal && (
        <div className="oj-ov" onClick={e => { if (e.target === e.currentTarget) setAskModal(false); }}>
          <div className="oj-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setAskModal(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#64748b", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Nova dúvida ao Jurídico</div>
            <div style={{ fontSize: 13.5, color: "#64748b", marginBottom: 16 }}>Passa por aprovação e depois o Jurídico responde. A resposta fica pública na biblioteca (sem o nome de quem perguntou).</div>
            <div className="oj-fg"><label>Assunto / título *</label><input className="oj-fi" value={ask.titulo} onChange={e => setAsk(v => ({ ...v, titulo: e.target.value }))} placeholder="Ex.: Prazo para resposta de notificação" /></div>
            <div className="oj-fg"><label>Categoria</label><select className="oj-fi" value={ask.categoria} onChange={e => setAsk(v => ({ ...v, categoria: e.target.value }))}><option value="">— Selecione —</option>{CATEGORIAS.map(c => <option key={c}>{c}</option>)}</select></div>
            <div className="oj-fg"><label>Sua dúvida *</label><textarea className="oj-fi" rows={5} value={ask.pergunta} onChange={e => setAsk(v => ({ ...v, pergunta: e.target.value }))} placeholder="Descreva a dúvida sobre processo, lei, contrato…" /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="oj-btn" onClick={() => setAskModal(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="oj-btn" onClick={enviarPergunta} style={{ background: "#0f3171", color: "#fff" }}>Enviar</button>
            </div>
          </div>
        </div>
      )}

      {/* Reprovar */}
      {reprAlvo && (
        <div className="oj-ov" onClick={e => { if (e.target === e.currentTarget) setReprAlvo(null); }}>
          <div className="oj-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <button onClick={() => setReprAlvo(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#64748b", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>Reprovar dúvida</div>
            <div style={{ fontSize: 13.5, color: "#64748b", marginBottom: 14 }}>{reprAlvo.titulo}</div>
            <div className="oj-fg"><label>Motivo da reprovação *</label><textarea className="oj-fi" rows={4} value={motivoRep} onChange={e => setMotivoRep(e.target.value)} placeholder="O Jurídico não responde reprovadas — quem perguntou vê este motivo." /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="oj-btn" onClick={() => setReprAlvo(null)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="oj-btn" onClick={confirmarReprovar} style={{ background: "#dc2626", color: "#fff" }}>Reprovar</button>
            </div>
          </div>
        </div>
      )}

      {/* Responder */}
      {respAlvo && (
        <div className="oj-ov" onClick={e => { if (e.target === e.currentTarget) setRespAlvo(null); }}>
          <div className="oj-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setRespAlvo(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#64748b", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 10 }}>Responder dúvida</div>
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 14, padding: "12px 14px", marginBottom: 16 }}>
              <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 15 }}>{respAlvo.titulo}</div>
              <div style={{ fontSize: 13.5, color: "#475569", marginTop: 5, whiteSpace: "pre-wrap" }}>{respAlvo.pergunta}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>{respAlvo.categoria ? respAlvo.categoria + " · " : ""}por {respAlvo.autor_nome || "—"} · {fmtDtHora(respAlvo.created_at)}</div>
            </div>
            {/* Reaproveitar resposta de outra pergunta (repetida) */}
            <div className="oj-fg">
              <label>Encaminhar resposta de outra pergunta (se repetida)</label>
              <select className="oj-fi" value="" onChange={e => { const alvo = respondidasLib.find(x => String(x.id) === e.target.value); if (alvo?.resposta) setResp(alvo.resposta); }}>
                <option value="">— Selecione uma resposta já dada —</option>
                {respondidasLib.filter(x => x.id !== respAlvo.id).map(x => <option key={x.id} value={x.id}>{x.titulo}</option>)}
              </select>
            </div>
            <div className="oj-fg"><label>Resposta do Jurídico *</label><textarea className="oj-fi" rows={7} value={resp} onChange={e => setResp(e.target.value)} placeholder="Escreva a resposta. Ela ficará pública na biblioteca (sem o nome de quem perguntou)." /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="oj-btn" onClick={() => setRespAlvo(null)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="oj-btn" onClick={responder} style={{ background: "#15803d", color: "#fff" }}>Publicar resposta</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (<div key={t.id} style={{ padding: "11px 18px", borderRadius: 10, fontSize: 13.5, fontWeight: 700, boxShadow: "0 16px 40px rgba(15,23,42,.12)", background: t.t === "ok" ? "#ecfdf3" : t.t === "err" ? "#fef2f2" : "#eff6ff", color: t.t === "ok" ? "#15803d" : t.t === "err" ? "#b91c1c" : "#1d4ed8", border: `1px solid ${t.t === "ok" ? "#86efac" : t.t === "err" ? "#fecaca" : "#bfdbfe"}` }}>{t.msg}</div>))}
      </div>
    </div>
  );
}
