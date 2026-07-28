import { NavLink, useLocation, useNavigate } from "react-router-dom";
import logoGN from "@/assets/logo-nascimento-icon.png";
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Sparkles,
  ScrollText,
  Calculator,
  CheckCircle2,
  Gavel,
  Trophy,
  FileCheck2,
  History,
  Shield,
  ChevronDown,
  ChevronRight,
  Building2,
  FolderKanban,
  Wallet,
  Users2,
  CalendarRange,
  Ruler,
  TrendingUp,
  PackageCheck,
  Receipt,
  ListChecks,
  PieChart,
  HardHat,
  Scale,
  UserCog,
  Briefcase as BriefcaseIcon,
  Home,
  ShoppingCart,
  BarChart3,
  Settings,
  BookOpen,
  ClipboardCheck,
  DatabaseZap,
  TableProperties,
  Laptop2,
  Wrench,
  FileOutput,
  Headset,
  ShieldAlert,
  ClipboardList,
  Bell,
  MessageCircle,
  Bot,
  ShieldCheck,
} from "lucide-react";
import { useTemAlcada } from "@/hooks/useTemAlcada";
import { useAccessibleMenus, matchMenuCode } from "@/hooks/useAccessibleMenus";
import { ACESSO_ABERTO_SEM_PERMISSOES, MENUS_SEMPRE_RESTRITOS } from "@/lib/acesso";
import { useGradeAtivaCount } from "@/hooks/useGradeAtivaCount";
import { useChamadosNotif } from "@/hooks/useChamadosNotif";
import { EmpresaAtivaContext } from "@/context/EmpresaAtivaContext";
import { Inbox } from "lucide-react";
import { Target } from "lucide-react";
import { GitBranch, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useState, useContext } from "react";

interface NavItem {
  label: string;
  to: string;
  icon: any;
  badge?: string;
  // Bolinha de notificação (novidade). Resolvida em runtime pelo useChamadosNotif.
  notif?: "meus" | "dev";
  dot?: boolean;
}
interface NavGroup {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}
interface ModuleDef {
  id: string;
  label: string;
  description: string;
  icon: any;
  basePath: string;
  badge?: string;
  status: "active" | "soon";
  groups?: NavGroup[];
  // Se definido, clicar no cabeçalho do módulo navega direto para esta rota
  // (além de expandir os submódulos). Usado p/ módulos com página-hub própria.
  headerLink?: string;
}

// Módulo Licitações — único navegável hoje
const licitacoesModule: ModuleDef = {
  id: "licitacoes",
  label: "Licitações",
  description: "Edital → Contrato",
  icon: Briefcase,
  basePath: "/app",
  status: "active",
  groups: [
    {
      label: "Visão Geral",
      defaultOpen: true,
      items: [
        { label: "Painel Executivo", to: "/app/painel-executivo", icon: LayoutDashboard },
        { label: "Grade de Licitações", to: "/app/licitacoes/grade", icon: FolderKanban, badge: "__grade_ativa__" },
      ],
    },
    {
      label: "Operação",
      defaultOpen: true,
      items: [
        { label: "Capa de Edital Licitações", to: "/app/editais", icon: FileText },
        { label: "Implantação de Contratos", to: "/app/licitacoes/implantacao", icon: ListChecks },
        { label: "Planilha de Custo", to: "/app/licitacoes/planilha-custo", icon: TableProperties },
        { label: "Contratos", to: "/app/licitacoes/contratos", icon: Building2 },
        { label: "Documentos", to: "/app/documentos", icon: ScrollText },
        // B2: "Triagem & IA" removida do menu (rota /app/triagem segue existindo,
        // mas controlada pelo RouteGuard + matriz de permissões do ERP).
        { label: "Composição & BDI", to: "/app/composicao", icon: PieChart },
      ],
    },
    {
      label: "Análise & Decisão",
      defaultOpen: true,
      items: [
        { label: "Parecer Técnico", to: "/app/parecer-tecnico", icon: FileCheck2 },
        { label: "Parecer SST", to: "/app/parecer-sst", icon: HardHat },
        { label: "Parecer Jurídico Adm.", to: "/app/parecer-juridico", icon: Scale },
        { label: "Parecer Controladoria", to: "/app/parecer-controladoria", icon: Calculator },
        { label: "Diretor Operacional", to: "/app/parecer-dir-operacional", icon: BriefcaseIcon },
        { label: "Diretor Administrativo", to: "/app/parecer-dir-administrativo", icon: UserCog },
        { label: "Parecer Gerencial (Consolidador)", to: "/app/parecer-gerencial", icon: FileCheck2 },
        { label: "Aprovações", to: "/app/aprovacoes", icon: CheckCircle2, badge: "7" },
      ],
    },
    {
      label: "Pregão & Encaminhamento",
      items: [
        // B2.1.c.1 — "Pregão & Lances" inutilizado: item removido do menu e app_menu.ativo=false.
        //            Componente Pregao.tsx, rota /app/pregao e status "pregao" do fluxo preservados.
        { label: "Resultado Final", to: "/app/resultado", icon: Trophy },
        { label: "Prontas p/ Contrato", to: "/app/prontas-contrato", icon: PackageCheck },
      ],
    },
    {
      label: "Contratos",
      items: [
        { label: "Contratos Ativos", to: "/app/contratos/ativos", icon: Building2, badge: "18" },
        { label: "Empenhos", to: "/app/contratos/empenhos", icon: Wallet },
        { label: "Postos & Alocações", to: "/app/contratos/postos", icon: Users2 },
        { label: "Cronograma de Faturamento", to: "/app/contratos/faturamento", icon: CalendarRange },
        { label: "Medições", to: "/app/contratos/medicoes", icon: Ruler },
        { label: "Reajustes (IGPM/IPCA)", to: "/app/contratos/reajustes", icon: TrendingUp },
        { label: "Encerramentos", to: "/app/contratos/encerramentos", icon: Receipt },
      ],
    },
    {
      label: "Governança",
      items: [
        { label: "Histórico & Auditoria", to: "/app/historico", icon: History },
        // Consolidação: "Administração" removida daqui — acesso único via rodapé "Configurações do ERP".
      ],
    },
  ],
};

