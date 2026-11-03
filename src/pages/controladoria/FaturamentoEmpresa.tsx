import { useMemo, useState, type ReactNode } from "react";
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
import { agruparFaturamento, custosPorContratoMes, lucroBruto, lucroRecebido, totaisVazios, totalCustos, TotaisFaturamento } from "./faturamento/regras";
import { SeletorBaseLeitura } from "./faturamento/SeletorBaseLeitura";
import { BotaoTratamentoContratos } from "./faturamento/TratamentoContratosDialog";
import { useLeituraCompartilhada } from "./faturamento/leituraCompartilhada";
import { CODIGO_PADRAO, codigosDoFiltro, FiltroCodigoNota } from "./faturamento/FiltroCodigoNota";
import { rotuloMes, useBaseFaturamento } from "./faturamento/useBaseFaturamento";
import { useCustosContratoAno } from "./faturamento/useCustosContratoMes";
import { useLigacoesRubrica } from "./faturamento/useLigacoesRubrica";
import { FaixasTexto, pillDaMargem, StatusRentabilidade, TituloComFormula } from "./faturamento/Rentabilidade";
import { DetalheComposicao } from "./faturamento/DetalheComposicao";
import { useTratamentosContrato } from "./faturamento/useTratamentosContrato";
import { montarComposicao, type EscopoDetalhe, type Metrica } from "./faturamento/composicao";

// SIS-2026-0556: Faturamento da Empresa (Controladoria). Mesma base do
// Controle de Faturamento: NFs Código N validadas do Relatório de Serviços,
// fora de cancelada/substituída. Mês = competência da nota.

