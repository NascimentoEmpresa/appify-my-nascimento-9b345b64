import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, FileCheck, CircleDollarSign, FileDown, ListChecks, TrendingUp, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useContratosERP } from "@/hooks/useContratosERP";
import {
  NfEmissaoRow,
  NfEmissaoItemRow,
  useNfsEmissao,
  useItensNfEmissao,
  useItensNfEmissaoEmLote,
  useRegistrarPagamentoNf,
  TIPOS_NOTA,
} from "@/hooks/useNfEmissao";
import { calcularItem, calcularTotaisNf, pctEfetivo, ItemCalculado } from "@/pages/financeiro/nf-emissao/calculos";
import {
  fmtMoney, fmtDate, situacaoEspecial, statusDaNota, pendenteHaMaisDe30Dias, moneyTextContains, valorPendenteNf,
} from "@/pages/financeiro/nf-emissao/shared";
import { ItensNfEditor, ItemForm } from "@/pages/financeiro/nf-emissao/ItensNfEditor";
import { registrarLogNf } from "@/pages/financeiro/nf-emissao/registrarLogNf";
import { HistoricoNfPainel } from "@/pages/financeiro/nf-emissao/HistoricoNfPainel";
import { KpiTile } from "@/components/financeiro/KpiTile";
import { ColumnFilterHead } from "./ColumnFilterHead";

type StatusFiltro = "todos" | "pendente" | "pago" | "substituida" | "cancelada";

const STATUS_FILTRO_LABEL: Record<StatusFiltro, string> = {
  todos: "Todos",
  pendente: "Pendente",
  pago: "Pago",
  substituida: "Substituída",
  cancelada: "Cancelada",
};

function PagamentoBadge({ nf }: { nf: NfEmissaoRow }) {
  if (nf.data_pagamento) {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
        Pago em {fmtDate(nf.data_pagamento)}
      </Badge>
    );
  }
  const especial = situacaoEspecial(nf);
  if (especial === "CANCELADA") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        Cancelada
      </Badge>
    );
  }
  if (especial === "SUBSTITUIDA") {
    return (
      <Badge variant="outline" className="border-muted-foreground/30 text-muted-foreground">
        Substituída
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
      Pendente
    </Badge>
  );
}

function itemRowParaForm(r: NfEmissaoItemRow): ItemForm {
  return {
    identificacao: r.identificacao ?? "",
    valor_contrato_exec: r.valor_contrato_exec,
    vlr_va: r.vlr_va,
    vlr_vt: r.vlr_vt,
    vlr_materiais: r.vlr_materiais,
    faltas: r.faltas,
    posto_nao_implementado: r.posto_nao_implementado,
    multas: r.multas,
    glosas: r.glosas,
    outros_descontos: r.outros_descontos,
    multas_pos_emissao: r.multas_pos_emissao,
    glosas_pos_emissao: r.glosas_pos_emissao,
    outros_descontos_pos_emissao: r.outros_descontos_pos_emissao,
    qtd_colaboradores: r.qtd_colaboradores,
    inss_categoria: r.inss_categoria,
    issqn_pct: r.issqn_pct,
    ir_pct: r.ir_pct,
    cofins_pct: r.cofins_pct,
    pis_pct: r.pis_pct,
    csll_pct: r.csll_pct,
  };
}

