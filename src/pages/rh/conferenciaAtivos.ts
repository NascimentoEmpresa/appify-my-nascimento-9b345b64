// =====================================================================
// RH › ATIVOS/CONTRATOS — lógica pura (sem React), testada em
// src/test/rh-ativos-contratos.test.ts.
//
// O banco (rh_ac_painel, mig 20260930000279) devolve, por contrato:
//   · os postos VIGENTES da Planilha de Custo, com as vagas ("QT. PESSOAS");
//   · os postos da Senior ("Nome do Posto" dos ativos em EMPREGADOS), com as
//     pessoas;
//   · as ligações entre os dois (RH_POSTO_DEPARA), muitos-para-muitos.
//
// Aqui: (1) sugerir a ligação de um posto da Senior, porque os nomes não
// batem ("01-1099-0071-0061-06-RECEPCIONISTA-B1 40H 5X2" ↔ "POSTO B1 -
// RECEPCIONISTA 40H 5X2"); (2) juntar os postos ligados em GRUPOS e conferir
// vagas × pessoas em cada grupo. Grupo existe porque às vezes a planilha
// separa por cidade o que a Senior tem num posto só (UFRGS Limpeza Geral).
// =====================================================================

export interface PostoPlanilha {
  nome: string;
  servico: string | null;
  vagas: number;
  vigencia: string | null;
}

export interface PostoSenior {
  /** "Nome do Posto" como vem da Senior; "" = sem posto no cadastro. */
  posto_senior: string;
  qtd: number;
  /** Ativos que não estão "Trabalhando" (férias, atestado, auxílio-doença…). */
  afastados: number;
}

export interface Vinculo {
  posto_senior: string;
  /** Nome ATUAL do posto na planilha; null quando ignorar ou órfã. */
  planilha_posto: string | null;
  ignorar: boolean;
  /** Ligado a um posto que saiu da planilha vigente. */
  orfa: boolean;
  planilha_posto_gravado: string | null;
}

export interface ContratoAtivos {
  id: string;
  nome: string;
  cliente: string | null;
  status: string | null;
  encerrado: boolean;
  postos: PostoPlanilha[];
  postos_senior: PostoSenior[];
  vinculos: Vinculo[];
}

export interface PainelAtivos {
  gerado_em: string;
  total_ativos: number;
  com_contrato: number;
  contratos: ContratoAtivos[];
  filiais_sem_contrato: { filial: string; qtd: number }[];
}

// ---- Nome do posto da Senior -----------------------------------------------

/** "01-1099-0071-0061-06-RECEPCIONISTA-B1 40H 5X2" → "RECEPCIONISTA-B1 40H 5X2". */
export function limparPostoSenior(nome: string): string {
  const s = (nome ?? "").trim();
  if (!s) return "Sem posto no cadastro";
  return s.replace(/^\d{2}-\d{4}-\d{4}-\d{4}-\d+-/, "").trim() || s;
}

// ---- Sugestão de ligação ---------------------------------------------------

const SINONIMOS: Record<string, string> = {
  NOT: "NOTURNO", NOTURNA: "NOTURNO", DIU: "DIURNO", DIA: "DIURNO", DIURNA: "DIURNO",
  AUX: "AUXILIAR", SERV: "SERVICOS", SERVICO: "SERVICOS",
  SUP: "SUPERVISOR", SUPER: "SUPERVISOR", SUPERVISAO: "SUPERVISOR",
  RECEP: "RECEPCIONISTA", RECEPCAO: "RECEPCIONISTA",
  MNT: "MANUTENCAO", LIMP: "LIMPEZA", PORTEIRO: "PORTARIA",
  SERVENTE: "LIMPEZA", SERVENTES: "LIMPEZA", ASG: "LIMPEZA",
  OP: "OPERADOR", ENCARREGADA: "ENCARREGADO",
};

const PARADAS = new Set([
  "POSTO", "DE", "DA", "DO", "DAS", "DOS", "E", "EM", "NO", "NA", "O", "AS", "OS",
  "ITEM", "GERAL", "CAT", "SCU", "SEG", "SEX", "SAB",
]);

