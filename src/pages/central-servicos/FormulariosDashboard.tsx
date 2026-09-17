import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell } from "recharts";
import { Formulario, Pergunta, fmtDt, normalizaPerguntas } from "./Formularios";
import AbaDiagnosticoFormulario from "./painel/AbaDiagnosticoFormulario";

// CS_FORMULARIOS / CS_FORM_RESPOSTAS / CS_FORM_ACESSOS não estão no types.ts
// gerado; mesmo padrão de comite-etica/db.ts — a exceção fica num lugar só.
const db = supabase as unknown as SupabaseClient;

// =====================================================================
// NASCIMENTO FORMULÁRIOS - 📊 Dashboard customizável
// O usuário monta o próprio painel com widgets sobre os formulários:
//   kpi      - indicador (total/hoje/7 dias/30 dias de respostas)
//   grafico  - respostas de uma pergunta (barras ou pizza)
//   tempo    - respostas por dia (série temporal)
//   ultimas  - últimas respostas de um formulário
// Cada widget tem título, formulário, largura (1/3, 2/3, cheia) e pode ser
// reordenado. O layout é salvo por usuário em CS_FORM_ACESSOS
// (papel 'dashboard', config jsonb).
//
// PAINÉIS POR RELATÓRIO (16/09/2026): "Meu painel" deixou de ser um só.
// Há o painel GERAL (todos os formulários, o que existia) e um painel por
// FORMULÁRIO, montado conforme a necessidade de cada relatório. O config
// passou de Widget[] para { geral, por_formulario } — config antigo em
// array continua lendo como o painel geral.
//
// DIAGNÓSTICO IA (16/09/2026): o mesmo diagnóstico do Painel Gerencial
// (AbaDiagnosticoFormulario / Edge Function diagnostico-formulario-ia)
// aparece embaixo do painel automático e do painel do formulário — e roda
// sozinho quando não há diagnóstico salvo ou chegaram respostas novas.
// Os dados respeitam a RLS: só aparecem formulários que o usuário vê.
// =====================================================================

interface Widget {
  id: string;
  tipo: "kpi" | "grafico" | "tempo" | "ultimas";
  titulo?: string;
  formulario_id?: string | "todos";
  pergunta_id?: string;
  estilo?: "barras" | "pizza";
  metrica?: "total" | "hoje" | "7dias" | "30dias";
  dias?: number;
  limite?: number;
  largura?: 1 | 2 | 3;
}
type Perg = Pergunta & { formulario_id: string };
interface Resp { id: string; formulario_id: string; enviado_em: string; respondente_nome?: string | null; itens: Record<string, unknown>; }
/** Config salvo em CS_FORM_ACESSOS (papel 'dashboard'). */
interface ConfigPaineis { geral: Widget[]; por_formulario: Record<string, Widget[]> }
const PAINEL_GERAL = "geral";
/** Lê o config gravado: array (formato antigo) vira o painel geral. */
function lerConfig(cfg: unknown): ConfigPaineis | null {
  if (Array.isArray(cfg)) return cfg.length ? { geral: cfg as Widget[], por_formulario: {} } : null;
  if (cfg && typeof cfg === "object" && Array.isArray((cfg as { geral?: unknown }).geral)) {
    const c = cfg as ConfigPaineis;
    return { geral: c.geral, por_formulario: c.por_formulario && typeof c.por_formulario === "object" ? c.por_formulario : {} };
  }
  return null;
}

const CORES = ["#0f3171", "#2563eb", "#0891b2", "#16a34a", "#eab308", "#ea580c", "#dc2626", "#9333ea", "#db2777", "#64748b"];
// Rótulos de opção são longos: sem isto o balão do gráfico estoura o card e
// cobre o gráfico vizinho.
const TIP_CONTENT: React.CSSProperties = { maxWidth: 260, whiteSpace: "normal", wordBreak: "break-word", fontSize: 12, lineHeight: 1.35, borderRadius: 8, border: "1px solid #e2e8f0", boxShadow: "0 8px 24px rgba(15,23,42,.12)" };
const TIP_WRAP: React.CSSProperties = { zIndex: 60 };
const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "6px 12px", borderRadius: 9, border, background: bg, color: c, fontSize: 12, fontWeight: 700, cursor: "pointer" });
const inp: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 9, padding: "8px 10px", fontSize: 13, outline: "none", background: "#fff", width: "100%" };
const lbl: React.CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 };
const novoId = () => Math.random().toString(36).slice(2, 10);

