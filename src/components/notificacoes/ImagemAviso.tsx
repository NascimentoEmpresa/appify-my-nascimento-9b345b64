// A imagem do aviso, nos três lugares em que ela aparece: o gate que trava a
// tela, o Visualizar do Quadro e o mural do Início.
//
// POR QUE UM COMPONENTE, E NÃO UM <img> EM CADA TELA
//   10/09/2026: "as imagens não aparecem pra alguns". O arquivo do primeiro
//   aviso publicado tem 1672x941 e 1,57 MB. Um <img> solto, sem altura
//   reservada, deixa um vazio do tamanho de nada enquanto isso desce — e num
//   aviso que BLOQUEIA a tela a pessoa responde antes de a imagem chegar,
//   porque para ela não havia imagem nenhuma. Não era falha de permissão: o
//   bucket é público e o arquivo responde 200 para qualquer um.
//
//   Então aqui a caixa existe ANTES do arquivo: proporção reservada, um estado
//   de carregando que se vê, e um fallback que diz o que aconteceu em vez de
//   deixar o ícone de imagem quebrada. Quem está numa conexão ruim vê "abrindo
//   imagem", não um buraco.
import { useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ImagemAviso({
  url,
  nome,
  className,
  /** O gate mostra a imagem como conteúdo principal; o resto pode adiar. */
  prioridade = false,
}: {
  url: string;
  nome?: string | null;
  className?: string;
  prioridade?: boolean;
}) {
  const [estado, setEstado] = useState<"carregando" | "pronta" | "falhou">("carregando");

  if (estado === "falhou") {
    return (
      <div className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/40 p-6 text-center",
        className,
      )}>
        <ImageOff className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Não foi possível carregar a imagem deste aviso.
        </p>
        {/* O link é a saída de emergência: o texto do aviso continua valendo,
            mas quem precisa ver o cartaz consegue abrir direto. */}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium underline underline-offset-2"
        >
          Abrir em outra aba
        </a>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-lg border bg-muted/30", className)}>
      {estado === "carregando" && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Abrindo imagem…
        </div>
      )}
      <img
        src={url}
        alt={nome ?? ""}
        loading={prioridade ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setEstado("pronta")}
        onError={() => setEstado("falhou")}
        className={cn(
          "h-full w-full object-contain transition-opacity duration-200",
          estado === "pronta" ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
