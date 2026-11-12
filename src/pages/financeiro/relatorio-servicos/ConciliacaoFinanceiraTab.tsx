import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, ExternalLink, FileDown, FileText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { TIPOS_NOTA, useItensNfEmissaoEmLote, useNfsEmissao } from "@/hooks/useNfEmissao";
import { fmtMoney, foraDoRelatorio, type StatusNota } from "@/pages/financeiro/nf-emissao/shared";
import { conciliar, FONTES, INDICADORES, type FiltrosConciliacao, type FonteId, type GrupoConciliacao, type NotaConciliacao } from "@/pages/financeiro/conciliacao-servicos/regras";

// SIS-2026-0869: Conciliação Financeira dentro do Relatório de Serviços. Confronta Relatório Geral, Dashboard e Faturamento da
// Empresa (Controladoria) sobre as mesmas NFs e aponta onde as telas divergem — com o motivo e um atalho para a tela onde corrigir.
// Só leitura, sempre calculado ao vivo (não guarda "resultado de conciliação": o "Recalcular" apenas rebusca as fontes).

const TODOS = "todos";
const COR_FONTE: Record<FonteId, string> = { geral: "#1e3a8a", dashboard: "#38bdf8", faturamento: "#f97316" };
const ROTULO_STATUS: Record<StatusNota, string> = { pendente: "Pendente", pago: "Pago", substituida: "Substituída", cancelada: "Cancelada" };
const milhoes = (v: number) => `${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} Mi`;
const mesLabel = (anoMes: string) => `${anoMes.slice(5, 7)}/${anoMes.slice(2, 4)}`;
const pctTxt = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`);

export interface FiltroAbrirGeral {
  empresa: string;
  competencia: string;
  contrato: string;
}

function StatusPill({ ok }: { ok: boolean }) {
  return ok
    ? <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">Conciliado</Badge>
    : <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">Divergente</Badge>;
}

export default function ConciliacaoFinanceiraTab({ onAbrirNoGeral }: { onAbrirNoGeral: (f: FiltroAbrirGeral) => void }) {
  const anoAtual = new Date().getFullYear();
  const { data: nfs = [], isLoading: carregandoNfs, refetch: refetchNfs } = useNfsEmissao(null, { todasEmpresas: true });
  const { data: contratos = [], isLoading: carregandoContratos, refetch: refetchContratos } = useContratosERP({ todasEmpresas: true });
  const { data: empresas = [] } = useEmpresasGrupo();

  const [ano, setAno] = useState(anoAtual);
  const [competencia, setCompetencia] = useState(TODOS);
  const [empresaId, setEmpresaId] = useState(TODOS);
  const [contratoId, setContratoId] = useState(TODOS);
  const [cliente, setCliente] = useState(TODOS);
  const [codigo, setCodigo] = useState("N");
  const [situacao, setSituacao] = useState<StatusNota | typeof TODOS>(TODOS);
  const [soDivergentes, setSoDivergentes] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [recalculando, setRecalculando] = useState(false);
  const [aba, setAba] = useState("visao");
  const [buscaNf, setBuscaNf] = useState("");

  const contratoPorId = useMemo(() => new Map(contratos.map((c) => [c.id, c])), [contratos]);
  const empresaNome = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);

  const anos = useMemo(() => {
    const s = new Set<number>([anoAtual]);
    for (const n of nfs) s.add(Number(n.competencia.slice(0, 4)));
    return [...s].sort((a, b) => b - a);
  }, [nfs, anoAtual]);
  const competencias = useMemo(
    () => [...new Set(nfs.filter((n) => !ano || n.competencia.startsWith(`${ano}-`)).map((n) => n.competencia.slice(0, 7)))].sort(),
    [nfs, ano],
  );
  const contratosOpcoes = useMemo(
    () => contratos.filter((c) => empresaId === TODOS || c.empresa_id === empresaId).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [contratos, empresaId],
  );
  const clientes = useMemo(() => [...new Set(contratos.map((c) => c.cliente).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [contratos]);

  const filtros: FiltrosConciliacao = {
    ano,
    competencia: competencia === TODOS ? "" : competencia,
    empresaId: empresaId === TODOS ? "" : empresaId,
    contratoId: contratoId === TODOS ? "" : contratoId,
    cliente: cliente === TODOS ? "" : cliente,
    codigo,
    situacao: situacao === TODOS ? "" : situacao,
  };

  // Itens só são necessários para o pendente (descontos pós-emissão); busca os do ano/código escolhidos.
  const idsParaItens = useMemo(
    () => nfs.filter((n) => !foraDoRelatorio(n) && (!ano || n.competencia.startsWith(`${ano}-`)) && (!codigo || n.tipo_nota === codigo)).map((n) => n.id),
    [nfs, ano, codigo],
  );
  const { data: itensPorNf, isLoading: carregandoItens, refetch: refetchItens } = useItensNfEmissaoEmLote(idsParaItens);

  const resultado = useMemo(
    () => conciliar({ nfs, itensPorNf, contratoPorId, filtros }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nfs, itensPorNf, contratoPorId, ano, competencia, empresaId, contratoId, cliente, codigo, situacao],
  );
  const { resumo, indicadores, notas, porCompetencia, porContrato } = resultado;
  const pctInd = (n: number) => (indicadores.length ? `${((n / indicadores.length) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% dos indicadores` : "—");

  async function recalcular() {
    setRecalculando(true);
    try {
      await Promise.all([refetchNfs(), refetchContratos(), refetchItens()]);
      setAtualizadoEm(new Date());
      toast.success("Conciliação recalculada com os dados mais recentes.");
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível atualizar os dados.");
    } finally {
      setRecalculando(false);
    }
  }

  function limpar() {
    setCompetencia(TODOS); setEmpresaId(TODOS); setContratoId(TODOS); setCliente(TODOS); setCodigo("N"); setSituacao(TODOS);
  }

  function exportarCsv() {
    const linhas = soDivergentes ? notas.filter((n) => n.divergente) : notas;
    const cab = ["NF", "Contrato", "Empresa", "Competência", "Situação", ...FONTES.flatMap((f) => INDICADORES.map((i) => `${i.rotulo} (${f.rotulo})`)), "Diferença total", "Motivo"];
    const csv = [cab, ...linhas.map((n) => [
      n.numero, n.contratoNome, empresaNome.get(n.empresaId) ?? "", mesLabel(n.competencia), ROTULO_STATUS[n.status],
      ...FONTES.flatMap((f) => INDICADORES.map((i) => String(n.fontes[f.id][i.id]).replace(".", ","))),
      String(n.difTotal).replace(".", ","), n.motivos.join(" | "),
    ])];
    const conteudo = "﻿" + csv.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([conteudo], { type: "text/csv;charset=utf-8" }));
    a.download = `conciliacao_relatorio_servicos_${ano || "todos_os_anos"}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const abrir = (n: Pick<NotaConciliacao, "empresaId" | "competencia" | "contratoId">) =>
    onAbrirNoGeral({ empresa: n.empresaId, competencia: `${n.competencia}-01`, contrato: n.contratoId });

  const dadosBarras = indicadores.map((i) => ({ nome: i.rotulo.replace("Faturamento ", "").replace("Valor ", ""), geral: i.valores.geral, dashboard: i.valores.dashboard, faturamento: i.valores.faturamento }));
  const evolucao = useMemo(() => {
    const m = new Map(porCompetencia.map((g) => [g.chave, g.difTotal]));
    // Todos os anos: uma barra por competência que tem NF (ordem cronológica), não os 12 meses de um ano.
    if (!ano) return porCompetencia.map((g) => ({ mes: mesLabel(g.chave), diferenca: g.difTotal }));
    return Array.from({ length: 12 }, (_, i) => {
      const k = `${ano}-${String(i + 1).padStart(2, "0")}`;
      return { mes: mesLabel(k), diferenca: m.get(k) ?? 0 };
    });
  }, [porCompetencia, ano]);
  const donut = [
    { nome: "Conciliadas", valor: resumo.notasConciliadas, cor: "#2aa978" },
    { nome: "Divergentes", valor: resumo.notasDivergentes, cor: "#d75a54" },
  ].filter((d) => d.valor > 0);
  const topContratos = porContrato.filter((g) => g.difTotal > 0).slice(0, 5);
  const notasVisiveis = soDivergentes ? notas.filter((n) => n.divergente) : notas;

  if (carregandoNfs || carregandoContratos) return <p className="py-10 text-center text-sm text-muted-foreground">Carregando...</p>;

  const tabelaGrupo = (grupos: GrupoConciliacao[], titulo: string, onClique?: (g: GrupoConciliacao) => void) => (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{titulo}</TableHead>
              <TableHead className="text-right">Notas</TableHead>
              <TableHead className="text-right">Divergentes</TableHead>
              {INDICADORES.map((i) => <TableHead key={i.id} className="text-right">Dif. {i.rotulo.replace("Faturamento ", "").replace("Valor ", "")}</TableHead>)}
              <TableHead className="text-right">Diferença total</TableHead>
              <TableHead>Status</TableHead>
              {onClique && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {grupos.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">Nenhuma NF no recorte.</TableCell></TableRow>}
            {grupos.map((g) => (
              <TableRow key={g.chave}>
                <TableCell className="font-medium whitespace-nowrap">{g.rotulo}</TableCell>
                <TableCell className="text-right">{g.notas}</TableCell>
                <TableCell className="text-right">{g.divergentes}</TableCell>
                {INDICADORES.map((i) => <TableCell key={i.id} className={`text-right whitespace-nowrap ${g.dif[i.id] > 0 ? "text-red-600" : ""}`}>{fmtMoney(g.dif[i.id])}</TableCell>)}
                <TableCell className="text-right font-semibold whitespace-nowrap">{fmtMoney(g.difTotal)}</TableCell>
                <TableCell><StatusPill ok={g.divergentes === 0} /></TableCell>
                {onClique && <TableCell><Button size="sm" variant="ghost" onClick={() => onClique(g)}>Ver NFs</Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  function verNfsDoGrupo(g: GrupoConciliacao, tipo: "competencia" | "contrato") {
    if (tipo === "competencia") setCompetencia(g.chave); else setContratoId(g.chave);
    setSoDivergentes(true);
    setAba("nota");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Compara Relatório Geral, Dashboard e Faturamento da Empresa (Controladoria) sobre as mesmas NFs. Onde houver divergência, o motivo e o atalho para a tela de origem aparecem na aba “Por Nota Fiscal”.
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{atualizadoEm ? `Atualizado às ${atualizadoEm.toLocaleTimeString("pt-BR")}` : "Calculado ao abrir a tela"}</span>
          <Button variant="outline" size="sm" onClick={exportarCsv}><FileDown className="mr-1.5 h-4 w-4" />Exportar CSV</Button>
          <Button size="sm" onClick={recalcular} disabled={recalculando}><RefreshCw className={`mr-1.5 h-4 w-4 ${recalculando ? "animate-spin" : ""}`} />Recalcular</Button>
        </div>
      </div>

      <div className="card-elevated flex flex-wrap items-end gap-2 p-3 text-xs">
        <Filtro rotulo="Ano">
          <Select value={String(ano)} onValueChange={(v) => { setAno(Number(v)); setCompetencia(TODOS); }}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="0">Todos</SelectItem>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </Filtro>
        <Filtro rotulo="Competência">
          <Select value={competencia} onValueChange={setCompetencia}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todas</SelectItem>{competencias.map((c) => <SelectItem key={c} value={c}>{`${c.slice(5, 7)}/${c.slice(0, 4)}`}</SelectItem>)}</SelectContent>
          </Select>
        </Filtro>
        <Filtro rotulo="Empresa">
          <Select value={empresaId} onValueChange={(v) => { setEmpresaId(v); setContratoId(TODOS); }}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todas</SelectItem>{empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
          </Select>
        </Filtro>
        <Filtro rotulo="Contrato">
          <Select value={contratoId} onValueChange={setContratoId}>
            <SelectTrigger className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todos</SelectItem>{contratosOpcoes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
          </Select>
        </Filtro>
        <Filtro rotulo="Cliente">
          <Select value={cliente} onValueChange={setCliente}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todos</SelectItem>{clientes.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </Filtro>
        <Filtro rotulo="Código">
          <Select value={codigo || TODOS} onValueChange={(v) => setCodigo(v === TODOS ? "" : v)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todos</SelectItem>{Object.entries(TIPOS_NOTA).map(([k, v]) => <SelectItem key={k} value={k}>{k} — {v}</SelectItem>)}</SelectContent>
          </Select>
        </Filtro>
        <Filtro rotulo="Situação">
          <Select value={situacao} onValueChange={(v) => setSituacao(v as StatusNota | typeof TODOS)}>
            <SelectTrigger className="h-8 w-32 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={TODOS}>Todas</SelectItem>{(Object.keys(ROTULO_STATUS) as StatusNota[]).map((s) => <SelectItem key={s} value={s}>{ROTULO_STATUS[s]}</SelectItem>)}</SelectContent>
          </Select>
        </Filtro>
        <Button variant="ghost" size="sm" onClick={limpar}>Limpar filtros</Button>
      </div>

      {carregandoItens && <p className="text-xs text-muted-foreground">Carregando os itens das NFs (descontos pós-emissão)… o Valor Pendente pode mudar quando terminar.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Indicadores conciliados" valor={String(resumo.indicadoresConciliados)} sub={pctInd(resumo.indicadoresConciliados)} cor="emerald" icon={<CheckCircle2 className="h-14 w-14" />} valorClass="text-emerald-700 dark:text-emerald-300" />
        <KpiTile label="Indicadores divergentes" valor={String(resumo.indicadoresDivergentes)} sub={pctInd(resumo.indicadoresDivergentes)} cor={resumo.indicadoresDivergentes ? "red" : "emerald"} icon={<AlertTriangle className="h-14 w-14" />} valorClass={resumo.indicadoresDivergentes ? "text-red-600" : "text-emerald-700 dark:text-emerald-300"} />
        <KpiTile label="Diferença total (R$)" valor={fmtMoney(resumo.diferencaTotal)} sub="Soma das divergências por NF" cor="sky" icon={<FileText className="h-14 w-14" />} />
        <KpiTile label="Notas em divergência" valor={`${resumo.notasDivergentes} de ${resumo.notasAvaliadas}`} sub="Registros para análise" cor={resumo.notasDivergentes ? "amber" : "emerald"} icon={<AlertTriangle className="h-14 w-14" />} onClick={() => { setSoDivergentes(true); setAba("nota"); }} />
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="visao">Visão Geral</TabsTrigger>
          <TabsTrigger value="competencia">Por Competência</TabsTrigger>
          <TabsTrigger value="contrato">Por Contrato</TabsTrigger>
          <TabsTrigger value="nota">Por Nota Fiscal</TabsTrigger>
        </TabsList>

        <TabsContent value="visao" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Comparativo dos indicadores</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Indicador</TableHead>
                    {FONTES.map((f) => <TableHead key={f.id} className="text-right">{f.rotulo}</TableHead>)}
                    <TableHead className="text-right">Diferença (maior − menor)</TableHead>
                    <TableHead className="text-right">Variação %</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Quem destoa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {indicadores.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.rotulo}</TableCell>
                      {FONTES.map((f) => <TableCell key={f.id} className={`text-right whitespace-nowrap ${i.destoantes.includes(f.id) ? "font-semibold text-red-600" : ""}`}>{fmtMoney(i.valores[f.id])}</TableCell>)}
                      <TableCell className={`text-right whitespace-nowrap ${i.conciliado ? "text-emerald-600" : "font-semibold text-red-600"}`}>{fmtMoney(i.diferenca)}</TableCell>
                      <TableCell className="text-right">{pctTxt(i.variacaoPct)}</TableCell>
                      <TableCell><StatusPill ok={i.conciliado} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{i.conciliado ? "—" : i.destoantes.map((d) => FONTES.find((f) => f.id === d)!.rotulo).join(", ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Comparativo por indicador (R$)</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dadosBarras}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="nome" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={milhoes} width={64} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} />
                      <Legend />
                      {FONTES.map((f) => <Bar key={f.id} dataKey={f.id} name={f.rotulo} fill={COR_FONTE[f.id]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Evolução da divergência por competência ({ano || "todos os anos"})</CardTitle></CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={evolucao}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} width={64} tickFormatter={(v) => v.toLocaleString("pt-BR", { notation: "compact" })} />
                      <Tooltip formatter={(v: number) => fmtMoney(v)} />
                      <Bar dataKey="diferenca" name="Diferença (R$)" fill="#527fb6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Principais contratos com divergência</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Contrato</TableHead><TableHead className="text-right">NFs</TableHead><TableHead className="text-right">Diferença (R$)</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {topContratos.length === 0 && <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Nenhum contrato com divergência no recorte.</TableCell></TableRow>}
                    {topContratos.map((g) => (
                      <TableRow key={g.chave}>
                        <TableCell className="font-medium">{g.rotulo}</TableCell>
                        <TableCell className="text-right">{g.divergentes}</TableCell>
                        <TableCell className="text-right text-red-600">{fmtMoney(g.difTotal)}</TableCell>
                        <TableCell><Button size="sm" variant="ghost" onClick={() => verNfsDoGrupo(g, "contrato")}>Ver NFs</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Status da conciliação (notas)</CardTitle></CardHeader>
              <CardContent>
                {resumo.notasAvaliadas === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma NF no recorte.</p> : (
                  <div className="flex items-center gap-4">
                    <div className="relative h-52 w-52 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donut} dataKey="valor" nameKey="nome" innerRadius={60} outerRadius={85} paddingAngle={1}>
                            {donut.map((d) => <Cell key={d.nome} fill={d.cor} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-bold">{resumo.notasAvaliadas.toLocaleString("pt-BR")}</span>
                        <span className="text-xs text-muted-foreground">Notas</span>
                      </div>
                    </div>
                    <ul className="space-y-2 text-sm">
                      {[{ n: "Conciliadas", v: resumo.notasConciliadas, c: "#2aa978" }, { n: "Divergentes", v: resumo.notasDivergentes, c: "#d75a54" }].map((x) => (
                        <li key={x.n} className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: x.c }} />{x.n}: <strong>{x.v.toLocaleString("pt-BR")}</strong> ({resumo.notasAvaliadas ? ((x.v / resumo.notasAvaliadas) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : 0}%)</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="competencia" className="mt-4">{tabelaGrupo(porCompetencia.map((g) => ({ ...g, rotulo: `${g.chave.slice(5, 7)}/${g.chave.slice(0, 4)}` })), "Competência", (g) => verNfsDoGrupo(g, "competencia"))}</TabsContent>
        <TabsContent value="contrato" className="mt-4">{tabelaGrupo(porContrato, "Contrato", (g) => verNfsDoGrupo(g, "contrato"))}</TabsContent>

        <TabsContent value="nota" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={soDivergentes} onChange={(e) => setSoDivergentes(e.target.checked)} />Mostrar só NFs divergentes</label>
            <input value={buscaNf} onChange={(e) => setBuscaNf(e.target.value)} placeholder="Buscar NF ou contrato" className="h-8 w-64 rounded-md border bg-background px-2 text-xs" />
            <span className="text-xs text-muted-foreground">{notasVisiveis.length} NF(s) · mostrando até 200 com maior diferença</span>
          </div>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>NF</TableHead><TableHead>Contrato</TableHead><TableHead>Comp.</TableHead>
                    <TableHead className="text-right">Pendente — Relatório/Dashboard</TableHead>
                    <TableHead className="text-right">Pendente — Faturamento</TableHead>
                    <TableHead className="text-right">Diferença total</TableHead>
                    <TableHead>Motivo provável</TableHead><TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {notasVisiveis.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">{soDivergentes ? "Nenhuma divergência no recorte." : "Nenhuma NF no recorte."}</TableCell></TableRow>}
                  {notasVisiveis
                    .filter((n) => !buscaNf.trim() || `${n.numero} ${n.contratoNome}`.toLowerCase().includes(buscaNf.trim().toLowerCase()))
                    .slice(0, 200)
                    .map((n) => (
                      <TableRow key={n.id}>
                        <TableCell className="font-medium whitespace-nowrap">{n.numero}</TableCell>
                        <TableCell className="max-w-[260px] truncate" title={n.contratoNome}>{n.contratoNome}</TableCell>
                        <TableCell className="whitespace-nowrap">{mesLabel(n.competencia)}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{n.fontes.geral.incluida ? fmtMoney(n.fontes.geral.pendente) : "fora"}</TableCell>
                        <TableCell className="text-right whitespace-nowrap">{n.fontes.faturamento.incluida ? fmtMoney(n.fontes.faturamento.pendente) : "fora"}</TableCell>
                        <TableCell className={`text-right whitespace-nowrap ${n.divergente ? "font-semibold text-red-600" : ""}`}>{fmtMoney(n.difTotal)}</TableCell>
                        <TableCell className="max-w-[420px] whitespace-normal text-xs">{n.divergente ? n.motivos.join(" ") : <StatusPill ok />}</TableCell>
                        <TableCell><Button size="sm" variant="ghost" onClick={() => abrir(n)} title="Abrir no Relatório Geral, já com empresa, competência e contrato"><ExternalLink className="mr-1 h-3.5 w-3.5" />Abrir</Button></TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Filtro({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{rotulo}</div>
      {children}
    </div>
  );
}
