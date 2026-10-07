import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { FileDown, Percent, Printer, TrendingUp, Wallet, Receipt } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useCustosContratoMes } from "./faturamento/useCustosContratoMes";
import { fmtMoney } from "@/pages/financeiro/nf-emissao/shared";
import { agruparFaturamento, custosPorContratoMes, custosVazios, CustosPorRubrica, lucroBruto, RUBRICAS, semClassificacao, totaisVazios, totalCustos } from "./faturamento/regras";
import { RubricasCusto } from "./faturamento/RubricasCusto";
import { FaixasTexto, pillDaMargem, TituloComFormula } from "./faturamento/Rentabilidade";
import { useLigacoesRubrica } from "./faturamento/useLigacoesRubrica";
import { rotuloMes, useBaseFaturamento } from "./faturamento/useBaseFaturamento";
import { BannerAuditoria } from "./auditoria/BannerAuditoria";

// SIS-2026-0556: Lucratividade de Contratos (Controladoria). Faturamento vem
// das NFs Código N (competência); custo realizado vem das SAÍDAS do Fluxo de
// Caixa com contrato (mês do pagamento — regime de caixa), sem transferências,
// aplicações, empréstimos etc. (ver faturamento/regras.ts).

const TODOS = "todos";
const pctTxt = (m: number | null) => (m === null ? "—" : `${(m * 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);
const num2 = (n: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
const CAB = "h-auto px-1.5 py-1.5 text-right align-bottom whitespace-normal leading-tight";
const CEL = "px-1.5 py-1.5 align-middle";
const CEL_NUM = `${CEL} text-right whitespace-nowrap`;
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
  const [detalhar, setDetalhar] = useState(true);
  const [pagina, setPagina] = useState(0);
  const [porPagina, setPorPagina] = useState(10);

  // Meses com nota emitida (mais o mês atual) — o custo é buscado do mês escolhido.
  const mesesDisponiveis = useMemo(() => {
    const s = new Set<string>([mes]);
    for (const n of nfs) s.add(n.competencia.slice(0, 7));
    return [...s].sort().reverse();
  }, [nfs, mes]);

  // Painel "Rubricas de custo": ligações manuais Classificação × coluna de custo.
  const { data: ligacoes } = useLigacoesRubrica();
  const { data: podeVerRubricas } = useScreenAccess("lucratividade-rubricas", "visualizar");
  const { data: podeAlterarRubricas } = useScreenAccess("lucratividade-rubricas", "alterar");
  const custos = useMemo(() => custosPorContratoMes(fluxo, ligacoes), [fluxo, ligacoes]);
  const semClass = useMemo(() => semClassificacao(fluxo), [fluxo]);
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

  useEffect(() => { setPagina(0); }, [mes, empresaId, cliente, situacao, busca]);
  const totalPaginas = Math.max(1, Math.ceil(linhas.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const inicio = paginaAtual * porPagina;
  const paginaLinhas = linhas.slice(inicio, inicio + porPagina);

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

      <Tabs defaultValue="lucratividade" className="space-y-4">
        {podeVerRubricas && (
          <TabsList className="print:hidden">
            <TabsTrigger value="lucratividade">Lucratividade</TabsTrigger>
            <TabsTrigger value="rubricas">Rubricas de custo</TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="lucratividade" className="space-y-6 mt-0">
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

          <div className="flex items-center justify-between gap-2 flex-wrap print:hidden">
            <p className="text-[11px] text-muted-foreground">
              Mostrando {linhas.length === 0 ? 0 : inicio + 1} a {Math.min(inicio + porPagina, linhas.length)} de {linhas.length} registros
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
                <input type="checkbox" checked={detalhar} onChange={(e) => setDetalhar(e.target.checked)} />
                Detalhar custos por rubrica
              </label>
              <Select value={String(porPagina)} onValueChange={(v) => { setPorPagina(Number(v)); setPagina(0); }}>
                <SelectTrigger className="h-7 w-[110px] text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((n) => <SelectItem key={n} value={String(n)}>{n} por página</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
              <span className="text-[11px] text-muted-foreground">{paginaAtual + 1} / {totalPaginas}</span>
              <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" disabled={paginaAtual >= totalPaginas - 1} onClick={() => setPagina(paginaAtual + 1)}>Próxima</Button>
            </div>
          </div>

          {/* Tabela compacta (SIS-2026-0556, ajuste de layout): nomes quebram em duas
              linhas, "R$" vai para o cabeçalho e a 1ª coluna fica fixa — a ideia é
              caber na tela sem rolagem horizontal em monitores comuns. */}
          <div className="card-elevated overflow-x-auto">
            <Table className="text-[11px] tabular-nums">
              <TableHeader>
                <TableRow>
                  <TableHead className={`${CAB} text-left sticky left-0 z-10 bg-background min-w-[150px]`}>Contrato / Cliente</TableHead>
                  <TableHead className={CAB}><TituloComFormula titulo="Valor Exec. Planilha (R$)" formula="Valor executável do contrato no mês, segundo a planilha de custo vigente. Zero depois do fim do contrato." /></TableHead>
                  <TableHead className={CAB}><TituloComFormula titulo="Valor Bruto (R$)" formula="Soma do valor bruto das NFs Código N da competência (já validadas; fora de canceladas e substituídas)." /></TableHead>
                  <TableHead className={CAB}><TituloComFormula titulo="Valor Líquido (R$)" formula="Soma do valor líquido das mesmas NFs: o bruto depois dos descontos." /></TableHead>
                  <TableHead className={CAB}><TituloComFormula titulo="Desc. Contrato (R$)" formula="Valor Bruto − Valor Líquido: o que foi descontado nas notas da competência." /></TableHead>
                  {detalhar && RUBRICAS.map((r) => (
                    <TableHead key={r.id} className={CAB}>
                      <TituloComFormula titulo={`${r.label} (R$)`} formula={`Saídas do Fluxo de Caixa com contrato, pagas no mês, cuja classificação está ligada a “${r.label}”. A ligação é feita na aba “Rubricas de custo”${r.id === "outras" ? "; o que não casa com nenhuma outra coluna cai aqui" : ""}.`} />
                    </TableHead>
                  ))}
                  <TableHead className={CAB}><TituloComFormula titulo="Total de Custos (R$)" formula="Soma de todas as colunas de custo (Salários … Outras Despesas), mesmo com o detalhe escondido." /></TableHead>
                  <TableHead className={CAB}><TituloComFormula titulo="Lucro Bruto (R$)" formula="Valor Líquido − Total de Custos." /></TableHead>
                  <TableHead className={CAB}>
                    <TituloComFormula
                      titulo="Margem (%)"
                      formula={<><p>Lucro Bruto ÷ Valor Líquido × 100. Fica em branco quando não há faturamento no mês.</p><p className="font-medium pt-1">A cor segue a faixa:</p><FaixasTexto /></>}
                    />
                  </TableHead>
                  <TableHead className={`${CAB} text-center`}><TituloComFormula alinhar="center" titulo="Situação" formula="Situação do contrato no ERP (ativo, encerrado ou suspenso). Não mede rentabilidade." /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginaLinhas.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className={`${CEL} sticky left-0 z-10 bg-background max-w-[170px]`}>
                      <span className="block font-medium leading-tight line-clamp-2">{l.contrato}</span>
                      <span className="block text-[10px] text-muted-foreground leading-tight line-clamp-1">{l.cliente}</span>
                    </TableCell>
                    <TableCell className={CEL_NUM}>{l.exec ? num2(l.exec) : "—"}</TableCell>
                    <TableCell className={CEL_NUM}>{l.bruto ? num2(l.bruto) : "—"}</TableCell>
                    <TableCell className={CEL_NUM}>{l.liquido ? num2(l.liquido) : "—"}</TableCell>
                    <TableCell className={CEL_NUM}>{l.descontos ? num2(l.descontos) : "—"}</TableCell>
                    {detalhar && RUBRICAS.map((r) => <TableCell key={r.id} className={CEL_NUM}>{l.custos[r.id] ? num2(l.custos[r.id]) : "—"}</TableCell>)}
                    <TableCell className={CEL_NUM}>{num2(l.totalCusto)}</TableCell>
                    <TableCell className={`${CEL_NUM} ${l.lucro < 0 ? "text-red-600" : ""}`}>{num2(l.lucro)}</TableCell>
                    <TableCell className={`${CEL} text-right`}>
                      <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pillDaMargem(l.margem)}`}>{pctTxt(l.margem)}</span>
                    </TableCell>
                    <TableCell className={`${CEL} text-center`}>
                      <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${l.status === "ativo" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-muted text-muted-foreground"}`}>{l.status}</span>
                    </TableCell>
                  </TableRow>
                ))}
                {linhas.length === 0 && <TableRow><TableCell colSpan={detalhar ? 17 : 9} className="text-center text-muted-foreground py-8">Nenhum contrato com faturamento, custo ou valor executável em {rotuloMes(mes)}.</TableCell></TableRow>}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className={`${CEL} font-semibold sticky left-0 z-10 bg-muted`}>Total Geral ({linhas.length})</TableCell>
                  <TableCell className={`${CEL_NUM} font-semibold`}>{num2(total.exec)}</TableCell>
                  <TableCell className={`${CEL_NUM} font-semibold`}>{num2(total.bruto)}</TableCell>
                  <TableCell className={`${CEL_NUM} font-semibold`}>{num2(total.liquido)}</TableCell>
                  <TableCell className={`${CEL_NUM} font-semibold`}>{num2(total.descontos)}</TableCell>
                  {detalhar && RUBRICAS.map((r) => <TableCell key={r.id} className={`${CEL_NUM} font-semibold`}>{num2(total.custos[r.id])}</TableCell>)}
                  <TableCell className={`${CEL_NUM} font-semibold`}>{num2(total.totalCusto)}</TableCell>
                  <TableCell className={`${CEL_NUM} font-semibold`}>{num2(total.lucro)}</TableCell>
                  <TableCell className={`${CEL} text-right`}>
                    <span className={`inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${pillDaMargem(total.margem)}`}>{pctTxt(total.margem)}</span>
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Custos em regime de caixa: saídas do Fluxo de Caixa pagas em {rotuloMes(mes)} e vinculadas ao contrato. Transferências entre contas, aplicações, empréstimos, financiamentos e distribuições ficam de fora. Pagamentos sem contrato não entram em nenhuma linha.
          </p>
          {semClass.linhas > 0 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              {semClass.linhas} lançamento(s) de contrato sem classificação ({fmtMoney(semClass.valor)}) em {rotuloMes(mes)} ficam fora das colunas de custo. Classifique-os no Fluxo de Caixa para entrarem na conta.
            </p>
          )}
        </>
      )}
        </TabsContent>
        {podeVerRubricas && (
          <TabsContent value="rubricas" className="space-y-4 mt-0">
            <div className="card-elevated p-3 flex items-center gap-2 text-xs">
              <Select value={mes} onValueChange={setMes}>
                <SelectTrigger className="h-8 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{mesesDisponiveis.map((m) => <SelectItem key={m} value={m}>{rotuloMes(m)}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-muted-foreground">Mês usado para mostrar o gasto de cada classificação.</span>
            </div>
            <RubricasCusto linhasMes={fluxo} ligacoes={ligacoes ?? new Map()} podeEditar={!!podeAlterarRubricas} rotuloMes={rotuloMes(mes)} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
