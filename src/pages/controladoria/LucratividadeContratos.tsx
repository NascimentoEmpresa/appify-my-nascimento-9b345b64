import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { FileDown, Percent, Printer, TrendingUp, Wallet, Receipt } from "lucide-react";
import { toast } from "sonner";
import { useCustosContratoMes } from "./faturamento/useCustosContratoMes";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { agruparFaturamento, custosPorContratoMes, custosVazios, CustosPorRubrica, lucroBruto, RUBRICAS, totaisVazios, totalCustos } from "./faturamento/regras";
import { rotuloMes, useBaseFaturamento } from "./faturamento/useBaseFaturamento";
import { BannerAuditoria } from "./auditoria/BannerAuditoria";

// SIS-2026-0556: Lucratividade de Contratos (Controladoria). Faturamento vem
// das NFs Código N (competência); custo realizado vem das SAÍDAS do Fluxo de
// Caixa com contrato (mês do pagamento — regime de caixa), sem transferências,
// aplicações, empréstimos etc. (ver faturamento/regras.ts).

const TODOS = "todos";
const pctTxt = (m: number | null) => (m === null ? "—" : `${(m * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const corMargem = (m: number | null) => (m === null ? "" : m < 0 ? "text-red-600 font-medium" : m < 0.15 ? "text-orange-600 font-medium" : "text-emerald-600 font-medium");

interface Linha {
  id: string;
  contrato: string;
  cliente: string;
  status: string;
  exec: number;
  bruto: number;
  liquido: number;
  descontos: number;
  custos: CustosPorRubrica;
  totalCusto: number;
  lucro: number;
  margem: number | null;
}

export default function LucratividadeContratos() {
  const { contratos, nfs, empresas, executavelDoContrato, carregando } = useBaseFaturamento();
  const hoje = new Date();
  const [mes, setMes] = useState(`${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`);
  const { data: fluxo = [], isLoading: carregandoFluxo, error: erroFluxo } = useCustosContratoMes(mes);
  const [empresaId, setEmpresaId] = useState(TODOS);
  const [cliente, setCliente] = useState(TODOS);
  const [situacao, setSituacao] = useState(TODOS);
  const [busca, setBusca] = useState("");

  // Meses com nota emitida (mais o mês atual) — o custo é buscado do mês escolhido.
  const mesesDisponiveis = useMemo(() => {
    const s = new Set<string>([mes]);
    for (const n of nfs) s.add(n.competencia.slice(0, 7));
    return [...s].sort().reverse();
  }, [nfs, mes]);

  const custos = useMemo(() => custosPorContratoMes(fluxo), [fluxo]);
  const fat = useMemo(() => agruparFaturamento(nfs.filter((n) => n.competencia.startsWith(mes)), (n) => n.contrato_id), [nfs, mes]);
  const clientes = useMemo(() => [...new Set(contratos.map((c) => c.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [contratos]);

  const linhas = useMemo<Linha[]>(() => {
    const termo = busca.trim().toLowerCase();
    const out: Linha[] = [];
    for (const c of contratos) {
      if (empresaId !== TODOS && c.empresa_id !== empresaId) continue;
      if (cliente !== TODOS && c.cliente !== cliente) continue;
      if (situacao !== TODOS && c.status !== situacao) continue;
      if (termo && !`${c.nome} ${c.cliente}`.toLowerCase().includes(termo)) continue;
      const f = fat.get(c.id) ?? totaisVazios();
      const cu = custos.get(`${c.id}|${mes}`) ?? custosVazios();
      const exec = executavelDoContrato(c, mes);
      const totalCusto = totalCustos(cu);
      // Contrato sem nada no mês não polui a tabela.
      if (!exec && !f.notas && !totalCusto) continue;
      const { lucro, margem } = lucroBruto(f.liquido, totalCusto);
      out.push({ id: c.id, contrato: c.nome, cliente: c.cliente, status: c.status, exec, bruto: f.bruto, liquido: f.liquido, descontos: f.descontos, custos: cu, totalCusto, lucro, margem });
    }
    return out.sort((a, b) => a.contrato.localeCompare(b.contrato, "pt-BR"));
  }, [contratos, empresaId, cliente, situacao, busca, fat, custos, mes, executavelDoContrato]);

  const total = useMemo(() => {
    const t = { exec: 0, bruto: 0, liquido: 0, descontos: 0, totalCusto: 0, custos: custosVazios() };
    for (const l of linhas) {
      t.exec += l.exec; t.bruto += l.bruto; t.liquido += l.liquido; t.descontos += l.descontos; t.totalCusto += l.totalCusto;
      for (const r of RUBRICAS) t.custos[r.id] += l.custos[r.id];
    }
    return { ...t, ...lucroBruto(t.liquido, t.totalCusto) };
  }, [linhas]);

  // Custo pago no mês em contrato que não tem nada além disso é comum (ex.:
  // pagamento adiantado); mostra quantos contratos estão no prejuízo.
  const negativos = linhas.filter((l) => l.lucro < 0).length;

  function exportarCsv() {
    const cab = ["Mês", "Contrato", "Cliente", "Valor Exec.", "Valor Bruto", "Valor Líquido", "Desc. Contrato", ...RUBRICAS.map((r) => r.label), "Total de Custos", "Lucro Bruto", "Margem %", "Situação"];
    const num = (v: number) => v.toFixed(2).replace(".", ",");
    const corpo = linhas.map((l) => [rotuloMes(mes), l.contrato, l.cliente, num(l.exec), num(l.bruto), num(l.liquido), num(l.descontos), ...RUBRICAS.map((r) => num(l.custos[r.id])), num(l.totalCusto), num(l.lucro), l.margem === null ? "" : (l.margem * 100).toFixed(2).replace(".", ","), l.status]);
    const csv = [cab, ...corpo].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `lucratividade-contratos-${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Planilha gerada.");
  }

  const carregandoTudo = carregando || carregandoFluxo;
  const erro = erroFluxo as { message?: string } | null;

  return (
    <div className="space-y-6">
      <PageHeader
        module="Controladoria"
        breadcrumb={["Lucratividade de Contratos"]}
        title="Lucratividade de Contratos"
        subtitle="Faturamento (NFs Código N da competência) × custos pagos no mês (saídas do Fluxo de Caixa com contrato)."
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" />Imprimir</Button>
            <Button size="sm" onClick={exportarCsv} disabled={linhas.length === 0}><FileDown className="h-4 w-4 mr-1" />Exportar</Button>
          </div>
        }
      />

      {/* SIS-2026-0553: checkpoint da Controladoria (alerta, sem bloquear). */}
      <BannerAuditoria mes={mes} empresaId={empresaId === TODOS ? null : empresaId} />

      <div className="card-elevated p-3 flex items-center gap-2 flex-wrap text-xs print:hidden">
        <Select value={mes} onValueChange={setMes}>
          <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{mesesDisponiveis.map((m) => <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={empresaId} onValueChange={setEmpresaId}>
          <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue placeholder="Empresa" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas as empresas</SelectItem>
            {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={cliente} onValueChange={setCliente}>
          <SelectTrigger className="h-8 w-[220px] text-xs"><SelectValue placeholder="Cliente" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os clientes</SelectItem>
            {clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={situacao} onValueChange={setSituacao}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Situação" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todas</SelectItem>
            <SelectItem value="ativo">Ativo</SelectItem>
            <SelectItem value="encerrado">Encerrado</SelectItem>
            <SelectItem value="suspenso">Suspenso</SelectItem>
          </SelectContent>
        </Select>
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar contrato ou cliente..." className="h-8 w-[240px] text-xs ml-auto" />
      </div>

      {erro ? (
        <p className="text-sm text-red-600 py-10 text-center">Não foi possível carregar os custos do mês: {erro.message ?? "erro desconhecido"}</p>
      ) : carregandoTudo ? (
        <p className="text-sm text-muted-foreground py-10 text-center">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiTile label="Valor Faturado (Bruto)" valor={fmtMoney(total.bruto)} icon={<TrendingUp />} cor="sky" />
            <KpiTile label="Valor Líquido (Após Descontos)" valor={fmtMoney(total.liquido)} icon={<Wallet />} cor="slate" />
            <KpiTile label="Total de Custos" valor={fmtMoney(total.totalCusto)} icon={<Receipt />} cor="amber" />
            <KpiTile label="Lucro Bruto" valor={fmtMoney(total.lucro)} sub={negativos ? `${negativos} contrato(s) no prejuízo` : undefined} icon={<TrendingUp />} cor={total.lucro < 0 ? "red" : "emerald"} valorClass={total.lucro < 0 ? "text-red-600" : "text-emerald-600 dark:text-emerald-400"} />
            <KpiTile label="Margem Bruta" valor={pctTxt(total.margem)} sub="sobre o valor líquido" icon={<Percent />} cor="sky" />
          </div>

          <div className="card-elevated overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Valor Exec. (Planilha)</TableHead>
                  <TableHead className="text-right">Valor Bruto</TableHead>
                  <TableHead className="text-right">Valor Líquido</TableHead>
                  <TableHead className="text-right">Desc. Contrato</TableHead>
                  {RUBRICAS.map((r) => <TableHead key={r.id} className="text-right">{r.label}</TableHead>)}
                  <TableHead className="text-right">Total de Custos</TableHead>
                  <TableHead className="text-right">Lucro Bruto</TableHead>
                  <TableHead className="text-right">Margem</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium whitespace-nowrap">{l.contrato}</TableCell>
                    <TableCell className="whitespace-nowrap">{l.cliente}</TableCell>
                    <TableCell className="text-right">{l.exec ? fmtMoney(l.exec) : "—"}</TableCell>
                    <TableCell className="text-right">{l.bruto ? fmtMoney(l.bruto) : "—"}</TableCell>
                    <TableCell className="text-right">{l.liquido ? fmtMoney(l.liquido) : "—"}</TableCell>
                    <TableCell className="text-right">{l.descontos ? fmtMoney(l.descontos) : "—"}</TableCell>
                    {RUBRICAS.map((r) => <TableCell key={r.id} className="text-right">{l.custos[r.id] ? fmtMoney(l.custos[r.id]) : "—"}</TableCell>)}
                    <TableCell className="text-right">{fmtMoney(l.totalCusto)}</TableCell>
                    <TableCell className={`text-right ${l.lucro < 0 ? "text-red-600" : ""}`}>{fmtMoney(l.lucro)}</TableCell>
                    <TableCell className={`text-right ${corMargem(l.margem)}`}>{pctTxt(l.margem)}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{l.status}</Badge></TableCell>
                  </TableRow>
                ))}
                {linhas.length === 0 && <TableRow><TableCell colSpan={17} className="text-center text-muted-foreground py-8">Nenhum contrato com faturamento, custo ou valor executável em {rotuloMes(mes)}.</TableCell></TableRow>}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2} className="font-semibold">Total Geral ({linhas.length})</TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoney(total.exec)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoney(total.bruto)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoney(total.liquido)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoney(total.descontos)}</TableCell>
                  {RUBRICAS.map((r) => <TableCell key={r.id} className="text-right font-semibold">{fmtMoney(total.custos[r.id])}</TableCell>)}
                  <TableCell className="text-right font-semibold">{fmtMoney(total.totalCusto)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoney(total.lucro)}</TableCell>
                  <TableCell className={`text-right font-semibold ${corMargem(total.margem)}`}>{pctTxt(total.margem)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Custos em regime de caixa: saídas do Fluxo de Caixa pagas em {rotuloMes(mes)} e vinculadas ao contrato. Transferências entre contas, aplicações, empréstimos, financiamentos e distribuições ficam de fora. Pagamentos sem contrato não entram em nenhuma linha.
          </p>
        </>
      )}
    </div>
  );
}
