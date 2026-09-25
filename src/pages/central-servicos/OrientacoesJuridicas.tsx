import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "react-router-dom";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FioDuvida } from "@/components/juridico/FioDuvida";
import {
  CATEGORIAS_DUVIDA as CATEGORIAS, agruparComplementos, complementoPendente, entraNaBiblioteca, infoAvaliacao,
  pendentesDeAvaliacao, respondidaPeloOperacional, type Complemento, type Duvida,
} from "@/lib/juridico/duvidas";

// =====================================================================
// CENTRAL DE SERVIÇOS — Orientações Jurídicas (biblioteca pública)
// Todos veem perguntas + respostas (SEM o nome de quem perguntou) e podem
// enviar novas. A pergunta passa por aprovação (Diretor Administrativo) e só
// então o Jurídico responde (em Jurídico → Parecer Jurídico).
// Respondida, quem perguntou AVALIA a resposta e pode PERGUNTAR MAIS no mesmo
// fio (17/09/2026) — o fio aparece na biblioteca, sem o nome de quem perguntou.
//
// REGRAS DE 17/09/2026 (mig 176, pedido do Pablo):
//   • "Não resolveu" NÃO entra na biblioteca (entraNaBiblioteca).
//   • Abrir OUTRA pergunta exige ter avaliado as respondidas (o banco
//     repete a regra no trigger). Perguntar mais DENTRO da dúvida é livre.
//   • Layout de "central de dúvidas": hero com busca grande, categorias com
//     contagem, cards em grade que abrem no lugar, e Minhas perguntas com a
//     linha do tempo do pedido e o chamado pra avaliar.
// =====================================================================

// JUR_DUVIDAS* não estão no types.ts gerado; mesmo padrão de comite-etica/db.ts.
const db = supabase as unknown as SupabaseClient;

const fmtDt = (s?: string) => { if (!s) return "—"; const d = new Date(s); return isNaN(+d) ? s : d.toLocaleDateString("pt-BR"); };
const ASK_RESET = { titulo: "", categoria: "", pergunta: "", reservada: false };

/** Cor fixa por categoria — a mesma em chips, tags e no dashboard. */
const COR_CAT: Record<string, { bg: string; c: string }> = {
  Trabalhista: { bg: "#dbeafe", c: "#1d4ed8" }, Contratos: { bg: "#fef3c7", c: "#b45309" },
  Processos: { bg: "#ede9fe", c: "#6d28d9" }, Tributário: { bg: "#dcfce7", c: "#15803d" },
  Cível: { bg: "#ffe4e6", c: "#be123c" }, Administrativo: { bg: "#e0f2fe", c: "#0369a1" },
  Compliance: { bg: "#fae8ff", c: "#a21caf" }, LGPD: { bg: "#ccfbf1", c: "#0f766e" }, Outros: { bg: "#f1f5f9", c: "#475569" },
};
const corCat = (c?: string | null) => COR_CAT[c ?? ""] ?? { bg: "#f1f5f9", c: "#475569" };

/**
 * Onde a pergunta está — os três passos do pedido, pra quem perguntou. A do
 * ENCARREGADO (mig 244, 25/09/2026) passa primeiro pelo Operacional, que
 * responde ou encaminha ao Jurídico.
 */
const PASSOS_CENTRAL = ["Aprovação", "Jurídico", "Respondida"] as const;
const PASSOS_ENCARREGADO = ["Operacional", "Jurídico", "Respondida"] as const;
const passoDe = (s: string) => s === "Aberta" || s === "Pendente Operacional" ? 0 : s === "Aprovada" ? 1 : s === "Respondida" ? 2 : -1;

