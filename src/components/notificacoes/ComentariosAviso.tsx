// Comentários e reações de um aviso (16/10/2026, pedido do Pablo: "liberar as
// pessoas pra comentar, se quiser comentar anonimamente também, os comentários
// ficam no aviso, podendo reagir com emojis").
//
// Vai abaixo do conteúdo nos três lugares em que o aviso abre (o gate, o
// Visualizar do Quadro e o mural do Início) — um componente só pelo mesmo
// motivo do ConteudoAviso. Só existe quando o aviso tem permitir_comentarios.
//
// ANÔNIMO: a tela só manda `anonimo: true`; quem apaga o autor é o gatilho do
// banco (ver a migration 20261016000003). Por isso o comentário anônimo não
// tem lixeira para o próprio autor — o banco não sabe que é dele. Quem
// gerencia o Quadro apaga qualquer um.
import { useState } from "react";
import { Loader2, MessageCircle, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useComentariosAviso } from "@/hooks/useComentariosAviso";
import {
  EMOJIS, LIMITE_COMENTARIOS, MAX_COMENTARIO, autorDoComentario, fmtDataHora, resumoReacoes,
  type Notificacao, type ReacaoAviso,
} from "@/lib/notificacoes";
import { cn } from "@/lib/utils";

/** A linha de reações de um alvo + o botão de escolher emoji. */
function LinhaReacoes({ reacoes, comentarioId, eu, onReagir, desligado = false }: {
  reacoes: ReacaoAviso[];
  comentarioId: number | null;
  eu: string | null;
  onReagir: (emoji: string) => void;
  desligado?: boolean;
}) {
  const resumo = resumoReacoes(reacoes, comentarioId, eu);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {resumo.map((r) => (
        <button key={r.emoji} type="button" disabled={desligado} onClick={() => onReagir(r.emoji)}
          className={cn("rounded-full px-2 py-0.5 text-xs transition-colors",
            r.minha ? "bg-primary/10 text-primary ring-1 ring-primary/30" : "bg-muted/60 hover:bg-muted")}
          aria-label={`${r.emoji} ${r.total}${r.minha ? " (sua reação)" : ""}`}>
          {r.emoji} {r.total}
        </button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" disabled={desligado} aria-label="Reagir"
            className="rounded-full px-1.5 py-0.5 text-muted-foreground hover:bg-muted disabled:opacity-50">
            <SmilePlus className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        {/* z acima do gate (z-[100]), senão o seletor abre por baixo dele. */}
        <PopoverContent className="z-[110] flex w-auto gap-1 p-1.5" align="start">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => onReagir(e)}
              className="rounded p-1 text-lg leading-none hover:bg-muted" aria-label={`Reagir com ${e}`}>
              {e}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * `previa`: a área aparece DESLIGADA (sem consulta, sem envio) — quem está
 * criando vê onde os comentários vão ficar, sem que exista aviso ainda.
 */
export function ComentariosAviso({ aviso, previa = false }: { aviso: Notificacao; previa?: boolean }) {
  // Aviso sem comentários não monta nada — nem os hooks, nem as consultas.
  if (!aviso.permitir_comentarios) return null;
  // key: trocar de aviso (o gate passa ao próximo) zera o que estava digitado.
  return <AreaComentarios key={aviso.id} aviso={aviso} previa={previa} />;
}

function AreaComentarios({ aviso, previa }: { aviso: Notificacao; previa: boolean }) {
  const {
    comentarios, reacoes, carregando, erro, eu, podeModerar, comentar, apagar, reagir,
  } = useComentariosAviso(aviso.id, !previa);
  const [texto, setTexto] = useState("");
  const [anonimo, setAnonimo] = useState(false);

  const reagirCom = (emoji: string, comentarioId: number | null) =>
    reagir.mutate({ emoji, comentarioId }, {
      onError: (e) => toast.error(e instanceof Error ? e.message : "Não deu para reagir."),
    });

  const enviar = async () => {
    const t = texto.trim();
    if (!t) return;
    try {
      await comentar.mutateAsync({ texto: t, anonimo: !!aviso.permitir_anonimo && anonimo });
      setTexto("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não deu para comentar.");
    }
  };

  return (
    <div className="mt-5 border-t border-border/60 pt-4">
      {/* Mais leve (16/10/2026): sem caixas cinza por comentário, títulos
          discretos — o aviso é o protagonista, a conversa vem embaixo. */}
      {/* Reação ao aviso em si. */}
      <LinhaReacoes reacoes={reacoes} comentarioId={null} eu={eu} desligado={previa}
                    onReagir={(e) => reagirCom(e, null)} />

      <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <MessageCircle className="h-3.5 w-3.5" /> Comentários
        {!previa && comentarios.length > 0 && (
          <span className="font-normal text-muted-foreground">({comentarios.length})</span>
        )}
      </div>

      {previa ? (
        <p className="mt-2 rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
          Pré-visualização: os comentários e as reações aparecem aqui depois de publicado.
        </p>
      ) : (
        <ul className="mt-2 space-y-1">
          {carregando && (
            <li className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando comentários…
            </li>
          )}
          {erro && <li className="text-xs text-destructive">Não deu para carregar os comentários.</li>}
          {!carregando && !erro && comentarios.length === 0 && (
            <li className="text-xs text-muted-foreground">Ninguém comentou ainda.</li>
          )}
          {comentarios.length >= LIMITE_COMENTARIOS && (
            <li className="text-xs text-muted-foreground">Mostrando os {LIMITE_COMENTARIOS} mais recentes.</li>
          )}
          {comentarios.map((c) => {
            // Anônimo não tem dono no banco: nem o autor apaga, só quem modera.
            const meu = !!eu && c.user_id === eu;
            return (
              <li key={c.id} className="rounded-xl px-3 py-2 transition-colors hover:bg-muted/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className={cn("text-xs font-semibold", c.anonimo && "italic text-muted-foreground")}>
                      {autorDoComentario(c)}{meu && " (você)"}
                    </span>
                    <span className="ml-2 text-[11px] text-muted-foreground">{fmtDataHora(c.criado_em)}</span>
                  </div>
                  {(meu || podeModerar) && (
                    <button type="button" aria-label="Apagar comentário" disabled={apagar.isPending}
                      className="rounded p-1 text-muted-foreground hover:bg-black/5 hover:text-destructive"
                      onClick={() => {
                        if (!window.confirm("Apagar este comentário?")) return;
                        apagar.mutate(c.id, {
                          onError: (e) => toast.error(e instanceof Error ? e.message : "Não deu para apagar."),
                        });
                      }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.texto}</p>
                <div className="mt-1.5">
                  <LinhaReacoes reacoes={reacoes} comentarioId={c.id} eu={eu}
                                onReagir={(e) => reagirCom(e, c.id)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 space-y-2">
        <Textarea rows={2} maxLength={MAX_COMENTARIO} disabled={previa || comentar.isPending}
          className="min-h-[2.75rem] resize-none rounded-xl border-transparent bg-muted/40 focus-visible:bg-background"
          placeholder={previa ? "Comentários desligados na pré-visualização" : "Escreva um comentário…"}
          value={texto} onChange={(e) => setTexto(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {aviso.permitir_anonimo ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={anonimo} disabled={previa} onCheckedChange={(v) => setAnonimo(v === true)} />
              Comentar como anônimo (seu nome não é gravado)
            </label>
          ) : <span />}
          <Button size="sm" disabled={previa || !texto.trim() || comentar.isPending} onClick={enviar}>
            {comentar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Comentar
          </Button>
        </div>
      </div>
    </div>
  );
}
