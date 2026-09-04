import type { Direcao } from "@/hooks/useOrdenacaoTabela";

// SIS-2026-0316: ordenação genérica pra tabela — nulo/vazio sempre vai pro
// fim, independente da direção (não faz sentido "menor valor" virar nulo
// no topo quando inverte pra desc). Número compara numérico; qualquer
// outra coisa cai pra comparação de texto (localeCompare com `numeric`,
// pra "Nº 2" vir antes de "Nº 10").
export function ordenarPor<T>(
  lista: T[],
  acessor: ((item: T) => string | number | boolean | null | undefined) | undefined,
  direcao: Direcao,
): T[] {
  if (!acessor) return lista;
  return [...lista].sort((a, b) => {
    let va = acessor(a);
    let vb = acessor(b);
    if (typeof va === "boolean") va = va ? 1 : 0;
    if (typeof vb === "boolean") vb = vb ? 1 : 0;
    const vazioA = va == null || va === "";
    const vazioB = vb == null || vb === "";
    if (vazioA && vazioB) return 0;
    if (vazioA) return 1;
    if (vazioB) return -1;
    const cmp =
      typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "pt-BR", { numeric: true, sensitivity: "base" });
    return direcao === "asc" ? cmp : -cmp;
  });
}
