// =====================================================================
// PAINEL DE IMPLANTAÇÃO POR SETOR — lógica pura (sem React, sem Supabase)
//
// A origem é o MESMO checklist da tela de Implantação: `checklist_items`
// (a pergunta e o meta-block) + `checklist_respostas` (o que foi
// preenchido). Nada é lançado de novo: o painel só reagrupa o que já está
// gravado, então mudar uma resposta no formulário muda o painel.
//
// QUEM É O SETOR
//   É o "Resp. ação" do meta-block (`checklist_items.responsavel_acao`).
//   Os valores reais do banco têm três formas:
//     • um setor só           — "Financeiro", "Compras", "RH"...
//     • setores combinados    — "SST/Compras", "SST/Treinamentos": a
//                               pergunta entra nos DOIS setores;
//     • "Todos"               — a pergunta vale para todo setor, e aparece
//                               em cada página (marcada como comum). É o
//                               mesmo critério do filtro de responsável da
//                               tela de Implantação, que já mostrava os
//                               itens "Todos" junto de qualquer setor.
//   "Operação" e "Operacional" são grafias do mesmo setor na planilha de
//   origem (a 20260930000062 gravou "Operacional"; o seed, "Operação") —
//   juntamos em "Operacional" para não nascer duas páginas do mesmo setor.
//
// CONFIRMAÇÃO DE RECEBIMENTO
//   Gravada em "IMPLANTACAO_SETOR_CONFIRMACAO" com a `assinatura` das
//   respostas do setor no momento da confirmação. Se alguma resposta muda
//   depois, a assinatura deixa de bater e a confirmação fica desatualizada:
//   o setor volta para "Em andamento" até confirmar de novo. Assim o setor
//   nunca aparece "Concluído" sobre um dado que ele não viu.
// =====================================================================

export const SETOR_TODOS = "Todos";

export type StatusSetor = "concluido" | "em_andamento" | "pendente";

export interface ItemPainel {
  row_index: number;
  item: string;
  responsavel_acao: string | null;
  plano_acao?: string | null;
  onde?: string | null;
  momento?: string | null;
  categoria?: string | null;
  ordem?: number | null;
}

export interface RespostaPainel {
  row_index: number;
  resposta: string | null;
}

export interface ConfirmacaoPainel {
  setor: string;
  assinatura: string;
  confirmado_em: string;
  confirmado_por: string | null;
}

export interface LinhaSetor {
  row_index: number;
  pergunta: string;
  valor: string;
  respondido: boolean;
  /** Veio de um item "Todos" — comum a todos os setores. */
  comum: boolean;
  plano_acao: string | null;
  onde: string | null;
}

export interface ResumoSetor {
  setor: string;
  slug: string;
  total: number;
  respondidos: number;
  pendentes: number;
  /** Respostas nas perguntas do PRÓPRIO setor (sem as comuns). */
  respondidosProprios: number;
  pct: number;
  status: StatusSetor;
  /** Tudo respondido e sem confirmação válida: o setor já pode confirmar. */
  prontoParaConfirmar: boolean;
  confirmacao: ConfirmacaoPainel | null;
  /** Havia confirmação, mas alguma resposta mudou depois dela. */
  confirmacaoDesatualizada: boolean;
  assinatura: string;
  linhas: LinhaSetor[];
}

export interface PainelImplantacao {
  setores: ResumoSetor[];
  totalSetores: number;
  /** Setores com ao menos uma resposta nas próprias perguntas (ou já confirmados). */
  acionados: number;
  confirmados: number;
  /** Setores ainda não concluídos (sem confirmação válida). */
  pendencias: number;
  /** Setores confirmados / total — a barra "Progresso geral". */
  progressoPct: number;
  itensTotal: number;
  itensRespondidos: number;
}

const ALIASES: Record<string, string> = {
  "operação": "Operacional",
  "operacao": "Operacional",
  "operacional": "Operacional",
  "todos": SETOR_TODOS,
};

function normalizarSetor(bruto: string): string {
  const limpo = bruto.trim().replace(/\s+/g, " ");
  return ALIASES[limpo.toLocaleLowerCase("pt-BR")] ?? limpo;
}

/** "SST/Compras" → ["SST", "Compras"]; "Operação" → ["Operacional"]. */
export function setoresDoResponsavel(responsavel: string | null | undefined): string[] {
  if (!responsavel) return [];
  const saida: string[] = [];
  for (const parte of responsavel.split("/")) {
    if (!parte.trim()) continue;
    const setor = normalizarSetor(parte);
    if (!saida.includes(setor)) saida.push(setor);
  }
  return saida;
}

