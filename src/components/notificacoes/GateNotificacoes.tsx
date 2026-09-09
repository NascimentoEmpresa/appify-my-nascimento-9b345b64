import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { fmtDataHora, type Escolha } from "@/lib/notificacoes";
import { toast } from "sonner";

/**
 * O aviso que para a tela até a pessoa responder.
 *
 * Fica montado no layout do /app, então acompanha a pessoa em qualquer tela —
 * a notificação não é de uma página, é do sistema.
 *
 * NÃO É UM `Dialog` do shadcn de propósito. Aquele fecha no Esc e no clique
 * de fora, e o ponto inteiro daqui é o contrário: a única saída é CONCORDO ou
 * DISCORDO. Um modal que se fecha sozinho não registra ciência de ninguém.
 *
 * Uma por vez, na ordem em que foram publicadas: empilhar três avisos numa
 * tela só faz a pessoa clicar em tudo sem ler, que é exatamente o que este
 * recurso existe para evitar.
 */
export function GateNotificacoes() {
  const { pendentes, responder } = useNotificacoes();
  const [enviando, setEnviando] = useState<Escolha | null>(null);

  const atual = pendentes[0];
  if (!atual) return null;

  const escolher = async (escolha: Escolha) => {
    setEnviando(escolha);
    try {
      await responder.mutateAsync({ id: atual.id, escolha });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      toast.error(`Não deu para registrar a resposta: ${msg}`);
    } finally {
      setEnviando(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="notificacao-titulo"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-background shadow-2xl">
        <div className="flex items-start gap-3 border-b bg-amber-50 px-5 py-4 dark:bg-amber-950/30">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
            <AlertCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="notificacao-titulo" className="text-base font-bold leading-tight">
              {atual.titulo}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Publicado em {fmtDataHora(atual.publicado_em)}
              {atual.criado_por_nome ? ` · ${atual.criado_por_nome}` : ""}
            </p>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto px-5 py-4">
          {/* `whitespace-pre-wrap`: quem escreve o aviso usa parágrafo e
              lista, e sem isto tudo virava um bloco único de texto. */}
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{atual.mensagem}</p>
        </div>

        <div className="flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            disabled={!!enviando}
            onClick={() => escolher("DISCORDO")}
          >
            {enviando === "DISCORDO" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Discordo
          </Button>
          <Button disabled={!!enviando} onClick={() => escolher("CONCORDO")}>
            {enviando === "CONCORDO" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Concordo
          </Button>
        </div>

        {pendentes.length > 1 && (
          <p className="border-t px-5 py-2 text-center text-xs text-muted-foreground">
            Mais {pendentes.length - 1} aviso(s) depois deste.
          </p>
        )}
      </div>
    </div>
  );
}
