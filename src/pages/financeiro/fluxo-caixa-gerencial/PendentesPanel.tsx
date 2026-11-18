import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, Download, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDefinirVencimentoNf } from "@/hooks/useVencimentoNf";
import { TituloComFormula } from "@/pages/controladoria/faturamento/Rentabilidade";
import { baixarExcel, type Celula } from "@/pages/financeiro/conciliacao-servicos/exportarExcel";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { AssinaturaRegra } from "@/pages/malote/AssinaturaRegra";
import { agruparPendentes, composicaoPendente, conciliarComKpi, resumoPorFaixa, type LinhaPendente } from "./pendentes";
import { ORDEM_FAIXAS, ROTULO_FAIXA, ROTULO_ORIGEM_VENCIMENTO, type FaixaAging } from "./vencimento";

// SIS-2026-XXXX (etapa 3): Recebimentos Pendentes (aging). Toda a carteira em aberto (qualquer período), por faixa de atraso, cliente e contrato, com as
// notas de cada saldo, a composição do valor e a conciliação com o indicador do topo. O vencimento é editável (Financeiro) e volta ao cálculo se limpo.
const COR_FAIXA: Record<FaixaAging, string> = {
  a_vencer: "#22c55e", vencido_1_30: "#f59e0b", vencido_31_60: "#f97316", vencido_61_90: "#ef4444", vencido_90_mais: "#991b1b", sem_vencimento: "#94a3b8",
};
const data = (iso: string | null) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("pt-BR") : "—");
const mes = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
const msg = (e: unknown) => (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Erro ao salvar o vencimento.");

function LinhaNota({ l }: { l: LinhaPendente }) {
  const definir = useDefinirVencimentoNf();
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(l.vencimento ?? "");

  async function salvar(novo: string | null) {
    try {
      await definir.mutateAsync({ notaId: l.id, vencimento: novo });
      toast.success(novo ? "Vencimento ajustado." : "Vencimento voltou ao cálculo pelo prazo do contrato.");
      setEditando(false);
    } catch (e: unknown) {
      toast.error(msg(e));
    }
  }

  return (
    <TableRow className="bg-muted/20">
      <TableCell className="pl-8 text-xs font-medium">NF {l.numero}</TableCell>
      <TableCell className="text-xs">{l.contrato}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{mes(l.competencia)}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{data(l.emissao)}</TableCell>
      <TableCell className="text-xs">
        {editando ? (
          <span className="flex items-center gap-1">
            <Input type="date" className="h-7 w-36 text-xs" value={valor} onChange={(e) => setValor(e.target.value)} />
            <Button size="sm" className="h-7 px-2 text-xs" disabled={!valor || definir.isPending} onClick={() => void salvar(valor)}>Salvar</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditando(false)}>Cancelar</Button>
          </span>
        ) : (
          <span className="flex items-center gap-1.5">
            <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-primary" title="Ajustar o vencimento desta nota" onClick={() => { setValor(l.vencimento ?? ""); setEditando(true); }}>
              {data(l.vencimento)}
            </button>
            {l.origemVencimento && <Badge variant="outline" className="h-4 px-1 text-[9px] font-normal" title={ROTULO_ORIGEM_VENCIMENTO[l.origemVencimento]}>{l.origemVencimento === "manual" ? "ajustado" : l.origemVencimento === "padrao" ? "estimado" : "contrato"}</Badge>}
            {l.origemVencimento === "manual" && (
              <button type="button" className="text-muted-foreground hover:text-foreground" title="Voltar ao vencimento calculado" onClick={() => void salvar(null)}><RotateCcw className="h-3 w-3" /></button>
            )}
          </span>
        )}
      </TableCell>
      <TableCell className={`text-right text-xs ${l.atraso !== null && l.atraso > 0 ? "font-semibold text-red-600" : ""}`}>{l.atraso === null ? "—" : l.atraso > 0 ? `${l.atraso} d` : "no prazo"}</TableCell>
      <TableCell className="text-right text-xs">{fmtMoney(l.liquido)}</TableCell>
      <TableCell className="text-right text-xs">{fmtMoney(l.pago)}</TableCell>
      <TableCell className="text-right text-xs font-semibold">{fmtMoney(l.pendente)}</TableCell>
    </TableRow>
  );
}

