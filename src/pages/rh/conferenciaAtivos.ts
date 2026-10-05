// =====================================================================
// RH › ATIVOS/CONTRATOS — lógica pura (sem React), testada em
// src/test/rh-ativos-contratos.test.ts.
//
// O banco (rh_ac_painel, mig 20261005000001) devolve, por contrato:
//   · os postos VIGENTES da Planilha de Custo, com as vagas ("QT. PESSOAS");
//   · os colaboradores ativos, cada um já com o posto da planilha em que está
//     (pelo posto da Senior ligado, ou movido individualmente) e se CONTA no
//     posto — só "Trabalhando" e atestado contam; auxílio-doença, licença,
//     férias etc. deixam o posto descoberto (rh_ac_conta_no_posto).
//
// Aqui: (1) sugerir o posto da planilha de um posto da Senior, porque os
// nomes não batem ("01-1099-0071-0061-06-RECEPCIONISTA-B1 40H 5X2" ↔ "POSTO
// B1 - RECEPCIONISTA 40H 5X2"); (2) somar previsto × tem posto a posto.
//
// A v1 (mig 20260930000279) juntava postos ligados muitos-para-muitos em
// "grupos" e ficou confusa demais (pedido de 05/10/2026). Agora um posto da
// Senior aponta para UM posto da planilha, e quem foge à regra (UFRGS: um
// posto na Senior, vários na planilha por cidade) é movido pessoa a pessoa.
// =====================================================================

export interface PostoPlanilha {
  nome: string;
  vagas: number;
}

export interface PessoaContrato {
  id: number;
  cadastro: string | null;
  nome: string;
  cargo: string | null;
  situacao: string | null;
  /** Ocupa o posto hoje (Trabalhando ou atestado). */
  conta: boolean;
  /** "Nome do Posto" como vem da Senior; "" = sem posto no cadastro. */
  posto_senior: string;
  /** Posto da planilha em que a pessoa está; null = ainda sem posto. */
  posto: string | null;
  /** Fora da conta deste contrato (marcado pelo RH). */
  fora: boolean;
  /** De onde veio o posto: do posto da Senior ou movido individualmente. */
  origem: "posto" | "pessoa" | null;
}

export interface ContratoAtivos {
  id: string;
  nome: string;
  cliente: string | null;
  encerrado: boolean;
  postos: PostoPlanilha[];
  pessoas: PessoaContrato[];
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
 * Postos da planilha parecidos com um posto da Senior: o de maior
 * semelhança, mais os empatados com ele (quando a planilha separa por cidade
 * o mesmo posto, todos empatam). Vazio = sem sugestão.
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

// ---- Conferência -----------------------------------------------------------

export type Situacao = "ok" | "falta" | "excesso";

export const situacaoDe = (saldo: number): Situacao => (saldo === 0 ? "ok" : saldo < 0 ? "falta" : "excesso");

export interface ConferenciaPosto {
  nome: string;
  previsto: number;
  /** Pessoas no posto que contam (trabalhando/atestado). */
  tem: number;
  /** tem − previsto (negativo = falta gente). */
  saldo: number;
  situacao: Situacao;
  /** Todos no posto, inclusive afastados. */
  pessoas: PessoaContrato[];
  /** No posto mas sem contar (auxílio-doença, licença, férias…). */
  afastados: PessoaContrato[];
}

/** Um posto da Senior cujas pessoas ainda não têm posto da planilha. */
export interface PendenteSenior {
  posto_senior: string;
  pessoas: PessoaContrato[];
  /** Posto da planilha mais parecido; null = sem sugestão segura. */
  sugestao: string | null;
}

export interface ConferenciaContrato {
  postos: ConferenciaPosto[];
  pendentes: PendenteSenior[];
  /** Quantas pessoas estão sem posto da planilha. */
  semPosto: number;
  fora: PessoaContrato[];
  previsto: number;
  /** Todos que contam no contrato (com ou sem posto definido). */
  tem: number;
  saldo: number;
  situacao: Situacao;
  /** Soma do que falta posto a posto (não compensa sobra de um com falta de outro). */
  falta: number;
  /** Soma do que sobra posto a posto. */
  sobra: number;
  /** Afastados do contrato inteiro (não contam). */
  afastados: PessoaContrato[];
}

const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, "pt-BR");

