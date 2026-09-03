/**
 * ÍNDICE DO PAINEL DE FORMULÁRIOS — lógica pura do chat lateral (SIS-2026-0311).
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO
 *   O chat responde "onde eu acho o colaborador X?". Deixar o modelo procurar
 *   sozinho dentro de um monte de texto foi descartado na origem: o solicitante
 *   pediu, com todas as letras, que a IA não diga que alguém não existe quando
 *   existe. Então a busca é DETERMINÍSTICA e acontece aqui, em código; o modelo
 *   só redige o que estas funções acharam. É a mesma divisão que o diagnóstico
 *   já usa para os números ("a tarefa do modelo é exclusivamente semântica").
 *
 * O QUE O CHAT VÊ, E O QUE NÃO VÊ
 *   Vê um ÍNDICE: quem existe, em que setor, em que formulário, quantas
 *   respostas. NUNCA vê o texto dos feedbacks — esse continua sendo assunto do
 *   diagnóstico anônimo, que passa por limparNomesProprios antes de sair. Nome
 *   e setor o usuário já lê nas outras abas do painel; o que a pessoa escreveu,
 *   não sai daqui.
 *
 * Sem import de Deno ou Supabase, para a mesma regra rodar no Vitest sem rede.
 * Também sem import de OUTRO arquivo do _shared, de propósito: o editor web do
 * Supabase sobe só os arquivos listados na tela de deploy, e cada import
 * relativo a mais é mais um arquivo para lembrar de colar lá. Por isso a
 * normalização abaixo é repetida em vez de importada de diagnostico-feedback.ts
 * — são quatro linhas, e elas precisam ficar idênticas às de lá.
 */

export interface PerguntaPainel {
  id: string;
  tipo: string;
  titulo: string;
}

export interface FormularioPainel {
  id: string;
  titulo: string;
  perguntas?: PerguntaPainel[] | null;
}

export interface RespostaPainel {
  id?: string;
  formulario_id?: string | null;
  setor?: string | null;
  respondente_nome?: string | null;
  itens?: Record<string, unknown> | null;
  [campo: string]: unknown;
}

export type PapelPessoa = "respondente" | "avaliado";

export interface PessoaIndice {
  nome: string;
  /** Chave de comparação: sem acento, caixa alta, espaços colapsados. */
  nome_norm: string;
  papeis: PapelPessoa[];
  setores: string[];
  formularios: string[];
  qtd_respostas: number;
}

export interface SetorIndice {
  setor: string;
  qtd_respostas: number;
  formularios: string[];
}

export interface FormularioIndice {
  id: string;
  titulo: string;
  qtd_respostas: number;
}

export interface IndicePainel {
  formularios: FormularioIndice[];
  setores: SetorIndice[];
  pessoas: PessoaIndice[];
  total_respostas: number;
  abas: string[];
}

export interface ResultadoBusca {
  achados: PessoaIndice[];
  parecidos: PessoaIndice[];
}

/** Tetos de payload e de custo — o free tier da IA não é infinito. */
export const MAX_PERGUNTA_CHARS = 500;
export const MAX_MENSAGENS_HISTORICO = 8;
export const MAX_PESSOAS_PROMPT = 60;

/** As abas do Painel Gerencial, para a IA saber o caminho que ela indica. */
export const ABAS_PAINEL = [
  "Visão Executiva", "Cumprimento", "Desenvolvimento", "Liderança",
  "Alinhamento e Entrega", "Diagnóstico IA", "Planos de Ação",
  "Histórico Individual", "Indicadores e Cálculos",
];

/**
 * Preposições e conectivos de nome. Ficam fora da comparação porque casariam
 * com qualquer frase: "DA" e "DE" aparecem em toda pergunta que o usuário faz.
 */
const TOKENS_IGNORADOS = new Set([
  "de", "da", "das", "do", "dos", "e", "o", "a", "os", "as",
]);

