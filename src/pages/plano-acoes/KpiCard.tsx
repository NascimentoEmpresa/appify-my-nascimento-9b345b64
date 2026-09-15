import type { ComponentType } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type KpiTone = "primary" | "success" | "warning" | "destructive" | "muted";

const TONE_CLS: Record<KpiTone, string> = {
  destructive: "text-destructive",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  primary: "text-primary",
  muted: "text-muted-foreground",
};

/** Quadradinho de indicador do Plano de Ações (Dashboard e Lista). Com onClick vira botão de filtro. */
export function KpiCard({ label, value, icon: Icon, tone, onClick, ativo }: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  tone?: KpiTone;
  onClick?: () => void;
  ativo?: boolean;
}) {
  const toneCls = tone ? TONE_CLS[tone] : "text-foreground";
  const conteudo = (
    <>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <Icon className={`h-3.5 w-3.5 ${toneCls}`} /> {label}
      </div>
      <div className={`mt-1 font-display text-2xl font-bold ${toneCls}`}>{value}</div>
    </>
  );
  if (!onClick) return <Card className="p-3">{conteudo}</Card>;
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={ativo}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={cn(
        "cursor-pointer p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ativo && "border-primary ring-1 ring-primary",
      )}
    >
      {conteudo}
    </Card>
  );
}
