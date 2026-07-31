import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ehNivel, NIVEIS, carregaHierarquiaDados } from "./LideresSetor";

// =====================================================================
// NASCIMENTO FORMULÁRIOS - Ficha do empregado (a partir de um nome citado
// numa resposta). Puxa os dados AO VIVO da tabela EMPREGADOS (cadastro,
// líder) e cruza TODOS os formulários em que a pessoa participou - como
// respondente ou citada numa resposta (colaborador/líder).
//
// Escreve em dois pontos, ambos por ação explícita do usuário:
//   • CS_FORM_VINCULOS - de-para "nome citado" → empregado, p/ quem o nome
//     da resposta não bate com o cadastro (ex.: falta um sobrenome).
//   • EMPREGADOS.LIDER - define/troca o líder do colaborador.
// =====================================================================

// Normaliza nome p/ casar respostas (texto livre) com o cadastro:
// sem acento, espaços colapsados, maiúsculas.
export const normNome = (s: any) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

// De-para dos apelidos vinculados à mão: nome_norm → nome completo do empregado.
// A tela de Respostas usa p/ saber quais textos viram link de ficha e p/ exibir
// o nome do cadastro no lugar do texto que veio na resposta.
export const carregarVinculos = async (): Promise<Map<string, string>> => {
  const vincs = await mapaVinculos();
  return new Map([...vincs.values()].map(v => [v.nome_norm, String(v.empregado_nome ?? "").trim()]));
};

// =====================================================================
// CACHE DE MÓDULO — a ficha tem que abrir instantânea
//
// Antes, cada clique num nome baixava TODOS os formulários e TODAS as
// respostas (com o jsonb `itens` inteiro) só para descobrir de quais
// formulários AQUELA pessoa participou — e ainda em série com outras três
// consultas. Segundos de "Carregando ficha…", repetidos a cada nome, e a
// mesma varredura de novo ao reabrir a mesma pessoa.
//
// Agora a varredura acontece UMA vez por sessão e vira um índice
// nome_norm → participações; abrir a ficha é lookup em Map. A tela de
// Respostas chama `prewarmFichas()` quando carrega, então na hora do clique
// o índice já está pronto e não há nada para esperar.
//
// Escrita (vincular/desvincular) invalida só o que mudou.
// =====================================================================

interface VincRow { id?: any; nome_norm: string; nome_texto?: string; empregado_id: any; empregado_nome?: string }

let vincCache: Map<string, VincRow> | null = null;   // nome_norm → vínculo
let vincProm: Promise<Map<string, VincRow>> | null = null;

async function mapaVinculos(): Promise<Map<string, VincRow>> {
  if (vincCache) return vincCache;
  if (!vincProm) vincProm = (async () => {
    try {
      const { data } = await (supabase as any).from("CS_FORM_VINCULOS").select("*");
      vincCache = new Map((data ?? []).filter((v: any) => v.nome_norm).map((v: any) => [String(v.nome_norm), v as VincRow]));
    } catch { vincCache = new Map(); }   // tabela nova ainda não aplicada: degrada
    return vincCache!;
  })().finally(() => { vincProm = null; });
  return vincProm;
}
const invalidarVinculos = () => { vincCache = null; };

// Participações de um nome, com as respostas que a geraram (o total é o
// tamanho da união — a mesma resposta citando dois apelidos da pessoa não
// pode contar duas vezes).
interface ParticIdx { formId: string; titulo: string; comoRespondente: boolean; perguntas: Set<string>; respostas: Set<string> }

let idxCache: Map<string, Map<string, ParticIdx>> | null = null;
let idxProm: Promise<Map<string, Map<string, ParticIdx>>> | null = null;

// PostgREST corta QUALQUER resposta em 1000 linhas. Sem paginar, o índice
// nasceria truncado e pessoas com participação sumiriam da ficha.
async function leTudo(tabela: string, cols: string): Promise<any[]> {
  const bloco = 1000; const out: any[] = [];
  for (let de = 0; ; de += bloco) {
    const { data, error } = await (supabase as any).from(tabela).select(cols)
      .order("id", { ascending: true }).range(de, de + bloco - 1);
    if (error) throw error;
    const linhas: any[] = data ?? [];
    out.push(...linhas);
    if (linhas.length < bloco) break;
  }
  return out;
}

