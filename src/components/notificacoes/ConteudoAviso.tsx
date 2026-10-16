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
import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { ImagemAviso } from "@/components/notificacoes/ImagemAviso";
import {
  classeCaixaImagem, imagensDoAviso, larguraColunaImagem, posicaoImagemDe, tamanhoImagemDe,
  type ImagemDoAviso, type LinkDoAviso, type Notificacao, type TamanhoImagem,
} from "@/lib/notificacoes";
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
 *
 * `tamanho` (16/10/2026) é a caixa de cada imagem — ver classeCaixaImagem.
 * Sem ele, a caixa 16:9 de sempre.
 */
export function GaleriaAviso({ imagens, layout, tamanho = "", prioridade = false, className, classeCaixa }: {
  imagens: ImagemDoAviso[];
  layout: "carrossel" | "grade";
  tamanho?: TamanhoImagem;
  prioridade?: boolean;
  className?: string;
  /** Troca a caixa de cada imagem (a imagem ao lado do texto usa a dela). */
  classeCaixa?: string;
}) {
  const caixa = classeCaixa ?? classeCaixaImagem(tamanho);
  const [i, setI] = useState(0);
  const lista = imagens.filter((im) => im.url);
  if (!lista.length) return null;
  const atual = lista[Math.min(i, lista.length - 1)];

  if (lista.length === 1 || layout === "grade") {
    return (
      <div className={cn(lista.length === 1 ? "" : "grid gap-2 sm:grid-cols-2", className)}>
        {lista.map((im, k) => (
          <div key={k}>
            <ImagemAviso url={im.url} nome={im.nome} prioridade={prioridade && k === 0} className={caixa} />
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
        <ImagemAviso key={atual.url} url={atual.url} nome={atual.nome} prioridade className={caixa} />
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

/**
 * A coluna da imagem ao lado do texto (16/10/2026, print do Pablo: o cartaz
 * quadrado ficava numa caixa cinza mais larga que ele, "cortado do lado").
 *
 *   · a imagem aparece no tamanho dela (encaixe "natural"), cantos
 *     arredondados nela mesma, sem moldura;
 *   · a coluna tem a largura da imagem: altura × proporção do arquivo,
 *     medida no onLoad (larguraColunaImagem);
 *   · quando a coluna não pode ter essa largura (paisagem muito larga, retrato
 *     muito fino), o fundo é a própria imagem desfocada e escurecida — nunca
 *     sobra cinza.
 *
 * Várias imagens viram carrossel aqui, mesmo que o aviso diga "grade": grade
 * de cartazes numa coluna com altura de tela não cabe.
 */
export function PainelImagemAviso({ aviso, altura, prioridade = false, ajustarLargura = true, className }: {
  aviso: Notificacao;
  /** Altura da imagem (valor CSS) — ver alturaImagemLado. */
  altura: string;
  prioridade?: boolean;
  /** false dentro de grade (o diálogo do mural), onde a coluna já tem largura. */
  ajustarLargura?: boolean;
  className?: string;
}) {
  const lista = imagensDoAviso(aviso);
  const [i, setI] = useState(0);
  const [proporcoes, setProporcoes] = useState<Record<string, number>>({});
  if (!lista.length) return null;
  const k = Math.min(i, lista.length - 1);
  const atual = lista[k];
  const estilo = {
    "--altura-imagem": altura,
    "--coluna-imagem": larguraColunaImagem(altura, proporcoes[atual.url]),
  } as CSSProperties;

  return (
    <div style={estilo} data-coluna-imagem=""
         className={cn("relative isolate shrink-0 overflow-hidden bg-slate-900",
                       ajustarLargura && "sm:w-[var(--coluna-imagem)]", className)}>
      {/* O fundo: a própria imagem, desfocada e escurecida. */}
      <img src={atual.url} alt="" aria-hidden="true"
           className="absolute inset-0 -z-10 h-full w-full scale-125 object-cover opacity-80 blur-2xl brightness-[0.45] saturate-150" />
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
        <div className="relative w-full">
          {/* key: trocar de slide reinicia o carregamento e a medida. */}
          <ImagemAviso key={atual.url} url={atual.url} nome={atual.nome} prioridade={prioridade} encaixe="natural"
                       aoCarregar={(r) => setProporcoes((m) => (m[atual.url] === r ? m : { ...m, [atual.url]: r }))}
                       className="h-[38dvh] w-full sm:h-[var(--altura-imagem)]" />
          {lista.length > 1 && (
            <>
              <button type="button" aria-label="Imagem anterior"
                      onClick={() => setI((v) => (v - 1 + lista.length) % lista.length)}
                      className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white backdrop-blur hover:bg-black/60">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" aria-label="Próxima imagem"
                      onClick={() => setI((v) => (v + 1) % lista.length)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-black/45 p-1.5 text-white backdrop-blur hover:bg-black/60">
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex w-full items-center justify-between gap-2">
          <a href={atual.url} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-[11px] font-medium text-white/75 hover:text-white">
            <ExternalLink className="h-3 w-3" /> Ver em tamanho real
          </a>
          {lista.length > 1 && (
            <div className="flex gap-1">
              {lista.map((_, j) => (
                <button key={j} type="button" aria-label={`Imagem ${j + 1}`} onClick={() => setI(j)}
                        className={cn("h-1.5 w-1.5 rounded-full", j === k ? "bg-white" : "bg-white/40")} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** O texto e os links do aviso — a coluna da direita na imagem ao lado. */
export function TextoAviso({ aviso, destaque = false }: { aviso: Notificacao; destaque?: boolean }) {
  return (
    <div className="space-y-4">
      {/* destaque: a coluna de texto do modal ao lado da imagem — letra um
          pouco maior e entrelinha de leitura, é o "corpo" do cartaz. */}
      <TextoComLinks texto={aviso.mensagem} className={destaque ? "text-[15px] leading-7 text-foreground/90" : undefined} />
      <LinksAviso links={aviso.links ?? []} />
    </div>
  );
}

/** As imagens do aviso como o aviso pede (layout e tamanho). */
export function ImagensDoAviso({ aviso, prioridade = false, classeCaixa }: {
  aviso: Notificacao; prioridade?: boolean; classeCaixa?: string;
}) {
  const imagens = imagensDoAviso(aviso);
  if (!imagens.length) return null;
  return (
    <GaleriaAviso imagens={imagens} layout={aviso.imagens_layout === "grade" ? "grade" : "carrossel"}
                  tamanho={tamanhoImagemDe(aviso.imagens_tamanho)} prioridade={prioridade} classeCaixa={classeCaixa} />
  );
}

/**
 * Imagens + texto + links, na ordem em que o aviso é lido. Com a imagem ao
 * lado (16/10/2026), duas colunas — que empilham em tela estreita.
 */
export function ConteudoAviso({ aviso, prioridade = false }: { aviso: Notificacao; prioridade?: boolean }) {
  const imagens = imagensDoAviso(aviso);
  if (imagens.length && posicaoImagemDe(aviso.imagens_posicao) === "lado") {
    return (
      <div className="grid items-start gap-5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <PainelImagemAviso aviso={aviso} prioridade={prioridade} altura="min(22rem, 50vh)" ajustarLargura={false}
                           className="rounded-xl" />
        <TextoAviso aviso={aviso} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {imagens.length > 0 && (
        <GaleriaAviso imagens={imagens} layout={aviso.imagens_layout === "grade" ? "grade" : "carrossel"}
                      tamanho={tamanhoImagemDe(aviso.imagens_tamanho)} prioridade={prioridade} />
      )}
      <TextoComLinks texto={aviso.mensagem} />
      <LinksAviso links={aviso.links ?? []} />
    </div>
  );
}
