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
// na tela, e quem modera pode habilitar.
//
// v2 (12/11/2026, Pablo: "a i.a não tá sugerindo nada de descente [...] dá
// pra tirar bem mais comentários que podem ser um risco"). A v1 deixou passar,
// nos meses de setembro e outubro, quase tudo o que a revisão humana tirou:
// crítica a quem ocupava o cargo antes ("antes tinha muitas pendências",
// "superior ao seu antecessor"), problema interno exposto ("não consigo
// apresentar à minha líder", "agora que estamos precisando de ajuda"),
// ressalva no meio do elogio ("às vezes fica bem bravo", "pouco tímida",
// "ponto de desenvolvimento") e comentário sobre gênero. E travou o que a
// revisão LIBEROU: bênção religiosa, carinho ("segunda mãe"), elogio leve à
// aparência, "melhor líder". Por isso a v2:
//   - inverte o desempate: na dúvida, NÃO recomenda (desabilitar custa um
//     clique para habilitar; publicar o errado no Início não tem volta);
//   - dá a régua com exemplos do que a revisão tirou e do que ela deixou;
//   - exige o TRECHO exato que pesou, que vai junto do motivo na tela — quem
//     modera vê na hora por que caiu, e a IA precisa apontar algo concreto;
//   - lê em lotes menores (20), que é onde ela parava de prestar atenção.
//
// VERSAO_TRIAGEM vai gravada no início do `modelo`. Comentário pendente que
// uma versão anterior RECOMENDOU é lido de novo pela atual (ver
// precisaTriagem); o que já foi desabilitado, ou habilitado à mão, não é
// tocado — a releitura só pode acrescentar sinalização, nunca desfazer uma
// decisão de quem modera.

/** Gravada no começo de `modelo` ("v2|gemini:..."). Troque ao mudar a régua. */
export const VERSAO_TRIAGEM = "v2";
/** Comentários por chamada à IA — lote pequeno para ela ler cada um com atenção. */
export const TAMANHO_LOTE = 20;
/** Motivo mostrado na tela: frase curta + o trecho que pesou. */
export const LIMITE_MOTIVO = 160;
/** Trecho citado no motivo. */
const LIMITE_TRECHO = 90;

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

export const SYSTEM_PROMPT_TRIAGEM = `Você revisa elogios entre colegas de trabalho antes de irem para um MURAL PÚBLICO de reconhecimento no sistema da empresa. Todos os funcionários leem — inclusive os líderes, a diretoria e as pessoas citadas ou insinuadas no texto. O nome de quem escreveu não aparece; o de quem recebeu, sim.

O risco não é o elogio: é a FRASE que, lida por outra pessoa da empresa, expõe, constrange ou acusa alguém. Leia o comentário inteiro, frase por frase — o problema costuma estar escondido no meio de um elogio longo, depois de um "mas", "mesmo", "às vezes", "antes", "agora que", "inclusive", "é uma pena".

NÃO recomende ("publicar": false) se QUALQUER trecho tiver:
1. Crítica, indireta ou comparação que diminui OUTRA pessoa, setor, liderança ou a empresa — mesmo sem nome, mesmo de leve:
   "superior ao seu antecessor"; "antes tinha muitas pendências e não era seguido processo"; "alguns setores são liderados por pessoas sem capacidade"; "os líderes deveriam ser um pouco como ela"; "mais conhecimento do que muitos que estão há anos"; "sem procurar culpados"; "uma injustiça terem tirado ele do cargo"; "uma ajuda melhor do que a do SST".
2. Problema interno exposto: conflito, dificuldade com o próprio líder, setor sobrecarregado ou desorganizado, decisão da empresa contestada:
   "dificuldade que não consigo apresentar à minha líder"; "agora que estamos precisando de ajuda no setor"; "mesmo com toda a correria"; "comparando com quando ela liderava".
3. Defeito, ressalva ou ponto de melhoria sobre a própria pessoa elogiada, mesmo em tom de brincadeira:
   "às vezes fica bem bravo"; "pouco tímida só"; "como ponto de desenvolvimento, pode aprimorar..."; "traz problemas kkkk"; "muito chato mas parceiro"; "às vezes se apega a coisas supérfluas"; "passei a olhar para ele de outra forma desde que assumiu".
4. Pedido ou sugestão de promoção, efetivação, aumento, cargo, liderança ou "mais oportunidades": "deveria estar como líder do setor"; "merece uma efetivação"; "deveria estar em um cargo mais alto".
5. Gênero, idade, raça, corpo, saúde, salário, política ou vida amorosa usados como critério ou comentário: "independente se é homem ou mulher tem o respeito"; flerte ou duplo sentido.
6. Informação interna sensível: valores, cliente, denúncia, processo judicial, demissão, punição.
7. Texto quebrado ou ilegível que vai aparecer assim no mural ("TEM AÇ~~ÕES").

PODE publicar ("publicar": true) — a revisão humana desta empresa libera isto:
- elogio simples, curto, genérico, repetido ou com erro de português ("comprometido", "dedidaca", "SEMPRE DISPOSTO A AJUDAR");
- carinho e proximidade sem duplo sentido ("segunda mãe", "te adoro", "minha best", "mora no meu coração");
- bênção ou menção religiosa leve ("que Deus te abençoe", "sempre traz uma palavra de Deus");
- elogio leve à aparência ou ao jeito ("linda, maravilhosa", "seu bigode é um querido");
- elogio à liderança da própria pessoa ("ótima líder", "melhor líder", "um dos melhores líderes") — desde que não rebaixe outra pessoa;
- contar que a pessoa assumiu cargo novo e está indo bem ("está se saindo muito bem na nova função").

Na dúvida entre os dois, NÃO recomende: quem modera habilita com um clique, mas o que for ao mural não tem volta.

Responda SOMENTE com JSON, sem texto fora dele, no formato:
{"itens":[{"id":0,"publicar":true},{"id":1,"publicar":false,"motivo":"Critica quem ocupava o cargo antes","trecho":"superior ao seu antecessor"}]}
Um item por comentário recebido, com o mesmo id. Quando "publicar" for false: "motivo" é uma frase curta em português (até 10 palavras) e "trecho" é a parte EXATA do comentário que pesou, copiada letra por letra (até 12 palavras).`;

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
    const motivo = recomendado ? null : motivoComTrecho(o.motivo, o.trecho);
    saida.push({ indice, recomendado, motivo });
  }
  return saida.sort((a, b) => a.indice - b.indice);
}