async function construirIndice(): Promise<Map<string, Map<string, ParticIdx>>> {
  const idx = new Map<string, Map<string, ParticIdx>>();
  try {
    const [forms, resps] = await Promise.all([
      leTudo("CS_FORMULARIOS", "id,titulo,perguntas"),
      leTudo("CS_FORM_RESPOSTAS", "id,formulario_id,respondente_nome,respondente_cadastro,itens"),
    ]);
    const titPorId: Record<string, string> = {};
    const pergsPorForm: Record<string, Record<string, string>> = {};
    forms.forEach((f: any) => {
      titPorId[f.id] = f.titulo;
      const m: Record<string, string> = {};
      (Array.isArray(f.perguntas) ? f.perguntas : []).forEach((p: any) => { if (p?.id) m[p.id] = p.titulo; });
      pergsPorForm[f.id] = m;
    });
    resps.forEach((r: any) => {
      const fid = r.formulario_id;
      // Um passo por resposta: junta os nomes citados nela antes de escrever no
      // índice, para o total contar a resposta uma vez por pessoa.
      const naResposta = new Map<string, { comoResp: boolean; perguntas: Set<string> }>();
      const anota = (bruto: any, pergunta: string | null) => {
        const k = normNome(bruto);
        // >60 caracteres nunca é nome de gente — é resposta dissertativa. Cortar
        // aqui mantém o índice enxuto sem perder nenhum casamento possível.
        if (!k || k.length > 60) return;
        const cur = naResposta.get(k) ?? { comoResp: false, perguntas: new Set<string>() };
        if (pergunta === null) cur.comoResp = true; else cur.perguntas.add(pergunta);
        naResposta.set(k, cur);
      };
      anota(r.respondente_nome, null);
      anota(r.respondente_cadastro?.nome, null);
      Object.entries(r.itens ?? {}).forEach(([pid, v]) => {
        (Array.isArray(v) ? v : [v]).forEach(x => anota(x, pergsPorForm[fid]?.[pid] ?? "Resposta"));
      });
      naResposta.forEach((info, nome) => {
        const porForm = idx.get(nome) ?? new Map<string, ParticIdx>();
        const p = porForm.get(fid) ?? { formId: fid, titulo: titPorId[fid] ?? "Formulário", comoRespondente: false, perguntas: new Set<string>(), respostas: new Set<string>() };
        p.respostas.add(String(r.id));
        if (info.comoResp) p.comoRespondente = true;
        info.perguntas.forEach(q => p.perguntas.add(q));
        porForm.set(fid, p); idx.set(nome, porForm);
      });
    });
  } catch { /* degrada: ficha abre sem a aba de formulários */ }
  idxCache = idx;
  return idx;
}

function indiceFichas(): Promise<Map<string, Map<string, ParticIdx>>> {
  if (idxCache) return Promise.resolve(idxCache);
  if (!idxProm) idxProm = construirIndice().finally(() => { idxProm = null; });
  return idxProm;
}

/** Começa a montar o índice das fichas em segundo plano. A tela de Respostas
 *  chama ao carregar: quando o usuário clicar num nome, não há o que esperar. */
export const prewarmFichas = () => { void nomesDoCadastro(); void mapaVinculos(); void indiceFichas(); };

/** Invalida o índice após criar/apagar respostas. */
export const invalidarFichas = () => { idxCache = null; };

// Fichas do cadastro já resolvidas nesta sessão (nome_norm → linha da
// EMPREGADOS, ou null quando não existe). Reabrir a mesma pessoa não repete a
// busca por nome, que é a consulta cara quando não há vínculo.
const empCache = new Map<string, any | null>();

