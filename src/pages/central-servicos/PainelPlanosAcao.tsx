import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from "recharts";

// =====================================================================
// PAINEL GERENCIAL — aba PLANOS DE AÇÃO
//
// O plano de ação JÁ ESTÁ no formulário: são as perguntas "Ação definida
// (treinamento ou acompanhamento)" e "Prazo para Ação". Cada resposta
// preenchida nessas duas É um plano. Esta tela NÃO pede que ninguém
// redigite isso — ela lê das respostas.
//
// O que a resposta não tem é o acompanhamento (concluí / cancelei / é
// prioridade alta): isso vive em CS_FORM_PLANOS_ACAO, uma camada ligada
// à resposta por resposta_id. Plano = resposta + acompanhamento.
//
// A SITUAÇÃO não é gravada: é derivada de status + prazo + concluido_em,
// sempre em relação a HOJE. Um plano "em andamento" vira "vencido" sozinho
// quando o prazo passa — gravar a situação daria número velho no dia seguinte.
// =====================================================================

// Uma resposta que preencheu a pergunta da ação — a fonte de um plano.
export interface FontePlano {
  resposta_id: string; acao: string; prazoBruto: string;
  colaborador: string; setor: string; lideranca: string; enviado_em: string;
}

// Linha de acompanhamento (CS_FORM_PLANOS_ACAO).
interface Acomp {
  id: string; resposta_id: string | null;
  acao: string | null; prazo: string | null; detalhe: string | null;
  colaborador: string | null; lideranca: string | null; setor: string | null; empresa: string | null;
  origem: string; prioridade: string; status: string;
  concluido_em: string | null; created_at: string; deleted_at: string | null;
}

// O plano como a tela enxerga: resposta + acompanhamento já mesclados.
export interface Plano {
  id: string;                    // resposta_id, ou o id do registro avulso
  resposta_id: string | null;
  acompId: string | null;        // null = ainda não tem acompanhamento gravado
  acao: string; detalhe: string | null;
  colaborador: string | null; lideranca: string | null; setor: string | null; empresa: string | null;
  origem: string; prioridade: string; status: string;
  prazo: string | null;          // null = a resposta não informou (ou não deu para ler)
  prazoBruto: string;            // o que a pessoa escreveu, quando não deu para interpretar
  concluido_em: string | null; created_at: string;
}

export const ORIGENS = ["Desenvolvimento", "Liderança", "Alinhamento e Entrega", "Outro"];
export const PRIORIDADES = ["Alta", "Média", "Baixa"];
export const SITUACOES = ["Concluído no prazo", "Concluído com atraso", "Em andamento", "Vencido / Atrasado", "Sem prazo", "Cancelado"];

const COR_SIT: Record<string, string> = {
  "Concluído no prazo": "#16a34a", "Concluído com atraso": "#0891b2",
  "Em andamento": "#f59e0b", "Vencido / Atrasado": "#dc2626",
  "Sem prazo": "#a855f7", "Cancelado": "#94a3b8",
};
const COR_PRIO: Record<string, string> = { "Alta": "#dc2626", "Média": "#f59e0b", "Baixa": "#16a34a" };
const COR_ORIGEM: Record<string, string> = {
  "Desenvolvimento": "#2563eb", "Liderança": "#7c3aed", "Alinhamento e Entrega": "#16a34a", "Outro": "#94a3b8",
};

const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "7px 13px", borderRadius: 9, border, background: bg, color: c, fontSize: 12.5, fontWeight: 700, cursor: "pointer" });
const inp: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 9, padding: "8px 10px", fontSize: 13, outline: "none", background: "#fff", width: "100%", color: "#0f172a", boxSizing: "border-box" };
const lbl: React.CSSProperties = { display: "block", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 4 };
const cardBox: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 24px rgba(15,23,42,.05)" };

const hojeISO = () => new Date().toISOString().slice(0, 10);
const dias = (de: string, ate: string) => Math.round((+new Date(ate + "T00:00:00") - +new Date(de + "T00:00:00")) / 864e5);
const fmtD = (iso?: string | null) => { if (!iso) return "—"; const [a, m, d] = iso.slice(0, 10).split("-"); return `${d}/${m}/${a}`; };
const pct = (n: number, total: number) => total ? `${(n / total * 100).toFixed(1).replace(".", ",")}%` : "0%";
const nInt = (n: number) => n.toLocaleString("pt-BR");

// O prazo é digitado à mão no formulário e vem em formato misto: no mesmo
// campo aparecem "2026-08-10" e "31/07/2026". Ler só um dos dois jogaria
// metade dos planos para "sem prazo" — e eles sumiriam dos vencidos.
export function parsePrazo(bruto: string): string | null {
  const s = (bruto ?? "").trim();
  if (!s) return null;
  let a: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  const br = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/.exec(s);
  if (iso) { [a, m, d] = [+iso[1], +iso[2], +iso[3]]; }
  else if (br) { [d, m, a] = [+br[1], +br[2], +br[3]]; if (a < 100) a += 2000; }
  else return null;
  // Data impossível (31/02, mês 13) não vira prazo silenciosamente errado.
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Situação derivada — a regra vive aqui e em lugar nenhum mais.
export function situacaoDe(p: Plano, hoje = hojeISO()): string {
  if (p.status === "Cancelado") return "Cancelado";
  if (p.status === "Concluído") return p.prazo && (p.concluido_em ?? "") > p.prazo ? "Concluído com atraso" : "Concluído no prazo";
  if (!p.prazo) return "Sem prazo";   // sem prazo não dá para dizer que atrasou
  return p.prazo < hoje ? "Vencido / Atrasado" : "Em andamento";
}
const atrasoDe = (p: Plano, hoje = hojeISO()) => p.prazo ? Math.max(0, dias(p.prazo, hoje)) : 0;

const trimestreDe = (iso: string) => { const d = new Date(iso); return { rot: `${Math.floor(d.getMonth() / 3) + 1}º Tri/${String(d.getFullYear()).slice(2)}`, fim: new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0).toISOString().slice(0, 10) }; };

export interface FiltrosPlano { periodo: string; setor: string; colaborador: string; situacao: string; prioridade: string; origem: string }

const novoPlano = (): Plano => ({
  id: "", resposta_id: null, acompId: null, acao: "", detalhe: null,
  colaborador: null, lideranca: null, setor: null, empresa: null,
  origem: "Outro", prioridade: "Média", status: "Em andamento",
  prazo: null, prazoBruto: "", concluido_em: null, created_at: new Date().toISOString(),
});

