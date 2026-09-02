/**
 * DIAGNÓSTICO DOS FEEDBACKS POR SETOR — lógica pura.
 *
 * O modelo não recebe linhas de pessoas nem faz contas. Este arquivo transforma
 * as respostas visíveis ao usuário em um agregado anônimo e determinístico;
 * só depois disso a IA lê os temas e redige recomendações. Não há import de
 * Deno ou Supabase para que a mesma regra rode no Vitest sem rede.
 */

export type ForcaDiagnostico = "Alta" | "Média" | "Baixa";

export interface PerguntaDiagnostico {
  id: string;
  tipo: string;
  titulo: string;
  opcoes?: string[] | null;
  config?: Record<string, unknown> | null;
}

export interface RespostaDiagnostico {
  setor?: string | null;
  itens?: Record<string, unknown> | null;
  respondente_nome?: string | null;
  // As linhas reais têm outros campos. Eles são deliberadamente ignorados:
  // agregarSetor nunca os copia para o objeto que será serializado no prompt.
  [campo: string]: unknown;
}

export interface OpcaoAgregada {
  opcao: string;
  n: number;
  pct: number;
}

export interface PerguntaFechadaAgregada {
  pergunta: string;
  total_respondido: number;
  distribuicao: OpcaoAgregada[];
}

export interface PerguntaAbertaAgregada {
  pergunta: string;
  textos: string[];
}

export interface EixoAgregado {
  fechadas: PerguntaFechadaAgregada[];
  abertas: PerguntaAbertaAgregada[];
}

export interface AgregadoDiagnostico {
  setor: string;
  qtd_respostas: number;
  liderados_para_lider: EixoAgregado;
  lider_para_liderados: EixoAgregado;
  plano: EixoAgregado;
}

export interface DiagnosticoFeedback {
  setor: string;
  qtd_respostas: number;
  liderados_para_lider: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  lider_para_liderados: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  convergencias: { tema: string; leitura: string }[];
  plano_de_acao: {
    acao: string;
    porque: string;
    prazo_sugerido_dias: number;
    prioridade: ForcaDiagnostico;
  }[];
}

export type ResultadoValidacao =
  | { ok: true; diagnostico: DiagnosticoFeedback }
  | { ok: false; motivo: string };

export const MINIMO_RESPOSTAS_DIAGNOSTICO = 5;
export const MAX_ITENS_POR_BLOCO = 5;

const TIPOS_FECHADOS = new Set([
  "multipla_escolha", "caixas_selecao", "lista_suspensa", "escala", "escala_trabalho",
]);

const semAcento = (valor: unknown): string => String(valor ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "");

/** Mesma chave de LideresSetor: sem acento, caixa alta e espaços colapsados. */
export function normalizaSetor(setor: unknown): string {
  return semAcento(setor).trim().replace(/\s+/g, " ").toUpperCase();
}

const tituloNormalizado = (titulo: unknown): string => semAcento(titulo)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

type DestinoPergunta = "liderados" | "lider" | "plano" | null;

/**
 * O formulário é livre e não tem ids estáveis de perguntas. A classificação
 * usa os mesmos enunciados/palavras-chave que tornam o painel reutilizável em
 * outros formulários, sem amarrar esta função ao UUID do formulário atual.
 */
function destinoDaPergunta(pergunta: PerguntaDiagnostico): DestinoPergunta {
  const t = tituloNormalizado(pergunta.titulo);
  if (!t) return null;

  if (
    /acao definida|treinamento ou acompanhamento|plano de acao/.test(t)
    || /prazo (?:para|da) (?:a )?acao/.test(t)
  ) return "plano";

  if (
    /como voce acredita que esta o seu trabalho/.test(t)
    || /maior dificuldade/.test(t)
    || /precisa (?:mais )?(?:da|de) (?:sua )?lideranca/.test(t)
    || /sente que precisa melhorar/.test(t)
  ) return "liderados";

  if (
    /visao do liderado/.test(t)
    || /nivel de entrega/.test(t)
    || /nivel de comprometimento/.test(t)
    || /principal necessidade de desenvolvimento/.test(t)
    || /profissional hoje esta/.test(t)
    || /ponto forte principal/.test(t)
    || /ponto de melhoria principal/.test(t)
  ) return "lider";

  return null;
}