const parseData = (v: any): Date | null => {
  if (!v) return null;
  const s = String(v).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const d = br ? new Date(+br[3], +br[2] - 1, +br[1]) : new Date(s);
  // 30/11/1899 é o "vazio" do sistema legado (serial 0) - trata como sem data.
  return isNaN(d.getTime()) || d.getFullYear() < 1900 ? null : d;
};
const fmtData = (v: any) => { const d = parseData(v); return d ? d.toLocaleDateString("pt-BR") : "—"; };
const tempoDeCasa = (v: any): string | null => {
  const d = parseData(v); if (!d) return null;
  let meses = (Date.now() - d.getTime()) / (365.25 / 12 * 864e5);
  if (meses < 0) meses = 0;
  const anos = Math.floor(meses / 12), m = Math.floor(meses % 12);
  const pa = anos ? `${anos} ano${anos > 1 ? "s" : ""}` : "";
  const pm = m ? `${m} ${m > 1 ? "meses" : "mês"}` : "";
  return [pa, pm].filter(Boolean).join(" e ") || "menos de 1 mês";
};
const nomeCargoDe = (e: any): string =>
  String(e?.["Nome do Cargo"] ?? "").trim() || String(e?.["Título do Cargo"] ?? "").trim() || String(e?.["Cargo"] ?? "").trim() || "—";
const val = (v: any) => { const s = v == null ? "" : String(v).trim(); return s || "—"; };
const resumoDe = (e: any) => `${nomeCargoDe(e)}${e?.["Setor_ERP"] ? " · " + e["Setor_ERP"] : ""}`;
// "Trabalhando" e afins = vínculo ativo; o resto (Demitido/Rescisão) é terminal.
const ehAtivo = (e: any) => String(e?.["Situação"] ?? "").trim().toUpperCase().startsWith("TRABALH");

// ── Índice de nomes do cadastro (via RPC) ────────────────────────────
// Ler EMPREGADOS direto pelo PostgREST paga o custo da RLS por linha e
// engasga neste cadastro — foi o que fez a tela de Colaboradores e a de
// Hierarquia migrarem para RPC. A ficha era o último lugar fazendo
// `ilike '%nome%'`, ou seja, varredura da tabela inteira A CADA CLIQUE:
// é daí que vinha o "Carregando ficha…" que não terminava.
//
// Agora o nome é resolvido em memória (uma leitura por RPC, cacheada) e só
// então se busca a linha completa PELA CHAVE — consulta de uma linha só.
interface NomeCad { id: number; nome: string; ativo: boolean }
let cadCache: Map<string, NomeCad> | null = null;
let cadProm: Promise<Map<string, NomeCad>> | null = null;

export async function nomesDoCadastro(): Promise<Map<string, NomeCad>> {
  if (cadCache) return cadCache;
  if (!cadProm) cadProm = (async () => {
    const m = new Map<string, NomeCad>();
    try {
      (await carregaHierarquiaDados()).forEach(l => {
        const k = normNome(l.nome); if (!k) return;
        const ativo = l.situacao.toUpperCase().startsWith("TRABALH");
        const cur = m.get(k);
        // Homônimo é comum (readmissão vira 2+ linhas, uma demitida):
        // quem está trabalhando ganha, senão fica o primeiro.
        if (!cur || (ativo && !cur.ativo)) m.set(k, { id: l.id, nome: l.nome, ativo });
      });
    } catch { /* degrada: ninguém vira link, ninguém trava */ }
    cadCache = m;
    return m;
  })().finally(() => { cadProm = null; });
  return cadProm;
}
export const invalidarCadastro = () => { cadCache = null; };

/**
 * Nome citado numa resposta → pessoa do cadastro, em memória. IGUALDADE EXATA
 * (só ignora acento, caixa e espaço repetido).
 *
 * Já houve aqui um casamento por nome CONTIDO, com desempate pelo tamanho mais
 * próximo. Ele acertava "Mileny de Oliveira" → "MILENY DE OLIVEIRA DA ROSA", mas
 * pescava qualquer coisa: uma resposta "N" casava com o primeiro empregado cujo
 * nome contivesse "N" e era exibida como aquela pessoa, em negrito. Palpite de
 * identidade não vale o estrago — nome que não bate exatamente agora depende de
 * vínculo manual (CS_FORM_VINCULOS), feito nesta ficha.
 *
 * Requer o cache já carregado (`await nomesDoCadastro()`); sem ele devolve vazio.
 */
export function resolveCadastro(nome: string): NomeCad | null {
  const alvo = normNome(nome);
  if (!alvo || !cadCache) return null;
  return cadCache.get(alvo) ?? null;
}

