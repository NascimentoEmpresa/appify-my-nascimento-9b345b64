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
  return {
    precos: novos,
    valor_medio: arred(novos.reduce((s, p) => s + p.valor, 0) / novos.length, 2),
    horas,
    pelasHorasGastas: true,
  };
}
