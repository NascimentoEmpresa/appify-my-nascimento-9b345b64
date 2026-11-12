/**
 * Mural de Reconhecimento do Início (30/10/2026).
 *
 * Os comentários vêm da pergunta "colegas" dos Formulários (ex.: AVALIAÇÃO DE
 * RECONHECIMENTO E CONVIVÊNCIA PROFISSIONAL): cada linha é
 * {colaborador, setor, nota, comentario}. Vai para o painel inicial só o que
 * passa nas TRÊS travas:
 *
 *   1. POSITIVO — nota >= 80% do topo da escala da pergunta (escala 5 → 4 ou
 *      5) e comentário com texto. É o filtro automático.
 *   2. LIBERADO — alguém com acesso às permissões do formulário
 *      (cs_form_pode(_, 'acesso'), o botão "Acesso") leu e liberou.
 *   3. (até 12/11/2026) MÊS ANTERIOR — mês civil de Brasília anterior ao de
 *      hoje. Saiu: o Início mostra todo mês publicado, com setas para passar
 *      de um para o outro (mesesDoMural, mig 20261112210000).
 *
 * QUEM DECIDE É O BANCO (migration 20261030003200: cs_form_mural_positivo,
 * cs_form_mural_inicio). Este arquivo espelha a mesma regra para a tela de
 * moderação e como segunda checagem no cartão — mudou lá, muda aqui (o teste
 * src/test/mural-reconhecimento.test.ts trava os números).
 */

/** Fração do topo da escala a partir da qual a nota é "positiva". */
export const PROPORCAO_POSITIVA = 0.8;
/** Comentário com menos que isso ("ok", "-") não é recado. */
export const MIN_CARACTERES_COMENTARIO = 3;

export type StatusMural = "pendente" | "liberado" | "recusado";

export interface LinhaMural {
  colaborador: string;
  setor?: string | null;
  nota?: number | string | null;
  escala?: number | null;
  comentario?: string | null;
  enviado_em: string;
  status?: StatusMural | null;
}

/** Menor nota que conta como positiva numa escala de 1 a `escalaMax`. */
export function notaMinimaPositiva(escalaMax?: number | null): number {
  const escala = Math.max(2, Number.isFinite(Number(escalaMax)) && escalaMax ? Number(escalaMax) : 5);
  // Arredonda o produto antes do teto: 5 * 0.8 dá 4.000000000000001 em ponto
  // flutuante e o teto viraria 5. O banco faz a conta em numeric e dá 4.
  return Math.ceil(Number((escala * PROPORCAO_POSITIVA).toFixed(6)));
}

/** Nota da linha como número (aceita "4", "4,5", 4); null se não for nota. */
export function lerNota(nota: unknown): number | null {
  if (typeof nota === "number") return Number.isFinite(nota) ? nota : null;
  const t = String(nota ?? "").trim();
  if (!/^[0-9]+([.,][0-9]+)?$/.test(t)) return null;
  return Number(t.replace(",", "."));
}

/** A linha é positiva? Mesma conta de cs_form_mural_positivo. */
export function ehComentarioPositivo(linha: Pick<LinhaMural, "nota" | "comentario" | "escala">): boolean {
  if (String(linha.comentario ?? "").trim().length < MIN_CARACTERES_COMENTARIO) return false;
  const n = lerNota(linha.nota);
  return n != null && n >= notaMinimaPositiva(linha.escala);
}

const FMT_MES = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" });

/** "AAAA-MM" do instante, no relógio de Brasília. */
export function mesDeBrasilia(instante: Date | string): string {
  const d = typeof instante === "string" ? new Date(instante) : instante;
  const partes = FMT_MES.formatToParts(d);
  const ano = partes.find((p) => p.type === "year")?.value ?? "";
  const mes = partes.find((p) => p.type === "month")?.value ?? "";
  return `${ano}-${mes}`;
}

