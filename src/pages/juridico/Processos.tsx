import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import { MUNICIPIOS_POR_UF } from "@/data/municipios-brasil";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, PieChart, Pie, Legend, CartesianGrid } from "recharts";

// =====================================================================
// JURÍDICO — Processos (adaptado ao layout do ERP)
// 3 telas (itens de menu): "Dashboard - Processos", "Processos", "Audiências".
// Dados: JUR_PROCESSOS (1 linha por motivo, agrupadas por numero_processo)
// + SISTEMA_COMENTARIOS (modulo='processo'). Agrupamento/somatórios espelham o routes.py.
// =====================================================================

const VAL_FIELDS = ["valor_pedidos", "valor_acordo", "valor_sentenca", "valor_final", "valor_outros_custos", "valor_deposito_recursal", "valor_custas_processuais"] as const;

// Valores lançados POR MOTIVO — estes o agrupamento SOMA entre as linhas.
// Custo do processo que não se reparte por motivo (custas recursais, perito…)
// fica em PROC_VAL_FIELDS, abaixo, e é lido de uma linha só.
const VAL_FIELDS_MOTIVO = ["valor_pedidos", "valor_acordo", "valor_sentenca", "valor_final", "valor_outros_custos", "valor_deposito_recursal", "valor_custas_processuais"] as const;

// Custos do PROCESSO. Ficam repetidos em toda linha de motivo no banco, então
// são lidos com maxN (uma linha) e NUNCA somados — senão um processo com 3
// motivos mostraria as custas recursais triplicadas.
const PROC_VAL_FIELDS = ["valor_custas_recursais", "valor_seguro_garantia", "valor_perito_judicial", "valor_assistente_tecnico"] as const;

interface MotivoItem { ordem: number; motivo: string; valor_pedidos: number; valor_acordo: number; valor_sentenca: number; valor_final: number; valor_outros_custos: number; valor_deposito_recursal: number; valor_custas_processuais: number; }

// Proposta de acordo. Pode ter saído de uma audiência (fica dentro daquela
// audiência) ou do decorrer do processo (lista à parte, com data própria).
export const PROPOSTA_TIPOS = ["Judicial", "Extrajudicial"] as const;
export const PROPOSTA_QUEM = ["Juiz", "Reclamante", "Reclamada"] as const;
interface Proposta { valor: number; descricao: string; tipo: string; quem: string; data?: string }
interface Audiencia { ordem: number; data: string; tipo_audiencia?: string; modalidade_audiencia?: string; horario?: string; propostas?: Proposta[]; }
interface Processo {
  id: number;
  id_sequencial: number;
  numero_processo: string; reclamante: string; reclamada: string; comarca: string; municipio_origem: string; reclamante_vinculado_cpf: string;
  status: string; ano_processo: number; origem: string; contrato: string;
  valor_causa: number; valor_pedidos: number; valor_acordo: number; valor_sentenca: number;
  valor_final: number; valor_outros_custos: number; valor_deposito_recursal: number; valor_custas_processuais: number;
  motivos: string; motivo_items: MotivoItem[]; houve_acordo: string; status_sentenca: string;
  status_recursos: string; havera_pericia: string; motivo_acordo: string; motivos_outros_custos: string;
  local_pericia: string; data_pericia: string; hora_pericia: string;
  data_entrada_reclamatoria: string; tipo_audiencia: string; modalidade_audiencia: string; audiencias: Audiencia[];
  // Recurso da condenação
  vai_recorrer: string; valor_custas_recursais: number; valor_seguro_garantia: number;
  // Perícia médica
  houve_pericia_medica: string; valor_perito_judicial: number; valor_assistente_tecnico: number;
  // Propostas fora de audiência ("no decorrer do processo")
  propostas: Proposta[];
}
interface Comentario { id: number; entidade_id?: string; autor_nome?: string; texto: string; created_at?: string; }

const STATUS_OPC = ["EM ANDAMENTO", "INDEFINIDO", "ARQUIVADO"];
const PAGE_SIZE = 50;
const PALETTE = ["#f97316", "#14b8a6", "#eab308", "#a78bfa", "#2563eb", "#dc2626", "#16a34a", "#0f3171", "#ec4899", "#0891b2"];

const toFloat = (v: any) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const money = (v?: number) => (v == null || isNaN(Number(v))) ? "R$ 0,00" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const moneyShort = (v: number) => { const a = Math.abs(v); if (a >= 1e6) return "R$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "M"; if (a >= 1e3) return "R$ " + (v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 }) + "k"; return money(v); };
const fmtDt = (s?: string) => { if (!s) return "—"; const d = new Date(String(s).length <= 10 ? s + "T12:00:00" : s); return isNaN(+d) ? String(s) : d.toLocaleDateString("pt-BR"); };
const hojeISO = () => new Date().toISOString().slice(0, 10);
const anoDoNumero = (n: string) => { const m = String(n || "").match(/\.(\d{4})\.\d\.\d{2}\./); return m ? Number(m[1]) : null; };

// ── Contrato a partir do município ─────────────────────────────────
// Os nomes em CONTRATOS."NOME CONTRATO" quase sempre começam pela cidade
// ("CHARQUEADAS - 005.2021", "BENTO GONÇALVES - LIMPEZA - 048.2026"), então
// dá para sugerir o contrato a partir do município digitado. É sugestão: o
// campo continua editável, e a mesma cidade pode ter vários contratos.
const semAcento = (s: string) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
const PALAVRA_CURTA = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "-"]);
const tokens = (s: string) => semAcento(s).split(/[^A-Z0-9]+/).filter(t => t.length > 1 && !PALAVRA_CURTA.has(t));

// O número do contrato ("062/2025", "95.2026") não identifica nada: é o que
// sobra depois dele que diz de qual contrato se trata.
const tokensNome = (s: string) => tokens(s).filter(t => !/^\d+$/.test(t));

// Pontua o quanto um nome de contrato "casa" com o texto do município.
//
// O campo guarda duas coisas na prática: cidade ("CHARQUEADAS") e descrição de
// posto ("UFRGS - JARDINAGEM CAMPUS SAUDE TRI"). Por isso a comparação olha
// nos DOIS sentidos e fica com o mais forte:
//   • quanto do MUNICÍPIO aparece no contrato — resolve "RIO GRANDE" →
//     "CAMARA DE RIO GRANDE-LIMPEZA";
//   • quanto do CONTRATO é explicado pelo município — resolve
//     "UFRGS - JARDINAGEM CAMPUS SAUDE TRI" → "UFRGS - JARDINAGEM - 062/2025",
//     que só ganha das outras 9 linhas da UFRGS porque é a única cujo nome
//     inteiro (UFRGS + JARDINAGEM) está no texto.
// Exigir os dois lados altos rejeitaria o primeiro caso; exigir só um lado
// baixo aceitaria "SANTA MARIA" como "SANTA CRUZ".
function pontuarContrato(municipio: string, nomeContrato: string): number {
  const m = semAcento(municipio), c = semAcento(nomeContrato);
  if (!m || !c) return 0;
  // Sem nenhuma palavra significativa não há o que casar. Fica ANTES das
  // comparações de texto: "DE" casaria por substring com "CAMARA DE RIO
  // GRANDE" e sugeriria um contrato sem nada a ver.
  const tm = tokensNome(municipio), tc = tokensNome(nomeContrato);
  if (!tm.length || !tc.length) return 0;
  if (c === m) return 1000;
  if (c.startsWith(m)) return 900 - c.length / 100;     // prefixo: o mais curto ganha
  if (c.includes(m)) return 800 - c.length / 100;

  const sm = new Set(tm), sc = new Set(tc);
  const covMunicipio = [...sm].filter(t => sc.has(t)).length / sm.size;
  const covContrato  = [...sc].filter(t => sm.has(t)).length / sc.size;
  const forte = Math.max(covMunicipio, covContrato);
  if (forte < 0.6) return 0;
  // Cobertura forte manda; a outra desempata; nome curto desempata por último.
  return forte * 500 + Math.min(covMunicipio, covContrato) * 100 - c.length / 100;
}

export function sugerirContrato(municipio: string, contratos: string[]): string {
  let melhor = "", pontos = 0;
  for (const c of contratos) {
    const p = pontuarContrato(municipio, c);
    if (p > pontos) { pontos = p; melhor = c; }
  }
  return pontos > 0 ? melhor : "";
}

// ── Município a partir do contrato ─────────────────────────────────
// O caminho inverso do de cima, e o que a tela usa hoje: o contrato vem da
// Sênior (CONTRATOS) e o município tem que ser a cidade DAQUELE contrato.
//
// A CONTRATOS não tem coluna de cidade — só "Endereço" (logradouro) e "CEP" —,
// então a cidade sai do próprio nome do contrato, casando-o contra a lista de
// municípios do IBGE. Quando nada casa, o campo fica em branco e a validação do
// Salvar cobra o preenchimento (é obrigatório).
const partesNome = (s: string) => semAcento(s).split(/[^A-Z0-9']+/).filter(Boolean);

// Índice nome-normalizado → nome com acento. Ignora nomes com menos de 4 letras
// ("Ipê", "Iuiú"): curtos demais para casar sem falso positivo. Montado uma vez.
let MUN_IDX: Map<string, string> | null = null;
function municipiosIndexados(): Map<string, string> {
  if (!MUN_IDX) {
    MUN_IDX = new Map();
    for (const lista of Object.values(MUNICIPIOS_POR_UF))
      for (const nome of lista) {
        const chave = partesNome(nome).join(" ");
        if (chave.replace(/[^A-Z]/g, "").length >= 4 && !MUN_IDX.has(chave)) MUN_IDX.set(chave, nome);
      }
  }
  return MUN_IDX;
}

/**
 * Procura um município dentro do nome do contrato, do trecho mais longo para o
 * mais curto ("SALTO DO JACUI" antes de "SALTO").
 *
 * `noInicio` diz se a cidade ABRE o nome ("CAXIAS DO SUL - 2026/95"). Só nesse
 * caso a tela preenche o município sozinha: aí a cidade é a identidade do
 * contrato, e nos 57 contratos ativos os 8 casos assim estão todos certos.
 * Casado no meio do nome, vira sugestão de um clique — acerta "UFFS CHAPECO" e
 * "HUSM SANTA MARIA", mas também tira "Saúde" (município de SC) de "UFRGS -
 * AUXILIAR DE SAÚDE BUCAL". Gravar esse chute sozinho seria erro silencioso:
 * ninguém desconfia de campo já preenchido.
 */
export function cidadeDoContrato(nomeContrato: string): { cidade: string; noInicio: boolean } {
  const idx = municipiosIndexados();
  const t = partesNome(nomeContrato);
  for (let n = Math.min(5, t.length); n >= 1; n--)
    for (let i = 0; i + n <= t.length; i++) {
      const m = idx.get(t.slice(i, i + n).join(" "));
      if (m) return { cidade: m, noInicio: i === 0 };
    }
  return { cidade: "", noInicio: false };
}

// Custos do processo que não vêm dos motivos: recurso e perícia médica.
// Somam no custo final (decisão do Pablo, 17/08/2026) — são desembolso real.
const custosDoProcesso = (p: any) => PROC_VAL_FIELDS.reduce((s, k) => s + toFloat(p[k]), 0);
// `valor_final` preenchido continua mandando: é o fechamento lançado à mão, e
// quem o preenche já está dizendo qual foi o custo total.
const custoTotal = (p: any) => p.valor_final > 0 ? p.valor_final
  : p.valor_acordo + p.valor_sentenca + p.valor_outros_custos + p.valor_deposito_recursal + p.valor_custas_processuais + custosDoProcesso(p);
const motivoTotal = (i: MotivoItem) => VAL_FIELDS_MOTIVO.reduce((s, k) => s + toFloat(i[k]), 0);

// Vínculo reclamante ⇄ EMPREGADOS. Lê a tabela direto (mesmo padrão do Recrutamento).
const EMP_COLS = '"ID","Nome","CPF","Situação","Descrição do Local","Admissão","Data Afastamento","Valor Salário","PIS","C.Custo","Titulo C.Custo","Título do Cargo","Nome da Empresa","Nome Filial"';
const EMP_STOP = new Set(["DE", "DA", "DO", "DOS", "DAS", "E", "DI", "DU", "DAS", "OS"]);

// Input de moeda pt-BR: mostra 9.021,90 (formata no blur, deixa digitar livre).
function MoedaInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const fmt = (n: number) => n ? n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "";
  const [txt, setTxt] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setTxt(fmt(value)); }, [value]);
  return <input className="jpr-fi" style={{ height: 34 }} inputMode="decimal" value={txt}
    onFocus={() => { focused.current = true; }}
    onChange={e => { setTxt(e.target.value); const n = parseFloat(e.target.value.replace(/\./g, "").replace(",", ".")); onChange(isNaN(n) ? 0 : n); }}
    onBlur={() => { focused.current = false; setTxt(fmt(value)); }} />;
}