const WIDGETS_PADRAO: Widget[] = [
  { id: novoId(), tipo: "kpi", metrica: "total", formulario_id: "todos", largura: 1 },
  { id: novoId(), tipo: "kpi", metrica: "7dias", formulario_id: "todos", largura: 1 },
  { id: novoId(), tipo: "tempo", formulario_id: "todos", dias: 14, largura: 1 },
];
const CHART_TIPOS = ["multipla_escolha", "caixas_selecao", "lista_suspensa", "escala", "escala_trabalho"];

/** Ponto de partida do painel de UM formulário: KPIs, um gráfico por
 *  pergunta de escolha/escala e as últimas respostas. A pessoa ajusta depois. */
function painelInicialDoFormulario(f: Formulario): Widget[] {
  const pergs = normalizaPerguntas(f.perguntas).filter(p => CHART_TIPOS.includes(p.tipo));
  return [
    { id: novoId(), tipo: "kpi", metrica: "total", formulario_id: f.id, largura: 1 },
    { id: novoId(), tipo: "kpi", metrica: "30dias", formulario_id: f.id, largura: 1 },
    { id: novoId(), tipo: "tempo", formulario_id: f.id, dias: 30, largura: 1 },
    ...pergs.map(p => ({ id: novoId(), tipo: "grafico" as const, formulario_id: f.id, pergunta_id: p.id, estilo: (p.tipo === "escala" ? "barras" : "pizza") as Widget["estilo"], largura: 1 as const })),
    { id: novoId(), tipo: "ultimas", formulario_id: f.id, limite: 10, largura: 3 },
  ];
}