// ── Blocos visuais ───────────────────────────────────────────────────
function Kpi({ titulo, valor, sub, cor, icone }: { titulo: string; valor: string; sub: string; cor: string; icone: string }) {
  return (
    <div style={cardBox}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: cor + "18", color: cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, flexShrink: 0 }}>{icone}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px" }}>{titulo}</div>
          <div style={{ fontSize: 25, fontWeight: 800, color: "#0f172a", lineHeight: 1.15 }}>{valor}</div>
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: cor, fontWeight: 700, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function Painel({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <div style={{ ...cardBox, padding: 16, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 11.5, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".5px" }}>{titulo}</div>
        {acao}
      </div>
      {children}
    </div>
  );
}

function Vazio({ msg = "Sem planos no recorte." }: { msg?: string }) {
  return <div style={{ fontSize: 12, color: "#94a3b8", padding: "18px 0", textAlign: "center" }}>{msg}</div>;
}

// Layout das tabelas do painel.
//
// Duas coisas que só ficaram claras medindo a tela de referência:
//   1. Os cards da linha de tabelas NÃO têm largura igual — na referência são
//      ~318 : 427 : 272 : 277. O card com mais colunas ganha mais espaço.
//      Com `auto-fit` (todos iguais) a coluna final era cortada pela borda.
//   2. `table-layout: fixed` é o que faz as colunas caberem no card. Sem ele o
//      browser dimensiona pelo conteúdo, a tabela fica maior que o card e as
//      colunas numéricas — o número que interessa — saem de vista na rolagem.
const CSS_TABELAS = `
.pa-tabelas{display:grid;gap:14px;grid-template-columns:1fr 1.35fr .9fr .9fr}
@media (max-width:1250px){.pa-tabelas{grid-template-columns:1fr 1fr}}
@media (max-width:700px){.pa-tabelas{grid-template-columns:1fr}}
.pa-tabelas>*{min-width:0}
.pa-tab{width:100%;border-collapse:collapse;table-layout:fixed}
.pa-tab td>div{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

// Largura fixa por tipo de coluna; a coluna "ação" fica flexível e leva a sobra,
// porque é a que a pessoa realmente lê.
const LARG: Record<string, number | undefined> = {
  acao: undefined, colaborador: 84, lideranca: 84, vencimento: 70, atraso: 44, prioridade: 54,
};

// Célula que trunca em vez de quebrar. Nome longo ("CAROLINE PRISCO LOPES")
// virava três linhas e empurrava as colunas numéricas para fora do card.
function Trunc({ children, title }: { children: React.ReactNode; title?: string }) {
  return <div title={title}>{children}</div>;
}

function Chip({ texto, cor }: { texto: string; cor: string }) {
  return <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: cor + "1a", color: cor, whiteSpace: "nowrap" }}>{texto}</span>;
}

// Rosca com legenda ao lado (rótulo dentro estoura o card).
function Rosca({ dados, total, rotuloCentro }: { dados: { nome: string; n: number; cor: string }[]; total: number; rotuloCentro: string }) {
  const com = dados.filter(d => d.n > 0);
  if (!com.length) return <Vazio />;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: 170, height: 170, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={com} dataKey="n" nameKey="nome" innerRadius={52} outerRadius={80} paddingAngle={2} stroke="none">
              {com.map(d => <Cell key={d.nome} fill={d.cor} />)}
            </Pie>
            <Tooltip formatter={(v: any, n: any) => [`${nInt(Number(v))} (${pct(Number(v), total)})`, n]} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a" }}>{nInt(total)}</div>
          <div style={{ fontSize: 9.5, color: "#94a3b8", fontWeight: 700 }}>{rotuloCentro}</div>
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 130, display: "flex", flexDirection: "column", gap: 9 }}>
        {com.map(d => (
          <div key={d.nome} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: d.cor, marginTop: 4, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.3 }}>{d.nome}</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>{nInt(d.n)} <span style={{ color: "#94a3b8", fontWeight: 700 }}>({pct(d.n, total)})</span></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TabelaPlanos({ titulo, planos, total, colunas, onVerTodos, onAbrir, rotuloVer }: {
  titulo: string; planos: Plano[]; total: number;
  colunas: ("colaborador" | "lideranca" | "vencimento" | "atraso" | "prioridade")[];
  onVerTodos?: () => void; onAbrir: (p: Plano) => void; rotuloVer: string;
}) {
  // Coluna vazia em TODAS as linhas só rouba largura de quem tem conteúdo —
  // "Colaborador" cheio de "—" espremia a ação até virar "R…".
  const cols = colunas.filter(c =>
    c === "colaborador" ? planos.some(p => (p.colaborador ?? "").trim())
    : c === "lideranca" ? planos.some(p => (p.lideranca ?? "").trim())
    : true);
  const rot: Record<string, string> = { vencimento: "Vencim.", atraso: "Atraso", prioridade: "Prior." };

  return (
    <Painel titulo={titulo}>
      {planos.length === 0 ? <Vazio /> : (
        <table className="pa-tab">
          <colgroup>
            <col />
            {cols.map(c => <col key={c} style={{ width: LARG[c] }} />)}
          </colgroup>
          <thead><tr>
            <th style={th}>Ação</th>
            {cols.map(c => (
              <th key={c} style={{ ...th, textAlign: c === "atraso" ? "center" : c === "prioridade" ? "right" : "left" }}
                title={c === "atraso" ? "Dias em atraso" : undefined}>
                {rot[c] ?? (c === "colaborador" ? "Colaborador" : "Liderança")}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {planos.map(p => (
              <tr key={p.id} onClick={() => onAbrir(p)} style={{ cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f8fbff")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <td style={{ ...td, fontWeight: 600, color: "#0f172a" }}>
                  <Trunc title={p.acao}>{p.acao}</Trunc>
                </td>
                {cols.map(c =>
                  c === "colaborador" ? <td key={c} style={td}><Trunc title={p.colaborador || "—"}>{p.colaborador || "—"}</Trunc></td> :
                  c === "lideranca" ? <td key={c} style={td}><Trunc title={p.lideranca || "—"}>{p.lideranca || "—"}</Trunc></td> :
                  c === "vencimento" ? <td key={c} style={{ ...td, whiteSpace: "nowrap" }}>{fmtD(p.prazo)}</td> :
                  c === "atraso" ? <td key={c} style={{ ...td, textAlign: "center", fontWeight: 800, color: "#dc2626" }}>{atrasoDe(p)}</td> :
                  <td key={c} style={{ ...td, textAlign: "right" }}><Chip texto={p.prioridade} cor={COR_PRIO[p.prioridade] ?? "#64748b"} /></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {onVerTodos && total > planos.length && (
        <button onClick={onVerTodos} style={{ marginTop: 10, background: "none", border: "none", color: "#0f3171", fontSize: 11.5, fontWeight: 800, cursor: "pointer", padding: 0, alignSelf: "flex-end" }}>
          {rotuloVer} ({nInt(total)}) →
        </button>
      )}
    </Painel>
  );
}

// Padding enxuto: são 4 cards por linha e cada ponto de folga aqui é o que
// decide se a última coluna cabe ou vira barra de rolagem.
const th: React.CSSProperties = { padding: "7px 6px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".4px", color: "#94a3b8", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid #eef2f7" };
const td: React.CSSProperties = { padding: "8px 6px", fontSize: 11.5, color: "#475569", borderTop: "1px solid #f5f7fb" };

function Alerta({ cor, icone, titulo, sub }: { cor: string; icone: string; titulo: string; sub: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, background: cor + "18", color: cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>{icone}</span>
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a", lineHeight: 1.35 }}>{titulo}</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>
      </div>
    </div>
  );
}

function ResumoItem({ icone, cor, rotulo, valor, sub }: { icone: string; cor: string; rotulo: string; valor: string; sub: string }) {
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, background: cor + "18", color: cor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>{icone}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 700 }}>{rotulo}</div>
        <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={valor}>{valor}</div>
        <div style={{ fontSize: 10.5, color: "#94a3b8" }}>{sub}</div>
      </div>
    </div>
  );
}

// ── Modal de cadastro/edição ─────────────────────────────────────────
function ModalPlano({ plano, fonte, formId, respostas, onFechar, onSalvo }: {
  plano: Plano; fonte: FontePlano | undefined; formId: string;
  respostas: { id: string; nome: string; setor: string }[];
  onFechar: () => void; onSalvo: () => void;
}) {
  const [f, setF] = useState<Plano>(plano);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const doForm = !!plano.resposta_id;      // veio de uma resposta do formulário
  const set = (k: keyof Plano, v: any) => setF(x => ({ ...x, [k]: v }));

  // Campo que veio da resposta só é gravado se REALMENTE mudou. Gravar igual
  // congelaria o valor aqui, e uma correção feita depois no formulário nunca
  // mais chegaria na tela.
  const over = (v: string | null | undefined, base: string | undefined) => {
    const s = (v ?? "").trim();
    return !s || s === (base ?? "").trim() ? null : s;
  };

  const salvar = async () => {
    if (!String(f.acao ?? "").trim()) { setErro("Descreva a ação."); return; }
    if (!doForm && !f.prazo) { setErro("Informe o prazo."); return; }
    if (f.status === "Concluído" && !f.concluido_em) { setErro("Informe a data de conclusão."); return; }
    // Concluir exige contar O QUE foi feito — sem isso o painel vira um "ok"
    // sem história e ninguém consegue auditar a conclusão depois.
    if (f.status === "Concluído" && !String(f.detalhe ?? "").trim()) { setErro("Descreva a conclusão nas observações do acompanhamento."); return; }
    setSalvando(true); setErro(null);

    const prazoFonte = fonte ? parsePrazo(fonte.prazoBruto) : null;
    const dados: any = {
      formulario_id: formId,
      resposta_id: f.resposta_id,
      detalhe: f.detalhe || null,
      empresa: f.empresa || null,
      origem: f.origem, prioridade: f.prioridade, status: f.status,
      concluido_em: f.status === "Concluído" ? f.concluido_em : null,
      // Num plano avulso não há fonte: tudo é gravado como valor próprio.
      acao: doForm ? over(f.acao, fonte?.acao) : String(f.acao).trim(),
      prazo: doForm ? (f.prazo === prazoFonte ? null : f.prazo) : f.prazo,
      colaborador: doForm ? over(f.colaborador, fonte?.colaborador) : (f.colaborador || null),
      lideranca: doForm ? over(f.lideranca, fonte?.lideranca) : (f.lideranca || null),
      setor: doForm ? over(f.setor, fonte?.setor) : (f.setor || null),
    };

    // Primeira edição de um plano do formulário ainda não tem linha própria.
    const { error } = f.acompId
      ? await (supabase as any).from("CS_FORM_PLANOS_ACAO").update(dados).eq("id", f.acompId)
      : await (supabase as any).from("CS_FORM_PLANOS_ACAO").insert(dados);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo(); onFechar();
  };

  const excluir = async () => {
    if (!confirm(doForm
      ? "Ocultar este plano do painel? A resposta do formulário não é apagada."
      : "Excluir este plano de ação?")) return;
    setSalvando(true);
    const marca = new Date().toISOString();
    const { error } = f.acompId
      ? await (supabase as any).from("CS_FORM_PLANOS_ACAO").update({ deleted_at: marca }).eq("id", f.acompId)
      : await (supabase as any).from("CS_FORM_PLANOS_ACAO").insert({
          formulario_id: formId, resposta_id: f.resposta_id, deleted_at: marca,
          acao: f.acao, prazo: f.prazo, origem: f.origem, prioridade: f.prioridade, status: f.status,
        });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo(); onFechar();
  };

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 950, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, width: 620, maxWidth: "95vw", maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "18px 22px 12px", borderBottom: "1px solid #eef2f7" }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f3171" }}>
            {doForm ? "Acompanhar plano de ação" : (f.acompId ? "Editar plano avulso" : "Novo plano de ação")}
          </div>
          <div style={{ fontSize: 11.5, color: "#94a3b8" }}>
            {doForm
              ? <>Ação e prazo vêm da resposta de <b>{fonte?.colaborador || "—"}</b>. Editar aqui sobrescreve só o que você mudar.</>
              : "Plano registrado direto no painel, sem resposta de origem."}
          </div>
        </div>

        <div style={{ padding: "14px 22px", overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
          {erro && <div style={{ gridColumn: "1/-1", background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 9, padding: "8px 11px", fontSize: 12 }}>{erro}</div>}

          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Ação definida *</label>
            <textarea value={f.acao ?? ""} onChange={e => set("acao", e.target.value)} rows={doForm ? 5 : 2}
              placeholder="Ex.: Melhorar comunicação com a equipe" style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} /></div>

          <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Observações do acompanhamento{f.status === "Concluído" ? " *" : ""}</label>
            <textarea value={f.detalhe ?? ""} onChange={e => set("detalhe", e.target.value)} rows={2}
              placeholder={f.status === "Concluído" ? "Descreva o que foi feito para concluir este plano…" : "O que andou desde então…"}
              style={{ ...inp, resize: "vertical", fontFamily: "inherit" }} /></div>

          <div><label style={lbl}>Colaborador</label>
            <input list="pa-colabs" value={f.colaborador ?? ""} onChange={e => set("colaborador", e.target.value)} style={inp} />
            <datalist id="pa-colabs">{respostas.map(r => <option key={r.id} value={r.nome} />)}</datalist></div>

          <div><label style={lbl}>Liderança</label>
            <input list="pa-colabs" value={f.lideranca ?? ""} onChange={e => set("lideranca", e.target.value)} style={inp} /></div>

          <div><label style={lbl}>Setor</label>
            <input value={f.setor ?? ""} onChange={e => set("setor", e.target.value)} style={inp} /></div>

          <div><label style={lbl}>Origem do plano</label>
            <select value={f.origem ?? "Outro"} onChange={e => set("origem", e.target.value)} style={inp}>
              {ORIGENS.map(o => <option key={o} value={o}>{o}</option>)}
            </select></div>

          <div><label style={lbl}>Prioridade</label>
            <select value={f.prioridade ?? "Média"} onChange={e => set("prioridade", e.target.value)} style={inp}>
              {PRIORIDADES.map(o => <option key={o} value={o}>{o}</option>)}
            </select></div>

          <div><label style={lbl}>Prazo {doForm ? "" : "*"}</label>
            <input type="date" value={f.prazo ?? ""} onChange={e => set("prazo", e.target.value || null)} style={inp} />
            {doForm && !f.prazo && f.prazoBruto && (
              <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 4 }}>
                No formulário está “{f.prazoBruto}” — não deu para ler como data. Informe aqui.
              </div>
            )}</div>

          <div><label style={lbl}>Status</label>
            <select value={f.status ?? "Em andamento"} onChange={e => set("status", e.target.value)} style={inp}>
              <option>Em andamento</option><option>Concluído</option><option>Cancelado</option>
            </select></div>

          {f.status === "Concluído" && (
            <div><label style={lbl}>Concluído em *</label>
              <input type="date" value={f.concluido_em ?? hojeISO()} onChange={e => set("concluido_em", e.target.value)} style={inp} /></div>
          )}

          {f.prazo && f.status === "Concluído" && f.concluido_em && (
            <div style={{ gridColumn: "1/-1", fontSize: 11.5, color: (f.concluido_em <= f.prazo) ? "#15803d" : "#b45309" }}>
              {f.concluido_em <= f.prazo
                ? "✓ Será contabilizado como concluído no prazo."
                : `⚠ Concluído ${dias(f.prazo, f.concluido_em)} dia(s) após o prazo — entra como "concluído com atraso".`}
            </div>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "12px 22px", borderTop: "1px solid #eef2f7" }}>
          {(doForm || f.acompId)
            ? <button onClick={excluir} disabled={salvando} style={{ background: "none", border: "none", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Excluir</button>
            : <span />}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onFechar} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
            <button onClick={salvar} disabled={salvando} style={btn("#0f3171")}>{salvando ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Painel ───────────────────────────────────────────────────────────
// Carrega o acompanhamento e mescla com as respostas. Vive num hook porque a
// aba Histórico Individual precisa exatamente dos mesmos planos — duas queries
// para a mesma coisa sairiam do ar em momentos diferentes.
export function usePlanosAcao(formId: string, fontes: FontePlano[]) {
  const [acomp, setAcomp] = useState<Acomp[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // Traz inclusive os soft-deletados: se alguém excluiu um plano, ele precisa
  // continuar oculto — a resposta de origem não some, então sem essa marca o
  // plano voltaria à tela no próximo carregamento.
  const recarregar = useCallback(async () => {
    if (!formId) { setCarregando(false); return; }
    setCarregando(true);
    const { data, error } = await (supabase as any).from("CS_FORM_PLANOS_ACAO")
      .select("*").eq("formulario_id", formId);
    setCarregando(false);
    if (error) { setErro(error.message); setAcomp([]); return; }
    setErro(null); setAcomp((data ?? []) as Acomp[]);
  }, [formId]);
  useEffect(() => { recarregar(); }, [recarregar]);

  // Plano = resposta (ação + prazo) + acompanhamento (status, prioridade…).
  // O acompanhamento só sobrescreve o que a resposta disse quando alguém
  // realmente corrigiu aquele campo pela tela.
  const planos = useMemo<Plano[]>(() => {
    const porResp = new Map<string, Acomp>();
    acomp.forEach(a => { if (a.resposta_id) porResp.set(a.resposta_id, a); });
    const ou = (over: string | null | undefined, base: string) => (over ?? "").trim() || base || "";

    const daFonte = fontes.map(f => {
      const a = porResp.get(f.resposta_id);
      return {
        id: f.resposta_id, resposta_id: f.resposta_id, acompId: a?.id ?? null,
        acao: ou(a?.acao, f.acao),
        prazo: a?.prazo ?? parsePrazo(f.prazoBruto),
        prazoBruto: f.prazoBruto,
        detalhe: a?.detalhe ?? null,
        colaborador: ou(a?.colaborador, f.colaborador) || null,
        lideranca: ou(a?.lideranca, f.lideranca) || null,
        setor: ou(a?.setor, f.setor) || null,
        empresa: a?.empresa ?? null,
        origem: a?.origem ?? "Outro",
        prioridade: a?.prioridade ?? "Média",
        status: a?.status ?? "Em andamento",
        concluido_em: a?.concluido_em ?? null,
        created_at: f.enviado_em,
        _oculto: !!a?.deleted_at,
      };
    });

    // Planos avulsos: registrados direto na tela, sem resposta de origem.
    const avulsos = acomp.filter(a => !a.resposta_id).map(a => ({
      id: a.id, resposta_id: null, acompId: a.id,
      acao: a.acao ?? "", prazo: a.prazo, prazoBruto: "",
      detalhe: a.detalhe, colaborador: a.colaborador, lideranca: a.lideranca,
      setor: a.setor, empresa: a.empresa,
      origem: a.origem, prioridade: a.prioridade, status: a.status,
      concluido_em: a.concluido_em, created_at: a.created_at,
      _oculto: !!a.deleted_at,
    }));

    return [...daFonte, ...avulsos].filter(p => !p._oculto).map(({ _oculto, ...p }) => p);
  }, [fontes, acomp]);

  return { planos, carregando, erro, recarregar };
}

export default function PainelPlanosAcao({ formId, filtros, ultima, respostas, fontes, temMapa, temPrazoMapeado, onAbrirMapa, planos, carregando, erro, recarregar }: {
  formId: string; filtros: FiltrosPlano; ultima: string;
  respostas: { id: string; nome: string; setor: string }[];
  fontes: FontePlano[];            // respostas que preencheram a pergunta da ação
  temMapa: boolean;                // a pergunta da ação já foi apontada?
  temPrazoMapeado: boolean;        // … e a do prazo, apontada e diferente dela?
  onAbrirMapa: () => void;
  planos: Plano[]; carregando: boolean; erro: string | null; recarregar: () => void;
}) {
  const [editando, setEditando] = useState<Plano | null>(null);
  const [lista, setLista] = useState<{ titulo: string; planos: Plano[] } | null>(null);  // "ver todos"
  const hoje = hojeISO();

  // Filtros da barra do painel + os próprios da aba.
  const fil = useMemo(() => {
    const corte = filtros.periodo === "todos" ? null : Date.now() - Number(filtros.periodo) * 864e5;
    return planos.filter(p => {
      if (corte && +new Date(p.created_at) < corte) return false;
      if (filtros.setor && (p.setor ?? "") !== filtros.setor) return false;
      if (filtros.colaborador) {
        const q = filtros.colaborador.toLowerCase();
        if (!`${p.colaborador ?? ""} ${p.lideranca ?? ""}`.toLowerCase().includes(q)) return false;
      }
      if (filtros.prioridade && p.prioridade !== filtros.prioridade) return false;
      if (filtros.origem && p.origem !== filtros.origem) return false;
      if (filtros.situacao && situacaoDe(p, hoje) !== filtros.situacao) return false;
      return true;
    });
  }, [planos, filtros, hoje]);

  const k = useMemo(() => {
    const total = fil.length;
    const por = (s: string) => fil.filter(p => situacaoDe(p, hoje) === s);
    const noPrazo = por("Concluído no prazo"), comAtraso = por("Concluído com atraso");
    // "Em andamento" e "Vencido" só saem de situacaoDe quando há prazo, então
    // daqui para baixo p.prazo é sempre uma data — os sem prazo ficam à parte.
    const andamento = por("Em andamento"), vencidos = por("Vencido / Atrasado"), cancelados = por("Cancelado");
    const semPrazo = por("Sem prazo");
    const atrasos = vencidos.map(p => atrasoDe(p, hoje));
    const prox = andamento.filter(p => dias(hoje, p.prazo!) <= 7).sort((a, b) => a.prazo!.localeCompare(b.prazo!));
    const duracoes = andamento.map(p => dias(p.created_at.slice(0, 10), p.prazo!)).filter(d => d > 0);
    return {
      total, noPrazo, comAtraso, andamento, vencidos, cancelados, semPrazo, prox,
      taxa: total ? noPrazo.length / total * 100 : 0,
      mediaAtraso: atrasos.length ? atrasos.reduce((a, b) => a + b, 0) / atrasos.length : 0,
      prazoMedio: duracoes.length ? Math.round(duracoes.reduce((a, b) => a + b, 0) / duracoes.length) : 0,
    };
  }, [fil, hoje]);

  // Evolução: em cada trimestre, a situação NAQUELE momento (não a de hoje) —
  // é o que torna a série uma evolução de verdade, e não o retrato atual
  // repetido para trás.
  const evolucao = useMemo(() => {
    const todos = fil.map(p => ({ p, t: trimestreDe(p.created_at) }));
    const fins = [...new Map(todos.map(x => [x.t.rot, x.t.fim])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return fins.slice(-6).map(([rot, fim]) => {
      const ate = fil.filter(p => p.created_at.slice(0, 10) <= fim);
      let concl = 0, and = 0, venc = 0;
      for (const p of ate) {
        if (p.status === "Cancelado") continue;
        if (p.concluido_em && p.concluido_em <= fim) concl++;
        else if (p.prazo && p.prazo < fim) venc++;   // sem prazo nunca vence
        else and++;
      }
      return { tri: rot, Concluídos: concl, "Em andamento": and, Vencidos: venc };
    });
  }, [fil]);

  const porPrioridade = useMemo(() => PRIORIDADES.map(p => ({ nome: p, n: fil.filter(x => x.prioridade === p).length, cor: COR_PRIO[p] })), [fil]);
  const porOrigem = useMemo(() => ORIGENS.map(o => ({ nome: o, n: fil.filter(x => x.origem === o).length, cor: COR_ORIGEM[o] })).filter(o => o.n > 0), [fil]);

  // Planos por setor — onde estão os vencidos. Substitui "distribuição por
  // origem", que era 100% "Outro" (a origem não é capturada no formulário) e
  // por isso não dizia nada.
  const porSetorPlanos = useMemo(() => {
    const m = new Map<string, { total: number; vencidos: number }>();
    fil.forEach(p => {
      const s = (p.setor ?? "").trim(); if (!s) return;
      const g = m.get(s) ?? { total: 0, vencidos: 0 };
      g.total++; if (situacaoDe(p, hoje) === "Vencido / Atrasado") g.vencidos++;
      m.set(s, g);
    });
    return [...m.entries()].map(([setor, g]) => ({ setor, ...g }))
      .sort((a, b) => b.vencidos - a.vencidos || b.total - a.total).slice(0, 8);
  }, [fil, hoje]);
  const situacoes = useMemo(() => [
    { nome: "Concluídos no prazo", n: k.noPrazo.length, cor: COR_SIT["Concluído no prazo"] },
    { nome: "Concluídos com atraso", n: k.comAtraso.length, cor: COR_SIT["Concluído com atraso"] },
    { nome: "Em andamento", n: k.andamento.length, cor: COR_SIT["Em andamento"] },
    { nome: "Vencidos / Atrasados", n: k.vencidos.length, cor: COR_SIT["Vencido / Atrasado"] },
    { nome: "Sem prazo", n: k.semPrazo.length, cor: COR_SIT["Sem prazo"] },
    { nome: "Cancelados", n: k.cancelados.length, cor: COR_SIT["Cancelado"] },
  ].filter(s => s.n > 0), [k]);

  // Lideranças com mais planos vencidos
  const topLid = useMemo(() => {
    const m = new Map<string, { n: number; soma: number }>();
    k.vencidos.forEach(p => {
      const key = (p.lideranca ?? "").trim() || "Sem liderança";
      const g = m.get(key) ?? { n: 0, soma: 0 };
      g.n++; g.soma += atrasoDe(p, hoje); m.set(key, g);
    });
    return [...m.entries()].map(([chave, g]) => ({ chave, n: g.n, media: g.soma / g.n, setor: k.vencidos.find(p => (p.lideranca ?? "Sem liderança") === chave)?.setor ?? "—" }))
      .sort((a, b) => b.n - a.n);
  }, [k.vencidos, hoje]);

  const exportar = () => {
    const esc = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const cab = ["Ação", "Detalhe", "Colaborador", "Liderança", "Setor", "Origem", "Prioridade", "Status", "Situação", "Prazo", "Concluído em", "Dias em atraso", "Criado em"];
    const linhas = fil.map(p => [p.acao, p.detalhe, p.colaborador, p.lideranca, p.setor, p.origem, p.prioridade, p.status,
      situacaoDe(p, hoje), fmtD(p.prazo), fmtD(p.concluido_em), situacaoDe(p, hoje) === "Vencido / Atrasado" ? atrasoDe(p, hoje) : "", fmtD(p.created_at)]);
    const csv = "﻿" + [cab, ...linhas].map(l => l.map(esc).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = "planos-de-acao.csv"; a.click(); URL.revokeObjectURL(a.href);
  };

  if (carregando) return <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Carregando planos de ação…</div>;

  if (erro) {
    const faltaTabela = /does not exist|schema cache|CS_FORM_PLANOS_ACAO/i.test(erro);
    return (
      <div style={{ ...cardBox, padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>
          {faltaTabela ? "Falta aplicar a migration dos planos de ação" : "Não deu para carregar os planos"}
        </div>
        <div style={{ fontSize: 12.5, color: "#64748b", maxWidth: 540, margin: "0 auto" }}>
          {faltaTabela
            ? <>Rode <code>20260721000002_formularios_planos_acao.sql</code> no banco do app para criar a tabela <b>CS_FORM_PLANOS_ACAO</b>.</>
            : erro}
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{CSS_TABELAS}</style>

      {/* Cabeçalho */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 800, color: "#0f172a" }}>PLANOS DE AÇÃO</div>
          <div style={{ fontSize: 12.5, color: "#64748b" }}>Acompanhamento dos planos de ação definidos nos feedbacks.</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 10.5, color: "#94a3b8", textAlign: "right", lineHeight: 1.4 }}>Última atualização<br /><b style={{ color: "#475569" }}>{ultima}</b></div>
          <button onClick={() => setEditando(novoPlano())} style={btn("#0f3171")}>＋ Novo plano</button>
          <button onClick={exportar} style={btn("#fff", "#0f3171", "1px solid #0f3171")}>⬇ Exportar relatório</button>
        </div>
      </div>

      {!temMapa ? (
        // Sem apontar as perguntas, a tela não tem como saber o que é "ação"
        // e o que é "prazo" — e mostraria zero planos existindo dezenas.
        <div style={{ ...cardBox, padding: 44, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Aponte as perguntas do plano de ação</div>
          <div style={{ fontSize: 12.5, color: "#64748b", maxWidth: 560, margin: "0 auto 14px", lineHeight: 1.5 }}>
            Os planos já estão nas respostas deste formulário — nas perguntas de <b>ação definida</b> e <b>prazo para ação</b>.
            Diga qual pergunta é cada uma e esta tela monta o acompanhamento sozinha, sem redigitar nada.
          </div>
          <button onClick={onAbrirMapa} style={btn("#0f3171")}>⚙ Mapear perguntas</button>
        </div>
      ) : planos.length === 0 ? (
        <div style={{ ...cardBox, padding: 50, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>Nenhum plano de ação ainda</div>
          <div style={{ fontSize: 12.5, color: "#64748b", maxWidth: 520, margin: "0 auto 14px" }}>
            Nenhuma resposta deste formulário preencheu a pergunta da ação definida.
            Assim que alguém preencher, o plano aparece aqui — ou registre um avulso.
          </div>
          <button onClick={() => setEditando(novoPlano())} style={btn("#0f3171")}>＋ Criar plano avulso</button>
        </div>
      ) : (
        <>
          {/* "Todo mundo sem prazo" quase nunca é verdade: ou a pergunta do
              prazo não foi apontada, ou aponta para a errada. Sem avisar, o
              painel mostra 0 vencidos com ar de boa notícia. O resto da tela
              continua útil (as ações são legíveis), então isto é um aviso —
              não uma barreira. */}
          {k.total > 0 && k.semPrazo.length === k.total && (
            <div style={{ ...cardBox, borderColor: "#fed7aa", background: "#fffbeb", marginBottom: 14, display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
              <span style={{ fontSize: 18, lineHeight: 1.2 }}>⚠️</span>
              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                  {temPrazoMapeado ? "Nenhum prazo foi reconhecido" : "Falta apontar a pergunta do prazo"}
                </div>
                <div style={{ fontSize: 12, color: "#78350f", lineHeight: 1.5, marginTop: 3 }}>
                  Os {nInt(k.total)} planos foram lidos, mas nenhum tem prazo — vencidos, atrasos e taxa de conclusão
                  ficam zerados, e isso <b>não</b> quer dizer que está tudo em dia.
                  {temPrazoMapeado
                    ? <> Confira se a pergunta apontada como prazo é mesmo a <b>“Prazo para Ação”</b>.</>
                    : <> Aponte qual pergunta guarda o <b>prazo</b>.</>}
                </div>
              </div>
              <button onClick={onAbrirMapa} style={btn("#0f3171")}>⚙ Revisar mapeamento</button>
            </div>
          )}

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 16 }}>
            <Kpi titulo="Planos de ação criados" valor={nInt(k.total)} sub="100% do total" cor="#2563eb" icone="📋" />
            <Kpi titulo="Concluídos no prazo" valor={nInt(k.noPrazo.length)} sub={`${pct(k.noPrazo.length, k.total)} do total`} cor="#16a34a" icone="✅" />
            <Kpi titulo="Em andamento" valor={nInt(k.andamento.length)} sub={`${pct(k.andamento.length, k.total)} do total`} cor="#f59e0b" icone="🕓" />
            <Kpi titulo="Vencidos / atrasados" valor={nInt(k.vencidos.length)} sub={`${pct(k.vencidos.length, k.total)} do total`} cor="#dc2626" icone="⚠️" />
            <Kpi titulo="Taxa de conclusão" valor={`${k.taxa.toFixed(1).replace(".", ",")}%`} sub="Concluídos no prazo" cor="#7c3aed" icone="％" />
            <Kpi titulo="Média de dias em atraso" valor={k.mediaAtraso.toFixed(1).replace(".", ",")} sub="Dos vencidos" cor="#0891b2" icone="📆" />
          </div>

          {/* Gráficos */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14, marginBottom: 14 }}>
            <Painel titulo="Evolução dos planos de ação">
              {evolucao.length === 0 ? <Vazio /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={evolucao} margin={{ top: 14, right: 12, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="tri" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} /><Tooltip />
                    <Line type="monotone" dataKey="Concluídos" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }}>
                      <LabelList dataKey="Concluídos" position="top" style={{ fontSize: 9.5, fill: "#475569" }} /></Line>
                    <Line type="monotone" dataKey="Em andamento" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }}>
                      <LabelList dataKey="Em andamento" position="top" style={{ fontSize: 9.5, fill: "#475569" }} /></Line>
                    <Line type="monotone" dataKey="Vencidos" stroke="#dc2626" strokeWidth={2.5} dot={{ r: 3 }}>
                      <LabelList dataKey="Vencidos" position="bottom" style={{ fontSize: 9.5, fill: "#475569" }} /></Line>
                  </LineChart>
                </ResponsiveContainer>
              )}
              <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>
                ⓘ Cada trimestre mostra a situação <b>naquele momento</b>: o que já estava concluído, o que ainda corria e o que já tinha vencido.
              </div>
            </Painel>

            <Painel titulo="Situação dos planos de ação">
              <Rosca dados={situacoes} total={k.total} rotuloCentro="Total de planos" />
            </Painel>

            <Painel titulo="Status dos planos de ação">
              {k.total === 0 ? <Vazio /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 13, paddingTop: 6 }}>
                  {situacoes.map(s => (
                    <div key={s.nome}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 4 }}>
                        <span style={{ color: "#475569" }}>{s.nome}</span>
                        <b style={{ color: "#0f172a" }}>{nInt(s.n)} ({pct(s.n, k.total)})</b>
                      </div>
                      <div style={{ height: 10, background: "#eef2f7", borderRadius: 20, overflow: "hidden" }}>
                        <div style={{ width: `${s.n / k.total * 100}%`, height: "100%", background: s.cor, borderRadius: 20 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Painel>

            <Painel titulo="Planos por prioridade">
              <Rosca dados={porPrioridade} total={k.total} rotuloCentro="Total" />
            </Painel>
          </div>

          {/* Larguras desiguais, na proporção da referência — ver CSS_TABELAS. */}
          <div className="pa-tabelas" style={{ marginBottom: 14 }}>
            <Painel titulo="Top 5 – maior quantidade de planos vencidos">
              {topLid.length === 0 ? <Vazio msg="Nenhum plano vencido. 🎉" /> : (
                <table className="pa-tab">
                  <colgroup><col style={{ width: 20 }} /><col /><col style={{ width: 72 }} /><col style={{ width: 46 }} /><col style={{ width: 42 }} /></colgroup>
                  <thead><tr>
                    <th style={th}>#</th><th style={th}>Liderança</th><th style={th}>Setor</th>
                    <th style={{ ...th, textAlign: "center" }} title="Planos vencidos">Venc.</th>
                    <th style={{ ...th, textAlign: "right" }} title="Dias médios em atraso">Dias</th>
                  </tr></thead>
                  <tbody>
                    {topLid.slice(0, 5).map((l, i) => (
                      <tr key={l.chave}>
                        <td style={{ ...td, color: "#94a3b8", fontWeight: 800 }}>{i + 1}</td>
                        <td style={{ ...td, fontWeight: 700, color: "#0f172a" }}><Trunc title={l.chave}>{l.chave}</Trunc></td>
                        <td style={td}><Trunc title={l.setor || "—"}>{l.setor || "—"}</Trunc></td>
                        <td style={{ ...td, textAlign: "center", fontWeight: 800 }}>{l.n}</td>
                        <td style={{ ...td, textAlign: "right", fontWeight: 800, color: "#dc2626", whiteSpace: "nowrap" }}>{l.media.toFixed(1).replace(".", ",")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {topLid.length > 5 && (
                <button onClick={() => setLista({ titulo: "Planos vencidos por liderança", planos: k.vencidos })}
                  style={{ marginTop: 10, background: "none", border: "none", color: "#0f3171", fontSize: 11.5, fontWeight: 800, cursor: "pointer", padding: 0, alignSelf: "flex-end" }}>
                  Ver todas as lideranças ({topLid.length}) →
                </button>
              )}
            </Painel>

            <TabelaPlanos titulo="Planos vencidos / atrasados"
              planos={[...k.vencidos].sort((a, b) => atrasoDe(b, hoje) - atrasoDe(a, hoje)).slice(0, 5)}
              total={k.vencidos.length} colunas={["colaborador", "lideranca", "vencimento", "atraso", "prioridade"]}
              onVerTodos={() => setLista({ titulo: "Planos vencidos / atrasados", planos: k.vencidos })}
              onAbrir={setEditando} rotuloVer="Ver todos os planos vencidos" />

            <TabelaPlanos titulo="Planos com conclusão próxima (próximos 7 dias)"
              planos={k.prox.slice(0, 5)} total={k.prox.length}
              colunas={["colaborador", "vencimento", "prioridade"]}
              onVerTodos={() => setLista({ titulo: "Planos com conclusão próxima", planos: k.prox })}
              onAbrir={setEditando} rotuloVer="Ver todos os próximos" />

            <Painel titulo="⚠ Alertas e atenções">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Alerta cor="#dc2626" icone="🔔" titulo={`${nInt(k.vencidos.length)} plano(s) de ação vencido(s)`} sub="Requer ação imediata" />
                <Alerta cor="#f59e0b" icone="🕓" titulo={`${nInt(k.prox.length)} plano(s) vencem nos próximos 7 dias`} sub="Acompanhar para evitar atraso" />
                <Alerta cor="#7c3aed" icone="👥" titulo={`${topLid.filter(l => l.n >= 10).length} liderança(s) com +10 planos vencidos`} sub="Necessitam de atenção" />
                {k.semPrazo.length > 0 && (
                  <Alerta cor="#a855f7" icone="📅" titulo={`${nInt(k.semPrazo.length)} plano(s) sem prazo definido`}
                    sub="Não entram no controle de atraso — defina uma data" />
                )}
                <Alerta cor={k.taxa >= 60 ? "#16a34a" : "#dc2626"} icone={k.taxa >= 60 ? "✅" : "📉"}
                  titulo={`Taxa de conclusão no prazo: ${k.taxa.toFixed(0)}%`} sub={k.taxa >= 60 ? "Dentro da meta de 60%" : "Abaixo da meta de 60%"} />
              </div>
            </Painel>
          </div>

          {/* Resumo + origem + recomendações */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
            <Painel titulo="Resumo dos planos de ação">
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 14 }}>
                <ResumoItem icone="🏢" cor="#16a34a" rotulo="Setor com mais planos" valor={porSetorPlanos[0]?.setor ?? "—"}
                  sub={porSetorPlanos[0] ? `${nInt(porSetorPlanos[0].total)} plano(s)` : "—"} />
                <ResumoItem icone="🎯" cor="#f59e0b" rotulo="Maior prioridade"
                  valor={[...porPrioridade].sort((a, b) => b.n - a.n)[0]?.nome ?? "—"}
                  sub={`${pct([...porPrioridade].sort((a, b) => b.n - a.n)[0]?.n ?? 0, k.total)} dos planos`} />
                <ResumoItem icone="👥" cor="#7c3aed" rotulo="Com liderança definida"
                  valor={nInt(fil.filter(p => (p.lideranca ?? "").trim()).length)}
                  sub={`${pct(fil.filter(p => (p.lideranca ?? "").trim()).length, k.total)} dos planos`} />
                <ResumoItem icone="📆" cor="#2563eb" rotulo="Prazo médio de conclusão" valor={`${k.prazoMedio} dias`} sub="Dos planos em andamento" />
              </div>
            </Painel>

            <Painel titulo="Planos por setor">
              {porSetorPlanos.length === 0 ? <Vazio msg="Nenhum plano com setor informado." /> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {porSetorPlanos.map(s => {
                    const max = porSetorPlanos[0].total || 1;
                    return (
                      <div key={s.setor}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, marginBottom: 3, gap: 8 }}>
                          <span style={{ color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.setor}>{s.setor}</span>
                          <span style={{ flexShrink: 0, color: "#0f172a", fontWeight: 800 }}>
                            {nInt(s.total)}{s.vencidos > 0 && <span style={{ color: "#dc2626" }}> · {nInt(s.vencidos)} vencido(s)</span>}
                          </span>
                        </div>
                        {/* Barra cinza = total do setor; vermelha por cima = a parte vencida. */}
                        <div style={{ height: 10, background: "#eef2f7", borderRadius: 20, overflow: "hidden", position: "relative" }}>
                          <div style={{ width: `${(s.total / max) * 100}%`, height: "100%", background: "#c7d2fe", borderRadius: 20 }} />
                          <div style={{ position: "absolute", inset: 0, width: `${(s.vencidos / max) * 100}%`, height: "100%", background: "#dc2626", borderRadius: 20 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Painel>

            <Painel titulo="Ações recomendadas">
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12, color: "#475569" }}>
                {[
                  k.vencidos.length > 0 && `Priorizar a conclusão dos ${nInt(k.vencidos.length)} planos vencidos.`,
                  topLid[0] && `Reforçar acompanhamento com ${topLid[0].chave} (${topLid[0].n} vencido(s)).`,
                  k.prox.length > 0 && `Revisar prazos e recursos dos ${nInt(k.prox.length)} planos que vencem esta semana.`,
                  k.semPrazo.length > 0 && `Definir prazo em ${nInt(k.semPrazo.length)} plano(s) — sem data não há como cobrar.`,
                  k.taxa < 60 && "Elevar a taxa de conclusão no prazo até a meta de 60%.",
                  fil.filter(p => !(p.lideranca ?? "").trim()).length > 0 && `Definir liderança responsável em ${nInt(fil.filter(p => !(p.lideranca ?? "").trim()).length)} plano(s).`,
                  "Promover alinhamento e feedback contínuo com as equipes.",
                ].filter(Boolean).slice(0, 5).map((t, i) => (
                  <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid #cbd5e1", flexShrink: 0, marginTop: 1 }} />
                    <span style={{ lineHeight: 1.45 }}>{t}</span>
                  </div>
                ))}
              </div>
            </Painel>
          </div>
        </>
      )}

      {editando && (
        <ModalPlano plano={editando} formId={formId} respostas={respostas}
          fonte={fontes.find(f => f.resposta_id === editando.resposta_id)}
          onFechar={() => setEditando(null)} onSalvo={recarregar} />
      )}

      {lista && (
        <div onClick={e => { if (e.target === e.currentTarget) setLista(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 940, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: "#fff", borderRadius: 16, width: 860, maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #eef2f7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f3171" }}>{lista.titulo} ({nInt(lista.planos.length)})</div>
              <button onClick={() => setLista(null)} style={{ border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>×</button>
            </div>
            <div style={{ overflowY: "auto", padding: "6px 20px 18px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>
                  <th style={th}>Ação</th><th style={th}>Colaborador</th><th style={th}>Liderança</th>
                  <th style={th}>Vencimento</th><th style={{ ...th, textAlign: "center" }}>Atraso</th><th style={{ ...th, textAlign: "right" }}>Prioridade</th>
                </tr></thead>
                <tbody>
                  {lista.planos.map(p => (
                    <tr key={p.id} onClick={() => { setLista(null); setEditando(p); }} style={{ cursor: "pointer" }}>
                      <td style={{ ...td, fontWeight: 600, color: "#0f172a" }}>{p.acao}</td>
                      <td style={td}>{p.colaborador || "—"}</td>
                      <td style={td}>{p.lideranca || "—"}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>{fmtD(p.prazo)}</td>
                      <td style={{ ...td, textAlign: "center", fontWeight: 800, color: "#dc2626" }}>{situacaoDe(p, hoje) === "Vencido / Atrasado" ? atrasoDe(p, hoje) : "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}><Chip texto={p.prioridade} cor={COR_PRIO[p.prioridade] ?? "#64748b"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
