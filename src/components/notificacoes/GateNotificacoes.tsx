import { useState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConteudoAviso } from "@/components/notificacoes/ConteudoAviso";
import { ComentariosAviso } from "@/components/notificacoes/ComentariosAviso";
import { useNotificacoes } from "@/hooks/useNotificacoes";
import { cn } from "@/lib/utils";
import {
  botoesDoAviso, fmtDataHora, larguraJanelaAviso, tamanhoImagemDe, varianteDoBotao,
  type Escolha, type Notificacao,
} from "@/lib/notificacoes";
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
 *
 * TRÊS REGRAS, NÃO UMA
 *   Até o Quadro de Avisos existir, todo aviso travava e todo aviso pedia
 *   CONCORDO/DISCORDO. Agora quem publica escolhe (ver QuadroAvisos.tsx):
 *
 *     bloquear_acesso=false  → dá para adiar com o X, e ele volta na próxima
 *                              visita, porque a ciência continua pendente.
 *     permitir_escolha=false → um botão só, "Estou ciente" (grava CIENTE).
 *
 *   O X só aparece quando o aviso NÃO bloqueia: num aviso que bloqueia, uma
 *   saída que não registra nada é a definição do que este componente evita.
 */
export function GateNotificacoes() {
  const { pendentes, responder } = useNotificacoes();
  /** O que está sendo gravado: a escolha, ou o texto do botão próprio. */
  const [enviando, setEnviando] = useState<string | null>(null);

  /**
   * Adiados NESTA sessão. Fica em estado, não no banco: "vou ler depois" não
   * é ciência e não pode virar registro — na próxima visita o aviso volta.
   */
  const [adiados, setAdiados] = useState<number[]>([]);

  const fila = pendentes.filter((n) => !adiados.includes(n.id));
  const atual = fila[0];
  if (!atual) return null;

  const escolher = async (escolha: Escolha, resposta?: string) => {
    setEnviando(resposta ?? escolha);
    try {
      await responder.mutateAsync({ id: atual.id, escolha, resposta });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erro desconhecido";
      toast.error(`Não deu para registrar a resposta: ${msg}`);
    } finally {
      setEnviando(null);
    }
  };

  return (
    <JanelaAviso
      aviso={atual}
      enviando={enviando}
      onEscolher={escolher}
      onAdiar={() => setAdiados((a) => [...a, atual.id])}
      restantes={fila.length - 1}
    />
  );
}

/**
 * A janela do aviso, sem nada de banco — o gate acima liga ela à ciência.
 *
 * Separada em 16/10/2026 para a Pré-visualização do Quadro de Avisos mostrar
 * EXATAMENTE o que o colaborador vai ver (pedido do Pablo: escolher o tamanho
 * da imagem e conferir antes de lançar). Uma cópia da janela na tela de
 * criação divergiria na primeira correção, e a prévia passaria a mentir.
 *
 * Com `previa`, ganha uma faixa por cima avisando que nada é gravado e um
 * jeito de sair; os botões continuam lá, mas quem chama decide o que fazem.
 */
