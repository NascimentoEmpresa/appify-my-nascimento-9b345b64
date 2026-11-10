/**
 * Posição por item do Dashboard de Compras e Estoque — agrupamento, filtro e
 * exportação.
 *
 * A conta toda é da RPC `sup_dashboard_compras_estoque` (migration
 * 20261110000100). Aqui mora só o que reorganiza linhas já calculadas: nada
 * recalcula pendência nem compra no navegador.
 *
 * POR QUE FAMÍLIA É LINHA-MÃE, E NÃO UMA LINHA POR ITEM
 * O solicitante pediu no nível do material ("se dos 3 pedidos juntando tudo só
 * está pendente 2 calça sarja, a calça sarja aparece como 2"), mas estoque,
 * ficha, preço e compra existem por TAMANHO — é lá que a reposição acontece.
 * Então a família soma e abre nos tamanhos, em vez de escolher um dos dois.
 */
import type { PosicaoItem } from "./dashboardComprasEstoque";

/** As colunas somáveis de uma linha de posição. */
export const CAMPOS_SOMA = [
  "disponivel",
  "reservado",
  "fisico",
  "entrou",
  "saiu",
  "ajustes",
  "pendente_entrega",
  "aguardando_compra",
  "em_transito",
  "valor_total",
] as const satisfies readonly (keyof PosicaoItem)[];

export type CampoSoma = (typeof CAMPOS_SOMA)[number];

export interface FamiliaPosicao extends Record<CampoSoma, number> {
  base_id: string;
  item: string;
  categoria: string;
  /** Quantos tamanhos daquela família têm alguma pendência de entrega. */
  tamanhos_com_pendencia: number;
  tamanhos: PosicaoItem[];
}

export type OrdemPosicao =
  | "pendente_entrega"
  | "em_compra"
  | "disponivel"
  | "saiu"
  | "entrou"
  | "item";

/** "Único" é rótulo de tela; no dado o sem-tamanho é `null`. */
export function rotuloTamanho(tamanho: string | null): string {
  return tamanho ?? "Único";
}

/** O que já foi comprado e ainda não chegou, nas duas etapas somadas. */
export function emCompra(linha: Pick<PosicaoItem, "aguardando_compra" | "em_transito">): number {
  return Number(linha.aguardando_compra ?? 0) + Number(linha.em_transito ?? 0);
}

/**
 * A linha tem alguma pendência operacional?
 *
 * Serve ao filtro "só com pendência", que é como esta tabela é lida no dia a
 * dia: o catálogo inteiro não cabe na tela e o que interessa é o que falta ou
 * o que está vindo.
 */
export function temPendencia(linha: PosicaoItem): boolean {
  return Number(linha.pendente_entrega ?? 0) > 0 || emCompra(linha) > 0;
}

function somar(destino: Record<CampoSoma, number>, linha: PosicaoItem) {
  for (const campo of CAMPOS_SOMA) destino[campo] += Number(linha[campo] ?? 0);
}

function zeros(): Record<CampoSoma, number> {
  return Object.fromEntries(CAMPOS_SOMA.map((c) => [c, 0])) as Record<CampoSoma, number>;
}

export function agruparPosicaoPorFamilia(
  linhas: PosicaoItem[],
  opcoes: { busca?: string; soPendencias?: boolean; ordem?: OrdemPosicao } = {},
): FamiliaPosicao[] {
  const busca = (opcoes.busca ?? "").trim().toLocaleLowerCase("pt-BR");
  const familias = new Map<string, FamiliaPosicao>();

  for (const linha of linhas) {
    if (busca) {
      const alvo = `${linha.item} ${linha.codigo ?? ""}`.toLocaleLowerCase("pt-BR");
      if (!alvo.includes(busca)) continue;
    }
    let familia = familias.get(linha.base_id);
    if (!familia) {
      familia = {
        ...zeros(),
        base_id: linha.base_id,
        item: linha.item,
        categoria: linha.categoria,
        tamanhos_com_pendencia: 0,
        tamanhos: [],
      };
      familias.set(linha.base_id, familia);
    }
    familia.tamanhos.push(linha);
    somar(familia, linha);
    if (Number(linha.pendente_entrega ?? 0) > 0) familia.tamanhos_com_pendencia += 1;
  }

  const selecionadas = [...familias.values()].filter(
    // O filtro é por FAMÍLIA, não por tamanho: um tamanho já coberto continua
    // visível dentro de uma família que tem pendência, mostrando zero em vez
    // de parecer uma combinação que saiu do planejamento.
    (familia) => !opcoes.soPendencias || familia.tamanhos.some(temPendencia),
  );

  const porNome = (a: FamiliaPosicao, b: FamiliaPosicao) =>
    a.item.localeCompare(b.item, "pt-BR") || a.base_id.localeCompare(b.base_id);
  const ordem = opcoes.ordem ?? "pendente_entrega";
  selecionadas.sort((a, b) => {
    if (ordem === "item") return porNome(a, b);
    const valor = (f: FamiliaPosicao) => (ordem === "em_compra" ? emCompra(f) : f[ordem]);
    return valor(b) - valor(a) || porNome(a, b);
  });

  for (const familia of selecionadas) {
    familia.tamanhos.sort(
      (a, b) =>
        a.ordem_tamanho - b.ordem_tamanho ||
        rotuloTamanho(a.tamanho).localeCompare(rotuloTamanho(b.tamanho), "pt-BR", { numeric: true }),
    );
  }
  return selecionadas;
}

const COLUNAS_CSV = [
  "Código",
  "Item",
  "Tamanho",
  "Categoria",
  "Disponível",
  "Reservado",
  "Entrou no período",
  "Saiu no período",
  "Ajustes no período",
  "Pendente de entrega",
  "Em cotação (Malote)",
  "Comprado, a receber",
  "Valor em estoque",
] as const;

/**
 * CSV com ponto e vírgula e vírgula decimal: abre no Excel em português sem
 * passar pelo assistente de importação. Uma linha por tamanho, com a linha de
 * subtotal da família antes dos tamanhos dela.
 */
export function csvDaPosicaoPorItem(familias: FamiliaPosicao[]): string {
  const numero = (n: number | null | undefined) =>
    n === null || n === undefined ? "" : String(n).replace(".", ",");
  const celula = (valor: string | number) =>
    /[;"\n]/.test(String(valor)) ? `"${String(valor).replace(/"/g, '""')}"` : String(valor);

  const linhas: string[] = [COLUNAS_CSV.join(";")];
  for (const familia of familias) {
    linhas.push(
      [
        "",
        familia.item,
        "TOTAL DA FAMÍLIA",
        familia.categoria,
        numero(familia.disponivel),
        numero(familia.reservado),
        numero(familia.entrou),
        numero(familia.saiu),
        numero(familia.ajustes),
        numero(familia.pendente_entrega),
        numero(familia.aguardando_compra),
        numero(familia.em_transito),
        numero(familia.valor_total),
      ].map(celula).join(";"),
    );
    for (const t of familia.tamanhos) {
      linhas.push(
        [
          t.codigo ?? "",
          t.item,
          rotuloTamanho(t.tamanho),
          t.categoria,
          numero(t.disponivel),
          numero(t.reservado),
          numero(t.entrou),
          numero(t.saiu),
          numero(t.ajustes),
          numero(t.pendente_entrega),
          numero(t.aguardando_compra),
          numero(t.em_transito),
          numero(t.valor_total),
        ].map(celula).join(";"),
      );
    }
  }
  return linhas.join("\r\n");
}