// Módulo Controladoria & Orçamento — ativo (catálogos + OBZ)
const controladoriaOrcModule: ModuleDef = {
  id: "controladoria_orc",
  label: "Controladoria & Orçamento",
  description: "Catálogos mestres, OBZ, baseline",
  icon: Calculator,
  basePath: "/app/controladoria",
  status: "active",
  groups: [
    {
      label: "Cadastros Mestres",
      defaultOpen: true,
      items: [
        { label: "Empresas do Grupo", to: "/app/controladoria/empresas", icon: Building2 },
        { label: "Centros de Custo", to: "/app/controladoria/centros-custo", icon: FolderKanban },
        { label: "Estrutura Organizacional", to: "/app/controladoria/estrutura-organizacional", icon: FolderKanban },
        { label: "Linhas da DRE", to: "/app/controladoria/dre", icon: BookOpen },
        { label: "Classificadores & Drivers", to: "/app/controladoria/classificadores", icon: ListChecks },
      ],
    },
    {
      label: "Orçamento",
      defaultOpen: true,
      items: [
        { label: "Ciclos de Orçamento", to: "/app/orcamento", icon: Calculator },
        { label: "Planejador OBZ (mock)", to: "/app/controladoria/obz", icon: Calculator },
        { label: "OBZ — Versões", to: "/app/controladoria/obz-versoes", icon: Calculator },
        { label: "DRE Gerencial", to: "/app/controladoria/dre-gerencial", icon: TrendingUp },
        { label: "Orçamento Completo", to: "/app/controladoria/orcamento-completo", icon: Calculator },
      ],
    },
    {
      label: "Ferramentas",
      defaultOpen: true,
      items: [
        { label: "Gerador de POPs", to: "/app/controladoria/gerador-pops", icon: FileOutput },
      ],
    },
  ],
};

// Suprimentos
const suprimentosModule: ModuleDef = {
  id: "suprimentos",
  label: "Suprimentos",
  description: "Compras, estoque, requisições",
  icon: ShoppingCart,
  basePath: "/app/suprimentos",
  status: "active",
  groups: [
    {
      label: "Cadastros",
      defaultOpen: true,
      items: [
        { label: "Fornecedores", to: "/app/suprimentos/fornecedores", icon: Building2 },
        { label: "Catálogo de Produtos", to: "/app/suprimentos/produtos", icon: PackageCheck },
        { label: "Categorias", to: "/app/suprimentos/categorias", icon: FolderKanban },
        { label: "Almoxarifados", to: "/app/suprimentos/almoxarifados", icon: Home },
      ],
    },
    {
      label: "Estoque",
      defaultOpen: true,
      items: [
        { label: "Saldos & Alertas", to: "/app/suprimentos/estoque", icon: PackageCheck },
        { label: "Movimentações", to: "/app/suprimentos/movimentos", icon: History },
      ],
    },
    {
      label: "Compras",
      defaultOpen: true,
      items: [
        { label: "Requisições", to: "/app/suprimentos/requisicoes", icon: ListChecks },
        { label: "Cotações (RFQ)", to: "/app/suprimentos/cotacoes", icon: Calculator },
        { label: "Pedidos de Compra", to: "/app/suprimentos/pedidos", icon: ShoppingCart },
        { label: "NF de Entrada (XML/Manual)", to: "/app/suprimentos/nf-entrada", icon: FileText },
        { label: "Recebimento Físico", to: "/app/suprimentos/recebimentos", icon: ClipboardCheck },
        { label: "Aprovações (RC/PC)", to: "/app/suprimentos/aprovacoes", icon: CheckCircle2 },
      ],
    },
  ],
};

