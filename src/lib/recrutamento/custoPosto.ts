// Insalubridade e benefícios da vaga vêm da PLANILHA DE CUSTO (14/09/2026).
//
// O encarregado escolhe o colaborador e pronto: contrato, cargo, salário e
// cidade vão pra RPC rec_custo_do_posto (migration 20260930000109), que
// acha o posto na planilha e devolve insalubridade, VT e VA do contrato. A
// tela só MOSTRA — não tem select nem textarea pra isso. Sem a planilha
// (contrato sem custo cadastrado), cai no cadastro do colaborador
// ("% Insalubridade" de EMPREGADOS) e os benefícios ficam em branco com aviso.

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
  cesta_basica: number | null;
  assistencia_medica: number | null;
  vigencia: string | null;
  score: number;
  candidatos: number;
  ambiguo: boolean;
  casou_salario: boolean;
}

export interface EntradaCusto {
  contrato: string;
  cargo?: string | null;
  salario?: number | string | null;
  cidade?: string | null;
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
  if (num(custo.cesta_basica) > 0) partes.push(`Cesta básica ${brl(num(custo.cesta_basica))}/mês`);
  if (num(custo.assistencia_medica) > 0) partes.push(`Assistência médica ${brl(num(custo.assistencia_medica))}/mês`);
  return partes.join(" · ");
}

/** A nota embaixo dos campos: de onde veio e se é pra conferir. */
export function notaDoCusto(custo: CustoPosto | null, origemInsal: "planilha" | "cadastro" | "nenhuma"): string {
  if (custo) {
    const base = `Da Planilha de Custo — posto "${custo.posto}"${custo.vigencia ? `, vigência ${custo.vigencia.split("-").reverse().join("/")}` : ""}.`;
    if (custo.ambiguo) return base + " Há mais de um posto parecido no contrato com valores diferentes — o Recrutamento confere.";
    if (!custo.casou_salario) return base + " O salário do colaborador não bateu com nenhum posto; foi pelo cargo.";
    return base;
  }
  if (origemInsal === "cadastro") return "Contrato sem Planilha de Custo cadastrada — insalubridade veio do cadastro do colaborador; benefícios ficam com o Recrutamento.";
  return "Contrato sem Planilha de Custo cadastrada — insalubridade e benefícios ficam com o Recrutamento.";
}
