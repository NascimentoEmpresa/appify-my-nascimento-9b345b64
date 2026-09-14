import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusPrazoChecklist } from "@/hooks/useChecklistFaturamento";

// SIS-2026-0343: badge de "situação do prazo" no Dashboard do Checklist —
// mesmas 4 categorias do HTML de referência do Ruan (ok/atenção/atrasado/sem prazo).
const CLASSE: Record<StatusPrazoChecklist, string> = {
  ok: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  warn: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  late: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  neutral: "bg-muted text-muted-foreground border-border",
};

export function PrazoStatusBadge({ status, label }: { status: StatusPrazoChecklist; label: string }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap font-medium", CLASSE[status])}>{label}</Badge>;
}