// Financeiro
const financeiroModule: ModuleDef = {
  id: "financeiro",
  label: "Financeiro",
  description: "Contas, movimentos bancários",
  icon: Wallet,
  basePath: "/app/financeiro",
  status: "active",
  groups: [
    {
      label: "Controle de Notas",
      defaultOpen: true,
      items: [
        { label: "Emissão de NF", to: "/app/financeiro/emissao-nf/cadastro", icon: FileText },
        { label: "Validação de Notas", to: "/app/financeiro/emissao-nf/controle-notas", icon: ClipboardCheck },
        { label: "Relatório de Serviços", to: "/app/financeiro/relatorio-servicos", icon: TableProperties },
        { label: "Cobranças", to: "/app/cobrancas", icon: Bell },
      ],
    },
    {
      label: "Operação Financeira",
      defaultOpen: true,
      items: [
        { label: "Contas Bancárias", to: "/app/financeiro/contas-bancarias", icon: Wallet },
        { label: "Contas a Pagar", to: "/app/financeiro/contas-pagar", icon: TrendingUp },
        { label: "Programação de Pagamentos", to: "/app/financeiro/programacao-pagamentos", icon: Wallet },
        { label: "Validação Pós-Pagamento", to: "/app/financeiro/validacao-pos-pagamento", icon: Receipt },
        { label: "Contas a Receber", to: "/app/financeiro/contas-receber", icon: Receipt },
        { label: "Conta Garantida", to: "/app/financeiro/conta-garantida", icon: ShieldCheck },
        { label: "Fluxo de Caixa", to: "/app/financeiro/fluxo-caixa", icon: TrendingUp },
        { label: "Fluxo de Caixa Diário", to: "/app/financeiro/fluxo-caixa-diario", icon: TrendingUp },
        { label: "Conciliação Fluxo Caixa", to: "/app/financeiro/conciliacao-fluxo-caixa", icon: Receipt },
        { label: "Análise de Capital de Giro", to: "/app/financeiro/capital-giro", icon: TrendingUp },
        { label: "Movimentos Bancários", to: "/app/financeiro/movimentos", icon: Wallet },
        { label: "Integração Bancária", to: "/app/financeiro/integracao-bancaria", icon: Wallet },
      ],
    },
    {
      label: "Orçamento",
      defaultOpen: true,
      items: [
        { label: "Cadastro de Orçamentos", to: "/app/financeiro/planejamento-orcamentario/cadastro", icon: ClipboardList },
      ],
    },
    {
      label: "Ferramentas",
      defaultOpen: true,
      items: [
        { label: "Conciliação Bancária", to: "/app/financeiro/conciliacao-bancaria", icon: GitMerge },
      ],
    },
  ],
};

// Contábil
const contabilModule: ModuleDef = {
  id: "contabil",
  label: "Contábil",
  description: "Lançamentos e partidas",
  icon: BookOpen,
  basePath: "/app/contabil",
  status: "active",
  groups: [
    {
      label: "Escrituração",
      defaultOpen: true,
      items: [
        { label: "Lançamentos", to: "/app/contabil/lancamentos", icon: BookOpen },
        { label: "Balancete", to: "/app/contabil/balancete", icon: BookOpen },
        { label: "Razão", to: "/app/contabil/razao", icon: BookOpen },
        { label: "Razão Detalhado", to: "/app/contabil/razao-detalhado", icon: BookOpen },
        { label: "Plano de Contas", to: "/app/contabil/plano-contas", icon: BookOpen },
        { label: "Contabilidade Avançada", to: "/app/contabil/avancada", icon: BookOpen },
        { label: "Aprovação de Contas", to: "/app/contabil/aprovacao-contas", icon: ClipboardCheck },
        { label: "DRE Gerencial (real)", to: "/app/contabil/dre-gerencial-real", icon: BookOpen },
        { label: "Conciliação Eventos", to: "/app/contabil/conciliacao-eventos", icon: ClipboardCheck },
      ],
    },
  ],
};

