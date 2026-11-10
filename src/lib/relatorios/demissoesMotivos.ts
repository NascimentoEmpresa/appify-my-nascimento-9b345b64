// =====================================================================
// Relatórios › Demissões — motivo POR CONTRATO e relato agrupado pela I.A
// (05/11/2026, mig 20261105008300).
//
// Pedido do Pablo: "Demissões por contrato" só dava o total e "Motivo da
// demissão" só o total por motivo; ele quer ver, por contrato, quantas de
// cada motivo — e abrir cada um para ver as solicitações. A RPC
// dir_rel_demissoes_linhas devolve UMA linha por solicitação do período
// (~400/ano) e o cruzamento é feito aqui, puro, para o Vitest provar.
//
// Três "dimensões" de motivo, as do passo 2 do Solicitar Demissão:
//   · motivo_solicitacao — "Qual motivo da solicitação" (lista)
//   · motivo_pedido      — "Qual motivo do pedido de demissão" (lista)
//   · justificativa      — "Justificativa do desligamento" (lista, obrigatória
//                          desde 10/11/2026, mig 20261110190000; as antigas
//                          contam como "(não informado)")
//   · categoria_ia       — o relato livre, agrupado pela I.A (Edge
//                          demissao-relato-ia). NULL = ainda não classificado
//                          (ou relato editado depois) → "(aguardando I.A)".
// =====================================================================

export interface LinhaDemissao {
  id: number;
  data: string | null;
  colaborador: string | null;
  cargo: string | null;
  contrato: string | null;
  status: string | null;
  grupo: "aberto" | "concluido" | "recusado" | string | null;
  motivo_solicitacao: string | null;
  motivo_pedido: string | null;
  justificativa?: string | null;
  justificativa_complemento?: string | null;
  relato: string | null;
  categoria_ia: string | null;
}

export type DimensaoMotivo = "motivo_solicitacao" | "motivo_pedido" | "justificativa" | "categoria_ia";

export const DIMENSOES: { chave: DimensaoMotivo; rotulo: string; curto: string }[] = [
  { chave: "motivo_solicitacao", rotulo: "Motivo da solicitação", curto: "Solicitação" },
  { chave: "motivo_pedido", rotulo: "Motivo do pedido de demissão", curto: "Pedido" },
  { chave: "justificativa", rotulo: "Justificativa do desligamento", curto: "Justificativa" },
  { chave: "categoria_ia", rotulo: "Motivo do relato (agrupado pela I.A)", curto: "Relato (I.A)" },
];

export const NAO_INFORMADO = "(não informado)";
export const AGUARDANDO_IA = "(aguardando I.A)";
export const SEM_CONTRATO = "(sem contrato)";
/** Fatia que junta os motivos que não cabem no gráfico empilhado. */
export const DEMAIS = "Demais motivos";

const limpo = (v: string | null | undefined) => String(v ?? "").replace(/\s+/g, " ").trim();

export function valorDimensao(l: LinhaDemissao, dim: DimensaoMotivo): string {
  const v = limpo(l[dim]);
  if (v) return v;
  return dim === "categoria_ia" ? AGUARDANDO_IA : NAO_INFORMADO;
}

export const contratoDe = (l: LinhaDemissao) => limpo(l.contrato) || SEM_CONTRATO;

/** Total por motivo, do maior para o menor (empate: nome). */
export function contarMotivos(linhas: LinhaDemissao[], dim: DimensaoMotivo): { nome: string; n: number }[] {
  const m = new Map<string, number>();
  for (const l of linhas) {
    const k = valorDimensao(l, dim);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n || a.nome.localeCompare(b.nome, "pt-BR"));
}

export interface ContratosDoMotivo {
  /** Os `max` contratos com mais solicitações do motivo, do maior para o menor (empate: nome). */
  itens: { contrato: string; n: number }[];
  /** Quantos contratos ficaram de fora da lista (o "+N outros"). */
  outros: number;
}

/**
 * Para o tooltip de "Motivos do relato": de quais contratos vêm as
 * solicitações de cada motivo. Contrato pelo mesmo `contratoDe` do gráfico
 * "Motivo por contrato", para o nome bater com o de cima.
 */
