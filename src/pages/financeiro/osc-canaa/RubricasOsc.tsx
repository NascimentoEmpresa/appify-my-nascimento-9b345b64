import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { CENARIO_DESPESA_EXTRA, NOME_MES, SEM_RUBRICA } from "@/lib/oscFinanceiro";
import { CtxOsc, GRUPO_LABEL, brl, nomeRubrica } from "./comum";

type Visao = "considerado" | "previsto" | "realizado" | "diferenca";

export function RubricasOsc({ ctx }: { ctx: CtxOsc }) {
  const [visao, setVisao] = useState<Visao>("considerado");
  const [grupo, setGrupo] = useState("todos");
  const meses = ctx.resultado.meses;

  const linhas = useMemo(() => {
    const ids = new Set<string>();
    for (const m of meses) for (const id of Object.keys(m.porRubrica)) if (id !== CENARIO_DESPESA_EXTRA) ids.add(id);
    const ordem = new Map(ctx.dados.rubricas.map((r, i) => [r.id, i]));
    return [...ids]
      .map((id) => {
        const rub = ctx.dados.rubricas.find((r) => r.id === id);
        const valores = meses.map((m) => {
          const v = m.porRubrica[id];
          if (!v) return 0;
          return visao === "diferenca" ? (m.situacao === "prevista" ? 0 : v.realizado - v.previsto) : v[visao];
        });
        return { id, nome: nomeRubrica(ctx, id), grupo: id === SEM_RUBRICA ? "outros" : rub?.grupo ?? "outros", valores, total: valores.reduce((s, v) => s + v, 0) };
      })
      .filter((l) => grupo === "todos" || l.grupo === grupo)
      .sort((a, b) => (ordem.get(a.id) ?? 999) - (ordem.get(b.id) ?? 999));
  }, [meses, ctx, visao, grupo]);

  const totalMes = meses.map((_, i) => linhas.reduce((s, l) => s + l.valores[i], 0));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Detalhamento de despesas por rubrica — {ctx.ano}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={grupo} onValueChange={setGrupo}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas as categorias</SelectItem>
                {Object.entries(GRUPO_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={visao} onValueChange={(v) => setVisao(v as Visao)}>
              <SelectTrigger className="h-8 w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="considerado">Valor considerado no saldo</SelectItem>
                <SelectItem value="previsto">Previsto</SelectItem>
                <SelectItem value="realizado">Realizado (pago)</SelectItem>
                <SelectItem value="diferenca">Realizado − previsto</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="overflow-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 bg-background">Rubrica</TableHead>
                {meses.map((m) => (
                  <TableHead key={m.mes} className={cn("text-right", m.situacao === "prevista" && "text-sky-700 dark:text-sky-300")}>{NOME_MES[m.mes - 1]}</TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className={cn("sticky left-0 whitespace-nowrap bg-background", l.id === SEM_RUBRICA && "text-amber-700 dark:text-amber-300")}>
                    {l.nome}<span className="ml-1 text-[10px] text-muted-foreground">{GRUPO_LABEL[l.grupo] ?? l.grupo}</span>
                  </TableCell>
                  {l.valores.map((v, i) => (
                    <TableCell key={i} className={cn("text-right tabular-nums", v === 0 && "text-muted-foreground/50",
                      visao === "diferenca" && v > 0.009 && "text-red-600", visao === "diferenca" && v < -0.009 && "text-emerald-700")}>
                      {v === 0 ? "—" : brl(v)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium tabular-nums">{brl(l.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="sticky left-0 bg-muted">Total</TableCell>
                {totalMes.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{brl(v)}</TableCell>)}
                <TableCell className="text-right tabular-nums">{brl(totalMes.reduce((s, v) => s + v, 0))}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">Meses em azul são projetados. A aplicação para férias e 13º aparece como rubrica de reserva (não é despesa).</p>
      </CardContent>
    </Card>
  );
}