/** Slug estável para a URL: "Licitação" → "licitacao", "SST" → "sst". */
export function slugSetor(setor: string): string {
  return setor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Setores específicos (sem "Todos"), em ordem alfabética pt-BR. */
export function listarSetores(itens: readonly ItemPainel[]): string[] {
  const set = new Set<string>();
  for (const i of itens) {
    for (const s of setoresDoResponsavel(i.responsavel_acao)) {
      if (s !== SETOR_TODOS) set.add(s);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function setorPorSlug(itens: readonly ItemPainel[], slug: string): string | null {
  return listarSetores(itens).find((s) => slugSetor(s) === slug) ?? null;
}

/** Itens que pertencem ao setor: os dele e os comuns ("Todos"). */
export function itensDoSetor(itens: readonly ItemPainel[], setor: string): ItemPainel[] {
  return ordenar(
    itens.filter((i) => {
      const s = setoresDoResponsavel(i.responsavel_acao);
      return s.includes(setor) || s.includes(SETOR_TODOS);
    }),
  );
}

function ordenar(itens: ItemPainel[]): ItemPainel[] {
  return [...itens].sort(
    (a, b) => (a.ordem ?? a.row_index) - (b.ordem ?? b.row_index) || a.row_index - b.row_index,
  );
}

function respondido(r: RespostaPainel | undefined): boolean {
  return !!r?.resposta && r.resposta.trim() !== "";
}

/**
 * Impressão digital das respostas do setor (FNV-1a 32 bits, hex). Muda
 * quando qualquer resposta do setor muda, quando uma é apagada e quando o
 * setor ganha ou perde pergunta.
 */
export function assinaturaRespostas(
  itens: readonly ItemPainel[],
  respostaMap: ReadonlyMap<number, RespostaPainel>,
): string {
  const texto = [...itens]
    .map((i) => i.row_index)
    .sort((a, b) => a - b)
    .map((row) => `${row}=${(respostaMap.get(row)?.resposta ?? "").trim()}`)
    .join("␞");
  let h = 0x811c9dc5;
  for (let k = 0; k < texto.length; k++) {
    h ^= texto.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Resumo legível de qualquer resposta gravada (lista JSON vira "a, b"). */
export function valorLegivel(valor: string | null | undefined): string {
  const v = (valor ?? "").trim();
  if (!v) return "";
  if (v.startsWith("[")) {
    try {
      const lista = JSON.parse(v);
      if (Array.isArray(lista)) return lista.map(String).join(", ");
    } catch {
      /* texto que só começa com "[" */
    }
  }
  return v;
}

export function montarResumoSetor(
  setor: string,
  itens: readonly ItemPainel[],
  respostaMap: ReadonlyMap<number, RespostaPainel>,
  confirmacoes: readonly ConfirmacaoPainel[],
  resumir: (rowIndex: number, valor: string) => string = (_r, v) => valorLegivel(v),
): ResumoSetor {
  const doSetor = itensDoSetor(itens, setor);
  const linhas: LinhaSetor[] = doSetor.map((i) => {
    const r = respostaMap.get(i.row_index);
    const ok = respondido(r);
    return {
      row_index: i.row_index,
      pergunta: i.item,
      valor: ok ? resumir(i.row_index, r!.resposta!) : "",
      respondido: ok,
      comum: setoresDoResponsavel(i.responsavel_acao).includes(SETOR_TODOS),
      plano_acao: i.plano_acao ?? null,
      onde: i.onde ?? null,
    };
  });
  const total = linhas.length;
  const respondidos = linhas.filter((l) => l.respondido).length;
  // As comuns ("Todos") são ~18 das 64 perguntas e costumam ser respondidas
  // primeiro: se contassem para o status, todo setor nasceria "Em andamento"
  // sem ninguém ter lançado nada dele. O status olha só as perguntas do
  // próprio setor; as comuns continuam no total e na assinatura.
  const respondidosProprios = linhas.filter((l) => l.respondido && !l.comum).length;
  const assinatura = assinaturaRespostas(doSetor, respostaMap);
  const confirmacao = confirmacoes.find((c) => c.setor === setor) ?? null;
  const confirmacaoValida = !!confirmacao && confirmacao.assinatura === assinatura;
  const status: StatusSetor = confirmacaoValida
    ? "concluido"
    : respondidosProprios > 0
      ? "em_andamento"
      : "pendente";
  return {
    setor,
    slug: slugSetor(setor),
    total,
    respondidos,
    pendentes: total - respondidos,
    respondidosProprios,
    pct: total ? Math.round((respondidos / total) * 100) : 0,
    status,
    prontoParaConfirmar: total > 0 && respondidos === total && !confirmacaoValida,
    confirmacao,
    confirmacaoDesatualizada: !!confirmacao && !confirmacaoValida,
    assinatura,
    linhas,
  };
}

export function mapaRespostas(respostas: readonly RespostaPainel[]): Map<number, RespostaPainel> {
  return new Map(respostas.map((r) => [r.row_index, r]));
}

export function montarPainel(
  itens: readonly ItemPainel[],
  respostas: readonly RespostaPainel[],
  confirmacoes: readonly ConfirmacaoPainel[],
  resumir?: (rowIndex: number, valor: string) => string,
): PainelImplantacao {
  const mapa = mapaRespostas(respostas);
  const setores = listarSetores(itens).map((s) =>
    montarResumoSetor(s, itens, mapa, confirmacoes, resumir),
  );
  const totalSetores = setores.length;
  const confirmados = setores.filter((s) => s.status === "concluido").length;
  return {
    setores,
    totalSetores,
    acionados: setores.filter((s) => s.respondidosProprios > 0 || s.status === "concluido").length,
    confirmados,
    pendencias: totalSetores - confirmados,
    progressoPct: totalSetores ? Math.round((confirmados / totalSetores) * 100) : 0,
    itensTotal: itens.length,
    itensRespondidos: itens.filter((i) => respondido(mapa.get(i.row_index))).length,
  };
}

export const ROTULO_STATUS: Record<StatusSetor, string> = {
  concluido: "Concluído",
  em_andamento: "Em andamento",
  pendente: "Pendente",
};