const textoDe = (valor: unknown): string[] => {
  if (valor == null || valor === "") return [];
  const valores = Array.isArray(valor) ? valor : [valor];
  return valores
    .map((item) => typeof item === "string" || typeof item === "number" ? String(item).trim() : "")
    .filter(Boolean);
};

const TOKENS_IGNORADOS_NOME = new Set(["de", "da", "das", "do", "dos", "e"]);
const REGEX_TOKEN_NOME = /\p{L}[\p{L}\p{M}'’-]*/gu;

const termosDoNome = (valor: unknown): string[] => {
  const tokens = String(valor ?? "").match(REGEX_TOKEN_NOME) ?? [];
  const normalizados = tokens.map((token) => semAcento(token).toLowerCase());
  if (!normalizados.length) return [];

  const nomeCompleto = normalizados.join(" ");
  const nomesIndividuais = normalizados.filter((token) =>
    token.length >= 3 && !TOKENS_IGNORADOS_NOME.has(token)
  );
  return [nomeCompleto, ...nomesIndividuais];
};

/**
 * Os nomes conhecidos ja estao nas linhas que a RLS permitiu ler. O
 * dicionario inclui o valor completo e cada primeiro nome/sobrenome com tres
 * ou mais letras; assim a redacao pode citar so "Isadora" mesmo quando o
 * cadastro guarda o nome completo.
 */
export function montarDicionarioNomes(
  perguntas: PerguntaDiagnostico[],
  respostas: RespostaDiagnostico[],
): Set<string> {
  const idsColaborador = new Set(
    (Array.isArray(perguntas) ? perguntas : [])
      .filter((pergunta) => String(pergunta.tipo ?? "").toLowerCase() === "colaborador")
      .map((pergunta) => pergunta.id),
  );
  const dicionario = new Set<string>();
  const adicionar = (nome: unknown) => termosDoNome(nome).forEach((termo) => dicionario.add(termo));

  for (const resposta of Array.isArray(respostas) ? respostas : []) {
    adicionar(resposta.respondente_nome);
    for (const perguntaId of idsColaborador) {
      textoDe(resposta.itens?.[perguntaId]).forEach(adicionar);
    }
  }

  return dicionario;
}

/**
 * Defesa antes do prompt. E-mail e @menção têm formato inequívoco; nomes, por
 * outro lado, só são removidos quando aparecem no dicionário montado com os
 * dados do setor. Caixa e acento não participam da comparação.
 */
export function limparNomesProprios(
  valor: unknown,
  nomesConhecidos: ReadonlySet<string> = new Set<string>(),
): string {
  let texto = String(valor ?? "").trim().slice(0, 1500);
  if (!texto) return "";

  // Aceitar nomes ainda não normalizados torna a função segura para outros
  // chamadores e para testes unitários que fornecem o dicionário diretamente.
  const dicionario = new Set<string>();
  nomesConhecidos.forEach((nome) => termosDoNome(nome).forEach((termo) => {
    if (!termo.includes(" ") && termo.length >= 3 && !TOKENS_IGNORADOS_NOME.has(termo)) {
      dicionario.add(termo);
    }
  }));

  const MARCADOR_EMAIL = "\uE0000\uE001";
  const MARCADOR_MENCAO = "\uE0001\uE001";
  texto = texto
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, MARCADOR_EMAIL)
    .replace(/@[\p{L}\p{N}_.-]+/gu, MARCADOR_MENCAO)
    .replace(REGEX_TOKEN_NOME, (token) =>
      dicionario.has(semAcento(token).toLowerCase()) ? "[pessoa]" : token
    )
    .replaceAll(MARCADOR_EMAIL, "[dado removido]")
    .replaceAll(MARCADOR_MENCAO, "[pessoa]");

  return texto
    .replace(/\[pessoa\](?:\s+\[pessoa\])+/g, "[pessoa]")
    .trim();
}

const percentual = (n: number, total: number): number =>
  total > 0 ? Math.round((n / total) * 1000) / 10 : 0;