export default function OrientacoesJuridicas() {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const autor = empregado?.nome || user?.user_metadata?.nome || user?.email || "Usuário";
  // A mesma tela nas duas portas; a do Encarregados manda a pergunta pro
  // Operacional primeiro (o banco decide o status pela origem — mig 244).
  const { pathname } = useLocation();
  const doEncarregado = pathname.startsWith("/app/encarregados");

  const [duvidas, setDuvidas] = useState<Duvida[]>([]);
  // Fio de complementos por dúvida (17/09/2026) — ver lib/juridico/duvidas.ts.
  const [fios, setFios] = useState<Map<number, Complemento[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [fCat, setFCat] = useState("");
  const [aba, setAba] = useState<"biblioteca" | "minhas">("biblioteca");
  const [aberta, setAberta] = useState<number | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);
  const [askModal, setAskModal] = useState(false);
  const [ask, setAsk] = useState({ ...ASK_RESET });

  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 4000); };

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, c] = await Promise.all([
      db.from("JUR_DUVIDAS").select("id, created_at, autor_id, titulo, pergunta, categoria, status, resposta, respondido_em, motivo_reprovacao, avaliacao, avaliacao_comentario, avaliado_em, origem, respondido_etapa, publicada").order("created_at", { ascending: false }).limit(1000),
      db.from("JUR_DUVIDAS_COMPLEMENTOS").select("*").order("id", { ascending: false }).limit(1000),
    ]);
    setFios(agruparComplementos(c.data ?? []));
    setDuvidas(data ?? []); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Perguntar de novo só depois de avaliar o que já foi respondido.
  const pendentes = useMemo(() => pendentesDeAvaliacao(duvidas, user?.id), [duvidas, user?.id]);
  const abrirNova = () => {
    if (pendentes.length) {
      setAba("minhas");
      toast(`Avalie a resposta de ${pendentes.length} pergunta(s) em Minhas perguntas antes de abrir uma nova.`, "err");
      return;
    }
    setAsk({ ...ASK_RESET }); setAskModal(true);
  };

  const enviar = async () => {
    if (!ask.titulo.trim() || !ask.pergunta.trim()) { toast("Preencha o assunto e a pergunta.", "err"); return; }
    const { error } = await db.from("JUR_DUVIDAS").insert({
      titulo: ask.titulo.trim(), pergunta: ask.pergunta.trim(), categoria: ask.categoria || null,
      autor_id: user?.id ?? null, autor_nome: autor,
      status: doEncarregado ? "Pendente Operacional" : "Aberta",
      origem: doEncarregado ? "encarregados" : "central",
      // Reservada: fora da biblioteca, só quem perguntou e os responsáveis veem.
      publicada: !ask.reservada,
    });
    if (error) { toast("Erro ao enviar: " + error.message, "err"); return; }
    setAskModal(false); setAsk({ ...ASK_RESET }); setAba("minhas");
    toast(doEncarregado
      ? "Pergunta enviada ao Operacional. Ele responde ou encaminha ao Jurídico."
      : "Pergunta enviada. Passará por aprovação antes de ir ao Jurídico.", "ok"); load();
  };

  const biblioteca = useMemo(() => duvidas.filter(entraNaBiblioteca), [duvidas]);
  const minhas = useMemo(() => duvidas.filter(d => d.autor_id === user?.id), [duvidas, user?.id]);
  const base = aba === "minhas" ? minhas : biblioteca;
  const filtradas = base.filter(d => {
    if (fCat && d.categoria !== fCat) return false;
    if (busca) { const q = busca.toLowerCase(); return [d.titulo, d.pergunta, d.resposta, d.categoria].some(x => (x || "").toLowerCase().includes(q)); }
    return true;
  });
  // Contagem por categoria do recorte atual (biblioteca ou minhas), pros chips.
  const porCat = useMemo(() => { const m = new Map<string, number>(); for (const d of base) { const c = d.categoria || "Outros"; m.set(c, (m.get(c) || 0) + 1); } return m; }, [base]);
  const categoriasComItens = CATEGORIAS.filter(c => porCat.get(c));

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <style>{`
        .oj-fi{width:100%;height:44px;border:1.5px solid #94a3b8;border-radius:12px;padding:0 13px;font-size:14.5px;background:#fff;box-sizing:border-box;color:#0f172a}
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
        .oj-seg{display:inline-flex;background:#e2e8f0;border-radius:999px;padding:4px;gap:4px}
        .oj-seg button{border:none;border-radius:999px;padding:9px 18px;font-size:13.5px;font-weight:800;cursor:pointer;background:transparent;color:#475569;font-family:inherit;display:inline-flex;align-items:center;gap:8px}
        .oj-seg button.on{background:#fff;color:#0f3171;box-shadow:0 2px 8px rgba(15,23,42,.12)}
        .oj-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:800;padding:3px 10px;border-radius:999px;white-space:nowrap}
      `}</style>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        {/* ── Hero ── */}
        <div style={{ position: "relative", overflow: "hidden", borderRadius: 24, padding: "34px 36px 30px", background: "linear-gradient(135deg,#0f3171 0%,#1d4ed8 55%,#2563eb 100%)", color: "#fff", boxShadow: "0 24px 60px rgba(15,49,113,.28)", marginBottom: 20 }}>
          <div style={{ position: "absolute", right: -60, top: -70, width: 320, height: 320, borderRadius: "50%", background: "rgba(255,255,255,.07)" }} />
          <div style={{ position: "absolute", right: 120, bottom: -120, width: 260, height: 260, borderRadius: "50%", background: "rgba(255,255,255,.05)" }} />
          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: 18, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ maxWidth: 720 }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "1.2px", textTransform: "uppercase", opacity: .8 }}>Central de Serviços · Jurídico</div>
              <h1 style={{ margin: "6px 0 8px", fontSize: 34, fontWeight: 900, lineHeight: 1.1, letterSpacing: "-.5px" }}>⚖️ Central de Orientações Jurídicas</h1>
              <p style={{ margin: 0, fontSize: 15, opacity: .92, lineHeight: 1.5 }}>Tire dúvidas sobre lei, contrato, processo e rotina com o Jurídico. As respostas viram uma biblioteca aberta a toda a empresa — pesquise antes de perguntar: talvez já tenha resposta.</p>
            </div>
            <button className="oj-btn" onClick={abrirNova} title={pendentes.length ? "Avalie as respostas pendentes para abrir uma nova pergunta" : "Perguntar ao Jurídico"}
              style={{ background: pendentes.length ? "rgba(255,255,255,.35)" : "#fff", color: "#0f3171", padding: "13px 22px", fontSize: 14.5, boxShadow: "0 12px 28px rgba(0,0,0,.18)", whiteSpace: "nowrap" }}>
              {pendentes.length ? "⭐ Avalie para perguntar" : "+ Nova pergunta"}
            </button>
          </div>
          <div style={{ position: "relative", marginTop: 22, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 280, position: "relative" }}>
              <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", fontSize: 18 }}>🔎</span>
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Pesquisar na biblioteca: assunto, palavra-chave, resposta…"
                style={{ width: "100%", height: 54, borderRadius: 16, border: "none", padding: "0 16px 0 48px", fontSize: 15.5, boxSizing: "border-box", color: "#0f172a", boxShadow: "0 10px 30px rgba(0,0,0,.18)", outline: "none", fontFamily: "inherit" }} />
            </div>
            <select className="oj-fi" style={{ width: 220, height: 54, borderRadius: 16, border: "none", fontSize: 15, fontWeight: 700 }} value={fCat} onChange={e => setFCat(e.target.value)}>
              <option value="">Todas as categorias</option>{CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ position: "relative", marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              ["📚", `${biblioteca.length} resposta${biblioteca.length === 1 ? "" : "s"} na biblioteca`],
              ["🗂️", `${new Set(biblioteca.map(d => d.categoria || "Outros")).size} categorias`],
              ["🙋", `${minhas.length} pergunta${minhas.length === 1 ? "" : "s"} minha${minhas.length === 1 ? "" : "s"}`],
              ...(pendentes.length ? [["⭐", `${pendentes.length} resposta${pendentes.length === 1 ? "" : "s"} para avaliar`]] : []),
            ].map(([i, t]) => (
              <span key={t} style={{ background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.25)", borderRadius: 999, padding: "6px 13px", fontSize: 12.5, fontWeight: 700 }}>{i} {t}</span>
            ))}
          </div>
        </div>

        {/* ── Abas + categorias ── */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div className="oj-seg">
            <button className={aba === "biblioteca" ? "on" : ""} onClick={() => { setAba("biblioteca"); setAberta(null); }}>📚 Biblioteca <small style={{ opacity: .7 }}>{biblioteca.length}</small></button>
            <button className={aba === "minhas" ? "on" : ""} onClick={() => { setAba("minhas"); setAberta(null); }}>
              🙋 Minhas perguntas <small style={{ opacity: .7 }}>{minhas.length}</small>
              {pendentes.length > 0 && <span style={{ background: "#f59e0b", color: "#fff", borderRadius: 999, fontSize: 10.5, padding: "1px 7px" }}>{pendentes.length} p/ avaliar</span>}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className={"oj-chip" + (fCat === "" ? " on" : "")} onClick={() => setFCat("")}>Todas <small>{base.length}</small></button>
            {categoriasComItens.map(c => (
              <button key={c} className={"oj-chip" + (fCat === c ? " on" : "")} onClick={() => setFCat(fCat === c ? "" : c)}
                style={fCat === c ? undefined : { borderColor: corCat(c).bg, background: corCat(c).bg, color: corCat(c).c }}>{c} <small>{porCat.get(c)}</small></button>
            ))}
          </div>
        </div>

        {aba === "minhas" && pendentes.length > 0 && (
          <div style={{ background: "#fffbeb", border: "1.5px solid #fbbf24", borderRadius: 16, padding: "14px 18px", marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 26 }}>⭐</span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 14.5, fontWeight: 800, color: "#92400e" }}>Você tem {pendentes.length} resposta{pendentes.length > 1 ? "s" : ""} para avaliar</div>
              <div style={{ fontSize: 13, color: "#78350f" }}>Diga se resolveu — é o que libera abrir uma pergunta nova. Para perguntar mais sobre o mesmo assunto, use "Pergunte mais" dentro da dúvida.</div>
            </div>
          </div>
        )}

        {/* ── Lista ── */}
        {loading ? <div style={{ padding: 50, textAlign: "center", color: "#64748b", fontSize: 14 }}>Carregando…</div>
          : filtradas.length === 0 ? (
            <div style={{ background: "#fff", border: "1px dashed #cbd5e1", borderRadius: 18, padding: 46, textAlign: "center", color: "#64748b", fontSize: 14 }}>
              {aba === "minhas" ? "Você ainda não enviou nenhuma pergunta." : busca || fCat ? "Nada com esse filtro. Não achou? Faça a pergunta — o Jurídico responde e ela entra aqui." : "Ainda não há respostas na biblioteca."}
              <div style={{ marginTop: 12 }}><button className="oj-btn" onClick={abrirNova} style={{ background: "#0f3171", color: "#fff" }}>+ Nova pergunta</button></div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 14 }}>
              {filtradas.map(d => {
                const open = aberta === d.id;
                const respondida = d.status === "Respondida";
                const cc = corCat(d.categoria);
                const av = infoAvaliacao(d.avaliacao);
                const pend = respondida && complementoPendente(fios.get(d.id) ?? []);
                const precisaAvaliar = aba === "minhas" && respondida && !d.avaliacao;
                const passo = passoDe(d.status);
                return (
                  <div key={d.id} className={"oj-card" + (open ? " open" : "")} style={precisaAvaliar ? { borderColor: "#fbbf24", boxShadow: "0 0 0 3px rgba(251,191,36,.18)" } : undefined}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                        <span className="oj-badge" style={{ background: cc.bg, color: cc.c }}>{d.categoria || "Outros"}</span>
                        {av && av.valor !== "nao_resolveu" && <span className="oj-badge" style={{ background: av.bg, color: av.cor }}>{av.emoji} {av.rotulo}</span>}
                        {aba === "minhas" && av?.valor === "nao_resolveu" && <span className="oj-badge" style={{ background: av.bg, color: av.cor }}>{av.emoji} {av.rotulo}</span>}
                        {pend && <span className="oj-badge" style={{ background: "#ede9fe", color: "#7c3aed" }}>⏳ Complemento com o Jurídico</span>}
                        {precisaAvaliar && <span className="oj-badge" style={{ background: "#fef3c7", color: "#b45309" }}>⭐ Avalie a resposta</span>}
                        {aba === "minhas" && d.publicada === false && <span className="oj-badge" style={{ background: "#f1f5f9", color: "#475569" }}>🔒 Reservada</span>}
                      </div>
                      <span style={{ fontSize: 12, color: "#64748b", whiteSpace: "nowrap" }}>{aba === "minhas" ? fmtDt(d.created_at) : (d.respondido_em ? fmtDt(d.respondido_em) : "")}</span>
                    </div>

                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 16.5, lineHeight: 1.25 }}>{d.titulo}</div>

                    {/* Minhas perguntas: onde o pedido está. */}
                    {aba === "minhas" && (
                      d.status === "Reprovada"
                        ? <div style={{ fontSize: 12.5, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "7px 10px" }}>Reprovada{d.motivo_reprovacao ? `: ${d.motivo_reprovacao}` : ""}</div>
                        : (
                          <div style={{ display: "flex", alignItems: "center", gap: 0, margin: "2px 0 4px" }}>
                            {(d.origem === "encarregados" ? PASSOS_ENCARREGADO : PASSOS_CENTRAL).map((p, i, PASSOS) => (
                              <div key={p} style={{ display: "flex", alignItems: "center", flex: i < PASSOS.length - 1 ? 1 : "0 0 auto" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, background: i < passo ? "#16a34a" : i === passo ? "#0f3171" : "#e2e8f0", color: i <= passo ? "#fff" : "#94a3b8" }}>{i < passo ? "✓" : i + 1}</span>
                                  <span style={{ fontSize: 12, fontWeight: i === passo ? 800 : 600, color: i === passo ? "#0f3171" : i < passo ? "#15803d" : "#94a3b8" }}>{p}</span>
                                </div>
                                {i < PASSOS.length - 1 && <div style={{ flex: 1, height: 2, margin: "0 8px", background: i < passo ? "#16a34a" : "#e2e8f0" }} />}
                              </div>
                            ))}
                          </div>
                        )
                    )}

                    <div className={open ? "" : "oj-clamp"} style={{ fontSize: 13.5, color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{d.pergunta}</div>

                    {open && respondida && d.resposta && (
                      <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 14, padding: "13px 15px" }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: "#15803d", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 5 }}>✅ Resposta {respondidaPeloOperacional(d) ? "do Operacional" : "do Jurídico"}{d.respondido_em ? <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0, color: "#4d7c0f" }}> · {fmtDt(d.respondido_em)}</span> : null}</div>
                        <div style={{ fontSize: 14.5, color: "#0f172a", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{d.resposta}</div>
                      </div>
                    )}
                    {open && respondida && (
                      <FioDuvida duvida={d} fio={fios.get(d.id) ?? []} userId={user?.id} autorNome={autor}
                        podeResponder={false} mostrarNomes={false} onMudou={load} toast={toast} />
                    )}

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: "auto", paddingTop: 4 }}>
                      <span style={{ fontSize: 12, color: "#64748b" }}>{(fios.get(d.id) ?? []).length ? `💬 ${(fios.get(d.id) ?? []).length} no fio` : ""}</span>
                      {respondida ? (
                        <button onClick={() => setAberta(open ? null : d.id)} className="oj-btn"
                          style={{ background: open ? "#f1f5f9" : precisaAvaliar ? "#f59e0b" : "#0f3171", color: open ? "#475569" : "#fff", padding: "8px 14px" }}>
                          {open ? "Fechar" : precisaAvaliar ? "⭐ Ver e avaliar" : "Ver resposta →"}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: "#64748b" }}>{d.status === "Aberta" ? "Aguardando aprovação" : d.status === "Pendente Operacional" ? "Com o Operacional" : d.status === "Aprovada" ? "Com o Jurídico" : ""}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {askModal && (
        <div className="oj-ov" onClick={e => { if (e.target === e.currentTarget) setAskModal(false); }}>
          <div className="oj-modal" onClick={e => e.stopPropagation()}>
            <button onClick={() => setAskModal(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#64748b", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{doEncarregado ? "Nova orientação jurídica" : "Nova pergunta ao Jurídico"}</div>
            <div style={{ fontSize: 13.5, color: "#64748b", marginBottom: 16 }}>{doEncarregado
              ? "Vai primeiro para o Operacional (supervisor do contrato), que responde ou encaminha ao Jurídico. Depois de respondida, avalie — é o que libera a próxima pergunta."
              : "Passa por aprovação e depois o Jurídico responde. A resposta fica pública na biblioteca (sem seu nome). Depois de respondida, avalie — é o que libera a próxima pergunta."}</div>
            <div className="oj-fg"><label>Título do parecer *</label><input className="oj-fi" value={ask.titulo} onChange={e => setAsk(v => ({ ...v, titulo: e.target.value }))} placeholder="Ex.: Dúvida sobre…" /></div>
            <div className="oj-fg"><label>Categoria</label><select className="oj-fi" value={ask.categoria} onChange={e => setAsk(v => ({ ...v, categoria: e.target.value }))}><option value="">— Selecione —</option>{CATEGORIAS.map(c => <option key={c}>{c}</option>)}</select></div>
            <div className="oj-fg"><label>Sua pergunta *</label><textarea className="oj-fi" rows={5} value={ask.pergunta} onChange={e => setAsk(v => ({ ...v, pergunta: e.target.value }))} placeholder="Descreva sua dúvida sobre processo, lei, contrato…" /></div>
            {/* Reservada (mig 244): não entra na biblioteca; só quem perguntou e os responsáveis veem. */}
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13.5, color: "#334155", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", marginBottom: 16, cursor: "pointer" }}>
              <input type="checkbox" checked={ask.reservada} onChange={e => setAsk(v => ({ ...v, reservada: e.target.checked }))} style={{ marginTop: 3 }} />
              <span><b>🔒 Pergunta reservada</b> — não aparece na biblioteca. Só você e os responsáveis pela orientação veem a pergunta e a resposta.</span>
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 6 }}>
              <button className="oj-btn" onClick={() => setAskModal(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="oj-btn" onClick={enviar} style={{ background: "#0f3171", color: "#fff" }}>Enviar pergunta</button>
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