type Peso = { tok: string; peso: number; codigo: boolean };

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Quebra um nome de posto em termos comparáveis, cada um com peso. */
export function termosDoPosto(nome: string): Peso[] {
  let s = semAcento(limparPostoSenior(nome)).toUpperCase();
  s = s.replace(/SEG\s+A\s+(SEX|SAB)/g, " ")          // "SEG A SEX" não é código "A"
       .replace(/\b\d{1,2}\s+AS\s+\d{1,2}\b/g, " ")    // "06 AS 12" (horário)
       .replace(/(\d+)\s*H(RS|ORAS)?\b/g, "$1H")       // "220 Hrs" → "220H"
       .replace(/(\d+)\s*X\s*(\d+)/g, "$1X$2");        // "12 x 36" → "12X36"
  const vistos = new Set<string>();
  const out: Peso[] = [];
  for (const cru of s.split(/[^A-Z0-9]+/)) {
    if (!cru) continue;
    const tok = SINONIMOS[cru] ?? cru;
    if (PARADAS.has(tok) || vistos.has(tok)) continue;
    vistos.add(tok);
    const codigo = /^[A-Z]{1,2}\d?$/.test(tok);
    const jornada = /^\d+H$/.test(tok) || /^\d+X\d+$/.test(tok);
    if (/^\d+$/.test(tok)) continue;                   // número solto não diz nada
    out.push({ tok, codigo, peso: codigo ? 2 : jornada ? 1.5 : 1 });
  }
  return out;
}

/** Semelhança 0..1 entre um posto da Senior e um da planilha. */
export function semelhancaPosto(senior: string, planilha: string): number {
  const a = termosDoPosto(senior);
  const b = termosDoPosto(planilha);
  if (!a.length || !b.length) return 0;
  const bm = new Map(b.map((t) => [t.tok, t]));
  let inter = 0;
  for (const t of a) if (bm.has(t.tok)) inter += t.peso;
  const soma = (xs: Peso[]) => xs.reduce((s, t) => s + t.peso, 0);
  let score = (2 * inter) / (soma(a) + soma(b));
  // Os dois têm código de posto (A, B1, CR…) e nenhum bate → quase certo
  // que é outro posto do mesmo cargo.
  const ca = a.filter((t) => t.codigo).map((t) => t.tok);
  const cb = new Set(b.filter((t) => t.codigo).map((t) => t.tok));
  if (ca.length && cb.size && !ca.some((c) => cb.has(c))) score *= 0.5;
  return score;
}

export const LIMIAR_SUGESTAO = 0.45;

/**
 * Postos da planilha sugeridos para um posto da Senior: o de maior
 * semelhança, mais os empatados com ele (quando a planilha separa por cidade
 * o mesmo posto, todos empatam e todos são sugeridos). Vazio = sem sugestão.
 */
export function sugerirPostos(senior: string, planilha: PostoPlanilha[]): string[] {
  if (!senior.trim()) return [];
  const notas = planilha
    .map((p) => ({ nome: p.nome, nota: semelhancaPosto(senior, p.nome) }))
    .filter((x) => x.nota >= LIMIAR_SUGESTAO)
    .sort((x, y) => y.nota - x.nota);
  if (!notas.length) return [];
  const topo = notas[0].nota;
  return notas.filter((x) => topo - x.nota < 0.02).slice(0, 8).map((x) => x.nome);
}

// ---- Grupos e conferência --------------------------------------------------

export type SituacaoGrupo = "ok" | "falta" | "excesso";

export interface GrupoPostos {
  chave: string;
  planilha: PostoPlanilha[];
  senior: PostoSenior[];
  previsto: number;
  ativos: number;
  afastados: number;
  /** ativos − previsto (negativo = falta gente). */
  diferenca: number;
  situacao: SituacaoGrupo;
}

export interface ConferenciaContrato {
  grupos: GrupoPostos[];
  /** Postos da planilha que nenhum posto da Senior foi ligado. */
  planilhaSemVinculo: PostoPlanilha[];
  /** Postos da Senior ainda sem ligação (nem ignorados). */
  seniorPendentes: PostoSenior[];
  seniorIgnorados: PostoSenior[];
  /** Ligações a postos que saíram da planilha vigente. */
  vinculosOrfaos: Vinculo[];
  previsto: number;
  ativos: number;
  afastados: number;
  /** Pessoas em postos da Senior ainda não ligados. */
  pessoasPendentes: number;
  /** ativos − previsto, no contrato inteiro. */
  diferenca: number;
  /** Tudo ligado e todos os grupos batem. */
  fechado: boolean;
}

const situacaoDe = (dif: number): SituacaoGrupo => (dif === 0 ? "ok" : dif < 0 ? "falta" : "excesso");