// Linha completa da EMPREGADOS da pessoa resolvida. Só ela vai ao banco, pela
// chave primária.
const buscaEmpregado = async (n: string) => {
  await nomesDoCadastro();
  const hit = resolveCadastro(n);
  if (!hit) return null;
  const { data } = await (supabase as any).from("EMPREGADOS").select("*").eq("ID", hit.id).maybeSingle();
  return data ?? null;
};

interface Participacao {
  formId: string; titulo: string;
  comoRespondente: boolean; perguntas: string[]; total: number;
}

const btn = (bg: string, c = "#fff", border = "none"): React.CSSProperties =>
  ({ padding: "6px 12px", borderRadius: 9, border, background: bg, color: c, fontSize: 12, fontWeight: 700, cursor: "pointer" });
const btnGhost = btn("rgba(15,49,113,.08)", "#0f3171", "1px solid rgba(15,49,113,.2)");
const rotuloSecao: React.CSSProperties =
  { fontSize: 11, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".5px", margin: "16px 0 8px" };

function Campo({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #f1f5f9", borderRadius: 10, padding: "8px 11px" }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: ".4px" }}>{rotulo}</div>
      <div style={{ fontSize: 12.5, color: cor || "#0f172a", fontWeight: 600, marginTop: 2, wordBreak: "break-word" }}>{valor}</div>
    </div>
  );
}

