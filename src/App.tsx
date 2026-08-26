import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isAuthExpiredError } from "@/lib/authErrors";
import NotFound from "./pages/NotFound.tsx";
import Login from "./pages/Login.tsx";
import TrocarSenha from "./pages/TrocarSenha.tsx";
import EsqueciSenha from "./pages/EsqueciSenha.tsx";
import RedefinirSenha from "./pages/RedefinirSenha.tsx";
import Vagas from "./pages/publico/Vagas";
import { AppShell } from "./components/layout/AppShell";
import { DemoModeProvider } from "./context/DemoModeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import PainelExecutivo from "./pages/PainelExecutivo";
import PainelExecutivoTV from "./pages/PainelExecutivoTV";
import Inicio from "./pages/Inicio";
import Novidades from "./pages/Novidades";
import Presidencia from "./pages/Presidencia";
import Pipeline from "./pages/Pipeline";
import CadastroEdital from "./pages/CadastroEdital";
import Documentos from "./pages/Documentos";
import TriagemIA from "./pages/TriagemIA";
import Parecer from "./pages/Parecer";
import Controladoria from "./pages/Controladoria";
import Aprovacoes from "./pages/Aprovacoes";
import Pregao from "./pages/Pregao";
import Resultado from "./pages/Resultado";
import ProntasContrato from "./pages/ProntasContrato";
import Historico from "./pages/Historico";
import Administracao from "./pages/Administracao";
import SmokeTestHelena from "./pages/admin/SmokeTestHelena";
import MeuPerfil from "./pages/MeuPerfil";
import DiscordCallback from "./pages/DiscordCallback";
import Composicao from "./pages/Composicao";
import CustosBDI from "./pages/CustosBDI";
import ParecerSST from "./pages/pareceres/ParecerSST";
import ParecerJuridico from "./pages/pareceres/ParecerJuridico";
import ParecerControladoria from "./pages/pareceres/ParecerControladoria";
import ParecerDiretorOperacional from "./pages/pareceres/ParecerDiretorOperacional";
import ParecerDiretorAdministrativo from "./pages/pareceres/ParecerDiretorAdministrativo";
import Implantacao from "./pages/contratos/Implantacao";
import PlanilhaCusto from "./pages/licitacoes/PlanilhaCusto";
import ContratosERP from "./pages/licitacoes/ContratosERP";
import CotacoesLicitacao from "./pages/licitacoes/CotacoesLicitacao";
import PrecosMateriais from "./pages/licitacoes/PrecosMateriais";
import ContratosAtivos from "./pages/contratos/Ativos";
import Empenhos from "./pages/contratos/Empenhos";
import Postos from "./pages/contratos/Postos";
import Faturamento from "./pages/contratos/Faturamento";
import Medicoes from "./pages/contratos/Medicoes";
import Reajustes from "./pages/contratos/Reajustes";
import Encerramentos from "./pages/contratos/Encerramentos";
import ContratoDetalhe from "./pages/contratos/ContratoDetalhe";
import { EmpresaAtivaProvider } from "./context/EmpresaAtivaContext";
import { PermissoesProvider } from "./context/PermissoesContext";
import { AuthProvider } from "./hooks/useAuth";
import Empresas from "./pages/controladoria/Empresas";
import CentrosCusto from "./pages/controladoria/CentrosCusto";
import EstruturaOrganizacional from "./pages/controladoria/EstruturaOrganizacional";
import LinhasDRE from "./pages/controladoria/DRE";
import Classificadores from "./pages/controladoria/Classificadores";
import PlanejadorOBZ from "./pages/controladoria/PlanejadorOBZ";
import Orcamento from "./pages/Orcamento";
import Fornecedores from "./pages/suprimentos/Fornecedores";
import ProdutosServicos from "./pages/suprimentos/ProdutosServicos";
import Requisicoes from "./pages/suprimentos/Requisicoes";
import PedidosCompra from "./pages/suprimentos/PedidosCompra";
import Almoxarifados from "./pages/suprimentos/Almoxarifados";
import CategoriasProduto from "./pages/suprimentos/CategoriasProduto";
import Produtos from "./pages/suprimentos/Produtos";
import Estoque from "./pages/suprimentos/Estoque";
import MovimentosEstoque from "./pages/suprimentos/MovimentosEstoque";
import NFEntrada from "./pages/suprimentos/NFEntrada";
import AprovacoesCompras from "./pages/suprimentos/AprovacoesCompras";
import Recebimentos from "./pages/suprimentos/Recebimentos";
import CotacoesCompras from "./pages/suprimentos/CotacoesCompras";
import CotacoesMalote from "./pages/suprimentos/CotacoesMalote";
import CotacaoMaloteDetalhe from "./pages/suprimentos/CotacaoMaloteDetalhe";
import PedidosCompraSupply from "./pages/suprimentos/PedidosCompraSupply";
import CatalogoMateriais from "./pages/suprimentos/CatalogoMateriais";
import CatalogoAprovacoes from "./pages/suprimentos/CatalogoAprovacoes";
import PedidosMateriais from "./pages/suprimentos/PedidosMateriais";
import EstoqueEtiquetas from "./pages/suprimentos/EstoqueEtiquetas";
import Patrimonio from "./pages/suprimentos/Patrimonio";
import PainelManutencoes from "./pages/suprimentos/PainelManutencoes";
import EpisAdmissoes from "./pages/suprimentos/EpisAdmissoes";
import SolicitarMateriais from "./pages/encarregados/SolicitarMateriais";
import MeusPedidos from "./pages/encarregados/MeusPedidos";
import SolicitarDemissao from "./pages/encarregados/SolicitarDemissao";
import OperacionalSolicitacoesDemissao from "./pages/operacional/SolicitacoesDemissao";
import ControleDiarias from "./pages/operacional/ControleDiarias";
import ContasPagar from "./pages/financeiro/ContasPagar";
import ContasReceber from "./pages/financeiro/ContasReceber";
import Cobrancas from "./pages/cobrancas/Cobrancas";
import RelatorioServicos from "./pages/financeiro/RelatorioServicos";
import FluxoCaixa from "./pages/financeiro/FluxoCaixa";
import FluxoCaixaGestao from "./pages/financeiro/FluxoCaixaGestao";
import ContaGarantida from "./pages/financeiro/ContaGarantida";
import FluxoCaixaDiario from "./pages/financeiro/FluxoCaixaDiario";
import CapitalGiro from "./pages/financeiro/CapitalGiro";
import ConciliacaoFluxoCaixa from "./pages/financeiro/ConciliacaoFluxoCaixa";
import OBZVersoes from "./pages/controladoria/OBZVersoes";
import DREGerencial from "./pages/controladoria/DREGerencial";
import OrcamentoCompleto from "./pages/controladoria/OrcamentoCompleto";
import MaloteClassificacoesAdministrativo from "./pages/malote/ClassificacoesAdministrativo";
import MaloteOrcamentoAdministrativo from "./pages/malote/OrcamentoAdministrativo";
import MaloteClassificacoesMalote from "./pages/malote/ClassificacoesMalote";
import MaloteOrcamentoContratos from "./pages/malote/OrcamentoContratos";
import MaloteOrcamentoGeral from "./pages/malote/OrcamentoGeral";
import MaloteDetalheOrcamento from "./pages/malote/DetalheOrcamento";
import GeradorPops from "./pages/controladoria/GeradorPops";
import MaloteAprovacoes from "./pages/malote/Aprovacoes";
import MalotePagamento from "./pages/malote/PagamentoMalote";
import MaloteConfiguracoes from "./pages/malote/Configuracoes";
import MaloteCriarDespesa from "./pages/malote/CriarDespesa";
import MaloteRatearClassificacao from "./pages/malote/RatearClassificacao";
import MaloteDashboard from "./pages/malote/Dashboard";
import MaloteMeusItens from "./pages/malote/MeusItens";
import MaloteDespesaVisualizar from "./pages/malote/DespesaVisualizar";
import MaloteSolicitacaoVisualizar from "./pages/malote/SolicitacaoVisualizar";
import MovimentosBancarios from "./pages/financeiro/MovimentosBancarios";
import ContasBancariasEmpresa from "./pages/financeiro/ContasBancariasEmpresa";
import IntegracaoBancaria from "./pages/financeiro/IntegracaoBancaria";
import IntegracaoBancariaBuilder from "./pages/financeiro/IntegracaoBancariaBuilder";
import ProgramacaoPagamentos from "./pages/financeiro/ProgramacaoPagamentos";
import ValidacaoPosPagamento from "./pages/financeiro/ValidacaoPosPagamento";
import ConciliacaoBancaria from "./pages/financeiro/ConciliacaoBancaria";
import EmissaoNF from "./pages/financeiro/nf-emissao/EmissaoNF";
import ControleNotas from "./pages/financeiro/controle-notas/ControleNotas";
import Lancamentos from "./pages/contabil/Lancamentos";
import PlanoContas from "./pages/contabil/PlanoContas";
import AprovacaoContas from "./pages/contabil/AprovacaoContas";
import Balancete from "./pages/contabil/Balancete";
import Razao from "./pages/contabil/Razao";
import RazaoDetalhado from "./pages/contabil/RazaoDetalhado";
import DREGerencialReal from "./pages/contabil/DREGerencialReal";
import ConciliacaoEventos from "./pages/contabil/ConciliacaoEventos";
import Folha from "./pages/rh/Folha";
import Contabilidade from "./pages/Contabilidade";
import Colaboradores from "./pages/rh/Colaboradores";
import Alocacoes from "./pages/rh/Alocacoes";
import Recrutamento from "./pages/rh/Recrutamento";
import Patrimonios from "./pages/juridico/Patrimonios";
import CentralDuvidas from "./pages/juridico/CentralDuvidas";
import Processos from "./pages/juridico/Processos";
import Advertencias from "./pages/juridico/Advertencias";
import VerificacaoCandidatos from "./pages/juridico/VerificacaoCandidatos";
import TreinamentosERP from "./pages/treinamentos/TreinamentosERP";
import SolicitarTrocaFuncao from "./pages/encarregados/SolicitarTrocaFuncao";
import OperacionalTrocaFuncao from "./pages/operacional/TrocaFuncao";
import RhTrocaFuncaoEscritorio from "./pages/rh/TrocaFuncaoEscritorio";
import SstTrocaFuncao from "./pages/sst/TrocaFuncao";
import RhTrocaFuncao from "./pages/rh/TrocaFuncao";
import AsoCandidatos from "./pages/sst/AsoCandidatos";
import NovasAdmissoes from "./pages/rh/NovasAdmissoes";
import BancoTalentos from "./pages/rh/BancoTalentos";
import RecrutamentoDashboard from "./pages/rh/RecrutamentoDashboard";
import OrientacoesJuridicas from "./pages/central-servicos/OrientacoesJuridicas";
import Formularios from "./pages/central-servicos/Formularios";
import FormularioEditor from "./pages/central-servicos/FormularioEditor";
import FormularioRespostas from "./pages/central-servicos/FormularioRespostas";
import FormulariosDashboard from "./pages/central-servicos/FormulariosDashboard";
import PainelGerencialFormularios from "./pages/central-servicos/PainelGerencial";
import FormulariosConfig from "./pages/central-servicos/FormulariosConfig";
import FormularioPublico from "./pages/publico/FormularioPublico";
import Denuncia from "./pages/publico/Denuncia";
import FornecedorCadastro from "./pages/publico/FornecedorCadastro";
import FornecedoresPendentes from "./pages/suprimentos/FornecedoresPendentes";
import DenunciasComiteEtica from "./pages/comite-etica/Denuncias";
import ConfiguracaoComiteEtica from "./pages/comite-etica/Configuracao";
import IndicadoresComiteEtica from "./pages/comite-etica/Indicadores";
import Ferias from "./pages/rh/Ferias";
import RhSolicitacoesDemissao from "./pages/rh/SolicitacoesDemissao";
import MinhasSolicitacoes from "./pages/MinhasSolicitacoes";
import BIDashboard from "./pages/bi/Dashboard";
import Fiscal from "./pages/Fiscal";
import IntegracaoBatches from "./pages/integracao/Batches";
import BatchDetalhe from "./pages/integracao/BatchDetalhe";
import IntegracaoAliases from "./pages/integracao/Aliases";
import MigracaoZero from "./pages/admin/MigracaoZero";
import PlanoAcoesLista from "./pages/plano-acoes/Lista";
import PlanoAcoesDashboard from "./pages/plano-acoes/Dashboard";
import PlanoAcoesKanban from "./pages/plano-acoes/Kanban";
import PlanoAcaoDetalhe from "./pages/plano-acoes/Detalhe";
import PlanoAcoesImportar from "./pages/plano-acoes/Importar";
import PlanoAcoesAprovacoes from "./pages/plano-acoes/Aprovacoes";

