import { Component, ReactNode } from "react";
import { SistemaIndisponivel } from "./SistemaIndisponivel";

/**
 * APAGÃO 08/09/2026 — três telas do Malote (Orçamento Administrativo,
 * Orçamento Geral e Detalhe Orçamento) ficaram 100% em branco em produção.
 *
 * A causa não foi um bug de lógica: foi uma JANELA DE INCONSISTÊNCIA entre
 * banco e código. A migration do SIS-2026-0335 (setor_responsavel de `text`
 * pra `text[]`, múltiplos setores por Classificação) foi aplicada no banco
 * remoto antes de o frontend correspondente estar publicado. Como neste
 * projeto migration NÃO se auto-aplica no merge — ela é rodada à mão no SQL
 * Editor — as duas metades andam em ritmos diferentes por natureza. Nessa
 * janela, a coluna já devolvia lista e o bundle publicado ainda chamava
 * `.trim()` nela: `TypeError: s.trim is not a function`.
 *
 * O que transformou isso num apagão foi o ERP inteiro não ter NENHUM
 * ErrorBoundary: quando um componente estoura durante o render, o React
 * desmonta a árvore toda — some sidebar, topbar, conteúdo, sobra
 * `<div id="root">` vazio. Pra quem usa, não existe "erro nesta tela",
 * existe "o sistema sumiu": sem mensagem, sem pista, sem nem conseguir
 * navegar pra outro lugar. E o diagnóstico só saiu abrindo o console do
 * navegador em produção.
 *
 * Essa janela vai acontecer de novo — é inerente ao fluxo de deploy daqui.
 * Este boundary não impede o erro, ele contém o estrago:
 *   - a falha fica presa na área de conteúdo (sidebar e topbar sobrevivem,
 *     então dá pra ir pra outra tela sem F5);
 *   - a mensagem técnica aparece na própria página, então quem reportar já
 *     manda o erro junto, sem precisar abrir o console;
 *   - a montagem no AppShell usa `key={pathname}`, então trocar de rota já
 *     limpa o estado de erro — ninguém fica preso.
 *
 * 23/09/2026: o visual passou a ser o de "Sistema temporariamente
 * indisponível" (SistemaIndisponivel.tsx), pedido do Pablo para QUALQUER
 * erro. 24/09: "sempre que der algum erro vai pra essa tela" — agora cobre a
 * janela inteira em todos os casos (antes, dentro do AppShell, só a área de
 * conteúdo), e o botão é "Recarregar" a página que falhou. O detalhe técnico
 * (rota + mensagem) continua na tela, recolhido, para o chamado.
 *
 * Precisa ser class component: `componentDidCatch`/`getDerivedStateFromError`
 * não têm equivalente em hook.
 */
interface Props {
  children: ReactNode;
  /** Rota mostrada junto do erro, pra facilitar o relato do usuário. */
  rota?: string;
  /** Mantido por compatibilidade (App.tsx): hoje toda falha cobre a janela. */
  telaCheia?: boolean;
}

interface State {
  erro: Error | null;
}

export class ErroDeTela extends Component<Props, State> {
  /** Recarregar a página — estático para o teste poder observar sem navegar. */
  static recarregar = () => window.location.reload();

  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: { componentStack: string }) {
    // Mantido no console de propósito: é o que dá o stack real do bundle
    // minificado quando alguém for investigar.
    console.error("[ErroDeTela] falha ao renderizar a tela:", erro, info.componentStack);
  }

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <SistemaIndisponivel
        modo="tela"
        onTentar={() => ErroDeTela.recarregar()}
        rotuloTentar="Recarregar"
        detalhe={`${this.props.rota ? `Rota: ${this.props.rota}
` : ""}${erro.message || String(erro)}`}
      />
    );
  }
}
