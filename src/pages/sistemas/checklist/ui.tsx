import type { ReactNode } from "react";
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, Clock, MinusCircle, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { opcaoDe, type Etapa, type Tom, type Variacao } from "@/lib/sistemas/checklistModulos";

// Peças visuais do Controle de Efetividade dos Módulos (Checklist de
// Módulos). Cor de status SEMPRE com o rótulo escrito ao lado.

export const MENU_CHECKLIST = "sistemas_checklist_modulos";
export const MARINHO = "#0f2a5c";

export const CLASSE_TOM: Record<Tom, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  andamento: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300",
  atencao: "border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300",
  progresso: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  risco: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  neutro: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  pendente: "border-dashed border-slate-300 bg-transparent text-muted-foreground dark:border-slate-600",
};
export const PONTO_TOM: Record<Tom, string> = {
  ok: "bg-emerald-500", andamento: "bg-orange-500", atencao: "bg-yellow-500", progresso: "bg-blue-500",
  risco: "bg-red-500", neutro: "bg-slate-400", pendente: "bg-slate-300",
};
export const HEX_TOM: Record<Tom, string> = {
  ok: "#16a34a", andamento: "#f97316", atencao: "#eab308", progresso: "#3b82f6", risco: "#dc2626", neutro: "#94a3b8", pendente: "#e2e8f0",
};

const ICONE_TOM: Partial<Record<Tom, typeof CheckCircle2>> = {
  ok: CheckCircle2, risco: XCircle, andamento: Clock, atencao: AlertCircle, progresso: Clock, neutro: MinusCircle,
};

/**
 * Etiqueta do status. Desenvolvimento usa o ponto (como o modelo);
 * treinamento e validação, o ícone. Vazio = "Pendente" tracejado.
 */
export function StatusPill({ etapa, valor, compacto, calculado }: { etapa: Etapa; valor: string | null | undefined; compacto?: boolean; calculado?: boolean }) {
  const o = opcaoDe(etapa, valor);
  const tom: Tom = o?.tom ?? "pendente";
  const Icone = ICONE_TOM[tom];
  const comIcone = etapa !== "dev" && !!o && !!Icone;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold",
      compacto ? "px-2 py-0.5 text-[10.5px]" : "px-2.5 py-[3px] text-[11.5px]", CLASSE_TOM[tom])}
      title={!o ? "Pendente de preenchimento" : calculado ? "Calculado pelas telas do módulo" : undefined}>
      {comIcone && Icone ? <Icone className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} /> : <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PONTO_TOM[tom])} />}
      {o?.rotulo ?? "Pendente"}
      {calculado && <span className="text-[9px] font-bold opacity-60">•</span>}
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

/** Barra de efetividade: verde a partir de 85%, azul abaixo (como o modelo). */
export function BarraEfetividade({ valor, largura = "w-24", vazio }: { valor: number | null; largura?: string; vazio?: boolean }) {
  const sem = vazio || valor == null;
  const p = sem ? 0 : Math.round((valor ?? 0) * 100);
  const cor = p >= 85 ? "bg-emerald-600" : "bg-blue-600";
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("w-10 text-xs font-bold tabular-nums", sem ? "text-muted-foreground" : "text-foreground")}>{sem ? "—" : `${p}%`}</span>
      <div className={cn("h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700", largura)}>
        <div className={cn("h-full rounded-full transition-[width] duration-500", cor)} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/** Cartão de indicador do modelo: ícone redondo, número grande, rótulo e "vs. mês anterior". */
export function CardIndicador({ icone, cor, fundo, valor, rotulo, variacao }: {
  icone: ReactNode; cor: string; fundo: string; valor: string; rotulo: string; variacao: Variacao | null;
}) {
  return (
    <Card className="flex items-center gap-4 px-5 py-4">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full" style={{ background: fundo, color: cor }}>{icone}</span>
      <div className="min-w-0">
        <p className="text-[26px] font-extrabold leading-none tracking-tight text-foreground">{valor}</p>
        <p className="mt-1 text-[15px] text-foreground/80">{rotulo}</p>
        {variacao && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs">
            {variacao.sentido === "igual" ? <span className="font-bold text-muted-foreground">=</span>
              : variacao.sentido === "sobe" ? <ArrowUp className={cn("h-3.5 w-3.5", variacao.bom ? "text-emerald-600" : "text-red-600")} strokeWidth={3} />
              : <ArrowDown className={cn("h-3.5 w-3.5", variacao.bom ? "text-emerald-600" : "text-red-600")} strokeWidth={3} />}
            <span className={cn("font-bold", variacao.bom == null ? "text-muted-foreground" : variacao.bom ? "text-emerald-600" : "text-red-600")}>{variacao.texto}</span>
            <span className="text-muted-foreground">vs. mês anterior</span>
          </p>
        )}
      </div>
    </Card>
  );
}

/** Cartão compacto de número (aba Uso do ERP). */
export function Tile({ icone, rotulo, valor, sub, cor = "#0f3171" }: {
  icone: ReactNode; rotulo: string; valor: string; sub?: ReactNode; cor?: string;
}) {
  return (
    <Card className="flex w-full items-start gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${cor}17`, color: cor }}>{icone}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        <p className="text-2xl font-extrabold leading-tight text-foreground">{valor}</p>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </div>
    </Card>
  );
}

export const fmtData = (s: string | null | undefined) => (s ? new Date(s.length <= 10 ? `${s}T12:00:00` : s).toLocaleDateString("pt-BR") : "—");
export const fmtDataHora = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "") : "—";
export const fmtDataHoraAs = (s: string | null | undefined) =>
  s ? `${new Date(s).toLocaleDateString("pt-BR")} às ${new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "—";
export const haQuanto = (s: string | null | undefined) => {
  if (!s) return "nunca";
  const min = Math.round((Date.now() - new Date(s).getTime()) / 60_000);
  if (min < 60) return min <= 1 ? "agora" : `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ontem" : `há ${d} dias`;
};
