/**
 * NOVIDADE AUTOMÁTICA A PARTIR DO CHAMADO CONCLUÍDO — a parte que pensa.
 *
 * Quando um Chamado de Sistemas é concluído, o ERP conta sozinho o que mudou
 * no changelog interno (Novidades do Sistema). Este arquivo tem só a lógica
 * pura: o que mandar para a IA, o que aceitar de volta e o que descartar.
 *
 * Está em _shared/ e sem import de Deno/Supabase de propósito — é o que os
 * testes do vitest carregam (mesmo arranjo de whatsapp-bot.ts), e é o que
 * garante que a regra de "o que vira novidade" seja testável sem rede.
 */

/** Os quatro selos de SISTEMA_NOVIDADES (espelha src/lib/novidades.ts). */
export type TipoNovidade = "NOVO" | "MELHORIA" | "AJUSTE" | "AVISO";
export const TIPOS_NOVIDADE: TipoNovidade[] = ["NOVO", "MELHORIA", "AJUSTE", "AVISO"];

/** Groq, mesmo modelo padrão do bot do WhatsApp (_shared/whatsapp-bot.ts). */
export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const MODELO_PADRAO = "llama-3.3-70b-versatile";

export interface ChamadoParaNovidade {
  id: string;
  numero: string | null;
  assunto: string;
  tipo_solicitacao: string | null;
  descricao: string | null;
  categorias: string[] | null;
  modulo_sistema: string | null;
  modulo_sistema_outro: string | null;
  ambiente: string | null;
  status: string;
  concluido_em: string | null;
  solicitante_nome: string | null;
  setor: string | null;
}

export interface SaidaIA {
  relevante: boolean;
  tipo: TipoNovidade;
  titulo: string;
  descricao: string;
}

/** Motivo do descarte — vai para o log, é o que explica "por que não saiu". */
export type Descarte =
  | "duvida"          // orientação a usuário: não mudou nada no sistema
  | "nao_producao"    // homologação/teste: ninguém sente ainda
  | "ia_descartou"    // a própria IA achou que não há o que anunciar
  | "resposta_invalida";

export type Resultado =
  | { publicar: true; novidade: SaidaIA }
  | { publicar: false; motivo: Descarte; detalhe?: string };

// ── Antes da IA: o que nem chega a virar prompt ──────────────────────────

/**
 * Chamado de "Dúvida / Orientação" não vira novidade: ninguém mexeu no
 * sistema, alguém foi ensinado a usá-lo. Publicar isso encheria o sino com
 * "agora você já sabe onde clica" e faria a equipe parar de ler o changelog.
 *
 * Ambiente que não é produção também sai: a correção existe, mas ainda não
 * chegou em quem usa — anunciar cedo gera chamado de "não achei essa tela".
 */
export function descartePrevio(c: ChamadoParaNovidade): Descarte | null {
  if ((c.tipo_solicitacao ?? "") === "duvida") return "duvida";
  if ((c.ambiente ?? "producao") !== "producao") return "nao_producao";
  return null;
}

/**
 * O selo sugerido pelo tipo do chamado. É só um palpite passado à IA — ela
 * pode discordar lendo a descrição (um "ajuste" que na prática virou tela
 * nova), e por isso a saída dela é que vale.
 */
export const SELO_SUGERIDO: Record<string, TipoNovidade> = {
  correcao: "AJUSTE",
  ajuste: "AJUSTE",
  melhoria: "MELHORIA",
  outro: "NOVO",
};

// ── O prompt ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Você escreve o changelog interno do ERP do Grupo Nascimento — as "Novidades do Sistema" que todo funcionário lê no sino do topo da tela.

Você recebe um chamado de suporte que ACABOU DE SER CONCLUÍDO pela equipe de Sistemas. Sua tarefa é transformá-lo em UM aviso curto para quem usa o sistema.

REGRAS ABSOLUTAS — quebrar qualquer uma delas é falha grave:
1. NUNCA cite o número do chamado, o nome de quem abriu, o nome de quem resolveu, o setor de origem, nem qualquer pessoa.
2. NUNCA use vocabulário técnico interno (tabela, coluna, RLS, deploy, hook, componente, endpoint, migration, PR, branch, cache, query, bug). Escreva para uma pessoa do administrativo, não para um programador.
3. NUNCA repita a reclamação. O chamado diz o que ESTAVA errado; a novidade diz o que AGORA funciona. Escreva no presente e no positivo.
4. NUNCA invente funcionalidade, tela, botão ou prazo que não esteja no chamado. Se o chamado não explica o que mudou para o usuário, marque relevante = false.
5. Português do Brasil, tom direto e cordial, sem emoji, sem exclamação, sem "estamos felizes em anunciar".

QUANDO MARCAR relevante = false:
- O chamado é de acesso, senha, permissão ou cadastro de UMA pessoa (não muda nada para os outros).
- É configuração interna, teste, ou algo que o usuário final não vê.
- A descrição é vaga demais para dizer honestamente o que melhorou.
Na dúvida, marque false. Um changelog com menos linhas e todas úteis vale mais que um cheio de ruído.

TIPO (escolha um):
- "AJUSTE": algo que estava errado voltou a funcionar.
- "MELHORIA": algo que já funcionava ficou melhor, mais rápido ou mais simples.
- "NOVO": passou a existir uma tela, campo, relatório ou possibilidade que não existia.
- "AVISO": mudança de processo que a pessoa precisa saber para não errar.

