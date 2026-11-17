export interface ItemCatalogoCompra {
  id: string;
  nome: string;
  tipo: string;
  tamanho: string | null;
  item_pai_id: string | null;
  codigo: string | null;
  almoxarifados: string[];
  disponivel: number;
  fisico: number;
  situacaoEstoque: "ativo" | "historico" | "sem_ficha";
}

export type ItemCatalogoCompraBase = Pick<
  ItemCatalogoCompra,
  "id" | "nome" | "tipo" | "tamanho" | "item_pai_id" | "codigo"
>;

export interface FichaEstoqueCatalogoCompra {
  id: string;
  sup_item_id: string;
  arquivado_em: string | null;
  almoxarifado: { nome: string } | { nome: string }[] | null;
}

export interface SaldoEstoqueCatalogoCompra {
  item_estoque_id: string;
  disponivel: number | null;
  fisico: number | null;
}

const nomeDoAlmoxarifado = (ficha: FichaEstoqueCatalogoCompra) => {
  const valor = Array.isArray(ficha.almoxarifado) ? ficha.almoxarifado[0] : ficha.almoxarifado;
  return valor?.nome?.trim() || null;
};

/**
 * Junta o catálogo aprovado com a ficha operacional do estoque sem carregar
 * milhares de etiquetas. O pedido continua aceitando material ainda sem
 * estoque, mas quem compra enxerga a mesma identidade usada pelo almoxarifado:
 * código, local, tamanho e saldo.
 */
export function enriquecerCatalogoPedidoCompra(
  catalogo: ItemCatalogoCompraBase[],
  fichas: FichaEstoqueCatalogoCompra[],
  saldos: SaldoEstoqueCatalogoCompra[],
): ItemCatalogoCompra[] {
  const fichasPorItem = new Map<string, FichaEstoqueCatalogoCompra[]>();
  for (const ficha of fichas) {
    const atuais = fichasPorItem.get(ficha.sup_item_id) ?? [];
    atuais.push(ficha);
    fichasPorItem.set(ficha.sup_item_id, atuais);
  }

  const saldoPorFicha = new Map<string, { disponivel: number; fisico: number }>();
  for (const saldo of saldos) {
    const atual = saldoPorFicha.get(saldo.item_estoque_id) ?? { disponivel: 0, fisico: 0 };
    atual.disponivel += Number(saldo.disponivel ?? 0);
    atual.fisico += Number(saldo.fisico ?? 0);
    saldoPorFicha.set(saldo.item_estoque_id, atual);
  }

  return catalogo.map((item) => {
    const todasAsFichas = fichasPorItem.get(item.id) ?? [];
    const fichasAtivas = todasAsFichas.filter((ficha) => !ficha.arquivado_em);
    const fichasParaIdentificacao = fichasAtivas.length ? fichasAtivas : todasAsFichas;
    const almoxarifados = [...new Set(
      fichasParaIdentificacao.map(nomeDoAlmoxarifado).filter((nome): nome is string => !!nome),
    )].sort((a, b) => a.localeCompare(b, "pt-BR"));

    return {
      ...item,
      almoxarifados,
      disponivel: fichasAtivas.reduce(
        (total, ficha) => total + Number(saldoPorFicha.get(ficha.id)?.disponivel ?? 0),
        0,
      ),
      fisico: fichasAtivas.reduce(
        (total, ficha) => total + Number(saldoPorFicha.get(ficha.id)?.fisico ?? 0),
        0,
      ),
      situacaoEstoque: fichasAtivas.length
        ? "ativo"
        : todasAsFichas.length
          ? "historico"
          : "sem_ficha",
    };
  });
}

const expandirSiglasDeModelo = (texto: string) => texto
  .replace(/\bML\b/gi, " ML MANGA LONGA ")
  .replace(/\bMC\b/gi, " MC MANGA CURTA ");

const normalizarBusca = (texto: string) => expandirSiglasDeModelo(texto)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^A-Z0-9]+/gi, " ")
  .trim()
  .toLocaleUpperCase("pt-BR");

/** Explica a sigla sem alterar o nome oficial cadastrado. */
export function modeloDoMaterial(nome: string): string | null {
  if (/\bML\b/i.test(nome)) return "Manga longa";
  if (/\bMC\b/i.test(nome)) return "Manga curta";
  return null;
}

/**
 * Busca por todos os termos, sem exigir a mesma ordem do cadastro. Assim
 * "camiseta manga longa vermelha" encontra "CAMISETA VERMELHA (ML)".
 */
export function filtrarItensCatalogoCompra(
  catalogo: ItemCatalogoCompra[],
  busca: string,
  idsJaUsados: ReadonlySet<string> = new Set(),
): ItemCatalogoCompra[] {
  const termo = normalizarBusca(busca);
  if (termo.length < 2) return [];
  const palavras = termo.split(/\s+/).filter(Boolean);

  return catalogo.filter((item) => {
    if (idsJaUsados.has(item.id)) return false;
    const texto = normalizarBusca([
      item.codigo,
      item.nome,
      item.tamanho,
      item.tipo,
      item.almoxarifados.join(" "),
      modeloDoMaterial(item.nome),
    ].filter(Boolean).join(" "));
    return palavras.every((palavra) => texto.includes(palavra));
  });
}
