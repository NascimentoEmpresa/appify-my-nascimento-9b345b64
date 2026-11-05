import type { LucideIcon } from "lucide-react";

/**
 * SIS-2026-0772 (Helena, Presidência, 05/11/2026): o menu lateral passa a ser
 * organizado pelos DEPARTAMENTOS da empresa, e não pelos módulos técnicos.
 *
 * ISTO É SÓ AGRUPAMENTO VISUAL. Nenhum acesso muda, e é por isso que mora aqui
 * e não no banco:
 *   · quem vê cada item é decidido pela ROTA (Sidebar → canSee →
 *     matchMenuCode → list_accessible_menus), não pelo grupo onde ele aparece;
 *   · os módulos do banco (app_modulo / app_menu.modulo_id) NÃO foram tocados.
 *     Eles pesam na permissão: o perfil de módulo (perfil_acesso.modulo_codigo,
 *     mig 20260718000001) libera tudo o que pertence ao módulo. Em 05/11/2026
 *     eram 91 pessoas nesses perfis, 83 delas no de Encarregados. Trocar o
 *     módulo de uma tela no banco dá ou tira acesso delas na hora, sem aviso.
 *     Quem quiser "acertar o banco para bater com o menu" precisa contar antes
 *     quem perde e quem ganha.
 *
 * Por isso a Administração › Acesso por Usuário continua mostrando os módulos
 * do banco: é ali que os perfis de módulo atuam.
 *
 * Como montar: o PRIMEIRO módulo de cada departamento é o principal e mantém
 * os nomes dos grupos dele. Os outros entram com o nome do módulo na frente
 * ("Fiscal · Emissão & Apuração"), para continuar claro de onde vem cada tela.
 * Módulo que não está em departamento nenhum (Central de Serviços e Plano de
 * Ações, que são de uso de toda a empresa, e qualquer módulo novo criado
 * depois) continua como módulo próprio — nenhuma tela some do menu por falta
 * de cadastro aqui.
 */

export interface ItemMenu {
  label: string;
  to: string;
  icon: LucideIcon;
}

export interface GrupoMenu {
  label: string;
  items: ItemMenu[];
  defaultOpen?: boolean;
}

export interface ModuloMenu {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  basePath: string;
  status: "active" | "soon";
  groups?: GrupoMenu[];
  headerLink?: string;
}

export interface Departamento {
  label: string;
  descricao?: string;
  /** Ids dos módulos da Sidebar, o principal primeiro. */
  modulos: string[];
}

export const DEPARTAMENTOS: Departamento[] = [
  { label: "Jurídico", modulos: ["juridico", "comite_etica"] },
  { label: "Suprimentos", modulos: ["suprimentos"] },
  { label: "Recursos Humanos", modulos: ["rh"] },
  { label: "Operacional", descricao: "Operação em campo e encarregados", modulos: ["operacional", "encarregados"] },
  { label: "Licitação", modulos: ["licitacoes"] },
  // Hoje existe uma Diretoria só. Ainda falta definir com a Helena quais
  // aprovações são da Diretoria Operacional; enquanto estiver vazia, ela não
  // aparece no menu.
  { label: "Diretoria Operacional", modulos: [] },
  {
    label: "Diretoria Administrativa",
    descricao: "Aprovações, controladoria, relatórios e BI",
    modulos: ["diretoria", "controladoria_orc", "relatorios", "bi"],
  },
  { label: "Financeiro", descricao: "Financeiro, contábil, fiscal e malote", modulos: ["financeiro", "contabil", "fiscal", "malote"] },
  { label: "TST / SESMT", modulos: ["sst"] },
  { label: "Treinamento", modulos: ["treinamentos"] },
  { label: "TI", descricao: "Infraestrutura, sistemas, TVs e WhatsApp", modulos: ["ti", "sistemas", "tvs", "whatsapp"] },
  { label: "Recrutamento e Seleção", modulos: ["recrutamento"] },
  { label: "Presidência", modulos: ["presidencia", "organograma"] },
];

/**
 * Nome curto do módulo quando ele vira prefixo de grupo. O cabeçalho de grupo
 * não quebra linha (whitespace-nowrap) e a sidebar tem 268 px.
 */
const ROTULO_CURTO: Record<string, string> = {
  controladoria_orc: "Controladoria",
  fiscal: "Fiscal",
  bi: "BI",
};

const rotuloDoModulo = (m: ModuloMenu) => ROTULO_CURTO[m.id] ?? m.label;

function rotasDosItens(m: ModuloMenu): Set<string> {
  return new Set((m.groups ?? []).flatMap((g) => g.items.map((i) => i.to)));
}

/** Grupos de um módulo que entra num departamento que não é o dele. */
function gruposConvidados(m: ModuloMenu): GrupoMenu[] {
  const rotulo = rotuloDoModulo(m);
  const grupos: GrupoMenu[] = (m.groups ?? []).map((g) => ({
    ...g,
    label: g.label === m.label ? rotulo : `${rotulo} · ${g.label}`,
    // Sem defaultOpen: o grupo abre sozinho quando a tela atual é dele
    // (SidebarGroup usa `defaultOpen ?? hasActive`). Com false explícito o
    // grupo da tela aberta ficaria fechado; com o true herdado, o
    // departamento abriria com dezenas de itens à mostra.
    defaultOpen: undefined,
  }));
  return comPaginaHub(m, grupos);
}

/**
 * Módulo com página-hub (headerLink) perde o clique no cabeçalho quando vira
 * parte de um departamento. Se a hub não estiver entre os itens, ela entra
 * como primeiro item, para não sumir do menu.
 */
function comPaginaHub(m: ModuloMenu, grupos: GrupoMenu[]): GrupoMenu[] {
  if (!m.headerLink || m.headerLink === "/app" || grupos.length === 0) return grupos;
  if (rotasDosItens(m).has(m.headerLink)) return grupos;
  const [primeiro, ...resto] = grupos;
  return [{ ...primeiro, items: [{ label: m.label, to: m.headerLink, icon: m.icon }, ...primeiro.items] }, ...resto];
}

export function agruparPorDepartamento<M extends ModuloMenu>(
  modulos: M[],
  departamentos: Departamento[] = DEPARTAMENTOS,
): M[] {
  const porId = new Map(modulos.map((m) => [m.id, m]));
  const usados = new Set<string>();
  const saida: M[] = [];

  for (const dep of departamentos) {
    const membros = dep.modulos.map((id) => porId.get(id)).filter((m): m is M => !!m);
    if (membros.length === 0) continue;
    membros.forEach((m) => usados.add(m.id));
    const [principal, ...convidados] = membros;

    if (convidados.length === 0) {
      saida.push({ ...principal, label: dep.label, description: dep.descricao ?? principal.description });
      continue;
    }

    const grupos = [
      ...comPaginaHub(principal, principal.groups ?? []),
      ...convidados.flatMap(gruposConvidados),
    ];
    saida.push({
      ...principal,
      label: dep.label,
      description: dep.descricao ?? principal.description,
      headerLink: undefined,
      groups: grupos,
    } as M);
  }

  for (const m of modulos) if (!usados.has(m.id)) saida.push(m);
  return saida;
}

/** Todas as rotas alcançáveis pelo menu: itens e páginas-hub. Usado no teste. */
export function rotasDoMenu(modulos: ModuloMenu[]): Set<string> {
  const out = new Set<string>();
  for (const m of modulos) {
    rotasDosItens(m).forEach((r) => out.add(r));
    if (m.headerLink) out.add(m.headerLink);
  }
  return out;
}
