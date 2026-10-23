// =====================================================================
// Gestão Recrutamento — filtro de status com várias marcações (23/10/2026).
// Com teste em src/test/recrutamento-filtro-status-vaga.test.ts.
//
// Pedido do Pablo (print do Excel exportado, com o filtro de Status do Excel
// aberto): "esse tipo de seleção na tela, com a quantidade ao lado". E o
// motivo: filtrando "Responsável da vaga: TAINARA" em "Todas", vinham as
// Reprovadas e Contratadas junto, sem ele ter pedido. O responsável já
// combinava (AND) com o atalho de status — "Todas" é que trazia tudo. Com a
// multi-seleção dá para ficar só com o que interessa (ex.: tudo menos
// Reprovada/Contratado/Concluído), e o responsável nunca alarga o recorte.
//
// Convive com os atalhos (Todas / Pendente Recrutamento / Em Processo...):
// ou um ou outro. Marcar status aqui volta o atalho para "Todas"; clicar num
// atalho limpa as marcações — dois filtros de status somados zerariam a
// tela sem explicar (ex.: atalho Reprovados + marcado Contratado). No
// Recrutamento os atalhos saíram no mesmo dia (sobrou só este botão, e os
// cards do topo seguem as marcações); ficam nas filas da etapa 1.
// =====================================================================

import { PASSOS_FLUXO } from "@/lib/recrutamento/fluxoStatus";
import { rotuloStatusVaga } from "@/lib/recrutamento/vagaRegras";
import { vagaConcluida, vagaEmAndamento } from "@/lib/recrutamento/vagaEmAndamento";
import { STATUS_VAGA_ENCERRADA_RESP, vagaEncerradaSemResponsavel } from "@/lib/recrutamento/responsavelVaga";

/**
 * Todos os status reais da vaga, na ordem do fluxo (o mesmo do botão Status:
 * PASSOS_FLUXO) e depois os finais. Status fora desta lista (legado) também
 * aparecem no filtro, no fim, se existirem no banco.
 */
export const ORDEM_STATUS_VAGA: readonly string[] = [
  ...PASSOS_FLUXO.flatMap((p) => p.status),
  "Concluído",
  "Reprovada",
  "Cancelada",
];

/** Uma linha do filtro: o nome na tela, os valores do banco que ela junta e quantas vagas. */
export interface OpcaoStatusVaga {
  rotulo: string;
  status: string[];
  n: number;
}

const limpo = (s: string | null | undefined) => String(s ?? "").trim();

/** Posição na ordem do fluxo ("Concluído - ..." vai junto de "Concluído"; desconhecido no fim). */
function posicao(status: string): number {
  const i = ORDEM_STATUS_VAGA.indexOf(status.startsWith("Concluído") ? "Concluído" : status);
  return i >= 0 ? i : ORDEM_STATUS_VAGA.length;
}

/**
 * As opções do filtro com a quantidade de cada uma, a partir das vagas que
 * passam em TODOS os outros filtros (mês, contratos, etiquetas, responsável,
 * busca). Agrupa pelo nome na tela — "Pendente Analista" e o legado
 * "Pendente Operacional" aparecem como uma linha só, "Pendente Operacional".
 * Só entram as que têm vaga, mais as já marcadas (com 0), para dar pra
 * desmarcar o que sumiu do recorte.
 */
export function opcoesStatusVaga(
  vagas: { status?: string | null }[],
  marcados: readonly string[] = [],
  rotular: (s: string) => string = rotuloStatusVaga,
): OpcaoStatusVaga[] {
  const porRotulo = new Map<string, { status: Set<string>; n: number }>();
  const pegar = (status: string) => {
    const r = rotular(status);
    let o = porRotulo.get(r);
    if (!o) { o = { status: new Set(), n: 0 }; porRotulo.set(r, o); }
    o.status.add(status);
    return o;
  };
  for (const v of vagas) {
    const s = limpo(v.status);
    if (s) pegar(s).n++;
  }
  for (const s of marcados) if (limpo(s)) pegar(limpo(s));
  // Os valores conhecidos do mesmo rótulo vão juntos (marcar "Pendente
  // Operacional" pega as duas grafias, mesmo que hoje só exista uma).
  for (const s of ORDEM_STATUS_VAGA) {
    const o = porRotulo.get(rotular(s));
    if (o) o.status.add(s);
  }
  return Array.from(porRotulo, ([rotulo, o]) => ({ rotulo, status: Array.from(o.status), n: o.n }))
    .sort((a, b) => {
      const pa = Math.min(...a.status.map(posicao));
      const pb = Math.min(...b.status.map(posicao));
      return pa - pb || a.rotulo.localeCompare(b.rotulo, "pt-BR");
    });
}