function agregarPerguntaFechada(
  pergunta: PerguntaDiagnostico,
  respostas: RespostaDiagnostico[],
): PerguntaFechadaAgregada {
  const contagem = new Map<string, number>();
  let totalRespondido = 0;

  for (const resposta of respostas) {
    const valores = textoDe(resposta.itens?.[pergunta.id]);
    if (!valores.length) continue;
    totalRespondido += 1;
    // Uma opção é contada no máximo uma vez por resposta. Isso evita que um
    // array repetido/inválido infle caixas de seleção.
    new Set(valores).forEach((opcao) => contagem.set(opcao, (contagem.get(opcao) ?? 0) + 1));
  }

  const ordem = [...(Array.isArray(pergunta.opcoes) ? pergunta.opcoes.map(String) : [])];
  for (const opcao of contagem.keys()) if (!ordem.includes(opcao)) ordem.push(opcao);

  return {
    pergunta: String(pergunta.titulo ?? "").trim(),
    total_respondido: totalRespondido,
    distribuicao: ordem.map((opcao) => {
      const n = contagem.get(opcao) ?? 0;
      return { opcao, n, pct: percentual(n, totalRespondido) };
    }),
  };
}

function agregarPerguntaAberta(
  pergunta: PerguntaDiagnostico,
  respostas: RespostaDiagnostico[],
  dicionarioNomes: ReadonlySet<string>,
): PerguntaAbertaAgregada {
  const textos = respostas.flatMap((resposta) => textoDe(resposta.itens?.[pergunta.id]))
    .map((texto) => limparNomesProprios(texto, dicionarioNomes))
    .filter(Boolean);
  return { pergunta: String(pergunta.titulo ?? "").trim(), textos };
}

const eixoVazio = (): EixoAgregado => ({ fechadas: [], abertas: [] });

/** Monta somente o agregado permitido para o prompt; nunca espalha uma resposta. */
export function agregarSetor(
  perguntas: PerguntaDiagnostico[],
  respostas: RespostaDiagnostico[],
  nomesConhecidos?: ReadonlySet<string>,
): AgregadoDiagnostico {
  const dicionarioNomes = nomesConhecidos ?? montarDicionarioNomes(perguntas, respostas);
  const agregado: AgregadoDiagnostico = {
    setor: String(respostas.find((r) => normalizaSetor(r.setor))?.setor ?? "").trim(),
    qtd_respostas: respostas.length,
    liderados_para_lider: eixoVazio(),
    lider_para_liderados: eixoVazio(),
    plano: eixoVazio(),
  };

  for (const pergunta of Array.isArray(perguntas) ? perguntas : []) {
    const destino = destinoDaPergunta(pergunta);
    if (!destino) continue;
    const eixos = destino === "liderados"
      ? [agregado.liderados_para_lider]
      : destino === "lider"
      ? [agregado.lider_para_liderados]
      // O fechamento alimenta a leitura do líder e também a recomendação.
      : [agregado.lider_para_liderados, agregado.plano];

    for (const eixo of eixos) {
      if (TIPOS_FECHADOS.has(String(pergunta.tipo ?? ""))) {
        eixo.fechadas.push(agregarPerguntaFechada(pergunta, respostas));
      } else {
        eixo.abertas.push(agregarPerguntaAberta(pergunta, respostas, dicionarioNomes));
      }
    }
  }

  return agregado;
}

export function elegivel(qtd: number): boolean {
  return Number.isFinite(qtd) && Math.trunc(qtd) >= MINIMO_RESPOSTAS_DIAGNOSTICO;
}

/** O agregado já traz toda conta pronta; a tarefa do modelo é exclusivamente semântica. */
export function montarPrompt(agregado: AgregadoDiagnostico): string {
  return `Analise o agregado anônimo abaixo e chame a tool "diagnostico_setor".

REGRAS:
- Use somente os números já calculados em n, pct, total_respondido e qtd_respostas. Não recalcule, estime ou invente números.
- Leia os textos livres para agrupar temas; cruze o que os liderados pedem com o que a liderança registrou.
- Fale sempre do setor como coletivo. Nunca nomeie, identifique ou tente inferir uma pessoa.
- Evidências devem ser objetivas e ligadas ao agregado. Recomendações devem ser práticas.
- setor e qtd_respostas devem repetir exatamente os valores do agregado.

AGREGADO DETERMINÍSTICO:
${JSON.stringify(agregado, null, 2)}`;
}