// Fiscal
const fiscalModule: ModuleDef = {
  id: "fiscal",
  label: "Fiscal & Tributário",
  description: "NFS-e, NF-e e apuração",
  icon: Receipt,
  basePath: "/app/fiscal",
  status: "active",
  groups: [
    {
      label: "Emissão & Apuração",
      defaultOpen: true,
      items: [{ label: "Notas / Apuração / Config", to: "/app/fiscal", icon: Receipt }],
    },
  ],
};

// RH
const rhModule: ModuleDef = {
  id: "rh",
  label: "Recursos Humanos",
  description: "Colaboradores e alocações",
  icon: Users2,
  basePath: "/app/rh",
  status: "active",
  groups: [
    {
      label: "Pessoas",
      defaultOpen: true,
      items: [
        { label: "Colaboradores", to: "/app/rh/colaboradores", icon: Users2 },
        { label: "Novas Admissões", to: "/app/rh/novas-admissoes", icon: ClipboardCheck },
        { label: "Alocações em Contratos", to: "/app/rh/alocacoes", icon: ListChecks },
        { label: "Folha de Pagamento", to: "/app/rh/folha", icon: ListChecks },
        { label: "Gestão de Férias", to: "/app/rh/ferias", icon: CalendarRange },
      ],
    },
  ],
};

// Recrutamento e Seleção
const recrutamentoModule: ModuleDef = {
  id: "recrutamento",
  label: "Recrutamento e Seleção",
  description: "Vagas, candidatos e contratações",
  icon: UserCog,
  basePath: "/app/rh/recrutamento",
  status: "active",
  groups: [
    {
      label: "Gestão",
      defaultOpen: true,
      items: [
        { label: "Dashboard", to: "/app/rh/recrutamento-dashboard", icon: BarChart3 },
        { label: "Gestão Recrutamento", to: "/app/rh/recrutamento", icon: UserCog },
        { label: "Banco de Talentos", to: "/app/rh/banco-talentos", icon: Users2 },
      ],
    },
  ],
};

// Encarregados — hub de solicitações (vaga, férias) + históricos/status
const encarregadosModule: ModuleDef = {
  id: "encarregados",
  label: "Encarregados",
  description: "Solicitações e históricos",
  icon: HardHat,
  basePath: "/app/encarregados/minhas-solicitacoes",
  status: "active",
  groups: [
    {
      label: "Solicitações",
      defaultOpen: true,
      items: [
        { label: "Minhas Solicitações", to: "/app/encarregados/minhas-solicitacoes", icon: ClipboardCheck },
      ],
    },
  ],
};

// Sistemas — demandas de sistemas (kanban de 13 etapas, acesso livre)
const sistemasModule: ModuleDef = {
  id: "sistemas",
  label: "Sistemas",
  description: "Demandas de sistemas",
  icon: Laptop2,
  basePath: "/app/sistemas",
  status: "active",
  groups: [
    {
      label: "Solicitações",
      defaultOpen: true,
      items: [
        { label: "Solicitações ERP", to: "/app/sistemas/solicitacoes-erp", icon: Laptop2 },
      ],
    },
    {
      label: "Chamados de Sistemas",
      defaultOpen: true,
      items: [
        { label: "Chamados de Sistemas", to: "/app/sistemas/chamados", icon: Headset, notif: "meus" },
        { label: "Painel de Distribuição", to: "/app/sistemas/chamados/painel", icon: BarChart3 },
        { label: "Painel do Desenvolvedor", to: "/app/sistemas/chamados/dev", icon: ClipboardList, notif: "dev" },
      ],
    },
  ],
};

// Central de Serviços
const centralServicosModule: ModuleDef = {
  id: "central_servicos",
  label: "Central de Serviços",
  description: "Atendimento e orientações ao colaborador",
  icon: Headset,
  basePath: "/app/central-servicos",
  status: "active",
  groups: [
    {
      label: "Central de Serviços",
      defaultOpen: true,
      items: [
        { label: "Central de Serviços", to: "/app/central-servicos", icon: Headset },
        { label: "Orientações Jurídicas", to: "/app/central-servicos/orientacoes-juridicas", icon: BookOpen },
        { label: "Denúncias (Canal de Ética)", to: "/app/central-servicos/denuncias", icon: ShieldAlert },
        { label: "Nascimento Formulários", to: "/app/central-servicos/formularios", icon: ClipboardList },
        { label: "Chamados de Sistemas", to: "/app/central-servicos/chamados", icon: Headset, notif: "meus" },
        { label: "Agenda de Reunião", to: "/app/central-servicos/reunioes", icon: CalendarRange },
      ],
    },
  ],
};

