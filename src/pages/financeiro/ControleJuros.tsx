import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Clock, CheckCircle2, X, Download, Eye, Check } from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useControleJurosLista, useMarcarJurosCobrado, type ControleJurosLinha } from "@/hooks/useControleJuros";

// SIS-2026-0524 (Iury): submódulo "Controle de Juros" (Financeiro) — lista
// toda despesa/parcela do Malote paga com juros por atraso (informado no
// modal de Confirmar Pagamento) e permite marcar como cobrado do
// responsável. Só controle interno: não gera lançamento no Fluxo de Caixa.

const MENU_CODIGO = "financeiro-controle-juros";

const fmtData = (iso: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("pt-BR") : "—");

export default function ControleJuros() {
  const navigate = useNavigate();
  const { data: linhas = [], isLoading } = useControleJurosLista();
  const marcarCobrado = useMarcarJurosCobrado();

  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [statusFiltro, setStatusFiltro] = useState("");
  const [solicitanteFiltro, setSolicitanteFiltro] = useState("");
  const [classificacaoFiltro, setClassificacaoFiltro] = useState("");
  const [busca, setBusca] = useState("");

  function limparFiltros() {
    setDataDe(""); setDataAte(""); setStatusFiltro(""); setSolicitanteFiltro(""); setClassificacaoFiltro(""); setBusca("");
  }

  const solicitantesDisponiveis = useMemo(() => {
    const map = new Map<string, string>();
    linhas.forEach((l) => l.solicitante_id && l.solicitante_nome && map.set(l.solicitante_id, l.solicitante_nome));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [linhas]);

  const classificacoesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    linhas.forEach((l) => l.classificacao_nome && set.add(l.classificacao_nome));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [linhas]);

  const filtradas = useMemo(() => {
    const buscaNorm = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (dataDe && (l.data_pagamento ?? "") < dataDe) return false;
      if (dataAte && (l.data_pagamento ?? "") > dataAte) return false;
      if (statusFiltro && l.juros_status !== statusFiltro) return false;
      if (solicitanteFiltro && l.solicitante_id !== solicitanteFiltro) return false;
      if (classificacaoFiltro && l.classificacao_nome !== classificacaoFiltro) return false;
      if (buscaNorm && !l.numero.toLowerCase().includes(buscaNorm) && !l.nome_despesa.toLowerCase().includes(buscaNorm)) return false;
      return true;
    });
  }, [linhas, dataDe, dataAte, statusFiltro, solicitanteFiltro, classificacaoFiltro, busca]);

  const kpis = useMemo(() => {
    const pendentes = linhas.filter((l) => l.juros_status === "pendente_cobrar");
    const cobrados = linhas.filter((l) => l.juros_status === "cobrado");
    return {
      totalDespesas: linhas.length,
      valorPendente: pendentes.reduce((s, l) => s + Number(l.valor_juros), 0),
      valorCobrado: cobrados.reduce((s, l) => s + Number(l.valor_juros), 0),
      qtdPendente: pendentes.length,
      qtdCobrado: cobrados.length,
    };
  }, [linhas]);

  async function confirmarCobrado(l: ControleJurosLinha) {
    try {
      await marcarCobrado.mutateAsync({ origem: l.parcela_id ? "parcela" : "despesa", id: l.parcela_id ?? l.despesa_id });
      toast.success("Juros marcado como cobrado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao marcar como cobrado.");
    }
  }

  function exportar() {
    const linhasExport = filtradas.map((l) => ({
      "ID da Despesa": l.numero,
      "Data de Pagamento": fmtData(l.data_pagamento),
      "Classificação": l.classificacao_nome ?? "—",
      "Nome da Despesa": l.nome_despesa,
      "Valor do Juros (R$)": Number(l.valor_juros),
      "Solicitante": l.solicitante_nome ?? "—",
      "Status da Cobrança": l.juros_status === "cobrado" ? "Já cobrado" : "Pendente cobrar",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhasExport), "CONTROLE DE JUROS");
    XLSX.writeFile(wb, `Controle_de_Juros_${new Date().toLocaleDateString("pt-BR").replace(/\//g, "-")}.xlsx`);
  }

  return (
    <AcessoGate menu={MENU_CODIGO} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <div className="space-y-6 p-6">
        <PageHeader
          title="Controle de Juros de Boletos"
          subtitle="Acompanhe e realize a cobrança de juros das despesas pagas em atraso."
          module="Financeiro"
          breadcrumb={["Financeiro", "Controle de Juros"]}
          actions={
            <Button size="sm" variant="outline" onClick={exportar}>
              <Download className="mr-1.5 h-4 w-4" /> Exportar
            </Button>
          }
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiTile label="Total de despesas com juros" valor={String(kpis.totalDespesas)} icon={<FileText />} cor="slate" />
          <KpiTile label="Juros pendentes de cobrança" valor={formatBRL(kpis.valorPendente)} sub={`${kpis.qtdPendente} despesa${kpis.qtdPendente === 1 ? "" : "s"}`} icon={<Clock />} cor="amber" valorClass="text-amber-600 dark:text-amber-400" />
          <KpiTile label="Juros já cobrados" valor={formatBRL(kpis.valorCobrado)} sub={`${kpis.qtdCobrado} despesa${kpis.qtdCobrado === 1 ? "" : "s"}`} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Filtros</p>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
                <X className="h-3.5 w-3.5" /> Limpar filtros
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div>
                <Label className="text-xs">Data De</Label>
                <Input type="date" className="h-8 text-xs" value={dataDe} onChange={(e) => setDataDe(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Data Até</Label>
                <Input type="date" className="h-8 text-xs" value={dataAte} onChange={(e) => setDataAte(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Status da Cobrança</Label>
                <Select value={statusFiltro || "todos"} onValueChange={(v) => setStatusFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    <SelectItem value="pendente_cobrar">Pendente cobrar</SelectItem>
                    <SelectItem value="cobrado">Já cobrado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Solicitante</Label>
                <Select value={solicitanteFiltro || "todos"} onValueChange={(v) => setSolicitanteFiltro(v === "todos" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {solicitantesDisponiveis.map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Classificação</Label>
                <Select value={classificacaoFiltro || "todas"} onValueChange={(v) => setClassificacaoFiltro(v === "todas" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas</SelectItem>
                    {classificacoesDisponiveis.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Buscar por ID ou nome da despesa</Label>
              <Input className="h-8 text-xs" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite o ID ou nome da despesa..." />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Lista de despesas com juros</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="[&>th]:px-2 [&>th]:py-2">
                    <TableHead>ID da Despesa</TableHead>
                    <TableHead>Data de Pagamento</TableHead>
                    <TableHead>Classificação</TableHead>
                    <TableHead>Nome da Despesa</TableHead>
                    <TableHead className="text-right">Valor do Juros</TableHead>
                    <TableHead>Solicitante</TableHead>
                    <TableHead>Status da Cobrança</TableHead>
                    <TableHead className="text-center">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">Carregando...</TableCell></TableRow>
                  )}
                  {!isLoading && filtradas.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">Nenhuma despesa com juros encontrada com os filtros atuais.</TableCell></TableRow>
                  )}
                  {filtradas.map((l) => (
                    <TableRow key={l.parcela_id ?? l.despesa_id} className="[&>td]:px-2 [&>td]:py-2">
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {l.numero}
                        {l.numero_parcela && <span className="text-muted-foreground"> ({l.numero_parcela}/{l.numero_parcelas})</span>}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtData(l.data_pagamento)}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate" title={l.classificacao_nome ?? ""}>{l.classificacao_nome ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[220px] truncate" title={l.nome_despesa}>{l.nome_despesa}</TableCell>
                      <TableCell className="text-right text-xs font-medium whitespace-nowrap">{formatBRL(l.valor_juros)}</TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate" title={l.solicitante_nome ?? ""}>{l.solicitante_nome ?? "—"}</TableCell>
                      <TableCell>
                        {l.juros_status === "cobrado" ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">Já cobrado</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">Pendente cobrar</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver despesa" onClick={() => navigate(`/app/malote/despesa/${l.despesa_id}`)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <AcessoGate menu={MENU_CODIGO} acao="alterar">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-emerald-600"
                              title="Marcar como cobrado"
                              disabled={l.juros_status === "cobrado" || marcarCobrado.isPending}
                              onClick={() => confirmarCobrado(l)}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                          </AcessoGate>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {filtradas.length > 0 && (
              <p className="text-xs text-muted-foreground pt-1">Mostrando {filtradas.length} despesa{filtradas.length === 1 ? "" : "s"}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </AcessoGate>
  );
}
