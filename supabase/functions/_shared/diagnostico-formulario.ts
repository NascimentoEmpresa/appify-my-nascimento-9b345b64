/**
 * DIAGNÓSTICO POR IA DE QUALQUER FORMULÁRIO — lógica pura (15/09/2026).
 *
 * O diagnóstico dos feedbacks (diagnostico-feedback.ts) só entende o feedback
 * guiado: classifica cada pergunta em "liderados → líder" / "líder → liderados"
 * pelo enunciado. Pedido do Pablo: "diagnóstico por IA igual o dos feedbacks
 * em todos os outros formulários". Aqui não há eixos — toda pergunta entra:
 * as fechadas viram distribuição (n, %), as abertas viram lista de textos
 * já anonimizados. O modelo recebe só esse agregado e devolve resumo, pontos
 * fortes, pontos de atenção, leitura por pergunta e plano de ação.
 *
 * Mesmas garantias do feedback: nenhum nome, e-mail ou linha de pessoa chega
 * ao gateway (limparNomesProprios + dicionário montado com os dados visíveis),
 * e todo número vem calculado daqui — a IA só lê.
 */
import {
  agregarPerguntaAberta,
  agregarPerguntaFechada,
  limparNomesProprios,
  MAX_ITENS_POR_BLOCO,
  montarDicionarioNomes,
  TIPOS_FECHADOS,
  type ForcaDiagnostico,
  type PerguntaAbertaAgregada,
  type PerguntaDiagnostico,
  type PerguntaFechadaAgregada,
  type RespostaDiagnostico,
} from "./diagnostico-feedback.ts";

/** Perguntas que não têm o que diagnosticar (arquivo, imagem, separador, quem respondeu). */
const TIPOS_IGNORADOS = new Set(["arquivo", "imagem", "secao", "titulo", "colaborador", "assinatura", "data", "hora"]);

/** Cada texto livre vai truncado; formulário grande não pode estourar o contexto do modelo. */
export const MAX_TEXTOS_POR_PERGUNTA = 80;
export const MAX_CHARS_POR_TEXTO = 400;

export interface AgregadoFormulario {
  formulario: string;
  setor: string;
  qtd_respostas: number;
  fechadas: PerguntaFechadaAgregada[];
  abertas: PerguntaAbertaAgregada[];
}

export interface DiagnosticoFormulario {
  titulo: string;
  setor: string;
  qtd_respostas: number;
  resumo: string;
  pontos_fortes: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  pontos_de_atencao: { tema: string; evidencia: string; forca: ForcaDiagnostico }[];
  leitura_por_pergunta: { pergunta: string; leitura: string }[];
  plano_de_acao: {
    acao: string;
    porque: string;
    prazo_sugerido_dias: number;
    prioridade: ForcaDiagnostico;
  }[];
}

export type ResultadoValidacaoFormulario =
  | { ok: true; diagnostico: DiagnosticoFormulario }
  | { ok: false; motivo: string };

/** Monta o agregado de TODAS as perguntas diagnosticáveis — nunca uma linha de pessoa. */
export function agregarFormulario(
  titulo: string,
  setor: string,
  perguntas: PerguntaDiagnostico[],
  respostas: RespostaDiagnostico[],
  nomesConhecidos?: ReadonlySet<string>,
): AgregadoFormulario {
  const dicionario = nomesConhecidos ?? montarDicionarioNomes(perguntas, respostas);
  const agregado: AgregadoFormulario = {
    formulario: String(titulo ?? "").trim(),
    setor: String(setor ?? "").trim(),
    qtd_respostas: respostas.length,
    fechadas: [],
    abertas: [],
  };
  for (const pergunta of Array.isArray(perguntas) ? perguntas : []) {
    const tipo = String(pergunta.tipo ?? "").toLowerCase();
    if (TIPOS_IGNORADOS.has(tipo) || !String(pergunta.titulo ?? "").trim()) continue;
    if (TIPOS_FECHADOS.has(tipo)) {
      agregado.fechadas.push(agregarPerguntaFechada(pergunta, respostas));
    } else {
      const aberta = agregarPerguntaAberta(pergunta, respostas, dicionario);
      aberta.textos = aberta.textos.slice(0, MAX_TEXTOS_POR_PERGUNTA).map((t) => t.slice(0, MAX_CHARS_POR_TEXTO));
      agregado.abertas.push(aberta);
    }
  }
  return agregado;
}

/** Tem o que ler: pelo menos uma pergunta com alguma resposta. */
export function agregadoTemConteudo(agregado: AgregadoFormulario): boolean {
  return agregado.fechadas.some((p) => p.total_respondido > 0)
    || agregado.abertas.some((p) => p.textos.length > 0);
}