/**
 * Motivo da tela: "Critica quem ocupava o cargo antes — “superior ao seu
 * antecessor”". O trecho é cortado primeiro, para o motivo nunca sumir.
 */
export function motivoComTrecho(motivoBruto: unknown, trechoBruto: unknown): string {
  const motivo = limpar(motivoBruto, LIMITE_MOTIVO) || "Pode não ser adequado para o mural público";
  const trecho = limpar(trechoBruto, LIMITE_TRECHO).replace(/^["“”']+|["“”']+$/g, "");
  if (!trecho) return motivo;
  const cabe = LIMITE_MOTIVO - motivo.length - 5; // " — “" + "”"
  if (cabe < 12) return motivo;
  const t = trecho.length > cabe ? `${trecho.slice(0, cabe - 1).trimEnd()}…` : trecho;
  return `${motivo} — “${t}”`;
}

/** `modelo` gravado: versão da régua + provedor ("v2|gemini:gemini-3.6-flash"). */
export function modeloComVersao(modelo: string | null | undefined): string {
  return `${VERSAO_TRIAGEM}|${modelo ?? "?"}`.slice(0, 80);
}

interface LinhaParaDecidir {
  status: string;
  triado: boolean;
  recomendado: boolean | null;
  habilitado?: boolean;
  modelo?: string | null;
}

/**
 * A IA precisa ler (ou reler) este comentário?
 *   - só pendente (o que está no mural ou recusado já foi decidido);
 *   - nunca lido → sim;
 *   - lido por uma versão ANTERIOR da régua e recomendado → sim, para a régua
 *     nova poder sinalizar o que a antiga deixou passar;
 *   - já sinalizado (desabilitado ou habilitado à mão) → não: a releitura
 *     não pode desfazer o que quem modera decidiu.
 */
export function precisaTriagem(l: LinhaParaDecidir): boolean {
  if (l.status !== "pendente") return false;
  if (!l.triado) return true;
  if (l.recomendado === false || l.habilitado) return false;
  // Banco sem a mig 20261114000100 não devolve `modelo` (undefined, não
  // null): sem saber a versão, não relê — senão gastaria token relendo
  // tudo a cada abertura do modal.
  if (l.modelo === undefined) return false;
  return !String(l.modelo ?? "").startsWith(`${VERSAO_TRIAGEM}|`);
}
