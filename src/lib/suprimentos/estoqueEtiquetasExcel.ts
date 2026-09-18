import type { LinhaEstoque } from "@/hooks/useSupEstoque";

/** Linha do Excel do estoque: números ficam como número para permitir filtro e soma no arquivo. */
export function montarLinhasExcelEstoque(linhas: LinhaEstoque[]) {
  return linhas.map((linha) => ({
    "Código": linha.codigo_item ?? "",
    "Material": linha.material,
    "Tipo": linha.tipo_material,
    "Almoxarifado": linha.almoxarifado,
    "Localização": linha.localizacao ?? "",
    "Tamanho": linha.tamanhos.join(", "),
    "Disponível": linha.disponivel,
    "Reservado": linha.reservado,
    "Físico": linha.fisico,
    "Consumido": linha.consumido,
    "Estoque mínimo": linha.estoque_minimo,
    "Custo unitário": linha.custo_unitario,
    "Valor total": linha.valor_total,
    "Entradas registradas": linha.etiquetas,
    "Preço válido até": linha.preco_valido_ate ?? "",
    "Observações": linha.observacoes ?? "",
  }));
}

export function nomeArquivoEstoque(escopo: "completo" | "filtrado", data = new Date()) {
  const preencher = (numero: number) => String(numero).padStart(2, "0");
  return `estoque-${escopo}-${data.getFullYear()}-${preencher(data.getMonth() + 1)}-${preencher(data.getDate())}.xlsx`;
}
