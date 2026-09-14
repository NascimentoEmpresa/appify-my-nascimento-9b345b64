import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { Search, FileDown, ListChecks, CheckCircle2, AlertTriangle, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useContratosERP } from "@/hooks/useContratosERP";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { NfEmissaoRow, TipoNota, TIPOS_NOTA, useItensNfEmissaoEmLote, useNfsEmissao } from "@/hooks/useNfEmissao";
import { fmtMoney, fmtDate, statusDaNota, pendenteHaMaisDe30Dias, valorPendenteNf, StatusNota } from "@/pages/financeiro/nf-emissao/shared";

const STATUS_LABEL: Record<StatusNota, string> = {
  pendente: "Pendente",
  pago: "Pago",
  substituida: "Substituída",
  cancelada: "Cancelada",
};

const STATUS_CLASSE: Record<StatusNota, string> = {
  pendente: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  pago: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  substituida: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
  cancelada: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
};

function competenciaCurta(c: string) {
  return new Date(c + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
}

export default function RelatorioGeralTab() {
  const { data: nfs = [], isLoading } = useNfsEmissao(null, { todasEmpresas: true });
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });
  const { data: empresas = [] } = useEmpresasGrupo();

  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroCompetencia, setFiltroCompetencia] = useState("");
  const [filtroContrato, setFiltroContrato] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<StatusNota | "todos">("todos");
  const [filtroCodigo, setFiltroCodigo] = useState<TipoNota | "todos">("todos");
  const [filtroEmissaoDe, setFiltroEmissaoDe] = useState("");
  const [filtroEmissaoAte, setFiltroEmissaoAte] = useState("");
  const [filtroOver30, setFiltroOver30] = useState(false);
  const [busca, setBusca] = useState("");

  const contratoPorId = useMemo(() => new Map(contratos.map((c) => [c.id, c])), [contratos]);
  const empresaPorId = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);

  const competencias = useMemo(() => [...new Set(nfs.map((n) => n.competencia))].sort().reverse(), [nfs]);
  const contratosComNfs = useMemo(() => [...new Set(nfs.map((n) => n.contrato_id))].map((id) => contratoPorId.get(id)).filter(Boolean), [nfs, contratoPorId]);

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return nfs.filter((n) => {
      if (filtroEmpresa && n.empresa_id !== filtroEmpresa) return false;
      if (filtroCompetencia && n.competencia !== filtroCompetencia) return false;
      if (filtroContrato && n.contrato_id !== filtroContrato) return false;
      if (filtroStatus !== "todos" && statusDaNota(n) !== filtroStatus) return false;
      if (filtroCodigo !== "todos" && n.tipo_nota !== filtroCodigo) return false;
      if (filtroEmissaoDe && (!n.data_emissao || n.data_emissao < filtroEmissaoDe)) return false;
      if (filtroEmissaoAte && (!n.data_emissao || n.data_emissao > filtroEmissaoAte)) return false;
      if (filtroOver30 && !pendenteHaMaisDe30Dias(n)) return false;
      if (termo) {
        const alvo = `${n.numero_nf ?? ""} ${n.variacao ?? ""} ${n.contrato?.nome ?? ""} ${n.observacoes ?? ""}`.toLowerCase();
        if (!alvo.includes(termo)) return false;
      }
      return true;
    });
  }, [nfs, filtroEmpresa, filtroCompetencia, filtroContrato, filtroStatus, filtroCodigo, filtroEmissaoDe, filtroEmissaoAte, filtroOver30, busca]);

  const { data: itensPorNf } = useItensNfEmissaoEmLote(linhas.map((n) => n.id));

  const kpis = useMemo(() => {
    let executado = 0, faturado = 0, recebido = 0, pendente = 0;
    for (const n of linhas) {
      executado += n.valor_contrato_exec_total;
      faturado += n.vlr_bruto_total;
      recebido += n.valor_pago ?? 0;
      pendente += valorPendenteNf(n, itensPorNf?.get(n.id) ?? []);
    }
    return { executado, faturado, recebido, pendente };
  }, [linhas, itensPorNf]);

  function limparFiltros() {
    setFiltroEmpresa("");
    setFiltroCompetencia("");
    setFiltroContrato("");
    setFiltroStatus("todos");
    setFiltroCodigo("todos");
    setFiltroEmissaoDe("");
    setFiltroEmissaoAte("");
    setFiltroOver30(false);
    setBusca("");
  }

  function exportarExcel() {
    if (linhas.length === 0) {
      toast.error("Não há registros para exportar com os filtros atuais.");
      return;
    }
    import("xlsx").then((XLSX) => {
      const exportRows = linhas.map((nf) => ({
        Empresa: empresaPorId.get(nf.empresa_id) ?? nf.empresa?.nome_fantasia ?? nf.empresa?.razao_social ?? "-",
        Contrato: nf.contrato?.nome ?? "-",
        Competência: competenciaCurta(nf.competencia),
        Variação: nf.variacao ?? "-",
        "Nº NF": nf.numero_nf ?? "-",
        Código: nf.tipo_nota,
        "Data emissão": fmtDate(nf.data_emissao),
        "Data pagamento": fmtDate(nf.data_pagamento),
        "Valor executado": nf.valor_contrato_exec_total,
        "Valor bruto": nf.vlr_bruto_total,
        "Valor líquido": nf.vlr_liquido_total,
        "Valor pago": nf.valor_pago ?? 0,
        ISSQN: nf.issqn_total,
        INSS: nf.inss_total,
        IR: nf.ir_total,
        COFINS: nf.cofins_total,
        PIS: nf.pis_total,
        CSLL: nf.csll_total,
        "Desconto conta vinculada": nf.desconto_conta_vinculada,
        "Falta receber": nf.falta_receber,
        "Pago a mais": nf.pago_a_mais,
        "Recebimento extra": nf.recebimento_extra,
        "Valor pendente": valorPendenteNf(nf, itensPorNf?.get(nf.id) ?? []),
        Observações: nf.observacoes ?? "",
        Status: STATUS_LABEL[statusDaNota(nf)],
      }));
      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Relatório Geral");
      XLSX.writeFile(wb, `Relatorio_de_Servicos_Geral_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Valor Executado" valor={fmtMoney(kpis.executado)} icon={<ListChecks />} cor="slate" />
        <KpiTile label="Valor Faturado" valor={fmtMoney(kpis.faturado)} icon={<TrendingUp />} cor="sky" />
        <KpiTile label="Valor Recebido" valor={fmtMoney(kpis.recebido)} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
        <KpiTile label="Valor Pendente de Recebimento" valor={fmtMoney(kpis.pendente)} icon={<AlertTriangle />} cor="red" valorClass="text-red-600 dark:text-red-400" />
      </div>

      <div className="card-elevated p-3 flex items-center gap-x-2 gap-y-3 flex-wrap text-xs">
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Empresa:</span>
          <Select value={filtroEmpresa || "__todas"} onValueChange={(v) => setFiltroEmpresa(v === "__todas" ? "" : v)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todas">Todas</SelectItem>
              {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Competência:</span>
          <Select value={filtroCompetencia || "__todas"} onValueChange={(v) => setFiltroCompetencia(v === "__todas" ? "" : v)}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todas">Todas</SelectItem>
              {competencias.map((c) => <SelectItem key={c} value={c}>{competenciaCurta(c)}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Contrato:</span>
          <Select value={filtroContrato || "__todos"} onValueChange={(v) => setFiltroContrato(v === "__todos" ? "" : v)}>
            <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos">Todos</SelectItem>
              {contratosComNfs.map((c) => <SelectItem key={c!.id} value={c!.id}>{c!.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Status:</span>
          <Select value={filtroStatus} onValueChange={(v) => setFiltroStatus(v as StatusNota | "todos")}>
            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(Object.keys(STATUS_LABEL) as StatusNota[]).map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Código:</span>
          <Select value={filtroCodigo} onValueChange={(v) => setFiltroCodigo(v as TipoNota | "todos")}>
            <SelectTrigger className="h-8 w-24 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {(Object.keys(TIPOS_NOTA) as TipoNota[]).map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-muted-foreground">Emissão:</span>
          <Input type="date" value={filtroEmissaoDe} onChange={(e) => setFiltroEmissaoDe(e.target.value)} className="h-8 w-36 text-xs" />
        </label>
        <span className="text-muted-foreground">até</span>
        <Input type="date" value={filtroEmissaoAte} onChange={(e) => setFiltroEmissaoAte(e.target.value)} className="h-8 w-36 text-xs" />
        <button
          onClick={() => setFiltroOver30((v) => !v)}
          className={cn(
            "h-8 px-2.5 rounded-md border font-medium transition-colors",
            filtroOver30 ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"
          )}
        >
          Pendente há mais de 30 dias
        </button>
        <button onClick={limparFiltros} className="h-8 px-2.5 rounded-md border border-border bg-background text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors">
          Limpar filtros
        </button>
        <div className="relative w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar em todos os campos…"
            className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary"
          />
        </div>
        <span className="text-muted-foreground ml-auto">{linhas.length.toLocaleString("pt-BR")} de {nfs.length.toLocaleString("pt-BR")} registros</span>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={exportarExcel}>
          <FileDown className="h-3.5 w-3.5 mr-1.5" /> Exportar Excel
        </Button>
      </div>

      <div className="card-elevated overflow-hidden">
        {/* Table (shadcn) já embute seu próprio div overflow-auto (sem altura) —
            é ele quem precisa do limite de altura, senão a barra de rolagem
            horizontal fica ancorada no fim da tabela inteira, não na tela visível. */}
        <div className="[&>div]:max-h-[65vh] [&>div]:overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="text-center bg-card">Empresa</TableHead>
                <TableHead className="text-center bg-card">Contrato</TableHead>
                <TableHead className="text-center bg-card">Competência</TableHead>
                <TableHead className="text-center bg-card">Variação</TableHead>
                <TableHead className="text-center bg-card">Nº NF</TableHead>
                <TableHead className="text-center bg-card">Código</TableHead>
                <TableHead className="text-center bg-card">Emissão</TableHead>
                <TableHead className="text-center bg-card">Pagamento</TableHead>
                <TableHead className="text-center bg-card">Val. Executado</TableHead>
                <TableHead className="text-center bg-card">Val. Bruto</TableHead>
                <TableHead className="text-center bg-card">Val. Líquido</TableHead>
                <TableHead className="text-center bg-card">Val. Pago</TableHead>
                <TableHead className="text-center bg-sky-50 dark:bg-sky-950/20">ISSQN</TableHead>
                <TableHead className="text-center bg-sky-50 dark:bg-sky-950/20">INSS</TableHead>
                <TableHead className="text-center bg-sky-50 dark:bg-sky-950/20">IR</TableHead>
                <TableHead className="text-center bg-sky-50 dark:bg-sky-950/20">COFINS</TableHead>
                <TableHead className="text-center bg-sky-50 dark:bg-sky-950/20">PIS</TableHead>
                <TableHead className="text-center bg-sky-50 dark:bg-sky-950/20">CSLL</TableHead>
                <TableHead className="text-center bg-amber-50 dark:bg-amber-950/20">Conta Vinculada</TableHead>
                <TableHead className="text-center bg-amber-50 dark:bg-amber-950/20">Falta Receber</TableHead>
                <TableHead className="text-center bg-amber-50 dark:bg-amber-950/20">Pago a Mais</TableHead>
                <TableHead className="text-center bg-emerald-50 dark:bg-emerald-950/20">Receb. Extra</TableHead>
                <TableHead className="text-center bg-card">Val. Pendente</TableHead>
                <TableHead className="text-center bg-card">Observações</TableHead>
                <TableHead className="text-center bg-card">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!isLoading && linhas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={24} className="text-center text-muted-foreground py-10">Nenhum registro encontrado com os filtros atuais.</TableCell>
                </TableRow>
              )}
              {linhas.map((nf: NfEmissaoRow) => {
                const status = statusDaNota(nf);
                return (
                  <TableRow key={nf.id}>
                    <TableCell className="text-center whitespace-nowrap">{empresaPorId.get(nf.empresa_id) ?? nf.empresa?.nome_fantasia ?? "-"}</TableCell>
                    <TableCell className="text-center max-w-[200px] truncate">{nf.contrato?.nome ?? "-"}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{competenciaCurta(nf.competencia)}</TableCell>
                    <TableCell className="text-center">{nf.variacao ?? "-"}</TableCell>
                    <TableCell className="text-center">{nf.numero_nf ?? "-"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline">{nf.tipo_nota}</Badge>
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtDate(nf.data_emissao)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtDate(nf.data_pagamento)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.valor_contrato_exec_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.vlr_bruto_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.valor_pago ?? 0)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-sky-50/50 dark:bg-sky-950/10">{fmtMoney(nf.issqn_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-sky-50/50 dark:bg-sky-950/10">{fmtMoney(nf.inss_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-sky-50/50 dark:bg-sky-950/10">{fmtMoney(nf.ir_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-sky-50/50 dark:bg-sky-950/10">{fmtMoney(nf.cofins_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-sky-50/50 dark:bg-sky-950/10">{fmtMoney(nf.pis_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-sky-50/50 dark:bg-sky-950/10">{fmtMoney(nf.csll_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-amber-50/50 dark:bg-amber-950/10">{fmtMoney(nf.desconto_conta_vinculada)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-amber-50/50 dark:bg-amber-950/10">{fmtMoney(nf.falta_receber)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-amber-50/50 dark:bg-amber-950/10">{fmtMoney(nf.pago_a_mais)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap bg-emerald-50/50 dark:bg-emerald-950/10">{fmtMoney(nf.recebimento_extra)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap font-semibold">{fmtMoney(valorPendenteNf(nf, itensPorNf?.get(nf.id) ?? []))}</TableCell>
                    <TableCell className="text-center max-w-[220px] truncate">{nf.observacoes ?? "-"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={cn("whitespace-nowrap font-medium", STATUS_CLASSE[status])}>{STATUS_LABEL[status]}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
