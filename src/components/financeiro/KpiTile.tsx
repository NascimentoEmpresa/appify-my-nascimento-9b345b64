import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// Extraído de FluxoCaixaGestao.tsx (SIS-2026-0160) — mesma técnica visual
// do TileDestaque em DespesaVisualizar.tsx (que por sua vez reaproveita o
// KpiCard de PainelExecutivo.tsx): ícone grande com máscara em degradê,
// sangrando pela borda direita do card. Ganhou um segundo uso em
// CartaoCredito.tsx (SIS-2026-0224).
const KPI_TILE_ICONE: Record<string, string> = {
  slate: "text-slate-300 dark:text-slate-700",
  emerald: "text-emerald-300 dark:text-emerald-800",
  red: "text-red-300 dark:text-red-900",
  sky: "text-sky-300 dark:text-sky-800",
  amber: "text-amber-300 dark:text-amber-800",
};

export function KpiTile({
  label,
  valor,
  icon,
  cor,
  valorClass,
}: {
  label: string;
  valor: string;
  icon: React.ReactNode;
  cor: keyof typeof KPI_TILE_ICONE;
  valorClass?: string;
}) {
  return (
    <Card>
      <CardContent className="relative overflow-hidden p-4">
        <div
          className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1"
          style={{
            WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
            maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          }}
        >
          <span className={cn("[&>svg]:h-16 [&>svg]:w-16", KPI_TILE_ICONE[cor])}>{icon}</span>
        </div>
        <p className="relative z-10 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn("relative z-10 text-2xl font-bold mt-1", valorClass)}>{valor}</p>
      </CardContent>
    </Card>
  );
}