export function montarPromptFormulario(agregado: AgregadoFormulario): string {
  return `Analise o agregado anônimo abaixo, das respostas do formulário "${agregado.formulario}"${agregado.setor ? ` (recorte: setor ${agregado.setor})` : " (todas as respostas)"}, e chame a tool "diagnostico_formulario".

REGRAS:
- Use somente os números já calculados em n, pct, total_respondido e qtd_respostas. Não recalcule, estime ou invente números.
- Leia os textos livres para agrupar temas recorrentes; cite a pergunta de onde cada evidência veio.
- Fale do grupo de respondentes como coletivo. Nunca nomeie, identifique ou tente inferir uma pessoa.
- "pontos_fortes" são o que as respostas mostram de positivo; "pontos_de_atencao" o que pede cuidado ou ação.
- "leitura_por_pergunta": uma frase objetiva por pergunta relevante (as que mais dizem algo) — no máximo ${MAX_ITENS_POR_BLOCO * 2}.
- Recomendações devem ser práticas e executáveis pela gestão.
- titulo, setor e qtd_respostas devem repetir exatamente os valores do agregado.

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
export function validarDiagnosticoFormulario(
  bruto: unknown,
  nomesConhecidos: ReadonlySet<string> = new Set<string>(),
): ResultadoValidacaoFormulario {
  const o = objetoDe(bruto);
  if (!o) return { ok: false, motivo: "A resposta não é um objeto JSON." };
  for (const bloco of ["pontos_fortes", "pontos_de_atencao", "leitura_por_pergunta", "plano_de_acao"]) {
    if (!Array.isArray(o[bloco])) return { ok: false, motivo: `Bloco ausente ou inválido: ${bloco}.` };
  }
  if (!textoValido(o.resumo)) return { ok: false, motivo: "Resumo ausente." };
  if (!Number.isInteger(o.qtd_respostas) || Number(o.qtd_respostas) < 0) {
    return { ok: false, motivo: "Quantidade de respostas ausente ou inválida." };
  }

  const fortes = (o.pontos_fortes as unknown[]).slice(0, MAX_ITENS_POR_BLOCO);
  const atencao = (o.pontos_de_atencao as unknown[]).slice(0, MAX_ITENS_POR_BLOCO);
  const leituras = (o.leitura_por_pergunta as unknown[]).slice(0, MAX_ITENS_POR_BLOCO * 2);
  const plano = (o.plano_de_acao as unknown[]).slice(0, MAX_ITENS_POR_BLOCO);

  const temaValido = (item: unknown): item is Record<string, unknown> => {
    const x = objetoDe(item);
    return !!x && textoValido(x.tema) && textoValido(x.evidencia) && forcaValida(x.forca);
  };
  const leituraValida = (item: unknown): item is Record<string, unknown> => {
    const x = objetoDe(item);
    return !!x && textoValido(x.pergunta) && textoValido(x.leitura);
  };
  const acaoValida = (item: unknown): item is Record<string, unknown> => {
    const x = objetoDe(item);
    return !!x && textoValido(x.acao) && textoValido(x.porque)
      && Number.isInteger(x.prazo_sugerido_dias) && Number(x.prazo_sugerido_dias) > 0
      && forcaValida(x.prioridade);
  };
  if (!fortes.every(temaValido)) return { ok: false, motivo: "Item inválido em pontos_fortes." };
  if (!atencao.every(temaValido)) return { ok: false, motivo: "Item inválido em pontos_de_atencao." };
  if (!leituras.every(leituraValida)) return { ok: false, motivo: "Item inválido em leitura_por_pergunta." };
  if (!plano.every(acaoValida)) return { ok: false, motivo: "Item inválido em plano_de_acao." };

  const limpar = (v: unknown) => limparNomesProprios(String(v), nomesConhecidos);
  return {
    ok: true,
    diagnostico: {
      titulo: String(o.titulo ?? "").trim(),
      setor: String(o.setor ?? "").trim(),
      qtd_respostas: Number(o.qtd_respostas),
      resumo: limpar(o.resumo),
      pontos_fortes: fortes.map((item) => ({ tema: limpar(item.tema), evidencia: limpar(item.evidencia), forca: item.forca as ForcaDiagnostico })),
      pontos_de_atencao: atencao.map((item) => ({ tema: limpar(item.tema), evidencia: limpar(item.evidencia), forca: item.forca as ForcaDiagnostico })),
      leitura_por_pergunta: leituras.map((item) => ({ pergunta: limpar(item.pergunta), leitura: limpar(item.leitura) })),
      plano_de_acao: plano.map((item) => ({
        acao: limpar(item.acao),
        porque: limpar(item.porque),
        prazo_sugerido_dias: Number(item.prazo_sugerido_dias),
        prioridade: item.prioridade as ForcaDiagnostico,
      })),
    },
  };
}
