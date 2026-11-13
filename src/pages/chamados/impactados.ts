// =====================================================================
// CHAMADOS — Setores impactados e Módulos impactados (13/11/2026)
//
// Pedido de chamado: na abertura dá para dizer impacto, urgência, prazo e
// quantos usuários, mas não QUAIS setores e módulos do ERP a mudança atinge.
// Duas seleções múltiplas (opcionais), gravadas em CHAMADO_SISTEMA
// (mig 20261115001000) e usadas no Monitoramento de Chamados para filtrar.
//
// Setor: texto do catálogo de setores da empresa (useSetoresEmpresa).
// Módulo: o `value` de MODULOS_ERP, como já é o modulo_sistema — o rótulo sai
// daqui, então renomear um módulo não "perde" os chamados antigos.
// =====================================================================
import { MODULOS_ERP } from "./types";

/** Módulos do ERP para escolher ("Outro" fica de fora: aqui não tem texto livre). */
export const opcoesModulosImpactados = MODULOS_ERP
  .filter((m) => m.value !== "outro")
  .map((m) => ({ value: m.value as string, label: m.label as string }));

/** Setores da empresa como opções (sem o "PADRAO" que o hook põe para o Plano de Ações). */
export const opcoesSetoresImpactados = (setores: readonly string[]) =>
  setores.filter((s) => s.trim() && s.trim().toUpperCase() !== "PADRAO").map((s) => ({ value: s, label: s }));

/** Rótulo de um módulo gravado (valor antigo/desconhecido aparece como está). */
export const rotuloModuloImpactado = (v: string) =>
  MODULOS_ERP.find((m) => m.value === v)?.label ?? v;

/** Lista legível para tabela/detalhe ("—" quando vazio). */
export const listaImpactados = (xs: readonly string[] | null | undefined, rotulo: (v: string) => string = (v) => v) =>
  xs && xs.length ? xs.map(rotulo).join(", ") : "—";

/**
 * O insert falhou porque as colunas ainda não existem (migration não entrou)?
 * PostgREST: "Could not find the 'setores_impactados' column ... in the schema cache".
 */
export const semColunasImpactados = (mensagem: string | null | undefined) =>
  /(setores|modulos)_impactados/.test(mensagem ?? "");

/** O chamado atinge esse valor? (filtro "todos" = sempre). */
export const atinge = (xs: readonly string[] | null | undefined, valor: string, todos: string) =>
  valor === todos || (xs ?? []).includes(valor);
