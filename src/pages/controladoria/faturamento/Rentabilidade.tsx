import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FAIXAS_RENTABILIDADE, faixaDaMargem, type FaixaRentabilidade } from "./regras";

// Cabeçalho de coluna com o ícone (i) que mostra como o número é calculado.
export function TituloComFormula({ titulo, formula, alinhar = "right" }: { titulo: ReactNode; formula: ReactNode; alinhar?: "left" | "right" | "center" }) {
  return (
    <span className={`inline-flex items-end gap-1 ${alinhar === "right" ? "justify-end" : alinhar === "center" ? "justify-center" : ""}`}>
      <span>{titulo}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" aria-label="Como é calculado" className="shrink-0 text-muted-foreground hover:text-foreground print:hidden">
            <Info className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px] space-y-1 text-xs font-normal normal-case leading-snug">{formula}</TooltipContent>
      </Tooltip>
    </span>
  );
}

const COR_FAIXA: Record<FaixaRentabilidade, { pill: string; barra: string }> = {
  excelente: { pill: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300", barra: "bg-emerald-500" },
  bom: { pill: "bg-lime-100 text-lime-800 dark:bg-lime-950/40 dark:text-lime-300", barra: "bg-lime-500" },
  atencao: { pill: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300", barra: "bg-amber-500" },
  critico: { pill: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300", barra: "bg-orange-500" },
  prejuizo: { pill: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300", barra: "bg-red-500" },
};

export const rotuloFaixa = (f: FaixaRentabilidade) => FAIXAS_RENTABILIDADE.find((x) => x.id === f)!.label;

export function pillDaMargem(margem: number | null): string {
  const f = faixaDaMargem(margem);
  return f ? COR_FAIXA[f].pill : "text-muted-foreground";
}

// Barra + rótulo da rentabilidade (coluna "Status" do mockup). A barra enche de
// 0 a 30% de margem; abaixo de zero fica cheia só no rótulo (sem barra).
export function StatusRentabilidade({ margem }: { margem: number | null }) {
  const f = faixaDaMargem(margem);
  if (!f || margem === null) return <span className="text-muted-foreground">—</span>;
  const largura = Math.max(0, Math.min(1, margem / 0.3)) * 100;
  return (
    <div className="flex items-center gap-1.5 min-w-[96px]">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${COR_FAIXA[f].barra}`} style={{ width: `${largura}%` }} />
      </div>
      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${COR_FAIXA[f].pill}`}>{rotuloFaixa(f)}</span>
    </div>
  );
}

// Texto das faixas para o tooltip da Margem / do Status.
export function FaixasTexto() {
  return (
    <ul className="space-y-0.5">
      {FAIXAS_RENTABILIDADE.map((f) => (
        <li key={f.id}>
          <strong>{f.label}</strong>: {f.intervalo}
        </li>
      ))}
    </ul>
  );
}