// Combobox "select-only": dá pra digitar para PESQUISAR, mas só escolher um
// item já existente (evita digitar qualquer coisa / criar duplicados).
//
// `aoCriarNovo` é opcional de propósito. Motivo pode ganhar um valor novo (é
// texto livre do jurídico); CONTRATO não — ele vem da tabela CONTRATOS, e
// deixar digitar à mão traria de volta exatamente o problema que estamos
// consertando (nome que não casa com contrato nenhum).
function ComboSelect({ value, options, onChange, placeholder, vazio, aoCriarNovo, rotuloCriar, limpavel }: {
  value: string; options: string[]; onChange: (v: string) => void;
  placeholder: string; vazio: string;
  aoCriarNovo?: () => string | null | undefined; rotuloCriar?: string; limpavel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = q.trim() ? options.filter(o => o.toLowerCase().includes(q.trim().toLowerCase())) : options;
  const escolher = (v: string) => { onChange(v); setOpen(false); setQ(""); };
  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0 }} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) { setOpen(false); setQ(""); } }}>
      <button type="button" className="jpr-fi" onClick={() => setOpen(o => !o)} style={{ width: "100%", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "#fff" }}>
        <span style={{ color: value ? "#0f172a" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value || placeholder}</span>
        <span style={{ color: "#94a3b8", fontSize: 11 }}>▼</span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 16px 40px rgba(15,23,42,.14)", overflow: "hidden" }}>
          <div style={{ padding: 8, borderBottom: "1px solid #f1f5f9" }}>
            <input autoFocus className="jpr-fi" placeholder="Digite para pesquisar…" value={q} onChange={e => setQ(e.target.value)} style={{ width: "100%" }} />
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {filtered.length === 0
              ? <div style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>{vazio}</div>
              : filtered.map(o => (
                <button type="button" key={o} onClick={() => escolher(o)} style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: o === value ? "#eef4ff" : "#fff", color: "#0f172a", fontSize: 12.5, cursor: "pointer" }} onMouseEnter={e => (e.currentTarget.style.background = "#f8fbff")} onMouseLeave={e => (e.currentTarget.style.background = o === value ? "#eef4ff" : "#fff")}>{o}</button>
              ))}
          </div>
          {limpavel && value && (
            <button type="button" onClick={() => escolher("")} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderTop: "1px solid #f1f5f9", background: "#fff", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>✕ Limpar seleção</button>
          )}
          {aoCriarNovo && (
            <button type="button" onClick={() => { const v = aoCriarNovo()?.trim(); if (v) escolher(v); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderTop: "1px solid #f1f5f9", background: "#fff", color: "#0f3171", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{rotuloCriar}</button>
          )}
        </div>
      )}
    </div>
  );
}

function MotivoSelect({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <ComboSelect
      value={value} options={options} onChange={onChange}
      placeholder="Selecione o motivo…" vazio="Nenhum motivo encontrado."
      rotuloCriar="➕ Criar novo motivo…"
      aoCriarNovo={() => window.prompt("Novo motivo (use o nome correto — vira opção para todos):")}
    />
  );
}

// Antes de 17/08/2026 toda proposta era, por definição, do juiz na audiência —
// a tela nem perguntava. Os registros antigos vêm sem `tipo`/`quem`, então o
// padrão reproduz o que a tela dizia deles: proposta judicial, do juiz.
const parsePropostas = (raw: any): Proposta[] =>
  Array.isArray(raw)
    ? raw.filter(p => p && (p.descricao || p.valor)).map(p => ({
        valor: toFloat(p.valor), descricao: String(p.descricao ?? ""),
        tipo: String(p.tipo ?? "Judicial"), quem: String(p.quem ?? "Juiz"),
        ...(p.data ? { data: String(p.data).slice(0, 10) } : {}),
      }))
    : [];

// As propostas fora de audiência moram numa coluna própria (propostas_json),
// mas o campo é text e vem repetido em toda linha de motivo: basta a primeira
// linha que tenha conteúdo.
function parsePropostasProcesso(rs: any[]): Proposta[] {
  for (const r of rs) {
    const raw = r.propostas_json;
    if (!raw || !String(raw).trim() || String(raw).trim() === "[]") continue;
    try {
      const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
      const lista = parsePropostas(arr);
      if (lista.length) return lista.sort((a, b) => String(a.data ?? "").localeCompare(String(b.data ?? "")));
    } catch { /* json inválido */ }
  }
  return [];
}

// Uma proposta na tela de detalhe. O selo diz de quem partiu e a cor separa as
// três origens de relance — antes era um "PROPOSTA DO JUIZ" fixo no código,
// que mentia assim que passasse a existir proposta da reclamada.
const COR_QUEM: Record<string, { bg: string; c: string }> = {
  Juiz:       { bg: "#fef3c7", c: "#b45309" },
  Reclamante: { bg: "#e0f2fe", c: "#0369a1" },
  Reclamada:  { bg: "#dcfce7", c: "#15803d" },
};
function LinhaProposta({ pr, comData }: { pr: Proposta; comData?: boolean }) {
  const cor = COR_QUEM[pr.quem] ?? COR_QUEM.Juiz;
  return (
    <div style={{ fontSize: 12, color: "#475569", display: "flex", gap: 7, alignItems: "baseline", flexWrap: "wrap" }}>
      {comData && <span style={{ color: "#94a3b8", whiteSpace: "nowrap" }}>{pr.data ? fmtDt(pr.data) : "sem data"}</span>}
      <span style={{ fontSize: 9.5, fontWeight: 800, color: cor.c, background: cor.bg, borderRadius: 20, padding: "1px 7px", whiteSpace: "nowrap" }}>
        {String(pr.quem || "Juiz").toUpperCase()} · {String(pr.tipo || "Judicial").toUpperCase()}
      </span>
      {pr.valor > 0 && <b style={{ color: "#0f172a", whiteSpace: "nowrap" }}>{money(pr.valor)}</b>}
      <span>{pr.descricao || "—"}</span>
    </div>
  );
}

function parseAudiencias(rs: any[]): Audiencia[] {
  for (const r of rs) {
    const raw = r.audiencias_json;
    if (raw && String(raw).trim() && String(raw).trim() !== "[]") {
      try {
        const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(arr) && arr.length) return arr.filter((a: any) => a && (a.data || a.data_audiencia)).map((a: any, i: number) => ({ ordem: i + 1, data: String(a.data || a.data_audiencia).slice(0, 10), tipo_audiencia: a.tipo_audiencia || a.tipo || "Audiência", modalidade_audiencia: a.modalidade_audiencia || a.modalidade, horario: a.horario, propostas: parsePropostas(a.propostas) })).sort((a, b) => a.data.localeCompare(b.data));
      } catch { /* json inválido */ }
    }
  }
  const out: Audiencia[] = [];
  const pick = (k: string) => { for (const r of rs) { const v = r[k]; if (v) return String(v).slice(0, 10); } return null; };
  // Sem audiencias_json: usa a 1ª data preenchida (mesma prioridade de antes) e
  // infere o tipo pelo campo de origem — ex.: data_audiencia_instrucao → "Instrução".
  const fontes: [string, string][] = [["data_audiencia_designada", ""], ["data_audiencia_instrucao", "Instrução"], ["primeira_audiencia", "1ª Audiência"], ["data_primeira_audiencia", "1ª Audiência"]];
  let d: string | null = null, inferido = "";
  for (const [k, t] of fontes) { const v = pick(k); if (v) { d = v; inferido = t; break; } }
  if (d) out.push({ ordem: 1, data: d, tipo_audiencia: rs[0]?.tipo_audiencia || inferido || "Audiência", modalidade_audiencia: rs[0]?.modalidade_audiencia });
  return out;
}
function agrupar(rows: any[]): Processo[] {
  const seen = new Map<string, any>();
  for (const r of rows) { const key = `${r.numero_processo}|${String(r.motivos || "").trim()}|${r.motivo_ordem ?? 0}`; const prev = seen.get(key); if (!prev || Number(r.id || 0) < Number(prev.id || 0)) seen.set(key, r); }
  const groups = new Map<string, any[]>();
  for (const r of seen.values()) { const n = r.numero_processo; if (!n) continue; if (!groups.has(n)) groups.set(n, []); groups.get(n)!.push(r); }
  const out: Processo[] = [];
  for (const [numero, rs] of groups) {
    rs.sort((a, b) => (Number(a.motivo_ordem ?? a.id) - Number(b.motivo_ordem ?? b.id)) || Number(a.id) - Number(b.id));
    const first = (k: string) => { for (const r of rs) { const v = String(r[k] ?? "").trim(); if (v) return v; } return ""; };
    const sum = (k: string) => rs.reduce((s, r) => s + toFloat(r[k]), 0);
    const maxN = (k: string) => rs.reduce((m, r) => Math.max(m, Number(r[k]) || 0), 0);
    const minId = rs.reduce((m, r) => Math.min(m, Number(r.id) || Infinity), Infinity);
    const motivo_items: MotivoItem[] = rs.map((r, i) => { const o: any = { ordem: Number(r.motivo_ordem ?? i + 1), motivo: String(r.motivos ?? "").trim() || "Sem motivo" }; VAL_FIELDS_MOTIVO.forEach(k => o[k] = toFloat(r[k])); return o; });
    // Custos do processo: maxN (uma linha), nunca sum. O valor está repetido
    // em todas as linhas de motivo, então somar multiplicaria pelo nº de motivos.
    const procVals: any = {};
    PROC_VAL_FIELDS.forEach(k => procVals[k] = maxN(k));
    out.push({
      ...procVals,
      vai_recorrer: first("vai_recorrer"),
      houve_pericia_medica: first("houve_pericia_medica"),
      propostas: parsePropostasProcesso(rs),
      id: Number.isFinite(minId) ? minId : 0,
      id_sequencial: maxN("id_sequencial"),
      numero_processo: numero, reclamante: first("reclamante"), reclamada: first("reclamada"), comarca: first("comarca"), municipio_origem: first("municipio_origem"),
      reclamante_vinculado_cpf: first("reclamante_vinculado_cpf"),
      status: (first("status") || "EM ANDAMENTO").toUpperCase(), ano_processo: maxN("ano_processo"), origem: first("origem").toLowerCase(), contrato: first("contrato"),
      valor_causa: sum("valor_causa"), valor_pedidos: sum("valor_pedidos"), valor_acordo: sum("valor_acordo"), valor_sentenca: sum("valor_sentenca"),
      valor_final: sum("valor_final"), valor_outros_custos: sum("valor_outros_custos"), valor_deposito_recursal: sum("valor_deposito_recursal"), valor_custas_processuais: sum("valor_custas_processuais"),
      motivos: rs.map(r => String(r.motivos ?? "").trim() || "Sem motivo").join(" • "), motivo_items,
      houve_acordo: first("houve_acordo"), status_sentenca: first("status_sentenca"), data_entrada_reclamatoria: first("data_entrada_reclamatoria"),
      status_recursos: first("status_recursos"), havera_pericia: first("havera_pericia"), motivo_acordo: first("motivo_acordo"), motivos_outros_custos: first("motivos_outros_custos"),
      local_pericia: first("local_pericia"), data_pericia: first("data_pericia"), hora_pericia: first("hora_pericia"),
      tipo_audiencia: first("tipo_audiencia"), modalidade_audiencia: first("modalidade_audiencia"), audiencias: parseAudiencias(rs),
    });
  }
  // Ordem de chegada: o cadastrado por último (maior nº sequencial) fica no topo.
  // Sem sequencial (processo criado antes da coluna existir) cai para o fim.
  out.sort((a, b) => (b.id_sequencial - a.id_sequencial) || a.numero_processo.localeCompare(b.numero_processo));
  return out;
}