// Busca por nome na EMPREGADOS. Serve p/ vincular um nome solto e p/ escolher
// o líder de um colaborador.
function BuscaEmpregado({ titulo, ajuda, ignorarId, onEscolher, onCancelar }: {
  titulo: string; ajuda: string; ignorarId?: any;
  onEscolher: (e: any) => void; onCancelar: () => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const termo = q.trim();
    if (termo.length < 2) { setRows([]); setBuscando(false); return; }
    setBuscando(true);
    let cancel = false;
    const t = setTimeout(async () => {
      try {
        const { data } = await (supabase as any).from("EMPREGADOS").select("*")
          .ilike("Nome", `%${termo}%`).order('"Nome"').limit(25);
        if (!cancel) setRows((data ?? []).filter((e: any) => String(e["ID"]) !== String(ignorarId)));
      } catch { if (!cancel) setRows([]); }
      if (!cancel) setBuscando(false);
    }, 300);
    return () => { cancel = true; clearTimeout(t); };
  }, [q, ignorarId]);

  return (
    <div style={{ border: "1px solid #dbeafe", background: "#f8fbff", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: "#0f3171" }}>{titulo}</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{ajuda}</div>
        </div>
        <button onClick={onCancelar} style={btn("#fff", "#475569", "1px solid #e2e8f0")}>Cancelar</button>
      </div>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Digite parte do nome…"
        style={{ width: "100%", padding: "8px 11px", borderRadius: 9, border: "1px solid #dbeafe", fontSize: 12.5, outline: "none", boxSizing: "border-box" }} />
      <div style={{ marginTop: 8, maxHeight: 230, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
        {q.trim().length < 2 ? (
          <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "6px 2px" }}>Digite ao menos 2 letras.</div>
        ) : buscando ? (
          <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "6px 2px" }}>Buscando…</div>
        ) : rows.length === 0 ? (
          <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "6px 2px" }}>Ninguém encontrado com esse trecho de nome.</div>
        ) : rows.map((e: any) => (
          <button key={String(e["ID"])} onClick={() => onEscolher(e)}
            style={{ textAlign: "left", background: "#fff", border: "1px solid #e2e8f0", borderRadius: 9, padding: "7px 10px", cursor: "pointer" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "#0f172a" }}>{e["Nome"]}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              {resumoDe(e)} · <span style={{ color: ehAtivo(e) ? "#15803d" : "#b91c1c", fontWeight: 700 }}>{val(e["Situação"])}</span>
              {e["CPF"] ? ` · CPF ${e["CPF"]}` : ""}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function EmpregadoDetalheModal({ nome, onClose, onVinculado }: {
  nome: string; onClose: () => void; onVinculado?: () => void;
}) {
  const nav = useNavigate();
  const [alvoNome, setAlvoNome] = useState(nome);           // pessoa exibida (troca ao clicar no líder)
  const [aba, setAba] = useState<"cadastro" | "formularios">("cadastro");
  const [emp, setEmp] = useState<any | null>(null);
  const [lider, setLider] = useState<any | null>(null);
  const [vinculo, setVinculo] = useState<any | null>(null); // de-para manual que resolveu este nome
  const [parts, setParts] = useState<Participacao[]>([]);
  const [partsCarregando, setPartsCarregando] = useState(true);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [modo, setModo] = useState<null | "vincular" | "lider">(null); // qual busca está aberta
  const [filtro, setFiltro] = useState<string>("todos");   // aba Formulários: "todos" | "respondeu" | <pergunta>

  useEffect(() => { setAlvoNome(nome); setAba("cadastro"); }, [nome]);
  useEffect(() => { setModo(null); setErro(null); setFiltro("todos"); }, [alvoNome]);

  const carregar = useCallback(async (cancelado?: () => boolean) => {
    const alvo = normNome(alvoNome);
    // Só mostra "Carregando" quando há mesmo o que buscar: com os caches
    // quentes (o normal, graças ao prewarm) a ficha aparece pronta, sem piscar.
    const quente = !!idxCache && !!vincCache && empCache.has(alvo);
    if (!quente) setLoading(true);

    // 1. Vínculo manual tem prioridade sobre o casamento por nome — sai do
    //    cache dos vínculos (tabela pequena, lida uma vez por sessão).
    const vincs = await mapaVinculos();
    const vinc = vincs.get(alvo) ?? null;

    // 2. Linha do cadastro. Com vínculo, busca pela PK (barata); sem vínculo,
    //    cai no ilike por nome. O resultado — inclusive "não achei" — fica em
    //    cache para reabrir a mesma pessoa não repetir a consulta.
    let empRow: any;
    if (empCache.has(alvo)) empRow = empCache.get(alvo);
    else {
      empRow = null;
      if (vinc?.empregado_id != null) {
        try {
          const { data } = await (supabase as any).from("EMPREGADOS").select("*").eq("ID", vinc.empregado_id).maybeSingle();
          empRow = data ?? null;
        } catch { /* ignore */ }
      }
      if (!empRow) { try { empRow = await buscaEmpregado(alvoNome); } catch { /* RLS/coluna ausente: degrada */ } }
      empCache.set(alvo, empRow);
    }

    // 3. LIDER é o NÍVEL da própria pessoa (GERENTE, DIREÇÃO…), não o nome de
    //    outra — não há ficha para buscar. Quem lidera o setor sai de
    //    Formulários › Líderes por setor.
    const liderRow: any = null;

    // 4. Nomes que representam esta pessoa: o do cadastro, o texto clicado e
    //    todo apelido vinculado à mão. Sem isso, um formulário que cita
    //    "João Peretti" não entraria na ficha do "João Pedro Peretti".
    //    Os apelidos saem do mesmo cache — nada de ir ao banco de novo.
    const alvos = new Set<string>([alvo]);
    if (empRow?.["Nome"]) alvos.add(normNome(empRow["Nome"]));
    if (empRow?.["ID"] != null) {
      vincs.forEach(v => { if (String(v.empregado_id) === String(empRow["ID"]) && v.nome_norm) alvos.add(v.nome_norm); });
    }

    // 5. O CADASTRO já pode aparecer: é a aba aberta e não depende de mais nada.
    //    Esperar as participações aqui era o que segurava a ficha inteira.
    if (cancelado?.()) return;
    setEmp(empRow); setLider(liderRow); setVinculo(vinc); setLoading(false);

    // 6. Participação em formulários: lookup no índice (já montado pelo prewarm).
    //    Chega depois, sem travar a tela — a aba mostra "carregando" sozinha.
    setPartsCarregando(true);
    const idx = await indiceFichas();
    const porForm = new Map<string, Participacao & { _resps: Set<string> }>();
    alvos.forEach(a => {
      idx.get(a)?.forEach((p, fid) => {
        const cur = porForm.get(fid) ?? { formId: fid, titulo: p.titulo, comoRespondente: false, perguntas: [], total: 0, _resps: new Set<string>() };
        p.respostas.forEach(id => cur._resps.add(id));
        if (p.comoRespondente) cur.comoRespondente = true;
        p.perguntas.forEach(q => { if (!cur.perguntas.includes(q)) cur.perguntas.push(q); });
        porForm.set(fid, cur);
      });
    });
    const participacoes: Participacao[] = [...porForm.values()]
      .map(({ _resps, ...p }) => ({ ...p, total: _resps.size }))
      .sort((a, b) => b.total - a.total);

    if (cancelado?.()) return;
    setParts(participacoes); setPartsCarregando(false);
  }, [alvoNome]);

  useEffect(() => {
    let cancel = false;
    carregar(() => cancel);
    return () => { cancel = true; };
  }, [carregar]);

  // --- Ações de escrita -------------------------------------------------
  const vincularA = async (escolhido: any) => {
    setSalvando(true); setErro(null);
    const { error } = await (supabase as any).from("CS_FORM_VINCULOS").upsert({
      nome_norm: normNome(alvoNome), nome_texto: alvoNome,
      empregado_id: escolhido["ID"], empregado_nome: escolhido["Nome"],
    }, { onConflict: "nome_norm" });
    setSalvando(false);
    if (error) { setErro(`Não deu p/ vincular: ${error.message}`); return; }
    // Vincular muda os dois caches: o de-para e a ficha resolvida deste nome.
    // Gravar o escolhido direto evita ir buscar de novo o que acabamos de ter
    // em mãos — é o "vincula uma vez e pronto".
    invalidarVinculos(); empCache.set(normNome(alvoNome), escolhido);
    setModo(null); onVinculado?.(); carregar();
  };

  const desvincular = async () => {
    if (!vinculo || !confirm(`Desfazer o vínculo de "${alvoNome}" com ${vinculo.empregado_nome}?`)) return;
    setSalvando(true); setErro(null);
    const { error } = await (supabase as any).from("CS_FORM_VINCULOS").delete().eq("id", vinculo.id);
    setSalvando(false);
    if (error) { setErro(`Não deu p/ desvincular: ${error.message}`); return; }
    invalidarVinculos(); empCache.delete(normNome(alvoNome));
    onVinculado?.(); carregar();
  };

  // definirLider/removerLider foram REMOVIDOS de propósito: escreviam nome de
  // pessoa (ou NULL) em EMPREGADOS.LIDER, coluna que guarda o NÍVEL hierárquico
  // da própria pessoa — cada clique apagava o nível de quem estava sendo
  // editado. A ficha agora só exibe o nível; quem lidera cada setor se resolve
  // em Formulários › Líderes por setor.

  const irParaForm = (formId: string) => { onClose(); nav(`/app/central-servicos/formularios/${formId}/respostas`); };

  // Filtros da aba Formulários: "Respondeu" + uma opção por pergunta em que a
  // pessoa foi citada (é assim que se vê "todo formulário que ela participou
  // como líder" vs. "como colaborador" - a pergunta é que diz o papel).
  const perguntasFiltro = useMemo(() => {
    const s = new Set<string>();
    parts.forEach(p => p.perguntas.forEach(q => s.add(q)));
    return [...s];
  }, [parts]);
  const partsFiltradas = useMemo(() => (
    filtro === "todos" ? parts
      : filtro === "respondeu" ? parts.filter(p => p.comoRespondente)
        : parts.filter(p => p.perguntas.includes(filtro))
  ), [parts, filtro]);

  const sit = val(emp?.["Situação"]);
  const ativo = ehAtivo(emp);
  const demissao = fmtData(emp?.["Data Afastamento"]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 950, background: "rgba(15,23,42,.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: 640, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
        <button onClick={onClose} style={{ position: "absolute", top: 12, right: 14, border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", zIndex: 2 }}>×</button>

        {/* Cabeçalho */}
        <div style={{ padding: "18px 22px 0" }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f3171", paddingRight: 24 }}>👤 {emp?.["Nome"] || alvoNome}</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
            {loading ? "Carregando ficha…" : emp ? resumoDe(emp) : "Não localizado no cadastro de empregados"}
          </div>
          <div style={{ display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 10, padding: 3, marginTop: 12, width: "fit-content" }}>
            {(["cadastro", "formularios"] as const).map(a => (
              <button key={a} onClick={() => setAba(a)} style={{ padding: "6px 14px", borderRadius: 8, border: "none", background: aba === a ? "#fff" : "transparent", color: aba === a ? "#0f3171" : "#64748b", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: aba === a ? "0 2px 6px rgba(15,23,42,.08)" : "none" }}>
                {a === "cadastro" ? "Cadastro" : `Formulários${parts.length ? ` (${parts.length})` : ""}`}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px 22px" }}>
          {erro && (
            <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "9px 12px", fontSize: 12, color: "#b91c1c", marginBottom: 10 }}>{erro}</div>
          )}

          {loading ? (
            <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Carregando…</div>
          ) : aba === "cadastro" ? (
            !emp ? (
              // Nome que não casa com o cadastro: oferece vincular à mão.
              <>
                <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: "14px 16px", fontSize: 12.5, color: "#9a3412", marginBottom: 12 }}>
                  Não encontramos <b>{alvoNome}</b> no cadastro de empregados. Pode ser um nome incompleto (ex.: falta um sobrenome), grafia diferente, ou não ser uma pessoa (ex.: um setor/gerência).
                </div>
                {modo === "vincular" ? (
                  <BuscaEmpregado titulo={`Vincular "${alvoNome}" a um empregado`}
                    ajuda="A ficha e os formulários passam a apontar p/ o cadastro escolhido."
                    onEscolher={vincularA} onCancelar={() => setModo(null)} />
                ) : (
                  <button onClick={() => setModo("vincular")} disabled={salvando} style={btn("#0f3171")}>🔗 Vincular a um empregado</button>
                )}
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: ativo ? "#dcfce7" : "#fee2e2", color: ativo ? "#15803d" : "#b91c1c" }}>{sit}</span>
                  {emp["Nome da Empresa"] && <span style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>{emp["Nome da Empresa"]}</span>}
                  {vinculo && (
                    <span title={`A resposta diz "${vinculo.nome_texto}" e foi vinculada à mão a ${vinculo.empregado_nome}.`}
                      style={{ fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: "#fef9c3", color: "#a16207" }}>
                      🔗 Vinculado de “{vinculo.nome_texto}”
                    </span>
                  )}
                  {vinculo && <button onClick={desvincular} disabled={salvando} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>Desvincular</button>}
                  <div style={{ flex: 1 }} />
                  {/* O casamento automático é por nome e erra: homônimo, cadastro
                      antigo/demitido, nome trocado. Daqui dá p/ fixar o texto da
                      resposta na pessoa certa mesmo já tendo achado alguém. */}
                  {modo !== "vincular" && (
                    <button onClick={() => setModo("vincular")} disabled={salvando}
                      style={{ ...btnGhost, padding: "4px 10px", fontSize: 11 }}>
                      {vinculo ? "Trocar vínculo" : "Não é essa pessoa?"}
                    </button>
                  )}
                </div>

                {modo === "vincular" && (
                  <div style={{ marginBottom: 12 }}>
                    <BuscaEmpregado titulo={`Apontar "${alvoNome}" para outro empregado`}
                      ajuda={`Hoje está caindo em ${emp["Nome"]}. O escolhido passa a valer p/ todas as respostas com esse nome.`}
                      ignorarId={emp["ID"]} onEscolher={vincularA} onCancelar={() => setModo(null)} />
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Campo rotulo="CPF" valor={val(emp["CPF"])} />
                  <Campo rotulo="Admissão" valor={fmtData(emp["Admissão"])} />
                  <Campo rotulo="Tempo de casa" valor={tempoDeCasa(emp["Admissão"]) ?? "—"} cor="#0f3171" />
                  <Campo rotulo="Cargo" valor={nomeCargoDe(emp)} />
                  <Campo rotulo="Setor" valor={val(emp["Setor_ERP"])} />
                  <Campo rotulo="Perfil" valor={val(emp["Perfil_ERP"])} />
                  <Campo rotulo="Filial" valor={val(emp["Nome Filial"])} />
                  <Campo rotulo="Centro de custo" valor={[emp["C.Custo"], emp["Titulo C.Custo"]].filter(Boolean).join(" — ") || "—"} />
                  <Campo rotulo="Situação" valor={sit} cor={ativo ? "#15803d" : "#b91c1c"} />
                  {/* Data de saída só faz sentido p/ quem não está mais ativo. */}
                  {!ativo && demissao !== "—" && <Campo rotulo="Saída" valor={demissao} cor="#b91c1c" />}
                  <Campo rotulo="E-mail" valor={val(emp["email"])} />
                </div>

                {/* Nível hierárquico (coluna LIDER) — SOMENTE LEITURA.
                    Esta seção já teve um botão "Definir líder" que gravava o
                    NOME de outra pessoa em EMPREGADOS.LIDER. Só que essa coluna
                    guarda o NÍVEL da própria pessoa (CEO, DIREÇÃO, GERENTE,
                    SUPERVISOR…): cada uso do botão apagava o nível de quem
                    estava sendo editado, e "Remover" zerava de vez. O botão saiu.
                    Quem lidera cada setor se resolve em Formulários › Líderes
                    por setor, derivado de Setor_ERP + nível. */}
                <div style={rotuloSecao}>Nível hierárquico</div>
                {emp["LIDER"] ? (
                  <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 13px" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, padding: "3px 10px", borderRadius: 20, background: ehNivel(emp["LIDER"]) ? "#0f31711a" : "#f59e0b1a", color: ehNivel(emp["LIDER"]) ? "#0f3171" : "#b45309" }}>
                      {String(emp["LIDER"])}
                    </span>
                    <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 7, lineHeight: 1.5 }}>
                      {ehNivel(emp["LIDER"])
                        ? <>Responde pelo setor <b>{val(emp["Setor_ERP"])}</b> quando é o nível mais alto dele.</>
                        : <>⚠ Este valor não é um nível conhecido ({NIVEIS.slice(0, 5).join(", ")}…). Se for nome de pessoa,
                          foi gravado pelo antigo botão “Definir líder” e substituiu o nível real — o RH precisa corrigir no cadastro.</>}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>Sem nível no cadastro (não é liderança).</div>
                )}
              </>
            )
          ) : (
            // Aba Formulários
            partsCarregando ? (
              <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 12.5 }}>Cruzando os formulários…</div>
            ) : parts.length === 0 ? (
              <div style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 12.5 }}>
                Nenhum formulário encontrado com <b>{alvoNome}</b> (como respondente ou citado numa resposta).
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {/* Filtro por papel: a pergunta em que a pessoa foi citada diz se
                    ela entrou como líder, como colaborador, etc. */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {[
                    { k: "todos", r: `Todos (${parts.length})` },
                    ...(parts.some(p => p.comoRespondente) ? [{ k: "respondeu", r: `Respondeu (${parts.filter(p => p.comoRespondente).length})` }] : []),
                    ...perguntasFiltro.map(q => ({ k: q, r: `${q} (${parts.filter(p => p.perguntas.includes(q)).length})` })),
                  ].map(({ k, r }) => (
                    <button key={k} onClick={() => setFiltro(k)} title={r}
                      style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, cursor: "pointer", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        border: filtro === k ? "1px solid #0f3171" : "1px solid #e2e8f0",
                        background: filtro === k ? "#0f3171" : "#fff", color: filtro === k ? "#fff" : "#475569" }}>
                      {r}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  {filtro === "todos"
                    ? <>Participou de <b style={{ color: "#0f172a" }}>{parts.length}</b> formulário(s):</>
                    : <><b style={{ color: "#0f172a" }}>{partsFiltradas.length}</b> formulário(s) neste filtro:</>}
                </div>
                {partsFiltradas.map(p => (
                  <div key={p.formId} style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "11px 13px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{p.titulo}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                        {p.comoRespondente && <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "#dcfce7", color: "#15803d" }}>Respondeu</span>}
                        {p.perguntas.map((q, i) => (
                          <span key={i} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#eef2ff", color: "#4338ca" }}>Citado em: {q}</span>
                        ))}
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#f1f5f9", color: "#64748b" }}>{p.total} resposta(s)</span>
                      </div>
                    </div>
                    <button onClick={() => irParaForm(p.formId)} style={btn("rgba(59,130,246,.1)", "#2563eb", "1px solid rgba(59,130,246,.3)")}>📊 Ver respostas</button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
