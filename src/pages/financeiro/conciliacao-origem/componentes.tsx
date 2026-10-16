// SIS-2026-0658: peças visuais compartilhadas pelas duas telas de conciliação da origem dos dados.
import { ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Monitor, FileSpreadsheet, Plus, Equal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { cn } from "@/lib/utils";
import type { OrigemBase, ResumoBase } from "./regras";

export const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");
export const mesAno = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

export function OrigemBadge({ origem, detalhe }: { origem: OrigemBase; detalhe?: string }) {
  return (
    <Badge
      variant="outline"
      title={detalhe}
      className={cn(
        "font-medium",
        origem === "sistema"
          ? "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300"
          : "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
      )}
    >
      {origem === "sistema" ? "Sistema" : "Excel"}
    </Badge>
  );
}

/** Quatro tiles do topo: total, sistema, Excel antigo e diferença a conciliar. */
export function KpisConciliacao({ rotuloTotal, total, sistema, excel, diferenca }: {
  rotuloTotal: string; total: number; sistema: number; excel: number; diferenca: number;
}) {
  const fechado = Math.abs(diferenca) < 0.005;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile label={rotuloTotal} valor={formatBRL(total)} cor="slate" icon={<Equal className="h-14 w-14" />} />
      <KpiTile label="Origem Sistema" valor={formatBRL(sistema)} cor="sky" icon={<Monitor className="h-14 w-14" />} valorClass="text-sky-700 dark:text-sky-300" />
      <KpiTile label="Origem Excel antigo" valor={formatBRL(excel)} cor="slate" icon={<FileSpreadsheet className="h-14 w-14" />} valorClass="text-violet-700 dark:text-violet-300" />
      <KpiTile
        label="Diferença a conciliar"
        valor={formatBRL(diferenca)}
        cor={fechado ? "emerald" : "red"}
        icon={fechado ? <CheckCircle2 className="h-14 w-14" /> : <AlertTriangle className="h-14 w-14" />}
        valorClass={fechado ? "text-emerald-700 dark:text-emerald-300" : "text-red-600"}
      />
    </div>
  );
}

/** Cartão "Resumo da base": valor, quantidade, período e (opcional) entradas/saídas. */
export function ResumoBaseCard({ titulo, origem, resumo, quantidadeRotulo, mostrarEntradasSaidas }: {
  titulo: string; origem: OrigemBase; resumo: ResumoBase; quantidadeRotulo: string; mostrarEntradasSaidas?: boolean;
}) {
  const sistema = origem === "sistema";
  const linha = (rotulo: string, valor: ReactNode, destaque?: string) => (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={cn("font-medium", destaque)}>{valor}</span>
    </div>
  );
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="mb-1 flex items-center gap-2">
          {sistema ? <Monitor className="h-5 w-5 text-sky-600" /> : <FileSpreadsheet className="h-5 w-5 text-violet-600" />}
          <h3 className="text-sm font-semibold">{titulo}</h3>
          <Badge variant="secondary" className="ml-auto text-[10px]">Composição do total</Badge>
        </div>
        {linha("Valor total", formatBRL(resumo.valor), cn("text-base", sistema ? "text-sky-700 dark:text-sky-300" : "text-violet-700 dark:text-violet-300"))}
        {mostrarEntradasSaidas && linha("Entradas", formatBRL(resumo.entradas), "text-emerald-600")}
        {mostrarEntradasSaidas && linha("Saídas", formatBRL(resumo.saidas), "text-red-600")}
        {linha(quantidadeRotulo, resumo.qtd.toLocaleString("pt-BR"))}
        {linha("Período coberto", resumo.de ? `${dia(resumo.de)} a ${dia(resumo.ate)}` : "—")}
      </CardContent>
    </Card>
  );
}

/** Faixa "Sistema + Excel = Total" e o veredito da conciliação. */
export function BarraEquacao({ rotuloTotal, total, sistema, excel, diferenca }: {
  rotuloTotal: string; total: number; sistema: number; excel: number; diferenca: number;
}) {
  const fechado = Math.abs(diferenca) < 0.005;
  const parte = (valor: number, rotulo: string, cor: string) => (
    <div className="text-center">
      <p className={cn("text-lg font-semibold", cor)}>{formatBRL(valor)}</p>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
    </div>
  );
  return (
    <div className="grid gap-3 lg:grid-cols-[2fr_1fr]">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-around gap-3 p-4">
          {parte(sistema, "Sistema", "text-sky-700 dark:text-sky-300")}
          <Plus className="h-4 w-4 text-muted-foreground" />
          {parte(excel, "Excel antigo", "text-violet-700 dark:text-violet-300")}
          <Equal className="h-4 w-4 text-muted-foreground" />
          {parte(total, rotuloTotal, "text-foreground")}
        </CardContent>
      </Card>
      <Card className={fechado ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-red-300 bg-red-50/60 dark:border-red-900 dark:bg-red-950/20"}>
        <CardContent className="flex items-start gap-3 p-4">
          {fechado ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />}
          <div className="text-sm">
            <p className="font-semibold">{fechado ? "Conciliação fechada — sem sobra a conciliar" : `Há ${formatBRL(Math.abs(diferenca))} a conciliar`}</p>
            <p className="text-xs text-muted-foreground">
              {fechado
                ? "Toda linha pertence a exatamente uma origem e as duas somam o total."
                : "Existem linhas fora das duas origens ou contadas duas vezes. Confira o detalhe."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function Paginacao({ pagina, total, tamanho, onChange }: { pagina: number; total: number; tamanho: number; onChange: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / tamanho));
  const atual = Math.min(pagina, paginas);
  return (
    <div className="flex items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
      <span>{total.toLocaleString("pt-BR")} lançamento(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={atual <= 1} onClick={() => onChange(atual - 1)}>Anterior</Button>
        <span>Página {atual} de {paginas}</span>
        <Button variant="outline" size="sm" disabled={atual >= paginas} onClick={() => onChange(atual + 1)}>Próxima</Button>
      </div>
    </div>
  );
}