export function JanelaAviso({ aviso, enviando = null, onEscolher, onAdiar, restantes = 0, previa }: {
  aviso: Notificacao;
  enviando?: string | null;
  /** `resposta` = o texto do botão, quando o aviso tem botões próprios. */
  onEscolher: (escolha: Escolha, resposta?: string) => void;
  onAdiar: () => void;
  restantes?: number;
  previa?: { aoFechar: () => void };
}) {
  const tamanho = tamanhoImagemDe(aviso.imagens_tamanho);
  const botoes = botoesDoAviso(aviso);
  // Imagem grande pede mais altura de leitura; o resto fica como sempre foi.
  const alturaCorpo = tamanho === "grande" || tamanho === "total" ? "max-h-[70vh]" : "max-h-[50vh]";
  return (
    <div
      className={cn("fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-sm", previa && "pt-16")}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="notificacao-titulo"
    >
      {previa && (
        <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-3 bg-primary px-4 py-2 text-sm text-primary-foreground">
          <span>Pré-visualização — é assim que o colaborador vai ver. Nada é gravado.</span>
          <Button size="sm" variant="secondary" onClick={previa.aoFechar}>Voltar à edição</Button>
        </div>
      )}
      <div className={cn("w-full overflow-hidden rounded-xl bg-background shadow-2xl", larguraJanelaAviso(tamanho))}>
        <div className="flex items-start gap-3 border-b bg-amber-50 px-5 py-4 dark:bg-amber-950/30">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
            <AlertCircle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="notificacao-titulo" className="text-base font-bold leading-tight">
              {aviso.titulo}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Publicado em {fmtDataHora(aviso.publicado_em)}
              {aviso.criado_por_nome ? ` · ${aviso.criado_por_nome}` : ""}
            </p>
          </div>
          {/* Sem bloqueio, dá para adiar. Com bloqueio não há X: uma saída
              que não registra ciência é exatamente o que o aviso evita. */}
          {!aviso.bloquear_acesso && (
            <button
              type="button"
              onClick={onAdiar}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-black/5"
              aria-label="Ver depois"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className={cn(alturaCorpo, "overflow-y-auto px-5 py-4")}>
          {/* A imagem vem ANTES do texto: quando o aviso é um cartaz, ela é o
              aviso, e o texto é a legenda. `object-contain` porque cartaz
              cortado no meio deixa de comunicar o que veio comunicar.

              `aspect-video` reserva a altura ANTES de o arquivo chegar. Sem
              isso o aviso abria sem imagem nenhuma, o texto subia no lugar
              dela, e num aviso que bloqueia a tela a pessoa respondia antes de
              o cartaz aparecer — foi o "a imagem não aparece" de 10/09/2026. */}
          {/* Imagens (carrossel/grade), texto com URLs clicáveis e os links
              com nome — o mesmo bloco do Quadro e do Início (ConteudoAviso). */}
          <ConteudoAviso aviso={aviso} prioridade />
          {/* Comentários e reações (16/10/2026). Na prévia, a área aparece
              desligada: o aviso ainda não existe para ter comentário. */}
          <ComentariosAviso aviso={aviso} previa={!!previa} />
        </div>

        <div className="flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:justify-end">
          {botoes.length > 0 ? (
            // Botões escolhidos por quem publicou (16/10/2026). Todos gravam
            // CIENTE + o texto do botão: a escolha continua respondendo "quem
            // respondeu?", e o texto responde "o quê".
            botoes.map((b, k) => (
              <Button key={k} variant={varianteDoBotao(b.estilo)} disabled={!!enviando}
                      onClick={() => onEscolher("CIENTE", b.rotulo)}>
                {enviando === b.rotulo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {b.rotulo}
              </Button>
            ))
          ) : aviso.permitir_escolha ? (
            <>
              <Button
                variant="outline"
                disabled={!!enviando}
                onClick={() => onEscolher("DISCORDO")}
              >
                {enviando === "DISCORDO" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Discordo
              </Button>
              <Button disabled={!!enviando} onClick={() => onEscolher("CONCORDO")}>
                {enviando === "CONCORDO" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Concordo
              </Button>
            </>
          ) : (
            // Sem escolha, um botão só. Dois botões que gravam a mesma coisa
            // seriam uma pergunta falsa.
            <Button disabled={!!enviando} onClick={() => onEscolher("CIENTE")}>
              {enviando === "CIENTE" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Estou ciente
            </Button>
          )}
        </div>

        {aviso.bloquear_acesso ? (
          <p className="border-t bg-muted/40 px-5 py-2 text-center text-xs text-muted-foreground">
            Você precisa registrar sua resposta para continuar utilizando o sistema.
          </p>
        ) : (
          <p className="border-t px-5 py-2 text-center text-xs text-muted-foreground">
            Pode responder depois — o aviso volta na próxima vez que você entrar.
          </p>
        )}

        {restantes > 0 && (
          <p className="border-t px-5 py-2 text-center text-xs text-muted-foreground">
            Mais {restantes} aviso(s) depois deste.
          </p>
        )}
      </div>
    </div>
  );
}
