import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  breadcrumb?: string[];
  module?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, breadcrumb = [], module = "Licitações", actions, className }: Props) {
  return (
    <div className={cn("mb-4 lg:mb-6", className)}>
      {breadcrumb.length > 0 && (
        <nav className="mb-2 hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          <span className="text-muted-foreground/70">ERP</span>
          <ChevronRight className="h-3 w-3" />
          <span className="font-medium">{module}</span>
          {breadcrumb.map((b, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3" />
              <span className={cn(i === breadcrumb.length - 1 && "text-foreground font-semibold")}>{b}</span>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl lg:text-3xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
