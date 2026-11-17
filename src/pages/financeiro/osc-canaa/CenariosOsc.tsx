import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Plus, RotateCcw, Trash2 } from "lucide-react";
import { NOME_MES, NOME_MES_LONGO, calcularOsc } from "@/lib/oscFinanceiro";
import { CtxOsc, brl, brlCurto, corValor } from "./comum";

const n = (s: string) => {
  const v = Number(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

export function CenariosOsc({ ctx }: { ctx: CtxOsc }) {
  const [repassePct, setRepassePct] = useState("0");
  const [despesaExtra, setDespesaExtra] = useState("0");
  const [economiaPct, setEconomiaPct] = useState("0");
  const [pendentes, setPendentes] = useState(true);
  const [extras, setExtras] = useState<{ nome: string; valor: string; mes: string }[]>([]);

  const oficial = ctx.resultado;
  const sim = useMemo(() => calcularOsc({
    ...ctx.entrada,
    incluirProjetosPendentes: pendentes,
    cenario: {
      ajusteRepassePct: n(repassePct) / 100,
      despesaExtraMensal: n(despesaExtra),
      economiaPct: n(economiaPct) / 100,
      projetosExtras: extras.filter((x) => n(x.valor) > 0).map((x) => ({ valor: n(x.valor), competencia: `${ctx.ano}-${x.mes.padStart(2, "0")}-01` })),
    },
  }), [ctx.entrada, ctx.ano, repassePct, despesaExtra, economiaPct, extras, pendentes]);

  const dados = oficial.meses.map((m, i) => ({
    mes: NOME_MES[m.mes - 1],
    oficial: m.saldoAposProjetos,
    simulado: sim.meses[i].saldoAposProjetos,
  }));
  const limpar = () => { setRepassePct("0"); setDespesaExtra("0"); setEconomiaPct("0"); setExtras([]); setPendentes(true); };

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            Simulação
            <Button variant="ghost" size="sm" className="h-7 gap-1" onClick={limpar}><RotateCcw className="h-3.5 w-3.5" />Limpar</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">Nada aqui é gravado — só muda a projeção desta tela. Meses fechados não mudam.</p>
          <div><Label>Alteração do repasse (%) nos meses não recebidos</Label><Input type="number" step="0.1" value={repassePct} onChange={(e) => setRepassePct(e.target.value)} /></div>
          <div><Label>Nova despesa mensal (R$) nos meses não fechados</Label><Input type="number" step="0.01" value={despesaExtra} onChange={(e) => setDespesaExtra(e.target.value)} /></div>
          <div><Label>Economia sobre o previsto (%)</Label><Input type="number" step="0.1" value={economiaPct} onChange={(e) => setEconomiaPct(e.target.value)} /></div>
          <label className="flex items-center gap-2"><Switch checked={pendentes} onCheckedChange={setPendentes} />Considerar projetos pendentes</label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Projetos hipotéticos</Label>
              <Button variant="outline" size="sm" className="h-7 gap-1" onClick={() => setExtras((x) => [...x, { nome: "", valor: "", mes: "12" }])}><Plus className="h-3.5 w-3.5" />Adicionar</Button>
            </div>
            {extras.map((x, i) => (
              <div key={i} className="flex gap-1">
                <Input className="h-8" placeholder="Projeto" value={x.nome} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, nome: e.target.value } : y)))} />
                <Input className="h-8 w-28" type="number" placeholder="Valor" value={x.valor} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, valor: e.target.value } : y)))} />
                <select className="h-8 rounded-md border bg-background px-1 text-xs" value={x.mes} onChange={(e) => setExtras((l) => l.map((y, j) => (j === i ? { ...y, mes: e.target.value } : y)))}>
                  {NOME_MES.map((m, k) => <option key={k} value={String(k + 1)}>{m}</option>)}
                </select>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setExtras((l) => l.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="xl:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-base">Saldo após projetos: oficial × simulado</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Resumo titulo="Dezembro oficial" valor={oficial.saldoAposProjetosDezembro} />
            <Resumo titulo="Dezembro simulado" valor={sim.saldoAposProjetosDezembro} />
            <Resumo titulo="Diferença" valor={sim.saldoAposProjetosDezembro - oficial.saldoAposProjetosDezembro} />
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dados}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="mes" fontSize={12} />
                <YAxis fontSize={11} tickFormatter={brlCurto} width={80} />
                <Tooltip formatter={(v: number) => brl(v)} />
                <Legend />
                <Line dataKey="oficial" name="Oficial" stroke="#f97316" strokeWidth={2} />
                <Line dataKey="simulado" name="Simulado" stroke="#2563eb" strokeWidth={2} strokeDasharray="6 4" />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Table className="text-xs">
            <TableHeader><TableRow><TableHead>Mês</TableHead><TableHead className="text-right">Repasse sim.</TableHead><TableHead className="text-right">Saídas sim.</TableHead><TableHead className="text-right">Saldo após projetos (oficial)</TableHead><TableHead className="text-right">Simulado</TableHead></TableRow></TableHeader>
            <TableBody>
              {sim.meses.map((m, i) => (
                <TableRow key={m.mes}>
                  <TableCell>{NOME_MES_LONGO[m.mes - 1]}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(m.repasse)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(m.saidas + m.projetos)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", corValor(oficial.meses[i].saldoAposProjetos))}>{brl(oficial.meses[i].saldoAposProjetos)}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", corValor(m.saldoAposProjetos))}>{brl(m.saldoAposProjetos)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Resumo({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className={cn("text-lg font-semibold tabular-nums", corValor(valor))}>{brl(valor)}</div>
    </div>
  );
}
