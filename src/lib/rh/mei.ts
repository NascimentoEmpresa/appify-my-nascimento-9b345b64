// MEI em EMPREGADOS — a mesma regra pra importar e pra exportar.
//
// Colunas onde o "tipo de contrato" pode aparecer (varia entre exports do
// Senior; a primeira é a da própria EMPREGADOS, hoje CLT | MEI | null).
// Importar: MEI não é tocado (nem insert, nem update). Exportar: MEI não
// entra no relatório (18/09/2026).
export const COLS_TIPO_CONTRATO = [
  "TIPO DE CONTRATO", "Descrição (T. Contrato)", "Descrição (Tipo)",
  "Descrição (Categoria Contribuinte)", "Descrição (Cat. eSocial)", "Descrição (Categoria Sefip)",
] as const;

export const ehMEI = (r: Record<string, unknown> | null | undefined): boolean =>
  COLS_TIPO_CONTRATO.some((c) => {
    const v = r?.[c];
    return typeof v === "string" && (/\bMEI\b/i.test(v) || /MICROEMPREEND/i.test(v));
  });

/** As colunas acima que EXISTEM em EMPREGADOS (conferido no banco do app em
 *  18/09/2026) — "Descrição (Categoria Contribuinte)" só aparece em planilha.
 *  É esta lista que vai no SELECT: pedir coluna inexistente derruba a query. */
export const COLS_TIPO_CONTRATO_EMPREGADOS = COLS_TIPO_CONTRATO.filter((c) => c !== "Descrição (Categoria Contribuinte)");