// WhatsApp — Chatbot (integração Meta Cloud API)
const whatsappModule: ModuleDef = {
  id: "whatsapp",
  label: "WhatsApp",
  description: "Atendimento e chatbot",
  icon: MessageCircle,
  basePath: "/app/whatsapp",
  status: "active",
  groups: [
    {
      label: "WhatsApp",
      defaultOpen: true,
      items: [
        { label: "Caixa de Entrada", to: "/app/whatsapp", icon: MessageCircle },
        { label: "Chatbot", to: "/app/whatsapp/chatbot", icon: Bot },
      ],
    },
  ],
};

// Jurídico — Gestão Patrimonial e Obrigações
const juridicoModule: ModuleDef = {
  id: "juridico",
  label: "Jurídico",
  description: "Patrimônios, obrigações e dúvidas",
  icon: Scale,
  basePath: "/app/juridico/patrimonios",
  status: "active",
  groups: [
    {
      label: "Processos",
      defaultOpen: true,
      items: [
        { label: "Dashboard - Processos", to: "/app/juridico/processos/dashboard", icon: BarChart3 },
        { label: "Processos", to: "/app/juridico/processos", icon: Scale },
        { label: "Audiências", to: "/app/juridico/processos/audiencias", icon: CalendarRange },
      ],
    },
    {
      label: "Gestão de Advertências",
      defaultOpen: true,
      items: [
        { label: "Advertências", to: "/app/juridico/advertencias", icon: Gavel },
      ],
    },
    {
      label: "Recrutamento",
      defaultOpen: true,
      items: [
        { label: "Verificação de Candidatos", to: "/app/juridico/candidatos", icon: ClipboardCheck },
      ],
    },
    {
      label: "Gestão Patrimonial",
      defaultOpen: true,
      items: [
        { label: "Patrimônios", to: "/app/juridico/patrimonios", icon: Building2 },
      ],
    },
    {
      label: "Conhecimento",
      defaultOpen: true,
      items: [
        { label: "Parecer Jurídico", to: "/app/juridico/duvidas", icon: BookOpen },
      ],
    },
  ],
};


// BI
const biModule: ModuleDef = {
  id: "bi",
  label: "BI & Analytics",
  description: "Dashboards consolidados",
  icon: BarChart3,
  basePath: "/app/bi",
  status: "active",
  groups: [
    {
      label: "Painéis",
      defaultOpen: true,
      items: [{ label: "Resumo do Grupo", to: "/app/bi", icon: BarChart3 }],
    },
  ],
};

// Integração & Migração (somente admin)
const integracaoModule: ModuleDef = {
  id: "integracao",
  label: "Integração & Migração",
  description: "Lotes de planilhas → ERP",
  icon: DatabaseZap,
  basePath: "/app/integracao",
  status: "active",
  groups: [
    {
      label: "Cargas",
      defaultOpen: true,
      items: [
        { label: "Lotes de Integração", to: "/app/integracao", icon: DatabaseZap },
        { label: "Aliases (De/Para)", to: "/app/integracao/aliases", icon: ListChecks },
        { label: "Migração DO ZERO", to: "/app/admin/migracao-zero", icon: DatabaseZap },
      ],
    },
  ],
};

// Consolidação: módulo "Configurações" removido do Sidebar.
// Todo acesso à governança do ERP é feito pelo rodapé "Configurações do ERP" → /app/administracao.
// Permissões (matriz), Visibilidade (overrides por usuário), Alçadas, Plano de Ações (ACL),
// Parâmetros, Sessões, Logs, Auditoria e Identidade são abas de Administracao.tsx.

function buildPlanoAcoesModule(podeCopiloto: boolean): ModuleDef {
  const items: NavItem[] = [
    { label: "Lista", to: "/app/plano-acoes", icon: ListChecks },
    { label: "Aprovações", to: "/app/plano-acoes/aprovacoes", icon: ClipboardCheck },
  ];
  if (podeCopiloto) {
    items.splice(1, 0, { label: "Copiloto IA", to: "/app/plano-acoes/copiloto", icon: Sparkles, badge: "IA" });
  }
  return {
    id: "plano-acoes",
    label: "Plano de Ações",
    description: "Gestão de ações e comitês",
    icon: Target,
    basePath: "/app/plano-acoes",
    status: "active",
    groups: [{ label: "Plano de Ações", defaultOpen: true, items }],
  };
}