const ativo = (p: Processo) => p.status !== "ARQUIVADO";
const FORM_RESET = () => ({
  numero_processo: "", reclamante: "", reclamada: "", status: "EM ANDAMENTO", comarca: "", municipio_origem: "", data_entrada_reclamatoria: "", contrato: "", reclamante_vinculado_cpf: "", status_sentenca: "", status_recursos: "", houve_acordo: "Não", motivo_acordo: "", havera_pericia: "Não", local_pericia: "", data_pericia: "", hora_pericia: "", motivos_outros_custos: "",
  // Recurso da condenação
  vai_recorrer: "Não", valor_custas_recursais: 0, valor_seguro_garantia: 0,
  // Perícia médica
  houve_pericia_medica: "Não", valor_perito_judicial: 0, valor_assistente_tecnico: 0,
});
const STATUS_SENTENCA_OPC = ["", "PROCEDENTE", "IMPROCEDENTE", "PARCIALMENTE PROCEDENTE", "EM ANDAMENTO", "ACORDO", "EXTINTO", "ARQUIVADO"];
const STATUS_RECURSO_OPC = ["", "SEM RECURSO", "EM ANDAMENTO", "PROVIDO", "IMPROVIDO", "ARQUIVADO"];
// Salário vem de EMPREGADOS como texto pt-BR ("2.002,6900"): normaliza e devolve número.
const parseSalario = (v: any): number | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  let s = String(v).trim().replace(/[^\d.,-]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
const MOTIVO_RESET = (): MotivoItem => ({ ordem: 1, motivo: "", valor_pedidos: 0, valor_acordo: 0, valor_sentenca: 0, valor_final: 0, valor_outros_custos: 0, valor_deposito_recursal: 0, valor_custas_processuais: 0 });

const TITULOS: Record<string, string> = { dashboard: "📊 Dashboard - Processos", processos: "📁 Processos", audiencias: "📅 Audiências" };

export default function Processos({ view = "processos" }: { view?: "dashboard" | "processos" | "audiencias" }) {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const autor = empregado?.nome || (user?.user_metadata as any)?.nome || user?.email || "Usuário";

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fMotivo, setFMotivo] = useState("");
  const [fId, setFId] = useState("");
  const [fNumero, setFNumero] = useState("");
  const [fReclamante, setFReclamante] = useState("");
  const [fReclamada, setFReclamada] = useState("");
  const [fAno, setFAno] = useState("");
  const [pagina, setPagina] = useState(1);
  // filtros da agenda de Audiências
  const [aStatus, setAStatus] = useState("");
  const [aModal, setAModal] = useState("");
  const [aTipo, setATipo] = useState("");
  const [aSit, setASit] = useState("fut");
  const [aMes, setAMes] = useState(hojeISO().slice(0, 7)); // padrão: mês atual
  const [audAjuda, setAudAjuda] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string; t: string }[]>([]);

  const [sel, setSel] = useState<Processo | null>(null);
  const [coments, setComents] = useState<Comentario[]>([]);
  const [novoComent, setNovoComent] = useState("");

  const [modal, setModal] = useState(false);
  const [editNumero, setEditNumero] = useState<string | null>(null);
  const [form, setForm] = useState(FORM_RESET());
  const [motivos, setMotivos] = useState<MotivoItem[]>([MOTIVO_RESET()]);
  const [auds, setAuds] = useState<Audiencia[]>([]);
  // Propostas fora de audiência — "no decorrer do processo".
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  // vínculo do reclamante com EMPREGADOS
  const [empBusca, setEmpBusca] = useState("");
  const [empResultados, setEmpResultados] = useState<any[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  const [empSelKey, setEmpSelKey] = useState<string | null>(null);
  const [detalheEmp, setDetalheEmp] = useState<any | null>(null);
  // Contratos ativos, para sugerir o Contrato a partir do município.
  const [contratosNomes, setContratosNomes] = useState<string[]>([]);
  // Assim que alguém mexe no Contrato à mão, a sugestão para de sobrescrever.
  const contratoManual = useRef(false);

  const toast = (msg: string, t = "info") => { const id = Date.now() + Math.random(); setToasts(x => [...x, { id, msg, t }]); setTimeout(() => setToasts(x => x.filter(i => i.id !== id)), 3600); };

  const load = useCallback(async () => {
    setLoading(true); setErro(null);
    const all: any[] = []; const chunk = 1000;
    for (let from = 0; from <= 300000; from += chunk) {
      const { data, error } = await (supabase as any).from("JUR_PROCESSOS").select("*").order("id", { ascending: true }).range(from, from + chunk - 1);
      if (error) { setErro(error.message); setRows([]); setLoading(false); return; }
      all.push(...(data ?? [])); if (!data || data.length < chunk) break;
    }
    setRows(all); setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Só os ATIVOS: sugerir contrato encerrado só daria retrabalho. A tabela tem
  // nomes repetidos (mesma linha em anos diferentes), então deduplica.
  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any).from("CONTRATOS")
        .select('"NOME CONTRATO"').eq("ATIVO", "SIM");
      if (error) { console.warn("CONTRATOS:", error.message); return; }
      const nomes = [...new Set((data ?? []).map((c: any) => String(c["NOME CONTRATO"] ?? "").trim()).filter(Boolean))] as string[];
      setContratosNomes(nomes.sort());
    })();
  }, []);

  const processos = useMemo(() => agrupar(rows), [rows]);
  const resumo = useMemo(() => {
    const r = { processos: processos.length, em_andamento: 0, pedidos: 0, acordos: 0, sentencas: 0, final: 0, causa_rt: 0 };
    for (const p of processos) { if (ativo(p)) r.em_andamento++; r.pedidos += p.valor_pedidos; r.acordos += p.valor_acordo; r.sentencas += p.valor_sentenca; r.final += custoTotal(p); if (p.origem === "rtgeral") r.causa_rt += p.valor_causa; }
    return r;
  }, [processos]);
  const porMotivo = useMemo(() => {
    const acc = new Map<string, any>();
    for (const p of processos) for (const it of p.motivo_items) { const m = it.motivo || "Não especificado"; const s = acc.get(m) || { motivo: m, count: 0, processos: new Set(), total: 0 }; s.count++; s.processos.add(p.numero_processo); s.total += motivoTotal(it); acc.set(m, s); }
    return [...acc.values()].map(v => ({ motivo: v.motivo, count: v.count, processos: v.processos.size, total: v.total })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [processos]);
  const porAno = useMemo(() => {
    const acc = new Map<number, any>();
    for (const p of processos) { if (!p.ano_processo) continue; const s = acc.get(p.ano_processo) || { ano: String(p.ano_processo), count: 0, pedidos: 0, acordos: 0, total: 0 }; s.count++; s.pedidos += p.valor_pedidos; s.acordos += p.valor_acordo; s.total += custoTotal(p); acc.set(p.ano_processo, s); }
    return [...acc.values()].sort((a, b) => Number(a.ano) - Number(b.ano));
  }, [processos]);
  const porReclamada = useMemo(() => {
    const acc = new Map<string, any>();
    for (const p of processos) { const e = p.reclamada || "Não informado"; const s = acc.get(e) || { empresa: e, num: 0, total: 0 }; s.num++; s.total += custoTotal(p); acc.set(e, s); }
    return [...acc.values()].sort((a, b) => b.num - a.num).slice(0, 8);
  }, [processos]);
  const audiencias = useMemo(() => {
    const out: any[] = []; const hoje = hojeISO();
    for (const p of processos) for (const a of p.audiencias) { if (!a.data) continue; out.push({ p, data: a.data, horario: a.horario || "", tipo: a.tipo_audiencia || "Audiência", modalidade: a.modalidade_audiencia || "", futuro: a.data >= hoje }); }
    out.sort((a, b) => (a.futuro === b.futuro ? (a.futuro ? a.data.localeCompare(b.data) : b.data.localeCompare(a.data)) : (a.futuro ? -1 : 1)));
    return out;
  }, [processos]);
  const audTipos = useMemo(() => [...new Set(audiencias.map(a => String(a.tipo || "Audiência")))].sort(), [audiencias]);
  const audStats = useMemo(() => ({ total: audiencias.length, fut: audiencias.filter(a => a.futuro).length, past: audiencias.filter(a => !a.futuro).length }), [audiencias]);
  const audPorMes = useMemo(() => {
    const acc = new Map<string, number>();
    for (const a of audiencias) { if (!a.futuro || !a.data) continue; const ym = String(a.data).slice(0, 7); acc.set(ym, (acc.get(ym) || 0) + 1); }
    return [...acc.entries()].sort((x, y) => x[0].localeCompare(y[0])).slice(0, 12).map(([ym, n]) => { const [y, m] = ym.split("-"); return { mes: `${m}/${y.slice(2)}`, audiencias: n }; });
  }, [audiencias]);
  const audPorTipo = useMemo(() => {
    const acc = new Map<string, number>();
    for (const a of audiencias) { if (!a.futuro) continue; const t = String(a.tipo || "Audiência"); acc.set(t, (acc.get(t) || 0) + 1); }
    return [...acc.entries()].map(([tipo, n]) => ({ tipo, n })).sort((x, y) => y.n - x.n);
  }, [audiencias]);
  const audMeses = useMemo(() => [...new Set(audiencias.map(a => String(a.data || "").slice(0, 7)).filter(Boolean))].sort().reverse(), [audiencias]);
  // Opções do seletor: meses com audiência + o mês selecionado (mesmo vazio) + o atual.
  const audMesesOpts = useMemo(() => { const s = new Set(audMeses); s.add(hojeISO().slice(0, 7)); if (aMes) s.add(aMes); return [...s].sort().reverse(); }, [audMeses, aMes]);
  const audFiltradas = useMemo(() => audiencias.filter(a => {
    if (aStatus && a.p.status !== aStatus) return false;
    if (aModal && String(a.modalidade || "") !== aModal) return false;
    if (aTipo && String(a.tipo || "Audiência") !== aTipo) return false;
    if (aSit === "fut" && !a.futuro) return false;
    if (aSit === "past" && a.futuro) return false;
    if (aMes && String(a.data || "").slice(0, 7) !== aMes) return false;
    return true;
  }), [audiencias, aStatus, aModal, aTipo, aSit, aMes]);
  // motivo "predominante" = o 1º motivo do processo (o que aparece na coluna Motivos)
  const SEM_MOTIVO = ["", "Sem motivo", "Não especificado"];
  const ehSemMotivo = (p: Processo) => SEM_MOTIVO.includes((p.motivo_items[0]?.motivo || "").trim());
  // Só dígitos: "0020035-59.2024…" acha tanto digitando com pontuação quanto sem.
  const soDigitos = (s: string) => String(s || "").replace(/\D/g, "");
  const contem = (campo: string, termo: string) => String(campo || "").toLowerCase().includes(termo.trim().toLowerCase());
  const filtrados = useMemo(() => processos.filter(p => {
    if (fStatus && p.status !== fStatus) return false;
    if (fMotivo) {
      if (fMotivo === "__SEM__") { if (!ehSemMotivo(p)) return false; }
      else if ((p.motivo_items[0]?.motivo || "").trim() !== fMotivo) return false;
    }
    if (fId.trim() && String(p.id_sequencial || "") !== fId.trim()) return false;
    if (fNumero.trim()) {
      const alvo = soDigitos(fNumero);
      if (alvo ? !soDigitos(p.numero_processo).includes(alvo) : !contem(p.numero_processo, fNumero)) return false;
    }
    if (fReclamante.trim() && !contem(p.reclamante, fReclamante)) return false;
    if (fReclamada.trim() && !contem(p.reclamada, fReclamada)) return false;
    if (fAno && String(p.ano_processo || "") !== fAno) return false;
    if (busca) { const q = busca.toLowerCase(); return [p.numero_processo, String(p.id_sequencial), p.reclamante, p.reclamada, p.motivos, p.comarca, String(p.ano_processo)].some(x => String(x || "").toLowerCase().includes(q)); }
    return true;
  }), [processos, busca, fStatus, fMotivo, fId, fNumero, fReclamante, fReclamada, fAno]);
  const anosDisponiveis = useMemo(() => [...new Set(processos.map(p => p.ano_processo).filter(Boolean))].sort((a, b) => b - a), [processos]);
  const filtrosAtivos = [busca, fStatus, fMotivo, fId, fNumero, fReclamante, fReclamada, fAno].filter(v => String(v).trim()).length;
  const limparProc = () => { setBusca(""); setFStatus(""); setFMotivo(""); setFId(""); setFNumero(""); setFReclamante(""); setFReclamada(""); setFAno(""); };
  // opções do filtro: motivos predominantes distintos (ordenados por frequência) + "(Sem motivo)"
  const motivosPredominantes = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of processos) { const m = (p.motivo_items[0]?.motivo || "").trim(); if (m && !SEM_MOTIVO.includes(m)) c.set(m, (c.get(m) || 0) + 1); }
    return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([m, n]) => ({ m, n }));
  }, [processos]);
  const semMotivoCount = useMemo(() => processos.filter(ehSemMotivo).length, [processos]);
  const motivosNoRecorte = useMemo(() => filtrados.reduce((s, p) => s + p.motivo_items.length, 0), [filtrados]);
  // listas para os dropdowns (todos os motivos e reclamadas já usados)
  const motivosDistintos = useMemo(() => [...new Set(rows.map(r => String(r.motivos || "").trim()).filter(Boolean))].sort(), [rows]);
  const reclamadasDistintas = useMemo(() => [...new Set(rows.map(r => String(r.reclamada || "").trim()).filter(Boolean))].sort(), [rows]);
  const statusPredominante = useMemo(() => { const c: Record<string, number> = {}; filtrados.forEach(p => c[p.status] = (c[p.status] || 0) + 1); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || "—"; }, [filtrados]);
  // paginação da lista de processos (50 por página)
  useEffect(() => { setPagina(1); }, [busca, fStatus, fMotivo, fId, fNumero, fReclamante, fReclamada, fAno]);
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = useMemo(() => filtrados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE), [filtrados, paginaAtual]);

  // ── comentários ────────────────────────────────────────────────
  const abrirDetalhe = async (p: Processo) => {
    setSel(p); setComents([]); setNovoComent("");
    const { data } = await (supabase as any).from("SISTEMA_COMENTARIOS").select("*").eq("modulo", "processo").eq("entidade_id", p.numero_processo).order("created_at", { ascending: false });
    setComents(data ?? []);
  };
  const addComent = async () => {
    if (!sel || !novoComent.trim()) return;
    const { data, error } = await (supabase as any).from("SISTEMA_COMENTARIOS").insert({ modulo: "processo", entidade_id: sel.numero_processo, autor_nome: autor, texto: novoComent.trim() }).select("*").single();
    if (error) { toast("Erro ao comentar: " + error.message, "err"); return; }
    setComents(c => [data, ...c]); setNovoComent("");
  };
  const delComent = async (c: Comentario) => { if (!confirm("Excluir este comentário?")) return; const { error } = await (supabase as any).from("SISTEMA_COMENTARIOS").delete().eq("id", c.id); if (error) { toast("Erro: " + error.message, "err"); return; } setComents(x => x.filter(i => i.id !== c.id)); };

  // ── Vínculo do reclamante com EMPREGADOS ───────────────────────
  // Busca por nome tolerante (mesmo grafado errado): casa TODAS as palavras
  // significativas (ignora DE/DA/DO…), em qualquer ordem e situação.
  const buscarEmpregados = async (term: string) => {
    const tokens = String(term || "").toUpperCase().split(/\s+/).filter(t => t.length >= 3 && !EMP_STOP.has(t));
    if (!tokens.length) { setEmpResultados([]); toast("Digite ao menos um nome/sobrenome.", "err"); return; }
    setEmpLoading(true); setEmpSelKey(null);
    let q = (supabase as any).from("EMPREGADOS").select(EMP_COLS);
    for (const t of tokens) q = q.ilike("Nome", `%${t}%`);
    const { data, error } = await q.order('"Nome"').limit(30);
    setEmpLoading(false);
    if (error) { toast("EMPREGADOS: " + error.message, "err"); return; }
    setEmpResultados(data ?? []);
  };
  const confirmarVinculo = async (emp: any) => {
    const cpf = emp["CPF"] || "";
    // O CONTRATO do empregado é "Nome Filial", não "Descrição do Local".
    //
    // Isto já saiu errado em produção (ARIANA BRITTO PEREIRA veio como
    // "UFRGS - CAMPUS VALE 6D TRI" em vez de "UFRGS - LIMPEZA GERAL -
    // 047/2022"). "Descrição do Local" é o POSTO — o prédio/andar/turno onde a
    // pessoa trabalha dentro do contrato. Medido nos 12.763 empregados:
    // "Descrição do Local" casa com um contrato ativo em ZERO deles;
    // "Nome Filial" casa em 5.227.
    //
    // Só aceita quando é mesmo um contrato conhecido: nos empregados
    // administrativos o "Nome Filial" traz a RAZÃO SOCIAL ("NASCIMENTO
    // SERVICOS DE LIMPEZA LTDA", 5.493 deles), e carimbar isso no campo
    // Contrato seria trocar um valor errado por outro.
    const filial = String(emp["Nome Filial"] ?? "").trim();
    const local = contratosNomes.find(n => n.toUpperCase() === filial.toUpperCase()) ?? "";
    if (local) contratoManual.current = true;
    // Mesmo critério do campo Contrato: só preenche a cidade sozinha quando ela
    // abre o nome do contrato e o município ainda está vazio.
    const { cidade, noInicio } = cidadeDoContrato(local);
    const cidadeNova = noInicio && cidade && !form.municipio_origem.trim() ? cidade : "";
    setForm(v => ({
      ...v, reclamante_vinculado_cpf: cpf, contrato: local || v.contrato,
      municipio_origem: cidadeNova || v.municipio_origem,
    }));
    setEmpResultados([]); setEmpSelKey(null);
    // Processo já existente: grava o vínculo na hora (não depende do "Salvar processo").
    if (editNumero) {
      const patch: any = { reclamante_vinculado_cpf: cpf || null };
      if (local) patch.contrato = local;
      if (cidadeNova) patch.municipio_origem = cidadeNova;
      const { error } = await (supabase as any).from("JUR_PROCESSOS").update(patch).eq("numero_processo", editNumero);
      if (error) { toast("Erro ao salvar vínculo: " + error.message, "err"); return; }
      await load();
      toast("Vínculo salvo: " + (emp["Nome"] || cpf) + ".", "ok");
    } else {
      toast("Vínculo definido. Clique em “Salvar processo” para gravar.", "ok");
    }
  };
  const desvincular = () => setForm(v => ({ ...v, reclamante_vinculado_cpf: "" }));
  const verDetalhesReclamante = async (cpf: string) => {
    if (!cpf) return;
    setDetalheEmp({ _loading: true, CPF: cpf });
    const { data, error } = await (supabase as any).from("EMPREGADOS").select(EMP_COLS).eq("CPF", cpf).limit(1);
    if (error) { toast("EMPREGADOS: " + error.message, "err"); setDetalheEmp(null); return; }
    setDetalheEmp((data && data[0]) || { _vazio: true, CPF: cpf });
  };

  // ── CRUD ───────────────────────────────────────────────────────
  const abrirNovo = () => { setEditNumero(null); contratoManual.current = false; setForm(FORM_RESET()); setMotivos([MOTIVO_RESET()]); setAuds([]); setPropostas([]); setEmpBusca(""); setEmpResultados([]); setEmpSelKey(null); setModal(true); };
  const abrirEditar = (p: Processo) => {
    setEditNumero(p.numero_processo);
    // Processo que já tem contrato salvo: a sugestão não pode sobrescrever o
    // que alguém escolheu antes. Sem contrato, volta a sugerir.
    contratoManual.current = !!String(p.contrato ?? "").trim();
    setForm({ numero_processo: p.numero_processo, reclamante: p.reclamante, reclamada: p.reclamada, status: p.status, comarca: p.comarca, municipio_origem: p.municipio_origem, data_entrada_reclamatoria: (p.data_entrada_reclamatoria || "").slice(0, 10), contrato: p.contrato, reclamante_vinculado_cpf: p.reclamante_vinculado_cpf || "", status_sentenca: p.status_sentenca || "", status_recursos: p.status_recursos || "", houve_acordo: p.houve_acordo || "Não", motivo_acordo: p.motivo_acordo || "", havera_pericia: p.havera_pericia || "Não", local_pericia: p.local_pericia || "", data_pericia: (p.data_pericia || "").slice(0, 10), hora_pericia: (p.hora_pericia || "").slice(0, 5), motivos_outros_custos: p.motivos_outros_custos || "",
      vai_recorrer: p.vai_recorrer || "Não", valor_custas_recursais: p.valor_custas_recursais || 0, valor_seguro_garantia: p.valor_seguro_garantia || 0,
      houve_pericia_medica: p.houve_pericia_medica || "Não", valor_perito_judicial: p.valor_perito_judicial || 0, valor_assistente_tecnico: p.valor_assistente_tecnico || 0 });
    setMotivos(p.motivo_items.length ? p.motivo_items.map(m => ({ ...m })) : [MOTIVO_RESET()]);
    setAuds(p.audiencias.map(a => ({ ...a, propostas: (a.propostas || []).map(pr => ({ ...pr })) })));
    setPropostas((p.propostas || []).map(pr => ({ ...pr })));
    setEmpBusca(p.reclamante || ""); setEmpResultados([]); setEmpSelKey(null); setModal(true);
  };
  const salvar = async () => {
    const numero = form.numero_processo.replace(/\s+/g, "").trim();
    if (!numero) { toast("Informe o número do processo.", "err"); return; }
    if (!form.reclamante.trim()) { toast("Informe o reclamante.", "err"); return; }
    // Obrigatório: a CONTRATOS não tem a cidade, então quando o nome do contrato
    // não entrega o município ninguém mais preenche isso depois.
    if (!form.municipio_origem.trim()) { toast("Informe o município de origem (a cidade do contrato).", "err"); return; }
    const dataEntrada = form.data_entrada_reclamatoria || null;
    const ano = (dataEntrada ? Number(dataEntrada.slice(0, 4)) : null) || anoDoNumero(numero) || null;
    const limparPropostas = (lista: Proposta[]) => lista
      .filter(pr => pr.descricao.trim() || pr.valor)
      .map(pr => ({ valor: pr.valor || 0, descricao: pr.descricao.trim(), tipo: pr.tipo || "Judicial", quem: pr.quem || "Juiz", ...(pr.data ? { data: pr.data } : {}) }));
    const audsJson = auds.length ? JSON.stringify(auds.map((a, i) => ({ ordem: i + 1, data: a.data, tipo_audiencia: a.tipo_audiencia || "Instrução", modalidade_audiencia: a.modalidade_audiencia, horario: a.horario || null, propostas: limparPropostas(a.propostas || []) }))) : null;
    const propostasJson = (() => { const l = limparPropostas(propostas); return l.length ? JSON.stringify(l) : null; })();
    // Nº sequencial: na edição mantém o que o processo já tem; num cadastro novo
    // pega o próximo da base (lido na hora, não do estado em memória).
    const seqAtual = editNumero ? (processos.find(p => p.numero_processo === editNumero)?.id_sequencial || 0) : 0;
    let idSequencial = seqAtual;
    if (!idSequencial) {
      const { data: ult, error: errSeq } = await (supabase as any).from("JUR_PROCESSOS").select("id_sequencial").not("id_sequencial", "is", null).order("id_sequencial", { ascending: false }).limit(1);
      if (errSeq) { toast("Erro ao gerar o nº sequencial: " + errSeq.message, "err"); return; }
      idSequencial = Number(ult?.[0]?.id_sequencial || 0) + 1;
    }
    const primeira = auds.length ? auds.map(a => a.data).filter(Boolean).sort()[0] || null : null;
    const lista = motivos.length ? motivos : [MOTIVO_RESET()];
    const novas = lista.map((m, idx) => ({
      numero_processo: numero, reclamante: form.reclamante.trim(), reclamada: form.reclamada.trim() || null, motivos: m.motivo.trim() || "Sem motivo",
      status: form.status, ano_processo: ano, motivo_ordem: idx + 1, id_sequencial: idSequencial,
      valor_pedidos: m.valor_pedidos || 0, valor_acordo: m.valor_acordo || 0, valor_sentenca: m.valor_sentenca || 0, valor_final: m.valor_final || 0,
      valor_outros_custos: m.valor_outros_custos || 0, valor_deposito_recursal: m.valor_deposito_recursal || 0, valor_custas_processuais: m.valor_custas_processuais || 0,
      houve_acordo: form.houve_acordo || (m.valor_acordo > 0 ? "Sim" : "Não"), comarca: form.comarca.trim() || null, municipio_origem: form.municipio_origem.trim() || null,
      contrato: form.contrato.trim() || null, data_entrada_reclamatoria: dataEntrada, primeira_audiencia: primeira, data_primeira_audiencia: primeira,
      reclamante_vinculado_cpf: form.reclamante_vinculado_cpf || null,
      status_sentenca: form.status_sentenca || null, status_recursos: form.status_recursos || null,
      motivo_acordo: form.motivo_acordo.trim() || null, havera_pericia: form.havera_pericia || null, motivos_outros_custos: form.motivos_outros_custos.trim() || null,
      local_pericia: form.local_pericia.trim() || null, data_pericia: form.data_pericia || null, hora_pericia: form.hora_pericia || null,
      audiencias_json: audsJson, tipo_audiencia: auds[0]?.tipo_audiencia || null, modalidade_audiencia: auds[0]?.modalidade_audiencia || null, updated_at: new Date().toISOString(),
      // Campos do PROCESSO: vão repetidos em toda linha de motivo (é assim que
      // a tabela é), e a leitura em agrupar() pega de uma linha só.
      vai_recorrer: form.vai_recorrer || null,
      valor_custas_recursais: form.vai_recorrer === "Sim" ? (form.valor_custas_recursais || 0) : 0,
      valor_seguro_garantia: form.vai_recorrer === "Sim" ? (form.valor_seguro_garantia || 0) : 0,
      houve_pericia_medica: form.houve_pericia_medica || null,
      valor_perito_judicial: form.houve_pericia_medica === "Sim" ? (form.valor_perito_judicial || 0) : 0,
      valor_assistente_tecnico: form.houve_pericia_medica === "Sim" ? (form.valor_assistente_tecnico || 0) : 0,
      propostas_json: propostasJson,
    }));
    if (editNumero && editNumero !== numero && processos.some(p => p.numero_processo === numero)) { toast("Já existe outro processo com esse número.", "err"); return; }
    const del = await (supabase as any).from("JUR_PROCESSOS").delete().eq("numero_processo", editNumero || numero);
    if (del.error) { toast("Erro ao salvar: " + del.error.message, "err"); return; }
    const ins = await (supabase as any).from("JUR_PROCESSOS").insert(novas);
    if (ins.error) { toast("Erro ao salvar: " + ins.error.message, "err"); return; }
    setModal(false); toast(editNumero ? "Processo atualizado." : "Processo cadastrado.", "ok"); load();
  };
  const excluir = async (p: Processo) => {
    if (!confirm(`Excluir o processo ${p.numero_processo} e todos os seus lançamentos?`)) return;
    const { error } = await (supabase as any).from("JUR_PROCESSOS").delete().eq("numero_processo", p.numero_processo);
    if (error) { toast("Erro ao excluir: " + error.message, "err"); return; }
    setSel(null); toast("Processo excluído.", "ok"); load();
  };
  // Sugestão de contrato para o município atual (vazia quando nada casa).
  const sugestaoContrato = useMemo(
    () => sugerirContrato(form.municipio_origem, contratosNomes),
    [form.municipio_origem, contratosNomes],
  );
  // Digitar o município preenche o Contrato — mas nunca por cima do que a
  // pessoa escreveu à mão, nem de um contrato que já veio salvo no processo.
  const setMunicipio = (v: string) => setForm(f => {
    const prox = { ...f, municipio_origem: v };
    if (!contratoManual.current) {
      const s = sugerirContrato(v, contratosNomes);
      if (s) prox.contrato = s;
    }
    return prox;
  });
  // Caminho principal hoje: escolhido o contrato, o município é a cidade DELE.
  // Preenche sozinho só quando a cidade abre o nome do contrato e o campo está
  // vazio — nunca por cima do que já foi digitado ou salvo antes.
  const escolherContrato = (v: string) => {
    contratoManual.current = true;
    setForm(f => {
      const prox = { ...f, contrato: v };
      const { cidade, noInicio } = cidadeDoContrato(v);
      if (noInicio && cidade && !f.municipio_origem.trim()) prox.municipio_origem = cidade;
      return prox;
    });
  };
  // Cidade que o contrato atual entrega — vira botão de um clique quando não foi
  // preenchida sozinha (casou no meio do nome, ou o campo já tinha outra coisa).
  const sugestaoMunicipio = useMemo(() => cidadeDoContrato(form.contrato).cidade, [form.contrato]);
  const temPericia = form.havera_pericia === "Sim" || !!(form.data_pericia || form.hora_pericia || form.local_pericia);

  const setMotivo = (i: number, patch: Partial<MotivoItem>) => setMotivos(ms => ms.map((m, idx) => idx === i ? { ...m, ...patch } : m));
  const setAud = (i: number, patch: Partial<Audiencia>) => setAuds(as => as.map((a, idx) => idx === i ? { ...a, ...patch } : a));
  // Propostas sempre por updater funcional: digitar rápido no valor/descrição não
  // pode reintroduzir uma versão antiga da lista.
  const mapPropostas = (i: number, fn: (ps: Proposta[]) => Proposta[]) =>
    setAuds(as => as.map((a, idx) => idx === i ? { ...a, propostas: fn(a.propostas || []) } : a));
  const setProposta = (i: number, j: number, patch: Partial<Proposta>) => mapPropostas(i, ps => ps.map((p, idx) => idx === j ? { ...p, ...patch } : p));
  // Proposta nova numa audiência nasce judicial e do juiz — é o caso de longe
  // mais comum, e era o único que a tela registrava antes.
  const addProposta = (i: number) => mapPropostas(i, ps => [...ps, { valor: 0, descricao: "", tipo: "Judicial", quem: "Juiz" }]);
  const delProposta = (i: number, j: number) => mapPropostas(i, ps => ps.filter((_, idx) => idx !== j));

  // Propostas fora de audiência. Nascem extrajudiciais: proposta que aparece no
  // decorrer do processo, sem audiência, em geral veio de conversa entre as
  // partes. E têm data própria, que a audiência dava de graça.
  const setPropostaProc = (j: number, patch: Partial<Proposta>) => setPropostas(ps => ps.map((p, idx) => idx === j ? { ...p, ...patch } : p));
  const addPropostaProc = () => setPropostas(ps => [...ps, { valor: 0, descricao: "", tipo: "Extrajudicial", quem: "Reclamante", data: "" }]);
  const delPropostaProc = (j: number) => setPropostas(ps => ps.filter((_, idx) => idx !== j));

  // Depósito recursal continua lançado POR MOTIVO (decisão do Pablo): a aba de
  // recurso mostra a soma, em leitura, para não haver dois lugares somando a
  // mesma coisa no custo final.
  const depositoRecursalTotal = useMemo(
    () => motivos.reduce((s, m) => s + toFloat(m.valor_deposito_recursal), 0), [motivos]);

  const statusCor = (s: string) => s === "ARQUIVADO" ? { bg: "#f1f5f9", c: "#64748b" } : s === "INDEFINIDO" ? { bg: "#fef9c3", c: "#a16207" } : { bg: "#fef3c7", c: "#b45309" };
  const kpi = (label: string, valor: string | number, cor: string, sub?: string) => (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: "14px 18px", flex: 1, minWidth: 165, boxShadow: "0 8px 24px rgba(15,23,42,.05)", borderTop: `3px solid ${cor}` }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".6px" }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, color: cor, marginTop: 3 }}>{valor}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 18, boxShadow: "0 8px 24px rgba(15,23,42,.05)" };
  const fld = (label: string, value: string) => (
    <div style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 9, padding: "7px 10px" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#334155", marginTop: 2, lineHeight: 1.25 }}>{value || "—"}</div>
    </div>
  );
  const mini = (label: string, value: string, cor: string) => (
    <div style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 9, padding: "7px 8px" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 11.5, fontWeight: 800, color: cor, marginTop: 2 }}>{value}</div>
    </div>
  );
  const limparAud = () => { setAStatus(""); setAModal(""); setATipo(""); setASit(""); setAMes(""); };
  const navAudMes = (delta: number) => { const cur = aMes || hojeISO().slice(0, 7); const d = new Date(cur + "-01T12:00:00"); d.setMonth(d.getMonth() + delta); setAMes(d.toISOString().slice(0, 7)); };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#f5f7fb" }}>
      <style>{`
        .jpr-fi{width:100%;height:40px;border:1px solid #cbd5e1;border-radius:9px;padding:0 11px;font-size:13px;background:#fff;box-sizing:border-box}
        textarea.jpr-fi{height:auto;padding:9px 11px;resize:vertical}
        .jpr-fi:focus{outline:none;border-color:#0f3171;box-shadow:0 0 0 3px rgba(15,49,113,.1)}
        .jpr-fg label{display:block;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}
        .jpr-btn{border:none;border-radius:9px;font-weight:700;cursor:pointer;font-size:12px;padding:8px 14px}
        .jpr-ov{position:fixed;inset:0;z-index:700;background:rgba(15,23,42,.45);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px}
        .jpr-modal{background:#fff;border-radius:16px;padding:22px;width:100%;max-width:780px;max-height:94vh;overflow-y:auto;position:relative;box-shadow:0 16px 40px rgba(15,23,42,.18)}
        .jpr-grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        @media(max-width:760px){.jpr-grid2{grid-template-columns:1fr}}
        .jpr-filtros{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 12px}
        @media(max-width:1100px){.jpr-filtros{grid-template-columns:repeat(2,1fr)}}
        @media(max-width:620px){.jpr-filtros{grid-template-columns:1fr}}
        .jpr-aud{border:1px solid #eef2f7;border-radius:10px;padding:10px;margin-bottom:8px;background:#fbfdff}
        .jpr-aud-l{display:grid;grid-template-columns:1.1fr .8fr 1fr 1fr auto;gap:6px;align-items:center}
        @media(max-width:760px){.jpr-aud-l{grid-template-columns:1fr 1fr}}
        .jpr-prop{display:grid;grid-template-columns:150px 1fr auto;gap:6px;align-items:center;margin-top:6px}
        @media(max-width:760px){.jpr-prop{grid-template-columns:1fr}}
        .jaud-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
        .jaud-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px;box-shadow:0 8px 24px rgba(15,23,42,.05);display:flex;flex-direction:column}
        .jaud-badge{font-size:9.5px;font-weight:800;padding:2px 8px;border-radius:20px;letter-spacing:.3px;white-space:nowrap}
        .jaud-2{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
        .jaud-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:7px}
      `}</style>

      {/* Topbar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 22px", margin: "18px 24px 0", border: "1px solid #e2e8f0", borderRadius: 16, background: "linear-gradient(135deg,#fff,#f8fbff)", boxShadow: "0 8px 24px rgba(15,23,42,.06)", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#0f3171" }}>{TITULOS[view]}</div>
        {/* "+ Novo Processo" mora no cabeçalho da barra de filtros, junto de "Limpar filtros". */}
        {view === "audiencias" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "#15803d", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 20, padding: "5px 11px" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />Ao vivo</span>
            <button className="jpr-btn" onClick={() => load()} style={{ background: "#0f3171", color: "#fff" }}>↻ Atualizar</button>
            <button className="jpr-btn" onClick={() => setAudAjuda(v => !v)} style={{ background: "#eef4ff", color: "#0f3171" }}>❔ Como Usar</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px 28px" }}>
        {erro && <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 12, padding: "10px 14px", fontSize: 12.5, marginBottom: 14 }}>Não foi possível carregar os processos: {erro}. Verifique se as tabelas foram migradas e o RLS aplicado (migration 20260622000015).</div>}
        {loading ? <div style={{ padding: 60, textAlign: "center", color: "#94a3b8" }}>Carregando…</div> : (<>

          {/* ── DASHBOARD ── */}
          {view === "dashboard" && (<>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              {kpi("Processos únicos", resumo.processos, "#0f3171", "Total cadastrado")}
              {kpi("Total acordos", moneyShort(resumo.acordos), "#dc2626", "Soma dos acordos")}
              {kpi("Total sentenças", moneyShort(resumo.sentencas), "#2563eb", "Condenações")}
              {kpi("Custo total final", moneyShort(resumo.final), "#15803d", "Valores finais")}
              {kpi("Em andamento", resumo.em_andamento, "#a78bfa", "Processos ativos")}
              {kpi("Valor causa RT", moneyShort(resumo.causa_rt), "#eab308", "RT Geral")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginBottom: 16 }} className="jpr-grid2">
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Gasto por Motivo</div>
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 10 }}>Top 10 — soma geral de todos os valores por motivo</div>
                {porMotivo.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 30, textAlign: "center" }}>Sem dados.</div> : (
                  <ResponsiveContainer width="100%" height={Math.max(220, porMotivo.length * 34)}>
                    <BarChart data={porMotivo} layout="vertical" margin={{ left: 10, right: 20 }}>
                      <CartesianGrid horizontal={false} stroke="#eef2f7" />
                      <XAxis type="number" tickFormatter={(v) => moneyShort(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                      <YAxis type="category" dataKey="motivo" width={150} tick={{ fontSize: 10.5, fill: "#475569" }} />
                      <Tooltip formatter={(v: any) => money(Number(v))} />
                      <Bar dataKey="total" fill="#f97316" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Por Empresa (Reclamada)</div>
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 10 }}>Quantidade de processos por empresa</div>
                {porReclamada.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 30, textAlign: "center" }}>Sem dados.</div> : (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={porReclamada} dataKey="num" nameKey="empresa" innerRadius={62} outerRadius={95} paddingAngle={2}>
                        {porReclamada.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => `${v} processo(s)`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Evolução por Ano</div>
              <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 10 }}>Valor pedido × acordo × custo final</div>
              {porAno.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 30, textAlign: "center" }}>Sem dados.</div> : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={porAno} margin={{ left: 10, right: 10 }}>
                    <CartesianGrid vertical={false} stroke="#eef2f7" />
                    <XAxis dataKey="ano" tick={{ fontSize: 11, fill: "#475569" }} />
                    <YAxis tickFormatter={(v) => moneyShort(v)} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                    <Tooltip formatter={(v: any) => money(Number(v))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="pedidos" name="Pedidos" fill="#0f3171" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="acordos" name="Acordos" fill="#dc2626" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="total" name="Custo final" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            {/* Audiências */}
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16, marginTop: 16 }} className="jpr-grid2">
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Audiências por mês</div>
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 10 }}>Agenda futura — quantidade por mês</div>
                {audPorMes.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 30, textAlign: "center" }}>Sem audiências futuras.</div> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={audPorMes} margin={{ left: 10, right: 10 }}>
                      <CartesianGrid vertical={false} stroke="#eef2f7" />
                      <XAxis dataKey="mes" tick={{ fontSize: 10.5, fill: "#475569" }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                      <Tooltip formatter={(v: any) => [`${v} audiência(s)`, "Total"]} />
                      <Bar dataKey="audiencias" name="Audiências" fill="#2563eb" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={card}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Audiências por tipo</div>
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 10 }}>Agenda futura — distribuição por tipo</div>
                {audPorTipo.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 13, padding: 30, textAlign: "center" }}>Sem audiências futuras.</div> : (
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie data={audPorTipo} dataKey="n" nameKey="tipo" innerRadius={55} outerRadius={88} paddingAngle={2}>
                        {audPorTipo.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: any) => `${v} audiência(s)`} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </>)}

          {/* ── PROCESSOS ── */}
          {view === "processos" && (<>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              {kpi("Processos cadastrados", processos.length, "#0f3171", "Base consolidada por número do processo")}
              {kpi("Resultados filtrados", filtrados.length, "#2563eb", "Quantidade retornada com os filtros atuais")}
              {kpi("Motivos no recorte", motivosNoRecorte, "#7c3aed", "Soma dos motivos vinculados aos processos exibidos")}
              {kpi("Status predominante", statusPredominante, "#b45309", "Leitura rápida do conjunto filtrado")}
            </div>
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Consulta de processos</div>
                  <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2, maxWidth: 620, lineHeight: 1.45 }}>Filtre por nº sequencial, número do processo, partes, motivo, status e ano. O cadastro continua consolidando números duplicados em um único registro, com os motivos e valores separados por linha.</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {filtrosAtivos > 0 && <button className="jpr-btn" onClick={limparProc} style={{ background: "#f1f5f9", color: "#475569" }}>Limpar filtros</button>}
                  <button className="jpr-btn" onClick={abrirNovo} style={{ background: "#0f3171", color: "#fff" }}>+ Novo Processo</button>
                </div>
              </div>
              <div className="jpr-filtros jpr-fg">
                <div><label>Nº sequencial</label><input className="jpr-fi" inputMode="numeric" placeholder="Ex.: 12" value={fId} onChange={e => setFId(e.target.value.replace(/\D/g, ""))} /></div>
                <div><label>Nº processo</label><input className="jpr-fi" placeholder="0000000-00.0000.0.00.0000" value={fNumero} onChange={e => setFNumero(e.target.value)} /></div>
                <div><label>Reclamante</label><input className="jpr-fi" placeholder="Nome do reclamante" value={fReclamante} onChange={e => setFReclamante(e.target.value)} /></div>
                <div><label>Reclamada</label><input className="jpr-fi" list="jpr-reclamadas" placeholder="Empresa reclamada" value={fReclamada} onChange={e => setFReclamada(e.target.value)} /></div>
                <div><label>Motivo</label>
                  <select className="jpr-fi" value={fMotivo} onChange={e => setFMotivo(e.target.value)}>
                    <option value="">Todos os motivos</option>
                    {semMotivoCount > 0 && <option value="__SEM__">⚠️ Sem motivo · {semMotivoCount}</option>}
                    {motivosPredominantes.map(x => <option key={x.m} value={x.m}>{x.m} · {x.n}</option>)}
                  </select>
                </div>
                <div><label>Status</label>
                  <select className="jpr-fi" value={fStatus} onChange={e => setFStatus(e.target.value)}>
                    <option value="">Todos os status</option>{STATUS_OPC.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div><label>Ano</label>
                  <select className="jpr-fi" value={fAno} onChange={e => setFAno(e.target.value)}>
                    <option value="">Todos os anos</option>{anosDisponiveis.map(a => <option key={a} value={String(a)}>{a}</option>)}
                  </select>
                </div>
                <div><label>Busca geral</label><input className="jpr-fi" placeholder="Pesquisar em todos os campos" value={busca} onChange={e => setBusca(e.target.value)} /></div>
                <datalist id="jpr-reclamadas">{reclamadasDistintas.map(r => <option key={r} value={r} />)}</datalist>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10, fontSize: 11.5, color: "#94a3b8" }}>
                <span>{filtrosAtivos} filtro(s) ativo(s).</span>
                <span>Os motivos do formulário “Novo Processo” são carregados exclusivamente do banco de dados.</span>
              </div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, overflow: "hidden", boxShadow: "0 8px 24px rgba(15,23,42,.05)" }}>
              {filtrados.length === 0 ? <div style={{ padding: 46, textAlign: "center", color: "#94a3b8" }}>Nenhum processo encontrado.</div> : (<>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead><tr style={{ background: "#f8fafc", color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", textAlign: "left" }}>
                    <th style={{ padding: "10px 14px", width: 58 }}>Nº</th>
                    <th style={{ padding: "10px 14px" }}>Nº / Reclamante</th><th style={{ padding: "10px 14px" }}>Reclamada</th><th style={{ padding: "10px 14px" }}>Motivos</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Total pedido</th><th style={{ padding: "10px 14px", textAlign: "right" }}>Custo final</th><th style={{ padding: "10px 14px" }}>Status</th><th style={{ padding: "10px 14px", textAlign: "right" }}>Ações</th>
                  </tr></thead>
                  <tbody>{visiveis.map(p => { const sc = statusCor(p.status); return (
                    <tr key={p.numero_processo} style={{ borderTop: "1px solid #eef2f7" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 800, color: "#94a3b8", fontVariantNumeric: "tabular-nums" }}>{p.id_sequencial || "—"}</td>
                      <td style={{ padding: "10px 14px" }}><div style={{ fontWeight: 700, color: "#0f172a" }}>{p.reclamante || "—"}</div><div style={{ fontSize: 11.5, color: "#94a3b8" }}>{p.numero_processo}{p.ano_processo ? ` · ${p.ano_processo}` : ""}</div></td>
                      <td style={{ padding: "10px 14px", color: "#475569" }}>{p.reclamada || "—"}</td>
                      <td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11.5, color: "#0f172a" }}>{p.motivo_items[0]?.motivo || "—"}</span>{p.motivo_items.length > 1 && <span style={{ fontSize: 11, color: "#0f3171", fontWeight: 700 }}> +{p.motivo_items.length - 1}</span>}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", color: "#475569" }}>{money(p.valor_pedidos)}</td>
                      <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: "#0f172a" }}>{money(custoTotal(p))}</td>
                      <td style={{ padding: "10px 14px" }}><span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 20, background: sc.bg, color: sc.c }}>{p.status}</span></td>
                      <td style={{ padding: "10px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                        <button className="jpr-btn" onClick={() => abrirDetalhe(p)} style={{ background: "#eef4ff", color: "#0f3171", marginRight: 5 }}>Ver</button>
                        <button className="jpr-btn" onClick={() => abrirEditar(p)} style={{ background: "#f1f5f9", color: "#475569", marginRight: 5 }}>Editar</button>
                        <button className="jpr-btn" onClick={() => excluir(p)} style={{ background: "none", color: "#dc2626" }}>Excluir</button>
                      </td>
                    </tr>
                  ); })}</tbody>
                </table>
                {totalPaginas > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: "1px solid #eef2f7", fontSize: 12.5, color: "#475569", flexWrap: "wrap", gap: 8 }}>
                    <span>Mostrando {(paginaAtual - 1) * PAGE_SIZE + 1}–{Math.min(paginaAtual * PAGE_SIZE, filtrados.length)} de {filtrados.length}</span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button className="jpr-btn" onClick={() => setPagina(p => Math.max(1, p - 1))} disabled={paginaAtual <= 1} style={{ background: paginaAtual <= 1 ? "#f1f5f9" : "#eef4ff", color: paginaAtual <= 1 ? "#cbd5e1" : "#0f3171", cursor: paginaAtual <= 1 ? "default" : "pointer" }}>← Anterior</button>
                      <span style={{ fontWeight: 700 }}>Página {paginaAtual} de {totalPaginas}</span>
                      <button className="jpr-btn" onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))} disabled={paginaAtual >= totalPaginas} style={{ background: paginaAtual >= totalPaginas ? "#f1f5f9" : "#eef4ff", color: paginaAtual >= totalPaginas ? "#cbd5e1" : "#0f3171", cursor: paginaAtual >= totalPaginas ? "default" : "pointer" }}>Próxima →</button>
                    </span>
                  </div>
                )}
              </>)}
            </div>
          </>)}

          {/* ── AUDIÊNCIAS ── */}
          {view === "audiencias" && (<>
            {audAjuda && (
              <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", borderRadius: 12, padding: "12px 16px", fontSize: 12.5, marginBottom: 16, lineHeight: 1.5 }}>
                <b>Como usar:</b> cada card é uma audiência da agenda. Use os filtros (status, modalidade, tipo e situação) para recortar; <b>Audiência em andamento</b> mostra as de hoje em diante e <b>Já passou</b> as vencidas. Clique em <b>Abrir processo</b> para ver motivos, valores e comentários.
              </div>
            )}

            {/* indicadores */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              {kpi("Total na agenda", audStats.total, "#0f3171", "Processos com 1ª audiência e/ou de instrução")}
              {kpi("Em andamento", audStats.fut, "#2563eb", "Possuem audiência hoje ou futura")}
              {kpi("Já passaram", audStats.past, "#64748b", "Datas de audiência já vencidas")}
            </div>

            {/* barra de filtros */}
            <div style={{ ...card, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>Audiências — agenda jurídica</div>
                  <div style={{ fontSize: 11.5, color: "#94a3b8", marginTop: 2, maxWidth: 560 }}>Aparecem apenas processos com data de 1ª audiência e/ou audiência de instrução, em formato de cards de acompanhamento.</div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select className="jpr-fi" style={{ maxWidth: 175 }} value={aStatus} onChange={e => setAStatus(e.target.value)}>
                    <option value="">Todos os status</option>{STATUS_OPC.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select className="jpr-fi" style={{ maxWidth: 165 }} value={aModal} onChange={e => setAModal(e.target.value)}>
                    <option value="">Presencial ou Online</option><option value="Presencial">Presencial</option><option value="Online">Online</option>
                  </select>
                  <select className="jpr-fi" style={{ maxWidth: 205 }} value={aTipo} onChange={e => setATipo(e.target.value)}>
                    <option value="">Todos os tipos de audiência</option>{audTipos.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select className="jpr-fi" style={{ maxWidth: 185 }} value={aSit} onChange={e => setASit(e.target.value)}>
                    <option value="">Todas as situações</option><option value="fut">Audiência em andamento</option><option value="past">Já passou</option>
                  </select>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button className="jpr-btn" onClick={() => navAudMes(-1)} title="Mês anterior" style={{ background: "#eef4ff", color: "#0f3171", padding: "8px 11px" }}>‹</button>
                    <select className="jpr-fi" style={{ maxWidth: 150 }} value={aMes} onChange={e => setAMes(e.target.value)}>
                      <option value="">Todos os meses</option>
                      {audMesesOpts.map(m => { const [y, mm] = m.split("-"); return <option key={m} value={m}>{["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][+mm - 1]}/{y}</option>; })}
                    </select>
                    <button className="jpr-btn" onClick={() => navAudMes(1)} title="Próximo mês" style={{ background: "#eef4ff", color: "#0f3171", padding: "8px 11px" }}>›</button>
                  </div>
                  {(aStatus || aModal || aTipo || aSit || aMes) && <button className="jpr-btn" onClick={limparAud} style={{ background: "#f1f5f9", color: "#475569" }}>Limpar filtros</button>}
                </div>
              </div>
            </div>

            {/* grid de cards */}
            {audFiltradas.length === 0 ? (
              <div style={{ ...card, padding: 46, textAlign: "center", color: "#94a3b8" }}>Nenhuma audiência encontrada.</div>
            ) : (
              <div className="jaud-grid">
                {audFiltradas.map((a, i) => { const p = a.p as Processo; return (
                  <div key={i} className="jaud-card" style={{ borderLeft: `4px solid ${a.futuro ? "#2563eb" : "#cbd5e1"}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 800, color: "#0f172a", fontSize: 13.5, lineHeight: 1.25 }}>{p.reclamante || "—"}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Processo {p.numero_processo}</div>
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                        {a.modalidade && <span className="jaud-badge" style={{ background: "#e0ecff", color: "#1d4ed8" }}>{String(a.modalidade).toUpperCase()}</span>}
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: a.futuro ? "#eff6ff" : "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 9, padding: "9px 12px", margin: "10px 0" }}>
                      <span style={{ fontSize: 11, fontWeight: 800, color: a.futuro ? "#1d4ed8" : "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px" }}>{a.tipo || "Audiência"}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 800, color: a.futuro ? "#0f3171" : "#94a3b8" }}>{fmtDt(a.data)}{a.horario ? ` · ${a.horario}` : ""}</span>
                    </div>
                    <div className="jaud-2">{fld("Comarca", p.comarca || p.municipio_origem || "—")}{fld("Modalidade", a.modalidade || "—")}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
                      <span style={{ fontSize: 10.5, color: "#cbd5e1", fontWeight: 700 }}>Nº {p.id_sequencial || "—"}</span>
                      <button className="jpr-btn" onClick={() => abrirDetalhe(p)} style={{ background: "#eef4ff", color: "#0f3171" }}>Abrir processo</button>
                    </div>
                  </div>
                ); })}
              </div>
            )}
          </>)}
        </>)}
      </div>

      {/* ── Detalhe ──
          Fecha SÓ no ✕. O clique no fundo saiu de propósito: com ele, um
          clique que caísse fora do cartão derrubava o processo aberto — e
          havia como isso acontecer sem o usuário mirar no fundo (ver a nota
          no modal de cadastro, abaixo). */}
      {sel && (
        <div className="jpr-ov">
          <div className="jpr-modal">
            <button onClick={() => setSel(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>{sel.id_sequencial ? `#${sel.id_sequencial} · ` : ""}{sel.numero_processo}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{sel.reclamante || "—"}</div>
            <div style={{ fontSize: 12.5, color: "#475569", marginTop: 2 }}>Reclamada: <b>{sel.reclamada || "—"}</b>{sel.comarca ? ` · ${sel.comarca}` : ""}{sel.ano_processo ? ` · ${sel.ano_processo}` : ""}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px" }}>Status do processo:</span>
              {(() => { const sc = statusCor(sel.status); return <span style={{ fontSize: 12.5, fontWeight: 800, padding: "4px 13px", borderRadius: 20, background: sc.bg, color: sc.c }}>{sel.status}</span>; })()}
              {sel.status_sentenca && <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>Sentença: {sel.status_sentenca}</span>}
              {sel.status_recursos && <span style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 11px", borderRadius: 20, background: "#ecfeff", color: "#0e7490" }}>Recurso: {sel.status_recursos}</span>}
            </div>
            {sel.reclamante_vinculado_cpf
              ? <div style={{ marginTop: 8 }}><button className="jpr-btn" onClick={() => verDetalhesReclamante(sel.reclamante_vinculado_cpf)} style={{ background: "#eef4ff", color: "#0f3171" }}>👤 Todos os detalhes do reclamante</button></div>
              : <div style={{ marginTop: 8, fontSize: 11.5, color: "#94a3b8" }}>Reclamante não vinculado a um cadastro. Use “Editar” para vincular.</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
              {[["Pedidos", sel.valor_pedidos, "#ea580c"], ["Acordo", sel.valor_acordo, "#dc2626"], ["Sentença", sel.valor_sentenca, "#2563eb"], ["Custo final", custoTotal(sel), "#15803d"]].map(([l, v, c]: any) => (
                <div key={l} style={{ flex: 1, minWidth: 120, background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "8px 11px" }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>{l}</div><div style={{ fontSize: 14, fontWeight: 800, color: c }}>{money(v)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Motivos ({sel.motivo_items.length})</div>
            <div style={{ border: "1px solid #eef2f7", borderRadius: 10, overflow: "hidden", marginBottom: 14 }}>
              {sel.motivo_items.map((m, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 11px", borderTop: i ? "1px solid #f1f5f9" : "none" }}><span style={{ fontSize: 12.5, color: "#0f172a" }}>{m.motivo}</span><span style={{ fontSize: 12, fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>{money(motivoTotal(m))}</span></div>))}
            </div>
            {sel.audiencias.length > 0 && (<>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Audiências</div>
              <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 7 }}>{sel.audiencias.map((a, i) => (
                <div key={i}>
                  <div style={{ fontSize: 12.5, color: "#334155" }}>📅 <b>{fmtDt(a.data)}</b>{a.horario ? ` · ${a.horario}` : ""} — {a.tipo_audiencia || "Audiência"}{a.modalidade_audiencia ? ` (${a.modalidade_audiencia})` : ""}</div>
                  {(a.propostas || []).length > 0 && (
                    <div style={{ marginTop: 4, marginLeft: 18, display: "flex", flexDirection: "column", gap: 3 }}>
                      {(a.propostas || []).map((pr, j) => <LinhaProposta key={j} pr={pr} />)}
                    </div>
                  )}
                </div>
              ))}</div>
            </>)}

            {sel.propostas.length > 0 && (<>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Propostas no decorrer do processo</div>
              <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 4 }}>
                {sel.propostas.map((pr, j) => <LinhaProposta key={j} pr={pr} comData />)}
              </div>
            </>)}

            {sel.vai_recorrer === "Sim" && (<>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Recurso</div>
              <div style={{ marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {[["Custas recursais", sel.valor_custas_recursais], ["Seguro garantia", sel.valor_seguro_garantia], ["Depósito recursal", sel.valor_deposito_recursal]].map(([l, v]: any) => (
                  <div key={l} style={{ flex: 1, minWidth: 130, background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "8px 11px" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>{l}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 800, color: "#0f172a" }}>{money(v)}</div>
                  </div>
                ))}
              </div>
            </>)}

            {(sel.data_pericia || sel.hora_pericia || sel.local_pericia || sel.havera_pericia === "Sim" || sel.houve_pericia_medica === "Sim") && (<>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Perícia</div>
              <div style={{ marginBottom: 14, fontSize: 12.5, color: "#334155" }}>
                <div>🔬 <b>{sel.data_pericia ? fmtDt(sel.data_pericia) : "Data a definir"}</b>{sel.hora_pericia ? ` · ${sel.hora_pericia.slice(0, 5)}` : ""}</div>
                {sel.local_pericia && <div style={{ marginTop: 3, marginLeft: 18, color: "#475569" }}>📍 {sel.local_pericia}</div>}
                {sel.houve_pericia_medica === "Sim" && (
                  <div style={{ marginTop: 6, marginLeft: 18, display: "flex", gap: 14, flexWrap: "wrap", color: "#475569" }}>
                    <span>🩺 Perito judicial <b style={{ color: "#0f172a" }}>{money(sel.valor_perito_judicial)}</b></span>
                    <span>Assistente técnico/médico <b style={{ color: "#0f172a" }}>{money(sel.valor_assistente_tecnico)}</b></span>
                  </div>
                )}
              </div>
            </>)}
            <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 6 }}>Comentários</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <input className="jpr-fi" placeholder="Escreva um comentário…" value={novoComent} onChange={e => setNovoComent(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addComent(); }} />
              <button className="jpr-btn" onClick={addComent} disabled={!novoComent.trim()} style={{ background: novoComent.trim() ? "#0f3171" : "#cbd5e1", color: "#fff", whiteSpace: "nowrap" }}>Comentar</button>
            </div>
            {coments.length === 0 ? <div style={{ color: "#94a3b8", fontSize: 12.5, padding: "6px 0" }}>Sem comentários.</div> : coments.map(c => (
              <div key={c.id} style={{ background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 10, padding: "9px 12px", marginBottom: 7 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: "#0f3171" }}>{c.autor_nome || "Usuário"}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ fontSize: 11, color: "#94a3b8" }}>{fmtDt(c.created_at)}</span><button onClick={() => delComent(c)} style={{ border: "none", background: "none", color: "#dc2626", cursor: "pointer", fontSize: 11, fontWeight: 700 }}>excluir</button></span>
                </div>
                <div style={{ fontSize: 13, color: "#0f172a", whiteSpace: "pre-wrap" }}>{c.texto}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modal Criar/Editar ──
          Fecha SÓ no ✕ (ou em Cancelar, embaixo). O clique no fundo fechava um
          formulário inteiro sem confirmar nada — e não era preciso mirar no
          fundo para disparar: no "➕ Criar novo motivo…" o valor é digitado num
          window.prompt, e o clique no OK do navegador chega à página depois que
          a lista de opções já fechou, caindo sobre o fundo do modal. Resultado:
          digitar o motivo novo derrubava o cadastro com tudo que já havia sido
          preenchido. Sem o handler, não há como. */}
      {modal && (
        <div className="jpr-ov">
          <div className="jpr-modal">
            <button onClick={() => setModal(false)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 14 }}>{editNumero ? "Editar processo" : "Novo processo"}</div>
            <div className="jpr-grid2">
              <div className="jpr-fg"><label>Nº do processo *</label><input className="jpr-fi" value={form.numero_processo} onChange={e => setForm(v => ({ ...v, numero_processo: e.target.value }))} placeholder="0000000-00.0000.5.00.0000" /></div>
              <div className="jpr-fg"><label>Status</label><select className="jpr-fi" value={form.status} onChange={e => setForm(v => ({ ...v, status: e.target.value }))}>{STATUS_OPC.map(s => <option key={s}>{s}</option>)}</select></div>
              <div className="jpr-fg"><label>Reclamante *</label><input className="jpr-fi" value={form.reclamante} onChange={e => setForm(v => ({ ...v, reclamante: e.target.value }))} /></div>
              <div className="jpr-fg"><label>Reclamada</label><input className="jpr-fi" list="jpr-reclamadas-form" value={form.reclamada} onChange={e => setForm(v => ({ ...v, reclamada: e.target.value }))} placeholder="Empresa" /><datalist id="jpr-reclamadas-form">{reclamadasDistintas.map(r => <option key={r} value={r} />)}</datalist></div>
              <div className="jpr-fg"><label>Comarca</label><input className="jpr-fi" value={form.comarca} onChange={e => setForm(v => ({ ...v, comarca: e.target.value }))} /></div>
              <div className="jpr-fg">
                <label>Município de origem *</label>
                {/* A cidade do contrato. Vem preenchida quando dá para tirá-la
                    do nome do contrato; quando não dá, fica em branco e o
                    Salvar cobra — em branco é o estado que ninguém corrige. */}
                <input className="jpr-fi" value={form.municipio_origem} onChange={e => setMunicipio(e.target.value)} placeholder="Cidade do contrato" />
                {sugestaoMunicipio && sugestaoMunicipio !== form.municipio_origem && (
                  <button type="button" className="jpr-btn" onClick={() => setForm(v => ({ ...v, municipio_origem: sugestaoMunicipio }))}
                    style={{ background: "#eef4ff", color: "#0f3171", padding: "4px 9px", marginTop: 4, fontSize: 11 }}>
                    Usar “{sugestaoMunicipio}”
                  </button>
                )}
              </div>
              <div className="jpr-fg"><label>Data de entrada</label><input className="jpr-fi" type="date" value={form.data_entrada_reclamatoria} onChange={e => setForm(v => ({ ...v, data_entrada_reclamatoria: e.target.value }))} /></div>
              <div className="jpr-fg">
                <label>Contrato</label>
                {/* Select-only: o contrato TEM que existir na CONTRATOS. Deixar
                    digitar livre traria de volta o problema que estamos
                    consertando — texto que não corresponde a contrato nenhum.
                    Se o valor salvo não estiver mais na lista de ativos, entra
                    como opção mesmo assim, senão editar o processo o apagaria. */}
                <div style={{ display: "flex" }}>
                  <ComboSelect
                    value={form.contrato}
                    options={form.contrato && !contratosNomes.includes(form.contrato) ? [form.contrato, ...contratosNomes] : contratosNomes}
                    onChange={escolherContrato}
                    placeholder="Selecione o contrato…"
                    vazio="Nenhum contrato encontrado."
                    limpavel
                  />
                </div>
                {sugestaoContrato && sugestaoContrato !== form.contrato && (
                  <button type="button" className="jpr-btn" onClick={() => { contratoManual.current = false; setForm(v => ({ ...v, contrato: sugestaoContrato })); }}
                    style={{ background: "#eef4ff", color: "#0f3171", padding: "4px 9px", marginTop: 4, fontSize: 11 }}>
                    Usar “{sugestaoContrato}”
                  </button>
                )}
              </div>
            </div>

            {/* Dados jurídicos do processo */}
            <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", margin: "10px 0 6px" }}>Dados jurídicos</div>
            <div className="jpr-grid2">
              <div className="jpr-fg"><label>Status da sentença</label><select className="jpr-fi" value={form.status_sentenca} onChange={e => setForm(v => ({ ...v, status_sentenca: e.target.value }))}>{STATUS_SENTENCA_OPC.map(s => <option key={s} value={s}>{s || "— Selecione —"}</option>)}</select></div>
              <div className="jpr-fg"><label>Status do recurso</label><select className="jpr-fi" value={form.status_recursos} onChange={e => setForm(v => ({ ...v, status_recursos: e.target.value }))}>{STATUS_RECURSO_OPC.map(s => <option key={s} value={s}>{s || "— Selecione —"}</option>)}</select></div>
              <div className="jpr-fg"><label>Houve acordo?</label><select className="jpr-fi" value={form.houve_acordo} onChange={e => setForm(v => ({ ...v, houve_acordo: e.target.value }))}><option>Não</option><option>Sim</option></select></div>
              {form.houve_acordo === "Sim" && <div className="jpr-fg"><label>Motivo do acordo</label><input className="jpr-fi" value={form.motivo_acordo} onChange={e => setForm(v => ({ ...v, motivo_acordo: e.target.value }))} placeholder="Ex.: Valor do acordo baixo" /></div>}
              <div className="jpr-fg"><label>Haverá perícia?</label><select className="jpr-fi" value={form.havera_pericia} onChange={e => setForm(v => ({ ...v, havera_pericia: e.target.value }))}><option>Não</option><option>Sim</option></select></div>
              <div className="jpr-fg"><label>Motivo de outros custos</label><input className="jpr-fi" value={form.motivos_outros_custos} onChange={e => setForm(v => ({ ...v, motivos_outros_custos: e.target.value }))} placeholder="Ex.: Honorários" /></div>
            </div>

            {/* Agendamento da perícia. Aparece com "Haverá perícia? = Sim" e
                também quando o processo já traz esses dados (a carga do sistema
                antigo veio com perícia marcada e o "Haverá perícia?" em branco):
                escondê-los deixaria a data agendada invisível na tela. */}
            {temPericia && (<>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", margin: "10px 0 6px" }}>Perícia</div>
              <div className="jpr-grid2">
                <div className="jpr-fg"><label>Data da perícia</label><input className="jpr-fi" type="date" value={form.data_pericia} onChange={e => setForm(v => ({ ...v, data_pericia: e.target.value }))} /></div>
                <div className="jpr-fg"><label>Horário da perícia</label><input className="jpr-fi" type="time" value={form.hora_pericia} onChange={e => setForm(v => ({ ...v, hora_pericia: e.target.value }))} /></div>
              </div>
              {/* Textarea porque o local vem como endereço inteiro, com ponto de
                  encontro junto ("…Rua Felizardo, 750 — recepção principal"). */}
              <div className="jpr-fg"><label>Local da perícia</label><textarea className="jpr-fi" rows={2} style={{ resize: "vertical" }} value={form.local_pericia} onChange={e => setForm(v => ({ ...v, local_pericia: e.target.value }))} placeholder="Endereço e ponto de encontro" /></div>

              {/* Perícia médica: os honorários só aparecem com "Sim", porque
                  perícia contábil/de engenharia não tem perito médico nem
                  assistente técnico, e campo de dinheiro à toa acaba preenchido. */}
              <div className="jpr-grid2">
                <div className="jpr-fg">
                  <label>Houve perícia médica?</label>
                  <select className="jpr-fi" value={form.houve_pericia_medica} onChange={e => setForm(v => ({ ...v, houve_pericia_medica: e.target.value }))}>
                    {["Não", "Sim"].map(o => <option key={o}>{o}</option>)}
                  </select>
                </div>
              </div>
              {form.houve_pericia_medica === "Sim" && (
                <div className="jpr-grid2">
                  <div className="jpr-fg">
                    <label>Perito judicial (R$)</label>
                    <MoedaInput value={form.valor_perito_judicial} onChange={n => setForm(v => ({ ...v, valor_perito_judicial: n }))} />
                  </div>
                  <div className="jpr-fg">
                    <label>Assistente técnico/médico (R$)</label>
                    <MoedaInput value={form.valor_assistente_tecnico} onChange={n => setForm(v => ({ ...v, valor_assistente_tecnico: n }))} />
                  </div>
                </div>
              )}
            </>)}

            {/* ── Recurso da condenação ── */}
            <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px", margin: "10px 0 6px" }}>Recurso</div>
            <div className="jpr-grid2">
              <div className="jpr-fg">
                <label>A empresa vai recorrer?</label>
                <select className="jpr-fi" value={form.vai_recorrer} onChange={e => setForm(v => ({ ...v, vai_recorrer: e.target.value }))}>
                  {["Não", "Sim"].map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
            </div>
            {form.vai_recorrer === "Sim" && (<>
              <div className="jpr-grid2">
                <div className="jpr-fg">
                  <label>Custas recursais (R$)</label>
                  <MoedaInput value={form.valor_custas_recursais} onChange={n => setForm(v => ({ ...v, valor_custas_recursais: n }))} />
                </div>
                <div className="jpr-fg">
                  <label>Seguro garantia (R$)</label>
                  <MoedaInput value={form.valor_seguro_garantia} onChange={n => setForm(v => ({ ...v, valor_seguro_garantia: n }))} />
                </div>
              </div>
              {/* Depósito recursal é lançado por motivo, lá embaixo. Aqui vai só
                  o total, em leitura: dois campos editáveis para o mesmo dinheiro
                  entrariam duas vezes no custo final. */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: "#f8fafc", border: "1px solid #eef2f7", borderRadius: 9, padding: "8px 11px" }}>
                <span style={{ fontSize: 11.5, color: "#64748b" }}>
                  Depósito recursal <b style={{ color: "#0f172a" }}>{money(depositoRecursalTotal)}</b>
                </span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>lançado por motivo, em “Motivos e valores”</span>
              </div>
            </>)}

            {/* Vínculo do reclamante com EMPREGADOS */}
            <div style={{ border: "1px solid #e6eefc", background: "#f8fbff", borderRadius: 10, padding: 12, margin: "10px 0 6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, gap: 8, flexWrap: "wrap" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>Vincular reclamante ao cadastro (EMPREGADOS)</div>
                {form.reclamante_vinculado_cpf && <button className="jpr-btn" onClick={() => verDetalhesReclamante(form.reclamante_vinculado_cpf)} style={{ background: "#eef4ff", color: "#0f3171", padding: "5px 10px" }}>👤 Todos os detalhes</button>}
              </div>
              {form.reclamante_vinculado_cpf ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#15803d", background: "#dcfce7", border: "1px solid #bbf7d0", borderRadius: 20, padding: "4px 11px" }}>✓ Vinculado · CPF {form.reclamante_vinculado_cpf}</span>
                  <button className="jpr-btn" onClick={desvincular} style={{ background: "none", color: "#dc2626" }}>Desvincular</button>
                </div>
              ) : (<>
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="jpr-fi" placeholder="Buscar por nome no cadastro (mesmo grafado diferente)…" value={empBusca} onChange={e => setEmpBusca(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); buscarEmpregados(empBusca || form.reclamante); } }} />
                  <button className="jpr-btn" onClick={() => buscarEmpregados(empBusca || form.reclamante)} style={{ background: "#0f3171", color: "#fff", whiteSpace: "nowrap" }}>Buscar</button>
                </div>
                {empLoading && <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 2px" }}>Buscando…</div>}
                {!empLoading && empResultados.length > 0 && (
                  <div style={{ marginTop: 8, maxHeight: 210, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 9, background: "#fff" }}>
                    {empResultados.map((e, i) => { const cpf = e["CPF"]; const k = cpf || String(i); const on = empSelKey === k; return (
                      <div key={k} onClick={() => setEmpSelKey(k)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 11px", borderTop: i ? "1px solid #f1f5f9" : "none", cursor: "pointer", background: on ? "#eff6ff" : "#fff" }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{e["Nome"]}</div>
                          {/* Contrato (Nome Filial) e posto (Descrição do Local)
                              lado a lado: é o contrato que vai para o processo,
                              e ver os dois evita confundir um com o outro. */}
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
                            CPF {cpf || "—"} · {e["Situação"] || "—"}
                            {e["Nome Filial"] ? <> · contrato: <b style={{ color: "#64748b" }}>{e["Nome Filial"]}</b></> : ""}
                            {e["Descrição do Local"] ? ` · posto: ${e["Descrição do Local"]}` : ""}
                          </div>
                        </div>
                        {on && <button className="jpr-btn" onClick={ev => { ev.stopPropagation(); confirmarVinculo(e); }} style={{ background: "#15803d", color: "#fff", whiteSpace: "nowrap" }}>Confirmar vínculo</button>}
                      </div>
                    ); })}
                  </div>
                )}
                {!empLoading && empBusca && empResultados.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8", padding: "8px 2px" }}>Nenhum colaborador encontrado. Tente outro nome/sobrenome.</div>}
              </>)}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 6px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>Motivos e valores</div>
              <button className="jpr-btn" onClick={() => setMotivos(ms => [...ms, { ...MOTIVO_RESET(), ordem: ms.length + 1 }])} style={{ background: "#eef4ff", color: "#0f3171", padding: "5px 10px" }}>+ Motivo</button>
            </div>
            {motivos.map((m, i) => (
              <div key={i} style={{ border: "1px solid #eef2f7", borderRadius: 10, padding: 10, marginBottom: 8, background: "#fbfdff" }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <MotivoSelect value={m.motivo} options={motivosDistintos} onChange={v => setMotivo(i, { motivo: v })} />
                  {motivos.length > 1 && <button className="jpr-btn" onClick={() => setMotivos(ms => ms.filter((_, idx) => idx !== i))} style={{ background: "none", color: "#dc2626" }}>✕</button>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
                  {([["valor_pedidos", "Valor pedido"], ["valor_acordo", "Valor acordo"], ["valor_sentenca", "Valor sentença"], ["valor_final", "Valor final"], ["valor_outros_custos", "Outros custos"]] as const).map(([k, l]) => (
                    <div key={k}><label style={{ fontSize: 10, color: "#94a3b8", fontWeight: 700 }}>{l}</label><MoedaInput value={m[k] || 0} onChange={n => setMotivo(i, { [k]: n } as any)} /></div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0 6px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>Audiências</div>
              <button className="jpr-btn" onClick={() => setAuds(a => [...a, { ordem: a.length + 1, data: "", horario: "", tipo_audiencia: "Instrução", modalidade_audiencia: "Presencial", propostas: [] }])} style={{ background: "#eef4ff", color: "#0f3171", padding: "5px 10px" }}>+ Audiência</button>
            </div>
            {auds.map((a, i) => (
              <div key={i} className="jpr-aud">
                <div className="jpr-aud-l">
                  <input className="jpr-fi" type="date" value={a.data} onChange={e => setAud(i, { data: e.target.value })} />
                  <input className="jpr-fi" type="time" value={a.horario || ""} onChange={e => setAud(i, { horario: e.target.value })} />
                  <select className="jpr-fi" value={a.tipo_audiencia} onChange={e => setAud(i, { tipo_audiencia: e.target.value })}>{["Instrução", "Conciliação", "Una", "De instrução e julgamento"].map(o => <option key={o}>{o}</option>)}</select>
                  <select className="jpr-fi" value={a.modalidade_audiencia} onChange={e => setAud(i, { modalidade_audiencia: e.target.value })}>{["Presencial", "Online"].map(o => <option key={o}>{o}</option>)}</select>
                  <button className="jpr-btn" onClick={() => setAuds(x => x.filter((_, idx) => idx !== i))} style={{ background: "none", color: "#dc2626" }}>✕</button>
                </div>
                {/* Propostas feitas pelo juiz na audiência dessa data. */}
                <div style={{ borderTop: "1px dashed #e2e8f0", marginTop: 9, paddingTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: "#64748b", textTransform: "uppercase", letterSpacing: ".4px" }}>
                      Propostas {a.data ? `em ${fmtDt(a.data)}` : "nesta audiência"}
                    </span>
                    <button className="jpr-btn" onClick={() => addProposta(i)} style={{ background: "#eef4ff", color: "#0f3171", padding: "4px 9px" }}>+ Proposta</button>
                  </div>
                  {(a.propostas || []).length === 0
                    ? <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 5 }}>Nenhuma proposta registrada para esta data.</div>
                    : (a.propostas || []).map((pr, j) => (
                      <div key={j} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}>
                        <select className="jpr-fi" style={{ height: 34, width: 128 }} value={pr.quem} onChange={e => setProposta(i, j, { quem: e.target.value })}>
                          {PROPOSTA_QUEM.map(o => <option key={o}>{o}</option>)}
                        </select>
                        <select className="jpr-fi" style={{ height: 34, width: 138 }} value={pr.tipo} onChange={e => setProposta(i, j, { tipo: e.target.value })}>
                          {PROPOSTA_TIPOS.map(o => <option key={o}>{o}</option>)}
                        </select>
                        <MoedaInput value={pr.valor} onChange={n => setProposta(i, j, { valor: n })} />
                        <input className="jpr-fi" style={{ height: 34, flex: 1, minWidth: 160 }} placeholder="O que foi proposto nesta data" value={pr.descricao} onChange={e => setProposta(i, j, { descricao: e.target.value })} />
                        <button className="jpr-btn" onClick={() => delProposta(i, j)} style={{ background: "none", color: "#dc2626" }}>✕</button>
                      </div>
                    ))}
                </div>
              </div>
            ))}
            {/* Propostas que não saíram de audiência. Ficam fora do bloco de
                audiências de propósito: elas não têm audiência a que pertencer,
                e pendurá-las na mais próxima falsearia a data. */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "10px 0 6px" }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>Propostas no decorrer do processo</div>
              <button className="jpr-btn" onClick={addPropostaProc} style={{ background: "#eef4ff", color: "#0f3171", padding: "5px 10px" }}>+ Proposta</button>
            </div>
            {propostas.length === 0
              ? <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 6 }}>Nenhuma proposta fora de audiência. As feitas em audiência ficam na audiência correspondente, acima.</div>
              : propostas.map((pr, j) => (
                <div key={j} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                  <input className="jpr-fi" style={{ height: 34, width: 140 }} type="date" value={pr.data || ""} onChange={e => setPropostaProc(j, { data: e.target.value })} />
                  <select className="jpr-fi" style={{ height: 34, width: 128 }} value={pr.quem} onChange={e => setPropostaProc(j, { quem: e.target.value })}>
                    {PROPOSTA_QUEM.map(o => <option key={o}>{o}</option>)}
                  </select>
                  <select className="jpr-fi" style={{ height: 34, width: 138 }} value={pr.tipo} onChange={e => setPropostaProc(j, { tipo: e.target.value })}>
                    {PROPOSTA_TIPOS.map(o => <option key={o}>{o}</option>)}
                  </select>
                  <MoedaInput value={pr.valor} onChange={n => setPropostaProc(j, { valor: n })} />
                  <input className="jpr-fi" style={{ height: 34, flex: 1, minWidth: 160 }} placeholder="O que foi proposto" value={pr.descricao} onChange={e => setPropostaProc(j, { descricao: e.target.value })} />
                  <button className="jpr-btn" onClick={() => delPropostaProc(j)} style={{ background: "none", color: "#dc2626" }}>✕</button>
                </div>
              ))}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
              <button className="jpr-btn" onClick={() => setModal(false)} style={{ background: "#fff", border: "1px solid #e2e8f0", color: "#475569" }}>Cancelar</button>
              <button className="jpr-btn" onClick={salvar} style={{ background: "#0f3171", color: "#fff" }}>Salvar processo</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Detalhes do reclamante (EMPREGADOS) ── */}
      {detalheEmp && (
        <div className="jpr-ov" onClick={e => { if (e.target === e.currentTarget) setDetalheEmp(null); }}>
          <div className="jpr-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 620 }}>
            <button onClick={() => setDetalheEmp(null)} style={{ position: "absolute", top: 14, right: 16, border: "none", background: "none", fontSize: 20, color: "#94a3b8", cursor: "pointer" }}>✕</button>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#0f3171", textTransform: "uppercase", letterSpacing: ".4px" }}>Detalhes do reclamante</div>
            {detalheEmp._loading ? <div style={{ padding: 34, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
              : detalheEmp._vazio ? <div style={{ padding: 20, color: "#94a3b8", fontSize: 13 }}>Nenhum cadastro em EMPREGADOS com o CPF {detalheEmp.CPF}.</div>
              : (<>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>{detalheEmp["Nome"] || "—"}</div>
                <div style={{ fontSize: 12.5, color: "#475569", marginBottom: 12 }}>{detalheEmp["Título do Cargo"] || "—"}{detalheEmp["Nome da Empresa"] ? ` · ${detalheEmp["Nome da Empresa"]}` : ""}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {fld("CPF", detalheEmp["CPF"] || "—")}
                  {fld("PIS", detalheEmp["PIS"] || "—")}
                  {fld("Situação", detalheEmp["Situação"] || "—")}
                  {fld("Salário", (() => { const n = parseSalario(detalheEmp["Valor Salário"]); return n != null ? money(n) : "—"; })())}
                  {fld("Admissão", detalheEmp["Admissão"] || "—")}
                  {fld("Demissão / afastamento", detalheEmp["Data Afastamento"] || "—")}
                  {fld("Centro de custo", [detalheEmp["C.Custo"], detalheEmp["Titulo C.Custo"]].filter(Boolean).join(" · ") || "—")}
                  {fld("Município de origem (Descrição do Local)", detalheEmp["Descrição do Local"] || "—")}
                  {fld("Filial", detalheEmp["Nome Filial"] || "—")}
                </div>
              </>)}
          </div>
        </div>
      )}

      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
        {toasts.map(t => (<div key={t.id} style={{ padding: "10px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, boxShadow: "0 16px 40px rgba(15,23,42,.12)", background: t.t === "ok" ? "#ecfdf3" : t.t === "err" ? "#fef2f2" : "#eff6ff", color: t.t === "ok" ? "#15803d" : t.t === "err" ? "#b91c1c" : "#1d4ed8", border: `1px solid ${t.t === "ok" ? "#86efac" : t.t === "err" ? "#fecaca" : "#bfdbfe"}` }}>{t.msg}</div>))}
      </div>
    </div>
  );
}
