// =====================================================================
// CHAMADOS — Setores impactados e Módulos impactados (13/11/2026)
//
// Pedido de chamado: na abertura dá para dizer impacto, urgência, prazo e
// quantos usuários, mas não QUAIS setores e módulos do ERP a mudança atinge.
// Duas seleções múltiplas, gravadas em CHAMADO_SISTEMA (mig 20261115001000)
// e usadas no Monitoramento de Chamados para filtrar. Desde o SIS-2026-0910
// são obrigatórias e fazem parte do "impacto sistêmico" (com a posição =
// modulo_sistema) — regras em src/lib/chamados/impactoSistemico.ts, campos em
// ./impacto/.
//
// Setor: texto do catálogo de setores da empresa (useSetoresEmpresa).
// Módulo: o `value` de MODULOS_ERP, como já é o modulo_sistema — o rótulo sai
// daqui, então renomear um módulo não "perde" os chamados antigos.
//
// SIS-2026-0921: o módulo passou a ser uma TELA da barra lateral (a rota,
// escolhida em Setor → telas — ver lib/chamados/arvoreModulos.ts). Os valores
// amplos de MODULOS_ERP continuam valendo nos chamados antigos.
// =====================================================================
import { MODULOS_ERP } from "./types";
import { indiceDasTelas, rotuloModulo } from "@/lib/chamados/arvoreModulos";
// Registra o catálogo da barra lateral para os rótulos (efeito de import).
import "./impacto/catalogoTelas";

/** Rótulo de um valor amplo antigo (MODULOS_ERP), ou undefined. */
export const rotuloModuloLegado = (v: string): string | undefined =>
  MODULOS_ERP.find((m) => m.value === v)?.label;

/**
 * Módulos AMPLOS de antes do SIS-2026-0921 ("Outro" fica de fora). Não são
 * mais oferecidos na abertura; ficam para ler/filtrar chamados antigos.
 */
export const opcoesModulosImpactados = MODULOS_ERP
  .filter((m) => m.value !== "outro")
  .map((m) => ({ value: m.value as string, label: m.label as string }));

/** Setores da empresa como opções (sem o "PADRAO" que o hook põe para o Plano de Ações). */
export const opcoesSetoresImpactados = (setores: readonly string[]) =>
  setores.filter((s) => s.trim() && s.trim().toUpperCase() !== "PADRAO").map((s) => ({ value: s, label: s }));

/**
 * Rótulo de um módulo gravado: "Setor › Tela" para rota (SIS-2026-0921),
 * rótulo de MODULOS_ERP para valor antigo, e o valor cru se for desconhecido.
 */
export const rotuloModuloImpactado = (v: string) =>
  rotuloModulo(v, indiceDasTelas(), rotuloModuloLegado);

/** Lista legível para tabela/detalhe ("—" quando vazio). */
export const listaImpactados = (xs: readonly string[] | null | undefined, rotulo: (v: string) => string = (v) => v) =>
  xs && xs.length ? xs.map(rotulo).join(", ") : "—";

/** O chamado atinge esse valor? (filtro "todos" = sempre). */
export const atinge = (xs: readonly string[] | null | undefined, valor: string, todos: string) =>
  valor === todos || (xs ?? []).includes(valor);
