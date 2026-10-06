import {
  Briefcase, Scale, Package, Palmtree, Gavel, LifeBuoy, ArrowLeftRight, Users, Repeat, UserMinus, type LucideIcon,
} from "lucide-react";

// =====================================================================
// DIRETORIA E PRESIDÊNCIA › RELATÓRIOS (mig 20261005000006)
//
// Os 10 relatórios. Cada um tem menu próprio (Acesso por Usuário ›
// Diretoria) e RPC própria, e todas as RPCs devolvem o MESMO formato
// (RelatorioDados) — por isso uma tela só (RelatorioSistema) desenha
// qualquer um, e o Relatório Geral junta os 10 (dir_rel_geral).
// =====================================================================

export interface SistemaRelatorio {
  slug: string; titulo: string; menu: string; rpc: string; icone: LucideIcon; cor: string; descricao: string;
}

export const MENU_GERAL = "diretoria_relatorio_geral";
export const MENU_IA = "diretoria_relatorios_ia";

export const SISTEMAS: SistemaRelatorio[] = [
  { slug: "recrutamento", titulo: "Gestão Recrutamento", menu: "diretoria_rel_recrutamento", rpc: "dir_rel_recrutamento", icone: Briefcase, cor: "#2563eb", descricao: "Vagas solicitadas, abertas e preenchidas" },
  { slug: "demissoes", titulo: "Demissões", menu: "diretoria_rel_demissoes", rpc: "dir_rel_demissoes", icone: UserMinus, cor: "#dc2626", descricao: "Solicitações de demissão e o andamento" },
  { slug: "materiais", titulo: "Materiais", menu: "diretoria_rel_materiais", rpc: "dir_rel_materiais", icone: Package, cor: "#ea580c", descricao: "Pedidos de materiais e uniformes" },
  { slug: "ferias", titulo: "Férias", menu: "diretoria_rel_ferias", rpc: "dir_rel_ferias", icone: Palmtree, cor: "#0891b2", descricao: "Solicitações de férias" },
  { slug: "medida-disciplinar", titulo: "Medida Disciplinar", menu: "diretoria_rel_medida_disciplinar", rpc: "dir_rel_medida_disciplinar", icone: Gavel, cor: "#7c3aed", descricao: "Advertências e suspensões" },
  { slug: "chamados", titulo: "Chamados", menu: "diretoria_rel_chamados", rpc: "dir_rel_chamados", icone: LifeBuoy, cor: "#0f766e", descricao: "Chamados de sistemas" },
  { slug: "orientacoes", titulo: "Orientações Jurídicas", menu: "diretoria_rel_orientacoes", rpc: "dir_rel_orientacoes", icone: Scale, cor: "#9333ea", descricao: "Dúvidas enviadas ao Jurídico" },
  { slug: "mudanca-funcao", titulo: "Mudança de Função", menu: "diretoria_rel_mudanca_funcao", rpc: "dir_rel_mudanca_funcao", icone: ArrowLeftRight, cor: "#db2777", descricao: "Trocas de função e cargo" },
  { slug: "colaboradores", titulo: "Colaboradores", menu: "diretoria_rel_colaboradores", rpc: "dir_rel_colaboradores", icone: Users, cor: "#16a34a", descricao: "Quadro de colaboradores (EMPREGADOS)" },
  { slug: "turnover", titulo: "Turn-over", menu: "diretoria_rel_turnover", rpc: "dir_rel_turnover", icone: Repeat, cor: "#b45309", descricao: "Admissões, desligamentos e rotatividade" },
];

export const sistemaPorSlug = (slug: string) => SISTEMAS.find((s) => s.slug === slug);

// ---- O formato que toda RPC dir_rel_* devolve ------------------------------

export type FormatoKpi = "n" | "dias" | "pct";
export interface Kpi { rotulo: string; valor: number | null; formato: FormatoKpi; tom: string; dica?: string | null; variacao?: number | null }
export interface Serie { chave: string; rotulo: string; eixo?: "direita" }
export interface ItemRank { nome: string; n: number }
export interface RelatorioDados {
  titulo: string;
  periodo: { de: string; ate: string };
  kpis: Kpi[];
  mensal: { series: Serie[]; dados: ({ mes: string } & Record<string, number | string | null>)[] };
  por_status: { nome: string; n: number; grupo: "aberto" | "concluido" | "recusado" }[];
  rankings: { titulo: string; itens: ItemRank[] }[];
  recentes: { colunas: string[]; linhas: (string | null)[][] };
  rotulo_item: string;
}
export type RelatorioGeralDados = Record<string, RelatorioDados>;

// ---- Formatação ------------------------------------------------------------

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "2026-03" → "mar/26". */
export const rotuloMes = (m: string) => {
  const [a, mm] = m.split("-");
  return `${MESES[Number(mm) - 1] ?? mm}/${a?.slice(2)}`;
};

export function fmtKpi(valor: number | null | undefined, formato: FormatoKpi): string {
  if (valor == null) return "—";
  if (formato === "pct") return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
  if (formato === "dias") return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${valor === 1 ? "dia" : "dias"}`;
  return valor.toLocaleString("pt-BR");
}

/** Período a partir de um atalho ("12m", "6m", "3m", "ano"). Datas ISO. */
export function periodoDoAtalho(atalho: string, hoje = new Date()): { de: string; ate: string } {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const ate = iso(hoje);
  if (atalho === "ano") return { de: `${hoje.getFullYear()}-01-01`, ate };
  const meses = atalho === "3m" ? 3 : atalho === "6m" ? 6 : 12;
  const ini = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
  return { de: iso(ini), ate };
}