const TODOS = "todos";
const CORES = ["#1e3a8a", "#f97316", "#38bdf8", "#64748b", "#10b981", "#a855f7", "#eab308"];
const pct = (parte: number, todo: number) => (todo > 0 ? `${((parte / todo) * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—");
const milhoes = (v: number) => `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;

// Sem "R$" nas células (o cabeçalho diz "(R$)"): é o que faz as colunas caberem.
const num2 = (n: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const pctTxt = (m: number | null) => (m === null ? "—" : `${(m * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const CAB = "h-auto px-2 py-1.5 text-right align-bottom whitespace-normal leading-tight";
const CEL = "px-2 py-1.5 align-middle";
const CEL_NUM = `${CEL} text-right whitespace-nowrap`;

function Num({ v, negativoVermelho }: { v: number; negativoVermelho?: boolean }) {
  return <span className={negativoVermelho && v < 0 ? "text-red-600 font-medium" : undefined}>{fmtMoney(v)}</span>;
}

export default function FaturamentoEmpresa() {
  // Filtro Código (tipo da nota): padrão N, como sempre foi.
  // SIS-2026-0721: base, código e empresa vêm da leitura compartilhada com a Lucratividade e o Fechamento.
  const { base, setBase, codigo, setCodigo, empresaId, setEmpresaId } = useLeituraCompartilhada();
  const textoBase = base === "pagamento" ? "pela data de pagamento" : "pela competência";
  const codigos = useMemo(() => codigosDoFiltro(codigo), [codigo]);
  const { contratos, nfs, empresas, contratoPorId, executavelDoContrato, origemExecutavel, carregando } = useBaseFaturamento(codigos);

  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const [contratoId, setContratoId] = useState(TODOS);
  const [cliente, setCliente] = useState(TODOS);
  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState("mensal");
  // SIS-2026-0641: clicar em qualquer valor da tabela (ou nos tiles) abre "como esse número é formado".
  const [detalhe, setDetalhe] = useState<{ metrica: Metrica; escopo: EscopoDetalhe } | null>(null);
  // Custos do ano só são buscados quando a aba "Por Contrato" (que tem lucro e
  // margem) é aberta: as outras abas não precisam do Fluxo de Caixa.
  const { data: custosAno = [], isLoading: carregandoCustos, error: erroCustos } = useCustosContratoAno(ano, aba === "contrato" || aba === "mensal", base);
  const { data: ligacoes } = useLigacoesRubrica();
  const { data: tratamentos } = useTratamentosContrato();
  const custoPorContrato = useMemo(() => {
    const m = new Map<string, number>();
    for (const [chave, c] of custosPorContratoMes(custosAno, ligacoes)) {
      const id = chave.split("|")[0];
      m.set(id, (m.get(id) ?? 0) + totalCustos(c));
    }
    return m;
  }, [custosAno, ligacoes]);

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

  // Custos por mês de pagamento dos contratos do recorte filtrado (todos eles, com
  // ou sem nota no mês): é o custo da empresa naquele mês.
  const custoPorMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const [chave, c] of custosPorContratoMes(custosAno, ligacoes)) {
      const [id, mes] = chave.split("|");
      if (!contratoPassa(id)) continue;
      m.set(mes, (m.get(mes) ?? 0) + totalCustos(c));
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [custosAno, ligacoes, empresaId, contratoId, cliente, contratoPorId]);

  const execPorMes = useMemo(() => {
    const m = new Map<string, number>();
    for (const mes of meses) m.set(mes, contratosDoRecorte.reduce((s, c) => s + executavelDoContrato(c, mes), 0));
    return m;
  }, [meses, contratosDoRecorte, executavelDoContrato]);

  const total = useMemo(() => {
    const t = totaisVazios();
    for (const v of porMes.values()) {
      t.bruto += v.bruto; t.liquido += v.liquido; t.descontos += v.descontos; t.recebido += v.recebido; t.aReceber += v.aReceber; t.contaVinculada += v.contaVinculada; t.posEmissao += v.posEmissao; t.notas += v.notas;
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

  // Todo valor da tabela é um botão: abre como ele é formado (SIS-2026-0641).
  const Clica = ({ m, escopo, children }: { m: Metrica; escopo: EscopoDetalhe; children: ReactNode }) => (
    <button
      type="button"
      className="underline decoration-dotted underline-offset-2 hover:text-amber-600 print:no-underline"
      title="Ver como este valor é formado"
      onClick={() => setDetalhe({ metrica: m, escopo })}
    >
      {children}
    </button>
  );
  const Rodape = ({ t, escopo }: { t: TotaisFaturamento; escopo: EscopoDetalhe }) => (
    <>
      <TableCell className={`${CEL_NUM} font-semibold`}><Clica m="bruto" escopo={escopo}>{num2(t.bruto)}</Clica></TableCell>
      <TableCell className={`${CEL_NUM} font-semibold`}><Clica m="descontos" escopo={escopo}>{num2(t.descontos)}</Clica></TableCell>
      <TableCell className={`${CEL_NUM} font-semibold`}><Clica m="liquido" escopo={escopo}>{num2(t.liquido)}</Clica></TableCell>
      <TableCell className={`${CEL_NUM} font-semibold`}><Clica m="recebido" escopo={escopo}>{num2(t.recebido)}</Clica></TableCell>
      <TableCell className={`${CEL_NUM} font-semibold`}><Clica m="aReceber" escopo={escopo}>{num2(t.aReceber)}</Clica></TableCell>
      <TableCell className={`${CEL_NUM} font-semibold`}><Clica m="contaVinculada" escopo={escopo}>{num2(t.contaVinculada)}</Clica></TableCell>
    </>
  );
  const Celulas = ({ t, escopo }: { t: TotaisFaturamento; escopo: EscopoDetalhe }) => (
    <>
      <TableCell className={CEL_NUM}><Clica m="bruto" escopo={escopo}>{num2(t.bruto)}</Clica></TableCell>
      <TableCell className={CEL_NUM}><Clica m="descontos" escopo={escopo}>{num2(t.descontos)}</Clica></TableCell>
      <TableCell className={CEL_NUM}><Clica m="liquido" escopo={escopo}>{num2(t.liquido)}</Clica></TableCell>
      <TableCell className={CEL_NUM}><Clica m="recebido" escopo={escopo}>{num2(t.recebido)}</Clica></TableCell>
      <TableCell className={CEL_NUM}><Clica m="aReceber" escopo={escopo}>{num2(t.aReceber)}</Clica></TableCell>
      <TableCell className={CEL_NUM}><Clica m="contaVinculada" escopo={escopo}>{num2(t.contaVinculada)}</Clica></TableCell>
    </>
  );
  const Cabecalho = () => (
    <>
      <TableHead className={CAB}><TituloComFormula titulo="Valor Bruto (R$)" formula="Soma do valor bruto das NFs Código N da competência (já validadas; fora de canceladas e substituídas)." /></TableHead>
      <TableHead className={CAB}><TituloComFormula titulo="Descontos (R$)" formula="Valor Bruto − Valor Líquido: o que foi descontado nas notas." /></TableHead>
      <TableHead className={CAB}><TituloComFormula titulo="Valor Líquido (R$)" formula="Soma do valor líquido das mesmas NFs: o bruto depois dos descontos." /></TableHead>
      <TableHead className={CAB}><TituloComFormula titulo="Recebido (R$)" formula="Soma do valor pago das notas (pagamento registrado no Relatório de Serviços). É o “Notas Recebidas”." /></TableHead>
      <TableHead className={CAB}><TituloComFormula titulo="A Receber (R$)" formula="Valor Líquido − já pago − conta vinculada − descontos depois da NF, por nota. Nota paga não tem saldo. Clique no valor para ver o detalhamento." /></TableHead>
      <TableHead className={CAB}><TituloComFormula titulo="Conta vinculada (R$)" formula="Soma do Desconto de conta vinculada retido nas notas (coluna do Relatório de Serviços). Não entra em dinheiro e não é saldo a receber." /></TableHead>
    </>
  );

  // Lucro por contrato (aba "Por Contrato"): custos do ano pela competência,
  // as mesmas saídas do Fluxo com contrato usadas na Lucratividade.
  const custoDe = (id: string) => custoPorContrato.get(id) ?? 0;
  const custoTotalContratos = useMemo(() => [...porContrato.keys()].reduce((s, id) => s + (custoPorContrato.get(id) ?? 0), 0), [porContrato, custoPorContrato]);
  const totalLucro = lucroBruto(total.liquido, custoTotalContratos);
  const custosPendentes = carregandoCustos || !!erroCustos;
  // Total do ano no Resumo Mensal: soma dos custos mensais do recorte.
  const custoAno = useMemo(() => [...custoPorMes.values()].reduce((s, v) => s + v, 0), [custoPorMes]);
  const lucroAno = lucroBruto(total.liquido, custoAno);

  // SIS-2026-0641: recorte de cada célula clicável (o modal "como é formado" refaz a conta com ele).
  const idsRecorte = useMemo(() => contratosDoRecorte.map((c) => c.id), [contratosDoRecorte]);
  const escopoTotal: EscopoDetalhe = { titulo: `${ano} — recorte da tela`, nfs: nfsFiltradas, meses, contratoIds: idsRecorte };
  const escopoMes = (m: string): EscopoDetalhe => ({ titulo: rotuloMes(m), nfs: nfsFiltradas.filter((n) => n.competencia.startsWith(m)), meses: [m], contratoIds: idsRecorte });
  const escopoContrato = (id: string, nome: string): EscopoDetalhe => ({ titulo: nome, nfs: nfsFiltradas.filter((n) => n.contrato_id === id), meses, contratoIds: [id] });
  const escopoTotalContratos: EscopoDetalhe = { titulo: `${ano} — contratos com nota`, nfs: nfsFiltradas, meses, contratoIds: [...porContrato.keys()] };
  const escopoCliente = (nome: string): EscopoDetalhe => ({
    titulo: nome,
    nfs: nfsFiltradas.filter((n) => (contratoPorId.get(n.contrato_id)?.cliente ?? "(sem cliente)") === nome),
    meses,
    contratoIds: idsRecorte.filter((id) => (contratoPorId.get(id)?.cliente ?? "(sem cliente)") === nome),
  });
  const composicao = useMemo(
    () =>
      detalhe
        ? montarComposicao(detalhe.metrica, detalhe.escopo, {
            contratoNome: (id) => contratoPorId.get(id)?.nome ?? "(contrato removido)",
            baseDespesa: base,
            execDe: (id, mes) => {
              const c = contratoPorId.get(id);
              return c ? origemExecutavel(c, mes) : { valor: 0, fonte: "sem_valor" };
            },
            custos: custosAno,
            ligacoes,
            tratamentos,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detalhe, custosAno, ligacoes, contratoPorId, tratamentos]
  );

  return (
    <div className="space-y-6">
      <PageHeader
        module="Controladoria"
        breadcrumb={["Faturamento da Empresa"]}
        title="Faturamento da Empresa"
        subtitle="Faturamento geral com visão de notas emitidas, recebidas e a receber — NFs validadas no Relatório de Serviços, do código escolhido (padrão N)."
        actions={<div className="flex items-center gap-2"><BotaoTratamentoContratos /><Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Imprimir</Button></div>}
      />

      <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs print:hidden">
        <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
          <SelectTrigger className="h-8 w-[90px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <SeletorBaseLeitura base={base} onChange={setBase} />
        <FiltroCodigoNota valor={codigo} onChange={setCodigo} />
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
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setEmpresaId(TODOS); setContratoId(TODOS); setCliente(TODOS); setBusca(""); setCodigo(CODIGO_PADRAO); }}>Limpar</Button>
      </div>

      {carregando ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiTile label="Valor Faturado (Bruto)" valor={fmtMoney(total.bruto)} sub={`${total.notas.toLocaleString("pt-BR")} nota(s) em ${ano}`} icon={<TrendingUp />} cor="sky" onClick={() => setDetalhe({ metrica: "bruto", escopo: escopoTotal })} />
            <KpiTile label="Valor Líquido (Após Descontos)" valor={fmtMoney(total.liquido)} sub={`${fmtMoney(total.descontos)} em descontos`} icon={<Wallet />} cor="slate" onClick={() => setDetalhe({ metrica: "liquido", escopo: escopoTotal })} />
            <KpiTile label="Notas Recebidas" valor={fmtMoney(total.recebido)} sub={`${pct(total.recebido, total.liquido)} do líquido`} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" onClick={() => setDetalhe({ metrica: "recebido", escopo: escopoTotal })} />
            <KpiTile label="A Receber" valor={fmtMoney(total.aReceber)} sub={`${pct(total.aReceber, total.liquido)} do líquido · clique para ver como é formado`} icon={<Clock />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" onClick={() => setDetalhe({ metrica: "aReceber", escopo: escopoTotal })} />
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

          <Tabs value={aba} onValueChange={setAba}>
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
                <Table className="text-[11px] tabular-nums">
                  <TableHeader>
                    <TableRow>
                      <TableHead className={`${CAB} text-left`}>Mês</TableHead>
                      <TableHead className={CAB}><TituloComFormula titulo="Valor Exec. Planilha (R$)" formula="Valor executável dos contratos do recorte no mês, segundo a planilha de custo vigente. Contrato sem planilha usa o Valor Executado Mensal do cadastro do contrato. Zero depois do fim do contrato." /></TableHead>
                      <TableHead className={CAB}><TituloComFormula titulo="Diferença Exec. × Fat. (R$)" formula="Valor Exec. Planilha − Valor Bruto faturado no mês. Positivo = faturou menos do que o executável." /></TableHead>
                      <Cabecalho />
                      <TableHead className={CAB}><TituloComFormula titulo="Despesas (R$)" formula={`Despesas dos contratos do recorte ${base === "pagamento" ? "pagas no mês" : "com competência no mês"}: saídas do Fluxo de Caixa com contrato, ${textoBase}, sem transferências, aplicações e empréstimos. Contratos de estoque, movimentação financeira, investimento e administrativos ficam de fora (clique no valor para ver e ajustar). É o custo usado no Lucro.`} /></TableHead>
                      <TableHead className={CAB}><TituloComFormula titulo="Lucro Faturamento (R$)" formula={`Valor Líquido do mês − custos do mês (saídas do Fluxo de Caixa com contrato dos contratos do recorte, ${textoBase}, sem transferências, aplicações e empréstimos).`} /></TableHead>
                      <TableHead className={CAB}><TituloComFormula titulo="Lucro Recebido (R$)" formula="Recebido do mês − os mesmos custos. A diferença para o Lucro Faturamento é só o que ainda falta receber." /></TableHead>
                      <TableHead className={CAB}><TituloComFormula titulo="Margem Bruta (%)" formula={<><p>Lucro Faturamento ÷ Valor Líquido × 100. Em branco quando não há faturamento no mês.</p><p className="font-medium pt-1">A cor e o Status seguem a faixa:</p><FaixasTexto /></>} /></TableHead>
                      <TableHead className={`${CAB} text-left`}><TituloComFormula alinhar="left" titulo="Status" formula={<><p>Rentabilidade do mês, pela Margem Bruta. A barra enche até 30% de margem.</p><FaixasTexto /></>} /></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {meses.map((m) => {
                      const t = porMes.get(m) ?? totaisVazios();
                      const exec = execPorMes.get(m) ?? 0;
                      const custo = custoPorMes.get(m) ?? 0;
                      // Mês sem nota e sem custo (ex.: futuro) não mostra lucro.
                      const temDado = t.notas > 0 || custo > 0;
                      const lucro = lucroBruto(t.liquido, custo);
                      return (
                        <TableRow key={m}>
                          <TableCell className={`${CEL} font-medium`}>{rotuloMes(m)}</TableCell>
                          <TableCell className={CEL_NUM}><Clica m="exec" escopo={escopoMes(m)}>{exec ? num2(exec) : "—"}</Clica></TableCell>
                          <TableCell className={CEL_NUM}><Clica m="diferenca" escopo={escopoMes(m)}>{exec && t.notas ? <Num v={exec - t.bruto} /> : "—"}</Clica></TableCell>
                          <Celulas t={t} escopo={escopoMes(m)} />
                          <TableCell className={CEL_NUM}>{custosPendentes ? "…" : <Clica m="despesas" escopo={escopoMes(m)}>{custo > 0 ? num2(custo) : "—"}</Clica>}</TableCell>
                          <TableCell className={`${CEL_NUM} ${temDado && !custosPendentes && lucro.lucro < 0 ? "text-red-600" : ""}`}>{custosPendentes ? "…" : temDado ? <Clica m="lucroFat" escopo={escopoMes(m)}>{num2(lucro.lucro)}</Clica> : "—"}</TableCell>
                          <TableCell className={`${CEL_NUM} ${temDado && !custosPendentes && lucroRecebido(t.recebido, custo) < 0 ? "text-red-600" : ""}`}>{custosPendentes ? "…" : temDado ? <Clica m="lucroRec" escopo={escopoMes(m)}>{num2(lucroRecebido(t.recebido, custo))}</Clica> : "—"}</TableCell>
                          <TableCell className={`${CEL} text-right`}>
                            {custosPendentes ? "…" : temDado ? <Clica m="margem" escopo={escopoMes(m)}><span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pillDaMargem(lucro.margem)}`}>{pctTxt(lucro.margem)}</span></Clica> : "—"}
                          </TableCell>
                          <TableCell className={CEL}>{custosPendentes ? "…" : temDado ? <StatusRentabilidade margem={lucro.margem} /> : "—"}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className={`${CEL} font-semibold`}>Total</TableCell>
                      <TableCell className={`${CEL_NUM} font-semibold`}><Clica m="exec" escopo={escopoTotal}>{num2(execTotal)}</Clica></TableCell>
                      <TableCell />
                      <Rodape t={total} escopo={escopoTotal} />
                      <TableCell className={`${CEL_NUM} font-semibold`}>{custosPendentes ? "…" : <Clica m="despesas" escopo={escopoTotal}>{num2(custoAno)}</Clica>}</TableCell>
                      <TableCell className={`${CEL_NUM} font-semibold`}>{custosPendentes ? "…" : <Clica m="lucroFat" escopo={escopoTotal}>{num2(lucroAno.lucro)}</Clica>}</TableCell>
                      <TableCell className={`${CEL_NUM} font-semibold`}>{custosPendentes ? "…" : <Clica m="lucroRec" escopo={escopoTotal}>{num2(lucroRecebido(total.recebido, custoAno))}</Clica>}</TableCell>
                      <TableCell className={`${CEL} text-right`}>
                        {custosPendentes ? "…" : <Clica m="margem" escopo={escopoTotal}><span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pillDaMargem(lucroAno.margem)}`}>{pctTxt(lucroAno.margem)}</span></Clica>}
                      </TableCell>
                      <TableCell className={CEL}>{custosPendentes ? "…" : <StatusRentabilidade margem={lucroAno.margem} />}</TableCell>
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="contrato" className="mt-3">
              <div className="card-elevated overflow-x-auto">
                <Table className="text-[11px] tabular-nums">
                  <TableHeader>
                    <TableRow>
                      <TableHead className={`${CAB} text-left min-w-[150px]`}>Contrato / Cliente</TableHead>
                      <TableHead className={CAB}><TituloComFormula titulo="Notas" formula="Quantidade de NFs Código N do contrato na competência do ano." /></TableHead>
                      <Cabecalho />
                      <TableHead className={CAB}><TituloComFormula titulo="Despesas (R$)" formula={`Despesas do contrato no ano: saídas do Fluxo de Caixa com contrato, ${textoBase}, sem transferências, aplicações e empréstimos. É o custo usado no Lucro.`} /></TableHead>
                      <TableHead className={CAB}>
                        <TituloComFormula titulo="Lucro Faturamento (R$)" formula={`Valor Líquido − custos do contrato no ano (saídas do Fluxo de Caixa com contrato, ${textoBase}, sem transferências, aplicações e empréstimos).`} />
                      </TableHead>
                      <TableHead className={CAB}>
                        <TituloComFormula titulo="Lucro Recebido (R$)" formula="Recebido − os mesmos custos do contrato. A diferença para o Lucro Faturamento é só o que ainda falta receber." />
                      </TableHead>
                      <TableHead className={CAB}>
                        <TituloComFormula titulo="Margem Bruta (%)" formula={<><p>Lucro Faturamento ÷ Valor Líquido × 100. Em branco quando não há faturamento.</p><p className="font-medium pt-1">A cor e o Status seguem a faixa:</p><FaixasTexto /></>} />
                      </TableHead>
                      <TableHead className={`${CAB} text-left`}>
                        <TituloComFormula alinhar="left" titulo="Status" formula={<><p>Rentabilidade do contrato, pela Margem Bruta. A barra enche até 30% de margem.</p><FaixasTexto /></>} />
                      </TableHead>
                      <TableHead className={`${CAB} text-center`}>
                        <TituloComFormula alinhar="center" titulo="Situação" formula="Situação do contrato no ERP (ativo, encerrado ou suspenso). Não mede rentabilidade." />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhasContrato.map((l) => {
                      const custo = custoDe(l.id);
                      const lucro = lucroBruto(l.t.liquido, custo);
                      const status = l.c?.status ?? "—";
                      return (
                        <TableRow key={l.id}>
                          <TableCell className={`${CEL} max-w-[190px]`}>
                            <span className="block font-medium leading-tight line-clamp-2">{l.c?.nome ?? "(contrato removido)"}</span>
                            <span className="block text-[10px] text-muted-foreground leading-tight line-clamp-1">{l.c?.cliente ?? "—"}</span>
                          </TableCell>
                          <TableCell className={CEL_NUM}>{l.t.notas}</TableCell>
                          <Celulas t={l.t} escopo={escopoContrato(l.id, l.c?.nome ?? "contrato removido")} />
                          <TableCell className={CEL_NUM}>{custosPendentes ? "…" : <Clica m="despesas" escopo={escopoContrato(l.id, l.c?.nome ?? "contrato removido")}>{custo > 0 ? num2(custo) : "—"}</Clica>}</TableCell>
                          <TableCell className={`${CEL_NUM} ${!custosPendentes && lucro.lucro < 0 ? "text-red-600" : ""}`}>{custosPendentes ? "…" : <Clica m="lucroFat" escopo={escopoContrato(l.id, l.c?.nome ?? "contrato removido")}>{num2(lucro.lucro)}</Clica>}</TableCell>
                          <TableCell className={`${CEL_NUM} ${!custosPendentes && lucroRecebido(l.t.recebido, custo) < 0 ? "text-red-600" : ""}`}>{custosPendentes ? "…" : <Clica m="lucroRec" escopo={escopoContrato(l.id, l.c?.nome ?? "contrato removido")}>{num2(lucroRecebido(l.t.recebido, custo))}</Clica>}</TableCell>
                          <TableCell className={`${CEL} text-right`}>
                            {custosPendentes ? "…" : <Clica m="margem" escopo={escopoContrato(l.id, l.c?.nome ?? "contrato removido")}><span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pillDaMargem(lucro.margem)}`}>{pctTxt(lucro.margem)}</span></Clica>}
                          </TableCell>
                          <TableCell className={CEL}>{custosPendentes ? "…" : <StatusRentabilidade margem={lucro.margem} />}</TableCell>
                          <TableCell className={`${CEL} text-center`}>
                            <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${status === "ativo" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{status}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {linhasContrato.length === 0 && <TableRow><TableCell colSpan={14} className="text-center text-muted-foreground py-6">Nenhuma nota no recorte.</TableCell></TableRow>}
                  </TableBody>
                  <TableFooter>
                    <TableRow>
                      <TableCell className={`${CEL} font-semibold`}>Total</TableCell>
                      <TableCell className={`${CEL_NUM} font-semibold`}>{total.notas}</TableCell>
                      <Rodape t={total} escopo={escopoTotalContratos} />
                      <TableCell className={`${CEL_NUM} font-semibold`}>{custosPendentes ? "…" : <Clica m="despesas" escopo={escopoTotalContratos}>{num2(custoTotalContratos)}</Clica>}</TableCell>
                      <TableCell className={`${CEL_NUM} font-semibold`}>{custosPendentes ? "…" : <Clica m="lucroFat" escopo={escopoTotalContratos}>{num2(totalLucro.lucro)}</Clica>}</TableCell>
                      <TableCell className={`${CEL_NUM} font-semibold`}>{custosPendentes ? "…" : <Clica m="lucroRec" escopo={escopoTotalContratos}>{num2(lucroRecebido(total.recebido, custoTotalContratos))}</Clica>}</TableCell>
                      <TableCell className={`${CEL} text-right`}>
                        {custosPendentes ? "…" : <Clica m="margem" escopo={escopoTotalContratos}><span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pillDaMargem(totalLucro.margem)}`}>{pctTxt(totalLucro.margem)}</span></Clica>}
                      </TableCell>
                      <TableCell className={CEL}>{custosPendentes ? "…" : <StatusRentabilidade margem={totalLucro.margem} />}</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
                {erroCustos && <p className="text-xs text-red-600 p-3">Não foi possível carregar os custos do ano: {(erroCustos as { message?: string }).message ?? "erro desconhecido"}.</p>}
              </div>
            </TabsContent>

            <TabsContent value="cliente" className="mt-3">
              <div className="card-elevated overflow-x-auto">
                <Table className="text-[11px] tabular-nums">
                  <TableHeader>
                    <TableRow><TableHead className={`${CAB} text-left`}>Cliente</TableHead><TableHead className={CAB}><TituloComFormula titulo="Notas" formula="Quantidade de NFs Código N do cliente na competência do ano." /></TableHead><Cabecalho /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhasCliente.map(([nome, t]) => (
                      <TableRow key={nome}>
                        <TableCell className={`${CEL} font-medium`}>{nome}</TableCell>
                        <TableCell className={CEL_NUM}>{t.notas}</TableCell>
                        <Celulas t={t} escopo={escopoCliente(nome)} />
                      </TableRow>
                    ))}
                    {linhasCliente.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Nenhuma nota no recorte.</TableCell></TableRow>}
                  </TableBody>
                  <TableFooter><TableRow><TableCell className={`${CEL} font-semibold`}>Total</TableCell><TableCell className={`${CEL_NUM} font-semibold`}>{total.notas}</TableCell><Rodape t={total} escopo={escopoTotal} /></TableRow></TableFooter>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      <DetalheComposicao composicao={composicao} onClose={() => setDetalhe(null)} />
    </div>
  );
}
