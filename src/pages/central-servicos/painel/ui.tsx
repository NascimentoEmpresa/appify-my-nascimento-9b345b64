// Painel Gerencial — os tijolos visuais das abas: cartões, tabelas, filtros e
// os gráficos. Ficavam soltos no meio da tela; aqui viram um lugar só, e é o
// que garante que Desenvolvimento, Liderança e Alinhamento tenham a mesma cara.
//
// Nenhum componente daqui busca dado: tudo entra por prop, já calculado em
// painel/calculos.ts.
import { useState, useEffect, useRef } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LabelList,
} from "recharts";
import { Pergunta } from "../Formularios";
import { ItemDist, Viz } from "./tipos";

// Paleta das séries e as opções do seletor de tipo de gráfico.
export const CORES = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#ea580c", "#64748b", "#0f3171"];
export const CAT_CORES = ["#2563eb", "#16a34a", "#f59e0b", "#dc2626", "#64748b"];  // situação: desenvolvimento/pronto/acompanhamento/risco/outros
export const VIZ_OPCOES: { v: Viz; r: string }[] = [
  { v: "barras", r: "Barras" }, { v: "colunas", r: "Colunas" }, { v: "pizza", r: "Pizza" },
  { v: "rosca", r: "Rosca" }, { v: "linha", r: "Linha" }, { v: "area", r: "Área" },
];

// Estilos base dos controles da barra de filtros.
export const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "7px 13px", borderRadius: 9, border, background: bg, color: c, fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
export const inp: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 9, padding: "8px 10px", fontSize: 13, outline: "none", background: "#fff", width: "100%", color: "#0f172a" };
export const lbl: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 };