/** A opção está marcada? (qualquer um dos valores dela). */
export const opcaoMarcada = (marcados: readonly string[], opcao: Pick<OpcaoStatusVaga, "status">): boolean =>
  opcao.status.some((s) => marcados.includes(s));

/** Marca ou desmarca a opção inteira (todos os valores do banco que ela junta). */
export function alternarOpcao(marcados: readonly string[], opcao: Pick<OpcaoStatusVaga, "status">): string[] {
  if (opcaoMarcada(marcados, opcao)) return marcados.filter((s) => !opcao.status.includes(s));
  return [...marcados, ...opcao.status.filter((s) => !marcados.includes(s))];
}

/**
 * O status passa nas marcações? Nada marcado = todos — ou, com
 * `semEncerradas` (a lista da Gestão Recrutamento, 23/10/2026), todos MENOS
 * as encerradas. Pablo: "os concluídos, reprovados e contratados ficam fora
 * geral; só se eu filtrar nos status eles aparecem". Os cards do topo não
 * usam `semEncerradas` (Concluídas/Reprovadas mostram o total).
 */
export const passaNosStatusMarcados = (status: string | null | undefined, marcados: readonly string[], semEncerradas = false): boolean =>
  marcados.length ? marcados.includes(limpo(status)) : !semEncerradas || !vagaEncerradaSemResponsavel(status);

/** O mesmo "sem encerradas" num builder do PostgREST (Contratado/Reprovada/Cancelada + Concluído…). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do PostgREST; o tipo exato muda a cada .select()
export function filtrarSemEncerradas<Q extends { not: (...a: any[]) => Q }>(q: Q): Q {
  const lista = STATUS_VAGA_ENCERRADA_RESP.map((s) => `"${s}"`).join(",");
  return q.not("status", "in", `(${lista})`).not("status", "like", "Concluído%");
}

/** Os atalhos da tela (val do botão): "" = Todas. Mesma regra da consulta (aplicarFiltros). */
export const ATALHO_EM_PROCESSO = "em_processo";
export const ATALHO_CONCLUIDAS = "concluido";
export const ATALHO_PEND_SELECAO = "pend_selecao";

export function passaNoAtalho(status: string | null | undefined, atalho: string, statusSelecao: readonly string[] = []): boolean {
  const s = limpo(status);
  if (!atalho) return true;
  if (atalho === ATALHO_EM_PROCESSO) return vagaEmAndamento(s);
  if (atalho === ATALHO_PEND_SELECAO) return statusSelecao.includes(s);
  if (atalho === ATALHO_CONCLUIDAS) return vagaConcluida(s);
  return s === atalho;
}

/**
 * A vaga aparece na lista? Atalho E marcações E o resto (ex.: o filtro de
 * responsável, passado como `outros`) — tudo em AND: nenhum filtro alarga o
 * que o outro recortou.
 */
export function passaNoStatusDaLista(
  status: string | null | undefined,
  filtro: { atalho: string; marcados: readonly string[]; statusSelecao?: readonly string[]; semEncerradas?: boolean },
  outros = true,
): boolean {
  // Sem encerradas só quando nem atalho nem marcação dizem outra coisa.
  const semEncerradas = !!filtro.semEncerradas && !filtro.atalho;
  return outros && passaNoAtalho(status, filtro.atalho, filtro.statusSelecao) && passaNosStatusMarcados(status, filtro.marcados, semEncerradas);
}

/** Texto do botão: "Status" · "Status: Reprovada" · "Status (3)". */
export function rotuloBotaoStatus(marcados: readonly string[], opcoes: OpcaoStatusVaga[]): string {
  const marcadas = opcoes.filter((o) => opcaoMarcada(marcados, o));
  if (marcadas.length === 0) return "Status";
  if (marcadas.length === 1) return `Status: ${marcadas[0].rotulo}`;
  return `Status (${marcadas.length})`;
}
