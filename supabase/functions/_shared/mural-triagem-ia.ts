// Arquivo: supabase/functions/_shared/mural-triagem-ia.ts
//
// Triagem por IA do Mural do Início (12/11/2026, Pablo: "preciso que a i.a
// sugira quais elogios não vão pro mural do inicio tipo: tem um comentário
// que fala que é mais competente que o lider, que deveria ser o lider do
// setor, coisas assim"). Parte pura, sem Deno nem fetch: a Edge
// mural-triagem-ia monta o prompt e lê a resposta por aqui, e o teste
// src/test/mural-triagem-ia.test.ts trava o formato.
//
// A IA só SUGERE: o comentário não recomendado fica pendente e desabilitado
// na tela, e quem modera pode habilitar. Por isso, na dúvida, o prompt pede
// para recomendar — o freio é para o que claramente não cabe num mural
// público, não para elogio simples.

/** Comentários por chamada à IA — cabe folgado no contexto e responde rápido. */
export const TAMANHO_LOTE = 40;
/** Motivo mostrado na tela: uma frase curta. */
export const LIMITE_MOTIVO = 160;

export interface ComentarioParaTriagem {
  colaborador: string;
  setor?: string | null;
  comentario: string;
}

export interface ResultadoTriagem {
  /** Índice do comentário dentro do lote. */
  indice: number;
  recomendado: boolean;
  motivo: string | null;
}

export const SYSTEM_PROMPT_TRIAGEM = `Você revisa elogios entre colegas de trabalho antes de irem para um MURAL PÚBLICO de reconhecimento, que todos os funcionários da empresa leem (o nome de quem escreveu não aparece; o nome de quem recebeu, sim).

Marque como NÃO recomendado ("publicar": false) o comentário que, mesmo elogiando, tenha algo disto:
- comparação com o líder, chefe, gestor ou colegas ("mais competente que o líder", "deveria ser o líder do setor", "faz o trabalho que o chefe não faz", "o único que trabalha aqui");
- crítica, reclamação ou indireta a outra pessoa, setor ou à empresa (inclusive disfarçada de elogio);
- pedido ou sugestão de promoção, aumento, troca de cargo ou de liderança;
- assunto pessoal ou sensível: saúde, família, religião, política, aparência física, vida amorosa, salário, dados pessoais;
- tom de flerte, intimidade excessiva, ironia, deboche, palavrão;
- informação interna/confidencial (cliente, contrato, valores, processo, denúncia).

Elogio simples, genérico, curto ou com erro de português É recomendado ("publicar": true). Na dúvida, recomende.

Responda SOMENTE com JSON, sem texto fora dele, no formato:
{"itens":[{"id":0,"publicar":true},{"id":1,"publicar":false,"motivo":"Compara com o líder do setor"}]}
Um item por comentário recebido, com o mesmo id. "motivo" só quando "publicar" for false: uma frase curta em português (até 12 palavras), sem repetir o comentário.`;

const limpar = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Mensagem do usuário com o lote numerado (id = índice no lote). */
export function montarPromptTriagem(lote: ComentarioParaTriagem[]): string {
  const linhas = lote.map((c, i) => JSON.stringify({
    id: i,
    para: limpar(c.colaborador, 80),
    setor: limpar(c.setor, 60) || undefined,
    comentario: limpar(c.comentario, 1200),
  }));
  return `Comentários (${lote.length}):\n${linhas.join("\n")}`;
}

/** Fatia a lista em lotes de `tamanho`. */
export function emLotes<T>(lista: T[], tamanho = TAMANHO_LOTE): T[][] {
  const t = Math.max(1, Math.floor(tamanho));
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += t) lotes.push(lista.slice(i, i + t));
  return lotes;
}

/** JSON da resposta, tolerando cerca de markdown e texto em volta. */
export function extrairJsonTriagem(bruto: string): unknown | null {
  const t = String(bruto ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* segue */ }
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

const lerBool = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "sim", "1"].includes(s)) return true;
  if (["false", "nao", "não", "0"].includes(s)) return false;
  return null;
};

/**
 * Resultado válido de cada comentário do lote. O que a IA não devolveu (ou
 * devolveu torto) fica de fora — sem triagem, a tela trata como hoje e a
 * próxima abertura tenta de novo. Id repetido: vale o primeiro. Não
 * recomendado sem motivo ganha um motivo genérico, para a tela nunca mostrar
 * um bloqueio sem explicação.
 */
export function lerResultadoTriagem(bruto: string, tamanhoLote: number): ResultadoTriagem[] {
  const json = extrairJsonTriagem(bruto) as { itens?: unknown } | unknown[] | null;
  const itens = Array.isArray(json) ? json : Array.isArray((json as { itens?: unknown })?.itens) ? (json as { itens: unknown[] }).itens : [];
  const vistos = new Set<number>();
  const saida: ResultadoTriagem[] = [];
  for (const it of itens) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const indice = Number(o.id);
    if (!Number.isInteger(indice) || indice < 0 || indice >= tamanhoLote || vistos.has(indice)) continue;
    const recomendado = lerBool(o.publicar ?? o.recomendado);
    if (recomendado == null) continue;
    vistos.add(indice);
    const motivo = recomendado ? null : (limpar(o.motivo, LIMITE_MOTIVO) || "Pode não ser adequado para o mural público");
    saida.push({ indice, recomendado, motivo });
  }
  return saida.sort((a, b) => a.indice - b.indice);
}
