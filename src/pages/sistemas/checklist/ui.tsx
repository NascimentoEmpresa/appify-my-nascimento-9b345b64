import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { opcaoDe, type Etapa, type Tom } from "@/lib/sistemas/checklistModulos";

// Peças visuais do Checklist de Módulos. Cor de status SEMPRE com o rótulo
// escrito ao lado (nunca a cor sozinha).

export const MENU_CHECKLIST = "sistemas_checklist_modulos";

export const CLASSE_TOM: Record<Tom, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  progresso: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  atencao: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  risco: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  neutro: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  pendente: "border-dashed border-slate-300 bg-transparent text-muted-foreground dark:border-slate-600",
};
export const PONTO_TOM: Record<Tom, string> = {
  ok: "bg-emerald-500", progresso: "bg-blue-500", atencao: "bg-amber-500", risco: "bg-red-500", neutro: "bg-slate-400", pendente: "bg-slate-300",
};

/** Etiqueta do status de uma etapa; vazio = "Pendente" tracejado. */
export function StatusPill({ etapa, valor, compacto }: { etapa: Etapa; valor: string | null | undefined; compacto?: boolean }) {
  const o = opcaoDe(etapa, valor);
  const tom: Tom = o?.tom ?? "pendente";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold",
      compacto ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-0.5 text-[11px]", CLASSE_TOM[tom])}
      title={o ? undefined : "Pendente de preenchimento"}>
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PONTO_TOM[tom])} />
      {o?.rotulo ?? "Pendente"}
    </span>
  );
}

export function Etiqueta({ tom, children, className }: { tom: Tom; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", CLASSE_TOM[tom], className)}>
      {children}
    </span>
  );
}

/** Barra de efetividade 0–100% com o número ao lado. */
export function BarraEfetividade({ valor, largura = "w-24", vazio }: { valor: number; largura?: string; vazio?: boolean }) {
  const p = Math.round(valor * 100);
  const cor = vazio ? "bg-slate-300" : p >= 85 ? "bg-emerald-500" : p >= 50 ? "bg-blue-500" : p > 0 ? "bg-amber-500" : "bg-slate-300";
  return (
    <div className="flex items-center gap-2">
      <span className={cn("w-9 text-right text-xs font-bold tabular-nums", vazio ? "text-muted-foreground" : "text-foreground")}>{vazio ? "—" : `${p}%`}</span>
      <div className={cn("h-1.5 overflow-hidden rounded-full bg-muted", largura)}>
        <div className={cn("h-full rounded-full transition-[width] duration-500", cor)} style={{ width: `${vazio ? 0 : p}%` }} />
      </div>
    </div>
  );
}

export function Tile({ icone, rotulo, valor, sub, cor = "#0f3171", onClick, ativo }: {
  icone: ReactNode; rotulo: string; valor: string; sub?: ReactNode; cor?: string; onClick?: () => void; ativo?: boolean;
}) {
  const miolo = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${cor}17`, color: cor }}>{icone}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <p className="text-2xl font-extrabold leading-tight text-foreground">{valor}</p>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </>
  );
  return (
    <Card className={cn("overflow-hidden transition", onClick && "hover:-translate-y-0.5 hover:shadow-md", ativo && "ring-2 ring-offset-1")}
          style={ativo ? { ["--tw-ring-color" as string]: cor } : undefined}>
      {onClick
        ? <button type="button" onClick={onClick} className="flex w-full items-start gap-3 p-4 text-left">{miolo}</button>
        : <div className="flex w-full items-start gap-3 p-4">{miolo}</div>}
    </Card>
  );
}

export const fmtData = (s: string | null | undefined) => (s ? new Date(s.length <= 10 ? `${s}T12:00:00` : s).toLocaleDateString("pt-BR") : "—");
export const fmtDataHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const haQuanto = (s: string | null | undefined) => {
  if (!s) return "nunca";
  const min = Math.round((Date.now() - new Date(s).getTime()) / 60_000);
  if (min < 60) return min <= 1 ? "agora" : `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
};
