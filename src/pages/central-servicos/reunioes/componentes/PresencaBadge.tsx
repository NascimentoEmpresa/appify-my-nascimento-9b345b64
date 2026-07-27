import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_PRESENCA_LABEL, statusPresenca, type StatusPresenca } from "../types";

const ESTILO: Record<StatusPresenca, string> = {
  confirmada: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pendente: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  recusada: "border-destructive/30 bg-destructive/10 text-destructive",
};

const ICONE: Record<StatusPresenca, typeof CheckCircle2> = {
  confirmada: CheckCircle2,
  pendente: Clock,
  recusada: XCircle,
};

export function PresencaBadge({ presente, className }: { presente: boolean | null; className?: string }) {
  const status = statusPresenca(presente);
  const Icone = ICONE[status];
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", ESTILO[status], className)}>
      <Icone className="h-3 w-3" /> {STATUS_PRESENCA_LABEL[status]}
    </Badge>
  );
}
