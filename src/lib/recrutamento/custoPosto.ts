// Insalubridade e benefícios da vaga vêm da PLANILHA DE CUSTO (14/09/2026).
//
// Desde 15/09/2026 o POSTO é escolhido no catálogo de Suprimentos (que é
// espelho da planilha — sup_posto.nome = planilha_custo.posto) e vai em
// `posto` pra RPC rec_custo_do_posto (migration 20260930000122): casa pelo
// nome exato e devolve insalubridade, VT e VA daquele posto. Antes a RPC
// adivinhava por salário/cidade/cargo e errou (ASG recebeu o V.A do
// supervisor). Sem posto escolhido a tela NÃO consulta: mostra aviso e
// deixa o V.A/V.T em branco — insalubridade cai no cadastro do colaborador.
//
// 24/09/2026 (mig 20260930000230): quando o nome do catálogo não existe na
// planilha ("1ª DP NOVO HAMBURGO" x "LIMPEZA 20H 5X2 NOVO HAMBURGO"), a RPC
// não devolve mais NULL — pontua os postos do contrato por cidade + carga
// semanal tirada da ESCALA + padrão 5X2/6X1/12X36, e marca por_posto=false.

export interface CustoPosto {
  posto: string;
  servico: string | null;
  salario: number | null;
  insalubridade: number | null;
  periculosidade: number | null;
  vt: number | null;
  vt_desconto: number | null;
  va: number | null;
  va_desconto: number | null;
  vr: number | null;
  /** Aux. lanche da planilha — a UFRGS paga isso à ASG em vez de V.A (15/09/2026). */
  lanche?: number | null;
  cesta_basica: number | null;
  assistencia_medica: number | null;
  vigencia: string | null;
  score: number;
  candidatos: number;
  ambiguo: boolean;
  casou_salario: boolean;
  /** true = nome exato do catálogo; false = aproximado por cidade/escala. */
  por_posto?: boolean;
}

export interface EntradaCusto {
  contrato: string;
  /** Nome do posto no catálogo (= posto da Planilha de Custo). Sem ele, a RPC adivinha — a tela não chama assim. */
  posto?: string | null;
  cargo?: string | null;
  salario?: number | string | null;
  cidade?: string | null;
  /** Escala da vaga ("8:00-12:00 (4H) SEG A SEX") — dá a carga semanal (20H) quando o posto não casa pelo nome. */
  escala?: string | null;
}

const num = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v).replace(/R\$\s*/i, "").replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Salário como a tela guarda ("R$ 1.605,33") → 1605.33. */
export const salarioNumero = (v: unknown): number | null => {
  const n = num(v);
  return n > 0 ? n : null;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export async function buscarCustoDoPosto(sb: any, e: EntradaCusto): Promise<CustoPosto | null> {
  if (!e.contrato?.trim()) return null;
  const { data, error } = await sb.rpc("rec_custo_do_posto", {
    p_contrato: e.contrato, p_cargo: e.cargo ?? null, p_salario: salarioNumero(e.salario), p_cidade: e.cidade ?? null,
    p_posto: e.posto?.trim() || null, p_escala: e.escala?.trim() || null,
  });
  if (error) { console.warn("[rec_custo_do_posto]", error.message); return null; }
  return (data as CustoPosto | null) ?? null;
}

/**
 * Insalubridade pronta pros dois campos da vaga.
 * Da planilha: "Sim — R$ 642,13/mês (40%)". Do cadastro: "Sim — 40%".
 */
export function insalubridadeDoCusto(
  custo: CustoPosto | null, cadastroPct?: unknown, salario?: unknown,
): { recebe: "Sim" | "Não"; quanto: string; origem: "planilha" | "cadastro" | "nenhuma" } {
  if (custo) {
    const v = num(custo.insalubridade);
    if (v > 0) {
      const base = num(custo.salario) || num(salario);
      const pct = base > 0 ? Math.round((v / base) * 100) : 0;
      return { recebe: "Sim", quanto: `${brl(v)}/mês${pct ? ` (${pct}%)` : ""}`, origem: "planilha" };
    }
    return { recebe: "Não", quanto: "", origem: "planilha" };
  }
  const pct = num(cadastroPct);
  if (pct > 0) return { recebe: "Sim", quanto: `${String(cadastroPct).trim().replace("%", "")}%`, origem: "cadastro" };
  return { recebe: "Não", quanto: "", origem: cadastroPct === undefined ? "nenhuma" : "cadastro" };
}

/** "VT R$ 126,28/mês · VA R$ 461,82/mês" — só o que é maior que zero. */
export function beneficiosDoCusto(custo: CustoPosto | null): string {
  if (!custo) return "";
  const partes: string[] = [];
  if (num(custo.vt) > 0) partes.push(`VT ${brl(num(custo.vt))}/mês`);
  if (num(custo.va) > 0) partes.push(`VA ${brl(num(custo.va))}/mês`);
  if (num(custo.vr) > 0) partes.push(`VR ${brl(num(custo.vr))}/mês`);
  if (num(custo.lanche) > 0) partes.push(`Aux. lanche ${brl(num(custo.lanche))}/mês`);
  if (num(custo.cesta_basica) > 0) partes.push(`Cesta básica ${brl(num(custo.cesta_basica))}/mês`);
  if (num(custo.assistencia_medica) > 0) partes.push(`Assistência médica ${brl(num(custo.assistencia_medica))}/mês`);
  return partes.join(" · ");
}

/** Aviso quando a vaga ainda não tem posto do catálogo: sem ele não se consulta a planilha. */
export const AVISO_SEM_POSTO = "Selecione o posto e a função no catálogo de Suprimentos (etapa 1): o V.A e o V.T vêm do posto da Planilha de Custo — sem isso não são puxados.";

/** A nota embaixo dos campos: de onde veio e se é pra conferir. */
export function notaDoCusto(custo: CustoPosto | null, origemInsal: "planilha" | "cadastro" | "nenhuma", postoEscolhido?: string | null): string {
  if (!custo && postoEscolhido) {
    return `O posto "${postoEscolhido}" não está na Planilha de Custo vigente do contrato — V.A e V.T ficam com o Recrutamento${origemInsal === "cadastro" ? "; insalubridade veio do cadastro do colaborador" : ""}.`;
  }
  if (custo) {
    const base = `Da Planilha de Custo — posto "${custo.posto}"${custo.vigencia ? `, vigência ${custo.vigencia.split("-").reverse().join("/")}` : ""}.`;
    if (postoEscolhido && custo.por_posto === false) {
      return `Da Planilha de Custo — o posto "${postoEscolhido}" não tem esse nome na planilha; usado "${custo.posto}" (mesma cidade e jornada)${custo.ambiguo ? ", mas há postos parecidos com valores diferentes" : ""}. O Recrutamento confere.`;
    }
    if (custo.ambiguo) return base + " Há mais de um posto parecido no contrato com valores diferentes — o Recrutamento confere.";
    if (!custo.casou_salario) return base + " O salário do colaborador não bateu com nenhum posto; foi pelo cargo.";
    return base;
  }
  if (origemInsal === "cadastro") return "Contrato sem Planilha de Custo cadastrada — insalubridade veio do cadastro do colaborador; benefícios ficam com o Recrutamento.";
  return "Contrato sem Planilha de Custo cadastrada — insalubridade e benefícios ficam com o Recrutamento.";
}