// SST — ASO / Admissão (fila do Recrutamento)
const sstModule: ModuleDef = {
  id: "sst",
  label: "SST",
  description: "Saúde e Segurança do Trabalho",
  icon: HardHat,
  basePath: "/app/sst/aso",
  status: "active",
  groups: [
    {
      label: "Recrutamento",
      defaultOpen: true,
      items: [
        { label: "ASO / Admissão", to: "/app/sst/aso", icon: HardHat },
      ],
    },
  ],
};

const erpModules: ModuleDef[] = [
  licitacoesModule,
  controladoriaOrcModule,
  suprimentosModule,
  financeiroModule,
  fiscalModule,
  contabilModule,
  rhModule,
  recrutamentoModule,
  encarregadosModule,
  sistemasModule,
  juridicoModule,
  sstModule,
  centralServicosModule,
  whatsappModule,
  biModule,
];

interface SidebarProps {
  collapsed: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, mobileOpen = false, onMobileClose }: SidebarProps) {
  const location = useLocation();
  const { temAlcada, pendentes } = useTemAlcada();
  const { data: access } = useAccessibleMenus("visualizar");
  const empresaCtx = useContext(EmpresaAtivaContext);
  // Antes do EmpresaAtivaContext carregar a empresa real do banco, empresa.id
  // é o placeholder estático de src/data/controladoria.ts (ex: "HAGG" — um
  // código curto, não um uuid) — passar isso pra uma coluna uuid derruba a
  // query com 400. Só busca depois que o contexto termina de carregar.
  const { data: gradeAtivaCount } = useGradeAtivaCount(!empresaCtx?.loading ? empresaCtx?.empresa?.id ?? null : null);
  const chamadosNotif = useChamadosNotif();

  const allModules = [...erpModules, buildPlanoAcoesModule(false), integracaoModule];

  // Sidebar filtra itens com base nos menus acessíveis do usuário (perfil de
  // acesso, ver list_accessible_menus). Cargo/role não concede bypass. Plano de
  // Ações passou a usar o mesmo filtro que todo o resto (antes tinha exceção
  // própria via usePlanoAcaoPermissao — removida a pedido do usuário, pra
  // "Acesso por Usuário" ser a única autoridade em qualquer módulo).
  const canSee = useCallback((to: string) => {
    if (ACESSO_ABERTO_SEM_PERMISSOES || !access) return true;
    const code = matchMenuCode(to, access.routes);
    // Rota sem entrada em app_menu: nunca foi migrada pro controle por
    // perfil, então continua sempre visível (não é regressão esconder algo
    // que nunca teve controle de acesso definido).
    if (!code) return true;
    // Menu existe, mas ninguém nunca configurou nada pra ele no
    // gerenciamento de acesso (nenhuma linha em perfil_acesso_permissao
    // ou screen_permission_user) — fica aberto até alguém decidir algo lá.
    // Exceção: administracao/integracao nunca caem aqui, ver MENUS_SEMPRE_RESTRITOS.
    if (!access.configuredCodes.has(code) && !MENUS_SEMPRE_RESTRITOS.has(code)) return true;
    return access.codes.has(code);
  }, [access]);

  const visibleModules = useMemo(() => {
    const resolvedBadge = (badge: string | undefined) => {
      if (badge === "__grade_ativa__") return gradeAtivaCount != null ? String(gradeAtivaCount) : undefined;
      return badge;
    };

    const base = allModules
      .map((mod) => {
        if (!mod.groups) return mod;
        const groups = mod.groups
          .map((g) => ({ ...g, items: g.items.filter((item) => canSee(item.to)) }))
          .filter((g) => g.items.length > 0);
        return { ...mod, groups };
      })
      .filter((mod) => !mod.groups || mod.groups.length > 0);

    // Resolve sentinels de badge dinâmico + bolinha de notificação (notif → dot).
    const resolvedDot = (notif: NavItem["notif"]) =>
      notif === "meus" ? chamadosNotif.meus : notif === "dev" ? chamadosNotif.dev : false;

    // Ordem alfabética (pt-BR, ignorando acentos) em todos os níveis: módulos,
    // grupos e itens (submódulos). Ajuste apenas visual.
    const porNome = (a: { label: string }, b: { label: string }) =>
      a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" });

    return base
      .map((mod) => ({
        ...mod,
        badge: resolvedBadge(mod.badge),
        groups: mod.groups
          ?.map((g) => ({
            ...g,
            items: g.items
              .map((item) => ({ ...item, badge: resolvedBadge(item.badge), dot: resolvedDot(item.notif) }))
              .sort(porNome),
          }))
          .sort(porNome),
      }))
      .sort(porNome);
  }, [allModules, canSee, gradeAtivaCount, chamadosNotif.meus, chamadosNotif.dev]);

  // Módulo ativo = aquele cujo ITEM (link real) casa com a rota atual.
  // Detecção por basePath não serve porque o Licitações usa basePath "/app"
  // (colide com a página Início) e outros módulos se aninham (/app/rh ⊃ /app/rh/recrutamento).
  // Vence o item de caminho mais específico (mais longo). null = nenhum módulo (ex.: Início).
  const activeModuleId = useMemo(() => {
    let bestId: string | null = null;
    let bestLen = -1;
    for (const m of visibleModules) {
      if (m.status !== "active") continue;
      // Página-hub do módulo (headerLink) ativa o módulo, mesmo sem submódulos (ex.: /app/central-servicos).
      if (m.headerLink && m.headerLink !== "/app") {
        const matchesHub =
          location.pathname === m.headerLink || location.pathname.startsWith(m.headerLink + "/");
        if (matchesHub && m.headerLink.length > bestLen) {
          bestLen = m.headerLink.length;
          bestId = m.id;
        }
      }
      if (!m.groups) continue;
      for (const g of m.groups) {
        for (const item of g.items) {
          if (item.to === "/app") continue; // Início é página própria, não ativa nenhum módulo
          const matches =
            location.pathname === item.to || location.pathname.startsWith(item.to + "/");
          if (matches && item.to.length > bestLen) {
            bestLen = item.to.length;
            bestId = m.id;
          }
        }
      }
    }
    return bestId;
  }, [visibleModules, location.pathname]);

  const [expandedModule, setExpandedModule] = useState<string | null>(activeModuleId);
  // Expande automaticamente o módulo da rota atual ao navegar.
  useEffect(() => {
    if (activeModuleId) setExpandedModule(activeModuleId);
  }, [activeModuleId]);

  // No mobile a sidebar nunca aparece colapsada (sempre full); colapso é só desktop.
  const desktopCollapsed = collapsed;

  // Fecha drawer mobile ao clicar em um link de navegação
  const handleNavClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!onMobileClose) return;
    const target = e.target as HTMLElement;
    if (target.closest("a")) onMobileClose();
  };

  return (
    <aside
      onClick={handleNavClick}
      className={cn(
        // Mobile: drawer fixo off-canvas; desktop: fixo no viewport, independente do scroll da página.
        "fixed inset-y-0 left-0 z-50 flex h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-out",
        "w-[268px]",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        "lg:z-30 lg:translate-x-0 lg:shadow-none lg:transition-all",
        desktopCollapsed ? "lg:w-[172px]" : "lg:w-[268px]",
      )}
    >
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <img src={logoGN} alt="Grupo Nascimento" className="h-9 w-9 shrink-0 object-contain" />
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-display text-sm font-bold leading-tight text-white">Grupo Nascimento</p>
            <p className="text-[11px] uppercase tracking-wider text-sidebar-muted">ERP Corporativo</p>
          </div>
        )}
      </div>

      {/* Início global */}
      <div className="px-2 pt-3">
        <NavLink
          to="/app"
          end
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-white"
                : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-white",
              collapsed && "justify-center px-2",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Home className={cn("h-4 w-4 shrink-0", isActive && "text-accent")} />
              {!collapsed && <span>Início</span>}
            </>
          )}
        </NavLink>

        {canSee("/app/presidencia") && (
          <NavLink
            to="/app/presidencia"
            className={({ isActive }) =>
              cn(
                "mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-white",
                collapsed && "justify-center px-2",
              )
            }
          >
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Painel da Presidência</span>}
          </NavLink>
        )}

        {temAlcada && (
          <NavLink
            to="/app/aprovacoes/inbox"
            className={({ isActive }) =>
              cn(
                "mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-white"
                  : "text-sidebar-foreground/85 hover:bg-sidebar-accent/60 hover:text-white",
                collapsed && "justify-center px-2",
              )
            }
          >
            <Inbox className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1">Aguardando Aprovação</span>
                {pendentes > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {pendentes}
                  </span>
                )}
              </>
            )}
          </NavLink>
        )}
      </div>

      {/* Section label */}
      {!collapsed && (
        <p className="mt-4 px-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
          Módulos do ERP
        </p>
      )}

      <nav className="mt-2 flex-1 overflow-y-auto scroll-elegant px-2 py-1">
        {visibleModules.map((mod) => (
          <ModuleEntry
            key={mod.id}
            mod={mod}
            collapsed={collapsed}
            active={mod.id === activeModuleId}
            expanded={expandedModule === mod.id}
            onToggle={() => setExpandedModule((cur) => (cur === mod.id ? null : mod.id))}
          />
        ))}
      </nav>

      {/* Configurações + ambiente */}
      <div className="border-t border-sidebar-border p-2">
        <NavLink
          to="/app/administracao"
          className={({ isActive }) =>
            cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-white"
                : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-white",
              collapsed && "justify-center px-2",
            )
          }
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Configurações do ERP</span>}
        </NavLink>
        {!collapsed && (
          <div className="mt-2 flex items-center gap-2 rounded-md bg-sidebar-accent/40 px-2.5 py-2">
            <span className="h-2 w-2 rounded-full bg-success animate-pulse-soft" />
            <span className="text-[11px] font-medium text-sidebar-muted">Ambiente Produção</span>
          </div>
        )}
      </div>
    </aside>
  );
}

