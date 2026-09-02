import { useState } from "react";
import { BookOpen, MapPin, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { fluxoPorCodigo, sequenciaDe } from "@/lib/fluxos/resumo";

/**
 * O botão "Resumo de Funções" — a mesma explicação em toda tela do fluxo.
 *
 * Mora no `actions` do PageHeader, ao lado dos outros botões da tela. O texto
 * vem inteiro de `lib/fluxos/resumo.ts`: aqui só existe a apresentação, então
 * mudar uma etapa do processo nunca vira uma caça a JSX espalhado por cinco
 * páginas.
 *
 * A numeração dos passos é informação de verdade, não enfeite: o que a tela
 * responde é "em que ordem isso anda e quem é o próximo". Por isso cada passo
 * mostra também o STATUS que a solicitação carrega enquanto espera aquela
 * pessoa — é a ponte entre este texto e a coluna Status da lista.
 */
export function ResumoDeFuncoes({
  fluxo: codigos,
  variant = "outline",
  size = "sm",
}: {
  /**
   * Um código, ou vários. Vários só nas telas-hub, onde a pessoa lida com
   * mais de um sistema — Minhas Solicitações é o caso: de lá saem vaga,
   * férias, advertência e demissão.
   */
  fluxo: string | string[];
  variant?: "outline" | "ghost" | "secondary";
  size?: "sm" | "default";
}) {
  const lista = (Array.isArray(codigos) ? codigos : [codigos])
    .map(fluxoPorCodigo)
    .filter((f): f is NonNullable<typeof f> => !!f);

  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState(0);

  // Um botão de ajuda que não sabe o que explicar não deve existir na tela.
  if (!lista.length) return null;

  const fluxo = lista[Math.min(escolhido, lista.length - 1)];

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setAberto(true)}>
        <BookOpen className="mr-2 h-4 w-4" /> Resumo de Funções
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{fluxo.nome}</DialogTitle>
            <DialogDescription>{fluxo.paraQue}</DialogDescription>
          </DialogHeader>

          {/* Com mais de um sistema na tela, a escolha vem antes de tudo — é a
              primeira pergunta ("qual deles?"), não um filtro do resultado. */}
          {lista.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {lista.map((f, i) => (
                <Button
                  key={f.codigo}
                  variant={i === escolhido ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setEscolhido(i)}
                >
                  {f.nome}
                </Button>
              ))}
            </div>
          )}

          {/* A sequência inteira antes do detalhe: quem só quer saber "quem vem
              depois de mim" para de ler aqui. */}
          <div className="rounded-lg border bg-muted/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              O caminho
            </p>
            <p className="mt-1 text-sm font-medium">{sequenciaDe(fluxo)}</p>
          </div>

          <ol className="space-y-3">
            {fluxo.passos.map((p, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.quem}</span>
                    {p.status && (
                      <Badge variant="secondary" className="font-normal">{p.status}</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">{p.faz}</p>
                  {p.onde && (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" /> {p.onde}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {fluxo.observacoes && fluxo.observacoes.length > 0 && (
            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Info className="h-3.5 w-3.5" /> Bom saber
              </p>
              <ul className="space-y-1.5">
                {fluxo.observacoes.map((o, i) => (
                  <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                    <span className="text-muted-foreground/60">•</span>
                    <span>{o}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
