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
  Link2,
  Coins,
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
  GraduationCap,
  ArrowLeftRight,
  UserCog,
  Briefcase as BriefcaseIcon,
  Home,
  ShoppingCart,
  BarChart3,
  Settings,
  FileArchive,
  BookOpen,
  ClipboardCheck,
  TableProperties,
  Laptop2,
  Wrench,
  FileOutput,
  Headset,
  ShieldAlert,
  ClipboardList,
  Bell,
  MessageCircle,
  FlaskConical,
  Bot,
  ShieldCheck,
  Shirt,
  Truck,
  Boxes,
  FileClock,
  Car,
  Package,
  PlusCircle,
  UserMinus,
  UserPlus,
  CalendarCheck2,
  AlertTriangle,
} from "lucide-react";
import { useTemAlcada } from "@/hooks/useTemAlcada";
import { useAccessibleMenus, matchMenuCode } from "@/hooks/useAccessibleMenus";
import { useModoExterno, rotaPermitidaExterno } from "@/hooks/useModoExterno";
import { ACESSO_ABERTO_SEM_PERMISSOES, rotaSempreLiberada } from "@/lib/acesso";
import { useGradeAtivaCount } from "@/hooks/useGradeAtivaCount";
import { useChamadosNotif } from "@/hooks/useChamadosNotif";
import { useTrocaFuncaoNotif } from "@/hooks/useTrocaFuncaoNotif";
import { EmpresaAtivaContext } from "@/context/EmpresaAtivaContext";
import { Inbox } from "lucide-react";
import { Target } from "lucide-react";
import { GitBranch, GitMerge } from "lucide-react";
import { MessageSquare } from "lucide-react";
import { Banknote } from "lucide-react";
import { TrendingDown } from "lucide-react";
import { Megaphone } from "lucide-react";
import { CreditCard } from "lucide-react";
import { Network } from "lucide-react";
import { useNovidades } from "@/hooks/useNovidades";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useState, useContext } from "react";