function ModuleEntry({
  mod,
  collapsed,
  active,
  expanded,
  onToggle,
}: {
  mod: ModuleDef;
  collapsed: boolean;
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isActiveModule = active;
  const Icon = mod.icon;
  const disabled = mod.status === "soon";
  const navigate = useNavigate();
  // Bolinha no cabeçalho quando algum item do módulo tem novidade (visível mesmo
  // com a sidebar colapsada ou o submenu recolhido).
  const modDot = !disabled && !!mod.groups?.some((g) => g.items.some((i) => i.dot));

  return (
    <div className="mb-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (mod.headerLink) navigate(mod.headerLink); onToggle(); }}
        className={cn(
          "group relative flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
          isActiveModule
            ? "bg-sidebar-accent text-white"
            : disabled
              ? "text-sidebar-muted/70 cursor-not-allowed"
              : "text-sidebar-foreground/90 hover:bg-sidebar-accent/60 hover:text-white",
          collapsed && "justify-center px-2",
        )}
        title={collapsed ? mod.label : undefined}
      >
        {isActiveModule && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
        <span className="relative shrink-0">
          <Icon className={cn("h-4 w-4", isActiveModule && "text-accent", disabled && "opacity-60")} />
          {modDot && collapsed && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{mod.label}</span>
            {modDot && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="Novidades" />
            )}
            {mod.badge && !disabled && (
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-sidebar-foreground/70">
                {mod.badge}
              </span>
            )}
            {disabled && (
              <span className="rounded bg-sidebar-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sidebar-muted">
                Em breve
              </span>
            )}
            {!disabled && mod.groups && (
              <ChevronRight
                className={cn("h-3.5 w-3.5 text-sidebar-muted transition-transform", expanded && "rotate-90")}
              />
            )}
          </>
        )}
      </button>

      {/* Submódulos (apenas quando expandido, módulo ativo e sidebar não colapsada) */}
      {expanded && !collapsed && !disabled && mod.groups && (
        <div className="mt-1 ml-3 border-l border-sidebar-border/70 pl-2">
          {mod.groups.map((group) => (
            <SidebarGroup key={group.label} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarGroup({ group }: { group: NavGroup }) {
  const location = useLocation();
  const hasActive = group.items.some(
    (i) => location.pathname === i.to || (i.to !== "/app" && location.pathname.startsWith(i.to)),
  );
  const [open, setOpen] = useState(group.defaultOpen ?? hasActive ?? false);

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="mb-0.5 flex w-full items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted hover:text-white"
      >
        <span>{group.label}</span>
        <ChevronDown className={cn("h-3 w-3 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <ul className="space-y-0.5">
          {group.items.map((item) => {
            // Match exato quando outro item do menu está aninhado sob esta rota
            // (ex.: "Processos" é prefixo de "/processos/dashboard" e "/processos/audiencias");
            // sem isso o item-pai acenderia junto com o filho.
            const hasNested = group.items.some((o) => o.to !== item.to && o.to.startsWith(item.to + "/"));
            return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/app" || hasNested}
                className={({ isActive }) =>
                  cn(
                    "group relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-white"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-white",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
                    <item.icon className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-accent" : "")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.dot && (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="Novidades" />
                    )}
                    {item.badge && (
                      <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-sidebar-foreground/70">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </NavLink>
            </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
