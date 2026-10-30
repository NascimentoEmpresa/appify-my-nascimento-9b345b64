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
 *   3. MÊS ANTERIOR — mês civil de Brasília anterior ao de hoje. Em
 *      novembro aparecem os de outubro.
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

/** O que o cartão do Início pode mostrar: liberado + positivo + mês anterior. */
export function filtrarMural<T extends LinhaMural>(linhas: T[], hoje: Date = new Date()): T[] {
  const alvo = mesAnterior(hoje);
  return linhas.filter((l) =>
    l.status === "liberado"
    && ehComentarioPositivo(l)
    && mesDeBrasilia(l.enviado_em) === alvo);
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** "outubro de 2026". */
export function rotuloMes(ym: string): string {
  const [a, m] = ym.split("-").map(Number);
  return `${MESES[m - 1] ?? "?"} de ${a}`;
}