export default function FormulariosDashboard() {
  const nav = useNavigate();
  const [forms, setForms] = useState<Formulario[]>([]);
  const [resps, setResps] = useState<Resp[]>([]);
  const [paineis, setPaineis] = useState<ConfigPaineis>({ geral: WIDGETS_PADRAO, por_formulario: {} });
  const [painelSel, setPainelSel] = useState<string>(PAINEL_GERAL);   // "geral" ou id do formulário
  const [loading, setLoading] = useState(true);
  const [sujo, setSujo] = useState(false);
  const [editando, setEditando] = useState<Widget | null>(null);
  const [modo, setModo] = useState<"auto" | "custom">("auto");   // painel automático (default) x meu painel
  const [formSel, setFormSel] = useState<string>("");            // formulário do painel automático
  const [periodo, setPeriodo] = useState<"todos" | "7" | "30" | "90" | "365">("todos");
  const [buscaResp, setBuscaResp] = useState("");
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);
  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 4200); };

  const load = useCallback(async () => {
    setLoading(true);
    const [fRes, rRes, dRes] = await Promise.all([
      db.from("CS_FORMULARIOS").select("*").is("deleted_at", null).order("created_at", { ascending: false }),
      db.from("CS_FORM_RESPOSTAS").select("id, formulario_id, enviado_em, respondente_nome, itens").order("enviado_em", { ascending: false }).limit(5000),
      db.from("CS_FORM_ACESSOS").select("config").eq("papel", "dashboard").maybeSingle(),  // RLS: só a linha do próprio usuário
    ]);
    const fs: Formulario[] = fRes.data ?? [];
    setForms(fs);
    setFormSel(prev => prev || (fs[0]?.id ?? ""));  // 1º formulário como padrão do painel auto
    // respostas de formulário apagado (lixeira) não entram em nenhum indicador.
    const vivos = new Set(fs.map(f => f.id));
    setResps((rRes.data ?? []).filter(r => vivos.has(r.formulario_id)).map(r => ({ ...r, itens: r.itens ?? {} })));
    setPaineis(lerConfig(dRes.data?.config) ?? { geral: WIDGETS_PADRAO, por_formulario: {} });
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const pergs = useMemo<Perg[]>(() => forms.flatMap(f => normalizaPerguntas(f.perguntas).map(p => ({ ...p, formulario_id: f.id }))), [forms]);

  // ── Painel automático: recortes do formulário selecionado ────────────
  const formAtual = useMemo(() => forms.find(f => f.id === formSel) ?? null, [forms, formSel]);
  const respsForm = useMemo(() => formSel ? resps.filter(r => r.formulario_id === formSel) : [], [resps, formSel]);
  const respsPeriodo = useMemo(() => {
    let rs = respsForm;
    const dias = periodo === "todos" ? 0 : Number(periodo);
    if (dias) { const corte = Date.now() - dias * 86400000; rs = rs.filter(r => +new Date(r.enviado_em) >= corte); }
    const q = buscaResp.trim().toLowerCase();
    if (q) rs = rs.filter(r => (r.respondente_nome ?? "").toLowerCase().includes(q));
    return rs;
  }, [respsForm, periodo, buscaResp]);

  // Widgets do painel escolhido (geral ou de um formulário).
  const widgets = useMemo<Widget[]>(
    () => painelSel === PAINEL_GERAL ? paineis.geral : (paineis.por_formulario[painelSel] ?? []),
    [paineis, painelSel],
  );
  const formDoPainel = useMemo(() => painelSel === PAINEL_GERAL ? null : (forms.find(f => f.id === painelSel) ?? null), [forms, painelSel]);

  const salvar = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data: atual } = await db.from("CS_FORM_ACESSOS")
      .select("id").eq("papel", "dashboard").eq("user_id", u.user.id).maybeSingle();
    const { error } = atual
      ? await db.from("CS_FORM_ACESSOS").update({ config: paineis }).eq("id", atual.id)
      : await db.from("CS_FORM_ACESSOS").insert({ papel: "dashboard", user_id: u.user.id, config: paineis });
    if (error) { toast("Erro ao salvar: " + error.message, "err"); return; }
    setSujo(false);
    toast("Painéis salvos.", "ok");
  };

  const muda = (w: Widget[]) => {
    setPaineis(p => painelSel === PAINEL_GERAL
      ? { ...p, geral: w }
      : { ...p, por_formulario: { ...p.por_formulario, [painelSel]: w } });
    setSujo(true);
  };
  const novoWidget = () => setEditando({ id: novoId(), tipo: "kpi", metrica: "total", formulario_id: formDoPainel ? formDoPainel.id : "todos", largura: 1 });
  const move = (i: number, dir: -1 | 1) => { const a = [...widgets]; const j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; muda(a); };
  const remove = (i: number) => muda(widgets.filter((_, j) => j !== i));
  const aplicaEdicao = (w: Widget) => {
    const existe = widgets.some(x => x.id === w.id);
    muda(existe ? widgets.map(x => (x.id === w.id ? w : x)) : [...widgets, w]);
    setEditando(null);
  };

  const formPorId = useMemo(() => Object.fromEntries(forms.map(f => [f.id, f])), [forms]);
  const respsDe = useCallback((fid?: string | "todos") => (!fid || fid === "todos") ? resps : resps.filter(r => r.formulario_id === fid), [resps]);

  if (loading) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Carregando...</div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 18, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, flexWrap: "wrap" }}>
        <button onClick={() => nav("/app/central-servicos/formularios")} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>← Voltar</button>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f3171" }}>📊 Dashboard - Nascimento Formulários</div>
          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>{modo === "auto" ? "Painel automático do formulário: KPIs, gráficos por pergunta e filtros." : "Monte seu painel: adicione, configure, reordene e redimensione os widgets."}</div>
        </div>
        <button onClick={() => nav("/app/central-servicos/formularios/painel")} style={btn("#0f3171")}>📈 Painel Gerencial</button>
        <div style={{ display: "flex", border: "1px solid #e2e8f0", borderRadius: 9, overflow: "hidden", flexShrink: 0 }}>
          {(["auto", "custom"] as const).map(mo => (
            <button key={mo} onClick={() => setModo(mo)} style={{ padding: "7px 12px", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", background: modo === mo ? "#0f3171" : "#fff", color: modo === mo ? "#fff" : "#64748b" }}>
              {mo === "auto" ? "Painel automático" : "Meu painel"}
            </button>
          ))}
        </div>
        {modo === "custom" && <>
          <button onClick={novoWidget} style={btn("#fff", "#0f3171", "1px solid #0f3171")}>+ Widget</button>
          <button onClick={salvar} style={btn(sujo ? "#0f3171" : "#94a3b8")}>💾 Salvar painéis</button>
        </>}
      </div>

      {modo === "custom" && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "12px 22px", margin: "12px 24px 0", border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={lbl}>Painel</label>
            <select value={painelSel} onChange={e => setPainelSel(e.target.value)} style={inp}>
              <option value={PAINEL_GERAL}>Painel geral — todos os formulários</option>
              {forms.map(f => <option key={f.id} value={f.id}>{f.titulo}{(paineis.por_formulario[f.id]?.length ?? 0) > 0 ? " ✓" : ""}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11.5, color: "#64748b", flex: 2, minWidth: 220, paddingBottom: 6 }}>
            {formDoPainel
              ? <>Painel do relatório <b>{formDoPainel.titulo}</b>: os widgets ficam presos a este formulário. Quem tem o ✓ já foi montado.</>
              : <>Painel geral: widgets sobre qualquer formulário. Escolha um formulário na lista para montar o painel dele.</>}
          </div>
          {formDoPainel && widgets.length === 0 && (
            <button onClick={() => muda(painelInicialDoFormulario(formDoPainel))} style={btn("#0f3171")}>✨ Montar painel inicial</button>
          )}
        </div>
      )}

      {modo === "auto" && (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, padding: "12px 22px", margin: "12px 24px 0", border: "1px solid #e2e8f0", borderRadius: 14, background: "#fff", boxShadow: "0 8px 24px rgba(15,23,42,.06)", flexShrink: 0, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <label style={lbl}>Formulário</label>
            <select value={formSel} onChange={e => setFormSel(e.target.value)} style={inp}>
              {forms.length === 0 && <option value="">Nenhum formulário</option>}
              {forms.map(f => <option key={f.id} value={f.id}>{f.titulo}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 150 }}>
            <label style={lbl}>Período</label>
            <select value={periodo} onChange={e => setPeriodo(e.target.value as typeof periodo)} style={inp}>
              <option value="todos">Todo o período</option>
              <option value="7">Últimos 7 dias</option>
              <option value="30">Últimos 30 dias</option>
              <option value="90">Últimos 90 dias</option>
              <option value="365">Último ano</option>
            </select>
          </div>
          <div style={{ minWidth: 180, flex: 1 }}>
            <label style={lbl}>Respondente</label>
            <input value={buscaResp} onChange={e => setBuscaResp(e.target.value)} placeholder="Filtrar por nome…" style={inp} />
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 40px" }}>
        {modo === "auto" ? (
          !formAtual ? (
            <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Selecione um formulário para ver o painel.</div>
          ) : (
            <>
              <PainelAuto form={formAtual} respsForm={respsForm} respsPeriodo={respsPeriodo} />
              <SecaoDiagnostico form={formAtual} respostas={respsForm} />
            </>
          )
        ) : widgets.length === 0 ? (
          <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>
            Painel vazio - clique em <b>+ Widget</b> para começar{formDoPainel ? <> ou em <b>✨ Montar painel inicial</b> para partir dos gráficos do formulário</> : null}.
          </div>
        ) : (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            {widgets.map((w, i) => (
              <div key={w.id} style={{ gridColumn: `span ${Math.min(w.largura ?? 1, 3)}`, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 8px 24px rgba(15,23,42,.06)", display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 14px 0" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f172a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tituloWidget(w, formPorId, pergs)}</div>
                  <button onClick={() => move(i, -1)} title="Mover para trás" style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: 12 }}>◀</button>
                  <button onClick={() => move(i, 1)} title="Mover para frente" style={{ background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: 12 }}>▶</button>
                  <button onClick={() => setEditando(w)} title="Configurar" style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 12 }}>⚙</button>
                  <button onClick={() => remove(i)} title="Remover" style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 12 }}>✕</button>
                </div>
                <div style={{ padding: "8px 14px 14px", flex: 1, minWidth: 0 }}>
                  <CorpoWidget w={w} resps={respsDe(w.formulario_id)} pergs={pergs} forms={forms} />
                </div>
              </div>
            ))}
          </div>
          {formDoPainel && <SecaoDiagnostico form={formDoPainel} respostas={respsDe(formDoPainel.id)} />}
        </>)}
      </div>

      {editando && <ModalWidget w={editando} forms={forms} pergs={pergs} formFixo={formDoPainel?.id} onClose={() => setEditando(null)} onOk={aplicaEdicao} />}

      <div style={{ position: "fixed", bottom: 18, right: 18, display: "flex", flexDirection: "column", gap: 8, zIndex: 999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{ background: t.t === "err" ? "#fee2e2" : t.t === "ok" ? "#dcfce7" : "#e0f2fe", color: t.t === "err" ? "#b91c1c" : t.t === "ok" ? "#15803d" : "#0369a1", padding: "10px 16px", borderRadius: 12, fontSize: 12.5, fontWeight: 700, boxShadow: "0 8px 24px rgba(15,23,42,.15)", maxWidth: 380 }}>{t.msg}</div>
        ))}
      </div>
    </div>
  );
}

