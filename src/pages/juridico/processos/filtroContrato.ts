// SIS-2026-0936: filtro "Contrato" na consulta de processos (Jurídico › Processos).
// O contrato do processo é texto (o nome em CONTRATOS, escolhido no cadastro); antigos podem ter espaço ou caixa diferente,
// então a comparação ignora isso. Processo sem contrato fica numa opção própria, para o Jurídico achar e completar.

export const SEM_CONTRATO = "__SEM_CONTRATO__";

const chave = (s: string | null | undefined) => String(s ?? "").trim().replace(/\s+/g, " ").toUpperCase();

/** Opções do filtro: um contrato por nome (a grafia mais usada), com quantos processos têm cada um, em ordem alfabética. */
export function contratosDoFiltro(processos: { contrato?: string | null }[]): { chave: string; nome: string; n: number }[] {
  const grupos = new Map<string, { n: number; grafias: Map<string, number> }>();
  for (const p of processos) {
    const k = chave(p.contrato);
    if (!k) continue;
    const g = grupos.get(k) ?? { n: 0, grafias: new Map() };
    g.n += 1;
    const nome = String(p.contrato).trim();
    g.grafias.set(nome, (g.grafias.get(nome) ?? 0) + 1);
    grupos.set(k, g);
  }
  return [...grupos.entries()]
    .map(([k, g]) => ({ chave: k, nome: [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0], n: g.n }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** O processo passa no filtro? "" = todos; SEM_CONTRATO = só os sem contrato. */
export function processoNoContrato(p: { contrato?: string | null }, filtro: string): boolean {
  if (!filtro) return true;
  if (filtro === SEM_CONTRATO) return !chave(p.contrato);
  return chave(p.contrato) === filtro;
}

export const semContratoCount = (processos: { contrato?: string | null }[]) => processos.filter((p) => !chave(p.contrato)).length;