const FORCAS: ForcaDiagnostico[] = ["Alta", "Média", "Baixa"];
const textoValido = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const forcaValida = (v: unknown): v is ForcaDiagnostico => FORCAS.includes(v as ForcaDiagnostico);

function objetoDe(bruto: unknown): Record<string, unknown> | null {
  if (typeof bruto === "string") {
    try { return JSON.parse(bruto) as Record<string, unknown>; } catch { return null; }
  }
  return bruto && typeof bruto === "object" && !Array.isArray(bruto)
    ? bruto as Record<string, unknown>
    : null;
}

/** Valida campos e limites antes de qualquer conteúdo da IA chegar ao banco. */
export function validarDiagnostico(
  bruto: unknown,
  nomesConhecidos: ReadonlySet<string> = new Set<string>(),
): ResultadoValidacao {
  const o = objetoDe(bruto);
  if (!o) return { ok: false, motivo: "A resposta não é um objeto JSON." };

  const blocos = ["liderados_para_lider", "lider_para_liderados", "convergencias", "plano_de_acao"];
  for (const bloco of blocos) {
    if (!Array.isArray(o[bloco])) return { ok: false, motivo: `Bloco ausente ou inválido: ${bloco}.` };
  }
  if (!textoValido(o.setor)) return { ok: false, motivo: "Setor ausente ou inválido." };
  if (!Number.isInteger(o.qtd_respostas) || Number(o.qtd_respostas) < 0) {
    return { ok: false, motivo: "Quantidade de respostas ausente ou inválida." };
  }

  const liderados = (o.liderados_para_lider as unknown[]).slice(0, MAX_ITENS_POR_BLOCO);
  const lider = (o.lider_para_liderados as unknown[]).slice(0, MAX_ITENS_POR_BLOCO);
  const convergencias = (o.convergencias as unknown[]).slice(0, MAX_ITENS_POR_BLOCO);
  const plano = (o.plano_de_acao as unknown[]).slice(0, MAX_ITENS_POR_BLOCO);

  const temaValido = (item: unknown): item is Record<string, unknown> => {
    const x = objetoDe(item);
    return !!x && textoValido(x.tema) && textoValido(x.evidencia) && forcaValida(x.forca);
  };
  const convergenciaValida = (item: unknown): item is Record<string, unknown> => {
    const x = objetoDe(item);
    return !!x && textoValido(x.tema) && textoValido(x.leitura);
  };
  const acaoValida = (item: unknown): item is Record<string, unknown> => {
    const x = objetoDe(item);
    return !!x && textoValido(x.acao) && textoValido(x.porque)
      && Number.isInteger(x.prazo_sugerido_dias) && Number(x.prazo_sugerido_dias) > 0
      && forcaValida(x.prioridade);
  };

  if (!liderados.every(temaValido)) return { ok: false, motivo: "Item inválido em liderados_para_lider." };
  if (!lider.every(temaValido)) return { ok: false, motivo: "Item inválido em lider_para_liderados." };
  if (!convergencias.every(convergenciaValida)) return { ok: false, motivo: "Item inválido em convergencias." };
  if (!plano.every(acaoValida)) return { ok: false, motivo: "Item inválido em plano_de_acao." };

  const limpar = (v: unknown) => limparNomesProprios(String(v), nomesConhecidos);
  return {
    ok: true,
    diagnostico: {
      setor: String(o.setor).trim(),
      qtd_respostas: Number(o.qtd_respostas),
      liderados_para_lider: liderados.map((item) => ({
        tema: limpar(item.tema), evidencia: limpar(item.evidencia), forca: item.forca as ForcaDiagnostico,
      })),
      lider_para_liderados: lider.map((item) => ({
        tema: limpar(item.tema), evidencia: limpar(item.evidencia), forca: item.forca as ForcaDiagnostico,
      })),
      convergencias: convergencias.map((item) => ({ tema: limpar(item.tema), leitura: limpar(item.leitura) })),
      plano_de_acao: plano.map((item) => ({
        acao: limpar(item.acao),
        porque: limpar(item.porque),
        prazo_sugerido_dias: Number(item.prazo_sugerido_dias),
        prioridade: item.prioridade as ForcaDiagnostico,
      })),
    },
  };
}