FORMATO — responda APENAS com este JSON, sem texto antes ou depois:
{"relevante": true|false, "tipo": "NOVO"|"MELHORIA"|"AJUSTE"|"AVISO", "titulo": "...", "descricao": "..."}

- "titulo": no máximo 70 caracteres, diz o que mudou. Sem ponto final.
- "descricao": 1 a 3 frases (no máximo 350 caracteres). Diz o que a pessoa consegue fazer agora, e onde.
- Se relevante = false, devolva titulo e descricao como "".`;

/** O chamado, do jeito que a IA lê. Sem id, sem número, sem nome de gente. */
export function montarPrompt(c: ChamadoParaNovidade, prTitulo?: string | null): string {
  const linhas: string[] = [
    `Assunto: ${c.assunto}`,
    `Tipo de solicitação: ${c.tipo_solicitacao ?? "não informado"}`,
    `Módulo do ERP: ${c.modulo_sistema === "outro" ? (c.modulo_sistema_outro ?? "outro") : (c.modulo_sistema ?? "não informado")}`,
  ];
  if (c.categorias?.length) linhas.push(`Categorias: ${c.categorias.join(", ")}`);
  if (c.descricao?.trim()) linhas.push(`\nO que foi relatado:\n${c.descricao.trim().slice(0, 2000)}`);
  // O título da PR é a melhor pista do que o dev REALMENTE entregou — muitas
  // vezes o relato do usuário descreve o sintoma e não a mudança.
  if (prTitulo?.trim()) linhas.push(`\nEntrega registrada pela equipe: ${prTitulo.trim().slice(0, 300)}`);

  const selo = SELO_SUGERIDO[c.tipo_solicitacao ?? ""] ?? null;
  if (selo) linhas.push(`\nSelo sugerido pelo tipo do chamado: ${selo} (você pode discordar).`);

  return `${linhas.join("\n")}\n\nEscreva a novidade em JSON.`;
}

// ── Depois da IA: o que aceitamos publicar ───────────────────────────────

/**
 * Última barreira contra vazamento. O prompt já proíbe, mas prompt não é
 * garantia — e aqui a novidade sai direto para a empresa inteira, sem
 * revisão humana no caminho. O que escapar destes três padrões é reescrito
 * antes de ir para o banco, não depois.
 */
export function limparVazamentos(texto: string, c: ChamadoParaNovidade): string {
  let t = texto;
  if (c.numero) t = t.replaceAll(c.numero, "").replace(/\s{2,}/g, " ");
  t = t.replace(/\bSIS-\d{4}-\d+\b/g, "").replace(/\s{2,}/g, " ");
  // Nome do solicitante, inteiro ou só o primeiro nome (a IA costuma abreviar).
  const nome = (c.solicitante_nome ?? "").trim();
  if (nome.length >= 3) {
    for (const parte of [nome, nome.split(/\s+/)[0]]) {
      if (parte.length >= 3) {
        t = t.replace(new RegExp(`\\b${parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "");
      }
    }
  }
  return t.replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").trim();
}

const LIMITE_TITULO = 90;
const LIMITE_DESCRICAO = 400;

/** Extrai o JSON mesmo se o modelo embrulhar em ```json ... ```. */
export function extrairJson(bruto: string): unknown | null {
  const t = String(bruto ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch { /* segue */ }
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try { return JSON.parse(t.slice(ini, fim + 1)); } catch { return null; }
}

/**
 * Valida e limpa o que a IA devolveu. Devolve o que publicar, ou o motivo de
 * não publicar — nunca lança, porque isto roda depois do chamado já concluído
 * e falhar aqui não pode desfazer nada.
 */
export function decidir(bruto: unknown, c: ChamadoParaNovidade): Resultado {
  const previo = descartePrevio(c);
  if (previo) return { publicar: false, motivo: previo };

  const o = bruto as Record<string, unknown> | null;
  if (!o || typeof o !== "object") {
    return { publicar: false, motivo: "resposta_invalida", detalhe: "resposta não é um objeto" };
  }
  if (o.relevante !== true) return { publicar: false, motivo: "ia_descartou" };

  const tipo = String(o.tipo ?? "").toUpperCase() as TipoNovidade;
  if (!TIPOS_NOVIDADE.includes(tipo)) {
    return { publicar: false, motivo: "resposta_invalida", detalhe: `tipo inválido: ${o.tipo}` };
  }

  const titulo = limparVazamentos(String(o.titulo ?? "").trim(), c).replace(/\.$/, "");
  const descricao = limparVazamentos(String(o.descricao ?? "").trim(), c);

  // Os mesmos mínimos que validarNovidade() cobra de quem escreve à mão: uma
  // novidade que não diz nada não é melhor que novidade nenhuma.
  if (titulo.length < 4) return { publicar: false, motivo: "resposta_invalida", detalhe: "título curto" };
  if (descricao.length < 15) return { publicar: false, motivo: "resposta_invalida", detalhe: "descrição curta" };

  return {
    publicar: true,
    novidade: {
      relevante: true,
      tipo,
      titulo: titulo.slice(0, LIMITE_TITULO),
      descricao: descricao.slice(0, LIMITE_DESCRICAO),
    },
  };
}
