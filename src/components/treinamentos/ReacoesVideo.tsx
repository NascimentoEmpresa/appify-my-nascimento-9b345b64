import { Eye, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

// =====================================================================
// Visualizações e curtidas de um vídeo de treinamento (mig 20261005000004).
// Só apresentação: quem conta e quem curte é a RPC de cada lado — o
// Treinamentos ERP (usuário logado) e as aulas do Portal do Colaborador.
//
// Pedido (05/10/2026): "quantas visualizações e curtidas cada vídeo teve…
// não só as que estão no youtube, tem que dar pra curtir no sistema".
// =====================================================================

const fmt = (n: number) => n.toLocaleString("pt-BR");

export interface NumerosVideo {
  visualizacoes: number;
  curtidas: number;
  curti: boolean;
}

/** Barra embaixo do vídeo: "N visualizações" e o botão Curtir com a contagem. */
export function ReacoesVideo({ numeros, onCurtir, curtindo = false, className }: {
  numeros: NumerosVideo | null | undefined; onCurtir?: () => void; curtindo?: boolean; className?: string;
}) {
  const n = numeros ?? { visualizacoes: 0, curtidas: 0, curti: false };
  return (
    <div className={cn("flex flex-wrap items-center gap-3 text-sm", className)}>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Eye className="h-4 w-4" /> {fmt(n.visualizacoes)} {n.visualizacoes === 1 ? "visualização" : "visualizações"}
      </span>
      <button type="button" onClick={onCurtir} disabled={!onCurtir || curtindo} aria-pressed={n.curti}
        title={n.curti ? "Descurtir" : "Curtir este vídeo"}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold transition active:scale-95 disabled:opacity-60",
          n.curti ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/40" : "hover:bg-muted",
        )}>
        <Heart className={cn("h-4 w-4 transition", n.curti && "fill-rose-500 text-rose-500")} />
        {n.curti ? "Curtido" : "Curtir"} · {fmt(n.curtidas)}
      </button>
    </div>
  );
}

/** Versão compacta para card: "👁 29  ♥ 3". */
export function ReacoesVideoMini({ numeros, className }: { numeros: NumerosVideo | null | undefined; className?: string }) {
  if (!numeros) return null;
  return (
    <span className={cn("flex items-center gap-3 text-[11px] text-muted-foreground", className)}>
      <span className="flex items-center gap-1" title="Visualizações"><Eye className="h-3.5 w-3.5" /> {fmt(numeros.visualizacoes)}</span>
      <span className="flex items-center gap-1" title="Curtidas">
        <Heart className={cn("h-3.5 w-3.5", numeros.curti && "fill-rose-500 text-rose-500")} /> {fmt(numeros.curtidas)}
      </span>
    </span>
  );
}