/** Desloca "AAAA-MM" em `delta` meses. */
export function somarMes(ym: string, delta: number): string {
  const [a, m] = ym.split("-").map(Number);
  const total = a * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** Mês anterior ao de `hoje` em Brasília — o mês que o mural do Início mostra. */
export function mesAnterior(hoje: Date = new Date()): string {
  return somarMes(mesDeBrasilia(hoje), -1);
}

/**
 * O que o cartão do Início pode mostrar, agrupado por mês (12/11/2026).
 *
 * Antes era filtrarMural: liberado + positivo + SÓ o mês anterior. Foi esse
 * "só o mês anterior" que sumiu com setembro do Início em novembro, mesmo
 * liberado pela Fernanda (mig 20261112210000). Agora todo mês que tem algo
 * liberado vira uma página do cartão, do mais novo ao mais velho; o mês vem
 * do envio no relógio de Brasília, mesma conta do banco.
 */
export function mesesDoMural<T extends LinhaMural>(linhas: T[]): { mes: string; itens: T[] }[] {
  const porMes = new Map<string, T[]>();
  for (const l of linhas) {
    if (l.status !== "liberado" || !ehComentarioPositivo(l)) continue;
    const mes = mesDeBrasilia(l.enviado_em);
    const lista = porMes.get(mes);
    if (lista) lista.push(l); else porMes.set(mes, [l]);
  }
  return [...porMes.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mes, itens]) => ({ mes, itens }));
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "outubro de 2026". */
export function rotuloMes(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES[m - 1] ?? "?"} de ${a}`;
}

// ---------------------------------------------------------------------
// RANKING (03/11/2026, pedido do Pablo)
//
// A moderação deixou de ser uma fila de 345 comentários soltos: cada pessoa
// aparece uma vez, do 1º ao último, pela QUANTIDADE de comentários positivos
// recebidos no mês; empate vai para a NOTA MÉDIA, e depois o nome (só para a
// ordem não pular entre recargas — o nome não dá posição).
//
// Aqui também morava a trava "só libera a partir do dia 20 do mês seguinte"
// (dataLiberacao/podeLiberar, espelho do trigger da mig 20261103001300). Saiu
// em 12/11/2026 a pedido do Pablo — publica quando quiser, com DUAS
// confirmações seguidas na tela (MuralModeracao) — e o trigger saiu junto
// (mig 20261112210000).
// ---------------------------------------------------------------------

export interface PessoaRanking<T> {
  /** 1, 2, 3… — empate em quantidade E média divide a posição (1, 1, 3). */
  posicao: number;
  colaborador: string;
  setor: string | null;
  total: number;
  /** Média das notas lidas; null se nenhuma nota for número. */
  media: number | null;
  itens: T[];
}

/**
 * Agrupa os comentários por pessoa avaliada e ordena: mais comentários
 * positivos primeiro, nota média como desempate. O nome é comparado sem
 * caixa nem espaços nas pontas (a pergunta "colegas" grava o Nome do
 * cadastro, mas uma resposta antiga pode vir digitada).
 */
export function rankingMural<T extends Pick<LinhaMural, "colaborador" | "setor" | "nota">>(linhas: T[]): PessoaRanking<T>[] {
  const grupos = new Map<string, { colaborador: string; setores: Map<string, number>; itens: T[]; soma: number; notas: number }>();
  for (const l of linhas) {
    const chave = String(l.colaborador ?? "").trim().toUpperCase();
    if (!chave) continue;
    let g = grupos.get(chave);
    if (!g) { g = { colaborador: String(l.colaborador).trim(), setores: new Map(), itens: [], soma: 0, notas: 0 }; grupos.set(chave, g); }
    g.itens.push(l);
    const s = String(l.setor ?? "").trim();
    if (s) g.setores.set(s, (g.setores.get(s) ?? 0) + 1);
    const n = lerNota(l.nota);
    if (n != null) { g.soma += n; g.notas += 1; }
  }

  const lista = [...grupos.values()].map((g) => ({
    colaborador: g.colaborador,
    // Setor mais citado nos votos (cada votante escolhe o setor do colega).
    setor: [...g.setores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null,
    total: g.itens.length,
    media: g.notas ? g.soma / g.notas : null,
    itens: g.itens,
  }));
  lista.sort((a, b) =>
    b.total - a.total
    || (b.media ?? -1) - (a.media ?? -1)
    || a.colaborador.localeCompare(b.colaborador, "pt-BR"));

  let posicao = 0;
  return lista.map((p, i) => {
    const ant = lista[i - 1];
    if (!ant || ant.total !== p.total || (ant.media ?? -1) !== (p.media ?? -1)) posicao = i + 1;
    return { ...p, posicao };
  });
}

/**
 * Todos os recados de UMA pessoa, mês a mês (12/11/2026, Pablo: "no mural
 * inicial ao clicar no nome de uma pessoa deve aparecer todos comentários
 * bons que apareceram pra ela"). Recebe os meses que o cartão já tem (só o
 * publicado) e devolve, do mês mais novo ao mais velho, os recados dela —
 * mês sem recado dela fica de fora. Nome comparado sem caixa nem espaços nas
 * pontas, como no ranking.
 */
export function recadosDaPessoa<T extends Pick<LinhaMural, "colaborador">>(
  meses: { mes: string; itens: T[] }[],
  colaborador: string,
): { mes: string; itens: T[] }[] {
  const alvo = String(colaborador ?? "").trim().toUpperCase();
  if (!alvo) return [];
  return [...meses]
    .sort((a, b) => b.mes.localeCompare(a.mes))
    .map(({ mes, itens }) => ({ mes, itens: itens.filter((i) => String(i.colaborador ?? "").trim().toUpperCase() === alvo) }))
    .filter((b) => b.itens.length > 0);
}

/**
 * PRÉVIA do cartão do Início (06/11/2026, Pablo: "tem que ter uma prévia pra
 * ver como fica antes de ser publicado"): o que JÁ está no mural mais o que
 * está para ser liberado, nunca o recusado. Um recado entra uma vez só,
 * mesmo que já esteja liberado e também na lista a liberar. Ordem do
 * ranking: quem tem mais recados primeiro, cada um com os seus em sequência,
 * do mais antigo ao mais novo.
 */
export function itensDaPrevia<T extends LinhaMural>(
  todos: T[],
  aLiberar: T[],
  chave: (l: T) => string,
): T[] {
  const vistos = new Set<string>();
  const juntos: T[] = [];
  for (const l of [...todos.filter((x) => x.status === "liberado"), ...aLiberar]) {
    if (l.status === "recusado") continue;
    const k = chave(l);
    if (vistos.has(k)) continue;
    vistos.add(k);
    juntos.push(l);
  }
  return rankingMural(juntos).flatMap((p) =>
    [...p.itens].sort((a, b) => String(a.enviado_em).localeCompare(String(b.enviado_em))));
}
