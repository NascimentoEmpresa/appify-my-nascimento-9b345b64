// O conteúdo de um aviso, do jeito que aparece nos três lugares (o gate que
// trava a tela, o Visualizar do Quadro e o mural do Início): as imagens, o
// texto e os links.
//
// 21/09/2026 (pedido do Pablo): o aviso passou a ter VÁRIAS imagens — em
// carrossel (passa pro lado) ou em grade (todas de uma vez) —, links com
// nome escolhido por quem escreve ("Abrir formulário"), e URL colada no
// meio do texto vira link clicável em vez de ficar como texto morto.
//
// Um componente só pelas mesmas razões da ImagemAviso: três telas com três
// cópias divergiriam na primeira correção.
import { useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { ImagemAviso } from "@/components/notificacoes/ImagemAviso";
import { imagensDoAviso, type ImagemDoAviso, type LinkDoAviso, type Notificacao } from "@/lib/notificacoes";
import { cn } from "@/lib/utils";

/** URL http(s) ou www. no meio do texto. O `.`/`,`/`)` final fica fora do link. */
const REGEX_URL = /((?:https?:\/\/|www\.)[^\s<>"']+?)(?=[.,;:!?)\]]*(?:\s|$))/gi;

/** O texto do aviso com as URLs clicáveis. Parágrafo e lista continuam valendo (pre-wrap). */
export function TextoComLinks({ texto, className }: { texto: string; className?: string }) {
  const partes: (string | { url: string })[] = [];
  let ultimo = 0;
  for (const m of texto.matchAll(REGEX_URL)) {
    const i = m.index ?? 0;
    if (i > ultimo) partes.push(texto.slice(ultimo, i));
    partes.push({ url: m[1] });
    ultimo = i + m[1].length;
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo));
  return (
    <p className={cn("whitespace-pre-wrap text-sm leading-relaxed", className)}>
      {partes.map((p, i) => typeof p === "string" ? p : (
        <a key={i} href={p.url.startsWith("www.") ? `https://${p.url}` : p.url} target="_blank" rel="noreferrer"
           className="break-all font-medium text-primary underline underline-offset-2">{p.url}</a>
      ))}
    </p>
  );
}

/** Os botões de link do aviso — o nome é o que quem escreveu escolheu. */
export function LinksAviso({ links, className }: { links: LinkDoAviso[]; className?: string }) {
  const validos = links.filter((l) => l.url.trim());
  if (!validos.length) return null;
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {validos.map((l, i) => (
        <a key={i} href={l.url.startsWith("www.") ? `https://${l.url}` : l.url} target="_blank" rel="noreferrer"
           className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10">
          <ExternalLink className="h-3.5 w-3.5" /> {l.rotulo.trim() || "Link"}
        </a>
      ))}
    </div>
  );
}

/**
 * As imagens do aviso. Uma só: igual a antes. Várias: carrossel com setas e
 * bolinhas, ou grade de duas colunas — escolha de quem publicou.
 */
export function GaleriaAviso({ imagens, layout, prioridade = false, className }: {
  imagens: ImagemDoAviso[];
  layout: "carrossel" | "grade";
  prioridade?: boolean;
  className?: string;
}) {
  const [i, setI] = useState(0);
  const lista = imagens.filter((im) => im.url);
  if (!lista.length) return null;
  const atual = lista[Math.min(i, lista.length - 1)];

  if (lista.length === 1 || layout === "grade") {
    return (
      <div className={cn(lista.length === 1 ? "" : "grid gap-2 sm:grid-cols-2", className)}>
        {lista.map((im, k) => (
          <div key={k}>
            <ImagemAviso url={im.url} nome={im.nome} prioridade={prioridade && k === 0} className="aspect-video w-full" />
            <a href={im.url} target="_blank" rel="noreferrer"
               className="mt-1 inline-block text-xs text-muted-foreground underline underline-offset-2">
              Ver imagem em tamanho real
            </a>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="relative">
        {/* key na imagem: trocar de slide reinicia o estado de carregamento. */}
        <ImagemAviso key={atual.url} url={atual.url} nome={atual.nome} prioridade className="aspect-video w-full" />
        <button type="button" aria-label="Imagem anterior"
                onClick={() => setI((v) => (v - 1 + lista.length) % lista.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-1.5 shadow hover:bg-background">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Próxima imagem"
                onClick={() => setI((v) => (v + 1) % lista.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-background/90 p-1.5 shadow hover:bg-background">
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="absolute bottom-2 right-2 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-semibold shadow">
          {Math.min(i, lista.length - 1) + 1} / {lista.length}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <a href={atual.url} target="_blank" rel="noreferrer"
           className="text-xs text-muted-foreground underline underline-offset-2">
          Ver imagem em tamanho real
        </a>
        <div className="flex gap-1">
          {lista.map((_, k) => (
            <button key={k} type="button" aria-label={`Imagem ${k + 1}`} onClick={() => setI(k)}
                    className={cn("h-2 w-2 rounded-full", k === Math.min(i, lista.length - 1) ? "bg-primary" : "bg-muted-foreground/30")} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Imagens + texto + links, na ordem em que o aviso é lido. */
export function ConteudoAviso({ aviso, prioridade = false }: { aviso: Notificacao; prioridade?: boolean }) {
  const imagens = imagensDoAviso(aviso);
  return (
    <div className="space-y-3">
      {imagens.length > 0 && (
        <GaleriaAviso imagens={imagens} layout={aviso.imagens_layout === "grade" ? "grade" : "carrossel"} prioridade={prioridade} />
      )}
      <TextoComLinks texto={aviso.mensagem} />
      <LinksAviso links={aviso.links ?? []} />
    </div>
  );
}
