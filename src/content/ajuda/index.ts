// Catálogo da Base de Conhecimento.
// Para adicionar um novo artigo: crie um .md em src/content/ajuda/<modulo>/ e registre aqui.

import programacaoPagamentos from "./financeiro/programacao-pagamentos.md?raw";
import contasPagarListar from "./financeiro/contas-pagar-listar.md?raw";
import novoPreTitulo from "./financeiro/novo-pre-titulo.md?raw";
import aprovarPagamento from "./financeiro/aprovar-pagamento.md?raw";
import conciliacaoBancaria from "./financeiro/conciliacao-bancaria.md?raw";
import fluxoCaixaDiario from "./financeiro/fluxo-caixa-diario.md?raw";
import nfEntrada from "./suprimentos/nf-entrada.md?raw";
import cotacao from "./suprimentos/cotacao.md?raw";
import pedidoCompra from "./suprimentos/pedido-compra.md?raw";
import aprovarPedido from "./suprimentos/aprovar-pedido.md?raw";
import cadastroUsuario from "./admin/cadastro-usuario.md?raw";
import gestaoUsuarioSistema from "./admin/gestao-usuario-sistema.md?raw";
import cadastroAlcadas from "./admin/cadastro-alcadas.md?raw";
import trocarEmpresaCc from "./admin/trocar-empresa-cc.md?raw";
import manualUsuariosPermissoes from "./admin/manual-usuarios-permissoes.md?raw";
import cadastroColaborador from "./rh/cadastro-colaborador.md?raw";
import minhasPendencias from "./geral/minhas-pendencias.md?raw";

export type ArtigoStatus = "disponivel" | "em_implantacao" | "pendente";

export type Persona =
  | "solicitante"
  | "compras"
  | "financeiro"
  | "fiscal"
  | "gestor"
  | "diretoria"
  | "presidencia"
  | "rh"
  | "controladoria"
  | "admin";

export const PERSONAS: { id: Persona; label: string }[] = [
  { id: "solicitante", label: "Solicitante" },
  { id: "compras", label: "Compras" },
  { id: "financeiro", label: "Financeiro" },
  { id: "fiscal", label: "Fiscal" },
  { id: "gestor", label: "Gestor" },
  { id: "diretoria", label: "Diretoria" },
  { id: "presidencia", label: "Presidência" },
  { id: "rh", label: "RH" },
  { id: "controladoria", label: "Controladoria" },
  { id: "admin", label: "Administração" },
];

export type ArtigoMeta = {
  slug: string;
  modulo: string;
  moduloLabel: string;
  titulo: string;
  resumo: string;
  tags: string[];
  rotasRelacionadas: string[]; // prefixos de rota onde este artigo deve aparecer no painel contextual
  updatedAt: string;
  conteudo: string;
  personas?: Persona[];
  status?: ArtigoStatus; // default: "disponivel"
};

export const MODULOS: { id: string; label: string; descricao: string }[] = [
  { id: "geral", label: "Geral", descricao: "Atalhos do dia a dia, pendências e dicas transversais." },
  { id: "financeiro", label: "Financeiro", descricao: "Contas a pagar/receber, fluxo, conciliação e integração bancária." },
  { id: "contabil", label: "Contábil", descricao: "Plano de contas, lançamentos, balancete e DRE." },
  { id: "rh", label: "RH", descricao: "Colaboradores, alocações e folha." },
  { id: "suprimentos", label: "Suprimentos", descricao: "Fornecedores, requisições, pedidos e estoque." },
  { id: "plano-acoes", label: "Plano de Ações", descricao: "Importação, kanban, aprovações e copiloto IA." },
  { id: "integracao", label: "Integração & Migração", descricao: "Carregamento de lotes FCR, aliases e reprocessamento." },
  { id: "admin", label: "Administração", descricao: "Usuários, perfis, permissões e parâmetros." },
];

