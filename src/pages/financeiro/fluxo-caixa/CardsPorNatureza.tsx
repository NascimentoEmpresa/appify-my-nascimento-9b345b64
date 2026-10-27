import { AlertTriangle, LineChart, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import type { TotaisNatureza, TotaisPorGrupo } from "./naturezaFluxo";

interface Linha {
  rotulo: string;
  valor: number;
  destaque?: boolean;
  aviso?: boolean;
}

function CardNatureza({
  titulo, total, cor, icone, linhas, totalRotulo, onClick, percentualDe,
}: {
  titulo: string;
  total: number;
  cor: "emerald" | "red" | "sky";
  icone: React.ReactNode;
  linhas: Linha[];
  totalRotulo: string;
  onClick: () => void;
  percentualDe?: number;
}) {
  const corValor = cor === "emerald" ? "text-emerald-600 dark:text-emerald-400" : cor === "red" ? "text-red-600 dark:text-red-400" : total < 0 ? "text-red-600 dark:text-red-400" : "text-sky-700 dark:text-sky-400";
  const corIcone = cor === "emerald" ? "text-emerald-300 dark:text-emerald-800" : cor === "red" ? "text-red-300 dark:text-red-900" : "text-sky-300 dark:text-sky-800";
  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-muted/50"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
    >
      <CardContent className="relative overflow-hidden p-4">
        <span className={cn("pointer-events-none absolute right-3 top-3 [&>svg]:h-10 [&>svg]:w-10", corIcone)}>{icone}</span>
        <p className="relative z-10 text-xs font-medium uppercase tracking-wide text-muted-foreground">{titulo}</p>
        <p className={cn("relative z-10 mt-1 text-2xl font-bold", corValor)}>{formatBRL(total)}</p>
        <div className="relative z-10 mt-3 space-y-1.5 border-t pt-2">
          {linhas.map((l) => (
            <div key={l.rotulo} className={cn("flex items-baseline justify-between gap-3 text-xs", l.aviso && "text-amber-700 dark:text-amber-400")}>
              <span className={cn("min-w-0", l.destaque ? "font-semibold" : "text-muted-foreground", l.aviso && "font-medium")}>{l.rotulo}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className={cn("tabular-nums", l.destaque && "font-semibold", l.valor < 0 && "text-red-600 dark:text-red-400")}>{formatBRL(l.valor)}</span>
                {percentualDe !== undefined && percentualDe !== 0 && (
                  <span className="w-12 text-right text-[10px] text-muted-foreground">{((l.valor / percentualDe) * 100).toFixed(2).replace(".", ",")}%</span>
                )}
              </span>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t pt-1.5 text-xs font-semibold">
            <span>{totalRotulo}</span>
            <span className="tabular-nums">{formatBRL(total)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const grupos = (t: TotaisPorGrupo, nomes: { livre: string; vinc: string; cdb: string }): Linha[] => {
  const l: Linha[] = [
    { rotulo: nomes.livre, valor: t.livre },
    { rotulo: nomes.vinc, valor: t.conta_vinculada },
    { rotulo: nomes.cdb, valor: t.cdb },
  ];
  if (Math.abs(t.semNatureza) > 0.004) l.push({ rotulo: "Sem natureza definida", valor: t.semNatureza, aviso: true });
  return l;
};

// SIS-2026-0726: os três cards do Fluxo (Entradas, Saídas, Saldo) separados por natureza da classificação, mais o aviso do que ficou sem natureza.
export function CardsPorNatureza({
  totais, projetado, onAbrirKpi, onDefinirNatureza, podeEditar,
}: {
  totais: TotaisNatureza;
  projetado: boolean;
  onAbrirKpi: (k: "entradas" | "saidas" | "saldo") => void;
  onDefinirNatureza: () => void;
  podeEditar: boolean;
}) {
  const semE = totais.entradas.semNatureza;
  const semS = totais.saidas.semNatureza;
  const semNatureza = Math.abs(semE) > 0.004 || Math.abs(semS) > 0.004;
  const qtdSem = totais.semNaturezaPorClassificacao.reduce((n, x) => n + x.qtd, 0);
  const saldoLinhas: Linha[] = [
    { rotulo: "(−) Conta vinculada", valor: totais.saldo.conta_vinculada },
    { rotulo: "(−) CDB", valor: totais.saldo.cdb },
    { rotulo: "Saldo livre", valor: totais.saldo.livre, destaque: true },
  ];
  if (Math.abs(totais.saldo.semNatureza) > 0.004) saldoLinhas.push({ rotulo: "Sem natureza definida", valor: totais.saldo.semNatureza, aviso: true });

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <CardNatureza
          titulo={projetado ? "Entradas previstas (filtro atual)" : "Entradas (filtro atual)"}
          total={totais.entradas.total}
          cor="emerald"
          icone={<TrendingUp />}
          linhas={grupos(totais.entradas, { livre: "Conta movimento (livre utilização)", vinc: "Conta vinculada", cdb: "Aplicações em CDB (resgates)" })}
          totalRotulo="Total de entradas"
          percentualDe={totais.entradas.total}
          onClick={() => onAbrirKpi("entradas")}
        />
        <CardNatureza
          titulo={projetado ? "Saídas previstas (filtro atual)" : "Saídas (filtro atual)"}
          total={totais.saidas.total}
          cor="red"
          icone={<TrendingDown />}
          linhas={grupos(totais.saidas, { livre: "Conta movimento (livre utilização)", vinc: "Saídas de conta vinculada", cdb: "Aplicações em CDB" })}
          totalRotulo="Total de saídas"
          percentualDe={totais.saidas.total}
          onClick={() => onAbrirKpi("saidas")}
        />
        <CardNatureza
          titulo={projetado ? "Saldo projetado (entradas − saídas)" : "Saldo (entradas − saídas)"}
          total={totais.saldo.total}
          cor="sky"
          icone={<LineChart />}
          linhas={saldoLinhas}
          totalRotulo="Total do saldo"
          onClick={() => onAbrirKpi("saldo")}
        />
      </div>
      {semNatureza && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-[260px] flex-1">
            <strong>{qtdSem} parte(s) de lançamento com classificação sem natureza definida</strong> (ou sem classificação): entradas {formatBRL(semE)} e saídas {formatBRL(semS)} não
            estão em conta movimento, conta vinculada nem CDB. {podeEditar ? "Defina a natureza das classificações para fechar a separação." : "Peça a quem tem a ação Alterar no Fluxo para definir."}
          </span>
          <Button size="sm" variant="outline" className="h-7 border-amber-400" onClick={onDefinirNatureza}>
            {podeEditar ? "Definir natureza" : "Ver quais"}
          </Button>
        </div>
      )}
    </div>
  );
}
