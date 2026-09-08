import { Component, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
 * Precisa ser class component: `componentDidCatch`/`getDerivedStateFromError`
 * não têm equivalente em hook.
 */
interface Props {
  children: ReactNode;
  /** Rota mostrada junto do erro, pra facilitar o relato do usuário. */
  rota?: string;
}

interface State {
  erro: Error | null;
}

export class ErroDeTela extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: { componentStack: string }) {
    // Mantido no console de propósito: é o que dá o stack real do bundle
    // minificado quando alguém for investigar.
    console.error("[ErroDeTela] falha ao renderizar a tela:", erro, info.componentStack);
  }

  private tentarDeNovo = () => this.setState({ erro: null });

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
          <AlertTriangle className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-semibold">Esta tela não conseguiu abrir</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          O erro é desta tela, não do sistema todo — o menu ao lado continua funcionando e você pode
          seguir para outra área normalmente. Se o problema se repetir, abra um chamado e cole a
          mensagem abaixo.
        </p>

        <details className="w-full max-w-xl text-left">
          <summary className="cursor-pointer text-xs text-muted-foreground">Detalhes técnicos</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-left text-xs whitespace-pre-wrap break-words">
            {this.props.rota ? `Rota: ${this.props.rota}\n` : ""}
            {erro.message || String(erro)}
          </pre>
        </details>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button onClick={this.tentarDeNovo}>
            <RotateCcw className="mr-2 h-4 w-4" />
            Tentar de novo
          </Button>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Recarregar a página
          </Button>
        </div>
      </div>
    );
  }
}