export function conferirContrato(c: ContratoAtivos): ConferenciaContrato {
  const dentro = c.pessoas.filter((p) => !p.fora);
  const noPosto = new Map<string, PessoaContrato[]>();
  const semPosto = new Map<string, PessoaContrato[]>();
  const nomesPlanilha = new Set(c.postos.map((p) => p.nome));

  for (const p of dentro) {
    if (p.posto && nomesPlanilha.has(p.posto)) {
      if (!noPosto.has(p.posto)) noPosto.set(p.posto, []);
      noPosto.get(p.posto)!.push(p);
    } else {
      if (!semPosto.has(p.posto_senior)) semPosto.set(p.posto_senior, []);
      semPosto.get(p.posto_senior)!.push(p);
    }
  }

  const postos: ConferenciaPosto[] = c.postos.map((pl) => {
    const pessoas = (noPosto.get(pl.nome) ?? []).slice().sort(porNome);
    const tem = pessoas.filter((p) => p.conta).length;
    const saldo = tem - (pl.vagas || 0);
    return {
      nome: pl.nome, previsto: pl.vagas || 0, tem, saldo, situacao: situacaoDe(saldo),
      pessoas, afastados: pessoas.filter((p) => !p.conta),
    };
  }).sort(porNome);

  const pendentes: PendenteSenior[] = [...semPosto.entries()]
    .map(([posto_senior, pessoas]) => ({
      posto_senior,
      pessoas: pessoas.slice().sort(porNome),
      sugestao: sugerirPostos(posto_senior, c.postos)[0] ?? null,
    }))
    .sort((a, b) => b.pessoas.length - a.pessoas.length || a.posto_senior.localeCompare(b.posto_senior, "pt-BR"));

  const previsto = postos.reduce((s, p) => s + p.previsto, 0);
  const tem = dentro.filter((p) => p.conta).length;
  const saldo = tem - previsto;

  return {
    postos,
    pendentes,
    semPosto: pendentes.reduce((s, p) => s + p.pessoas.length, 0),
    fora: c.pessoas.filter((p) => p.fora).sort(porNome),
    previsto, tem, saldo,
    situacao: situacaoDe(saldo),
    falta: postos.reduce((s, p) => s + Math.max(0, -p.saldo), 0),
    sobra: postos.reduce((s, p) => s + Math.max(0, p.saldo), 0),
    afastados: dentro.filter((p) => !p.conta).sort(porNome),
  };
}

/** Rótulo curto do saldo: "+3", "−2", "0". */
export const fmtSaldo = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

// ---- Filial da Senior → contrato -------------------------------------------

const PARADAS_CONTRATO = new Set(["DE", "DA", "DO", "DAS", "DOS", "E", "C", "PM", "PREFEITURA", "MUNICIPAL"]);

function termosDoContrato(nome: string): { palavras: string[]; numeros: string[] } {
  const s = semAcento((nome ?? "").replace(/^\s*\d+\s*-\s*/, "")).toUpperCase();
  const palavras: string[] = [];
  const numeros: string[] = [];
  for (const cru of s.split(/[^A-Z0-9]+/)) {
    if (!cru) continue;
    if (/^\d+$/.test(cru)) numeros.push(cru.replace(/^0+(?=\d)/, ""));
    else {
      const t = SINONIMOS[cru] ?? cru;
      if (!PARADAS_CONTRATO.has(t)) palavras.push(t);
    }
  }
  return { palavras, numeros };
}

// "CANOINHAS" × "CANOINHA": prefixo comum de 5+ letras conta como a mesma palavra.
const mesmaPalavra = (a: string, b: string) =>
  a === b || (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a)));

/**
 * Contrato mais parecido com o "Nome Filial" da Senior. O número do contrato
 * vem em qualquer ordem e com qualquer separador ("95.2026" = "2026/95"), por
 * isso números são comparados como conjunto. null = nada parecido o bastante.
 */
export function sugerirContrato<T extends { id: string; nome: string }>(filial: string, contratos: T[]): T | null {
  const a = termosDoContrato(filial);
  if (!a.palavras.length) return null;
  let melhor: { c: T; nota: number } | null = null;
  for (const c of contratos) {
    const b = termosDoContrato(c.nome);
    const pal = a.palavras.filter((x) => b.palavras.some((y) => mesmaPalavra(x, y))).length;
    if (!pal) continue;
    const num = a.numeros.filter((x) => b.numeros.includes(x)).length;
    const nota = (2 * (pal + 2 * num)) / (a.palavras.length + b.palavras.length + 2 * (a.numeros.length + b.numeros.length));
    if (!melhor || nota > melhor.nota) melhor = { c, nota };
  }
  return melhor && melhor.nota >= 0.6 ? melhor.c : null;
}