export const ARTIGOS: ArtigoMeta[] = [
  {
    slug: "manual-usuarios-permissoes",
    modulo: "admin",
    moduloLabel: "Administração",
    titulo: "Manual de Gestão de Usuários e Permissões",
    resumo: "Guia completo das 4 camadas de segurança: usuários, perfis, permissões (ações) e visibilidade de menu, com FAQ e troubleshooting.",
    tags: ["usuários", "permissões", "perfis", "roles", "visibilidade", "menu", "overrides", "acl", "plano de ações", "troubleshooting", "faq", "manual"],
    rotasRelacionadas: ["/app/administracao", "/app/admin/permissoes"],
    updatedAt: "2026-05-27",
    conteudo: manualUsuariosPermissoes,
    personas: ["admin", "controladoria", "presidencia"],
    status: "disponivel",
  },
  {
    slug: "programacao-pagamentos",
    modulo: "financeiro",
    moduloLabel: "Financeiro",
    titulo: "Programação de Pagamentos",
    resumo: "Como selecionar títulos, gerar malotes, aprovar e enviar para o banco.",
    tags: ["pagamentos", "malote", "aprovação", "cnab", "api"],
    rotasRelacionadas: ["/app/financeiro/programacao-pagamentos", "/app/financeiro/contas-pagar"],
    updatedAt: "2026-05-18",
    conteudo: programacaoPagamentos,
    personas: ["financeiro", "controladoria", "diretoria"],
    status: "disponivel",
  },
  {
    slug: "contas-pagar-listar",
    modulo: "financeiro",
    moduloLabel: "Financeiro",
    titulo: "Como vejo os títulos a pagar?",
    resumo: "Consulta de títulos em aberto, filtros e atalhos para pagamento.",
    tags: ["contas a pagar", "títulos", "consulta"],
    rotasRelacionadas: ["/app/financeiro/contas-pagar"],
    updatedAt: "2026-05-18",
    conteudo: contasPagarListar,
    personas: ["financeiro", "controladoria", "diretoria"],
    status: "disponivel",
  },
  {
    slug: "novo-pre-titulo",
    modulo: "financeiro",
    moduloLabel: "Financeiro",
    titulo: "Como lançar um novo pré-título (NF a pagar)?",
    resumo: "Passo a passo detalhado: onde clicar, o que preencher, conferir antes de salvar e próximos passos.",
    tags: ["pré-título", "nf", "lançamento", "contas a pagar", "rateio"],
    rotasRelacionadas: ["/app/financeiro/contas-pagar"],
    updatedAt: "2026-05-18",
    conteudo: novoPreTitulo,
    personas: ["financeiro", "controladoria"],
    status: "disponivel",
  },
  {
    slug: "aprovar-pagamento",
    modulo: "financeiro",
    moduloLabel: "Financeiro",
    titulo: "Como aprovo um pagamento?",
    resumo: "Revisão e aprovação de malotes de pagamento por alçada.",
    tags: ["aprovação", "pagamento", "malote", "alçada"],
    rotasRelacionadas: ["/app/financeiro/programacao-pagamentos"],
    updatedAt: "2026-05-18",
    conteudo: aprovarPagamento,
    personas: ["financeiro", "gestor", "diretoria"],
    status: "em_implantacao",
  },
  {
    slug: "conciliacao-bancaria",
    modulo: "financeiro",
    moduloLabel: "Financeiro",
    titulo: "Como faço conciliação bancária?",
    resumo: "Amarração entre movimentos bancários e títulos pagos/recebidos.",
    tags: ["conciliação", "banco", "ofx", "cnab"],
    rotasRelacionadas: ["/app/financeiro/conciliacao-fluxo-caixa", "/app/financeiro/movimentos"],
    updatedAt: "2026-05-18",
    conteudo: conciliacaoBancaria,
    personas: ["financeiro", "controladoria"],
    status: "em_implantacao",
  },
  {
    slug: "fluxo-caixa-diario",
    modulo: "financeiro",
    moduloLabel: "Financeiro",
    titulo: "Como vejo o fluxo de caixa diário?",
    resumo: "Visão diária de entradas, saídas, saldo e visões gerenciais.",
    tags: ["fluxo de caixa", "diário", "saldo"],
    rotasRelacionadas: ["/app/financeiro/fluxo-caixa-diario", "/app/financeiro/fluxo-caixa"],
    updatedAt: "2026-05-18",
    conteudo: fluxoCaixaDiario,
    personas: ["financeiro", "controladoria", "diretoria", "presidencia"],
    status: "disponivel",
  },
  {
    slug: "nf-entrada",
    modulo: "suprimentos",
    moduloLabel: "Suprimentos",
    titulo: "Onde lanço uma nota fiscal de entrada?",
    resumo: "Lançamento manual ou via XML, vínculo com pedido e geração de título.",
    tags: ["nf", "entrada", "xml", "fiscal"],
    rotasRelacionadas: ["/app/suprimentos/nf-entrada"],
    updatedAt: "2026-05-18",
    conteudo: nfEntrada,
    personas: ["compras", "fiscal"],
    status: "disponivel",
  },
  {
    slug: "cotacao",
    modulo: "suprimentos",
    moduloLabel: "Suprimentos",
    titulo: "Como faço uma cotação?",
    resumo: "Convite a fornecedores, registro de propostas e escolha justificada.",
    tags: ["cotação", "fornecedores", "propostas"],
    rotasRelacionadas: ["/app/suprimentos/cotacoes"],
    updatedAt: "2026-05-18",
    conteudo: cotacao,
    personas: ["compras"],
    status: "disponivel",
  },
  {
    slug: "pedido-compra",
    modulo: "suprimentos",
    moduloLabel: "Suprimentos",
    titulo: "Como gero um pedido de compra?",
    resumo: "Geração do pedido a partir da cotação e envio para aprovação.",
    tags: ["pedido", "compra"],
    rotasRelacionadas: ["/app/suprimentos/pedidos"],
    updatedAt: "2026-05-18",
    conteudo: pedidoCompra,
    personas: ["compras"],
    status: "disponivel",
  },
  {
    slug: "aprovar-pedido",
    modulo: "suprimentos",
    moduloLabel: "Suprimentos",
    titulo: "Como aprovo um pedido de compra?",
    resumo: "Revisão e aprovação de pedidos por alçada.",
    tags: ["aprovação", "pedido", "alçada"],
    rotasRelacionadas: ["/app/suprimentos/aprovacoes"],
    updatedAt: "2026-05-18",
    conteudo: aprovarPedido,
    personas: ["gestor", "diretoria"],
    status: "disponivel",
  },
  {
    slug: "cadastro-usuario",
    modulo: "admin",
    moduloLabel: "Administração",
    titulo: "Como cadastro um usuário?",
    resumo: "Criação de usuário, vínculo com empresa(s) e atribuição de papéis.",
    tags: ["usuário", "permissão", "perfil", "roles"],
    rotasRelacionadas: ["/app/administracao"],
    updatedAt: "2026-05-18",
    conteudo: cadastroUsuario,
    personas: ["admin"],
    status: "disponivel",
  },
  {
    slug: "gestao-usuario-sistema",
    modulo: "admin",
    moduloLabel: "Administração",
    titulo: "Gestão de Usuário Sistema",
    resumo: "Dicionário oficial de permissões: para cada necessidade, qual papel e ação liberar em qual tela.",
    tags: ["permissões", "papéis", "roles", "acessos", "perfis", "alçadas", "dicionário"],
    rotasRelacionadas: ["/app/administracao", "/app/admin/permissoes"],
    updatedAt: "2026-05-19",
    conteudo: gestaoUsuarioSistema,
    personas: ["admin", "controladoria", "presidencia"],
    status: "disponivel",
  },
  {
    slug: "cadastro-alcadas",
    modulo: "admin",
    moduloLabel: "Administração",
    titulo: "Cadastro de Alçadas",
    resumo: "Manual completo de fluxos, etapas, faixas de valor, prazos e réguas de escalonamento de aprovação.",
    tags: ["alçadas", "aprovação", "fluxo", "etapas", "escalonamento", "sla", "governança"],
    rotasRelacionadas: ["/app/administracao"],
    updatedAt: "2026-05-20",
    conteudo: cadastroAlcadas,
    personas: ["admin", "controladoria", "presidencia"],
    status: "disponivel",
  },
  {
    slug: "trocar-empresa-cc",
    modulo: "admin",
    moduloLabel: "Administração",
    titulo: "Trocar a empresa de um Centro de Custo ou Contrato",
    resumo: "Quando e como mover um CC/contrato entre empresas do grupo, cenários A/B/C, bloqueios e auditoria.",
    tags: ["centro de custo", "cc", "empresa", "contrato", "troca", "migração", "auditoria"],
    rotasRelacionadas: ["/app/administracao", "/app/centros-custo", "/app/suprimentos/contratos"],
    updatedAt: "2026-05-20",
    conteudo: trocarEmpresaCc,
    personas: ["admin", "controladoria", "presidencia"],
    status: "disponivel",
  },
  {
    slug: "cadastro-colaborador",
    modulo: "rh",
    moduloLabel: "RH",
    titulo: "Como cadastro um colaborador?",
    resumo: "Ficha do colaborador, dados bancários e vínculo com postos.",
    tags: ["colaborador", "rh", "ficha"],
    rotasRelacionadas: ["/app/operacional/colaboradores"],
    updatedAt: "2026-05-18",
    conteudo: cadastroColaborador,
    personas: ["rh", "admin"],
    status: "disponivel",
  },
  {
    slug: "minhas-pendencias",
    modulo: "geral",
    moduloLabel: "Geral",
    titulo: "Como consulto minhas pendências?",
    resumo: "Onde encontrar aprovações, pareceres e itens pendentes hoje.",
    tags: ["pendências", "minhas", "tarefas"],
    rotasRelacionadas: [],
    updatedAt: "2026-05-18",
    conteudo: minhasPendencias,
    personas: ["solicitante", "compras", "financeiro", "gestor", "diretoria", "rh", "admin"],
    status: "em_implantacao",
  },
];

export function getArtigo(modulo: string, slug: string): ArtigoMeta | undefined {
  return ARTIGOS.find((a) => a.modulo === modulo && a.slug === slug);
}

export function getArtigosPorModulo(modulo: string): ArtigoMeta[] {
  return ARTIGOS.filter((a) => a.modulo === modulo);
}

export function getArtigosPorRota(pathname: string): ArtigoMeta[] {
  return ARTIGOS.filter((a) => a.rotasRelacionadas.some((r) => pathname.startsWith(r)));
}

export function buscarArtigos(termo: string, persona?: Persona): ArtigoMeta[] {
  const t = termo.trim().toLowerCase();
  let base = ARTIGOS;
  if (persona) base = base.filter((a) => a.personas?.includes(persona));
  if (!t) return base;
  return base.filter(
    (a) =>
      a.titulo.toLowerCase().includes(t) ||
      a.resumo.toLowerCase().includes(t) ||
      a.tags.some((tag) => tag.includes(t)) ||
      a.moduloLabel.toLowerCase().includes(t),
  );
}
