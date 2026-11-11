import { NavLink, useLocation, useNavigate } from "react-router-dom";
import logoGN from "@/assets/logo-nascimento-icon.png";
import {
  LayoutDashboard,
  Fingerprint,
  UserCheck,
  Briefcase,
  FileText,
  Sparkles,
  ScrollText,
  Calculator,
  CheckCircle2,
  Gavel,
  FileWarning,
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
  CalendarClock,
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
  HeartPulse,
  ClipboardList,
  Bell,
  MessageCircle,
  FlaskConical,
  Bot,
  ShieldCheck,
  Shirt,
  Truck,
  Boxes,
  Move3d,
  FileClock,
  Car,
  Package,
  PlusCircle,
  UserMinus,
  UserPlus,
  CalendarCheck2,
  AlertTriangle, WandSparkles, Clock, FileSpreadsheet, GitPullRequest, X as XIcon } from "lucide-react";
import { useTemAlcada } from "@/hooks/useTemAlcada";
import { useAccessibleMenus, rotaVisivelNoMenu } from "@/hooks/useAccessibleMenus";
import { useModoExterno, rotaPermitidaExterno } from "@/hooks/useModoExterno";
import { useGradeAtivaCount } from "@/hooks/useGradeAtivaCount";
import { useChamadosNotif } from "@/hooks/useChamadosNotif";
import { useTrocaFuncaoNotif } from "@/hooks/useTrocaFuncaoNotif";
import { useJuridicoNotif } from "@/hooks/useJuridicoNotif";
import { usePrazosRecursosNotif } from "@/hooks/usePrazosRecursosNotif";
import { useReembolsoNotif } from "@/hooks/useReembolsoNotif";
import { useAprovacoesNotif } from "@/hooks/useAprovacoesNotif";
import { Inbox, FileSignature, PencilRuler, Workflow, UserX, type LucideIcon } from "lucide-react";
import { Target, MessagesSquare, KeyRound, MonitorPlay, Gauge } from "lucide-react";
import { FileX2 } from "lucide-react";
import { GitBranch, GitMerge } from "lucide-react";
import { MessageSquare } from "lucide-react";
import { Banknote } from "lucide-react";
import { Database } from "lucide-react"; // SIS-2026-0599 — Base Mestre
import { Crown, Landmark } from "lucide-react";
import { Percent } from "lucide-react";
import { FolderOpen } from "lucide-react";
import { TrendingDown } from "lucide-react";
import { Megaphone, ExternalLink } from "lucide-react";
import { Award, CalendarDays, FolderTree, PenLine, QrCode, Users } from "lucide-react";
import { CreditCard, ListTree } from "lucide-react";
import { Network, Cpu } from "lucide-react";
import { useNovidades } from "@/hooks/useNovidades";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SISTEMAS as RELATORIOS } from "@/pages/relatorios/sistemas";
import { selNovoVigente } from "@/lib/selNovo";
import { useMenuLateral } from "@/hooks/useMenuLateral";
import { ChevronLeft, PanelLeft } from "lucide-react";
import { Mail, AtSign } from "lucide-react";
import { CAIXAS_EMAIL_LIBERADAS } from "@/lib/email/caixa";
// Ícones da barra de módulos (06/11/2026) — ver ICONE_DO_MODULO.
import { Mailbox, BookOpenCheck, ReceiptText, UserSearch, Tv, Server, MonitorCog, LineChart, Activity, FileChartColumn, UsersRound } from "lucide-react";

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  badge?: string;
  // Selo "Novo" que expira sozinho: data (AAAA-MM-DD) em que a tela foi liberada. O selo
  // aparece por NOVO_DIAS (15) dias a partir dela e some depois, sem precisar de PR para remover.
  // Ao lançar uma tela de verdade, basta preencher a data de hoje.
  novoDesde?: string;
  // Bolinha de notificação (novidade). Resolvida em runtime pelo useChamadosNotif.
  notif?: "meus" | "dev" | "troca_funcao" | "juridico" | "reembolso" | "prazos_recursos";
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
  icon: LucideIcon;
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
        // SIS-2026-0599: cadastro único que alimenta os quatro resumos
        // setoriais (Financeiro, RH, Operacional e Compras). Menu próprio,
        // `implantacao.base` — quem preenche o checklist não ganha a base junto.
        { label: "Base Mestre de Contrato", to: "/app/licitacoes/implantacao/base", icon: Database },
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
        // Acompanhamento desde 14/09/2026: a aprovação da demissão voltou
        // para o Operacional.
        { label: "Solicitações de Demissão — Acompanhar", to: "/app/licitacoes/analistas/demissao", icon: UserMinus },
        // Base dos benefícios da vaga: a CCT/decreto vinculada ao posto na
        // Planilha de Custo aparece sozinha na Abertura de Vagas (mig 20261027000930).
        { label: "Convenções Coletivas e Decretos Municipais", to: "/app/licitacoes/convencoes", icon: FileText },
        { label: "Prazos, Recursos e Impugnações", to: "/app/licitacoes/prazos-recursos", icon: CalendarClock, notif: "prazos_recursos" },
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
        // SIS-2026-0562: item precisa existir AQUI (não só em app_menu) —
        // a sidebar não lê o menu do banco pra montar a navegação, só usa
        // app_menu pra decidir se o item aparece dado o acesso do usuário
        // (ver isAllowed logo abaixo). Sem esta linha, a rota funciona por
        // acesso direto mas nunca aparece pra ninguém clicar.
        // 06/10/2026 (mig 20261006000005): transcrições das reuniões dos
        // supervisores com os encarregados → dashboard de dificuldades.
        { label: "Reuniões com Encarregados", to: "/app/controladoria/reunioes-encarregados", icon: MessagesSquare, badge: "Novo" },
        // SIS-2026-0556: mesma regra do item acima — precisa existir aqui E em app_menu.
        { label: "Faturamento da Empresa", to: "/app/controladoria/faturamento-empresa", icon: TrendingUp },
        { label: "Fechamento da Empresa", to: "/app/controladoria/fechamento-empresa", icon: TrendingUp, badge: "Novo" },
        { label: "Lucratividade de Contratos", to: "/app/controladoria/lucratividade-contratos", icon: TrendingUp },
        // SIS-2026-0553: checkpoint da Controladoria antes da Lucratividade.
        { label: "Auditoria da Controladoria", to: "/app/controladoria/auditoria", icon: ListChecks },
        // SIS-2026-0807: precisa existir AQUI e em app_menu (mig 20261105001000).
        { label: "Justificativas de Valor", to: "/app/controladoria/justificativas", icon: MessagesSquare, badge: "Novo" },
        { label: "Minhas Justificativas", to: "/app/controladoria/minhas-justificativas", icon: MessagesSquare, badge: "Novo" },
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
      label: "Gestão",
      defaultOpen: true,
      items: [
        { label: "Dashboard de Compras", to: "/app/suprimentos/dashboard", icon: BarChart3, badge: "Novo" },
        // SIS-2026-0599: o que comprar para um contrato que está começando.
        { label: "Início de Contrato", to: "/app/suprimentos/inicio-de-contrato", icon: ShoppingCart },
        // SIS-2026-0769: o que saiu do estoque para cada contrato, mês a mês.
        // A linha em app_menu não basta para o item existir: a sidebar é esta
        // lista, e canSee() só FILTRA o que já está aqui. Tela nova sem linha
        // aqui fica alcançável apenas por URL direta.
        { label: "Saídas por Contrato", to: "/app/suprimentos/saidas-por-contrato", icon: FileText, novoDesde: "2026-11-03" },
      ],
    },
    {
      label: "Materiais & Catálogo",
      defaultOpen: true,
      items: [
        { label: "Catálogo de Materiais", to: "/app/suprimentos/catalogo", icon: Shirt },
        { label: "Aprovação de Catálogo", to: "/app/suprimentos/catalogo/aprovacoes", icon: ClipboardCheck },
        { label: "Pedidos de Materiais", to: "/app/suprimentos/pedidos-materiais", icon: PackageCheck },
        { label: "Separação de Pedidos", to: "/app/suprimentos/separacao", icon: PackageCheck },
        // O caminho normal é o QR code da etiqueta; o item existe para digitar
        // o protocolo quando a etiqueta não lê.
        { label: "Retirada para Entrega", to: "/app/suprimentos/retirada", icon: Car },
        { label: "Estoque & Etiquetas", to: "/app/suprimentos/estoque-etiquetas", icon: Boxes },
        { label: "Mapa 3D do Estoque", to: "/app/suprimentos/estoque-mapa", icon: Move3d },
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
        { label: "Solicitações de Manutenção", to: "/app/suprimentos/solicitacoes-manutencoes", icon: ClipboardList },
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
        { label: "Controle de Notas", to: "/app/financeiro/emissao-nf", icon: FileText },
        { label: "Emissão de NF", to: "/app/financeiro/emissao-nf/cadastro", icon: FileText },
        { label: "Validação de Notas", to: "/app/financeiro/emissao-nf/controle-notas", icon: ClipboardCheck },
        { label: "Relatório de Serviços", to: "/app/financeiro/relatorio-servicos", icon: TableProperties },
        // SIS-2026-0658: Sistema × Excel antigo, só leitura
        { label: "Conciliação da Origem (Serviços)", to: "/app/financeiro/relatorio-servicos/conciliacao-origem", icon: GitMerge },
        { label: "Cobranças", to: "/app/cobrancas", icon: Bell },
      ],
    },
    {
      label: "Operação Financeira",
      defaultOpen: true,
      items: [
        // SIS-2026-0599: resumo financeiro do contrato que vai começar.
        { label: "Início de Contrato", to: "/app/financeiro/inicio-de-contrato", icon: Banknote },
        { label: "Conferência de Ponto", to: "/app/financeiro/conferencia-ponto", icon: ClipboardCheck },
        // Ficha Financeira (29/10/2026, mig 20261029004700): tudo o que cada
        // colaborador recebeu na Senior. Nasce sem ninguém liberado.
        { label: "Ficha Financeira", to: "/app/financeiro/ficha-financeira", icon: Receipt },
        // Dashboard de Pontos (30/09/2026, mig 274): o painel do RH, com menu
        // próprio do Financeiro (financeiro_dashboard_pontos).
        { label: "Dashboard de Pontos", to: "/app/financeiro/dashboard-pontos", icon: BarChart3 },
        // Espelho das rotas de Diárias do Operacional e de Encarregados
        // (17/09/2026). Item próprio porque a permissão da sidebar é casada
        // por rota — ver o comentário da rota em App.tsx.
        { label: "Controle de Diárias", to: "/app/financeiro/diarias", icon: CalendarCheck2 },
      ],
    },
    {
      label: "Gestão Financeira",
      defaultOpen: true,
      items: [
        { label: "Fluxo de Caixa", to: "/app/financeiro/gestao-financeira/fluxo-caixa", icon: TrendingDown },
        { label: "Débito Automático", to: "/app/financeiro/gestao-financeira/debito-automatico", icon: ArrowLeftRight },
        { label: "Cartão de Crédito", to: "/app/financeiro/gestao-financeira/cartao-credito", icon: CreditCard },
        { label: "Classificar Lançamentos", to: "/app/financeiro/gestao-financeira/cartao-credito/classificar", icon: ListTree },
        // SIS-2026-0473: registra aplicações (CDB/Fundo DI/etc.) e resgates,
        // alimenta o Fluxo de Caixa igual ao Débito Automático.
        { label: "Aplicações Financeiras", to: "/app/financeiro/gestao-financeira/aplicacoes-financeiras", icon: Landmark },
        // O item saiu da sidebar no SIS-2026-0317 (menus obsoletos) e foi
        // reexposto só no Gerenciamento de Acesso (dc0d7389) — a tela
        // continuou viva e acessível só por URL. Volta aqui, na rota atual.
        { label: "Conta Garantida", to: "/app/financeiro/conta-garantida", icon: ShieldCheck },
      ],
    },
    {
      label: "Ferramentas",
      defaultOpen: true,
      items: [
        // SIS-2026-0492: as duas convivem aqui em Ferramentas (pedido do
        // usuário, "vou concentrando tudo ali") — a nova puxa o lado "Fluxo"
        // direto do Fluxo de Caixa interno; a antiga continua manual/planilha.
        { label: "Conciliação Bancária", to: "/app/financeiro/gestao-financeira/conciliacao-fluxo-caixa", icon: GitMerge },
        // SIS-2026-0658: Sistema × Excel antigo, só leitura
        { label: "Conciliação da Origem (Fluxo)", to: "/app/financeiro/gestao-financeira/conciliacao-origem-fluxo-caixa", icon: GitMerge },
        { label: "Conciliação Bancária (Planilha Manual)", to: "/app/financeiro/conciliacao-bancaria", icon: GitMerge },
        // SIS-2026-0304: Checklist de Faturamento (e a futura Solicitação
        // de Ajuste, SIS-2026-0305) ficam aqui em "Ferramentas" — decisão
        // do usuário, são módulos migrados de sistema externo, não fazem
        // parte da Gestão Financeira "nativa" do ERP.
        { label: "Checklist de Faturamento", to: "/app/financeiro/checklist-faturamento", icon: ListChecks },
        // SIS-2026-0652: veio da Controladoria; o acesso é o mesmo menu (controle-faturamento), só módulo e rota mudaram (mig 20261016000001).
        { label: "Controle de Faturamento", to: "/app/financeiro/controle-faturamento", icon: FileText },
        { label: "Solicitações de Ajuste", to: "/app/financeiro/solicitacoes-ajuste", icon: ClipboardList },
        // SIS-2026-0524: juros informado no pagamento do Malote, controle
        // de cobrança do responsável — não gera lançamento no Fluxo de Caixa.
        { label: "Controle de Juros", to: "/app/financeiro/controle-juros", icon: Percent },
        // DOC CANAA: gestão de documentos da Escola Canaã, migrada do
        // blueprint Flask legado `sistema_canaa` — módulo migrado de sistema
        // externo, por isso aqui em Ferramentas junto do Checklist/Ajustes.
        { label: "DOC CANAA", to: "/app/financeiro/doc-canaa", icon: FolderOpen },
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
    // SIS-2026-0668: exceção pedida ANTES de lançar a despesa; o N2 aprova e a senha é digitada em Criar Despesa.
    {
      label: "Exceções",
      defaultOpen: true,
      items: [
        { label: "Autorizações de Exceção", to: "/app/malote/excecao/autorizacoes", icon: ClipboardList },
        { label: "Solicitar Exceção", to: "/app/malote/excecao/solicitar", icon: KeyRound },
        { label: "Minhas Solicitações", to: "/app/malote/excecao/minhas", icon: ListChecks },
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
        { label: "Orçamento ADM e Sócios (novo)", to: "/app/malote/orcamento-adm-socios", icon: ClipboardList },
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
        // Colaboradores foi para o Operacional em 03/11/2026 (mig 20261103005100).
        // SIS-2026-0599: dimensionamento de pessoas do contrato novo.
        { label: "Início de Contrato", to: "/app/rh/inicio-de-contrato", icon: Database },
        { label: "Novas Admissões", to: "/app/rh/novas-admissoes", icon: ClipboardCheck },
        // "Alocações em Contratos" e "Folha de Pagamento" saíram em
        // 04/09/2026. Eram as duas telas genéricas que sobraram do modelo
        // antigo (tabelas `alocacao_colaborador`,
        // `folha_periodo`/`folha_evento`, e o cadastro `colaborador`, que a
        // fonte única EMPREGADOS substituiu). Menus desativados na migration
        // 20260930000053; as tabelas continuam no banco.
        { label: "Gestão de Férias", to: "/app/rh/ferias", icon: CalendarRange },
        { label: "Solicitações de Demissão", to: "/app/rh/solicitacoes-demissao", icon: UserMinus },
        // Rescisões (22/10/2026, mig 20261022000400): a planilha de rescisão do
        // RH. Foi módulo próprio com kanban por um dia (21/10); voltou para
        // cá a pedido — "não pode ter um módulo só pra rescisões". A linha
        // nasce quando o RH libera a demissão no item de cima.
        { label: "Rescisões", to: "/app/rh/rescisoes", icon: FileX2 },
        // Documentos solicitados aos encarregados, até voltarem assinados (mig 20261019000040).
        { label: "Documentos", to: "/app/rh/documentos", icon: FileSignature },
        { label: "Conferência de Ponto", to: "/app/rh/conferencia-ponto", icon: ClipboardCheck },
        // "Dashboard de Pontos" desde 30/09/2026 (antes dois itens com o mesmo
        // nome "Conferência de Ponto"). A mesma tela está no Financeiro e no
        // Operacional, cada um com o seu menu (mig 274).
        { label: "Dashboard de Pontos", to: "/app/rh/conferencia-ponto/painel", icon: BarChart3 },
        // Gestão de Ponto (branch local gestaoponto, mig 20261007000001): o mês
        // de cada colaborador pelas marcações da Senior.
        { label: "Gestão de Ponto", to: "/app/rh/gestao-ponto", icon: Fingerprint },
        // Extrator de Benefícios (VA/VT): veio do Financeiro em 06/11/2026
        // (mig 20261106020000) — mesmo menu, mesmas pessoas liberadas.
        { label: "Extrator de Benefícios (VA/VT)", to: "/app/rh/extrator-beneficios", icon: FileSpreadsheet },
        // Uma só, desde 02/09/2026: a etapa do RH é ALTERAR NA SENIOR. A
        // aprovação do administrativo, que era o segundo item aqui, foi para o
        // analista junto com a de contrato. A rota
        // /app/rh/troca-funcao-escritorio continua existindo para quem já tem a
        // permissão — ela só não é mais um item de menu do RH.
        { label: "Mudança de Função", to: "/app/rh/troca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
      ],
    },
    {
      // Ativos/Contratos (30/09/2026, mig 279): efetivo ativo da EMPREGADOS ×
      // QT. PESSOAS da Planilha de Custo, conferido posto a posto.
      label: "Contratos",
      defaultOpen: true,
      items: [
        // Ativos/Contratos foi para o Operacional em 03/11/2026 (mig 20261103005100).
        // Hierarquia de postos da Senior (mig 20261007000024): quem responde por quem e por qual contrato.
        { label: "Hierarquia de Postos", to: "/app/rh/hierarquia-postos", icon: Network },
        // Rateio de Despesas (mig 20261016000010, SIS-2026-0673): Jus Brasil, Senior e FGTS/Bullla/seguro/BSF/PCD/SEEAC pelo PDF.
        { label: "Rateio de Despesas", to: "/app/rh/rateio-despesas", icon: PieChart },
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
        // "Dashboard Recrutamento" (/app/rh/recrutamento/dashboard) e "Dashboard"
        // (/app/rh/recrutamento-dashboard) saíram daqui em 08/10/2026: "tem
        // muitos dashboards de recrutamento… deixa só em relatórios". Viraram
        // dois botões em Relatórios › Gestão Recrutamento; rotas e menus
        // (rh_recrutamento_dashboard, recrutamento_dashboard) seguem os mesmos.
        { label: "Gestão Recrutamento", to: "/app/rh/recrutamento", icon: UserCog },
        { label: "Banco de Talentos", to: "/app/rh/banco-talentos", icon: Users2 },
        // CPFs com restrição para contratação (mig 20261025000020) — a mesma lista do Jurídico.
        { label: "Cadastro Restritivo", to: "/app/rh/recrutamento/cadastro-restritivo", icon: UserX },
      ],
    },
    {
      // Depois da admissão (25/09/2026, mig 245): o check-in de 7/30/60/90
      // dias que o RH fazia na planilha CONTRATOS_VIGENTES.
      label: "Acompanhamento",
      defaultOpen: true,
      items: [
        { label: "Acompanhar Colaboradores", to: "/app/rh/recrutamento/acompanhar-colaboradores", icon: ClipboardCheck },
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
        // Rota PRÓPRIA (/app/encarregados/diarias), não a do Operacional, e a
        // tela renderizada é a mesma. Motivo (09/09/2026): a sidebar casa
        // permissão por ROTA, então enquanto este item apontava para
        // /app/operacional/diarias ele era governado por `operacional_diarias`
        // — um menu do módulo Operacional. Consequências, as duas ruins: no
        // Gerenciamento de Acesso a chave de Diárias só existia no bloco
        // Operacional (nunca no de Encarregados), e liberá-la fazia o módulo
        // Operacional INTEIRO brotar na sidebar do encarregado. Com menu
        // próprio (`encarregados_diarias`, migration 20260930000065), a chave
        // aparece no bloco certo e o Operacional continua invisível para quem
        // não tem menu nenhum dele.
        { label: "Controle de Diárias", to: "/app/encarregados/diarias", icon: CalendarCheck2 },
        // Envio do ponto do mês ao Operacional (mig 20261007000023) — sem
        // permissão para ninguém por enquanto (pedido de 07/10/2026).
        { label: "Conferência de Ponto", to: "/app/encarregados/conferencia-ponto", icon: ClipboardCheck },
        // Documentos que o RH pede (assinar e devolver anexado) — mig 20261019000040.
        { label: "Documentos", to: "/app/encarregados/documentos", icon: FileSignature },
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
        // Pedido de treinamento ao setor de Treinamentos (mig 20261026000910).
        { label: "Solicitar Treinamento", to: "/app/encarregados/solicitar-treinamento", icon: GraduationCap },
        { label: "Mudança de Função", to: "/app/encarregados/troca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
      ],
    },
    {
      label: "Jurídico",
      defaultOpen: true,
      items: [
        { label: "Solicitar Medida Disciplinar", to: "/app/encarregados/advertencia", icon: ShieldAlert },
        // A mesma tela da Central de Serviços, com menu próprio
        // (`encarregados_orientacoes`): o encarregado vê todas as respostas do
        // Jurídico e as próprias perguntas sem sair do módulo dele (17/09/2026).
        { label: "Orientações Jurídicas", to: "/app/encarregados/orientacoes-juridicas", icon: BookOpen },
      ],
    },
    {
      label: "Formulários",
      defaultOpen: true,
      items: [
        // Nascimento Formulários (30/09/2026, mig 276): só os formulários que a
        // Central de Serviços liberou para o setor ENCARREGADOS; o encarregado
        // responde e vê as próprias respostas, nada mais.
        { label: "Nascimento Formulários", to: "/app/encarregados/formularios", icon: ClipboardList },
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
        // Mesma solicitação de manutenção da Central de Serviços, com menu
        // próprio para que o encarregado a encontre no módulo em que trabalha.
        { label: "Solicitar Manutenção de Equipamento", to: "/app/encarregados/solicitar-manutencao-equipamento", icon: Wrench },
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

// Treinamentos — a plataforma de cursos (porta do membox, 18/09/2026).
// Volta a ser módulo próprio: com Dashboard, Alunos, Cursos e Comunicação
// ele sustenta um bloco no menu. O "Treinamentos ERP" (cards de vídeo/prova)
// continua onde estava — Encarregados e Central de Serviços —, não entra
// aqui de novo. Um item por tela, um menu por item (app_menu), como no membox.
const treinamentosModule: ModuleDef = {
  id: "treinamentos",
  label: "Treinamentos",
  description: "Plataforma de cursos, alunos e comunicação",
  icon: GraduationCap,
  basePath: "/app/treinamentos",
  status: "active",
  headerLink: "/app/treinamentos",
  groups: [
    {
      label: "Dashboard",
      defaultOpen: true,
      items: [
        { label: "Dashboard", to: "/app/treinamentos", icon: LayoutDashboard },
      ],
    },
    {
      // Pedidos dos encarregados (mig 20261026000910): aprovar, agendar, reprovar e conversar.
      label: "Solicitações",
      defaultOpen: true,
      items: [
        { label: "Solicitações de Treinamentos", to: "/app/treinamentos/solicitacoes", icon: ClipboardList },
      ],
    },
    {
      // Treinamentos presenciais por empresa/contrato (mig 20261104006000):
      // fotos, lista de presença, avaliações, satisfação e relatórios.
      label: "Por contrato",
      defaultOpen: true,
      items: [
        { label: "Treinamentos por Contrato", to: "/app/treinamentos/contratos", icon: Building2 },
        { label: "Relatórios", to: "/app/treinamentos/contratos/relatorios", icon: BarChart3 },
      ],
    },
    {
      label: "Alunos",
      defaultOpen: true,
      items: [
        { label: "Visualizar alunos", to: "/app/treinamentos/alunos", icon: Users },
        { label: "Gerenciar alunos", to: "/app/treinamentos/alunos/novo", icon: UserCog },
      ],
    },
    {
      label: "Cursos",
      defaultOpen: true,
      items: [
        { label: "Visualizar cursos", to: "/app/treinamentos/cursos", icon: BookOpen },
        { label: "Adicionar novo", to: "/app/treinamentos/cursos/novo", icon: PlusCircle },
        { label: "Comentários", to: "/app/treinamentos/cursos/comentarios", icon: MessageSquare },
        { label: "Categorias", to: "/app/treinamentos/cursos/categorias", icon: FolderTree },
        { label: "Certificados", to: "/app/treinamentos/cursos/certificados", icon: Award },
        { label: "Assinaturas", to: "/app/treinamentos/cursos/assinaturas", icon: PenLine },
      ],
    },
    {
      label: "Comunicação",
      defaultOpen: true,
      items: [
        { label: "Avisos", to: "/app/treinamentos/comunicacao/avisos", icon: Megaphone },
        { label: "Notificações", to: "/app/treinamentos/comunicacao/notificacoes", icon: Bell },
        { label: "Calendário", to: "/app/treinamentos/comunicacao/calendario", icon: CalendarDays },
      ],
    },
    {
      // Páginas públicas com QR Code (mig 20260930000268).
      label: "Campanhas",
      defaultOpen: true,
      items: [
        { label: "Campanhas", to: "/app/treinamentos/campanhas", icon: QrCode },
      ],
    },
  ],
};

// Sistemas — demandas de sistemas (kanban de 13 etapas, acesso livre)
// TV's — módulo próprio desde 07/10/2026 (mig 20261007000016). Nasceu como
// item de Sistemas (mig 20261007000012) e "não aparecia" para quem procurava
// o módulo. Mesmo arranjo dos Relatórios: o menu mudou de módulo mantendo
// código (sistemas_tvs) e rota (/app/sistemas/tvs), então as liberações
// continuam valendo.
const tvsModule: ModuleDef = {
  id: "tvs",
  label: "TV's",
  description: "TVs da empresa: conexão, playlists, relatórios e avisos",
  icon: MonitorPlay,
  basePath: "/app/sistemas/tvs",
  headerLink: "/app/sistemas/tvs",
  status: "active",
  groups: [
    {
      label: "TV's",
      defaultOpen: true,
      items: [
        { label: "Gestão das TVs", to: "/app/sistemas/tvs", icon: MonitorPlay },
        // TVs gerenciais por diretoria (mig 20261012000001, SIS-2026-0635).
        { label: "Indicadores gerenciais", to: "/app/sistemas/tvs/indicadores", icon: Gauge },
      ],
    },
  ],
};

// T.I — Mapa 3D do escritório, Construir o mapa, Inventário e Painel.
// Voltou da branch local `ti` em 20/10/2026 ("restaura TUDO da branch ti");
// tinha saído da pablo em 10/09/2026 (revert 7cb8e295). Backend recriado pelas
// migs 20261020000120..133. Os menus nascem com quem já tinha a permissão.
const tiModule: ModuleDef = {
  id: "ti",
  label: "T.I",
  description: "Infraestrutura e hardware",
  icon: Cpu,
  basePath: "/app/ti",
  status: "active",
  groups: [
    {
      label: "Infraestrutura",
      defaultOpen: true,
      items: [
        { label: "Mapa 3D", to: "/app/ti/mapa-hardware", icon: Network },
        { label: "Construir o mapa", to: "/app/ti/construir", icon: Wrench },
        { label: "Inventário", to: "/app/ti/inventario", icon: Boxes },
        { label: "Painel de T.I", to: "/app/ti/painel", icon: BarChart3 },
      ],
    },
  ],
};

const sistemasModule: ModuleDef = {
  id: "sistemas",
  label: "Sistemas",
  description: "Demandas de sistemas",
  icon: Laptop2,
  basePath: "/app/sistemas",
  status: "active",
  groups: [
    {
      // Checklist de Módulos (02/10/2026, mig 291): criação, implantação,
      // treinamento, uso por pessoa, bugs e chamados de cada módulo do ERP.
      label: "Gestão do ERP",
      defaultOpen: true,
      items: [
        { label: "Checklist de Módulos", to: "/app/sistemas/checklist-modulos", icon: ListChecks },
        // SIS-2026-0598 (mig 20261006000009): logins a criar (admissão de
        // encarregado) e de demitidos a excluir. A bolinha vem da
        // minhas_pendencias_aprovacao (mig 20261006000010).
        { label: "Logins — Admissão e Demissão", to: "/app/sistemas/logins", icon: KeyRound },
        // SIS-2026-0772 (mig 20261105040000): organizar o menu lateral — só o
        // lugar das telas, nunca a permissão. Menu "menu_lateral", módulo
        // próprio no banco para não vir de brinde com o perfil de outro módulo.
        { label: "Organizar Menu Lateral", to: "/app/sistemas/menu-lateral", icon: PanelLeft },
      ],
    },
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
        { label: "Controle de Pull Requests (PR)", to: "/app/sistemas/chamados/pull-requests", icon: GitPullRequest },
        // Bonificação coletiva por nota da equipe (05/11/2026, mig 20261105004700).
        { label: "Bonificação Coletiva", to: "/app/sistemas/bonificacao", icon: Trophy },
      ],
    },
    {
      label: "Hora Extra",
      defaultOpen: true,
      items: [
        { label: "Hora Extra", to: "/app/sistemas/hora-extra", icon: Clock },
        { label: "Dashboard de HE", to: "/app/sistemas/hora-extra/liberacao/dashboards", icon: LayoutDashboard },
        { label: "Liberação de HE", to: "/app/sistemas/hora-extra/liberacao", icon: CheckCircle2 },
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
        // Visão gerencial da qualidade das solicitações (mig 20261022000180).
        { label: "Monitoramento de Chamados", to: "/app/central-servicos/chamados/monitoramento", icon: Gauge },
        { label: "Agenda de Reunião", to: "/app/central-servicos/reunioes", icon: CalendarRange },
        { label: "Agendamento de Veículos", to: "/app/central-servicos/veiculos", icon: Car },
        // Mesma tela de Treinamentos ERP dos Encarregados, ancorada aqui: o
        // treinamento do ERP interessa a quem não é encarregado, e a única
        // porta ficava dentro do módulo deles. Menu próprio
        // (`central_servicos_treinamentos`) — liberar esta porta não abre a
        // de lá, nem o contrário.
        { label: "Treinamentos", to: "/app/central-servicos/treinamentos", icon: GraduationCap },
        // Treinamentos Sistemas (mig 273) SAIU do menu em 14/10/2026: "é a
        // mesma coisa que Treinamentos". A rota continua (ROTAS_SEMPRE_LIBERADAS)
        // só como a tela de confirmar o treinamento de um chamado — é para lá
        // que Meus Chamados e o Status da validação mandam quem recebeu.
        // Só o "Solicitar" entra no menu. Aprovação e Tipos/Limites ficam de
        // fora de propósito: são telas de poucas pessoas, alcançadas pelos
        // botões do cabeçalho da própria tela de solicitar (que só aparecem
        // para quem tem a permissão). Menu de 3 itens para 2 que quase
        // ninguém abre só empurra o resto para baixo.
        // A bolinha acende para quem tem reembolso pendente na alçada
        // (useReembolsoNotif). Fica neste item porque é o único do módulo
        // no menu — a fila de aprovação é alcançada pelo botão do cabeçalho
        // desta tela.
        { label: "Solicitar Reembolso", to: "/app/central-servicos/reembolso", icon: Receipt, notif: "reembolso" },
        // O item precisa existir AQUI, não só em app_menu: esta lista é
        // estática e o cadastro no banco decide apenas se a pessoa enxerga o
        // que já está escrito nela. Criar a tela e a permissão sem esta linha
        // deixa o menu invisível para todo mundo, inclusive para quem acabou
        // de receber o acesso — foi exatamente o que aconteceu aqui.
        { label: "Quadro de Avisos", to: "/app/central-servicos/quadro-avisos", icon: Megaphone },
      ],
    },
    {
      // Solicitações (15/09/2026): as mesmas telas do módulo Encarregados,
      // em rota própria da Central. Um menu só no banco
      // (central_servicos_solicitacoes, rota /app/central-servicos/solicitacoes)
      // governa todos os itens por prefixo — liberou, aparece o grupo inteiro.
      label: "Solicitações",
      defaultOpen: true,
      items: [
        { label: "Minhas Solicitações", to: "/app/central-servicos/solicitacoes", icon: ClipboardList },
        // A tela de vaga da Central é a da Gestão de Recrutamento (com o
        // catálogo de Suprimentos), não o card do encarregado — ficou a
        // rota antiga, /solicitar-vaga, governada pelo menu
        // central_servicos_solicitar_vaga como sempre. Mudou de grupo em
        // 15/09/2026: tinha aparecido "Solicitar Vaga" duas vezes.
        { label: "Solicitar Vaga", to: "/app/central-servicos/solicitar-vaga", icon: UserPlus },
        { label: "Solicitar Férias", to: "/app/central-servicos/solicitacoes/ferias", icon: CalendarRange },
        { label: "Solicitar Demissão", to: "/app/central-servicos/solicitacoes/demissao", icon: UserMinus },
        { label: "Mudança de Função", to: "/app/central-servicos/solicitacoes/mudanca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
        { label: "Solicitar Medida Disciplinar", to: "/app/central-servicos/solicitacoes/advertencia", icon: ShieldAlert },
        { label: "Solicitar Manutenção de Equipamento", to: "/app/central-servicos/solicitar-manutencao-equipamento", icon: Wrench },
        // 29/10/2026: a tela de Encarregados; cai no menu central_servicos_solicitacoes por prefixo.
        { label: "Solicitar Treinamento", to: "/app/central-servicos/solicitacoes/treinamento", icon: GraduationCap },
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
        // Indicadores e Presidência saíram daqui em 24/09/2026 para o módulo
        // Presidência (presidenciaModule, abaixo). Rotas e liberações de
        // acesso continuam as mesmas; só mudou onde aparecem no menu.
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

// Presidência (24/09/2026) — um lugar só com tudo em que a Helena tem ação,
// venha de que área vier: o Painel da Presidência (/app/presidencia) e as
// telas das outras áreas. Não tem permissão própria: cada item é a tela com a
// liberação que ela já tinha (quem não tem
// acesso a nenhum item não vê o módulo). Cada área de origem vira um grupo,
// para os próximos itens entrarem sem misturar assuntos.
const presidenciaModule: ModuleDef = {
  id: "presidencia",
  label: "Presidência",
  description: "Tudo em que a Presidência tem ação, reunido",
  icon: Crown,
  basePath: "/app/presidencia",
  status: "active",
  groups: [
    {
      label: "Presidência",
      defaultOpen: true,
      items: [
        // O painel próprio da Presidência (antes um link solto no topo do menu,
        // abaixo de Novidades — veio para cá em 24/09/2026). Liberação: código
        // "presidencia" em app_menu, como já era.
        { label: "Painel da Presidência", to: "/app/presidencia", icon: LayoutDashboard },
        // Desenvolvimento Chamados (29/09/2026, mig 266): chamados de sistemas
        // marcados "Enviar à Presidência" — a direção valida o desenvolvimento
        // e acompanha o treinamento. Liberação própria
        // (presidencia_chamados_dev; aprovar/devolver: _validar).
        { label: "Desenvolvimento Chamados", to: "/app/presidencia/chamados-desenvolvimento", icon: CheckCircle2 },
      ],
    },
    {
      label: "Comitê de Ética",
      defaultOpen: true,
      items: [
        // Fila da Presidência (22/09/2026): só as denúncias pós-apuração, para
        // decidir e dar seguimento sem abrir a apuração inteira. Liberação
        // própria (comite_etica_presidencia_painel) — ver 20260930000217.
        { label: "Presidência", to: "/app/comite-etica/presidencia", icon: Gavel },
        // Leitura gerencial do Comitê; liberação própria
        // (comite_etica_indicadores) — vê o painel sem ver o conteúdo dos relatos.
        { label: "Indicadores", to: "/app/comite-etica/indicadores", icon: BarChart3 },
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

// E-mail — cada um envia do próprio endereço (mig 20261106010000). As duas
// telas nascem sem ninguém: liberar em Acesso por Usuário.
const emailModule: ModuleDef = {
  id: "email",
  label: "E-mail",
  description: "Envie e-mails do seu endereço pelo ERP",
  icon: Mail,
  basePath: "/app/email",
  status: "active",
  groups: [
    {
      label: "E-mail",
      defaultOpen: true,
      items: [
        { label: "Meu E-mail", to: "/app/email", icon: Mail },
        { label: "Remetentes e histórico geral", to: "/app/email/remetentes", icon: AtSign },
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
        // Bolinha (SIS-2026-0434): fila de advertências pra aprovar/concluir — useJuridicoNotif.
        { label: "Advertências", to: "/app/juridico/advertencias", icon: Gavel, notif: "juridico" },
      ],
    },
    {
      label: "Multas e Notificações",
      defaultOpen: true,
      items: [
        { label: "Controle de Notificações", to: "/app/juridico/notificacoes", icon: FileWarning },
      ],
    },
    {
      label: "Recrutamento",
      defaultOpen: true,
      items: [
        { label: "Verificação de Candidatos", to: "/app/juridico/candidatos", icon: ClipboardCheck },
        // CPFs com restrição para contratação (mig 20261025000020) — a mesma lista do Recrutamento.
        { label: "Cadastro Restritivo", to: "/app/juridico/cadastro-restritivo", icon: UserX },
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
        // Bolinha (SIS-2026-0434): dúvidas pra aprovar/responder e complementos pendentes.
        { label: "Parecer Jurídico", to: "/app/juridico/duvidas", icon: BookOpen, notif: "juridico" },
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
      items: [
        { label: "Resumo do Grupo", to: "/app/bi", icon: BarChart3 },
        { label: "Links dos BIs", to: "/app/bi/links", icon: ExternalLink },
        // Estúdio (14/09/2026): painéis montados dentro do ERP, à mão (SQL) ou
        // por texto com a IA. Menu bi_estudio; a rota /:id é o painel aberto.
        { label: "Estúdio de BI", to: "/app/bi/estudio", icon: WandSparkles },
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
      items: [
        // SIS-2026-0599: locais, cidades e cobertura do contrato que inicia.
        { label: "Início de Contrato", to: "/app/operacional/inicio-de-contrato", icon: Building2 },
        { label: "Controle de Diárias", to: "/app/operacional/diarias", icon: CalendarCheck2 },
        // Efetividade e Coberturas (branch local efetividade, mig 20261008000030):
        // quem faltou pelo ponto da Senior e o acionamento de diaristas. As 5
        // telas ficam em abas dentro dela; menu ope_efetividade.
        { label: "Efetividade e Coberturas", to: "/app/operacional/efetividade", icon: UserCheck },
      ],
    },
    {
      // Vieram do RH em 03/11/2026 (mig 20261103005100), a pedido do Pablo:
      // centralizar no Operacional. Mesmos códigos de menu (colaboradores,
      // rh_ativos_contratos) — quem tinha acesso continua tendo.
      label: "Efetivo",
      defaultOpen: true,
      items: [
        { label: "Colaboradores", to: "/app/operacional/colaboradores", icon: Users2 },
        // Ativos/Contratos (30/09/2026, mig 279): efetivo × Planilha de Custo, e atestados por dia (03/11/2026).
        { label: "Ativos/Contratos", to: "/app/operacional/ativos-contratos", icon: ClipboardCheck },
      ],
    },
    {
      // Indicadores (09/11/2026, migs 20261109002000 e 20261109003300): as
      // 5 telas do protótipo, na ordem dele.
      label: "Indicadores",
      defaultOpen: true,
      items: [
        { label: "Painel Executivo", to: "/app/operacional/indicadores/painel-executivo", icon: BarChart3 },
        { label: "Faturamento e Recebimentos", to: "/app/operacional/indicadores/faturamento-recebimentos", icon: Receipt },
        { label: "Lucratividade e Orçamento", to: "/app/operacional/indicadores/lucratividade-orcamento", icon: TrendingUp },
        { label: "Pessoas e Capacidade", to: "/app/operacional/indicadores/pessoas-capacidade", icon: Users2 },
        { label: "Kaizen e Efetividade", to: "/app/operacional/indicadores/kaizen-efetividade", icon: ClipboardCheck },
        // Indicadores por Contrato (11/11/2026, mig 20261111100000): os 7 da Gerência Operacional por contrato.
        { label: "Indicadores por Contrato", to: "/app/operacional/indicadores/contratos", icon: Building2 },
      ],
    },
    {
      label: "Recrutamento e Seleção",
      defaultOpen: true,
      items: [
        // Acompanhamento, não decisão (02/09/2026): quem aprova é o analista,
        // em Licitações › Analistas Validações. O rótulo diz isso para a
        // pessoa não abrir a tela procurando um botão que saiu.
        // Sem o "— Acompanhar" (pedido do Pablo, 17/09/2026): só o título.
        { label: "Gestão Recrutamento", to: "/app/operacional/recrutamento", icon: UserCog },
      ],
    },
    {
      label: "Recursos Humanos",
      defaultOpen: true,
      items: [
        // A aprovação da demissão voltou para cá em 14/09/2026 (ficou com o
        // analista entre 02/09 e 14/09).
        { label: "Solicitações de Demissão", to: "/app/operacional/solicitacoes-demissao", icon: UserMinus },
        { label: "Conferência de Ponto", to: "/app/operacional/conferencia-ponto", icon: ClipboardCheck },
        // Dashboard de Pontos (30/09/2026, mig 274): menu operacional_dashboard_pontos.
        { label: "Dashboard de Pontos", to: "/app/operacional/dashboard-pontos", icon: BarChart3 },
        { label: "Mudança de Função", to: "/app/operacional/troca-funcao", icon: ArrowLeftRight, notif: "troca_funcao" },
        // Orientações Jurídicas (25/09/2026, mig 244): a pergunta do encarregado
        // chega aqui antes do Jurídico — responde ou encaminha.
        { label: "Orientações Jurídicas", to: "/app/operacional/orientacoes-juridicas", icon: Scale },
        // Advertências passaram pelo Operacional só em 15/09/2026 (mig 117);
        // em 16/09 voltaram a ser só do Jurídico, com aprovador pelo Acesso
        // por Usuário (mig 124).
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
    {
      // Atestados + telemedicina com lotação automática e impacto financeiro (mig 20261029001750).
      label: "Saúde ocupacional",
      defaultOpen: true,
      items: [
        { label: "Afastamentos e Telemedicina", to: "/app/sst/afastamentos", icon: HeartPulse },
        { label: "Controle de Afastamentos", to: "/app/sst/controle-afastamentos", icon: ClipboardList },
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
        { label: "Mudança de Função", to: "/app/diretoria/troca-funcao-escritorio", icon: ArrowLeftRight, notif: "troca_funcao" },
        // Diretoria (16/09/2026): demissão e vaga do escritório / com setor
        // só aparecem aqui; aprovadas, seguem pro RH e pro Recrutamento.
        { label: "Solicitações de Demissão", to: "/app/diretoria/solicitacoes-demissao", icon: UserMinus },
        { label: "Gestão Recrutamento", to: "/app/diretoria/recrutamento", icon: Users2 },
        // O mesmo Dashboard de Recrutamento do RH, com menu próprio (17/09/2026).
        { label: "Dashboard de Recrutamento", to: "/app/diretoria/recrutamento-dashboard", icon: BarChart3 },
      ],
    },
  ],
};

// Relatórios — módulo próprio desde 07/10/2026 (mig 20261007000010). Era um
// grupo dentro da Diretoria (mig 20261005000006); o Pablo pediu "módulo real
// separado, as permissões também". Os menus mudaram de módulo mantendo os
// códigos (diretoria_rel_*), então quem tinha acesso continua tendo — agora
// listado em Acesso por Usuário › Relatórios.
const relatoriosModule: ModuleDef = {
  id: "relatorios",
  label: "Relatórios",
  description: "Relatórios de todos os sistemas de solicitação, quadro e turn-over",
  icon: BarChart3,
  basePath: "/app/relatorios",
  headerLink: "/app/relatorios",
  status: "active",
  groups: [
    {
      label: "Relatórios",
      defaultOpen: true,
      items: [
        { label: "Relatório Geral", to: "/app/relatorios", icon: BarChart3 },
        ...RELATORIOS.map((s) => ({ label: s.titulo, to: `/app/relatorios/${s.slug}`, icon: s.icone })),
        { label: "Vagas — Dashboard", to: "/app/relatorios/vagas", icon: Briefcase },
        // Mig 20261021000060: o desconto de faltas das notas fiscais, por contrato.
        { label: "Custo das Faltas por Contrato", to: "/app/relatorios/custo-faltas", icon: TrendingDown },
      ],
    },
  ],
};

// Organograma (30/09/2026, mig 277): módulo próprio, separado dos demais —
// quem é quem e quem reporta a quem, montado com os usuários do ERP (foto,
// nome e função). Liberação: código "organograma" em app_menu (visualizar;
// incluir/alterar montam; excluir tira pessoa).
const organogramaModule: ModuleDef = {
  id: "organograma",
  label: "Organograma",
  description: "Quem é quem na empresa, com foto, nome e função",
  icon: Network,
  basePath: "/app/organograma",
  headerLink: "/app/organograma",
  status: "active",
  groups: [
    {
      label: "Organograma",
      defaultOpen: true,
      items: [
        { label: "Organograma", to: "/app/organograma", icon: Network },
        // Movimentações e feedbacks por contrato/setor (mig 20261104009000).
        { label: "Dashboard de Gestão", to: "/app/organograma/gestao", icon: ClipboardList },
        { label: "Tarefas por Função", to: "/app/organograma/tarefas", icon: ListChecks },
        // Estrutura de Setores e Processos (mig 20261020000060): o organograma
        // das atividades — setores, equipe do gerente ao jovem, processos e as
        // ligações entre setores. O Geral lê a última publicação; o Cadastro edita.
        { label: "Estrutura e Processos", to: "/app/organograma/processos", icon: Workflow },
        { label: "Cadastro da Estrutura", to: "/app/organograma/processos/cadastro", icon: PencilRuler },
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
  relatoriosModule,
  fiscalModule,
  contabilModule,
  rhModule,
  recrutamentoModule,
  encarregadosModule,
  operacionalModule,
  sistemasModule,
  tiModule,
  tvsModule,
  juridicoModule,
  sstModule,
  centralServicosModule,
  comiteEticaModule,
  presidenciaModule,
  organogramaModule,
  treinamentosModule,
  whatsappModule,
  // Desligado para todos por ora — ver CAIXAS_EMAIL_LIBERADAS (lib/email/caixa.ts).
  ...(CAIXAS_EMAIL_LIBERADAS ? [emailModule] : []),
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
export const NAV_MODULOS_ORIGEM: ModuleDef[] = [...erpModules, buildPlanoAcoesModule(false)];
// SIS-2026-0772 (fase 2): este é o CATÁLOGO das telas. Onde cada uma aparece
// no menu vem da organização salva em Sistemas › Organizar Menu Lateral
// (useMenuLateral); sem organização salva, valem estes módulos em ordem
// alfabética. O agrupamento fixo por departamentos (fase 1) saiu a pedido.
export const NAV_MODULOS: ModuleDef[] = NAV_MODULOS_ORIGEM;
export type { ModuleDef as NavModuleDef, NavItem as NavItemDef };

/**
 * Ícone de cada módulo NA BARRA LATERAL (06/11/2026, pedido do Pablo: "ícones
 * empresariais bonitos em cada módulo"). O modelo 2 do Iury (SIS-2026-0772)
 * tinha tirado o ícone da barra expandida; ele volta, num quadradinho.
 *
 * Mapa à parte, e não troca do `icon` dos ModuleDef, de propósito: o `icon`
 * do catálogo também desenha o Início ("Todos os módulos") e outras telas, e
 * aqui só se quer afinar a leitura da barra — vários módulos repetiam ícone
 * (HardHat em SST e Encarregados, BarChart3 em BI e Relatórios). Módulo fora
 * do mapa (novo, ou criado pela organização salva) cai no `icon` dele.
 */
const ICONE_DO_MODULO: Record<string, LucideIcon> = {
  licitacoes: Gavel,
  controladoria_orc: Calculator,
  suprimentos: ShoppingCart,
  financeiro: Wallet,
  malote: Mailbox,
  contabil: BookOpenCheck,
  fiscal: ReceiptText,
  rh: UsersRound,
  recrutamento: UserSearch,
  encarregados: ClipboardCheck,
  treinamentos: GraduationCap,
  tvs: Tv,
  ti: Server,
  sistemas: MonitorCog,
  central_servicos: Headset,
  comite_etica: ShieldAlert,
  presidencia: Crown,
  whatsapp: MessageCircle,
  juridico: Scale,
  bi: LineChart,
  operacional: Activity,
  sst: HardHat,
  diretoria: Building2,
  relatorios: FileChartColumn,
  organograma: Network,
  "plano-acoes": Target,
};
const iconeDoModulo = (mod: ModuleDef): LucideIcon => ICONE_DO_MODULO[mod.id] ?? mod.icon;

/** Quadradinho do ícone de um item de primeiro nível. `on`: "ativo" (rota
 *  atual, laranja cheio), "aberto" (só o painel aberto nele) ou nada. */
function Tile({ icon: Icon, on, grande }: { icon: LucideIcon; on?: "ativo" | "aberto" | false | ""; grande?: boolean }) {
  return (
    <span className={cn("sb-tile", grande && "sb-tile-lg")} data-on={on || undefined} aria-hidden>
      <Icon className={grande ? "h-5 w-5" : "h-[15px] w-[15px]"} strokeWidth={2} />
    </span>
  );
}

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
  // SIS-2026-0309: contador do sidebar passa a somar a grade ativa de
  // todas as empresas do grupo, não só a empresa "ativa" do seletor.
  const { data: gradeAtivaCount } = useGradeAtivaCount(null, { todasEmpresas: true });
  const chamadosNotif = useChamadosNotif();
  const trocaFuncaoNotif = useTrocaFuncaoNotif();
  const juridicoNotif = useJuridicoNotif();
  const prazosRecursosNotif = usePrazosRecursosNotif();
  const reembolsoNotif = useReembolsoNotif();
  // 06/10/2026 (mig 20261006000006): aprovação parada esperando a pessoa —
  // Malote, Recrutamento, Demissões, Plano de Ações, Suprimentos. Vem por
  // rota, então acende qualquer item cujo link tenha pendência, sem precisar
  // marcar `notif` item a item.
  const aprovacoesNotif = useAprovacoesNotif();
  // Contador das Novidades do Sistema: o mesmo número da bolinha do topo.
  const { naoLidasCount: novidadesNaoLidas } = useNovidades();

  // Organização salva (ou o padrão). Só decide ONDE cada tela aparece; quem
  // vê cada uma continua sendo o canSee abaixo, pela rota.
  const allModules = useMenuLateral<NavItem, ModuleDef>(NAV_MODULOS);

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
    // Mesma regra do RouteGuard: NEGA POR PADRÃO. A sidebar não pode listar o
    // que a rota vai barrar — item visível que dá "Acesso negado" ao clicar é
    // pior do que item ausente.
    return rotaVisivelNoMenu(to, access);
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
      (aprovacoesNotif.porRota[item.to] ?? 0) > 0 ? true
      : item.notif === "meus" ? chamadosNotif.meus
      : item.notif === "dev" ? chamadosNotif.dev
      : item.notif === "troca_funcao" ? (trocaFuncaoNotif.porRota[item.to] ?? false)

      : item.notif === "juridico" ? (juridicoNotif.porRota[item.to] ?? false)
      : item.notif === "prazos_recursos" ? prazosRecursosNotif
      : item.notif === "reembolso" ? reembolsoNotif.temPendente
      : false;
    // Ordem: a da organização salva. Sem organização salva, o padrão já vem
    // em ordem alfabética (pt-BR, ignorando acentos) em todos os níveis —
    // ver estruturaPadrao em src/lib/menuLateral/estrutura.ts.
    return base.map((mod) => ({
      ...mod,
      badge: resolvedBadge(mod.badge),
      groups: mod.groups?.map((g) => ({
        ...g,
        items: g.items.map((item) => ({
          ...item,
          badge: selNovoVigente(item.novoDesde) ? "Novo" : resolvedBadge(item.badge),
          dot: resolvedDot(item),
        })),
      })),
    }));
  }, [allModules, canSee, gradeAtivaCount, chamadosNotif.meus, chamadosNotif.dev, trocaFuncaoNotif, juridicoNotif, prazosRecursosNotif, reembolsoNotif.temPendente, aprovacoesNotif]);

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

  // SIS-2026-0772 (modelo 2 do Iury): os submódulos abrem num PAINEL à
  // direita da barra, não mais em acordeão para baixo. `painel` é o módulo
  // aberto — no desktop, o painel ao lado; no celular (drawer), a lista de
  // submódulos que toma o lugar da lista de módulos, com "‹ Voltar".
  const telaGrande = useTelaGrande();
  const [painel, setPainel] = useState<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const primeiroLinkRef = useRef<HTMLAnchorElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const moduloAberto = visibleModules.find((m) => m.id === painel) ?? null;

  const cancelarTimer = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = undefined; };
  // Pequeno atraso nos dois sentidos: atravessar a barra com o mouse não
  // abre painel de tudo que passa, e o vão até o painel não o fecha.
  const abrirComAtraso = (id: string) => {
    if (!telaGrande) return;
    cancelarTimer();
    timer.current = window.setTimeout(() => setPainel(id), painel ? 60 : 140);
  };
  const fecharComAtraso = () => {
    if (!telaGrande) return;
    cancelarTimer();
    timer.current = window.setTimeout(() => setPainel(null), 220);
  };
  useEffect(() => () => cancelarTimer(), []);

  // Navegou: fecha o painel do desktop. No celular o drawer fecha sozinho
  // (handleNavClick) e a lista volta para os módulos na próxima abertura.
  useEffect(() => { if (telaGrande) setPainel(null); }, [location.pathname, telaGrande]);
  useEffect(() => { if (!mobileOpen && !telaGrande) setPainel(null); }, [mobileOpen, telaGrande]);

  // Clique fora da barra (e do painel, que é filho dela) fecha.
  useEffect(() => {
    if (!painel || !telaGrande) return;
    const fora = (e: MouseEvent) => {
      if (asideRef.current && !asideRef.current.contains(e.target as Node)) setPainel(null);
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [painel, telaGrande]);

  // Saída animada do painel (06/11/2026): ao fechar, o último módulo fica
  // montado ~180 ms com data-estado="fechando" para a animação de saída
  // tocar — desmontar na hora cortaria no primeiro frame. Depende do ID, e
  // não do objeto: visibleModules é recriado a cada notificação que chega.
  const [moduloSaindo, setModuloSaindo] = useState<ModuleDef | null>(null);
  const ultimoAberto = useRef<ModuleDef | null>(null);
  ultimoAberto.current = moduloAberto ?? ultimoAberto.current;
  const idAberto = moduloAberto?.id ?? null;
  useEffect(() => {
    if (idAberto) { setModuloSaindo(null); return; }
    const saindo = ultimoAberto.current;
    if (!saindo) return;
    ultimoAberto.current = null;
    setModuloSaindo(saindo);
    const t = window.setTimeout(() => setModuloSaindo(null), 180);
    return () => window.clearTimeout(t);
  }, [idAberto]);
  const moduloNoPainel = moduloAberto ?? moduloSaindo;

  const focarPainel = () => window.setTimeout(() => primeiroLinkRef.current?.focus(), 0);

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
      ref={asideRef}
      onClick={handleNavClick}
      className={cn(
        // Mobile: drawer fixo off-canvas; desktop: fixo no viewport, independente do scroll da página.
        // Sombra só aberta: fechada, a gaveta fora da tela vazava uma faixa
        // escura na borda esquerda de todo celular.
        "fixed inset-y-0 left-0 z-50 flex h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 ease-out",
        "w-[min(86vw,320px)]",
        mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full",
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
        <button
          type="button"
          onClick={onMobileClose}
          aria-label="Fechar menu"
          className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white/80 hover:bg-white/10 lg:hidden"
        >
          <XIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Início global */}
      <div className="relative z-10 px-2 pt-3">
        <NavLink
          to="/app"
          end
          className={({ isActive }) =>
            cn(
              "sb-item flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-semibold",
              isActive
                ? "sb-on bg-sidebar-accent text-white"
                : "text-white/85 hover:bg-sidebar-accent/60 hover:text-white",
              collapsed && "justify-center px-2",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="sb-bar absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
              <Tile icon={Home} on={isActive && "ativo"} />
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
              "sb-item mt-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-semibold",
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
              {isActive && <span className="sb-bar absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
              <Tile icon={Megaphone} on={isActive && "ativo"} />
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

        {/* "Painel da Presidência" (/app/presidencia) saiu daqui em 24/09/2026:
            agora é o primeiro item do módulo Presidência (presidenciaModule). */}

        {temAlcada && (
          <NavLink
            to="/app/aprovacoes/inbox"
            className={({ isActive }) =>
              cn(
                "sb-item mt-0.5 flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-semibold",
                isActive
                  ? "sb-on bg-sidebar-accent text-white"
                  : "text-white/85 hover:bg-sidebar-accent/60 hover:text-white",
                collapsed && "justify-center px-2",
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && <span className="sb-bar absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
                <Tile icon={Inbox} on={isActive && "ativo"} />
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
        <p className="relative z-10 mt-4 flex items-center gap-2 px-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
          <span>Módulos do ERP</span>
          <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-sidebar-border to-transparent" />
        </p>
      )}

      <nav className="sb-scroll relative z-10 mt-2 flex-1 overflow-y-auto px-2 py-1">
        {!telaGrande && moduloAberto ? (
          <ListaSubmodulosMobile mod={moduloAberto} onVoltar={() => setPainel(null)} />
        ) : (
          visibleModules.map((mod) => (
            <ModuloLinha
              key={mod.id}
              mod={mod}
              collapsed={collapsed && telaGrande}
              active={mod.id === activeModuleId}
              aberto={painel === mod.id}
              onClick={() => { cancelarTimer(); setPainel((cur) => (cur === mod.id ? null : mod.id)); }}
              onMouseEnter={() => abrirComAtraso(mod.id)}
              onMouseLeave={fecharComAtraso}
              onAbrirPeloTeclado={() => { cancelarTimer(); setPainel(mod.id); if (telaGrande) focarPainel(); }}
            />
          ))
        )}
      </nav>

      {telaGrande && moduloNoPainel && (
        <PainelSubmodulos
          mod={moduloNoPainel}
          ativo={moduloNoPainel.id === activeModuleId}
          fechando={!moduloAberto}
          primeiroLinkRef={primeiroLinkRef}
          onMouseEnter={cancelarTimer}
          onMouseLeave={fecharComAtraso}
          onFechar={() => {
            const id = moduloNoPainel.id;
            setPainel(null);
            window.setTimeout(() => asideRef.current?.querySelector<HTMLButtonElement>(`[data-modulo="${CSS.escape(id)}"]`)?.focus(), 0);
          }}
        />
      )}

      {/* Configurações + ambiente */}
      <div className="relative z-10 border-t border-sidebar-border p-2">
        {/* Encarregado externo nunca administra nada: o link levava direto
            pra tela de "Acesso negado" do RouteGuard. Fica fora do menu dele. */}
        {!externo && (
        <NavLink
          // Só "PODE TROCAR A SENHA" e sem a Administração (20/10/2026, mig
          // 20261020000100): o escritório que redefine a senha dos
          // encarregados cai direto na tela enxuta, que é TUDO o que ele vê
          // em Configurações. Quem enxerga a Administração segue para ela.
          to={!canSee("/app/administracao") && canSee("/app/senhas-encarregados") ? "/app/senhas-encarregados" : "/app/administracao"}
          className={({ isActive }) =>
            cn(
              "sb-item flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-semibold",
              isActive
                ? "sb-on bg-sidebar-accent text-white"
                : "text-white/85 hover:bg-sidebar-accent/60 hover:text-white",
              collapsed && "justify-center px-2",
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="sb-bar absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
              <Tile icon={Settings} on={isActive && "ativo"} />
              {!collapsed && <span>Configurações do ERP</span>}
            </>
          )}
        </NavLink>
        )}
        {!collapsed && (
          <div className="mt-2 hidden items-center gap-2.5 rounded-lg border border-white/5 bg-gradient-to-r from-success/10 to-sidebar-accent/30 px-2.5 py-2 lg:flex">
            <span className="sb-live h-2 w-2 rounded-full bg-success shadow-[0_0_8px_hsl(var(--success)/0.8)]" />
            <span className="text-[11px] font-medium text-sidebar-foreground/75">Ambiente Produção</span>
          </div>
        )}
      </div>
    </aside>
  );
}

/** Desktop = a partir do `lg` (1024 px), o mesmo ponto em que o drawer vira barra fixa. */
function useTelaGrande() {
  const consulta = "(min-width: 1024px)";
  const [grande, setGrande] = useState(() => typeof window !== "undefined" && window.matchMedia(consulta).matches);
  useEffect(() => {
    const m = window.matchMedia(consulta);
    const mudou = () => setGrande(m.matches);
    m.addEventListener("change", mudou);
    mudou();
    return () => m.removeEventListener("change", mudou);
  }, []);
  return grande;
}

/**
 * Linha do módulo na barra. Passar o mouse ou clicar abre o painel de
 * submódulos à direita; Enter ou → abrem pelo teclado.
 *
 * 06/11/2026: o ícone (ICONE_DO_MODULO) voltou também na barra EXPANDIDA,
 * num quadradinho à esquerda do nome — o modelo 2 do Iury (SIS-2026-0772)
 * tinha só o nome, e o Pablo pediu ícone em cada módulo. Recolhida (172 px)
 * segue só o ícone, com o nome no title.
 */
function ModuloLinha({
  mod, collapsed, active, aberto, onClick, onMouseEnter, onMouseLeave, onAbrirPeloTeclado,
}: {
  mod: ModuleDef;
  collapsed: boolean;
  active: boolean;
  aberto: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onAbrirPeloTeclado: () => void;
}) {
  const disabled = mod.status === "soon";
  // Bolinha no módulo quando algum submódulo tem novidade: o painel fechado
  // não pode esconder que há algo esperando.
  const modDot = !disabled && !!mod.groups?.some((g) => g.items.some((i) => i.dot));

  return (
    <button
      type="button"
      data-modulo={mod.id}
      disabled={disabled}
      aria-expanded={aberto}
      aria-haspopup="true"
      onClick={onClick}
      onMouseEnter={disabled ? undefined : onMouseEnter}
      onMouseLeave={disabled ? undefined : onMouseLeave}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); onAbrirPeloTeclado(); }
      }}
      title={collapsed ? mod.label : undefined}
      className={cn(
        "sb-item group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm font-semibold",
        active || aberto
          ? "sb-on bg-sidebar-accent text-white"
          : disabled
            ? "cursor-not-allowed text-sidebar-muted/70"
            : "text-white/85 hover:bg-white/[0.05] hover:text-white",
        collapsed && "justify-center px-2",
      )}
    >
      {active && <span className="sb-bar absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
      <span className={cn("relative shrink-0", disabled && "opacity-60")}>
        <Tile icon={iconeDoModulo(mod)} on={active ? "ativo" : aberto ? "aberto" : false} />
        {modDot && collapsed && (
          <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse-soft rounded-full bg-red-500 ring-2 ring-sidebar" />
        )}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{mod.label}</span>
          {modDot && <span className="h-2 w-2 shrink-0 animate-pulse-soft rounded-full bg-red-500" title="Novidades" />}
          {mod.badge && !disabled && (
            <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-sidebar-foreground/70">{mod.badge}</span>
          )}
          {disabled ? (
            <span className="rounded bg-sidebar-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sidebar-muted">Em breve</span>
          ) : (
            <ChevronRight className={cn("sb-chev h-3.5 w-3.5 shrink-0 text-sidebar-muted", aberto && "text-accent")} />
          )}
        </>
      )}
    </button>
  );
}

/** Quantas telas o módulo mostra para ESTA pessoa (os grupos já chegam filtrados pelo acesso). */
const totalDeTelas = (mod: ModuleDef) => (mod.groups ?? []).reduce((n, g) => n + g.items.length, 0);

/** Cabeçalho do módulo no painel/lista: ícone grande, nome, descrição e contagem. */
function CabecalhoModulo({ mod, ativo }: { mod: ModuleDef; ativo: boolean }) {
  const total = totalDeTelas(mod);
  return (
    <div className="sb-cai flex items-center gap-3" style={atraso(0)}>
      <Tile icon={iconeDoModulo(mod)} on={ativo ? "ativo" : "aberto"} grande />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-base font-bold leading-tight text-white">{mod.label}</p>
        <p className="mt-0.5 truncate text-[11px] text-sidebar-muted" title={mod.description}>
          {total} {total === 1 ? "tela" : "telas"}
          {mod.description ? ` · ${mod.description}` : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * Painel à direita da barra (desktop): cabeçalho do módulo, categorias e
 * submódulos. Entra deslizando de trás da barra (.sb-flyout, CSS puro) e o
 * conteúdo cai em cascata; trocar de módulo com ele aberto não refaz o
 * deslize, só a cascata (key no conteúdo). `fechando` = saída tocando.
 */
function PainelSubmodulos({
  mod, ativo, fechando, primeiroLinkRef, onMouseEnter, onMouseLeave, onFechar,
}: {
  mod: ModuleDef;
  ativo: boolean;
  fechando: boolean;
  primeiroLinkRef: React.RefObject<HTMLAnchorElement>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFechar: () => void;
}) {
  return (
    <div
      role="region"
      aria-label={`Submódulos de ${mod.label}`}
      aria-hidden={fechando || undefined}
      data-estado={fechando ? "fechando" : "aberto"}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onKeyDown={(e) => {
        if (e.key === "Escape" || e.key === "ArrowLeft") { e.preventDefault(); onFechar(); }
      }}
      className="sb-flyout absolute inset-y-0 left-full z-40 flex w-[272px] flex-col border-r border-sidebar-border text-sidebar-foreground"
    >
      <div key={mod.id} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-sidebar-border px-4 pb-4 pt-5">
          <CabecalhoModulo mod={mod} ativo={ativo} />
        </div>
        {/* sb-scroll (06/11/2026): sem a barra de rolagem, igual à lista
            principal — rola pela roda do mouse, toque e teclado. */}
        <div className="sb-scroll flex-1 overflow-y-auto px-3 py-3">
          <GruposDoModulo mod={mod} primeiroLinkRef={primeiroLinkRef} desativado={fechando} />
        </div>
      </div>
    </div>
  );
}

/** Celular (drawer): a lista de submódulos toma o lugar da lista de módulos. */
function ListaSubmodulosMobile({ mod, onVoltar }: { mod: ModuleDef; onVoltar: () => void }) {
  // A lista de módulos herdava a rolagem: abrir um módulo do fim da lista
  // deixava o "‹ Voltar" e o cabeçalho escondidos lá em cima.
  const voltarRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { voltarRef.current?.scrollIntoView({ block: "nearest" }); }, [mod.id]);
  return (
    <div>
      <button
        ref={voltarRef}
        type="button"
        onClick={onVoltar}
        className="sb-item mb-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-white/80 hover:bg-white/[0.05] hover:text-white"
      >
        <ChevronLeft className="h-4 w-4" /> Voltar
      </button>
      <div className="mb-3 px-2">
        <CabecalhoModulo mod={mod} ativo={false} />
      </div>
      <GruposDoModulo mod={mod} />
    </div>
  );
}

/** Passo da cascata, limitado: Licitações tem ~30 submódulos e não pode
 *  levar um segundo e meio para terminar de aparecer. */
const PASSO_MAX = 14;
const passo = (n: number) => Math.min(n, PASSO_MAX);
/**
 * Atraso de entrada já como string de CSS. NÃO trocar por `--i` + calc():
 * um `--i` inválido (ex.: "3px") invalida o calc inteiro e o navegador cai
 * para 0 s sem erro no console — todos entram juntos e nada denuncia.
 * Passo de 40 ms contra 340 ms de duração: dá para ver a cascata descer.
 */
const atraso = (n: number): React.CSSProperties => ({ animationDelay: `${30 + n * 40}ms` });

function GruposDoModulo({ mod, primeiroLinkRef, desativado }: { mod: ModuleDef; primeiroLinkRef?: React.RefObject<HTMLAnchorElement>; desativado?: boolean }) {
  const location = useLocation();
  const rotasDoModulo = useMemo(() => (mod.groups ?? []).flatMap((g) => g.items.map((i) => i.to)), [mod.groups]);
  const rotaAcesa = rotaMaisProxima(location.pathname, rotasDoModulo);
  const primeiraRota = mod.groups?.[0]?.items[0]?.to;
  // Posição de cada grupo numa contagem contínua do módulo inteiro (o
  // cabeçalho conta 1, como uma linha): a cascata corre de cima para baixo
  // de verdade, em vez de cada grupo recomeçar do zero. O 1 inicial é o
  // cabeçalho do módulo (CabecalhoModulo, atraso 0).
  const bases = useMemo(() => {
    let cursor = 1;
    return (mod.groups ?? []).map((g) => { const b = cursor; cursor += g.items.length + 1; return b; });
  }, [mod.groups]);

  return (
    <>
      {(mod.groups ?? []).map((group, gi) => (
        <div key={`${gi}-${group.label}`} className="mb-4 last:mb-1">
          <p
            className="sb-cai flex items-center gap-2 truncate px-2 pb-1.5 text-[11.5px] font-semibold uppercase tracking-[0.1em] text-sidebar-muted"
            style={atraso(passo(bases[gi]))}
            title={group.label}
          >
            <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-accent/80" />
            <span className="truncate">{group.label}</span>
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item, ii) => {
              // Match exato quando outro item do menu está aninhado sob esta
              // rota: sem isso o item-pai acenderia junto com o filho.
              const acesa = item.to.split("?")[0] === rotaAcesa;
              const ref = gi === 0 && ii === 0 && item.to === primeiraRota ? primeiroLinkRef : undefined;
              return (
                <li key={`${ii}-${item.to}`}>
                  <NavLink
                    ref={ref}
                    to={item.to}
                    end
                    tabIndex={desativado ? -1 : undefined}
                    style={atraso(passo(bases[gi] + 1 + ii))}
                    className={cn(
                      "sb-item sb-cai flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px]",
                      acesa
                        ? "sb-on bg-sidebar-accent font-semibold text-white"
                        : "font-medium text-white/75 hover:bg-white/[0.05] hover:text-white",
                    )}
                  >
                    {acesa && <span className="sb-bar absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
                    <span className="sb-pt" aria-hidden />
                    {/* Quebra em duas linhas em vez de cortar com reticências:
                        "Minhas Solicitações de Ma…" esconde justamente a
                        palavra que distingue um item do outro. */}
                    <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{item.label}</span>
                    {item.dot && <span className="h-2 w-2 shrink-0 animate-pulse-soft rounded-full bg-red-500" title="Novidades" />}
                    {item.badge && (
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                          item.badge === "Novo" ? "bg-accent/15 text-accent" : "bg-white/10 text-sidebar-foreground/70",
                        )}
                      >
                        {item.badge}
                      </span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}

/**
 * Item aceso = a rota MAIS LONGA do módulo inteiro que casa com a URL.
 *
 * 24/09/2026: em /app/treinamentos/cursos/<id> acendia "Dashboard" (grupo
 * próprio, /app/treinamentos casava por prefixo) e "Visualizar cursos" ficava
 * apagado (tinha "end" porque "Adicionar novo" mora em /cursos/novo). O
 * "end" por grupo não enxergava os outros grupos; comparando com todas as
 * rotas do módulo, só o melhor casamento acende.
 */
function rotaMaisProxima(pathname: string, rotas: string[]): string | null {
  let melhor: string | null = null;
  for (const to of rotas) {
    const p = to.split("?")[0];
    const casa = pathname === p || (p !== "/app" && pathname.startsWith(p + "/"));
    if (casa && (!melhor || p.length > melhor.length)) melhor = p;
  }
  return melhor;
}
