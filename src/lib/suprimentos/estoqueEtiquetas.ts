import type { LinhaEstoque } from "@/hooks/useSupEstoque";

/**
 * Sem termo, ficha arquivada não volta para o estoque atual. Com termo, pode
 * ser encontrada pelo produto ou lote para explicar o histórico do dashboard.
 */
export function filtrarLinhasEstoque(
  linhas: LinhaEstoque[],
  busca: string,
  tipo: string,
  todosOsTipos: string,
): LinhaEstoque[] {
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  return linhas.filter((linha) => {
    if (!termo && linha.arquivado_em) return false;
    if (tipo !== todosOsTipos && linha.tipo_material !== tipo) return false;
    if (!termo) return true;
    return [
      linha.codigo_item,
      linha.material,
      linha.almoxarifado,
      linha.tamanhos.join(" "),
      linha.base?.codigo,
      linha.localizacao,
      linha.codigos_lote.join(" "),
    ].join(" ").toLocaleLowerCase("pt-BR").includes(termo);
  });
}
