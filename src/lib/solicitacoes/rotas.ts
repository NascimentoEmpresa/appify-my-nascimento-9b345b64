// As telas de solicitação (vaga, férias, advertência, demissão, mudança de
// função) existem em DOIS lugares desde 15/09/2026: no módulo Encarregados,
// como sempre, e em Central de Serviços › Solicitações. É o mesmo componente
// nos dois — o que muda é a rota, e é daqui que cada tela descobre pra onde
// mandar o usuário ("ver minhas solicitações", "solicitar a demissão de
// fulano") sem hardcodar /app/encarregados.
//
// Na Central, todas as subrotas caem no menu `central_servicos_solicitacoes`
// por prefixo (migration 20260930000111) — liberou o menu, aparece tudo.

export type BaseSolicitacoes = "encarregados" | "central";

export interface RotasSolicitacoes {
  base: BaseSolicitacoes;
  minhas: string;
  vaga: string;
  ferias: string;
  advertencia: string;
  demissao: string;
  trocaFuncao: string;
  /** Só existem no módulo Encarregados; na Central caem no módulo de origem. */
  materiais: string;
  chamadoNovo: string;
  meusPedidos: string;
  /** Orientações Jurídicas (biblioteca + minhas perguntas) — cada módulo tem a sua porta (17/09/2026). */
  orientacoes: string;
}

export const rotasSolicitacoes = (base: BaseSolicitacoes = "encarregados"): RotasSolicitacoes =>
  base === "central"
    ? {
        base,
        minhas: "/app/central-servicos/solicitacoes",
        // Vaga na Central é a tela da Gestão de Recrutamento (com catálogo),
        // não o card do encarregado — por isso a rota antiga.
        vaga: "/app/central-servicos/solicitar-vaga",
        ferias: "/app/central-servicos/solicitacoes/ferias",
        advertencia: "/app/central-servicos/solicitacoes/advertencia",
        demissao: "/app/central-servicos/solicitacoes/demissao",
        trocaFuncao: "/app/central-servicos/solicitacoes/mudanca-funcao",
        materiais: "/app/encarregados/solicitar-materiais",
        chamadoNovo: "/app/central-servicos/chamados/novo",
        meusPedidos: "/app/encarregados/meus-pedidos",
        orientacoes: "/app/central-servicos/orientacoes-juridicas",
      }
    : {
        base,
        minhas: "/app/encarregados/minhas-solicitacoes",
        vaga: "/app/encarregados/solicitar-vaga",
        ferias: "/app/encarregados/solicitar-ferias",
        advertencia: "/app/encarregados/advertencia",
        demissao: "/app/encarregados/solicitar-demissao",
        trocaFuncao: "/app/encarregados/troca-funcao",
        materiais: "/app/encarregados/solicitar-materiais",
        chamadoNovo: "/app/encarregados/chamados/novo",
        meusPedidos: "/app/encarregados/meus-pedidos",
        orientacoes: "/app/encarregados/orientacoes-juridicas",
      };

/** Descobre a base pela URL atual — pra componente compartilhado que não recebe prop. */
export const baseDaUrl = (pathname: string): BaseSolicitacoes =>
  pathname.startsWith("/app/central-servicos/solicitacoes") ? "central" : "encarregados";
