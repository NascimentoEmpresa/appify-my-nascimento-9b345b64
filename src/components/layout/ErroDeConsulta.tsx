import { type ReactNode } from "react";
import { RotateCcw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ehErroDePermissao } from "@/lib/erroDePermissao";
import { isSobrecargaError } from "@/lib/erroSobrecarga";
import { SemAcesso } from "./SemAcesso";
import { SistemaIndisponivel } from "./SistemaIndisponivel";

/**
 * O QUE A TELA MOSTRA QUANDO A CONSULTA FALHA (20/10/2026)
 *
 * POR QUE ISTO EXISTE
 * ───────────────────
 * O ERP já tinha a resposta pronta para "deu erro": o `ErroDeTela`
 * (ErrorBoundary) joga qualquer falha para o "Sistema temporariamente
 * indisponível", com botão e detalhe técnico. Foi pedido do Pablo em
 * 24/09/2026, nas palavras dele: "sempre que der algum erro vai pra essa
 * tela".
 *
 * Só que um ErrorBoundary só enxerga o que é ATIRADO DURANTE O RENDER. Erro
 * de `useQuery` não é atirado: ele volta como `{ error }` e cada tela decide
 * o que fazer. E ~69 telas deste repositório decidiram a mesma coisa, cada
 * uma por conta própria:
 *
 *     {error ? <div>Não foi possível carregar X. {error.message}</div> : ...}
 *
 * Ou seja: a rede de proteção existe, e essas telas passaram ao largo dela
 * sem querer. O que o usuário final recebe é um painel vermelho, a frase
 * crua do servidor (muitas vezes em inglês) e NENHUMA saída — nem botão de
 * tentar de novo, nem recado de que o problema não é dele. Para recarregar,
 * F5; para entender, abrir chamado.
 *
 * O CASO QUE TROUXE ISTO À TONA
 * ─────────────────────────────
 * `/app/suprimentos/cotacoes`, com o Kong do cluster devolvendo 502 em
 * `cotacoes_licitacao_arquivo`. A tela estampou "An invalid response was
 * received from the upstream server" e parou ali — sendo que o erro era
 * passageiro, de borda, e uma nova tentativa resolveria. Ver também o
 * comentário de 20/10 em `@/lib/erroSobrecarga`, que é a outra metade do
 * mesmo defeito: o erro do Kong nem sequer era RECONHECIDO como
 * instabilidade.
 *
 * O CONTRATO
 * ──────────
 * Três desfechos, nesta ordem — a ordem importa, pelo mesmo motivo do
 * `ErroDeTela`: falta de permissão NÃO é queda.
 *
 *   1. erro de permissão  → "Sem acesso" (é resposta do sistema, não falha);
 *   2. instabilidade      → "Sistema temporariamente indisponível", com
 *                           "Tentar de novo" (mesma tela do ErrorBoundary,
 *                           em modo "area": menu e topo seguem de pé);
 *   3. qualquer outra     → painel enxuto com a mensagem E um botão de
 *                           tentar de novo. Nunca um beco sem saída.
 *
 * REGRA PARA TELA NOVA: não escreva o painel de erro na mão. Use isto.
 */
interface Props {
  /** O `error` do `useQuery`. */
  erro: unknown;
  /** O `refetch` do `useQuery`. Sem ele, o botão não aparece. */
  aoTentarDeNovo?: () => void | Promise<unknown>;
  /**
   * O que a tela tentava carregar, em português e no feminino/masculino que
   * couber: "as cotações", "os pedidos". Entra na frase do caso 3.
   */
  oQue?: string;
  /** Rota mostrada no detalhe técnico, para o chamado. */
  rota?: string;
  /** Igual ao do SistemaIndisponivel: "area" não cobre menu nem topo. */
  modo?: "tela" | "area";
  /** Conteúdo extra no bloco recolhido de detalhe técnico. */
  detalheExtra?: ReactNode;
}

/** Mensagem legível do erro, qualquer que seja o formato que chegou. */
export function mensagemDoErro(erro: unknown): string {
  if (!erro) return "";
  if (typeof erro === "string") return erro;
  const m = (erro as { message?: unknown }).message;
  return typeof m === "string" ? m : String(erro);
}

export function ErroDeConsulta({
  erro, aoTentarDeNovo, oQue = "os dados", rota, modo = "area", detalheExtra,
}: Props) {
  if (!erro) return null;

  const mensagem = mensagemDoErro(erro);
  const detalhe = (
    <>
      {rota ? `Rota: ${rota}\n` : ""}
      {/* O 502 do Caddy chega sem corpo nenhum; sem isto o bloco fica vazio
          e quem abre o chamado não tem o que copiar. */}
      {mensagem || "O servidor não devolveu mensagem de erro."}
      {detalheExtra ? `\n${detalheExtra}` : ""}
    </>
  );

  if (ehErroDePermissao(erro)) {
    return <SemAcesso modo={modo} detalhe={detalhe} />;
  }

  if (isSobrecargaError(erro)) {
    return (
      <SistemaIndisponivel
        modo={modo}
        onTentar={aoTentarDeNovo}
        rotuloTentar="Tentar de novo"
        detalhe={detalhe}
      />
    );
  }

  // Caso 3 — erro de verdade, da consulta. Aqui a mensagem técnica AJUDA
  // (é ela que vira o chamado), então continua à vista; o que muda em
  // relação ao painel que cada tela escrevia é só o botão.
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center"
    >
      <ShieldAlert className="h-10 w-10 text-destructive" aria-hidden />
      <p className="font-medium">Não foi possível carregar {oQue}.</p>
      <p className="max-w-md break-words text-sm text-muted-foreground">
        {mensagem || "O servidor não devolveu mensagem de erro."}
      </p>
      {aoTentarDeNovo && (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void aoTentarDeNovo()}>
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
          Tentar de novo
        </Button>
      )}
    </div>
  );
}