function tituloWidget(w: Widget, formPorId: Record<string, Formulario>, pergs: Perg[]) {
  if (w.titulo?.trim()) return w.titulo;
  const nomeForm = w.formulario_id && w.formulario_id !== "todos" ? formPorId[w.formulario_id]?.titulo ?? "Formulário" : "Todos os formulários";
  if (w.tipo === "kpi") return ({ total: "Total de respostas", hoje: "Respostas hoje", "7dias": "Respostas - 7 dias", "30dias": "Respostas - 30 dias" }[w.metrica ?? "total"]) + " · " + nomeForm;
  if (w.tipo === "tempo") return "Respostas por dia · " + nomeForm;
  if (w.tipo === "ultimas") return "Últimas respostas · " + nomeForm;
  const p = pergs.find(x => x.id === w.pergunta_id);
  return p ? p.titulo : "Gráfico de pergunta";
}

function CorpoWidget({ w, resps, pergs, forms }: { w: Widget; resps: Resp[]; pergs: Perg[]; forms: Formulario[] }) {
  if (w.tipo === "kpi") {
    const agora = Date.now();
    const corte = w.metrica === "hoje" ? new Date().setHours(0, 0, 0, 0)
      : w.metrica === "7dias" ? agora - 7 * 86400000
      : w.metrica === "30dias" ? agora - 30 * 86400000 : 0;
    const n = resps.filter(r => +new Date(r.enviado_em) >= corte).length;
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 38, fontWeight: 800, color: "#0f3171", lineHeight: 1 }}>{n}</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>resposta(s)</div>
      </div>
    );
  }

  if (w.tipo === "tempo") {
    const dias = w.dias ?? 14;
    const buckets: { dia: string; n: number }[] = [];
    for (let d = dias - 1; d >= 0; d--) {
      const dt = new Date(); dt.setHours(0, 0, 0, 0); dt.setDate(dt.getDate() - d);
      const prox = +dt + 86400000;
      buckets.push({ dia: dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), n: resps.filter(r => { const t = +new Date(r.enviado_em); return t >= +dt && t < prox; }).length });
    }
    return (
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={buckets} margin={{ top: 4, right: 4, left: -26, bottom: 0 }}>
          <XAxis dataKey="dia" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip formatter={v => [v, "respostas"]} />
          <Bar dataKey="n" fill="#0f3171" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (w.tipo === "ultimas") {
    const lim = w.limite ?? 5;
    const ult = resps.slice(0, lim);
    if (!ult.length) return <div style={{ fontSize: 12, color: "#94a3b8" }}>Sem respostas ainda.</div>;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {ult.map(r => (
          <div key={r.id} style={{ display: "flex", gap: 8, fontSize: 12, alignItems: "baseline", borderBottom: "1px solid #f8fafc", paddingBottom: 4 }}>
            <span style={{ fontWeight: 700, color: "#0f172a", flexShrink: 0 }}>{r.respondente_nome || "Anônimo"}</span>
            <span style={{ color: "#94a3b8", flexShrink: 0 }}>{fmtDt(r.enviado_em)}</span>
            <span style={{ color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {forms.find(f => f.id === r.formulario_id)?.titulo ?? ""}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // grafico - distribuição das respostas de uma pergunta
  const p = pergs.find(x => x.id === w.pergunta_id);
  if (!p) return <div style={{ fontSize: 12, color: "#94a3b8" }}>Configure a pergunta no ⚙.</div>;
  const cont: Record<string, number> = {};
  resps.forEach(r => {
    const v = r.itens[p.id];
    if (v == null || v === "") return;
    (Array.isArray(v) ? v : [v]).forEach(x => { cont[String(x)] = (cont[String(x)] || 0) + 1; });
  });
  let chaves: string[];
  if (p.tipo === "escala") { chaves = []; for (let n = p.config?.min ?? 1; n <= (p.config?.max ?? 5); n++) chaves.push(String(n)); }
  else chaves = p.opcoes.length ? p.opcoes : Object.keys(cont);
  const dados = chaves.map(k => ({ nome: k.length > 22 ? k.slice(0, 22) + "…" : k, completo: k, n: cont[k] || 0 }));
  if (!dados.some(d => d.n)) return <div style={{ fontSize: 12, color: "#94a3b8" }}>Sem respostas para esta pergunta.</div>;

  if (w.estilo === "pizza") {
    return (
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={dados.filter(d => d.n)} dataKey="n" nameKey="nome" cx="50%" cy="50%" outerRadius={70} label={e => e.nome}>
            {dados.filter(d => d.n).map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
          </Pie>
          <Tooltip contentStyle={TIP_CONTENT} wrapperStyle={TIP_WRAP} formatter={(v, _n, e) => [v, e?.payload?.completo]} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, dados.length * 26)}>
      <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
        <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 10.5 }} />
        <Tooltip contentStyle={TIP_CONTENT} wrapperStyle={TIP_WRAP} formatter={(v, _n, e) => [v, e?.payload?.completo]} />
        <Bar dataKey="n" fill="#0f3171" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ModalWidget({ w, forms, pergs, formFixo, onClose, onOk }: { w: Widget; forms: Formulario[]; pergs: Perg[]; formFixo?: string; onClose: () => void; onOk: (w: Widget) => void }) {
  // Painel de um formulário: o widget é sempre daquele formulário.
  const [cfg, setCfg] = useState<Widget>({ ...w, ...(formFixo ? { formulario_id: formFixo } : {}) });
  const m = (patch: Partial<Widget>) => setCfg(x => ({ ...x, ...patch }));
  const pergsDoForm = pergs.filter(p => p.formulario_id === cfg.formulario_id && ["multipla_escolha", "caixas_selecao", "lista_suspensa", "escala"].includes(p.tipo));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 900, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 22, width: 480, maxWidth: "94vw", maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 14 }}>Configurar widget</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={lbl}>Tipo</label>
            <select value={cfg.tipo} onChange={e => m({ tipo: e.target.value as Widget["tipo"] })} style={inp}>
              <option value="kpi">Indicador (nº de respostas)</option>
              <option value="grafico">Gráfico de uma pergunta</option>
              <option value="tempo">Respostas por dia</option>
              <option value="ultimas">Últimas respostas</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Título (opcional - vazio usa o automático)</label>
            <input value={cfg.titulo ?? ""} onChange={e => m({ titulo: e.target.value })} style={inp} placeholder="Ex.: Clima - satisfação geral" />
          </div>
          {formFixo ? (
            <div>
              <label style={lbl}>Formulário</label>
              <div style={{ ...inp, background: "#f8fafc", color: "#475569" }}>{forms.find(f => f.id === formFixo)?.titulo ?? "Formulário"}</div>
            </div>
          ) : (
            <div>
              <label style={lbl}>Formulário</label>
              <select value={cfg.formulario_id ?? "todos"} onChange={e => m({ formulario_id: e.target.value, pergunta_id: undefined })} style={inp}>
                {cfg.tipo !== "grafico" && <option value="todos">Todos os formulários</option>}
                {forms.map(f => <option key={f.id} value={f.id}>{f.titulo}</option>)}
              </select>
            </div>
          )}
          {cfg.tipo === "kpi" && (
            <div>
              <label style={lbl}>Métrica</label>
              <select value={cfg.metrica ?? "total"} onChange={e => m({ metrica: e.target.value as Widget["metrica"] })} style={inp}>
                <option value="total">Total de respostas</option>
                <option value="hoje">Respostas hoje</option>
                <option value="7dias">Últimos 7 dias</option>
                <option value="30dias">Últimos 30 dias</option>
              </select>
            </div>
          )}
          {cfg.tipo === "grafico" && (
            <>
              <div>
                <label style={lbl}>Pergunta (escolhas ou escala)</label>
                <select value={cfg.pergunta_id ?? ""} onChange={e => m({ pergunta_id: e.target.value })} style={inp}>
                  <option value="">Selecione...</option>
                  {pergsDoForm.map(p => <option key={p.id} value={p.id}>{p.titulo}</option>)}
                </select>
                {cfg.formulario_id && cfg.formulario_id !== "todos" && pergsDoForm.length === 0 && (
                  <div style={{ fontSize: 11.5, color: "#a16207", marginTop: 4 }}>Este formulário não tem perguntas de escolha/escala.</div>
                )}
              </div>
              <div>
                <label style={lbl}>Estilo</label>
                <select value={cfg.estilo ?? "barras"} onChange={e => m({ estilo: e.target.value as Widget["estilo"] })} style={inp}>
                  <option value="barras">Barras</option>
                  <option value="pizza">Pizza</option>
                </select>
              </div>
            </>
          )}
          {cfg.tipo === "tempo" && (
            <div>
              <label style={lbl}>Período</label>
              <select value={cfg.dias ?? 14} onChange={e => m({ dias: Number(e.target.value) })} style={inp}>
                <option value={7}>7 dias</option><option value={14}>14 dias</option><option value={30}>30 dias</option><option value={60}>60 dias</option>
              </select>
            </div>
          )}
          {cfg.tipo === "ultimas" && (
            <div>
              <label style={lbl}>Quantidade</label>
              <select value={cfg.limite ?? 5} onChange={e => m({ limite: Number(e.target.value) })} style={inp}>
                <option value={5}>5</option><option value={10}>10</option><option value={20}>20</option>
              </select>
            </div>
          )}
          <div>
            <label style={lbl}>Largura</label>
            <select value={cfg.largura ?? 1} onChange={e => m({ largura: Number(e.target.value) as Widget["largura"] })} style={inp}>
              <option value={1}>1/3 da tela</option><option value={2}>2/3 da tela</option><option value={3}>Tela inteira</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
          <button onClick={onClose} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
          <button onClick={() => onOk(cfg)} disabled={cfg.tipo === "grafico" && !cfg.pergunta_id} style={btn(cfg.tipo === "grafico" && !cfg.pergunta_id ? "#94a3b8" : "#0f3171")}>✓ Aplicar</button>
        </div>
      </div>
    </div>
  );
}

// ── Diagnóstico IA do formulário (o mesmo do Painel Gerencial), automático ──
function SecaoDiagnostico({ form, respostas }: { form: Formulario; respostas: Resp[] }) {
  return (
    <div style={{ marginTop: 22, paddingTop: 18, borderTop: "1px dashed #cbd5e1" }}>
      <AbaDiagnosticoFormulario
        formularioId={form.id}
        tituloFormulario={form.titulo}
        setor=""
        respostas={respostas}
        automatico
      />
    </div>
  );
}

// ── Painel automático de UM formulário: KPIs + 1 gráfico por pergunta ──────

function distrib(p: Pergunta, resps: Resp[]) {
  const cont: Record<string, number> = {};
  resps.forEach(r => { const v = r.itens[p.id]; if (v == null || v === "") return; (Array.isArray(v) ? v : [v]).forEach(x => { cont[String(x)] = (cont[String(x)] || 0) + 1; }); });
  let chaves: string[];
  if (p.tipo === "escala") { chaves = []; for (let n = p.config?.min ?? 1; n <= (p.config?.max ?? 5); n++) chaves.push(String(n)); }
  else chaves = p.opcoes.length ? p.opcoes : Object.keys(cont);
  return chaves.map(k => ({ nome: k.length > 22 ? k.slice(0, 22) + "…" : k, completo: k, n: cont[k] || 0 }));
}

function PainelAuto({ form, respsForm, respsPeriodo }: { form: Formulario; respsForm: Resp[]; respsPeriodo: Resp[] }) {
  const pergs = normalizaPerguntas(form.perguntas);
  const chartPergs = pergs.filter(p => CHART_TIPOS.includes(p.tipo));
  const textPergs = pergs.filter(p => ["texto_curto", "texto_longo"].includes(p.tipo));
  const total = respsForm.length;
  const respondentes = new Set(respsPeriodo.map(r => (r.respondente_nome ?? "").trim()).filter(Boolean)).size;
  const ultimaTs = respsForm.reduce((m, r) => Math.max(m, +new Date(r.enviado_em)), 0);
  const kpis: { t: string; v: string; c: string; i: string }[] = [
    { t: "Total de respostas", v: String(total), c: "#0f3171", i: "📬" },
    { t: "No período", v: String(respsPeriodo.length), c: "#2563eb", i: "🗓" },
    { t: "Respondentes", v: String(respondentes), c: "#16a34a", i: "👤" },
    { t: "Perguntas", v: String(pergs.length), c: "#7c3aed", i: "❓" },
    { t: "Última resposta", v: ultimaTs ? fmtDt(new Date(ultimaTs).toISOString()) : "—", c: "#0891b2", i: "🕑" },
  ];
  if (form.max_respostas) kpis.push({ t: "Do limite", v: `${Math.round((total / form.max_respostas) * 100)}%`, c: "#ea580c", i: "🎯" });

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 16 }}>
        {kpis.map(k => (
          <div key={k.t} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{k.i} {k.t}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: k.c, marginTop: 4 }}>{k.v}</div>
          </div>
        ))}
      </div>
      {respsPeriodo.length === 0 ? (
        <div style={{ padding: 50, textAlign: "center", color: "#94a3b8", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14 }}>Sem respostas no período selecionado.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 14, alignItems: "start" }}>
          {chartPergs.map(p => {
            const dados = distrib(p, respsPeriodo);
            const respondidas = dados.reduce((s, d) => s + d.n, 0);
            const top = [...dados].filter(d => d.n).sort((a, b) => b.n - a.n)[0];
            const media = p.tipo === "escala" && respondidas ? (dados.reduce((s, d) => s + Number(d.completo) * d.n, 0) / respondidas) : null;
            return (
              <div key={p.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 2 }}>{p.titulo || "Pergunta"}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>{respondidas} resposta(s){media != null ? ` · média ${media.toFixed(2)}` : ""}</div>
                <GraficoPergunta dados={dados} tipo={p.config?.grafico ?? "barras"} />
                {top && respondidas > 0 && <div style={{ fontSize: 11.5, color: "#475569", marginTop: 8 }}>🏆 Mais escolhida: <b>{top.completo}</b> ({Math.round((top.n / respondidas) * 100)}%)</div>}
              </div>
            );
          })}
          {textPergs.map(p => {
            const respostas = respsPeriodo.map(r => r.itens[p.id]).filter(v => v != null && String(v).trim() !== "").map(String);
            return (
              <div key={p.id} style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", marginBottom: 2 }}>{p.titulo || "Pergunta"}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 10 }}>{respostas.length} resposta(s) de texto</div>
                {respostas.length === 0 ? <div style={{ fontSize: 12, color: "#94a3b8" }}>Sem respostas.</div> : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 210, overflowY: "auto" }}>
                    {respostas.slice(0, 12).map((t, idx) => (
                      <div key={idx} style={{ fontSize: 12.5, color: "#334155", background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 8, padding: "6px 9px" }}>{t.length > 220 ? t.slice(0, 220) + "…" : t}</div>
                    ))}
                    {respostas.length > 12 && <div style={{ fontSize: 11, color: "#94a3b8" }}>+{respostas.length - 12} outra(s)…</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GraficoPergunta({ dados, tipo }: { dados: { nome: string; completo: string; n: number }[]; tipo: "barras" | "colunas" | "pizza" | "rosca" }) {
  const comDados = dados.filter(d => d.n);
  if (!comDados.length) return <div style={{ fontSize: 12, color: "#94a3b8" }}>Sem respostas.</div>;
  if (tipo === "pizza" || tipo === "rosca") {
    return (
      <ResponsiveContainer width="100%" height={210}>
        <PieChart>
          <Pie data={comDados} dataKey="n" nameKey="nome" cx="50%" cy="50%" innerRadius={tipo === "rosca" ? 48 : 0} outerRadius={78} label={e => e.nome}>
            {comDados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
          </Pie>
          <Tooltip contentStyle={TIP_CONTENT} wrapperStyle={TIP_WRAP} formatter={(v, _n, e) => [v, e?.payload?.completo]} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (tipo === "colunas") {
    return (
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={dados} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
          <XAxis dataKey="nome" tick={{ fontSize: 10 }} interval={0} angle={dados.length > 5 ? -25 : 0} textAnchor={dados.length > 5 ? "end" : "middle"} height={dados.length > 5 ? 48 : 24} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip contentStyle={TIP_CONTENT} wrapperStyle={TIP_WRAP} formatter={(v, _n, e) => [v, e?.payload?.completo]} />
          <Bar dataKey="n" radius={[4, 4, 0, 0]}>
            {dados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  // barras (horizontal) — default
  return (
    <ResponsiveContainer width="100%" height={Math.max(150, dados.length * 30)}>
      <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
        <YAxis type="category" dataKey="nome" width={130} tick={{ fontSize: 10.5 }} />
        <Tooltip contentStyle={TIP_CONTENT} wrapperStyle={TIP_WRAP} formatter={(v, _n, e) => [v, e?.payload?.completo]} />
        <Bar dataKey="n" radius={[0, 4, 4, 0]}>
          {dados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