export const pct = (n: number, tot: number) => tot ? `${Math.round((n / tot) * 100)}%` : "0%";
export function Vazio() { return <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0" }}>Sem dados no recorte.</div>; }
export function FiltroFuturo({ label }: { label: string }) {
  return <div><label style={lbl}>{label}</label><select disabled style={{ ...inp, background: "#f8fafc", color: "#94a3b8", cursor: "not-allowed" }}><option>Todas (em breve)</option></select></div>;
}

// Filtro Empresa: multi-seleção por caixinhas num dropdown (as respostas podem
// abranger várias empresas de uma vez — "1, 2, 3, 5"). Sem opção = todas.
export function MultiSelectEmpresa({ opcoes, sel, setSel }: { opcoes: string[]; sel: string[]; setSel: (v: string[]) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);
  const rotulo = !sel.length ? "Todas" : sel.length === 1 ? sel[0] : `${sel.length} empresas`;
  const toggle = (o: string) => setSel(sel.includes(o) ? sel.filter(x => x !== o) : [...sel, o]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label style={lbl}>Empresa</label>
      <button type="button" onClick={() => opcoes.length && setAberto(v => !v)} disabled={!opcoes.length}
        style={{ ...inp, textAlign: "left", cursor: opcoes.length ? "pointer" : "not-allowed", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, color: opcoes.length ? (sel.length ? "#0f172a" : "#64748b") : "#94a3b8", background: opcoes.length ? "#fff" : "#f8fafc" }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opcoes.length ? rotulo : "Sem dados no formulário"}</span>
        <span style={{ fontSize: 9, color: "#94a3b8" }}>▾</span>
      </button>
      {aberto && (
        <div style={{ position: "absolute", zIndex: 30, top: "100%", left: 0, right: 0, marginTop: 4, maxHeight: 240, overflowY: "auto", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 12px 28px rgba(15,23,42,.12)", padding: 4 }}>
          {sel.length > 0 && (
            <button type="button" onClick={() => setSel([])} style={{ width: "100%", textAlign: "left", padding: "6px 8px", fontSize: 11.5, fontWeight: 700, color: "#0f3171", background: "none", border: "none", cursor: "pointer" }}>✕ Limpar seleção</button>
          )}
          {opcoes.map(o => (
            <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, cursor: "pointer", fontSize: 12.5, color: "#0f172a" }}>
              <input type="checkbox" checked={sel.includes(o)} onChange={() => toggle(o)} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function Kpi({ titulo, valor, cor, sub, icone }: { titulo: string; valor: number | string; cor: string; sub?: string; icone?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)", display: "flex", gap: 12, alignItems: "flex-start" }}>
      {icone && (
        <div style={{ width: 38, height: 38, borderRadius: 11, background: cor + "1a", color: cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icone}</div>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={titulo}>{titulo}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: cor, marginTop: 2 }}>{valor}</div>
        {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function Painel({ titulo, children, viz, onViz, vizOpts, semViz, semPerg, perg }: { titulo: string; children: React.ReactNode; viz?: Viz; onViz?: (v: Viz) => void; vizOpts?: Viz[]; semViz?: boolean; semPerg?: boolean; perg?: Pergunta }) {
  const opts = VIZ_OPCOES.filter(o => !vizOpts || vizOpts.includes(o.v));
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{titulo}</div>
        {!semViz && onViz && (
          <select value={viz} onChange={e => onViz(e.target.value as Viz)} title="Tipo de gráfico" style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "3px 6px", fontSize: 11, color: "#64748b", background: "#fff", cursor: "pointer" }}>
            {opts.map(o => <option key={o.v} value={o.v}>{o.r}</option>)}
          </select>
        )}
      </div>
      {!semViz && !semPerg && perg === undefined
        ? <div style={{ fontSize: 11.5, color: "#a16207", marginTop: 8 }}>Defina a pergunta em ⚙ Mapeamento.</div>
        : <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

// Balão dos gráficos de distribuição: o total E quem está naquela fatia. O
// número sozinho não deixava chegar na pessoa — era preciso abrir a lista de
// respostas para descobrir de quem era cada barra.
export function TipQuem({ active, payload, rotulo = "resposta(s)" }: {
  active?: boolean; payload?: { payload: ItemDist }[]; rotulo?: string;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const quem = d.quem ?? [];
  const MAX = 14;   // lista longa vira rolagem infinita em cima do gráfico
  return (
    <div style={{ maxWidth: 280, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 8px 24px rgba(15,23,42,.12)", padding: "8px 10px", fontSize: 12, lineHeight: 1.35, color: "#0f172a" }}>
      <div style={{ fontWeight: 800, whiteSpace: "normal", wordBreak: "break-word" }}>{d.completo ?? d.nome}</div>
      <div style={{ color: "#475569", marginTop: 2 }}><b>{d.n.toLocaleString("pt-BR")}</b> {rotulo}</div>
      {quem.length > 0 && (
        <div style={{ marginTop: 6, borderTop: "1px dashed #e2e8f0", paddingTop: 5, color: "#475569" }}>
          {quem.slice(0, MAX).map(q => <div key={q} style={{ whiteSpace: "normal" }}>• {q}</div>)}
          {quem.length > MAX && <div style={{ color: "#94a3b8" }}>e mais {quem.length - MAX}…</div>}
        </div>
      )}
    </div>
  );
}

export function Chart({ dados, viz, cor }: { dados: ItemDist[]; viz: Viz; cor: string }) {
  const comDados = dados.filter(d => d.n);
  if (!comDados.length) return <Vazio />;
  const tip = <Tooltip wrapperStyle={{ zIndex: 60 }} content={<TipQuem />} />;
  if (viz === "pizza" || viz === "rosca") {
    // Sem rótulo em volta (estourava o card com opções longas): rosca + legenda.
    const totP = comDados.reduce((s, d) => s + d.n, 0);
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ width: 168, height: 190, flexShrink: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={comDados} dataKey="n" nameKey="nome" cx="50%" cy="50%" innerRadius={viz === "rosca" ? 46 : 0} outerRadius={72} paddingAngle={1}>
                {comDados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
              </Pie>{tip}
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 5, maxHeight: 200, overflowY: "auto" }}>
          {comDados.map((d, i) => (
            <div key={d.completo} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 11.5 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: CORES[i % CORES.length], flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={d.completo}>{d.completo}</span>
              <b style={{ color: "#0f172a" }}>{d.n}</b>
              <span style={{ color: "#94a3b8", width: 38, textAlign: "right" }}>{pct(d.n, totP)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (viz === "colunas") {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={dados} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="nome" tick={{ fontSize: 9 }} interval={0} angle={dados.length > 4 ? -25 : 0} textAnchor={dados.length > 4 ? "end" : "middle"} height={dados.length > 4 ? 54 : 24} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />{tip}
          <Bar dataKey="n" radius={[4, 4, 0, 0]}>{dados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (viz === "linha" || viz === "area") {
    const Cmp: any = viz === "linha" ? LineChart : AreaChart;
    const Serie: any = viz === "linha" ? Line : Area;
    return (
      <ResponsiveContainer width="100%" height={220}>
        <Cmp data={dados} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="nome" tick={{ fontSize: 9 }} interval={0} angle={dados.length > 4 ? -25 : 0} textAnchor={dados.length > 4 ? "end" : "middle"} height={dados.length > 4 ? 54 : 24} />
          <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />{tip}
          <Serie type="monotone" dataKey="n" stroke={cor} fill={cor} fillOpacity={0.2} strokeWidth={2} />
        </Cmp>
      </ResponsiveContainer>
    );
  }
  // barras (horizontal) — default; rótulo "n (x%)" na ponta, como no painel de referência.
  const tot = dados.reduce((s, d) => s + d.n, 0);
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, dados.length * 32)}>
      <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 62, left: 8, bottom: 0 }}>
        <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
        <YAxis type="category" dataKey="nome" width={140} tick={{ fontSize: 10 }} />{tip}
        <Bar dataKey="n" radius={[0, 4, 4, 0]}>
          {dados.map((_, i) => <Cell key={i} fill={cor} />)}
          <LabelList dataKey="n" position="right" style={{ fontSize: 10, fill: "#475569", fontWeight: 700 }}
            formatter={(v: any) => (tot ? `${v} (${Math.round((Number(v) / tot) * 100)}%)` : String(v))} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function EvolucaoChart({ data, cats, viz }: { data: any[]; cats: string[]; viz: Viz }) {
  if (!data.length || !cats.length) return <Vazio />;
  if (viz === "colunas") {
    return (
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip /><Legend wrapperStyle={{ fontSize: 10 }} />
          {cats.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={CAT_CORES[i % CAT_CORES.length]} />)}
        </BarChart>
      </ResponsiveContainer>
    );
  }
  const Cmp: any = viz === "area" ? AreaChart : LineChart;
  const Serie: any = viz === "area" ? Area : Line;
  return (
    <ResponsiveContainer width="100%" height={230}>
      <Cmp data={data} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
        <Tooltip /><Legend wrapperStyle={{ fontSize: 10 }} />
        {cats.map((c, i) => <Serie key={c} type="monotone" dataKey={c} stroke={CAT_CORES[i % CAT_CORES.length]} fill={CAT_CORES[i % CAT_CORES.length]} fillOpacity={0.15} strokeWidth={2} />)}
      </Cmp>
    </ResponsiveContainer>
  );
}

// Formatação de índice 1–5 e da variação contra o trimestre anterior.
export const nf = (n: number) => n.toFixed(2).replace(".", ",");
export const evolTxt = (e: number | null) => e == null ? "—" : `${e >= 0 ? "▲" : "▼"} ${Math.abs(e).toFixed(2).replace(".", ",")}`;
export const evolCor = (e: number | null) => e == null ? "#94a3b8" : e >= 0 ? "#16a34a" : "#dc2626";

export function KpiIndice({ titulo, valor, delta, cor, icone, sub }: { titulo: string; valor: number | null; delta?: number | null; cor: string; icone: string; sub?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)", display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div style={{ width: 38, height: 38, borderRadius: 11, background: cor + "1a", color: cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{icone}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={titulo}>{titulo}</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: cor, marginTop: 2 }}>
          {valor != null ? nf(valor) : "—"}{valor != null && <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 700 }}> / 5</span>}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub ?? "Média no período"}</div>
        {delta != null && <div style={{ fontSize: 11, fontWeight: 700, color: evolCor(delta), marginTop: 2 }}>{evolTxt(delta)} vs. tri anterior</div>}
      </div>
    </div>
  );
}

export function Alerta({ cor, titulo, sub }: { cor: string; titulo: string; sub: string }) {
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: cor + "1a", color: cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>●</span>
      <div><div style={{ fontWeight: 700, color: "#0f172a" }}>{titulo}</div><div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div></div>
    </div>
  );
}

// Distribuição por faixa (verde/amarelo/vermelho) — rosca com legenda ou barras.
export function ChartFaixas({ dados, viz, rotulo = "lideranças" }: { dados: ItemDist[]; viz: Viz; rotulo?: string }) {
  const cores = ["#16a34a", "#f59e0b", "#dc2626"];
  const tot = dados.reduce((s, d) => s + d.n, 0);
  if (!tot) return <Vazio />;
  if (viz === "barras" || viz === "colunas" || viz === "linha" || viz === "area") {
    return (
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={dados} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="nome" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
          <Tooltip wrapperStyle={{ zIndex: 60 }} content={<TipQuem rotulo={rotulo} />} />
          <Bar dataKey="n" radius={[4, 4, 0, 0]}>{dados.map((_, i) => <Cell key={i} fill={cores[i % cores.length]} />)}</Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ width: 168, height: 190, flexShrink: 0, position: "relative" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={dados.filter(d => d.n)} dataKey="n" nameKey="nome" cx="50%" cy="50%" innerRadius={viz === "rosca" ? 46 : 0} outerRadius={72} paddingAngle={1}>
              {dados.filter(d => d.n).map((d, i) => <Cell key={i} fill={cores[dados.indexOf(d) % cores.length]} />)}
            </Pie><Tooltip wrapperStyle={{ zIndex: 60 }} content={<TipQuem rotulo={rotulo} />} />
          </PieChart>
        </ResponsiveContainer>
        {viz === "rosca" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{tot}</div>
            <div style={{ fontSize: 10, color: "#94a3b8" }}>{rotulo}</div>
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 150, display: "flex", flexDirection: "column", gap: 7 }}>
        {dados.map((d, i) => (
          <div key={d.completo} style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: cores[i % cores.length], flexShrink: 0 }} />
            <span style={{ flex: 1, color: "#334155" }}>{d.completo}</span>
            <b style={{ color: "#0f172a" }}>{d.n}</b>
            <span style={{ color: "#94a3b8", width: 38, textAlign: "right" }}>{pct(d.n, tot)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