export function PendentesPanel({ carteira, idsDoRecorte, kpiPendente, referencia, empresaNome }: {
  carteira: LinhaPendente[];
  /** notas do recorte de faturamento (as do indicador "Valor Pendente de Recebimento") */
  idsDoRecorte: ReadonlySet<string>;
  kpiPendente: number;
  referencia: string;
  empresaNome: (id: string) => string;
}) {
  const [por, setPor] = useState<"cliente" | "contrato">("cliente");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const faixas = useMemo(() => resumoPorFaixa(carteira), [carteira]);
  const grupos = useMemo(() => agruparPendentes(carteira, por), [carteira, por]);
  const comp = useMemo(() => composicaoPendente(carteira), [carteira]);
  const conc = useMemo(() => conciliarComKpi(carteira, idsDoRecorte), [carteira, idsDoRecorte]);
  const totalVencido = faixas.filter((f) => f.faixa.startsWith("vencido")).reduce((s, f) => s + f.valor, 0);

  const alternar = (k: string) => setAbertos((a) => { const n = new Set(a); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function exportar() {
    const cab: Celula[] = ["Cliente", "Contrato", "Empresa", "NF", "Competência", "Emissão", "Vencimento", "Origem do vencimento", "Dias de atraso", "Faixa", "Líquido", "Pago", "Conta vinculada", "Pós-emissão", "Pendente"];
    const corpo: Celula[][] = carteira.map((l) => [l.cliente, l.contrato, empresaNome(l.empresaId), l.numero, mes(l.competencia), data(l.emissao), data(l.vencimento), l.origemVencimento ? ROTULO_ORIGEM_VENCIMENTO[l.origemVencimento] : "—", l.atraso ?? "—", ROTULO_FAIXA[l.faixa], l.liquido, l.pago, l.contaVinculada, l.posEmissao, l.pendente]);
    await baixarExcel(
      [
        { nome: "Resumo", linhas: [["Recebimentos pendentes (aging)"], ["Referência", data(referencia)], ["Total pendente", comp.pendente], ["Vencido", totalVencido], ...faixas.map((f) => [ROTULO_FAIXA[f.faixa], f.valor] as Celula[])] },
        { nome: "Notas pendentes", linhas: [cab, ...corpo] },
      ],
      `recebimentos-pendentes-${referencia}.xlsx`,
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">
          <TituloComFormula alinhar="left" titulo="Recebimentos Pendentes (Aging)" formula={<><span className="block">Toda a carteira de notas com saldo a receber (qualquer período), por faixa de atraso na data de hoje. Valor por nota = líquido − pago − conta vinculada − descontos pós-emissão (regra do Relatório de Serviços).</span><span className="block">Vencimento: o ajustado pelo Financeiro; senão o prazo de pagamento do contrato; senão emissão + 30 dias (estimado). Clique na data para ajustar.</span><AssinaturaRegra chamado="SIS-2026-XXXX" /></>} />
        </CardTitle>
        <Button variant="outline" size="sm" className="gap-1" onClick={() => void exportar()} disabled={carteira.length === 0}><Download className="h-3.5 w-3.5" />Excel</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={faixas.filter((f) => f.faixa !== "sem_vencimento" || f.valor > 0).map((f) => ({ rotulo: ROTULO_FAIXA[f.faixa].replace("Vencido ", "").replace("há mais de ", ">"), valor: f.valor, faixa: f.faixa }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} interval={0} />
                <YAxis tickFormatter={(v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`)} tick={{ fontSize: 10 }} width={42} />
                <ChartTooltip formatter={(v: number) => fmtMoney(v)} />
                <Bar dataKey="valor" name="Pendente" radius={[3, 3, 0, 0]}>
                  {faixas.filter((f) => f.faixa !== "sem_vencimento" || f.valor > 0).map((f) => <Cell key={f.faixa} fill={COR_FAIXA[f.faixa]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-3">
            <Table>
              <TableHeader><TableRow><TableHead>Faixa</TableHead><TableHead className="text-right">Notas</TableHead><TableHead className="text-right">Valor</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
              <TableBody>
                {ORDEM_FAIXAS.filter((f) => f !== "sem_vencimento" || faixas.find((x) => x.faixa === f)!.valor > 0).map((f) => {
                  const x = faixas.find((y) => y.faixa === f)!;
                  return (
                    <TableRow key={f}>
                      <TableCell className="py-1 text-xs"><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: COR_FAIXA[f] }} />{ROTULO_FAIXA[f]}</TableCell>
                      <TableCell className="py-1 text-right text-xs">{x.qtd}</TableCell>
                      <TableCell className="py-1 text-right text-xs font-medium">{fmtMoney(x.valor)}</TableCell>
                      <TableCell className="py-1 text-right text-xs">{(x.pct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter><TableRow><TableCell className="py-1 text-xs font-semibold">Total pendente</TableCell><TableCell className="py-1 text-right text-xs font-semibold">{carteira.length}</TableCell><TableCell className="py-1 text-right text-xs font-semibold">{fmtMoney(comp.pendente)}</TableCell><TableCell /></TableRow></TableFooter>
            </Table>
            <p className="text-[11px] text-muted-foreground">
              <strong>Conciliação:</strong> pendente do indicador do topo {fmtMoney(kpiPendente)} {Math.abs(kpiPendente - conc.doRecorte) > 0.005 ? <span className="text-red-600">(carteira do mesmo recorte: {fmtMoney(conc.doRecorte)} — conferir)</span> : ""}
              {" "}+ pendente de notas fora do recorte {fmtMoney(conc.foraDoRecorte)} = carteira total {fmtMoney(conc.total)}.
              {" "}Composição: líquido {fmtMoney(comp.liquido)} − pago {fmtMoney(comp.pago)} − conta vinculada {fmtMoney(comp.contaVinculada)} − pós-emissão {fmtMoney(comp.posEmissao)}{Math.abs(comp.ajusteDePisoZero) > 0.005 ? ` + ajuste de piso zero ${fmtMoney(comp.ajusteDePisoZero)}` : ""} = {fmtMoney(comp.pendente)}.
            </p>
          </div>
        </div>

        <Tabs value={por} onValueChange={(v) => setPor(v as "cliente" | "contrato")}>
          <TabsList><TabsTrigger value="cliente">Por cliente</TabsTrigger><TabsTrigger value="contrato">Por contrato</TabsTrigger></TabsList>
        </Tabs>
        <div className="max-h-[60vh] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{por === "cliente" ? "Cliente" : "Contrato"}</TableHead><TableHead className="text-right">Notas</TableHead><TableHead className="text-right">A vencer</TableHead>
                <TableHead className="text-right">Vencido</TableHead><TableHead className="text-right">Total pendente</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grupos.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Nenhuma nota pendente.</TableCell></TableRow>}
              {grupos.map((g) => {
                const aberto = abertos.has(g.chave);
                return (
                  <FragmentoGrupo key={g.chave} aberto={aberto} onAlternar={() => alternar(g.chave)} rotulo={g.rotulo} qtd={g.qtd} aVencer={g.porFaixa.a_vencer} vencido={g.vencido} total={g.total} linhas={g.linhas} />
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function FragmentoGrupo({ aberto, onAlternar, rotulo, qtd, aVencer, vencido, total, linhas }: {
  aberto: boolean; onAlternar: () => void; rotulo: string; qtd: number; aVencer: number; vencido: number; total: number; linhas: LinhaPendente[];
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onAlternar}>
        <TableCell className="text-xs font-medium"><span className="mr-1 inline-block align-middle">{aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>{rotulo}</TableCell>
        <TableCell className="text-right text-xs">{qtd}</TableCell>
        <TableCell className="text-right text-xs text-emerald-700">{fmtMoney(aVencer)}</TableCell>
        <TableCell className={`text-right text-xs ${vencido > 0 ? "font-semibold text-red-600" : ""}`}>{fmtMoney(vencido)}</TableCell>
        <TableCell className="text-right text-xs font-semibold">{fmtMoney(total)}</TableCell>
      </TableRow>
      {aberto && (
        <TableRow>
          <TableCell colSpan={5} className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-8 text-[11px]">NF</TableHead><TableHead className="text-[11px]">Contrato</TableHead><TableHead className="text-[11px]">Competência</TableHead><TableHead className="text-[11px]">Emissão</TableHead>
                  <TableHead className="text-[11px]">Vencimento</TableHead><TableHead className="text-right text-[11px]">Atraso</TableHead><TableHead className="text-right text-[11px]">Líquido</TableHead><TableHead className="text-right text-[11px]">Pago</TableHead><TableHead className="text-right text-[11px]">Pendente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>{linhas.map((l) => <LinhaNota key={l.id} l={l} />)}</TableBody>
            </Table>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
