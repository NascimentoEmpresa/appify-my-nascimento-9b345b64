import { useMemo } from "react";
import {
  Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, ArrowRight, BadgeCheck, CalendarDays, Info, LayoutDashboard, PiggyBank, Receipt, Tags, TrendingDown,
  Wallet, XCircle,
} from "lucide-react";
import { NOME_MES, NOME_MES_LONGO } from "@/lib/oscFinanceiro";
import { useOscComprometido } from "@/hooks/useOscCanaa";
import { CtxOsc, brl, brlCurto, corValor, pct } from "./comum";

const CORES = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#64748b", "#ec4899", "#14b8a6", "#a855f7"];

export function PainelOsc({ ctx, irPara }: { ctx: CtxOsc; irPara: (aba: string) => void }) {
  const r = ctx.resultado;
  const comprometido = useOscComprometido(ctx.parceria.id);
  const totalComprometido = (comprometido.data ?? []).reduce((s, x) => s + x.valor, 0);

  const grafico = r.meses.map((m) => ({
    mes: NOME_MES[m.mes - 1],
    realizado: m.situacao === "prevista" ? null : m.saidas,
    previsto: m.situacao === "prevista" ? m.saidas : null,
    acumulado: m.saldoAcumulado,
    aposProjetos: m.saldoAposProjetos,
  }));
  const composicao = r.composicao.slice(0, 11);
  const outros = r.composicao.slice(11).reduce((s, c) => s + c.valor, 0);
  const pizza = outros > 0 ? [...composicao, { rubrica_id: "outros", nome: "Demais rubricas", grupo: "outros", valor: outros, pct: outros / (r.composicao.reduce((s, c) => s + c.valor, 0) || 1) }] : composicao;

  const semRubrica = ctx.pagamentos.filter((p) => !p.ignorado && !p.rubrica_id);
  const fluxo = useMemo(() => [
    { icone: Receipt, titulo: "Malote", texto: `${ctx.pagamentos.length} pagamento(s) da OSC no ano` },
    { icone: BadgeCheck, titulo: "Pagamento confirmado", texto: "só despesa paga; estorno sai sozinho" },
    { icone: Tags, titulo: "Rubrica OSC", texto: semRubrica.length ? `${semRubrica.length} sem rubrica` : "todas classificadas", alerta: semRubrica.length > 0 },
    { icone: CalendarDays, titulo: "Competência", texto: "pela competência da despesa" },
    { icone: LayoutDashboard, titulo: "Painel", texto: "recalculado a cada abertura" },
  ], [ctx.pagamentos.length, semRubrica.length]);

  const primeiroPrevisto = r.meses.find((m) => m.situacao === "prevista");
  const ultimo = r.ultimoFechado;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Repasse mensal" valor={brl(ctx.parceria.repasse_mensal)} cor="sky" icon={<Wallet />}
          sub={`Ano: ${brl(r.totais.repasse)} (${r.meses.filter((m) => m.repasseConfirmado).length} confirmados)`} />
        <KpiTile label={ultimo ? `Saldo acumulado até ${NOME_MES_LONGO[ultimo - 1].toLowerCase()}` : "Saldo inicial do ano"}
          valor={brl(r.saldoAteUltimoFechado)} cor="amber" icon={<PiggyBank />} valorClass={corValor(r.saldoAteUltimoFechado)}
          sub={ultimo ? "último mês fechado" : "nenhum mês fechado"} />
        <KpiTile label="Custo mensal de referência" valor={brl(r.custoReferencia)} cor="emerald" icon={<Receipt />}
          sub={r.mesReferencia ? `previsto de ${NOME_MES_LONGO[r.mesReferencia - 1].toLowerCase()}, inclui aplicação` : "—"} />
        <KpiTile label="Saldo projetado dezembro" valor={brl(r.saldoProjetadoDezembro)} cor={r.saldoProjetadoDezembro < 0 ? "red" : "emerald"}
          icon={<TrendingDown />} valorClass={corValor(r.saldoProjetadoDezembro)} sub="antes de novos projetos" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Reserva férias/13º acumulada" valor={brl(r.reservaAcumuladaAtual)} cor="sky" icon={<PiggyBank />}
          sub="aplicações − resgates até o mês atual" />
        <KpiTile label="Comprometido no Malote" valor={brl(totalComprometido)} cor="slate" icon={<Receipt />}
          sub={`${comprometido.data?.length ?? 0} aprovado(s) ainda não pago(s)`} onClick={() => irPara("pagamentos")} />
        <KpiTile label="Projetos (aprovados + pendentes)" valor={brl(r.projetosAprovados + r.projetosPendentes)} cor="amber" icon={<Tags />}
          sub={`aprovados ${brl(r.projetosAprovados)}`} onClick={() => irPara("investimentos")} />
        <KpiTile label="Saldo livre a destinar (dez.)" valor={brl(r.saldoLivre)} cor={r.saldoLivre < 0 ? "red" : "emerald"} icon={<Wallet />}
          valorClass={corValor(r.saldoLivre)} sub="após projetos e reserva extra" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Saídas mensais e saldo acumulado</CardTitle></CardHeader>
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={grafico} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="mes" fontSize={12} />
                <YAxis yAxisId="s" fontSize={11} tickFormatter={brlCurto} width={80} />
                <YAxis yAxisId="a" orientation="right" fontSize={11} tickFormatter={brlCurto} width={80} />
                <Tooltip formatter={(v: number) => brl(v)} />
                <Legend />
                <Bar yAxisId="s" dataKey="realizado" name="Saídas realizadas" fill="#1e3a8a" radius={[3, 3, 0, 0]} />
                <Bar yAxisId="s" dataKey="previsto" name="Saídas previstas" fill="#93c5fd" radius={[3, 3, 0, 0]} />
                <Line yAxisId="a" dataKey="acumulado" name="Saldo acumulado" stroke="#f97316" strokeWidth={2} dot />
                {r.projetosAprovados + r.projetosPendentes > 0 && (
                  <Line yAxisId="a" dataKey="aposProjetos" name="Após projetos" stroke="#a855f7" strokeDasharray="5 4" dot={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Composição de custos ({ctx.ano})</CardTitle></CardHeader>
          <CardContent>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pizza} dataKey="valor" nameKey="nome" innerRadius={50} outerRadius={80} paddingAngle={1}>
                    {pizza.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => brl(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-2 space-y-1 text-xs">
              {pizza.map((c, i) => (
                <li key={c.rubrica_id} className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CORES[i % CORES.length] }} />
                  <span className="flex-1 truncate">{c.nome}</span>
                  <span className="tabular-nums text-muted-foreground">{pct(c.pct)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {primeiroPrevisto && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <Info className="h-4 w-4 shrink-0" />
          Dados projetados de {NOME_MES_LONGO[primeiroPrevisto.mes - 1].toLowerCase()} a dezembro. Meses em aberto usam o maior entre realizado e previsto por rubrica.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Integração com o Malote</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-start gap-1">
              {fluxo.map((f, i) => (
                <div key={f.titulo} className="flex items-start gap-1">
                  <div className="flex w-24 flex-col items-center text-center">
                    <div className={cn("flex h-9 w-9 items-center justify-center rounded-full",
                      f.alerta ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" : "bg-primary/10 text-primary")}>
                      <f.icone className="h-4 w-4" />
                    </div>
                    <span className="mt-1 text-xs font-medium">{f.titulo}</span>
                    <span className="text-[11px] leading-tight text-muted-foreground">{f.texto}</span>
                  </div>
                  {i < fluxo.length - 1 && <ArrowRight className="mt-2.5 h-4 w-4 text-muted-foreground" />}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Fonte: pagamentos confirmados do Malote da empresa da parceria (a mesma base do Fluxo de Caixa). Solicitado/aprovado não entra;
              estorno e cancelamento saem sozinhos. Meses com fonte "histórico" usam a planilha importada.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Alertas</CardTitle></CardHeader>
          <CardContent className="max-h-[260px] space-y-1.5 overflow-auto">
            {r.alertas.length === 0 && <p className="text-sm text-muted-foreground">Nenhum alerta.</p>}
            {r.alertas.map((a, i) => (
              <div key={i} className={cn("flex items-start gap-2 rounded-md border px-2 py-1.5 text-xs",
                a.nivel === "erro" ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
                  : a.nivel === "aviso" ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                    : "border-border bg-muted/40")}>
                {a.nivel === "erro" ? <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : a.nivel === "aviso" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                <span>{a.mensagem}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