/** Junta os postos ligados entre si (componentes conexos) e confere cada grupo. */
export function conferirContrato(c: ContratoAtivos): ConferenciaContrato {
  const pai = new Map<string, string>();
  const acha = (x: string): string => {
    let r = x;
    while (pai.get(r) !== r) r = pai.get(r)!;
    let y = x;
    while (pai.get(y) !== r) { const p = pai.get(y)!; pai.set(y, r); y = p; }
    return r;
  };
  const une = (a: string, b: string) => { const ra = acha(a), rb = acha(b); if (ra !== rb) pai.set(ra, rb); };

  const P = (n: string) => `P:${n}`;
  const S = (n: string) => `S:${n}`;
  const planilhaPorNome = new Map(c.postos.map((p) => [p.nome, p]));

  const ignorados = new Set(c.vinculos.filter((v) => v.ignorar).map((v) => v.posto_senior));
  const validos = c.vinculos.filter((v) => !v.ignorar && !v.orfa && v.planilha_posto && planilhaPorNome.has(v.planilha_posto));
  const ligados = new Set(validos.map((v) => v.posto_senior));

  c.postos.forEach((p) => pai.set(P(p.nome), P(p.nome)));
  c.postos_senior.filter((s) => ligados.has(s.posto_senior)).forEach((s) => pai.set(S(s.posto_senior), S(s.posto_senior)));
  for (const v of validos) {
    if (!pai.has(S(v.posto_senior))) continue;   // posto da Senior sem ninguém ativo hoje
    une(S(v.posto_senior), P(v.planilha_posto!));
  }

  const grupos = new Map<string, { planilha: PostoPlanilha[]; senior: PostoSenior[] }>();
  const doGrupo = (raiz: string) => {
    if (!grupos.has(raiz)) grupos.set(raiz, { planilha: [], senior: [] });
    return grupos.get(raiz)!;
  };
  c.postos.forEach((p) => doGrupo(acha(P(p.nome))).planilha.push(p));
  c.postos_senior.filter((s) => pai.has(S(s.posto_senior))).forEach((s) => doGrupo(acha(S(s.posto_senior))).senior.push(s));

  const lista: GrupoPostos[] = [];
  const planilhaSemVinculo: PostoPlanilha[] = [];
  for (const [chave, g] of grupos) {
    if (!g.senior.length) { planilhaSemVinculo.push(...g.planilha); continue; }
    const previsto = g.planilha.reduce((s, p) => s + (p.vagas || 0), 0);
    const ativos = g.senior.reduce((s, p) => s + p.qtd, 0);
    const afastados = g.senior.reduce((s, p) => s + p.afastados, 0);
    lista.push({
      chave, planilha: g.planilha, senior: g.senior, previsto, ativos, afastados,
      diferenca: ativos - previsto, situacao: situacaoDe(ativos - previsto),
    });
  }
  // Pior primeiro: falta, depois excesso, depois ok; dentro, maior diferença.
  const ordem: Record<SituacaoGrupo, number> = { falta: 0, excesso: 1, ok: 2 };
  lista.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || Math.abs(b.diferenca) - Math.abs(a.diferenca)
    || a.planilha[0]?.nome.localeCompare(b.planilha[0]?.nome ?? "", "pt-BR"));

  const seniorPendentes = c.postos_senior.filter((s) => !ligados.has(s.posto_senior) && !ignorados.has(s.posto_senior));
  const seniorIgnorados = c.postos_senior.filter((s) => ignorados.has(s.posto_senior));
  const previsto = c.postos.reduce((s, p) => s + (p.vagas || 0), 0);
  const ativosNaConta = c.postos_senior.filter((s) => !ignorados.has(s.posto_senior));
  const ativos = ativosNaConta.reduce((s, p) => s + p.qtd, 0);
  const afastados = ativosNaConta.reduce((s, p) => s + p.afastados, 0);
  const pessoasPendentes = seniorPendentes.reduce((s, p) => s + p.qtd, 0);

  return {
    grupos: lista,
    planilhaSemVinculo: planilhaSemVinculo.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    seniorPendentes,
    seniorIgnorados,
    vinculosOrfaos: c.vinculos.filter((v) => v.orfa),
    previsto, ativos, afastados, pessoasPendentes,
    diferenca: ativos - previsto,
    fechado: pessoasPendentes === 0 && planilhaSemVinculo.every((p) => !p.vagas)
      && lista.every((g) => g.situacao === "ok"),
  };
}

/** Rótulo curto da diferença: "+3", "−2", "0". */
export const fmtDiferenca = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