export function contratosPorMotivo(linhas: LinhaDemissao[], dim: DimensaoMotivo, max = 10): Map<string, ContratosDoMotivo> {
  const porMotivo = new Map<string, Map<string, number>>();
  for (const l of linhas) {
    const k = valorDimensao(l, dim);
    let m = porMotivo.get(k);
    if (!m) porMotivo.set(k, (m = new Map()));
    const c = contratoDe(l);
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  const out = new Map<string, ContratosDoMotivo>();
  for (const [motivo, m] of porMotivo) {
    const todos = [...m].map(([contrato, n]) => ({ contrato, n }))
      .sort((a, b) => b.n - a.n || a.contrato.localeCompare(b.contrato, "pt-BR"));
    out.set(motivo, { itens: todos.slice(0, max), outros: Math.max(0, todos.length - max) });
  }
  return out;
}

export interface LinhaCruzada {
  contrato: string;
  total: number;
  /** motivo → quantidade (só os que aparecem). */
  porMotivo: Record<string, number>;
}

export interface Cruzamento {
  /** Todos os motivos da dimensão, do mais comum ao menos comum. */
  motivos: string[];
  /** Contratos do maior total ao menor. */
  linhas: LinhaCruzada[];
  totalPorMotivo: Record<string, number>;
  total: number;
}

/** Tabela contrato × motivo, completa. */
export function cruzarContratoMotivo(linhas: LinhaDemissao[], dim: DimensaoMotivo): Cruzamento {
  const porContrato = new Map<string, LinhaCruzada>();
  const totalPorMotivo: Record<string, number> = {};
  for (const l of linhas) {
    const c = contratoDe(l);
    const mot = valorDimensao(l, dim);
    let lc = porContrato.get(c);
    if (!lc) { lc = { contrato: c, total: 0, porMotivo: {} }; porContrato.set(c, lc); }
    lc.total += 1;
    lc.porMotivo[mot] = (lc.porMotivo[mot] ?? 0) + 1;
    totalPorMotivo[mot] = (totalPorMotivo[mot] ?? 0) + 1;
  }
  const motivos = Object.keys(totalPorMotivo)
    .sort((a, b) => totalPorMotivo[b] - totalPorMotivo[a] || a.localeCompare(b, "pt-BR"));
  const ordenadas = [...porContrato.values()]
    .sort((a, b) => b.total - a.total || a.contrato.localeCompare(b.contrato, "pt-BR"));
  return { motivos, linhas: ordenadas, totalPorMotivo, total: linhas.length };
}

/**
 * Dados do gráfico empilhado: os `maxContratos` maiores contratos e os
 * `maxMotivos` motivos mais comuns; o resto dos motivos vira DEMAIS (a soma
 * de cada barra continua sendo o total do contrato).
 */
export function dadosEmpilhados(cz: Cruzamento, maxContratos = 12, maxMotivos = 8): {
  series: string[];
  dados: ({ contrato: string; total: number } & Record<string, number | string>)[];
} {
  const visiveis = cz.motivos.length > maxMotivos ? cz.motivos.slice(0, maxMotivos - 1) : cz.motivos;
  const temDemais = cz.motivos.length > visiveis.length;
  const series = temDemais ? [...visiveis, DEMAIS] : visiveis;
  const dados = cz.linhas.slice(0, maxContratos).map((lc) => {
    const linha: { contrato: string; total: number } & Record<string, number | string> = { contrato: lc.contrato, total: lc.total };
    let resto = lc.total;
    for (const m of visiveis) { const n = lc.porMotivo[m] ?? 0; linha[m] = n; resto -= n; }
    if (temDemais) linha[DEMAIS] = resto;
    return linha;
  });
  return { series, dados };
}

export interface FiltroDetalhe {
  dim: DimensaoMotivo;
  /** null = qualquer motivo. DEMAIS = os que ficaram fora de `visiveis`. */
  motivo: string | null;
  contrato: string | null;
  /** Os motivos que têm fatia própria no gráfico (para resolver DEMAIS). */
  visiveis?: string[];
}

/** As solicitações por trás de uma barra/célula/categoria. */
export function filtrarDetalhe(linhas: LinhaDemissao[], f: FiltroDetalhe): LinhaDemissao[] {
  return linhas.filter((l) => {
    if (f.contrato != null && contratoDe(l) !== f.contrato) return false;
    if (f.motivo == null) return true;
    const v = valorDimensao(l, f.dim);
    if (f.motivo === DEMAIS) return !(f.visiveis ?? []).includes(v);
    return v === f.motivo;
  });
}

/** Quantas linhas ainda esperam a I.A (sem categoria para o relato atual). */
export const pendentesIA = (linhas: LinhaDemissao[]) => linhas.filter((l) => !limpo(l.categoria_ia)).length;

/** Título do modal de detalhe. */
export function tituloDetalhe(f: FiltroDetalhe): string {
  const dim = DIMENSOES.find((d) => d.chave === f.dim)?.curto ?? "";
  const partes = [f.motivo ? `${dim}: ${f.motivo}` : null, f.contrato].filter(Boolean);
  return partes.length ? partes.join(" · ") : "Todas as solicitações";
}
