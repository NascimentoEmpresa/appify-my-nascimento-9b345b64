// SIS-2026-0873: integrante "Empresa" no rateio do Malote e no Fluxo de Caixa (migration 20261112200000).
//
// O integrante é sempre um colaborador de EMPREGADOS (integrante_empregado_id, sem FK). "Empresa" NÃO é uma linha de lá:
// inserir em EMPREGADOS dispara os gatilhos do Organograma e de Treinamentos, e ele apareceria como colaborador no RH.
// Por isso o ID fixo -1 quer dizer "Empresa" (os IDs de EMPREGADOS são positivos) — o banco reconhece o mesmo número em
// fluxo_integrante_nome, fluxo_caixa_integrantes_listar, fluxo_caixa_trocar_integrante e no relatório do Malote.
// -1 e não 0: rateioValidacao.ts testa `!integrante_empregado_id`, e 0 contaria como "sem integrante".
export const INTEGRANTE_EMPRESA_ID = -1;
export const INTEGRANTE_EMPRESA: { id: number; nome: string } = { id: INTEGRANTE_EMPRESA_ID, nome: "Empresa" };

/** Lista do combobox de Integrante com "Empresa" no topo (sem duplicar se já vier). */
export function comIntegranteEmpresa(lista: { id: number; nome: string }[]): { id: number; nome: string }[] {
  return [INTEGRANTE_EMPRESA, ...lista.filter((i) => i.id !== INTEGRANTE_EMPRESA_ID)];
}