const REGEX_TOKEN = /\p{L}[\p{L}\p{M}'’-]*/gu;

/**
 * Mesma normalização de normalizaSetor() do diagnostico-feedback.ts (sem
 * acento, caixa alta, espaço colapsado) — o problema é idêntico: "JURÍDICO"/
 * "juridico" e "EDUARDO"/"Eduardo" precisam cair na mesma chave. Repetida aqui
 * para este arquivo não depender daquele; ver o cabeçalho.
 */
export const normalizaNome = (valor: unknown): string => String(valor ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .replace(/\s+/g, " ")
  .toUpperCase();

/** Tokens comparáveis de um texto: sem acento, minúsculos, sem conectivo. */
export function tokensDe(valor: unknown): string[] {
  const brutos = String(valor ?? "").match(REGEX_TOKEN) ?? [];
  return brutos
    .map((token) => normalizaNome(token).toLowerCase())
    .filter((token) => token.length >= 2 && !TOKENS_IGNORADOS.has(token));
}

const textoDe = (valor: unknown): string[] => {
  if (valor == null || valor === "") return [];
  const valores = Array.isArray(valor) ? valor : [valor];
  return valores
    .map((item) => typeof item === "string" || typeof item === "number" ? String(item).trim() : "")
    .filter(Boolean);
};

/**
 * Palavras que denunciam uma pergunta cujo valor é o nome de uma PESSOA. O
 * formulário é livre e não tem id estável de pergunta, então vale a mesma
 * estratégia do destinoDaPergunta() do diagnóstico: enunciado, não UUID.
 */
const KW_PESSOA = [
  "colaborador", "avaliado", "liderado", "nome do", "identificacao do",
  "quem esta sendo avaliado", "funcionario", "empregado",
];

/**
 * De quais perguntas sai um nome de pessoa.
 *
 * `tipo === "colaborador"` é o caminho confiável e é o que montarDicionarioNomes
 * já usa no diagnóstico. Os outros dois existem porque o mapeamento do painel
 * (mapa.avaliado / mapa.lider) mora no localStorage do navegador — a Edge
 * Function não tem como lê-lo. O front manda os ids como DICA; confiar nela não
 * amplia acesso nenhum, porque as respostas lidas já vêm recortadas pela RLS do
 * usuário: no pior caso a dica aponta uma pergunta boba e o índice fica com
 * nome ruim, nunca com resposta que a pessoa não podia ver.
 */
export function idsDeNome(
  perguntas: PerguntaPainel[],
  dicaIds: string[] = [],
): Set<string> {
  const ids = new Set<string>(dicaIds.filter(Boolean).map(String));
  for (const pergunta of Array.isArray(perguntas) ? perguntas : []) {
    const tipo = String(pergunta?.tipo ?? "").toLowerCase();
    if (tipo === "colaborador") { ids.add(String(pergunta.id)); continue; }
    const titulo = normalizaNome(pergunta?.titulo).toLowerCase();
    if (titulo && KW_PESSOA.some((kw) => titulo.includes(kw))) ids.add(String(pergunta.id));
  }
  return ids;
}

const juntar = (lista: string[], valor: unknown): void => {
  const texto = String(valor ?? "").trim();
  if (texto && !lista.includes(texto)) lista.push(texto);
};

/**
 * Monta o índice de tudo que o usuário enxerga — TODOS os formulários visíveis,
 * não só o selecionado no topo da tela. Essa é a causa nº 1 de um falso "não
 * existe": a pessoa está no formulário do lado.
 */
export function montarIndicePainel(
  formularios: FormularioPainel[],
  respostas: RespostaPainel[],
  dicaIdsPorFormulario: Record<string, string[]> = {},
): IndicePainel {
  const forms = Array.isArray(formularios) ? formularios : [];
  const linhas = Array.isArray(respostas) ? respostas : [];

  const tituloPorForm = new Map<string, string>();
  const idsNomePorForm = new Map<string, Set<string>>();
  for (const form of forms) {
    const id = String(form?.id ?? "");
    if (!id) continue;
    tituloPorForm.set(id, String(form?.titulo ?? "").trim() || "(sem título)");
    idsNomePorForm.set(id, idsDeNome(form?.perguntas ?? [], dicaIdsPorFormulario[id] ?? []));
  }

  const porPessoa = new Map<string, PessoaIndice>();
  const porSetor = new Map<string, SetorIndice>();
  const qtdPorForm = new Map<string, number>();

  const registrar = (nome: unknown, papel: PapelPessoa, setor: string, tituloForm: string) => {
    const limpo = String(nome ?? "").trim();
    if (!limpo) return;
    const chave = normalizaNome(limpo);
    if (!chave) return;
    const atual = porPessoa.get(chave) ?? {
      nome: limpo, nome_norm: chave, papeis: [], setores: [], formularios: [], qtd_respostas: 0,
    };
    if (!atual.papeis.includes(papel)) atual.papeis.push(papel);
    juntar(atual.setores, setor);
    juntar(atual.formularios, tituloForm);
    atual.qtd_respostas += 1;
    porPessoa.set(chave, atual);
  };

  for (const linha of linhas) {
    const formId = String(linha?.formulario_id ?? "");
    const tituloForm = tituloPorForm.get(formId) ?? "(formulário desconhecido)";
    const setor = String(linha?.setor ?? "").trim() || "(sem setor)";

    qtdPorForm.set(formId, (qtdPorForm.get(formId) ?? 0) + 1);

    const chaveSetor = normalizaNome(setor);
    const setorAtual = porSetor.get(chaveSetor) ?? { setor, qtd_respostas: 0, formularios: [] };
    setorAtual.qtd_respostas += 1;
    juntar(setorAtual.formularios, tituloForm);
    porSetor.set(chaveSetor, setorAtual);

    registrar(linha?.respondente_nome, "respondente", setor, tituloForm);
    // O avaliado é quem o feedback descreve — e é justamente quem o usuário
    // procura no chat. Indexar só o respondente faria a IA jurar que um
    // colaborador não existe porque ele nunca preencheu nada sobre si mesmo.
    for (const perguntaId of idsNomePorForm.get(formId) ?? []) {
      for (const valor of textoDe(linha?.itens?.[perguntaId])) {
        registrar(valor, "avaliado", setor, tituloForm);
      }
    }
  }

  const ordenaPorNome = (a: PessoaIndice, b: PessoaIndice) =>
    a.nome.localeCompare(b.nome, "pt-BR");

  return {
    formularios: forms
      .map((form) => ({
        id: String(form?.id ?? ""),
        titulo: tituloPorForm.get(String(form?.id ?? "")) ?? "(sem título)",
        qtd_respostas: qtdPorForm.get(String(form?.id ?? "")) ?? 0,
      }))
      .filter((form) => !!form.id),
    setores: [...porSetor.values()].sort((a, b) => b.qtd_respostas - a.qtd_respostas),
    pessoas: [...porPessoa.values()].sort(ordenaPorNome),
    total_respostas: linhas.length,
    abas: ABAS_PAINEL,
  };
}

/**
 * Procura pessoas DENTRO da pergunta inteira, em vez de tentar recortar o nome
 * dela. O usuário escreve "não estou conseguindo localizar o colaborador
 * EDUARDO JEIEL PADILHA MONTEIRO VAZ" — extrair "o nome" dessa frase por regex
 * é frágil; conferir quais nomes do índice aparecem na frase não é.
 *
 * Um nome cujos tokens aparecem todos, ou pelo menos dois deles, é ACHADO. Um
 * token só (procurar "Eduardo" e existirem seis) também vira achado quando não
 * há nada mais forte — listar os seis é sempre melhor que responder "não
 * existe", que é exatamente o que o solicitante não quer ver.
 */
export function buscarPessoas(indice: IndicePainel, textoPergunta: string): ResultadoBusca {
  const tokensPergunta = new Set(tokensDe(textoPergunta));
  if (!tokensPergunta.size) return { achados: [], parecidos: [] };

  const fortes: { pessoa: PessoaIndice; casados: number }[] = [];
  const fracos: { pessoa: PessoaIndice; casados: number }[] = [];

  for (const pessoa of indice.pessoas) {
    const tokensNome = [...new Set(tokensDe(pessoa.nome))].filter((t) => t.length >= 3);
    if (!tokensNome.length) continue;
    const casados = tokensNome.filter((token) => tokensPergunta.has(token)).length;
    if (!casados) continue;
    if (casados >= 2 || casados === tokensNome.length) fortes.push({ pessoa, casados });
    else fracos.push({ pessoa, casados });
  }

  const maisCasados = (
    a: { pessoa: PessoaIndice; casados: number },
    b: { pessoa: PessoaIndice; casados: number },
  ) => b.casados - a.casados || a.pessoa.nome.localeCompare(b.pessoa.nome, "pt-BR");

  fortes.sort(maisCasados);
  fracos.sort(maisCasados);

  if (fortes.length) {
    return {
      achados: fortes.slice(0, MAX_PESSOAS_PROMPT).map((item) => item.pessoa),
      parecidos: fracos.slice(0, 5).map((item) => item.pessoa),
    };
  }
  // Sem nenhuma correspondência forte, o parcial vira a resposta — com teto,
  // para "onde está o José" não despejar meia empresa no prompt.
  return { achados: fracos.slice(0, 8).map((item) => item.pessoa), parecidos: [] };
}

/** Resumo do índice que cabe no prompt: setores inteiros, pessoas só as da busca. */
export function montarPromptChat(
  indice: IndicePainel,
  busca: ResultadoBusca,
  pergunta: string,
): string {
  const resumo = {
    total_respostas: indice.total_respostas,
    total_pessoas: indice.pessoas.length,
    formularios: indice.formularios,
    setores: indice.setores,
    abas: indice.abas,
  };

  return `CONTEXTO DO PAINEL (tudo que este usuário enxerga):
${JSON.stringify(resumo, null, 2)}

ACHADOS (a busca por pessoa já foi feita em código; estas pessoas EXISTEM):
${JSON.stringify(busca.achados, null, 2)}

PARECIDOS (nomes próximos, para sugerir caso o usuário tenha errado a grafia):
${JSON.stringify(busca.parecidos, null, 2)}

PERGUNTA DO USUÁRIO:
${String(pergunta ?? "").slice(0, MAX_PERGUNTA_CHARS)}`;
}
