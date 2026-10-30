// Parecer da I.A precificado SÓ pelas horas gastas (30/10/2026, Pablo,
// SIS-2026-0787: 8 h gastas e o parecer cotando freelancer em 14 h e
// software house em 20 h). Havendo horas gastas, os três perfis e a média
// usam essas horas: valor = horas gastas × valor/hora fixo × fator da
// complexidade, gravados no próprio preço. Sem horas gastas, fica o que a
// I.A estimou.
//
// É a mesma conta do validarParecer (supabase/functions/_shared/
// chamado-parecer-ia.ts) — repetida aqui para a tela não depender de o
// parecer ter sido gerado/recalculado depois da regra.

export interface PrecoPorHoras {
  perfil?: string;
  horas: number;
  valor_hora: number;
  fator_complexidade?: number | null;
  valor: number;
}

const arred = (n: number, casas = 0) => Math.round(n * 10 ** casas) / 10 ** casas;

export function precificarPorHorasGastas<P extends PrecoPorHoras>(
  precos: P[] | null | undefined,
  valorMedio: number | null | undefined,
  horasEstimadas: number | null | undefined,
  horasGastas: number | string | null | undefined,
): { precos: P[]; valor_medio: number | null; horas: number | null; pelasHorasGastas: boolean } {
  const lista = precos ?? [];
  const gastas = Number(horasGastas);
  if (!(gastas > 0) || lista.length === 0) {
    return { precos: lista, valor_medio: valorMedio ?? null, horas: horasEstimadas ?? null, pelasHorasGastas: false };
  }
  // Mesmo arredondamento/limite do servidor: 1 casa, mínimo 0,5 h.
  const horas = arred(Math.min(6000, Math.max(0.5, gastas)), 1);
  const novos = lista.map((p) => ({
    ...p,
    horas,
    valor: arred(horas * Number(p.valor_hora) * Number(p.fator_complexidade ?? 1), 2),
  }));
  // Com horas gastas, o card da equipe interna vira o "valor real gasto"
  // (abaixo) — custo nosso, não preço de mercado: a média é só de quem o
  // mercado cobraria (freelancer e software house).
  const mercado = novos.filter((p) => p.perfil !== "interno");
  const base = mercado.length ? mercado : novos;
  return {
    precos: novos,
    valor_medio: arred(base.reduce((s, p) => s + p.valor, 0) / base.length, 2),
    horas,
    pelasHorasGastas: true,
  };
}

// ── VALOR REAL GASTO (30/10/2026, Pablo: "troca o equipe interna ali pra um
// card verde do valor gasto real conosco, dividir nosso salário R$ 3.138,65 —
// pegar a hora do nosso salário e colocar valor real gasto") ──────────────
// Hora = salário mensal ÷ 220 h (jornada CLT de 44 h semanais, o divisor que
// a folha usa para o valor da hora). SEM fator de complexidade: é o que a
// empresa de fato pagou pelas horas, não preço.
export const SALARIO_MENSAL_DEV = 3138.65;
export const HORAS_MES_CLT = 220;

export function valorRealGasto(horasGastas: number | string | null | undefined):
  { valor_hora: number; horas: number; valor: number } | null {
  const horas = Number(horasGastas);
  if (!(horas > 0)) return null;
  const valor_hora = SALARIO_MENSAL_DEV / HORAS_MES_CLT;
  return { valor_hora: arred(valor_hora, 2), horas, valor: arred(valor_hora * horas, 2) };
}

/** Valor médio de mercado para as listas, a partir dos preços gravados.
 *  As listas não têm as horas gastas: preço pelas horas gastas = os três
 *  perfis com as MESMAS horas (mig 20261030000300). Aí a média sai sem a
 *  equipe interna, como na tela do chamado; senão, a gravada. */
export function valorMedioMercado(precos: PrecoPorHoras[] | null | undefined, valorMedio: number | null | undefined): number | null {
  const lista = precos ?? [];
  const mesmasHoras = lista.length > 1 && lista.every((p) => Number(p.horas) === Number(lista[0].horas));
  const mercado = lista.filter((p) => p.perfil && p.perfil !== "interno");
  if (!mesmasHoras || mercado.length === 0) return valorMedio ?? null;
  return arred(mercado.reduce((s, p) => s + Number(p.valor), 0) / mercado.length, 2);
}