export default function NotasConcluidasTab() {
  // SIS-2026-0309: lê NFs/contratos de todas as empresas do grupo — o
  // filtro de "empresa ativa" só limitava a visão, sem proteger nada.
  const { data: nfs = [], isLoading } = useNfsEmissao(null, { todasEmpresas: true });
  const { data: contratos = [] } = useContratosERP({ todasEmpresas: true });

  const [busca, setBusca] = useState("");
  const [contratoSel, setContratoSel] = useState<string | null>(null);
  const [nfSelecionada, setNfSelecionada] = useState<NfEmissaoRow | null>(null);
  const [filtroStatus, setFiltroStatus] = useState<StatusFiltro>("todos");
  const [buscaNf, setBuscaNf] = useState("");
  // SIS-2026-0323 (mockup do Ruan/Discord, pedido explícito do usuário):
  // filtro por cabeçalho de coluna (funil), não faixa de filtros inline —
  // o usuário achou a faixa inline "estranha" e preferiu o padrão do protótipo.
  const [colFiltros, setColFiltros] = useState<Record<string, string>>({});
  const [filtroOver30, setFiltroOver30] = useState(false);

  function setColFiltro(chave: string, valor: string) {
    setColFiltros((prev) => {
      const next = { ...prev };
      if (valor) next[chave] = valor;
      else delete next[chave];
      return next;
    });
  }

  const concluidas = useMemo(() => nfs.filter((n) => n.status === "concluida"), [nfs]);
  const contratoPorId = useMemo(() => new Map(contratos.map((c) => [c.id, c])), [contratos]);

  const contratosComNotas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return contratos
      .map((c) => ({ contrato: c, notas: concluidas.filter((n) => n.contrato_id === c.id) }))
      .filter(({ contrato, notas }) => {
        if (notas.length === 0) return false;
        if (!termo) return true;
        return contrato.nome.toLowerCase().includes(termo) || contrato.cliente.toLowerCase().includes(termo);
      })
      .sort((a, b) => {
        const encerradoA = a.contrato.status === "encerrado" ? 1 : 0;
        const encerradoB = b.contrato.status === "encerrado" ? 1 : 0;
        return encerradoA !== encerradoB ? encerradoA - encerradoB : a.contrato.nome.localeCompare(b.contrato.nome);
      });
  }, [contratos, concluidas, busca]);

  const contratoAtual = contratos.find((c) => c.id === contratoSel) ?? null;

  function bateBuscaNf(n: NfEmissaoRow, termo: string) {
    if (!termo) return true;
    return (n.variacao ?? "").toLowerCase().includes(termo) || (n.numero_nf ?? "").toLowerCase().includes(termo);
  }

  function bateColFiltros(n: NfEmissaoRow) {
    const cf = colFiltros;
    if (cf.nf && !(n.numero_nf ?? "").toLowerCase().includes(cf.nf.toLowerCase())) return false;
    if (cf.codigo && n.tipo_nota !== cf.codigo) return false;
    if (cf.emissao && n.data_emissao !== cf.emissao) return false;
    if (cf.competencia && n.competencia !== cf.competencia) return false;
    if (cf.variacao && !(n.variacao ?? "").toLowerCase().includes(cf.variacao.toLowerCase())) return false;
    if (cf.executado && !moneyTextContains(n.valor_contrato_exec_total, cf.executado)) return false;
    if (cf.contabil && !moneyTextContains(n.vlr_bruto_total, cf.contabil)) return false;
    if (cf.liquido && !moneyTextContains(n.vlr_liquido_total, cf.liquido)) return false;
    if (cf.pagamento && n.data_pagamento !== cf.pagamento) return false;
    if (cf.recebido && !moneyTextContains(n.valor_pago ?? 0, cf.recebido)) return false;
    if (cf.contaVinculada && !moneyTextContains(n.desconto_conta_vinculada, cf.contaVinculada)) return false;
    if (cf.status && STATUS_FILTRO_LABEL[statusDaNota(n)] !== cf.status) return false;
    if (filtroOver30 && !pendenteHaMaisDe30Dias(n)) return false;
    return true;
  }

  const nfsDoContrato = useMemo(() => {
    const termo = buscaNf.trim().toLowerCase();
    return concluidas.filter(
      (n) =>
        n.contrato_id === contratoSel &&
        (filtroStatus === "todos" || statusDaNota(n) === filtroStatus) &&
        bateBuscaNf(n, termo) &&
        bateColFiltros(n)
    );
  }, [concluidas, contratoSel, filtroStatus, buscaNf, colFiltros, filtroOver30]);

  // Sem contrato selecionado, mas com filtro de status e/ou busca de NF ativos:
  // lista achatada cruzando todos os contratos (ex: "me mostra todas as
  // canceladas", ou achar rápido uma variação/nº de nota, útil pra contratos
  // com muitas notas por competência tipo Veranópolis).
  const nfsFlatFiltradas = useMemo(() => {
    if (contratoSel || (filtroStatus === "todos" && !buscaNf.trim())) return [];
    const termo = buscaNf.trim().toLowerCase();
    return concluidas
      .filter((n) => (filtroStatus === "todos" || statusDaNota(n) === filtroStatus) && bateBuscaNf(n, termo) && bateColFiltros(n))
      .sort((a, b) => b.competencia.localeCompare(a.competencia));
  }, [concluidas, contratoSel, filtroStatus, buscaNf, colFiltros, filtroOver30]);

  const linhasVisiveis = contratoAtual ? nfsDoContrato : nfsFlatFiltradas;

  const opcoesFiltro = useMemo(() => {
    const base = contratoSel ? concluidas.filter((n) => n.contrato_id === contratoSel) : concluidas;
    return {
      competencias: [...new Set(base.map((n) => n.competencia))].sort().reverse(),
      variacoes: [...new Set(base.map((n) => n.variacao).filter(Boolean))].sort() as string[],
    };
  }, [concluidas, contratoSel]);

  // KPIs do contrato selecionado (mesmos 4 do protótipo) — precisa dos
  // itens de cada NF pra calcular o "Valor pendente de recebimento" certo.
  const { data: itensContrato } = useItensNfEmissaoEmLote(nfsDoContrato.map((n) => n.id));
  const kpisContrato = useMemo(() => {
    let executado = 0, faturado = 0, recebido = 0, pendente = 0;
    for (const n of nfsDoContrato) {
      executado += n.valor_contrato_exec_total;
      faturado += n.vlr_bruto_total;
      recebido += n.valor_pago ?? 0;
      pendente += valorPendenteNf(n, itensContrato?.get(n.id) ?? []);
    }
    return { executado, faturado, recebido, pendente };
  }, [nfsDoContrato, itensContrato]);

  // SIS-2026-0323 (pedido do usuário): mesmo divisor arrastável já usado
  // em PlanilhaCusto.tsx entre a lista de contratos e a tabela.
  const [leftWidth, setLeftWidth] = useState(340);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function onMouseDownResize(e: React.MouseEvent) {
    dragging.current = true;
    e.preventDefault();
    function onMove(ev: MouseEvent) {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newW = Math.min(Math.max(ev.clientX - rect.left, 220), rect.width - 320);
      setLeftWidth(newW);
    }
    function onUp() {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function limparFiltrosExtras() {
    setColFiltros({});
    setFiltroOver30(false);
  }

  function exportarExcel() {
    if (linhasVisiveis.length === 0) {
      toast.error("Não há registros para exportar com os filtros atuais.");
      return;
    }
    import("xlsx").then((XLSX) => {
      const linhas = linhasVisiveis.map((nf) => ({
        Contrato: nf.contrato?.nome ?? "-",
        Competência: nf.competencia,
        Variação: nf.variacao ?? "-",
        "Nº NF": nf.numero_nf ?? "-",
        Código: nf.tipo_nota,
        "Data de emissão": fmtDate(nf.data_emissao),
        "Valor executado": nf.valor_contrato_exec_total,
        "Valor Bruto": nf.vlr_bruto_total,
        "Valor Líquido": nf.vlr_liquido_total,
        "Data de pagamento": fmtDate(nf.data_pagamento),
        "Valor Pago": nf.valor_pago ?? 0,
        "Desconto conta vinculada": nf.desconto_conta_vinculada,
        "Status atual": STATUS_FILTRO_LABEL[statusDaNota(nf)],
      }));
      const ws = XLSX.utils.json_to_sheet(linhas);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Por Contrato");
      XLSX.writeFile(wb, `Relatorio_de_Servicos_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }

  return (
    <div ref={containerRef} className="flex h-[calc(100vh-220px)] min-h-[480px]">
      <div style={{ width: leftWidth }} className="shrink-0 card-elevated flex flex-col overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar contrato…"
              className="h-8 w-full rounded border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {!isLoading && contratosComNotas.length === 0 && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma NF concluída ainda. Conclua notas em Controle de Notas pra elas aparecerem aqui.
            </p>
          )}
          {contratosComNotas.map(({ contrato: c, notas }) => {
            const pendentes = notas.filter((n) => !n.data_pagamento && !situacaoEspecial(n)).length;
            const ativo = contratoSel === c.id;
            const encerrado = c.status === "encerrado";
            return (
              <button
                key={c.id}
                onClick={() => setContratoSel(c.id)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30",
                  ativo && "bg-primary/5 border-l-2 border-l-primary",
                  encerrado && !ativo && "bg-muted/40 opacity-70"
                )}
              >
                <div className="min-w-0">
                  <p className={cn("text-xs font-semibold truncate", encerrado && "text-muted-foreground")}>{c.nome}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.cliente}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {encerrado && (
                    <span className="inline-flex rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                      Encerrado
                    </span>
                  )}
                  <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    {notas.length}
                  </span>
                  {pendentes > 0 && (
                    <span className="inline-flex rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                      {pendentes} pend.
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div
        onMouseDown={onMouseDownResize}
        className="w-1.5 shrink-0 cursor-col-resize hover:bg-primary/30 transition-colors border-x border-border mx-1"
      />

      <div className="flex-1 min-w-0 card-elevated flex flex-col overflow-hidden">
        <div className="border-b border-border px-4 py-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-muted-foreground mr-1">Status:</span>
          {(Object.keys(STATUS_FILTRO_LABEL) as StatusFiltro[]).map((s) => (
            <button
              key={s}
              onClick={() => setFiltroStatus(s)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium border transition-colors",
                filtroStatus === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary/50"
              )}
            >
              {STATUS_FILTRO_LABEL[s]}
            </button>
          ))}
          <div className="relative ml-auto w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={buscaNf}
              onChange={(e) => setBuscaNf(e.target.value)}
              placeholder="Buscar variação ou nº da NF…"
              className="h-8 w-full rounded border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* SIS-2026-0323 (pedido explícito do usuário): filtro por
            coluna (funil no cabeçalho, igual ao protótipo) substitui a
            faixa de filtros inline — só sobra aqui o que não tem coluna
            própria (Pendência >30d) + limpar + exportar. */}
        <div className="border-b border-border px-4 py-2 flex items-center gap-2 flex-wrap text-xs">
          <button
            onClick={() => setFiltroOver30((v) => !v)}
            className={cn(
              "px-2.5 py-1 rounded-full border font-medium transition-colors",
              filtroOver30 ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:border-primary/50"
            )}
          >
            Pendente há mais de 30 dias
          </button>
          {(Object.keys(colFiltros).length > 0 || filtroOver30) && (
            <button onClick={limparFiltrosExtras} className="text-muted-foreground hover:text-destructive">Limpar filtros</button>
          )}
          <Button size="sm" variant="outline" className="h-7 ml-auto text-xs" onClick={exportarExcel}>
            <FileDown className="h-3.5 w-3.5 mr-1.5" /> Exportar Excel
          </Button>
        </div>

        {contratoAtual ? (
          <>
            <div className="border-b border-border px-4 py-3 space-y-3">
              <div>
                <p className="text-sm font-semibold">{contratoAtual.nome}</p>
                <p className="text-xs text-muted-foreground">{contratoAtual.cliente}</p>
              </div>
              <div className="grid grid-cols-4 gap-2">
                <KpiTile label="Valor Executado" valor={fmtMoney(kpisContrato.executado)} icon={<ListChecks />} cor="slate" />
                <KpiTile label="Valor Faturado" valor={fmtMoney(kpisContrato.faturado)} icon={<TrendingUp />} cor="sky" />
                <KpiTile label="Valor Recebido" valor={fmtMoney(kpisContrato.recebido)} icon={<CheckCircle2 />} cor="emerald" valorClass="text-emerald-600 dark:text-emerald-400" />
                <KpiTile label="Val. Pendente de Recebimento" valor={fmtMoney(kpisContrato.pendente)} icon={<AlertTriangle />} cor="red" valorClass="text-red-600 dark:text-red-400" />
              </div>
            </div>
            <div className="overflow-auto flex-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <ColumnFilterHead label="Nº NF" value={colFiltros.nf ?? ""} onApply={(v) => setColFiltro("nf", v)} />
                    <ColumnFilterHead label="Código" value={colFiltros.codigo ?? ""} onApply={(v) => setColFiltro("codigo", v)} type="select" options={Object.keys(TIPOS_NOTA)} />
                    <ColumnFilterHead label="Data de emissão" value={colFiltros.emissao ?? ""} onApply={(v) => setColFiltro("emissao", v)} type="date" />
                    <ColumnFilterHead label="Competência" value={colFiltros.competencia ?? ""} onApply={(v) => setColFiltro("competencia", v)} type="select" options={opcoesFiltro.competencias} />
                    <ColumnFilterHead label="Variação" value={colFiltros.variacao ?? ""} onApply={(v) => setColFiltro("variacao", v)} />
                    <ColumnFilterHead label="Valor executado" value={colFiltros.executado ?? ""} onApply={(v) => setColFiltro("executado", v)} type="money" />
                    <ColumnFilterHead label="Valor contábil" value={colFiltros.contabil ?? ""} onApply={(v) => setColFiltro("contabil", v)} type="money" />
                    <ColumnFilterHead label="Valor líquido" value={colFiltros.liquido ?? ""} onApply={(v) => setColFiltro("liquido", v)} type="money" />
                    <ColumnFilterHead label="Data de pagamento" value={colFiltros.pagamento ?? ""} onApply={(v) => setColFiltro("pagamento", v)} type="date" />
                    <ColumnFilterHead label="Recebido" value={colFiltros.recebido ?? ""} onApply={(v) => setColFiltro("recebido", v)} type="money" />
                    <ColumnFilterHead label="Desconto conta vinculada" value={colFiltros.contaVinculada ?? ""} onApply={(v) => setColFiltro("contaVinculada", v)} type="money" />
                    <ColumnFilterHead label="Status" value={colFiltros.status ?? ""} onApply={(v) => setColFiltro("status", v)} type="select" options={Object.values(STATUS_FILTRO_LABEL).filter((l) => l !== "Todos")} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {nfsDoContrato.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center text-muted-foreground py-8">
                        Nenhuma NF {filtroStatus === "todos" ? "concluída" : STATUS_FILTRO_LABEL[filtroStatus].toLowerCase()} para este contrato{buscaNf.trim() ? " com essa busca" : ""}.
                      </TableCell>
                    </TableRow>
                  )}
                  {nfsDoContrato.map((nf) => (
                    <TableRow key={nf.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setNfSelecionada(nf)}>
                      <TableCell className="text-center font-medium">{nf.numero_nf ?? "-"}</TableCell>
                      <TableCell className="text-center"><Badge variant="outline">{nf.tipo_nota}</Badge></TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtDate(nf.data_emissao)}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">
                        {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                      </TableCell>
                      <TableCell className="text-center">{nf.variacao ?? "-"}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.valor_contrato_exec_total)}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.vlr_bruto_total)}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtDate(nf.data_pagamento)}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.valor_pago ?? 0)}</TableCell>
                      <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.desconto_conta_vinculada)}</TableCell>
                      <TableCell className="text-center">
                        <PagamentoBadge nf={nf} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : filtroStatus !== "todos" || buscaNf.trim() ? (
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center">Contrato</TableHead>
                  <ColumnFilterHead label="Nº NF" value={colFiltros.nf ?? ""} onApply={(v) => setColFiltro("nf", v)} />
                  <ColumnFilterHead label="Código" value={colFiltros.codigo ?? ""} onApply={(v) => setColFiltro("codigo", v)} type="select" options={Object.keys(TIPOS_NOTA)} />
                  <ColumnFilterHead label="Data de emissão" value={colFiltros.emissao ?? ""} onApply={(v) => setColFiltro("emissao", v)} type="date" />
                  <ColumnFilterHead label="Competência" value={colFiltros.competencia ?? ""} onApply={(v) => setColFiltro("competencia", v)} type="select" options={opcoesFiltro.competencias} />
                  <ColumnFilterHead label="Variação" value={colFiltros.variacao ?? ""} onApply={(v) => setColFiltro("variacao", v)} />
                  <ColumnFilterHead label="Valor executado" value={colFiltros.executado ?? ""} onApply={(v) => setColFiltro("executado", v)} type="money" />
                  <ColumnFilterHead label="Valor contábil" value={colFiltros.contabil ?? ""} onApply={(v) => setColFiltro("contabil", v)} type="money" />
                  <ColumnFilterHead label="Valor líquido" value={colFiltros.liquido ?? ""} onApply={(v) => setColFiltro("liquido", v)} type="money" />
                  <ColumnFilterHead label="Data de pagamento" value={colFiltros.pagamento ?? ""} onApply={(v) => setColFiltro("pagamento", v)} type="date" />
                  <ColumnFilterHead label="Recebido" value={colFiltros.recebido ?? ""} onApply={(v) => setColFiltro("recebido", v)} type="money" />
                  <ColumnFilterHead label="Desconto conta vinculada" value={colFiltros.contaVinculada ?? ""} onApply={(v) => setColFiltro("contaVinculada", v)} type="money" />
                  <ColumnFilterHead label="Status" value={colFiltros.status ?? ""} onApply={(v) => setColFiltro("status", v)} type="select" options={Object.values(STATUS_FILTRO_LABEL).filter((l) => l !== "Todos")} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {nfsFlatFiltradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center text-muted-foreground py-8">
                      Nenhuma NF encontrada com esse filtro/busca.
                    </TableCell>
                  </TableRow>
                )}
                {nfsFlatFiltradas.map((nf) => (
                  <TableRow key={nf.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setNfSelecionada(nf)}>
                    <TableCell className="max-w-[220px] truncate text-center">{contratoPorId.get(nf.contrato_id)?.nome ?? "-"}</TableCell>
                    <TableCell className="text-center font-medium">{nf.numero_nf ?? "-"}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline">{nf.tipo_nota}</Badge></TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtDate(nf.data_emissao)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                    </TableCell>
                    <TableCell className="text-center">{nf.variacao ?? "-"}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.valor_contrato_exec_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.vlr_bruto_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtDate(nf.data_pagamento)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.valor_pago ?? 0)}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">{fmtMoney(nf.desconto_conta_vinculada)}</TableCell>
                    <TableCell className="text-center">
                      <PagamentoBadge nf={nf} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center py-20">
            <div className="text-center">
              <FileCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Selecione um contrato ou um status pra ver todas as notas</p>
            </div>
          </div>
        )}
      </div>

      <NfPagamentoDialog nf={nfSelecionada} onClose={() => setNfSelecionada(null)} />
    </div>
  );
}

function NfPagamentoDialog({ nf, onClose }: { nf: NfEmissaoRow | null; onClose: () => void }) {
  const { data: itensExistentes = [] } = useItensNfEmissao(nf?.id);
  const registrarPagamento = useRegistrarPagamentoNf();

  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());
  const [valorPago, setValorPago] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const [situacaoSitePmt, setSituacaoSitePmt] = useState("");
  const [situacaoDominio, setSituacaoDominio] = useState("");
  const [descontoContaVinculada, setDescontoContaVinculada] = useState("0");
  const [recebimentoExtra, setRecebimentoExtra] = useState("0");
  const [faltaReceber, setFaltaReceber] = useState("0");
  const [pagoAMais, setPagoAMais] = useState("0");

  useEffect(() => {
    if (!nf) return;
    setValorPago(String(nf.valor_pago ?? nf.vlr_liquido_total ?? 0));
    setDataPagamento(nf.data_pagamento ?? new Date().toISOString().slice(0, 10));
    setSituacaoSitePmt(nf.situacao_site_pmt ?? "");
    setSituacaoDominio(nf.situacao_dominio ?? "");
    setDescontoContaVinculada(String(nf.desconto_conta_vinculada ?? 0));
    setRecebimentoExtra(String(nf.recebimento_extra ?? 0));
    setFaltaReceber(String(nf.falta_receber ?? 0));
    setPagoAMais(String(nf.pago_a_mais ?? 0));
  }, [nf?.id]);

  const itens: ItemForm[] = useMemo(() => itensExistentes.map(itemRowParaForm), [itensExistentes]);

  const pctFiscais = nf
    ? { issqn_pct: nf.issqn_pct, ir_pct: nf.ir_pct, cofins_pct: nf.cofins_pct, pis_pct: nf.pis_pct, csll_pct: nf.csll_pct }
    : null;

  const itensCalculados: ItemCalculado[] = useMemo(() => {
    if (!pctFiscais) return [];
    return itens.map((it) => calcularItem(it, pctEfetivo(it, pctFiscais)));
  }, [itens, pctFiscais]);

  const totais = useMemo(() => calcularTotaisNf(itensCalculados), [itensCalculados]);

  function toggleExpandido(i: number) {
    setExpandidos((exp) => {
      const n = new Set(exp);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }

  async function handleSalvarPagamento() {
    if (!nf) return;
    const valor = Number(valorPago);
    if (!dataPagamento || isNaN(valor) || valor <= 0) {
      toast.error("Informe um valor e uma data de pagamento válidos.");
      return;
    }
    try {
      await registrarPagamento.mutateAsync({ id: nf.id, data_pagamento: dataPagamento, valor_pago: valor });
      await registrarLogNf(nf.id, "nf_paga", `Pagamento registrado: ${fmtMoney(valor)} em ${fmtDate(dataPagamento)}`);
      toast.success("Pagamento registrado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao registrar pagamento.");
    }
  }

  async function handleSalvarReconciliacao() {
    if (!nf) return;
    try {
      await registrarPagamento.mutateAsync({
        id: nf.id,
        data_pagamento: nf.data_pagamento,
        valor_pago: nf.valor_pago,
        situacao_site_pmt: situacaoSitePmt.trim() || null,
        situacao_dominio: situacaoDominio.trim() || null,
        desconto_conta_vinculada: Number(descontoContaVinculada) || 0,
        recebimento_extra: Number(recebimentoExtra) || 0,
        falta_receber: Number(faltaReceber) || 0,
        pago_a_mais: Number(pagoAMais) || 0,
      });
      await registrarLogNf(nf.id, "reconciliacao_atualizada", "Reconciliação de pagamento atualizada");
      toast.success("Reconciliação salva.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar reconciliação.");
    }
  }

  async function handleRemoverPagamento() {
    if (!nf) return;
    try {
      await registrarPagamento.mutateAsync({ id: nf.id, data_pagamento: null, valor_pago: null });
      await registrarLogNf(nf.id, "pagamento_removido", "Registro de pagamento removido");
      toast.success("Registro de pagamento removido.");
      setConfirmandoRemocao(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao remover pagamento.");
    }
  }

  return (
    <Dialog open={!!nf} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-screen h-screen max-w-none max-h-screen overflow-y-auto overflow-x-hidden rounded-none sm:rounded-none">
        <DialogHeader>
          <DialogTitle>NF Concluída</DialogTitle>
          <DialogDescription>Confira os dados validados e registre o pagamento quando ele acontecer.</DialogDescription>
        </DialogHeader>

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="grid grid-cols-4 gap-3">
              <div className="col-span-2">
                <Label className="text-xs">Contrato</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.contrato?.nome ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Variação</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.variacao ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Nº NF</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {nf.numero_nf ?? "-"}
                </div>
              </div>
              <div>
                <Label className="text-xs">Tipo de Nota</Label>
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {TIPOS_NOTA[nf.tipo_nota]}
                </div>
              </div>
            </div>
          </section>
        )}

        {nf && (
          <ItensNfEditor
            itens={itens}
            itensCalculados={itensCalculados}
            totais={totais}
            pctFiscais={pctFiscais}
            postosVigentes={[]}
            contratoId={nf.contrato_id}
            expandidos={expandidos}
            mostrarPosEmissao
            readOnly
            onUpdateItem={() => {}}
            onAddItem={() => {}}
            onRemoveItem={() => {}}
            onToggleExpandido={toggleExpandido}
            onSelecionarPostos={() => {}}
            onQtdColaboradoresChange={() => {}}
          />
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CircleDollarSign className="h-4 w-4" /> Pagamento
            </div>
            <div className="grid grid-cols-4 gap-3 items-end">
              <div>
                <Label>Valor Pago</Label>
                <CurrencyInput value={valorPago} onChange={setValorPago} />
              </div>
              <div>
                <Label>Data de Pagamento</Label>
                <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
              </div>
              <Button onClick={handleSalvarPagamento} disabled={registrarPagamento.isPending}>
                {nf.data_pagamento ? "Atualizar pagamento" : "Registrar pagamento"}
              </Button>
              {nf.data_pagamento && (
                <Button variant="outline" className="text-destructive" onClick={() => setConfirmandoRemocao(true)}>
                  Remover registro
                </Button>
              )}
            </div>
          </section>
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="text-sm font-semibold">Reconciliação</div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <Label className="text-xs">Situação site P.M.T.</Label>
                <Input value={situacaoSitePmt} onChange={(e) => setSituacaoSitePmt(e.target.value)} placeholder="Ex: Normal" />
              </div>
              <div>
                <Label className="text-xs">Situa Domínio</Label>
                <Input value={situacaoDominio} onChange={(e) => setSituacaoDominio(e.target.value)} placeholder="Ex: Normal" />
              </div>
              <div>
                <Label className="text-xs">Desconto de conta vinculada</Label>
                <CurrencyInput value={descontoContaVinculada} onChange={setDescontoContaVinculada} />
              </div>
              <div>
                <Label className="text-xs">Recebimento extra</Label>
                <CurrencyInput value={recebimentoExtra} onChange={setRecebimentoExtra} />
              </div>
              <div>
                <Label className="text-xs">Falta receber</Label>
                <CurrencyInput value={faltaReceber} onChange={setFaltaReceber} />
              </div>
              <div>
                <Label className="text-xs">Pago a mais</Label>
                <CurrencyInput value={pagoAMais} onChange={setPagoAMais} />
              </div>
              <div className="col-span-2 flex items-end">
                <Button variant="outline" onClick={handleSalvarReconciliacao} disabled={registrarPagamento.isPending}>
                  Salvar reconciliação
                </Button>
              </div>
            </div>
          </section>
        )}

        {nf && (
          <section className="rounded-xl border bg-card p-3 space-y-3">
            <div className="text-sm font-semibold">Histórico</div>
            <HistoricoNfPainel nfEmissaoId={nf.id} />
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmandoRemocao} onOpenChange={setConfirmandoRemocao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover registro de pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A NF volta a aparecer como pendente de pagamento. Essa ação também fica no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleRemoverPagamento}>
              Confirmar remoção
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