interface NavItem {
  label: string;
  to: string;
  icon: any;
  badge?: string;
  // Bolinha de notificação (novidade). Resolvida em runtime pelo useChamadosNotif.
  notif?: "meus" | "dev" | "troca_funcao";
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
        { label: "Cotações", to: "/app/licitacoes/cotacoes", icon: MessageSquare },
        // Consulta do banco de preços do Compras, para a Licitação montar
        // proposta sem depender do comprador cotar (SIS-2026-0199).
        { label: "Preços de Materiais", to: "/app/licitacoes/precos-materiais", icon: Coins },
        // SIS-2026-0283: espelho simplificado de Aprovações do Malote, só
        // pra analista ver o que falta justificar nos contratos dele.
        { label: "Justificativa Analistas", to: "/app/licitacoes/justificativa-analistas", icon: AlertTriangle },
        { label: "Documentos", to: "/app/documentos", icon: ScrollText },
        // B2: "Triagem & IA" removida do menu (rota /app/triagem segue existindo,
        // mas controlada pelo RouteGuard + matriz de permissões do ERP).
        { label: "Composição & BDI", to: "/app/composicao", icon: PieChart },
      ],
    },
    {
      // Analistas Validações (02/09/2026): a PRIMEIRA porta dos três fluxos
      // que antes começavam no Operacional. Ele não perdeu as telas — perdeu
      // os botões, e ficou só com o acompanhamento.
      label: "Analistas Validações",
      defaultOpen: true,
      items: [
        { label: "Gestão Recrutamento", to: "/app/licitacoes/analistas/recrutamento", icon: UserCog },
        { label: "Mudança de Função", to: "/app/licitacoes/analistas/troca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
        { label: "Solicitações de Demissão", to: "/app/licitacoes/analistas/demissao", icon: UserMinus },
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
  description: "Materiais, catálogo e estoque por etiqueta",
  icon: ShoppingCart,
  basePath: "/app/suprimentos",
  status: "active",
  groups: [
    {
      label: "Materiais & Catálogo",
      defaultOpen: true,
      items: [
        { label: "Catálogo de Materiais", to: "/app/suprimentos/catalogo", icon: Shirt },
        { label: "Aprovação de Catálogo", to: "/app/suprimentos/catalogo/aprovacoes", icon: ClipboardCheck },
        { label: "Pedidos de Materiais", to: "/app/suprimentos/pedidos-materiais", icon: PackageCheck },
        { label: "Estoque & Etiquetas", to: "/app/suprimentos/estoque-etiquetas", icon: Boxes },
        { label: "Histórico do Colaborador", to: "/app/suprimentos/colaborador", icon: History },
        { label: "Declaração de Conteúdo", to: "/app/suprimentos/correio-declaracao", icon: FileText },
        { label: "Cotações do Malote", to: "/app/suprimentos/cotacoes-malote", icon: FileClock },
        { label: "Pedidos de Compra", to: "/app/suprimentos/pedidos-compra", icon: ShoppingCart },
        { label: "Recebimentos", to: "/app/suprimentos/recebimentos", icon: ClipboardCheck },
        { label: "NF de Entrada", to: "/app/suprimentos/nf-entrada", icon: FileText },
      ],
    },
    {
      label: "Licitação",
      defaultOpen: true,
      items: [
        // Mesma linha de cotacoes_licitacao que a Licitação vê em
        // /app/licitacoes/cotacoes, pelo lado de quem responde. Ícone igual ao
        // de lá de propósito: é um canal só, visto de dois lugares.
        { label: "Cotações para a Licitação", to: "/app/suprimentos/cotacoes", icon: MessageSquare },
      ],
    },
    {
      // Fila do Recrutamento que cai no Compras: os EPIs de quem está sendo
      // admitido. Fica aqui, e não no kanban do RH, porque só o Compras pode
      // dar esse aval.
      label: "Admissões",
      defaultOpen: true,
      items: [
        { label: "EPIs — Admissões", to: "/app/suprimentos/epis-admissoes", icon: ShieldCheck },
      ],
    },
    {
      label: "Patrimônio & Manutenção",
      defaultOpen: true,
      items: [
        { label: "Patrimônio", to: "/app/suprimentos/patrimonio", icon: Car },
        { label: "Painel de Manutenções", to: "/app/suprimentos/manutencao", icon: Wrench },
      ],
    },
    {
      label: "Cadastros",
      defaultOpen: true,
      items: [
        // Almoxarifado permanece: é onde o Estoque & Etiquetas guarda cada item
        // (sup_estoque_item.almoxarifado_id). As demais telas do módulo antigo
        // saíram da navegação em 20260821000001 — as rotas seguem existindo por
        // enquanto, alcançáveis só por URL direta, até removermos os arquivos.
        { label: "Fornecedores", to: "/app/suprimentos/fornecedores", icon: Building2 },
        // Fila do que os fornecedores preencheram pelo link público
        // (SIS-2026-0209). Menu próprio: cadastrar fornecedor e aprovar
        // cadastro vindo de fora são permissões diferentes.
        { label: "Cadastros de Fornecedor", to: "/app/suprimentos/fornecedores/pendentes", icon: Link2 },
        { label: "Almoxarifados", to: "/app/suprimentos/almoxarifados", icon: Home },
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
        { label: "Conferência de Ponto", to: "/app/financeiro/conferencia-ponto", icon: ClipboardCheck },
      ],
    },
    {
      label: "Gestão Financeira",
      defaultOpen: true,
      items: [
        { label: "Fluxo de Caixa", to: "/app/financeiro/gestao-financeira/fluxo-caixa", icon: TrendingDown },
        { label: "Cartão de Crédito", to: "/app/financeiro/gestao-financeira/cartao-credito", icon: CreditCard, badge: "Novo" },
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

// Malote — módulo próprio (SIS-2026-0081), separado de Financeiro/
// Controladoria. Itens em ordem alfabética a pedido do usuário.
const maloteModule: ModuleDef = {
  id: "malote",
  label: "Malote",
  description: "Despesas e aprovações",
  icon: Package,
  basePath: "/app/malote",
  status: "active",
  groups: [
    {
      label: "Itens do Malote",
      defaultOpen: true,
      items: [
        { label: "Aprovações do Malote", to: "/app/malote/aprovacoes", icon: CheckCircle2 },
        { label: "Arquivos do Malote", to: "/app/malote/arquivos", icon: FileArchive },
        { label: "Configurações", to: "/app/malote/configuracoes", icon: Settings },
        { label: "Criar Despesa", to: "/app/malote/criar-despesa", icon: PlusCircle },
        { label: "Dashboard", to: "/app/malote/dashboard", icon: BarChart3 },
        { label: "Meus Itens", to: "/app/malote/meus-itens", icon: ListChecks },
        { label: "Pagamento Malote", to: "/app/malote/pagamento", icon: Banknote },
      ],
    },
    // SIS-2026-0125: Classificação/Orçamento saem de Controladoria e passam
    // a viver aqui — Classificação Administrativo (simples) e Orçamento
    // Administrativo continuam separados de Classificações Malote (rica,
    // com aprovadores/alçadas); Orçamento de Contratos (calculado ao vivo
    // da planilha de custo) e Orçamento Geral (visão conjunta) são novos.
    {
      label: "Orçamentos",
      defaultOpen: true,
      items: [
        { label: "Classificações Administrativo", to: "/app/malote/classificacoes-administrativo", icon: ListChecks },
        { label: "Orçamento Administrativo", to: "/app/malote/orcamento-administrativo", icon: ClipboardList },
        { label: "Classificações Malote", to: "/app/malote/classificacoes-malote", icon: ListChecks },
        { label: "Orçamento de Contratos", to: "/app/malote/orcamento-contratos", icon: FileText },
        { label: "Orçamento Geral", to: "/app/malote/orcamento-geral", icon: Calculator },
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
  description: "Colaboradores, férias e movimentações",
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
        // "Alocações em Contratos" e "Folha de Pagamento" saíram em
        // 04/09/2026. Eram as duas telas genéricas que sobraram do modelo
        // antigo (tabelas `alocacao_colaborador`,
        // `folha_periodo`/`folha_evento`, e o cadastro `colaborador`, que a
        // fonte única EMPREGADOS substituiu). Menus desativados na migration
        // 20260930000053; as tabelas continuam no banco.
        { label: "Gestão de Férias", to: "/app/rh/ferias", icon: CalendarRange },
        { label: "Solicitações de Demissão", to: "/app/rh/solicitacoes-demissao", icon: UserMinus },
        { label: "Conferência de Ponto", to: "/app/rh/conferencia-ponto", icon: ClipboardCheck },
        { label: "Conferência de Ponto — Painel", to: "/app/rh/conferencia-ponto/painel", icon: BarChart3 },
        // Uma só, desde 02/09/2026: a etapa do RH é ALTERAR NA SENIOR. A
        // aprovação do administrativo, que era o segundo item aqui, foi para o
        // analista junto com a de contrato. A rota
        // /app/rh/troca-funcao-escritorio continua existindo para quem já tem a
        // permissão — ela só não é mais um item de menu do RH.
        { label: "Mudança de Função", to: "/app/rh/troca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
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
  basePath: "/app/encarregados",
  status: "active",
  // Agrupado pelo submódulo de ORIGEM de cada solicitação, como nos demais
  // módulos — o encarregado pensa "preciso de uma vaga", não "preciso abrir
  // uma solicitação". Os itens de solicitação caem na mesma tela; muda só o
  // formulário que já vem aberto.
  groups: [
    {
      // Vem PRIMEIRO de propósito. Os itens abaixo abrem o formulário já
      // pronto para pedir — e quem só quer saber "em que pé está minha
      // solicitação de férias?" era obrigado a abrir o card de pedir férias
      // para descobrir. Consultar tem que ter porta própria, antes de pedir.
      label: "Acompanhamento",
      defaultOpen: true,
      items: [
        { label: "Minhas Solicitações", to: "/app/encarregados/minhas-solicitacoes", icon: ClipboardList },
      ],
    },
    {
      label: "Operacional",
      defaultOpen: true,
      items: [
        { label: "Controle de Diárias", to: "/app/operacional/diarias", icon: CalendarCheck2 },
      ],
    },
    {
      label: "Recrutamento e Seleção",
      defaultOpen: true,
      items: [
        { label: "Solicitar Vaga", to: "/app/encarregados/solicitar-vaga", icon: UserCog },
      ],
    },
    {
      label: "Recursos Humanos",
      defaultOpen: true,
      items: [
        { label: "Solicitar Férias", to: "/app/encarregados/solicitar-ferias", icon: CalendarRange },
        { label: "Solicitar Demissão", to: "/app/encarregados/solicitar-demissao", icon: UserMinus },
        { label: "Mudança de Função", to: "/app/encarregados/troca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
      ],
    },
    {
      label: "Jurídico",
      defaultOpen: true,
      items: [
        { label: "Solicitar Advertência", to: "/app/encarregados/advertencia", icon: ShieldAlert },
      ],
    },
    {
      label: "Sistemas",
      defaultOpen: true,
      items: [
        // Mesma tela da Central de Serviços, ancorada aqui: o encarregado
        // também abre chamado, e não deveria ter que sair do módulo dele.
        { label: "Chamados de Sistemas", to: "/app/encarregados/chamados", icon: Headset, notif: "meus" },
      ],
    },
    {
      label: "Suprimentos",
      defaultOpen: true,
      items: [
        // "Minhas Solicitações" saiu do menu a pedido: cada solicitação já tem
        // seu próprio item acima, e a rota continua de pé (o Início e os
        // redirecionamentos do Jurídico ainda apontam para ela).
        { label: "Solicitar Materiais", to: "/app/encarregados/solicitar-materiais", icon: Shirt },
        // "Meus Pedidos" era ambíguo ao lado de "Minhas Solicitações": o
        // encarregado não distingue pedido de solicitação. O rótulo agora diz
        // de que são.
        { label: "Minhas Solicitações de Materiais", to: "/app/encarregados/meus-pedidos", icon: Truck },
      ],
    },
    {
      // Treinamentos deixou de ser modulo proprio: um item so nao sustenta um
      // bloco no menu, e quem faz o treinamento do ERP e o encarregado. A ROTA
      // e o CODIGO do menu ficam como estavam (/app/treinamentos/erp) - e o
      // codigo que carrega a permissao de quem ja tinha, entao mover de modulo
      // nao tira o acesso de ninguem nem quebra link salvo.
      label: "Treinamentos",
      defaultOpen: true,
      items: [
        { label: "Treinamentos ERP", to: "/app/treinamentos/erp", icon: GraduationCap },
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
        // "Chamados de Sistemas" (a tela do solicitante) vive só na Central de
        // Serviços. Aqui ficam as telas de quem ATENDE o chamado.
        { label: "Painel de Distribuição", to: "/app/sistemas/chamados/painel", icon: BarChart3 },
        { label: "Dashboard de Chamados", to: "/app/sistemas/chamados/dashboard-tv", icon: LayoutDashboard },
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
        { label: "Espaço do Colaborador", to: "/app/central-servicos/espaco-colaborador", icon: Network },
        { label: "Orientações Jurídicas", to: "/app/central-servicos/orientacoes-juridicas", icon: BookOpen },
        { label: "Nascimento Formulários", to: "/app/central-servicos/formularios", icon: ClipboardList },
        { label: "Chamados de Sistemas", to: "/app/central-servicos/chamados", icon: Headset, notif: "meus" },
        { label: "Agenda de Reunião", to: "/app/central-servicos/reunioes", icon: CalendarRange },
        { label: "Agendamento de Veículos", to: "/app/central-servicos/veiculos", icon: Car },
        // Mesma tela de abrir vaga da Gestão de Recrutamento, ancorada aqui:
        // quem é do escritório pede vaga por esta porta, sem precisar de
        // acesso ao módulo de Recrutamento inteiro.
        { label: "Solicitar Vaga", to: "/app/central-servicos/solicitar-vaga", icon: UserPlus },
        // Mesma tela de Treinamentos ERP dos Encarregados, ancorada aqui: o
        // treinamento do ERP interessa a quem não é encarregado, e a única
        // porta ficava dentro do módulo deles. Menu próprio
        // (`central_servicos_treinamentos`) — liberar esta porta não abre a
        // de lá, nem o contrário.
        { label: "Treinamentos", to: "/app/central-servicos/treinamentos", icon: GraduationCap },
        // Só o "Solicitar" entra no menu. Aprovação e Tipos/Limites ficam de
        // fora de propósito: são telas de poucas pessoas, alcançadas pelos
        // botões do cabeçalho da própria tela de solicitar (que só aparecem
        // para quem tem a permissão). Menu de 3 itens para 2 que quase
        // ninguém abre só empurra o resto para baixo.
        { label: "Solicitar Reembolso", to: "/app/central-servicos/reembolso", icon: Receipt },
      ],
    },
  ],
};

// Comitê de Ética — denúncias saíram da Central de Serviços porque não são
// atendimento ao colaborador: são assunto de comitê, com acesso restrito.
const comiteEticaModule: ModuleDef = {
  id: "comite_etica",
  label: "Comitê de Ética",
  description: "Denúncias e apuração de conduta",
  icon: ShieldAlert,
  basePath: "/app/comite-etica",
  status: "active",
  groups: [
    {
      label: "Comitê de Ética",
      defaultOpen: true,
      items: [
        // Indicadores vem primeiro: é a leitura gerencial do módulo, e tem
        // liberação de acesso própria (comite_etica_indicadores) — dá para a
        // diretoria ver o painel sem ver o conteúdo dos relatos.
        { label: "Indicadores", to: "/app/comite-etica/indicadores", icon: BarChart3 },
        { label: "Denúncias", to: "/app/comite-etica/denuncias", icon: ShieldAlert },
        // "Denúncias (Contato Seguro)" saiu daqui em 21/08/2026: o canal
        // legado foi aposentado, a tela e a função de sync foram removidas e
        // o menu ficou com app_menu.ativo = false (mesmo par que "Pregão &
        // Lances" usou). As TABELAS do legado continuam no banco, só sem
        // porta de entrada — apagar histórico de canal de ética não se desfaz.
        { label: "Configuração", to: "/app/comite-etica/configuracao", icon: Settings },
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
        { label: "Dashboard", to: "/app/whatsapp/dashboard", icon: BarChart3 },
        { label: "Chatbot", to: "/app/whatsapp/chatbot", icon: Bot },
        { label: "Testes", to: "/app/whatsapp/testes", icon: FlaskConical },
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

// Operacional — gestão da operação em campo (diárias, coberturas de escala) e
// o que chega dos encarregados esperando aprovação daqui.
const operacionalModule: ModuleDef = {
  id: "operacional",
  label: "Operacional",
  description: "Diárias, escala e aprovações",
  icon: CalendarCheck2,
  basePath: "/app/operacional",
  status: "active",
  groups: [
    {
      label: "Operacional",
      defaultOpen: true,
      items: [{ label: "Controle de Diárias", to: "/app/operacional/diarias", icon: CalendarCheck2 }],
    },
    {
      label: "Recrutamento e Seleção",
      defaultOpen: true,
      items: [
        // Acompanhamento, não decisão (02/09/2026): quem aprova é o analista,
        // em Licitações › Analistas Validações. O rótulo diz isso para a
        // pessoa não abrir a tela procurando um botão que saiu.
        { label: "Gestão Recrutamento — Acompanhar", to: "/app/operacional/recrutamento", icon: UserCog },
      ],
    },
    {
      label: "Recursos Humanos",
      defaultOpen: true,
      items: [
        // Também virou acompanhamento: a aprovação da demissão passou para o
        // analista. A Mudança de Função abaixo, não — ali o Operacional
        // continua aprovando, depois do analista.
        { label: "Solicitações de Demissão — Acompanhar", to: "/app/operacional/solicitacoes-demissao", icon: UserMinus },
        { label: "Conferência de Ponto", to: "/app/operacional/conferencia-ponto", icon: ClipboardCheck },
        { label: "Mudança de Função", to: "/app/operacional/troca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
      ],
    },
  ],
};

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
        { label: "Mudança de Função — ASO", to: "/app/sst/troca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
      ],
    },
    {
      // A outra ponta: o desligamento também passa pelo SST, depois do RH.
      label: "Desligamento",
      defaultOpen: true,
      items: [
        { label: "ASO Demissional", to: "/app/sst/aso-demissional", icon: UserMinus },
      ],
    },
    {
      label: "EPIs",
      defaultOpen: true,
      items: [
        { label: "Laudos de EPI", to: "/app/sst/laudos", icon: FileCheck2 },
        { label: "Controle de CA", to: "/app/sst/controle-ca", icon: ShieldAlert },
      ],
    },
  ],
};

// Diretoria — as telas de aprovacao que a diretoria ja usa, ancoradas num
// modulo proprio. NAO ha componente nem regra de acesso nova: sao as MESMAS
// telas do Malote e do RH, com outra porta de entrada, para quem e da
// diretoria nao ter que entrar no modulo dos outros para aprovar. E o mesmo
// arranjo dos Chamados no modulo do encarregado.
//
// Quem enxerga cada item continua 100% em Acesso por Usuario: os menus nascem
// SEM nenhuma linha de permissao e o sistema nega por padrao (RouteGuard e
// canSee), entao o modulo comeca invisivel para todo mundo, inclusive para
// quem ja acessa as telas originais.
const diretoriaModule: ModuleDef = {
  id: "diretoria",
  label: "Diretoria",
  description: "Aprovacoes da diretoria",
  icon: Building2,
  basePath: "/app/diretoria",
  status: "active",
  groups: [
    {
      label: "Aprovacoes",
      defaultOpen: true,
      items: [
        { label: "Aprovacoes do Malote", to: "/app/diretoria/malote-aprovacoes", icon: CheckCircle2 },
        { label: "Mudanca de Funcao", to: "/app/diretoria/troca-funcao-escritorio", icon: ArrowLeftRight, notif: "troca_funcao" },
      ],
    },
  ],
};

const erpModules: ModuleDef[] = [
  licitacoesModule,
  controladoriaOrcModule,
  suprimentosModule,
  financeiroModule,
  maloteModule,
  diretoriaModule,
  fiscalModule,
  contabilModule,
  rhModule,
  recrutamentoModule,
  encarregadosModule,
  operacionalModule,
  sistemasModule,
  juridicoModule,
  sstModule,
  centralServicosModule,
  comiteEticaModule,
  whatsappModule,
  biModule,
];

/**
 * O MESMO conjunto que a sidebar monta em runtime (`allModules`), exposto para
 * quem precisa listar o ERP inteiro sem manter um segundo catálogo — hoje o
 * Início, em "Todos os módulos".
 *
 * Existe porque a lista de lá era escrita à mão e ficava para trás a cada tela
 * nova: o encarregado via oito itens no menu lateral e dois no Início. Catálogo
 * único é a única forma de isso não se repetir.
 */
export const NAV_MODULOS: ModuleDef[] = [...erpModules, buildPlanoAcoesModule(false)];
export type { ModuleDef as NavModuleDef, NavItem as NavItemDef };

interface SidebarProps {
  collapsed: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, mobileOpen = false, onMobileClose }: SidebarProps) {
  const location = useLocation();
  const { temAlcada, pendentes } = useTemAlcada();
  const { data: access } = useAccessibleMenus("visualizar");
  const externo = useModoExterno();
  const empresaCtx = useContext(EmpresaAtivaContext);
  // Antes do EmpresaAtivaContext carregar a empresa real do banco, empresa.id
  // é o placeholder estático de src/data/controladoria.ts (ex: "HAGG" — um
  // código curto, não um uuid) — passar isso pra uma coluna uuid derruba a
  // query com 400. Só busca depois que o contexto termina de carregar.
  const { data: gradeAtivaCount } = useGradeAtivaCount(!empresaCtx?.loading ? empresaCtx?.empresa?.id ?? null : null);
  const chamadosNotif = useChamadosNotif();
  const trocaFuncaoNotif = useTrocaFuncaoNotif();
  // Contador das Novidades do Sistema: o mesmo número da bolinha do topo.
  const { naoLidasCount: novidadesNaoLidas } = useNovidades();

  const allModules = NAV_MODULOS;

  // Sidebar filtra itens com base nos menus acessíveis do usuário (perfil de
  // acesso, ver list_accessible_menus). Cargo/role não concede bypass. Plano de
  // Ações passou a usar o mesmo filtro que todo o resto (antes tinha exceção
  // própria via usePlanoAcaoPermissao — removida a pedido do usuário, pra
  // "Acesso por Usuário" ser a única autoridade em qualquer módulo).
  const canSee = useCallback((to: string) => {
    // Encarregado externo: só a allowlist dele. Precisa vir ANTES de tudo —
    // ele não tem perfil de acesso, então cairia no ramo "menu ainda não
    // configurado → visível" e enxergaria o ERP inteiro no menu. Este ramo
    // apenas restringe; quem decide de verdade é a RLS do banco.
    if (externo) return rotaPermitidaExterno(to);
    if (ACESSO_ABERTO_SEM_PERMISSOES) return true;
    // Mesma regra do RouteGuard: NEGA POR PADRÃO. A sidebar não pode listar o
    // que a rota vai barrar — item visível que dá "Acesso negado" ao clicar é
    // pior do que item ausente.
    if (rotaSempreLiberada(to)) return true;
    if (!access) return false;
    const code = matchMenuCode(to, access.routes);
    // Sem cadastro em app_menu, ou menu desativado no Catálogo: não aparece.
    if (!code || access.inactiveCodes.has(code)) return false;
    return access.codes.has(code);
  }, [access, externo]);

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
    //
    // Recebe o item inteiro, e não só `notif`, porque a bolinha da Mudança de
    // Função depende da ROTA: os quatro itens do fluxo compartilham o mesmo
    // `notif`, e cada um acende pelo status da própria etapa.
    const resolvedDot = (item: NavItem) =>
      item.notif === "meus" ? chamadosNotif.meus
      : item.notif === "dev" ? chamadosNotif.dev
      : item.notif === "troca_funcao" ? (trocaFuncaoNotif.porRota[item.to] ?? false)
      : false;

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
              .map((item) => ({ ...item, badge: resolvedBadge(item.badge), dot: resolvedDot(item) }))
              .sort(porNome),
          }))
          .sort(porNome),
      }))
      .sort(porNome);
  }, [allModules, canSee, gradeAtivaCount, chamadosNotif.meus, chamadosNotif.dev, trocaFuncaoNotif]);

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
      {/* Fundo ambiente. Fica atrás de tudo (z-0) e não recebe ponteiro:
          os blocos abaixo sobem para z-10 justamente por causa dele. */}
      <div className="sb-amb" aria-hidden>
        <span className="a" />
        <span className="b" />
      </div>

      {/* Brand */}
      <div className="sb-brand relative z-10 flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <img src={logoGN} alt="Grupo Nascimento" className="sb-logo h-9 w-9 shrink-0 object-contain" />
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-display text-sm font-bold leading-tight text-white">Grupo Nascimento</p>
            <p className="text-[11px] uppercase tracking-wider text-sidebar-muted">ERP Corporativo</p>
          </div>
        )}
      </div>

      {/* Início global */}
      <div className="relative z-10 px-2 pt-3">
        <NavLink
          to="/app"
          end
          className={({ isActive }) =>
            cn(
              "sb-item flex items-center gap-3 rounded-md px-3 py-2 text-sm font-bold",
              isActive
                ? "sb-on bg-sidebar-accent text-white"
                : "text-white/85 hover:bg-sidebar-accent/60 hover:text-white",
              collapsed && "justify-center px-2",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="sb-bar absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
              <Home className={cn("sb-ic h-4 w-4 shrink-0", isActive && "text-accent")} />
              {!collapsed && <span>Início</span>}
            </>
          )}
        </NavLink>

        {/* Novidades do Sistema — fica no topo, junto do Início: é sobre o
            ERP, não sobre um módulo. A rota não está em app_menu, então é
            visível para todo mundo (publicar é que depende do flag). */}
        <NavLink
          to="/app/novidades"
          className={({ isActive }) =>
            cn(
              "sb-item mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-bold",
              isActive
                ? "sb-on bg-sidebar-accent text-white"
                : "text-white/85 hover:bg-sidebar-accent/60 hover:text-white",
              collapsed && "justify-center px-2",
            )
          }
          title={collapsed ? "Novidades do Sistema" : undefined}
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="sb-bar absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
              <Megaphone className={cn("sb-ic h-4 w-4 shrink-0", isActive && "text-accent")} />
              {!collapsed && <span className="flex-1">Novidades do Sistema</span>}
              {novidadesNaoLidas > 0 && (
                collapsed
                  ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" />
                  : <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-black leading-none text-accent-foreground">
                      {novidadesNaoLidas > 9 ? "9+" : novidadesNaoLidas}
                    </span>
              )}
            </>
          )}
        </NavLink>

        {canSee("/app/presidencia") && (
          <NavLink
            to="/app/presidencia"
            className={({ isActive }) =>
              cn(
                "sb-item mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-bold",
                isActive
                  ? "sb-on bg-sidebar-accent text-white"
                  : "text-white/85 hover:bg-sidebar-accent/60 hover:text-white",
                collapsed && "justify-center px-2",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="sb-bar absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
                <LayoutDashboard className={cn("sb-ic h-4 w-4 shrink-0", isActive && "text-accent")} />
                {!collapsed && <span>Painel da Presidência</span>}
              </>
            )}
          </NavLink>
        )}

        {temAlcada && (
          <NavLink
            to="/app/aprovacoes/inbox"
            className={({ isActive }) =>
              cn(
                "sb-item mt-1 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-bold",
                isActive
                  ? "sb-on bg-sidebar-accent text-white"
                  : "text-white/85 hover:bg-sidebar-accent/60 hover:text-white",
                collapsed && "justify-center px-2",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="sb-bar absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
                <Inbox className={cn("sb-ic h-4 w-4 shrink-0", isActive && "text-accent")} />
                {!collapsed && (
                  <>
                    <span className="flex-1">Aguardando Aprovação</span>
                    {pendentes > 0 && (
                      <span className="animate-pop rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {pendentes}
                      </span>
                    )}
                  </>
                )}
              </>
            )}
          </NavLink>
        )}
      </div>

      {/* Section label */}
      {!collapsed && (
        <p className="relative z-10 mt-4 px-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
          Módulos do ERP
        </p>
      )}

      <nav className="sb-scroll relative z-10 mt-2 flex-1 overflow-y-auto scroll-elegant px-2 py-1">
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
      <div className="relative z-10 border-t border-sidebar-border p-2">
        {/* Encarregado externo nunca administra nada: o link levava direto
            pra tela de "Acesso negado" do RouteGuard. Fica fora do menu dele. */}
        {!externo && (
        <NavLink
          to="/app/administracao"
          className={({ isActive }) =>
            cn(
              "sb-item flex items-center gap-3 rounded-md px-3 py-2 text-sm font-bold",
              isActive
                ? "sb-on bg-sidebar-accent text-white"
                : "text-white/85 hover:bg-sidebar-accent/60 hover:text-white",
              collapsed && "justify-center px-2",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="sb-bar absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
              <Settings className={cn("sb-ic h-4 w-4 shrink-0", isActive && "text-accent")} />
              {!collapsed && <span>Configurações do ERP</span>}
            </>
          )}
        </NavLink>
        )}
        {!collapsed && (
          <div className="mt-2 flex items-center gap-2.5 rounded-md bg-sidebar-accent/40 px-2.5 py-2">
            <span className="sb-live h-2 w-2 rounded-full bg-success" />
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

  // Para o submenu FECHAR animado ele precisa continuar no DOM depois de
  // recolhido — desmontar corta a transição no primeiro frame. Montamos na
  // primeira abertura e nunca mais tiramos: quem nunca abriu o módulo não
  // paga nada, e quem abriu ganha a animação nos dois sentidos.
  const podeAbrir = !collapsed && !disabled && !!mod.groups;
  const [jaAbriu, setJaAbriu] = useState(expanded && podeAbrir);
  useEffect(() => { if (expanded && podeAbrir) setJaAbriu(true); }, [expanded, podeAbrir]);
  const aberto = expanded && podeAbrir;

  // Posição de cada grupo numa contagem contínua do módulo inteiro, para a
  // entrada escalonada correr de cima para baixo de verdade: sem isso cada
  // grupo recomeça do zero e o primeiro item de um grupo aparece antes do
  // título do grupo anterior.
  const basesDosGrupos = useMemo(() => {
    let cursor = 0;
    return (mod.groups ?? []).map((g) => {
      const base = cursor;
      cursor += g.items.length + 1; // +1 pela linha do cabeçalho do grupo
      return base;
    });
  }, [mod.groups]);

  return (
    <div className="mb-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (mod.headerLink) navigate(mod.headerLink); onToggle(); }}
        className={cn(
          "sb-item group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-bold",
          isActiveModule
            ? "sb-on bg-sidebar-accent text-white"
            : disabled
              ? "text-sidebar-muted/70 cursor-not-allowed"
              : "text-white/90 hover:bg-sidebar-accent/60 hover:text-white",
          collapsed && "justify-center px-2",
        )}
        title={collapsed ? mod.label : undefined}
      >
        {isActiveModule && <span className="sb-bar absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
        <span className="sb-ic relative shrink-0">
          <Icon className={cn("h-4 w-4", isActiveModule && "text-accent", disabled && "opacity-60")} />
          {modDot && collapsed && (
            <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse-soft rounded-full bg-red-500 ring-2 ring-sidebar" />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{mod.label}</span>
            {modDot && (
              <span className="h-2 w-2 shrink-0 animate-pulse-soft rounded-full bg-red-500" title="Novidades" />
            )}
            {mod.badge && !disabled && (
              <span className="animate-pop rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-sidebar-foreground/70">
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
                className={cn("sb-chev h-3.5 w-3.5 text-sidebar-muted", aberto && "rotate-90 text-accent")}
              />
            )}
          </>
        )}
      </button>

      {/* Submódulos — a altura é animada pelo grid-template-rows do .sb-sub. */}
      {jaAbriu && mod.groups && (
        <div className="sb-sub" data-open={aberto} aria-hidden={!aberto}>
          <div className="sb-sub-in">
            <div className="sb-rail mt-1 ml-3 pl-2">
              {mod.groups.map((group, gi) => (
                <SidebarGroup key={group.label} group={group} enabled={aberto} base={basesDosGrupos[gi]} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Passo da entrada escalonada, limitado para um módulo grande (Licitações
 *  tem ~30 submódulos) não levar um segundo e meio para terminar de abrir. */
const PASSO_MAX = 14;
const passo = (n: number) => Math.min(n, PASSO_MAX);

/**
 * Atraso de entrada do item, já como string de CSS.
 *
 * Antes isto era `--i` + `animation-delay: calc(60ms + var(--i) * 38ms)`.
 * O problema é que um `--i` inválido (ex.: "3px", que é o que acontece se o
 * valor chegar com unidade) torna o calc inteiro inválido e o navegador cai
 * para 0s — SEM erro no console. Resultado: todos os itens abrem juntos e
 * nada denuncia a causa. Escrevendo o tempo pronto, não há calc para falhar.
 *
 * Passo de 55ms contra duração de 340ms: antes eram 38ms contra 460ms, e a
 * sobreposição era tão grande que a cascata não se enxergava.
 */
const atraso = (n: number): React.CSSProperties => ({ animationDelay: `${40 + n * 55}ms` });

function SidebarGroup({ group, enabled, base }: { group: NavGroup; enabled: boolean; base: number }) {
  const location = useLocation();
  const hasActive = group.items.some(
    (i) => location.pathname === i.to || (i.to !== "/app" && location.pathname.startsWith(i.to)),
  );
  const [open, setOpen] = useState(group.defaultOpen ?? hasActive ?? false);

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        // tabIndex -1 com o módulo recolhido: o bloco continua no DOM só para
        // poder animar, e não deve receber foco por Tab enquanto está fechado.
        tabIndex={enabled ? undefined : -1}
        // `--i` do cabeçalho entra ANTES dos links do grupo: a lista aparece
        // de cima para baixo, título e itens no mesmo ritmo.
        style={atraso(passo(base))}
        className="sb-grouphd mb-0.5 flex w-full items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-muted transition-colors hover:text-white"
      >
        {/* Conflito resolvido juntando os dois lados: `whitespace-nowrap` veio
            da main (impede o rótulo do grupo de quebrar em duas linhas) e
            `sb-chev` é a classe que anima a seta. Dispensei o
            `transition-transform` do Tailwind porque a .sb-chev já define a
            transição, com curva própria — as duas juntas se anulariam. */}
        <span className="whitespace-nowrap">{group.label}</span>
        <ChevronDown className={cn("sb-chev h-3 w-3", !open && "-rotate-90")} />
      </button>
      {/* data-open leva o `enabled` junto de propósito: ao recolher o módulo,
          este bloco também precisa marcar fechado. É o que faz a entrada
          escalonada dos itens RODAR DE NOVO na próxima abertura — enquanto
          algum .sb-sub ancestral continuasse aberto, a regra da animação
          seguiria casando e o navegador não reiniciaria nada. */}
      <div className="sb-sub" data-open={open && enabled}>
        <div className="sb-sub-in">
          <ul className="space-y-0.5 pb-0.5">
            {group.items.map((item, i) => {
              // Match exato quando outro item do menu está aninhado sob esta rota
              // (ex.: "Processos" é prefixo de "/processos/dashboard" e "/processos/audiencias");
              // sem isso o item-pai acenderia junto com o filho.
              const hasNested = group.items.some((o) => o.to !== item.to && o.to.startsWith(item.to + "/"));
              return (
              // Escalona a entrada de cada link quando o grupo abre,
              // continuando a contagem de onde o cabeçalho do grupo parou.
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/app" || hasNested}
                  tabIndex={enabled && open ? undefined : -1}
                  // O atraso vai NO PRÓPRIO link, não no <li>: quem tem a
                  // animação é o `.sb-link`, e `animation-delay` não herda
                  // do pai (ao contrário da variável CSS que havia antes).
                  style={atraso(passo(base + 1 + i))}
                  className={({ isActive }) =>
                    cn(
                      // Submódulo fica branco e semibold: um degrau abaixo do
                      // cabeçalho do módulo (bold). Achatar os dois no mesmo
                      // peso apaga a hierarquia e a lista vira um paredão.
                      "sb-item sb-link group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-semibold",
                      isActive
                        ? "sb-on bg-sidebar-accent text-white"
                        : "text-white/80 hover:bg-sidebar-accent/50 hover:text-white",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="sb-bar absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-accent" />}
                      <item.icon className={cn("sb-ic mt-0.5 h-3.5 w-3.5 shrink-0 self-start", isActive ? "text-accent" : "")} />
                      {/* Quebra em duas linhas em vez de cortar com reticências:
                          "Minhas Solicitações de Ma…" esconde justamente a
                          palavra que distingue um item do outro. */}
                      <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{item.label}</span>
                      {item.dot && (
                        <span className="h-2 w-2 shrink-0 animate-pulse-soft rounded-full bg-red-500" title="Novidades" />
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
        </div>
      </div>
    </div>
  );
}
