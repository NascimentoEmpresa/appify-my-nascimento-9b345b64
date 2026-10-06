import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Clock, Printer, TrendingUp, Wallet } from "lucide-react";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { agruparFaturamento, totaisVazios, TotaisFaturamento } from "./faturamento/regras";
import { rotuloMes, useBaseFaturamento } from "./faturamento/useBaseFaturamento";

// SIS-2026-0556: Faturamento da Empresa (Controladoria). Mesma base do
// Controle de Faturamento: NFs Código N validadas do Relatório de Serviços,
// fora de cancelada/substituída. Mês = competência da nota.

const TODOS = "todos";
const CORES = ["#1e3a8a", "#f97316", "#38bdf8", "#64748b", "#10b981", "#a855f7", "#eab308"];
const pct = (parte: number, todo: number) => (todo > 0 ? `${((parte / todo) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—");
const milhoes = (v: number) => `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;

function Num({ v, negativoVermelho }: { v: number; negativoVermelho?: boolean }) {
  return <span className={negativoVermelho && v < 0 ? "text-red-600 font-medium" : undefined}>{fmtMoney(v)}</span>;
}

export default function FaturamentoEmpresa() {
  const { contratos, nfs, empresas, contratoPorId, executavelDoContrato, carregando } = useBaseFaturamento();

  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [empresaId, setEmpresaId] = useState(TODOS);
  const [contratoId, setContratoId] = useState(TODOS);
  const [cliente, setCliente] = useState(TODOS);
  const [busca, setBusca] = useState("");

  const anos = useMemo(() => {
    const s = new Set<number>([anoAtual]);
    for (const n of nfs) s.add(Number(n.competencia.slice(0, 4)));
    return [...s].sort((a, b) => b - a);
  }, [nfs, anoAtual]);

  const clientes = useMemo(() => [...new Set(contratos.map((c) => c.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [contratos]);

  const contratoPassa = (id: string) => {
    const c = contratoPorId.get(id);
    if (!c) return false;
    if (empresaId !== TODOS && c.empresa_id !== empresaId) return false;
    if (contratoId !== TODOS && c.id !== contratoId) return false;
    if (cliente !== TODOS && c.cliente !== cliente) return false;
    return true;
  };

  const meses = useMemo(() => Array.from({ length: 12 }, (_, i) => `${ano}-${String(i + 1).padStart(2, "0")}`), [ano]);
  const nfsFiltradas = useMemo(
    () => nfs.filter((n) => n.competencia.startsWith(`${ano}-`) && contratoPassa(n.contrato_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nfs, ano, empresaId, contratoId, cliente, contratoPorId]
  );

  const porMes = useMemo(() => agruparFaturamento(nfsFiltradas, (n) => n.competencia.slice(0, 7)), [nfsFiltradas]);
  const porContrato = useMemo(() => agruparFaturamento(nfsFiltradas, (n) => n.contrato_id), [nfsFiltradas]);
  const porCliente = useMemo(() => agruparFaturamento(nfsFiltradas, (n) => contratoPorId.get(n.contrato_id)?.cliente ?? "(sem cliente)"), [nfsFiltradas, contratoPorId]);

  const contratosDoRecorte = useMemo(() => contratos.filter((c) => contratoPassa(c.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contratos, empresaId, contratoId, cliente]);

  const execPorMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const mes of meses) m.set(mes, contratosDoRecorte.reduce((s, c) => s + executavelDoContrato(c, mes), 0));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meses, contratosDoRecorte]);

  const total = useMemo(() => {
    const t = totaisVazios();
    for (const v of porMes.values()) {
      t.bruto += v.bruto; t.liquido += v.liquido; t.descontos += v.descontos; t.recebido += v.recebido; t.aReceber += v.aReceber; t.notas += v.notas;
    }
    return t;
  }, [porMes]);
  const execTotal = [...execPorMes.values()].reduce((s, v) => s + v, 0);

  const mesAtual = `${anoAtual}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const serieMensal = meses.map((m) => {
    const t = porMes.get(m) ?? totaisVazios();
    // Mês futuro sem nota: a linha não desce a zero (fica em branco).
    const vazio = t.notas === 0 && m > mesAtual;
    return { mes: rotuloMes(m), bruto: vazio ? null : t.bruto, liquido: vazio ? null : t.liquido, recebido: vazio ? null : t.recebido };
  });

  const donutClientes = useMemo(() => {
    const ordenado = [...porCliente.entries()].sort((a, b) => b[1].liquido - a[1].liquido);
    const top = ordenado.slice(0, 6).map(([nome, t]) => ({ nome, valor: t.liquido }));
    const resto = ordenado.slice(6).reduce((s, [, t]) => s + t.liquido, 0);
    return resto > 0 ? [...top, { nome: "Outros", valor: resto }] : top;
  }, [porCliente]);

  const buscaN = busca.trim().toLowerCase();
  const linhasContrato = useMemo(
    () =>
      [...porContrato.entries()]
        .map(([id, t]) => ({ id, t, c: contratoPorId.get(id) }))
        .filter((l) => !buscaN || `${l.c?.nome ?? ""} ${l.c?.cliente ?? ""}`.toLowerCase().includes(buscaN))
        .sort((a, b) => b.t.bruto - a.t.bruto),
    [porContrato, contratoPorId, buscaN]
  );
  const linhasCliente = useMemo(
    () =>
      [...porCliente.entries()]
        .filter(([nome]) => !buscaN || nome.toLowerCase().includes(buscaN))
        .sort((a, b) => b[1].bruto - a[1].bruto),
    [porCliente, buscaN]
  );

  const Rodape = ({ t }: { t: TotaisFaturamento }) => (
    <>
      <TableCell className="text-right font-semibold">{fmtMoney(t.bruto)}</TableCell>
      <TableCell className="text-right font-semibold">{fmtMoney(t.descontos)}</TableCell>
      <TableCell className="text-right font-semibold">{fmtMoney(t.liquido)}</TableCell>
      <TableCell className="text-right font-semibold">{fmtMoney(t.recebido)}</TableCell>
      <TableCell className="text-right font-semibold">{fmtMoney(t.aReceber)}</TableCell>
    </>
  );
  const Celulas = ({ t }: { t: TotaisFaturamento }) => (
    <>
      <TableCell className="text-right">{fmtMoney(t.bruto)}</TableCell>
      <TableCell className="text-right">{fmtMoney(t.descontos)}</TableCell>
      <TableCell className="text-right">{fmtMoney(t.liquido)}</TableCell>
      <TableCell className="text-right">{fmtMoney(t.recebido)}</TableCell>
      <TableCell className="text-right">{fmtMoney(t.aReceber)}</TableCell>
    </>
  );
  const Cabecalho = () => (
    <>
      <TableHead className="text-right">Valor Bruto</TableHead>
      <TableHead className="text-right">Descontos</TableHead>
      <TableHead className="text-right">Valor Líquido</TableHead>
      <TableHead className="text-right">Recebido</TableHead>
      <TableHead className="text-right">A Receber</TableHead>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        module="Controladoria"
        breadcrumb={["Faturamento da Empresa"]}
        title="Faturamento da Empresa"
        subtitle="Faturamento geral com visão de notas emitidas, recebidas e a receber — NFs Código N validadas no Relatório de Serviços."
        actions={<Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Imprimir</Button>}
      />

      <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs print:hidden">
        <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
          <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={empresaId} onValueChange={(v) => { setEmpresaId(v); setContratoId(TODOS); }}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as empresas</SelectItem>
            {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={contratoId} onValueChange={setContratoId}>
          <SelectTrigger className="h-8 w-[240px] text-xs"><SelectValue placeholder="Contrato" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os contratos</SelectItem>
            {contratos.filter((c) => empresaId === TODOS || c.empresa_id === empresaId).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={cliente} onValueChange={setCliente}>
          <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Cliente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os clientes</SelectItem>
            {clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setEmpresaId(TODOS); setContratoId(TODOS); setCliente(TODOS); setBusca(""); }}>Limpar</Button>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile label="Valor Faturado (Bruto)" valor={fmtMoney(total.bruto)} sub={`${total.notas.toLocaleString("pt-BR")} nota(s) em ${ano}`} icon={<TrendingUp />} cor="sky" />
            <KpiTile label="Valor Líquido (Após Descontos)" valor={fmtMoney(total.liquido)} sub={`${fmtMoney(total.descontos)} em descontos`} icon={<Wallet />} cor="slate" />
            <KpiTile label="Notas Recebidas" valor={fmtMoney(total.recebido)} sub={`${pct(total.recebido, total.liquido)} do líquido`} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
            <KpiTile label="A Receber" valor={fmtMoney(total.aReceber)} sub={`${pct(total.aReceber, total.liquido)} do líquido`} icon={<Clock />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Faturamento Mensal (R$)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={serieMensal}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mes" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={milhoes} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Legend />
                    <Bar dataKey="bruto" name="Valor Bruto" fill="#1e3a8a" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="liquido" name="Valor Líquido" fill="#f97316" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Notas Emitidas × Recebidas (R$)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={serieMensal}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="mes" fontSize={11} />
                    <YAxis fontSize={11} tickFormatter={milhoes} />
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="liquido" name="Emitidas (líquido)" stroke="#1e3a8a" strokeWidth={2} dot={false} connectNulls={false} />
                    <Line type="monotone" dataKey="recebido" name="Recebidas" stroke="#f97316" strokeWidth={2} dot={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Composição do Faturamento (líquido) por cliente</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={150}>
                  <PieChart>
                    <Pie data={donutClientes} dataKey="valor" nameKey="nome" innerRadius={38} outerRadius={62} paddingAngle={2}>
                      {donutClientes.map((d, i) => <Cell key={d.nome} fill={CORES[i % CORES.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtMoney(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <ul className="mt-2 space-y-1 text-[11px]">
                  {donutClientes.map((d, i) => (
                    <li key={d.nome} className="flex items-center gap-1.5">
                      <i className="inline-block h-2 w-2 rounded-sm shrink-0" style={{ background: CORES[i % CORES.length] }} />
                      <span className="truncate flex-1">{d.nome}</span>
                      <span className="text-muted-foreground">{pct(d.valor, total.liquido)}</span>
                    </li>
                  ))}
                  {donutClientes.length === 0 && <li className="text-muted-foreground">Sem notas no recorte.</li>}
                </ul>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="mensal">
            <div className="flex items-center gap-2 flex-wrap">
              <TabsList>
                <TabsTrigger value="mensal">Resumo Mensal</TabsTrigger>
                <TabsTrigger value="contrato">Por Contrato</TabsTrigger>
                <TabsTrigger value="cliente">Por Cliente</TabsTrigger>
              </TabsList>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar contrato ou cliente..." className="h-8 w-[240px] text-xs ml-auto print:hidden" />
            </div>

            <TabsContent value="mensal" className="mt-3">
              <div className="card-elevated overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mês</TableHead>
                      <TableHead className="text-right">Valor Exec. (Planilha)</TableHead>
                      <TableHead className="text-right">Diferença Exec. × Fat.</TableHead>
                      <Cabecalho />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meses.map((m) => {
                      const t = porMes.get(m) ?? totaisVazios();
                      const exec = execPorMes.get(m) ?? 0;
                      return (
                        <TableRow key={m}>
                          <TableCell className="font-medium">{rotuloMes(m)}</TableCell>
                          <TableCell className="text-right">{exec ? fmtMoney(exec) : "—"}</TableCell>
                          <TableCell className="text-right">{exec && t.notas ? <Num v={exec - t.bruto} /> : "—"}</TableCell>
                          <Celulas t={t} />
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className="font-semibold">Total</TableCell>
                      <TableCell className="text-right font-semibold">{fmtMoney(execTotal)}</TableCell>
                      <TableCell />
                      <Rodape t={total} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="contrato" className="mt-3">
              <div className="card-elevated overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Contrato</TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Notas</TableHead><Cabecalho /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhasContrato.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="font-medium">{l.c?.nome ?? "(contrato removido)"}</TableCell>
                        <TableCell>{l.c?.cliente ?? "—"}</TableCell>
                        <TableCell className="text-right">{l.t.notas}</TableCell>
                        <Celulas t={l.t} />
                      </TableRow>
                    ))}
                    {linhasContrato.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhuma nota no recorte.</TableCell></TableRow>}
                  </TableBody>
                  <TableFooter><TableRow><TableCell colSpan={2} className="font-semibold">Total</TableCell><TableCell className="text-right font-semibold">{total.notas}</TableCell><Rodape t={total} /></TableRow></TableFooter>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="cliente" className="mt-3">
              <div className="card-elevated overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Cliente</TableHead><TableHead className="text-right">Notas</TableHead><Cabecalho /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhasCliente.map(([nome, t]) => (
                      <TableRow key={nome}>
                        <TableCell className="font-medium">{nome}</TableCell>
                        <TableCell className="text-right">{t.notas}</TableCell>
                        <Celulas t={t} />
                      </TableRow>
                    ))}
                    {linhasCliente.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Nenhuma nota no recorte.</TableCell></TableRow>}
                  </TableBody>
                  <TableFooter><TableRow><TableCell className="font-semibold">Total</TableCell><TableCell className="text-right font-semibold">{total.notas}</TableCell><Rodape t={total} /></TableRow></TableFooter>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