import CopilotoIA from "./pages/plano-acoes/CopilotoIA";
import Ajuda from "./pages/ajuda/Ajuda";
import AjudaTopico from "./pages/ajuda/AjudaTopico";
import InboxAprovacoes from "./pages/aprovacoes/Inbox";
import SolicitacoesErp from "./pages/sistemas/SolicitacoesErp";
import CentralServicos from "./pages/central-servicos/CentralServicos";
import MeusChamados from "./pages/chamados/MeusChamados";
import AbrirChamado from "./pages/chamados/AbrirChamado";
import PainelDistribuicaoChamados from "./pages/chamados/PainelDistribuicao";
import DashboardChamados from "./pages/chamados/DashboardChamados";
import CoordenarChamado from "./pages/chamados/CoordenarChamado";
import PainelDesenvolvedorChamados from "./pages/chamados/PainelDesenvolvedor";
import ExecutarChamado from "./pages/chamados/ExecutarChamado";
import AcompanharChamado from "./pages/chamados/AcompanharChamado";
import WhatsAppInbox from "./pages/whatsapp/WhatsAppInbox";
import WhatsAppChatbot from "./pages/whatsapp/WhatsAppChatbot";
import WhatsAppTestes from "./pages/whatsapp/WhatsAppTestes";
import WhatsAppDashboard from "./pages/whatsapp/WhatsAppDashboard";
import Reunioes from "./pages/central-servicos/reunioes/Reunioes";
import ReuniaoDetalhe from "./pages/central-servicos/reunioes/ReuniaoDetalhe";
import ConducaoReuniao from "./pages/central-servicos/reunioes/ConducaoReuniao";
import PainelGerencial from "./pages/central-servicos/reunioes/PainelGerencial";
import AgendamentoVeiculos from "./pages/central-servicos/veiculos/AgendamentoVeiculos";

