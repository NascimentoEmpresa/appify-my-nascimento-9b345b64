import type { ComponentType, ReactNode } from "react";
import { AlertCircle, ArrowDown, ArrowUp, CalendarDays, Equal, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { rotuloCompetencia, type Medida, type Variacao } from "@/lib/operacional/painelExecutivo";
import { cn } from "@/lib/utils";

// =====================================================================
// Operacional › Indicadores: peças comuns das telas 2 a 5 (09/11/2026),
// no mesmo desenho do Painel Executivo (tela 1).
// Regra de todas: card sem fonte ou sem dado fica SEM número, nunca zero.
// =====================================================================

export type CorIcone = "azul" | "verde" | "laranja" | "vermelho" | "cinza";

const CORES: Record<CorIcone, string> = {
  azul: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  verde: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  laranja: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  vermelho: "bg-red-500/10 text-red-600 dark:text-red-400",
  cinza: "bg-muted text-muted-foreground",
};

const COR_VARIACAO = {
  melhor: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pior: "bg-red-500/10 text-red-700 dark:text-red-400",
  neutro: "bg-muted text-muted-foreground",
};

export interface KpiProps {
  titulo: string;
  valor: string | null;
  icone: ComponentType<{ className?: string }>;
  cor: CorIcone;
  medida?: Medida;
  variacao?: Variacao | null;
  /** Texto ao lado da variação; padrão "vs. mês anterior". */
  rotuloVariacao?: string;
  aviso?: string | null;
}

export function Kpi({ titulo, valor, icone: Icone, cor, medida = "real", variacao, rotuloVariacao = "vs. mês anterior", aviso }: KpiProps) {
  const Seta = variacao?.seta === "sobe" ? ArrowUp : variacao?.seta === "desce" ? ArrowDown : Equal;
  return (
    <Card className="flex items-start gap-3 p-4">
      <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg", CORES[cor])}>
        <Icone className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm text-muted-foreground">{titulo}</p>
          {medida !== "real" && (
            <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {medida === "parcial" ? "Parcial" : "Sem fonte"}
            </span>
          )}
        </div>
        {valor !== null ? (
          <p className="mt-0.5 truncate text-xl font-bold tabular-nums text-foreground">{valor}</p>
        ) : (
          <p className="mt-0.5 flex h-7 items-center text-muted-foreground" aria-label="Sem número"><Minus className="h-5 w-5" /></p>
        )}
        {variacao && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-medium tabular-nums", COR_VARIACAO[variacao.sentido])}>
              <Seta className="h-3 w-3" />{variacao.texto}
            </span>
            {rotuloVariacao}
          </p>
        )}
        {aviso && <p className="mt-1 text-xs text-muted-foreground">{aviso}</p>}
      </div>
    </Card>
  );
}

export function SemDados({ texto, altura = 200 }: { texto: string; altura?: number }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" style={{ minHeight: altura }}>
      <AlertCircle className="h-4 w-4" />{texto}
    </div>
  );
}

export function CabecalhoIndicador({ numero, titulo, descricao, icone: Icone, competencia, competencias, onCompetencia, extra }: {
  numero: number;
  titulo: string;
  descricao: string;
  icone: ComponentType<{ className?: string }>;
  competencia?: string;
  competencias?: string[];
  onCompetencia?: (c: string) => void;
  extra?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white">
          <Icone className="h-7 w-7" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">{numero}. {titulo}</h1>
          <p className="text-sm text-muted-foreground">{descricao}</p>
        </div>
      </div>
      <div className="flex items-end gap-2">
        {extra}
        {competencias && onCompetencia && (
          <div className="w-full sm:w-44">
            <label className="mb-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarDays className="h-3 w-3" /> Competência</label>
            <Select value={competencia ?? ""} onValueChange={onCompetencia} disabled={!competencias.length}>
              <SelectTrigger><SelectValue placeholder="Carregando" /></SelectTrigger>
              <SelectContent>
                {competencias.map((c) => <SelectItem key={c} value={c}>{rotuloCompetencia(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}

export function GradeCarregando({ n = 8 }: { n?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: n }, (_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)}
    </div>
  );
}

/** Barra horizontal simples (faixas de vencimento, motivos): nome, barra e valor. */
export function BarrasHorizontais({ itens, formatar, cor = "#3b82f6", destaque }: {
  itens: { nome: string; valor: number }[];
  formatar: (v: number) => string;
  cor?: string;
  /** Item pintado de vermelho (ex.: "> 90 dias"). */
  destaque?: string;
}) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="space-y-3">
      {itens.map((i) => (
        <li key={i.nome} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{i.nome}</span>
          <span className="h-5 overflow-hidden rounded bg-muted">
            <span className="block h-full rounded" style={{ width: `${(i.valor / max) * 100}%`, background: i.nome === destaque ? "#ef4444" : cor }} />
          </span>
          <span className="font-semibold tabular-nums text-foreground">{formatar(i.valor)}</span>
        </li>
      ))}
    </ul>
  );
}

/** "2026-05" das últimas 24 competências, da mais nova para a mais antiga. */
export function ultimasCompetencias(hoje = new Date(), n = 24): string[] {
  const out: string[] = [];
  let a = hoje.getFullYear();
  let m = hoje.getMonth() + 1;
  for (let i = 0; i < n; i++) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }
  return out;
}
