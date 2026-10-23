import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUrlsImagens } from "@/hooks/useDocumentosSolicitados";
import { ehImagem, type AnexoDocumento } from "@/lib/rh/documentosSolicitados";

// =====================================================================
// RH › Documentos — imagens anexadas (mig 20261022000500). Imagem é anexo
// comum (image/*) no bucket privado rh-documentos; aqui vira miniatura no
// card, no detalhe e na janela de assinatura. Clicar abre a imagem inteira.
// =====================================================================

type AnexoImagem = Pick<AnexoDocumento, "id" | "storage_path" | "nome_arquivo" | "mime_type">;

/** Só as imagens dos anexos, na ordem em que vieram. */
const imagensDe = <T extends AnexoImagem>(anexos: T[] | null | undefined): T[] => (anexos ?? []).filter(ehImagem);

/** Grade sem consulta própria: a página que lista vários cards pede as URLs de todos de uma vez. */
export function GradeImagens({ imagens, urls, tamanho = "medio", max, semLink }: {
  imagens: AnexoImagem[]; urls: Record<string, string> | undefined; tamanho?: "pequeno" | "medio" | "grande"; max?: number;
  /** Dentro de um card que já é botão: miniatura sem link (link dentro de botão não vale). */
  semLink?: boolean;
}) {
  if (!imagens.length) return null;
  const mostrar = max ? imagens.slice(0, max) : imagens;
  const sobra = imagens.length - mostrar.length;
  const caixa = tamanho === "pequeno" ? "h-14 w-14" : tamanho === "medio" ? "h-24 w-24" : "h-40 w-full sm:w-56";
  return (
    <div className="flex flex-wrap gap-2">
      {mostrar.map((a, i) => {
        const url = urls?.[a.storage_path];
        const ultimo = sobra > 0 && i === mostrar.length - 1;
        const conteudo = (
          <>
            {url
              ? <img src={url} alt={a.nome_arquivo ?? "Imagem"} loading="lazy" className="h-full w-full object-cover" />
              : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
            {ultimo && <span className="absolute inset-0 grid place-items-center bg-black/50 text-sm font-semibold text-white">+{sobra}</span>}
          </>
        );
        const classe = cn("relative grid shrink-0 place-items-center overflow-hidden rounded-md border bg-muted/40", caixa);
        if (semLink) return <span key={a.id} title={a.nome_arquivo ?? undefined} className={classe}>{conteudo}</span>;
        return (
          <a key={a.id} href={url} target="_blank" rel="noreferrer" title={a.nome_arquivo ?? undefined}
            onClick={(e) => { e.stopPropagation(); if (!url) e.preventDefault(); }} className={classe}>
            {conteudo}
          </a>
        );
      })}
    </div>
  );
}

/** Grade com a própria consulta das URLs — para quando há uma só solicitação na tela. */
export function ImagensDocumento({ anexos, tamanho, max }: { anexos: AnexoImagem[] | null | undefined; tamanho?: "pequeno" | "medio" | "grande"; max?: number }) {
  const imagens = imagensDe(anexos);
  const urls = useUrlsImagens(imagens.map((a) => a.storage_path));
  return <GradeImagens imagens={imagens} urls={urls.data} tamanho={tamanho} max={max} />;
}