// Defaults só de `queries` — mutations seguem com retry 0, porque repetir um
// insert/update às cegas duplicaria registro.
//
// Quando o token vence (aba em segundo plano, máquina que dormiu), o
// refetchOnWindowFocus e os pollings de 60s disparam uma rajada de requests com
// o token velho e tomam 401 em bloco. O backoff padrão (1s, 2s, 4s) queima as 3
// tentativas dentro da própria janela de expiração e a query morre em `error` —
// era isso que deixava a Grade presa em "Erro ao carregar: JWT expired" até o
// usuário dar F5. Para esse caso, mais tentativas e mais espaçadas, dando tempo
// do supabase-js concluir a renovação.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) =>
        isAuthExpiredError(error) ? failureCount < 5 : failureCount < 3,
      retryDelay: (failureCount, error) =>
        isAuthExpiredError(error)
          ? 2_000
          : Math.min(1_000 * 2 ** failureCount, 30_000),
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
        <DemoModeProvider>
        <PermissoesProvider>
        <EmpresaAtivaProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/trocar-senha" element={<TrocarSenha />} />
          <Route path="/esqueci-senha" element={<EsqueciSenha />} />
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          {/* Portal público de candidatura (sem login) */}
          <Route path="/vagas" element={<Vagas />} />
          {/* Portal público de resposta a formulários (sem login) */}
          <Route path="/formularios/:slug" element={<FormularioPublico />} />
          <Route path="/candidatura" element={<Navigate to="/vagas" replace />} />
          {/* Nascimento Formulários — resposta pública, sem login */}
          <Route path="/formularios/:slug" element={<FormularioPublico />} />
          {/* Cadastro que o próprio fornecedor preenche, sem login. A credencial
              é o token do convite, gerado pelo comprador (SIS-2026-0209). */}
          <Route path="/fornecedor/cadastro/:token" element={<FornecedorCadastro />} />
          {/* Canal de Ética — registro e acompanhamento de denúncia, sem login */}
          <Route path="/denuncia" element={<Denuncia />} />
          <Route path="/denuncia/acompanhar" element={<Navigate to="/denuncia?acompanhar" replace />} />
          <Route path="/app" element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route index element={<Inicio />} />
            {/* Fora de app_menu de propósito: ler novidade é para todo mundo. */}
            <Route path="novidades" element={<Novidades />} />
            <Route path="encarregados" element={<Navigate to="/app/encarregados/minhas-solicitacoes" replace />} />
            <Route path="encarregados/minhas-solicitacoes" element={<MinhasSolicitacoes />} />
            {/* Um item de sidebar por submódulo de origem (Recrutamento, RH,
                Jurídico). É a mesma tela de Minhas Solicitações, já com o
                formulário aberto — não há formulário duplicado. */}
            <Route path="encarregados/solicitar-vaga" element={<MinhasSolicitacoes abrir="vaga" />} />
            <Route path="encarregados/solicitar-ferias" element={<MinhasSolicitacoes abrir="ferias" />} />
            <Route path="encarregados/advertencia" element={<MinhasSolicitacoes abrir="advertencia" />} />
            {/* Demissão tem tela própria: são 4 passos e documentos obrigatórios,
                que não cabem no modal de Minhas Solicitações. */}
            <Route path="encarregados/solicitar-demissao" element={<SolicitarDemissao />} />
            {/* Supply — solicitação de materiais. Também é a única área que o
                usuário externo (sessão anônima) enxerga; ver useModoExterno. */}
            <Route path="encarregados/solicitar-materiais" element={<SolicitarMateriais />} />
            <Route path="encarregados/meus-pedidos" element={<MeusPedidos />} />
            {/* Chamados de Sistemas para o encarregado. São as MESMAS telas da
                Central de Serviços — o prop `base` já existia para isto —, só
                que ancoradas no módulo dele, para não obrigar quem vive em
                Encarregados a caçar a tela em outro menu. */}
            <Route path="encarregados/chamados" element={<MeusChamados base="/app/encarregados/chamados" />} />
            <Route path="encarregados/chamados/novo" element={<AbrirChamado base="/app/encarregados/chamados" />} />
            <Route path="encarregados/chamados/:id/acompanhar" element={<AcompanharChamado base="/app/encarregados/chamados" />} />
            {/* Operacional — Controle de Diárias */}
            <Route path="operacional" element={<Navigate to="/app/operacional/diarias" replace />} />
            <Route path="operacional/diarias" element={<ControleDiarias />} />
            {/* Sistemas */}
            <Route path="sistemas/solicitacoes-erp" element={<SolicitacoesErp />} />
            {/* Chamados de Sistemas (help desk) — telas de abrir/meus chamados também
                aparecem na Central de Serviços; gestão fica só aqui em Sistemas. */}
            {/* A tela do solicitante mora na Central de Serviços. Estas duas
                rotas viraram redirect em vez de sumir: link antigo e favorito
                continuam funcionando, e — mais importante — rota sem entrada em
                app_menu passa direto pelo RouteGuard (`!menuCode` libera), então
                deixá-las vivas sem menu abriria a tela para qualquer um. */}
            <Route path="sistemas/chamados" element={<Navigate to="/app/central-servicos/chamados" replace />} />
            <Route path="sistemas/chamados/novo" element={<Navigate to="/app/central-servicos/chamados/novo" replace />} />
            <Route path="sistemas/chamados/painel" element={<PainelDistribuicaoChamados />} />
            <Route path="sistemas/chamados/dashboard-tv" element={<DashboardChamados />} />
            <Route path="sistemas/chamados/dev" element={<PainelDesenvolvedorChamados />} />
            <Route path="sistemas/chamados/:id/coordenar" element={<CoordenarChamado />} />
            {/* Não vira redirect por causa do :id, que o Navigate não interpola.
                Renderiza a mesma tela, mas com o "voltar" apontando para a
                Central — o solicitante não tem mais nada em /app/sistemas. */}
            <Route path="sistemas/chamados/:id/acompanhar" element={<AcompanharChamado base="/app/central-servicos/chamados" />} />
            <Route path="sistemas/chamados/:id" element={<ExecutarChamado />} />
            {/* Central de Serviços */}
            <Route path="central-servicos" element={<CentralServicos />} />
            <Route path="central-servicos/chamados" element={<MeusChamados base="/app/central-servicos/chamados" />} />
            <Route path="central-servicos/chamados/novo" element={<AbrirChamado base="/app/central-servicos/chamados" />} />
            <Route path="central-servicos/chamados/:id/acompanhar" element={<AcompanharChamado base="/app/central-servicos/chamados" />} />
            {/* WhatsApp — Chatbot */}
            <Route path="whatsapp" element={<WhatsAppInbox />} />
            <Route path="whatsapp/chatbot" element={<WhatsAppChatbot />} />
            <Route path="whatsapp/testes" element={<WhatsAppTestes />} />
            <Route path="whatsapp/dashboard" element={<WhatsAppDashboard />} />
            <Route path="central-servicos/veiculos" element={<AgendamentoVeiculos />} />
            <Route path="central-servicos/reunioes" element={<Reunioes />} />
            <Route path="central-servicos/reunioes/painel-gerencial" element={<PainelGerencial />} />
            <Route path="central-servicos/reunioes/:id" element={<ReuniaoDetalhe />} />
            <Route path="central-servicos/reunioes/:id/conducao" element={<ConducaoReuniao />} />
            <Route path="central-servicos/orientacoes-juridicas" element={<OrientacoesJuridicas />} />
            {/* Comitê de Ética — denúncias saíram da Central de Serviços.
                As rotas antigas seguem redirecionando: link salvo por aí não
                pode virar 404. */}
            <Route path="comite-etica/indicadores" element={<IndicadoresComiteEtica />} />
            <Route path="comite-etica/denuncias" element={<DenunciasComiteEtica />} />
            <Route path="comite-etica/configuracao" element={<ConfiguracaoComiteEtica />} />
            <Route path="central-servicos/denuncias" element={<Navigate to="/app/comite-etica/denuncias" replace />} />
            <Route path="central-servicos/canal-denuncias" element={<Navigate to="/app/comite-etica/denuncias" replace />} />
            <Route path="central-servicos/formularios" element={<Formularios />} />
            <Route path="central-servicos/formularios/dashboard" element={<FormulariosDashboard />} />
            <Route path="central-servicos/formularios/painel" element={<PainelGerencialFormularios />} />
            <Route path="central-servicos/formularios/config" element={<FormulariosConfig />} />
            {/* "Líderes por setor" foi centralizado na Administração (Módulos & Menus →
                Acesso por Usuário). Mantém a URL antiga redirecionando pra lá. */}
            <Route path="central-servicos/formularios/lideres" element={<Navigate to="/app/administracao?tab=modulos" replace />} />
            <Route path="central-servicos/formularios/:id" element={<FormularioEditor />} />
            <Route path="central-servicos/formularios/:id/respostas" element={<FormularioRespostas />} />
            <Route path="painel-executivo" element={<PainelExecutivo />} />
            <Route path="painel-executivo/tv" element={<PainelExecutivoTV />} />
            <Route path="presidencia" element={<Presidencia />} />
            <Route path="licitacoes/grade" element={<Pipeline />} />
            <Route path="editais" element={<CadastroEdital />} />
            <Route path="documentos" element={<Documentos />} />
            <Route path="triagem" element={<TriagemIA />} />
            <Route path="composicao" element={<Composicao />} />
            <Route path="custos-bdi" element={<CustosBDI />} />
            <Route path="parecer-tecnico" element={<Parecer papel="tecnico" />} />
            <Route path="parecer-sst" element={<ParecerSST />} />
            <Route path="parecer-juridico" element={<ParecerJuridico />} />
            <Route path="parecer-controladoria" element={<ParecerControladoria />} />
            <Route path="parecer-dir-operacional" element={<ParecerDiretorOperacional />} />
            <Route path="parecer-dir-administrativo" element={<ParecerDiretorAdministrativo />} />
            <Route path="parecer-gerencial" element={<Parecer papel="gerencial" />} />
            <Route path="controladoria" element={<Controladoria />} />
            <Route path="aprovacoes" element={<Aprovacoes />} />
            <Route path="aprovacoes/inbox" element={<InboxAprovacoes />} />
            <Route path="pregao" element={<Pregao />} />
            <Route path="resultado" element={<Resultado />} />
            <Route path="prontas-contrato" element={<ProntasContrato />} />
            <Route path="contratos/implantacao" element={<Implantacao />} />
            <Route path="licitacoes/planilha-custo" element={<PlanilhaCusto />} />
            <Route path="licitacoes/implantacao" element={<Implantacao />} />
            <Route path="licitacoes/contratos" element={<ContratosERP />} />
            <Route path="licitacoes/cotacoes" element={<CotacoesLicitacao />} />
            {/* Consulta somente-leitura do banco de preços que o Compras
                alimenta na entrada de estoque (SIS-2026-0199). */}
            <Route path="licitacoes/precos-materiais" element={<PrecosMateriais />} />
            <Route path="contratos/ativos" element={<ContratosAtivos />} />
            <Route path="contratos/empenhos" element={<Empenhos />} />
            <Route path="contratos/postos" element={<Postos />} />
            <Route path="contratos/faturamento" element={<Faturamento />} />
            <Route path="contratos/medicoes" element={<Medicoes />} />
            <Route path="contratos/reajustes" element={<Reajustes />} />
            <Route path="contratos/encerramentos" element={<Encerramentos />} />
            <Route path="contratos/:id" element={<ContratoDetalhe />} />
            <Route path="historico" element={<Historico />} />
            <Route path="administracao" element={<Administracao />} />
            <Route path="admin/smoke-helena" element={<SmokeTestHelena />} />
            <Route path="meu-perfil" element={<MeuPerfil />} />
            {/* URL de retorno do OAuth do Discord. Precisa ser fixa: o Discord
                só aceita redirecionar para endereços registrados no app. */}
            <Route path="meu-perfil/discord" element={<DiscordCallback />} />
            <Route path="controladoria/empresas" element={<Empresas />} />
            <Route path="controladoria/centros-custo" element={<CentrosCusto />} />
            <Route path="controladoria/estrutura-organizacional" element={<EstruturaOrganizacional />} />
            <Route path="controladoria/dre" element={<LinhasDRE />} />
            <Route path="controladoria/classificadores" element={<Classificadores />} />
            <Route path="controladoria/obz" element={<PlanejadorOBZ />} />
            <Route path="controladoria/obz-versoes" element={<OBZVersoes />} />
            <Route path="controladoria/dre-gerencial" element={<DREGerencial />} />
            <Route path="controladoria/orcamento-completo" element={<OrcamentoCompleto />} />
            <Route path="controladoria/gerador-pops" element={<GeradorPops />} />
            {/* Malote */}
            <Route path="malote/aprovacoes" element={<MaloteAprovacoes />} />
            <Route path="malote/pagamento" element={<MalotePagamento />} />
            <Route path="malote/configuracoes" element={<MaloteConfiguracoes />} />
            <Route path="malote/criar-despesa" element={<MaloteCriarDespesa />} />
            <Route path="malote/ratear-classificacao" element={<MaloteRatearClassificacao />} />
            <Route path="malote/dashboard" element={<MaloteDashboard />} />
            <Route path="malote/meus-itens" element={<MaloteMeusItens />} />
            <Route path="malote/despesa/:id" element={<MaloteDespesaVisualizar />} />
            <Route path="malote/solicitacao/:id" element={<MaloteSolicitacaoVisualizar />} />
            <Route path="malote/classificacoes-administrativo" element={<MaloteClassificacoesAdministrativo />} />
            <Route path="malote/orcamento-administrativo" element={<MaloteOrcamentoAdministrativo />} />
            <Route path="malote/classificacoes-malote" element={<MaloteClassificacoesMalote />} />
            <Route path="malote/orcamento-contratos" element={<MaloteOrcamentoContratos />} />
            <Route path="malote/orcamento-geral" element={<MaloteOrcamentoGeral />} />
            <Route path="malote/detalhe-orcamento" element={<MaloteDetalheOrcamento />} />
            <Route path="orcamento" element={<Orcamento />} />
            {/* Suprimentos */}
            {/* Mais específica primeiro: o React Router casa na ordem declarada,
                e o matchMenuCode resolve pelo prefixo mais longo — aqui o menu é
                sup_fornecedor_aprovacao, não `fornecedores` (SIS-2026-0209). */}
            <Route path="suprimentos/fornecedores/pendentes" element={<FornecedoresPendentes />} />
            <Route path="suprimentos/fornecedores" element={<Fornecedores />} />
            <Route path="suprimentos/produtos-servicos" element={<ProdutosServicos />} />
            <Route path="suprimentos/produtos" element={<Produtos />} />
            <Route path="suprimentos/categorias" element={<CategoriasProduto />} />
            <Route path="suprimentos/almoxarifados" element={<Almoxarifados />} />
            <Route path="suprimentos/estoque" element={<Estoque />} />
            <Route path="suprimentos/movimentos" element={<MovimentosEstoque />} />
            <Route path="suprimentos/nf-entrada" element={<NFEntrada />} />
            <Route path="suprimentos/requisicoes" element={<Requisicoes />} />
            <Route path="suprimentos/pedidos" element={<PedidosCompra />} />
            <Route path="suprimentos/aprovacoes" element={<AprovacoesCompras />} />
            <Route path="suprimentos/recebimentos" element={<Recebimentos />} />
            {/* Espelho de /app/licitacoes/cotacoes visto pelo lado de Compras.
                Substitui a tela de RFQ do Suprimentos antigo, aposentada na
                20260821000001 — o arquivo Cotacoes.tsx segue no repo, sem rota. */}
            <Route path="suprimentos/cotacoes" element={<CotacoesCompras />} />
            {/* Reservada: a tela ainda não foi desenvolvida, mas a rota existe
                para o menu sup_cotacoes_malote poder ser liberado. */}
            <Route path="suprimentos/cotacoes-malote" element={<CotacoesMalote />} />
            {/* Detalhe da solicitação (SIS-2026-0112). Rota filha para o
                matchMenuCode continuar resolvendo em sup_cotacoes_malote. */}
            <Route path="suprimentos/cotacoes-malote/:id" element={<CotacaoMaloteDetalhe />} />
            <Route path="suprimentos/pedidos-compra" element={<PedidosCompraSupply />} />
            {/* Supply/Compras — catálogo em cascata (Contrato → Posto → Função → enxoval).
                Rota mais específica primeiro: matchMenuCode resolve por prefixo mais longo,
                mas o React Router casa na ordem declarada. */}
            <Route path="suprimentos/catalogo/aprovacoes" element={<CatalogoAprovacoes />} />
            <Route path="suprimentos/catalogo" element={<CatalogoMateriais />} />
            <Route path="suprimentos/pedidos-materiais" element={<PedidosMateriais />} />
            <Route path="suprimentos/estoque-etiquetas" element={<EstoqueEtiquetas />} />
            <Route path="suprimentos/patrimonio" element={<Patrimonio />} />
            <Route path="suprimentos/manutencao" element={<PainelManutencoes />} />
            <Route path="suprimentos/epis-admissoes" element={<EpisAdmissoes />} />
            {/* Financeiro */}
            <Route path="financeiro/contas-pagar" element={<ContasPagar />} />
            <Route path="financeiro/contas-receber" element={<ContasReceber />} />
            <Route path="cobrancas" element={<Cobrancas />} />
            <Route path="financeiro/relatorio-servicos" element={<RelatorioServicos />} />
            <Route path="financeiro/conta-garantida" element={<ContaGarantida />} />
            <Route path="financeiro/fluxo-caixa" element={<FluxoCaixa />} />
            <Route path="financeiro/gestao-financeira/fluxo-caixa" element={<FluxoCaixaGestao />} />
            <Route path="financeiro/fluxo-caixa-diario" element={<FluxoCaixaDiario />} />
            <Route path="financeiro/capital-giro" element={<CapitalGiro />} />
            <Route path="financeiro/conciliacao-fluxo-caixa" element={<ConciliacaoFluxoCaixa />} />
            <Route path="financeiro/contas-bancarias" element={<ContasBancariasEmpresa />} />
            <Route path="financeiro/movimentos" element={<MovimentosBancarios />} />
            <Route path="financeiro/integracao-bancaria" element={<IntegracaoBancaria />} />
            <Route path="financeiro/integracao-bancaria/builder/:contaId" element={<IntegracaoBancariaBuilder />} />
            <Route path="financeiro/programacao-pagamentos" element={<ProgramacaoPagamentos />} />
            <Route path="financeiro/validacao-pos-pagamento" element={<ValidacaoPosPagamento />} />
            <Route path="financeiro/conciliacao-bancaria" element={<ConciliacaoBancaria />} />
            <Route path="financeiro/emissao-nf/cadastro" element={<EmissaoNF />} />
            <Route path="financeiro/emissao-nf/controle-notas" element={<ControleNotas />} />
            {/* Fiscal */}
            <Route path="fiscal" element={<Fiscal />} />
            {/* Contábil */}
            <Route path="contabil/lancamentos" element={<Lancamentos />} />
            <Route path="contabil/plano-contas" element={<PlanoContas />} />
            <Route path="contabil/avancada" element={<Contabilidade />} />
            <Route path="contabil/aprovacao-contas" element={<AprovacaoContas />} />
            <Route path="contabil/balancete" element={<Balancete />} />
            <Route path="contabil/razao" element={<Razao />} />
            <Route path="contabil/razao-detalhado" element={<RazaoDetalhado />} />
            <Route path="contabil/dre-gerencial-real" element={<DREGerencialReal />} />
            <Route path="contabil/conciliacao-eventos" element={<ConciliacaoEventos />} />
            {/* RH */}
            <Route path="rh/colaboradores" element={<Colaboradores />} />
            {/* RH > Hierarquia removido (jul/2026) — feature descontinuada. A tabela
                RH_CONTRATO_ENCARREGADO pode ser dropada; a RPC rh_hierarquia_dados
                CONTINUA (usada por Líderes por setor / Painel Gerencial). */}
            <Route path="rh/hierarquia" element={<Navigate to="/app/rh/colaboradores" replace />} />
            <Route path="rh/alocacoes" element={<Alocacoes />} />
            <Route path="rh/folha" element={<Folha />} />
            <Route path="rh/novas-admissoes" element={<NovasAdmissoes />} />
            <Route path="rh/banco-talentos" element={<BancoTalentos />} />
            <Route path="rh/recrutamento-dashboard" element={<RecrutamentoDashboard />} />
            <Route path="rh/ferias" element={<Ferias />} />
            <Route path="rh/recrutamento" element={<Recrutamento />} />
            <Route path="rh/solicitacoes-demissao" element={<RhSolicitacoesDemissao />} />
            {/* Operacional — fila de aprovação das demissões pedidas pelos encarregados. */}
            <Route path="operacional/solicitacoes-demissao" element={<OperacionalSolicitacoesDemissao />} />
            {/* A MESMA tela do Recrutamento, recortada na etapa 1 — ver o
                escopo em Recrutamento.tsx. Não é uma cópia. */}
            <Route path="operacional/recrutamento" element={<Recrutamento escopo="operacional" />} />
            {/* Jurídico — Gestão Patrimonial */}
            <Route path="juridico" element={<Navigate to="/app/juridico/patrimonios" replace />} />
            <Route path="juridico/patrimonios" element={<Patrimonios />} />
            <Route path="juridico/processos/dashboard" element={<Processos view="dashboard" />} />
            <Route path="juridico/processos" element={<Processos view="processos" />} />
            <Route path="juridico/processos/audiencias" element={<Processos view="audiencias" />} />
            <Route path="juridico/advertencias" element={<Advertencias />} />
            <Route path="juridico/candidatos" element={<VerificacaoCandidatos />} />
            <Route path="juridico/duvidas" element={<CentralDuvidas />} />
            {/* Treinamentos */}
            <Route path="treinamentos" element={<Navigate to="/app/treinamentos/erp" replace />} />
            <Route path="treinamentos/erp" element={<TreinamentosERP />} />
            {/* Mudança de Função — encarregado abre, aprovação, SST, RH */}
            <Route path="encarregados/troca-funcao" element={<SolicitarTrocaFuncao />} />
            <Route path="operacional/troca-funcao" element={<OperacionalTrocaFuncao />} />
            <Route path="rh/troca-funcao-escritorio" element={<RhTrocaFuncaoEscritorio />} />
            <Route path="sst/troca-funcao" element={<SstTrocaFuncao />} />
            <Route path="rh/troca-funcao" element={<RhTrocaFuncao />} />
            {/* SST — ASO / Admissão (fila do Recrutamento) */}
            <Route path="sst/aso" element={<AsoCandidatos />} />
            {/* BI */}
            <Route path="bi" element={<BIDashboard />} />
            {/* Integração & Migração */}
            <Route path="integracao" element={<IntegracaoBatches />} />
            <Route path="integracao/aliases" element={<IntegracaoAliases />} />
            <Route path="integracao/:id" element={<BatchDetalhe />} />
            <Route path="admin/migracao-zero" element={<MigracaoZero />} />
            {/* Consolidação: rota antiga preservada como redirect para Configurações do ERP. */}
            <Route path="admin/permissoes" element={<Navigate to="/app/administracao?tab=visibilidade" replace />} />
            {/* Plano de Ações */}
            <Route path="plano-acoes" element={<PlanoAcoesLista />} />
            <Route path="plano-acoes/dashboard" element={<PlanoAcoesDashboard />} />
            <Route path="plano-acoes/kanban" element={<PlanoAcoesKanban />} />
            <Route path="plano-acoes/importar" element={<PlanoAcoesImportar />} />
            <Route path="plano-acoes/aprovacoes" element={<PlanoAcoesAprovacoes />} />
            <Route path="plano-acoes/configuracoes" element={<Navigate to="/app/administracao?tab=plano-acoes-acl" replace />} />
            <Route path="plano-acoes/copiloto" element={<CopilotoIA />} />
            <Route path="plano-acoes/:id" element={<PlanoAcaoDetalhe />} />
            {/* Ajuda / Base de Conhecimento */}
            <Route path="ajuda" element={<Ajuda />} />
            <Route path="ajuda/:modulo/:slug" element={<AjudaTopico />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        </EmpresaAtivaProvider>
        </PermissoesProvider>
        </DemoModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
