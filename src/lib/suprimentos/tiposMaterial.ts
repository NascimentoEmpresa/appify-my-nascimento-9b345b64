/**
 * Os tipos de material do catálogo, num lugar só.
 *
 * O valor é o que está no banco (CHECK de `sup_item.tipo`); o rótulo é o que a
 * pessoa lê. Ficam juntos aqui porque três telas mostram a mesma lista — se
 * cada uma escrever a sua, um dia uma delas esquece "limpeza" e o filtro passa
 * a esconder material sem ninguém entender por quê.
 *
 * `epi` é o único com efeito de regra: é ele que aciona laudo do SST,
 * exigência de CA na entrada e bloqueio por CA irregular.
 */
export const TIPOS_MATERIAL = [
  { valor: "uniforme", rotulo: "Uniforme" },
  { valor: "epi", rotulo: "EPI" },
  { valor: "limpeza", rotulo: "Material de limpeza" },
  { valor: "insumo", rotulo: "Insumo" },
  { valor: "equipamento", rotulo: "Equipamento" },
] as const;

export type TipoMaterial = (typeof TIPOS_MATERIAL)[number]["valor"];

/** Sentinela do filtro. Não é valor de banco — só a opção "não filtrar". */
export const TODOS_OS_TIPOS = "__todos__";

export function rotuloDoTipo(valor: string | null | undefined): string {
  return TIPOS_MATERIAL.find((t) => t.valor === valor)?.rotulo ?? valor ?? "—";
}
