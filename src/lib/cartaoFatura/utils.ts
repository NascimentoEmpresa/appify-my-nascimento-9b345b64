// Helpers compartilhados pelos adaptadores de banco (tipos.ts).

/** "R$ 24,15" / "R$ -149,90" / "-15.925,62" / 24.15 (já numérico) → number. */
export function parseValorBR(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const limpo = String(v).replace(/R\$/gi, "").trim().replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : 0;
}

/** "12/10/2025" → "2025-10-12". */
export function parseDataBRComAno(v: string): string | null {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * "11/06" sem ano → infere o ano a partir da competência da fatura (mês
 * selecionado no passo 1 do modal). A maioria das transações é do mesmo
 * ano da competência; uma compra referenciada na seção "Compras
 * parceladas" pode ser de meses atrás — se o mês da linha vier DEPOIS do
 * mês da competência, assume ano anterior (regra prática: fatura nunca
 * lista transação do futuro).
 */
export function parseDataBRSemAno(v: string, competenciaAno: number, competenciaMes: number): string | null {
  const m = v.trim().match(/^(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const [, dd, mm] = m;
  const mesLinha = parseInt(mm, 10);
  const ano = mesLinha > competenciaMes ? competenciaAno - 1 : competenciaAno;
  return `${ano}-${mm}-${dd}`;
}

export interface ParcelaExtraida {
  atual: number;
  total: number;
  descricaoLimpa: string;
}

/**
 * Acha o padrão de parcela numa descrição — "PARC 11/12" (Banco do
 * Brasil, seção "Compras parceladas") ou só "10/12" / "012/012" solto no
 * fim do texto (Banrisul; Bradesco usa 3 dígitos com zero à esquerda).
 * Sempre pega a ÚLTIMA ocorrência plausível (atual <= total <= 48) pra não
 * confundir com outro número solto na descrição. Sem match = compra não
 * parcelada (retorna null, descrição intacta).
 */
export function extrairParcela(descricaoBruta: string): ParcelaExtraida | null {
  const comMarca = /PARC\s*(\d{1,3})\s*\/\s*(\d{1,3})/gi;
  const generico = /(\d{1,3})\s*\/\s*(\d{1,3})/g;

  let ultimoMatch: RegExpExecArray | null = null;
  let regex = comMarca;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(descricaoBruta))) ultimoMatch = m;

  if (!ultimoMatch) {
    regex = generico;
    regex.lastIndex = 0;
    while ((m = regex.exec(descricaoBruta))) {
      const atual = parseInt(m[1], 10);
      const total = parseInt(m[2], 10);
      if (atual >= 1 && total >= 1 && atual <= total && total <= 48) ultimoMatch = m;
    }
  }

  if (!ultimoMatch) return null;
  const atual = parseInt(ultimoMatch[1], 10);
  const total = parseInt(ultimoMatch[2], 10);
  if (!(atual >= 1 && total >= 1 && atual <= total && total <= 48)) return null;

  const descricaoLimpa = (descricaoBruta.slice(0, ultimoMatch.index) + descricaoBruta.slice(ultimoMatch.index + ultimoMatch[0].length))
    .replace(/\s{2,}/g, " ")
    .trim();

  return { atual, total, descricaoLimpa: descricaoLimpa || descricaoBruta.trim() };
}
