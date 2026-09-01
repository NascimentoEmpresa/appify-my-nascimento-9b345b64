import React, { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Search, Plus, Upload, Trash2, Pencil, ChevronDown, ChevronUp,
  FileSpreadsheet, X, Download, Eye, DatabaseZap, Building2, RefreshCw,
  MapPin, Loader2, Check, ChevronsUpDown,
} from "lucide-react";
import {
  usePlanilhaPostoLocalizacao, usePlanilhaPostoLocalizacaoAll,
  usePostoLocalizacaoSave, usePostoLocalizacaoDelete,
  type PostoLocalizacao,
} from "@/hooks/usePlanilhaPostoLocalizacao";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  usePlanilhaCustos, useSavePlanilhaCusto, useDeletePlanilhaCusto,
  useBulkInsertPlanilhaCusto, useEncerrarContrato, useSalvarJustificativaDivergencia,
  formatBRL, type PlanilhaCustoRow, type JustificativaEntry,
} from "@/hooks/usePlanilhaCusto";
import { importarPlanilha, type PlanilhaCustoImportada } from "@/utils/planilhaCustoImporter";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useContratosERP, type ContratoERP } from "@/hooks/useContratosERP";
import { supabase } from "@/integrations/supabase/client";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

// ─── Tipos ────────────────────────────────────────────────────────────────────

type FormData = Omit<PlanilhaCustoRow, "id" | "empresa_id" | "created_at" | "updated_at" | "encerrado" | "data_encerramento">;

const EMPTY_FORM: FormData = {
  orexec: "EXECUTADO", cliente: "", contrato: "", posto: "", servico: "",
  sindicato: "", data_vigencia: "", qt_postos: 0, arquivo_origem: "",
  salario: 0, insalubridade: 0, periculosidade: 0, lideranca: 0,
  adicional_noturno_reduzido: 0, adicional_noturno: 0, adicional_extra: 0, dsr: 0,
  decimo_terceiro: 0, adicional_ferias: 0, incidencia_enc_41: 0,
  inss: 0, salario_educacao: 0, rat_fap: 0, sesi: 0, senai: 0, sebrae: 0,
  incra: 0, fgts: 0, seguro_acidente_trabalho: 0,
  transporte: 0, transporte_desconto: 0, aux_alimentacao: 0, aux_alimentacao_desconto: 0, aux_refeicao: 0,
  beneficio_familiar: 0, aux_lanche: 0, seguro_vida: 0, abono_indenizatorio: 0,
  aux_educacao: 0, cesta_basica: 0, assistencia_medica: 0, hospedagem: 0,
  odontologico: 0, manutencao_profissional: 0, cafe: 0, almoco: 0,
  janta: 0, ceia: 0, funeral: 0, assiduidade: 0, beneficio_trabalhador: 0,
  patronal: 0, fundo_assistencial: 0, fundo_profissional: 0, natalidade: 0,
  deducoes: 0, outros_1: 0, outros_1_descricao: "", outros_2: 0,
  outros_2_descricao: "", outros_3: 0, outros_3_descricao: "",
  contrato_id: null, justificativa_divergencia: [],
  aviso_indenizado: 0, incidencia_fgts: 0, multa_rescisoria: 0,
  aviso_trabalhado: 0, incidencia_aviso_trabalhado: 0, multa_aviso_indenizado: 0,
  contratualidade: 0,
  sub_ferias: 0, sub_ausencias_legais: 0, sub_paternidade: 0,
  sub_acidente_trabalho: 0, sub_maternidade: 0, sub_doenca: 0, sub_repouso: 0,
  incidencia_maternidade: 0, incidencia_enc_reposicao: 0, incidencia_enc_reposicao_2: 0,
  incidencia_enc_reposicao_3: 0, incidencia_enc_reposicao_4: 0,
  uniforme: 0, epi: 0, epc: 0, materiais: 0, equipamentos: 0,
  relogio_digital: 0, ponto_eletronico: 0, outros_insumos: 0,
  custos_indiretos: 0, lucro: 0, cofins: 0, pis: 0, irpj_csll: 0, iss: 0,
  total_por_empregado: 0,
};

// ─── Lógica de vigência ───────────────────────────────────────────────────────

function computeVigenciaStatus(rows: PlanilhaCustoRow[]): Map<string, string> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Para cada (contrato + posto), coleta todas as datas — linhas encerradas
  // ficam de fora do pool ANTES de escolher a vigente (não só depois, na
  // atribuição por linha), senão uma linha encerrada com data mais recente
  // "rouba" a vigência do grupo e a linha ativa de verdade some do cálculo.
  const groupDates = new Map<string, Date[]>();
  for (const r of rows) {
    if (!r.data_vigencia || r.encerrado) continue;
    const key = `${r.contrato}||${r.posto}`;
    const d = new Date(r.data_vigencia + "T00:00:00");
    if (!groupDates.has(key)) groupDates.set(key, []);
    groupDates.get(key)!.push(d);
  }

  // Para cada grupo, acha a data vigente (mais recente ≤ hoje)
  const vigente = new Map<string, Date | null>();
  groupDates.forEach((dates, key) => {
    const past = dates.filter((d) => d <= today).sort((a, b) => b.getTime() - a.getTime());
    vigente.set(key, past[0] ?? null);
  });

  // Atribui status por linha
  const result = new Map<string, string>();
  for (const r of rows) {
    // Contrato encerrado manualmente → sempre HISTÓRICO
    if (r.encerrado) { result.set(r.id, "HISTÓRICO"); continue; }
    if (!r.data_vigencia) { result.set(r.id, "—"); continue; }
    const key = `${r.contrato}||${r.posto}`;
    const rowDate = new Date(r.data_vigencia + "T00:00:00");
    const v = vigente.get(key) ?? null;

    if (rowDate > today) {
      result.set(r.id, `ENTRA ${rowDate.toLocaleDateString("pt-BR")}`);
    } else if (v && rowDate.getTime() === v.getTime()) {
      result.set(r.id, "EM VIGÊNCIA");
    } else {
      result.set(r.id, "HISTÓRICO");
    }
  }
  return result;
}

function VigenciaStatusBadge({ status }: { status: string }) {
  const base = "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold";
  if (status === "EM VIGÊNCIA") {
    return <span className={`${base} bg-success-soft text-success`}>VIGENTE</span>;
  }
  if (status === "HISTÓRICO") {
    return <span className={`${base} bg-muted text-muted-foreground`}>HISTÓRICO</span>;
  }
  if (status.startsWith("ENTRA")) {
    return <span className={`${base} bg-warning/15 text-warning`}>↗ {status.replace("ENTRA ", "")}</span>;
  }
  return <span className="text-xs text-muted-foreground">{status}</span>;
}

// ─── Página principal ─────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function PlanilhaCusto() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [migracaoOpen, setMigracaoOpen] = useState(false);
  const [importPostosOpen, setImportPostosOpen] = useState(false);
  const [contratosOpen, setContratosOpen] = useState(false);
  const [clientesOpen, setClientesOpen] = useState(false);
  const [postosViewOpen, setPostosViewOpen] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [filtroOrexec, setFiltroOrexec] = useState<"" | "ORÇADO" | "EXECUTADO">("");
  const [filtroVigencia, setFiltroVigencia] = useState<"" | "EM VIGÊNCIA" | "HISTÓRICO" | "A INICIAR">("");
  const [updateFromRow, setUpdateFromRow] = useState<PlanilhaCustoRow | undefined>();
  const [postosRow, setPostosRow] = useState<PlanilhaCustoRow | null>(null);
  const { empresa } = useEmpresaAtiva();

  const { data: rows = [], isLoading } = usePlanilhaCustos();
  const del = useDeletePlanilhaCusto();

  // Contratos ativos (tabela oficial `contratos`) — fonte autoritativa da
  // contagem de contratos. Um contrato ativo sem execução na planilha (ex.:
  // recém-iniciado) conta aqui mas não teria linha vigente; por isso a
  // contagem vem daqui e não do texto distinto das linhas.
  const { data: contratosErp = [] } = useContratosERP();
  const contratosAtivos = React.useMemo(
    () => contratosErp.filter((c) => c.status === "ativo"),
    [contratosErp],
  );

  // Computa status de vigência para cada linha (client-side)
  const statusMap = React.useMemo(() => computeVigenciaStatus(rows), [rows]);

  const filtered = rows.filter((r) => {
    const status = statusMap.get(r.id) ?? "";
    if (!showHistorico && status === "HISTÓRICO" && !filtroVigencia) return false;
    if (filtroVigencia && status !== filtroVigencia) return false;
    if (filtroOrexec && r.orexec !== filtroOrexec) return false;
    return (
      r.cliente.toLowerCase().includes(q.toLowerCase()) ||
      r.contrato.toLowerCase().includes(q.toLowerCase()) ||
      r.posto.toLowerCase().includes(q.toLowerCase())
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  // Reset page when search changes
  const handleSearch = (v: string) => { setQ(v); setPage(1); };

  function openNew() {
    setEditId(null);
    setDrawerOpen(true);
  }

  function openEdit(id: string) {
    setEditId(id);
    setUpdateFromRow(undefined);
    setDrawerOpen(true);
  }

  function openUpdate(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setEditId(null);
    setUpdateFromRow(row);
    setDrawerOpen(true);
  }

  function openView(id: string) {
    setViewId(id);
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir este registro?")) return;
    await del.mutateAsync(id);
    toast.success("Registro excluído.");
  }

  const editRow = editId ? rows.find((r) => r.id === editId) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planilha de Custo"
        breadcrumb={["Licitações", "Planilha de Custo"]}
        subtitle="Base de contratos vigentes com composição de custos por posto."
        actions={
          <>
            <button
              onClick={() => setImportPostosOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
            >
              <MapPin className="h-4 w-4" /> Importar Postos
            </button>
            <button
              onClick={() => setMigracaoOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
            >
              <DatabaseZap className="h-4 w-4" /> Migrar Base Excel
            </button>
            <button
              onClick={openNew}
              className="btn-relief inline-flex h-9 items-center gap-1.5 rounded-md bg-gradient-accent px-3 text-sm font-semibold text-accent-foreground"
            >
              <Plus className="h-4 w-4" /> Inserir Dados
            </button>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-5">
        <Kpi label="Total de registros" v={String(rows.length)} />
        <Kpi label="Empresa ativa" v={empresa.sigla} />
        <Kpi
          label="Contratos ativos"
          v={String(contratosAtivos.length)}
          onClick={() => setContratosOpen(true)}
          clickable
        />
        <Kpi
          label="Postos cadastrados"
          v={String(rows.filter((r) => statusMap.get(r.id) === "EM VIGÊNCIA" && r.orexec === "EXECUTADO").length)}
          onClick={() => setPostosViewOpen(true)}
          clickable
        />
        <Kpi
          label="Clientes distintos"
          v={String(new Set(rows.map((r) => r.cliente)).size)}
          onClick={() => setClientesOpen(true)}
          clickable
        />
      </div>

      {/* Tabela */}
      <div className="card-elevated overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Buscar cliente, contrato ou posto…"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <select
            value={filtroOrexec}
            onChange={(e) => { setFiltroOrexec(e.target.value as typeof filtroOrexec); setPage(1); }}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
          >
            <option value="">Orçado / Executado</option>
            <option value="ORÇADO">Orçado</option>
            <option value="EXECUTADO">Executado</option>
          </select>

          <select
            value={filtroVigencia}
            onChange={(e) => { setFiltroVigencia(e.target.value as typeof filtroVigencia); setPage(1); }}
            className="h-9 rounded-md border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary"
          >
            <option value="">Vigência</option>
            <option value="EM VIGÊNCIA">Em Vigência</option>
            <option value="A INICIAR">A Iniciar</option>
            <option value="HISTÓRICO">Histórico</option>
          </select>

          <button
            onClick={() => { setShowHistorico((v) => !v); setPage(1); }}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
              showHistorico
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
          >
            {showHistorico ? "Ocultar Histórico" : "Exibir Histórico"}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 text-center">Cliente</th>
                <th className="px-4 py-3 text-center">Contrato</th>
                <th className="px-4 py-3 text-center">Posto</th>
                <th className="px-4 py-3 text-center">Serviço</th>
                <th className="px-4 py-3 text-center">Vigência</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Qt. Pessoas</th>
                <th className="px-4 py-3 text-center">Total/Empregado</th>
                <th className="px-4 py-3 text-center">Total Posto</th>
                <th className="px-4 py-3 text-center">Tipo</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                    Carregando…
                  </td>
                </tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                    Nenhum registro cadastrado ainda.
                  </td>
                </tr>
              )}
              {pageRows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 text-center font-medium">{r.cliente}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{r.contrato}</td>
                  <td className="px-4 py-3 text-center">{r.posto}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">{r.servico ?? "—"}</td>
                  <td className="px-4 py-3 text-center text-muted-foreground">
                    {r.data_vigencia
                      ? new Date(r.data_vigencia + "T00:00:00").toLocaleDateString("pt-BR")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <VigenciaStatusBadge status={statusMap.get(r.id) ?? "—"} />
                  </td>
                  <td className="px-4 py-3 text-center">{r.qt_postos}</td>
                  <td className="px-4 py-3 text-center font-mono font-semibold">
                    {formatBRL(r.total_por_empregado)}
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-sm text-muted-foreground">
                    {/* Posto sem ninguém (qt_postos = 0) zera o Total Posto — o
                        Total/Empregado (unitário) continua aparecendo ao lado. */}
                    {formatBRL(r.total_por_empregado * (r.qt_postos || 0))}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                        r.orexec === "EXECUTADO"
                          ? "bg-success-soft text-success"
                          : "bg-info-soft text-info"
                      }`}
                    >
                      {r.orexec ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openView(r.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                        title="Visualizar"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => openEdit(r.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => openUpdate(r.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-warning/10 hover:text-warning"
                        title="Atualizar vigência"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                      {r.orexec === "EXECUTADO" && statusMap.get(r.id) === "EM VIGÊNCIA" && (
                        <button
                          onClick={() => setPostosRow(r)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-primary/10 hover:text-primary"
                          title="Definir postos / localizações"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(r.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Excluir"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} de {filtered.length} registros
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={currentPage === 1}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
              >«</button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
              >‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
                const p = start + i;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded border text-xs font-medium ${
                      p === currentPage
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border hover:bg-muted"
                    }`}
                  >{p}</button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
              >›</button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={currentPage === totalPages}
                className="inline-flex h-7 w-7 items-center justify-center rounded border border-border text-xs hover:bg-muted disabled:opacity-40"
              >»</button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de inserção/edição */}
      <Dialog open={drawerOpen} onOpenChange={(o) => !o && setDrawerOpen(false)}>
        <DialogContent className="max-w-7xl max-h-[92vh] overflow-y-auto p-0">
          {drawerOpen && <FormDrawer editRow={editRow} updateFromRow={updateFromRow} onClose={() => setDrawerOpen(false)} />}
        </DialogContent>
      </Dialog>

      {/* Modal de importação de postos */}
      <Dialog open={importPostosOpen} onOpenChange={(o) => !o && setImportPostosOpen(false)}>
        <DialogContent className="max-w-2xl p-0">
          {importPostosOpen && (
            <ImportPostosModal
              rows={rows}
              empresaId={empresa.id}
              onClose={() => setImportPostosOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de migração em lote */}
      <Dialog open={migracaoOpen} onOpenChange={(o) => !o && setMigracaoOpen(false)}>
        <DialogContent className="max-w-2xl p-0">
          {migracaoOpen && <MigracaoModal rows={rows} onClose={() => setMigracaoOpen(false)} />}
        </DialogContent>
      </Dialog>

      {/* Modal de visualização */}
      <Dialog open={!!viewId} onOpenChange={(o) => !o && setViewId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {viewId && (
            <ViewModal
              row={rows.find((r) => r.id === viewId)!}
              onClose={() => setViewId(null)}
              onEdit={() => { setViewId(null); openEdit(viewId); }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de breakdown por contrato */}
      <Dialog open={contratosOpen} onOpenChange={(o) => !o && setContratosOpen(false)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <ContratosModal rows={rows} statusMap={statusMap} contratosAtivos={contratosAtivos} />
        </DialogContent>
      </Dialog>

      {/* Modal de visão de postos */}
      <Dialog open={postosViewOpen} onOpenChange={(o) => !o && setPostosViewOpen(false)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {postosViewOpen && <PostosViewModal rows={rows} statusMap={statusMap} empresaId={empresa.id} />}
        </DialogContent>
      </Dialog>

      {/* Modal de breakdown por cliente */}
      <Dialog open={clientesOpen} onOpenChange={(o) => !o && setClientesOpen(false)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <ClientesModal rows={rows} statusMap={statusMap} />
        </DialogContent>
      </Dialog>

      {/* Modal de definir postos / localizações */}
      <Dialog open={!!postosRow} onOpenChange={(o) => !o && setPostosRow(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-0">
          {postosRow && (
            <PostosModal
              row={postosRow}
              empresaId={empresa.id}
              onClose={() => setPostosRow(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Modal de Visão de Postos ────────────────────────────────────────────────

function PostosViewModal({
  rows,
  statusMap,
  empresaId,
}: {
  rows: PlanilhaCustoRow[];
  statusMap: Map<string, string>;
  empresaId: string;
}) {
  const [searchContrato, setSearchContrato] = useState("");
  const [search, setSearch] = useState("");
  const [contratoSelecionado, setContratoSelecionado] = useState<string | null>(null);
  const [expandido, setExpandido] = useState<string | null>(null);

  const { data: todasLocalizacoes = [] } = usePlanilhaPostoLocalizacaoAll(empresaId);

  // Apenas EXECUTADO vigente
  const postosVigentes = rows.filter(
    (r) => r.orexec === "EXECUTADO" && statusMap.get(r.id) === "EM VIGÊNCIA"
  );

  // Índice de localizações por planilha_custo_id
  const locByPlanilha = React.useMemo(() => {
    const m = new Map<string, typeof todasLocalizacoes>();
    for (const l of todasLocalizacoes) {
      const arr = m.get(l.planilha_custo_id) ?? [];
      arr.push(l);
      m.set(l.planilha_custo_id, arr);
    }
    return m;
  }, [todasLocalizacoes]);

  // Contratos distintos com contagem de postos
  const contratos = React.useMemo(() => {
    const map = new Map<string, { contrato: string; cliente: string; qtPostos: number; qtPessoas: number }>();
    for (const r of postosVigentes) {
      const existing = map.get(r.contrato);
      if (existing) {
        existing.qtPostos += 1;
        existing.qtPessoas += r.qt_postos || 0;
      } else {
        map.set(r.contrato, { contrato: r.contrato, cliente: r.cliente, qtPostos: 1, qtPessoas: r.qt_postos || 0 });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.contrato.localeCompare(b.contrato));
  }, [postosVigentes]);

  // Seleciona o primeiro contrato por padrão
  React.useEffect(() => {
    if (contratos.length > 0 && !contratoSelecionado) {
      setContratoSelecionado(contratos[0].contrato);
    }
  }, [contratos, contratoSelecionado]);

  // Postos do contrato selecionado, filtrados pela busca
  const postosDoCont = postosVigentes.filter((r) => r.contrato === contratoSelecionado);
  const filteredPostos = postosDoCont.filter(
    (r) =>
      r.posto.toLowerCase().includes(search.toLowerCase()) ||
      r.cliente.toLowerCase().includes(search.toLowerCase())
  );

  const totalPessoas = filteredPostos.reduce((s, r) => s + (r.qt_postos || 0), 0);

  const [leftWidth, setLeftWidth] = React.useState(224);
  const dragging = React.useRef(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  function onMouseDown(e: React.MouseEvent) {
    dragging.current = true;
    e.preventDefault();
    function onMove(ev: MouseEvent) {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newW = Math.min(Math.max(ev.clientX - rect.left, 140), rect.width - 200);
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

  return (
    <div ref={containerRef} className="flex h-[600px]">
      {/* ── Painel esquerdo: lista de contratos ── */}
      <div style={{ width: leftWidth }} className="shrink-0 flex flex-col pr-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Contratos ({contratos.length})
        </p>
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchContrato}
            onChange={(e) => setSearchContrato(e.target.value)}
            placeholder="Buscar contrato…"
            className="h-7 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {contratos.filter((c) =>
            c.contrato.toLowerCase().includes(searchContrato.toLowerCase()) ||
            c.cliente.toLowerCase().includes(searchContrato.toLowerCase())
          ).map((c) => {
            const ativo = contratoSelecionado === c.contrato;
            return (
              <button
                key={c.contrato}
                onClick={() => { setContratoSelecionado(c.contrato); setExpandido(null); setSearch(""); }}
                title={`${c.contrato}\n${c.cliente}`}
                className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                  ativo
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/50 text-foreground"
                }`}
              >
                <p className="text-xs font-semibold truncate leading-snug">{c.contrato}</p>
                <p className={`text-[10px] truncate ${ativo ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {c.cliente}
                </p>
                <p className={`text-[10px] mt-0.5 ${ativo ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {c.qtPostos} posto{c.qtPostos !== 1 ? "s" : ""} · {c.qtPessoas} pessoas
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Divisor arrastável ── */}
      <div
        onMouseDown={onMouseDown}
        className="w-1.5 shrink-0 cursor-col-resize hover:bg-primary/30 transition-colors border-x border-border mx-1"
      />

      {/* ── Painel direito: postos do contrato ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {contratoSelecionado ? (
          <>
            <div className="mb-3 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold truncate">{contratoSelecionado}</h2>
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-success">EXECUTADO VIGENTE</span> · {filteredPostos.length} postos · {totalPessoas} pessoas
                </p>
              </div>
              <div className="relative w-60 shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar posto…"
                  className="h-8 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {filteredPostos.map((r) => {
                const locs = locByPlanilha.get(r.id) ?? [];
                const totalExec = locs.reduce((s, l) => s + l.qt_pessoas_executadas, 0);
                const totalOrc = locs.reduce((s, l) => s + l.qt_pessoas_orcadas, 0);
                const bate = locs.length > 0 && totalExec === r.qt_postos;
                const aberto = expandido === r.id;

                return (
                  <div key={r.id} className="rounded-lg border border-border overflow-hidden">
                    <button
                      onClick={() => setExpandido(aberto ? null : r.id)}
                      className="flex w-full items-start justify-between px-4 py-3 text-left hover:bg-muted/30"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{r.posto}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.cliente}
                          {r.sindicato && <span className="ml-1 opacity-60">· {r.sindicato}</span>}
                        </p>
                        {locs.length === 0 && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground/60 italic">Sem localizações cadastradas</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 ml-4 shrink-0">
                        {locs.length > 0 && (
                          <span className={`text-[11px] font-semibold ${bate ? "text-success" : "text-warning"}`}>
                            {bate ? "✓" : "⚠"} {locs.length} {locs.length > 1 ? "locais" : "local"}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{r.qt_postos} pessoas</span>
                        {aberto ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {aberto && (
                      <div className="border-t border-border bg-muted/20 px-4 py-3 space-y-2">
                        {locs.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">Nenhuma localização cadastrada para este posto.</p>
                        ) : (
                          <>
                            {locs.map((loc) => (
                              <div key={loc.id} className="rounded-md border border-border bg-background px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <MapPin className="h-3.5 w-3.5 shrink-0 text-primary" />
                                      <span className="text-sm font-medium">{loc.nome || "—"}</span>
                                      {loc.periculosidade && (
                                        <span className="inline-flex rounded-full bg-destructive/10 px-1.5 py-0.5 text-[9px] font-bold text-destructive">PERIC.</span>
                                      )}
                                      {loc.insalubridade && (
                                        <span className="inline-flex rounded-full bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold text-warning">INSALUB.</span>
                                      )}
                                    </div>
                                    {(loc.logradouro || loc.municipio) && (
                                      <p className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                                        {[loc.logradouro, loc.numero, loc.bairro, loc.municipio, loc.uf].filter(Boolean).join(", ")}
                                        {loc.cep && ` · CEP ${loc.cep}`}
                                      </p>
                                    )}
                                  </div>
                                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                                    <p>Exec: <strong className="text-foreground">{loc.qt_pessoas_executadas}</strong></p>
                                    <p>Orc: <strong className="text-foreground">{loc.qt_pessoas_orcadas}</strong></p>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-xs">
                              <span className="text-muted-foreground">Total das localizações</span>
                              <div className="flex gap-4">
                                <span>Executado: <strong className={totalExec === r.qt_postos ? "text-success" : "text-warning"}>{totalExec}</strong></span>
                                <span>Orçado: <strong>{totalOrc}</strong></span>
                                <span className="text-muted-foreground">
                                  Planilha: <strong>{r.qt_postos}</strong>{" "}
                                  {totalExec === r.qt_postos ? "✓" : `⚠ dif. ${totalExec - r.qt_postos}`}
                                </span>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredPostos.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">Nenhum posto encontrado.</p>
              )}
            </div>
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Selecione um contrato.</p>
        )}
      </div>
    </div>
  );
}

// ─── Modal de Postos / Localizações ──────────────────────────────────────────

const UFS_LIST = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

const EMPTY_LOC: Omit<PostoLocalizacao, "id" | "empresa_id" | "planilha_custo_id" | "created_at" | "updated_at"> = {
  nome: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  municipio: "",
  uf: "",
  periculosidade: false,
  insalubridade: false,
  lat: null,
  lng: null,
  qt_pessoas_orcadas: 0,
  qt_pessoas_executadas: 0,
};

function PostosModal({
  row,
  empresaId,
  onClose,
}: {
  row: PlanilhaCustoRow;
  empresaId: string;
  onClose: () => void;
}) {
  const { data: localizacoes = [], isLoading } = usePlanilhaPostoLocalizacao(row.id);
  const save = usePostoLocalizacaoSave(row.id);
  const del = usePostoLocalizacaoDelete(row.id);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ ...EMPTY_LOC });
  const [cepLoading, setCepLoading] = useState(false);

  function openNew() {
    setForm({ ...EMPTY_LOC });
    setEditingId("new");
  }

  function openEdit(loc: PostoLocalizacao) {
    setForm({
      nome: loc.nome ?? "",
      cep: loc.cep ?? "",
      logradouro: loc.logradouro ?? "",
      numero: loc.numero ?? "",
      complemento: loc.complemento ?? "",
      bairro: loc.bairro ?? "",
      municipio: loc.municipio ?? "",
      uf: loc.uf ?? "",
      periculosidade: loc.periculosidade,
      insalubridade: loc.insalubridade,
      lat: loc.lat,
      lng: loc.lng,
      qt_pessoas_orcadas: loc.qt_pessoas_orcadas,
      qt_pessoas_executadas: loc.qt_pessoas_executadas,
    });
    setEditingId(loc.id);
  }

  function setF(k: keyof typeof EMPTY_LOC, v: string | number | boolean) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  async function buscarCep(cep: string) {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (data.erro) { toast.error("CEP não encontrado."); return; }
      setForm((p) => ({
        ...p,
        logradouro: data.logradouro || p.logradouro,
        bairro: data.bairro || p.bairro,
        municipio: data.localidade || p.municipio,
        uf: data.uf || p.uf,
        complemento: data.complemento || p.complemento,
      }));
    } catch {
      toast.error("Erro ao buscar CEP.");
    } finally {
      setCepLoading(false);
    }
  }

  async function handleSave() {
    if (!form.nome?.trim()) { toast.error("Informe um nome/descrição para a localização."); return; }
    await save.mutateAsync({
      ...(editingId !== "new" ? { id: editingId! } : {}),
      empresa_id: empresaId,
      planilha_custo_id: row.id,
      ...form,
      nome: form.nome?.trim() || null,
      cep: form.cep?.trim() || null,
      logradouro: form.logradouro?.trim() || null,
      numero: form.numero?.trim() || null,
      complemento: form.complemento?.trim() || null,
      bairro: form.bairro?.trim() || null,
      municipio: form.municipio?.trim() || null,
      uf: form.uf?.trim() || null,
    });
    setEditingId(null);
  }

  const totalOrcado = localizacoes.reduce((s, l) => s + l.qt_pessoas_orcadas, 0);
  const totalExecutado = localizacoes.reduce((s, l) => s + l.qt_pessoas_executadas, 0);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Localizações do Posto</h2>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {row.posto} · {row.contrato} · {row.cliente}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Qt. pessoas (planilha): <strong>{row.qt_postos}</strong>
          </p>
        </div>
      </div>

      {/* Lista de localizações */}
      <div className="px-6 py-4 space-y-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        )}

        {!isLoading && localizacoes.length === 0 && editingId === null && (
          <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Nenhuma localização cadastrada ainda.
          </div>
        )}

        {localizacoes.map((loc) => (
          <div key={loc.id} className="rounded-lg border border-border bg-card">
            {editingId === loc.id ? (
              <LocForm
                form={form}
                setF={setF}
                cepLoading={cepLoading}
                buscarCep={buscarCep}
                onSave={handleSave}
                onCancel={() => setEditingId(null)}
                saving={save.isPending}
              />
            ) : (
              <div className="flex items-start justify-between px-4 py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{loc.nome || "—"}</p>
                  {(loc.logradouro || loc.municipio) && (
                    <p className="text-xs text-muted-foreground">
                      {[loc.logradouro, loc.numero, loc.bairro, loc.municipio, loc.uf].filter(Boolean).join(", ")}
                      {loc.cep && ` · CEP ${loc.cep}`}
                    </p>
                  )}
                  <div className="flex items-center gap-3 pt-1">
                    {loc.periculosidade && (
                      <span className="inline-flex rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                        PERICULOSIDADE
                      </span>
                    )}
                    {loc.insalubridade && (
                      <span className="inline-flex rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-warning">
                        INSALUBRIDADE
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      Orçado: <strong>{loc.qt_pessoas_orcadas}</strong> · Executado: <strong>{loc.qt_pessoas_executadas}</strong>
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-3">
                  <button
                    onClick={() => openEdit(loc)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      if (!confirm("Remover esta localização?")) return;
                      del.mutate(loc.id);
                    }}
                    className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Remover"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Formulário nova localização */}
        {editingId === "new" && (
          <div className="rounded-lg border border-primary/30 bg-card">
            <LocForm
              form={form}
              setF={setF}
              cepLoading={cepLoading}
              buscarCep={buscarCep}
              onSave={handleSave}
              onCancel={() => setEditingId(null)}
              saving={save.isPending}
            />
          </div>
        )}

        {editingId === null && (
          <button
            onClick={openNew}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-dashed border-border px-4 text-sm font-medium text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="h-4 w-4" /> Adicionar localização
          </button>
        )}

        {/* Totais */}
        {localizacoes.length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-6 text-sm">
              <span className="text-muted-foreground">
                Totais das localizações:
              </span>
              <span>
                Orçado: <strong className="text-info">{totalOrcado}</strong>
              </span>
              <span>
                Executado: <strong className="text-success">{totalExecutado}</strong>
              </span>
              {totalOrcado !== row.qt_postos && (
                <span className="text-xs text-warning font-medium">
                  ⚠ Orçado ({totalOrcado}) difere da planilha ({row.qt_postos} pessoas)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end border-t border-border px-6 py-4">
        <button
          onClick={onClose}
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}

function LocForm({
  form,
  setF,
  cepLoading,
  buscarCep,
  onSave,
  onCancel,
  saving,
}: {
  form: typeof EMPTY_LOC;
  setF: (k: keyof typeof EMPTY_LOC, v: string | number | boolean) => void;
  cepLoading: boolean;
  buscarCep: (cep: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  function inp(k: keyof typeof EMPTY_LOC, label: string, placeholder = "") {
    return (
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <input
          type="text"
          value={(form[k] as string) ?? ""}
          onChange={(e) => setF(k, e.target.value)}
          placeholder={placeholder}
          className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-3">
          {inp("nome", "Nome / Descrição *", "Ex: Sede Central, Bloco A...")}
        </div>

        {/* CEP com busca automática */}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            CEP
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={(form.cep as string) ?? ""}
              onChange={(e) => setF("cep", e.target.value)}
              onBlur={(e) => buscarCep(e.target.value)}
              placeholder="00000-000"
              maxLength={9}
              className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => buscarCep(form.cep as string)}
              disabled={cepLoading}
              title="Buscar CEP"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background hover:bg-muted disabled:opacity-50"
            >
              {cepLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div className="col-span-2">{inp("logradouro", "Logradouro")}</div>
        {inp("numero", "Número")}
        {inp("complemento", "Complemento")}
        {inp("bairro", "Bairro")}
        {inp("municipio", "Município")}

        {/* UF select */}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            UF
          </label>
          <select
            value={(form.uf as string) ?? ""}
            onChange={(e) => setF("uf", e.target.value)}
            className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
          >
            <option value="">—</option>
            {UFS_LIST.map((uf) => <option key={uf} value={uf}>{uf}</option>)}
          </select>
        </div>

        {/* Pessoas */}
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Qt. Pessoas Orçadas
          </label>
          <input
            type="number"
            min={0}
            value={(form.qt_pessoas_orcadas as number) ?? 0}
            onChange={(e) => setF("qt_pessoas_orcadas", parseInt(e.target.value) || 0)}
            className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Qt. Pessoas Executadas
          </label>
          <input
            type="number"
            min={0}
            value={(form.qt_pessoas_executadas as number) ?? 0}
            onChange={(e) => setF("qt_pessoas_executadas", parseInt(e.target.value) || 0)}
            className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
          />
        </div>

        {/* Toggles */}
        <div className="col-span-3 flex gap-6 pt-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setF("periculosidade", !(form.periculosidade as boolean))}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${form.periculosidade ? "bg-destructive" : "bg-muted-foreground/30"}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.periculosidade ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
            <span className={form.periculosidade ? "font-semibold text-destructive" : "text-muted-foreground"}>
              Periculosidade
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => setF("insalubridade", !(form.insalubridade as boolean))}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${form.insalubridade ? "bg-warning" : "bg-muted-foreground/30"}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.insalubridade ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </button>
            <span className={form.insalubridade ? "font-semibold text-warning" : "text-muted-foreground"}>
              Insalubridade
            </span>
          </label>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-8 items-center rounded border border-border px-3 text-xs font-medium hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Salvar
        </button>
      </div>
    </div>
  );
}

// ─── Modal de Breakdown por Contrato ─────────────────────────────────────────

function ContratosModal({ rows, statusMap, contratosAtivos }: { rows: PlanilhaCustoRow[]; statusMap: Map<string, string>; contratosAtivos: { id: string; nome: string; cliente: string }[] }) {
  const [search, setSearch] = useState("");
  const [expandido, setExpandido] = useState<string | null>(null);
  const [encerrandoContrato, setEncerrandoContrato] = useState<string | null>(null);
  const [dataEncerramento, setDataEncerramento] = useState("");
  const [justificandoContrato, setJustificandoContrato] = useState<string | null>(null);
  const [textoJustificativa, setTextoJustificativa] = useState("");
  const encerrar = useEncerrarContrato();
  const salvarJustificativa = useSalvarJustificativaDivergencia();

  // Apenas linhas vigentes para o resumo financeiro
  const rowsVigentes = rows.filter((r) => statusMap.get(r.id) === "EM VIGÊNCIA");

  type ContratoItem = {
    cliente: string; contrato: string;
    orcado: number; executado: number; postos_exec: number;
    postoRows: PlanilhaCustoRow[];
    justificativas: JustificativaEntry[];
  };

  const byContrato = rowsVigentes.reduce<Record<string, ContratoItem>>((acc, r) => {
    const key = r.contrato;
    if (!acc[key]) acc[key] = { cliente: r.cliente, contrato: r.contrato, orcado: 0, executado: 0, postos_exec: 0, postoRows: [], justificativas: r.justificativa_divergencia ?? [] };
    const total = r.total_por_empregado * (r.qt_postos || 0);
    if (r.orexec === "EXECUTADO") { acc[key].executado += total; acc[key].postos_exec += r.qt_postos || 0; }
    else acc[key].orcado += total;
    acc[key].postoRows.push(r);
    return acc;
  }, {});

  // Inclui contratos ATIVOS que não têm nenhuma linha vigente executada (ex.:
  // recém-iniciados, sem execução lançada) com R$ 0 — para o breakdown bater
  // com o KPI "Contratos ativos" e sinalizar a lacuna. Identifica os "já com
  // execução" pelo contrato_id (não pelo texto), pra não duplicar por
  // pequenas diferenças de grafia.
  const idsComVigente = new Set(rowsVigentes.map((r) => r.contrato_id).filter(Boolean));
  for (const c of contratosAtivos) {
    if (!idsComVigente.has(c.id) && !byContrato[c.nome]) {
      byContrato[c.nome] = { cliente: c.cliente, contrato: c.nome, orcado: 0, executado: 0, postos_exec: 0, postoRows: [], justificativas: [] };
    }
  }

  const lista = Object.values(byContrato)
    .filter((c) =>
      c.contrato.toLowerCase().includes(search.toLowerCase()) ||
      c.cliente.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => a.contrato.localeCompare(b.contrato, "pt-BR", { sensitivity: "base" }));

  const totalOrcado = lista.reduce((s, c) => s + c.orcado, 0);
  const totalExecutado = lista.reduce((s, c) => s + c.executado, 0);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold">Breakdown por Contrato</h2>
        <p className="text-xs text-muted-foreground">Total × Postos por contrato · apenas registros <span className="font-semibold text-success">VIGENTES</span> · clique em ⚠ para ver divergências por posto</p>
      </div>

      <div className="relative mb-3 w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar contrato ou cliente…"
          className="h-8 w-full rounded border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left">Cliente</th>
              <th className="px-3 py-2 text-left">Contrato</th>
              <th className="px-3 py-2 text-right">Postos</th>
              <th className="px-3 py-2 text-right">Orçado</th>
              <th className="px-3 py-2 text-right">Executado</th>
              <th className="px-3 py-2 text-right">Diferença</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const diff = c.executado - c.orcado;
              const temDivergencia = c.orcado > 0 && c.executado > 0 && Math.abs(diff) > 0.01;
              const aberto = expandido === c.contrato;

              // Monta drill-down por posto
              const porPosto = c.postoRows.reduce<Record<string, { posto: string; orcado: number; executado: number; postos_orc: number; postos_exec: number }>>((a, r) => {
                if (!a[r.posto]) a[r.posto] = { posto: r.posto, orcado: 0, executado: 0, postos_orc: 0, postos_exec: 0 };
                const t = r.total_por_empregado * (r.qt_postos || 0);
                if (r.orexec === "EXECUTADO") { a[r.posto].executado += t; a[r.posto].postos_exec += r.qt_postos || 0; }
                else { a[r.posto].orcado += t; a[r.posto].postos_orc += r.qt_postos || 0; }
                return a;
              }, {});
              const postoLista = Object.values(porPosto);

              return (
                <React.Fragment key={c.contrato}>
                  <tr className={`border-t border-border hover:bg-muted/20 ${aberto ? "bg-muted/10" : ""}`}>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{c.cliente}</td>
                    <td className="px-3 py-2 text-sm font-medium">
                      {c.contrato}
                      {c.postoRows.length === 0 && (
                        <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">sem execução</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">{c.postos_exec || "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-info">{c.orcado ? formatBRL(c.orcado) : "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-success">{c.executado ? formatBRL(c.executado) : "—"}</td>
                    <td className={`px-3 py-2 text-right font-mono text-xs font-semibold whitespace-nowrap ${diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                      {c.orcado && c.executado ? (diff > 0 ? "+" : "") + formatBRL(diff) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {temDivergencia && (
                          <>
                            <button
                              onClick={() => setExpandido(aberto ? null : c.contrato)}
                              title="Ver divergência por posto"
                              className={`inline-flex h-7 min-w-[80px] items-center justify-center gap-1 whitespace-nowrap rounded px-2 text-[11px] font-medium transition-colors ${aberto ? "bg-warning/20 text-warning-foreground" : "bg-warning/10 text-warning hover:bg-warning/20"}`}
                            >
                              ⚠ Detalhes
                            </button>
                            <button
                              onClick={() => { setJustificandoContrato(c.contrato); setTextoJustificativa(""); }}
                              title="Justificar divergência"
                              className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded border border-muted px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
                            >
                              Justificar
                            </button>
                          </>
                        )}
                        {c.postoRows.length > 0 && (
                          <button
                            onClick={() => { setEncerrandoContrato(c.contrato); setDataEncerramento(""); }}
                            title="Encerrar contrato"
                            className="inline-flex h-7 items-center justify-center gap-1 whitespace-nowrap rounded border border-destructive/30 px-2 text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            Encerrar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {aberto && (
                    <tr className="border-t border-warning/20 bg-warning/5">
                      <td colSpan={7} className="px-6 py-3">
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-warning">Divergência por posto</p>
                        {c.justificativas.length > 0 && (
                          <div className="mb-3 space-y-1 rounded border border-muted bg-background/60 p-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Justificativas</p>
                            {c.justificativas.map((j, i) => (
                              <div key={i} className="text-[11px] text-muted-foreground">
                                <span className="font-semibold text-foreground">{j.usuario}</span>
                                <span className="mx-1 opacity-50">·</span>
                                <span className="opacity-60">{j.ts}</span>
                                <span className="mx-1 opacity-50">—</span>
                                {j.texto}
                              </div>
                            ))}
                          </div>
                        )}
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-[10px] font-semibold uppercase text-muted-foreground">
                              <th className="pb-1 text-left">Posto</th>
                              <th className="pb-1 text-right">Postos Orc.</th>
                              <th className="pb-1 text-right">Postos Exec.</th>
                              <th className="pb-1 text-right">Orçado</th>
                              <th className="pb-1 text-right">Executado</th>
                              <th className="pb-1 text-right">Diferença</th>
                            </tr>
                          </thead>
                          <tbody>
                            {postoLista.map((p) => {
                              const d = p.executado - p.orcado;
                              const diverge = Math.abs(d) > 0.01;
                              const postoDiverge = p.postos_orc !== p.postos_exec && p.postos_orc > 0 && p.postos_exec > 0;
                              return (
                                <tr key={p.posto} className={diverge ? "font-medium" : "text-muted-foreground"}>
                                  <td className="py-0.5">{p.posto}</td>
                                  <td className={`py-0.5 text-right ${postoDiverge ? "text-warning font-semibold" : ""}`}>{p.postos_orc || "—"}</td>
                                  <td className={`py-0.5 text-right ${postoDiverge ? "text-warning font-semibold" : ""}`}>{p.postos_exec || "—"}</td>
                                  <td className="py-0.5 text-right font-mono text-info">{p.orcado ? formatBRL(p.orcado) : "—"}</td>
                                  <td className="py-0.5 text-right font-mono text-success">{p.executado ? formatBRL(p.executado) : "—"}</td>
                                  <td className={`py-0.5 text-right font-mono whitespace-nowrap ${d > 0 ? "text-success" : d < 0 ? "text-destructive" : ""}`}>
                                    {diverge ? (d > 0 ? "+" : "") + formatBRL(d) : "—"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-border bg-muted/30">
            <tr className="text-[11px] font-bold uppercase tracking-wider">
              <td colSpan={3} className="px-3 py-2">Total ({lista.length} contratos)</td>
              <td className="px-3 py-2 text-right font-mono text-info">{formatBRL(totalOrcado)}</td>
              <td className="px-3 py-2 text-right font-mono text-success">{formatBRL(totalExecutado)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{formatBRL(totalExecutado - totalOrcado)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Mini-modal de justificativa */}
      <Dialog open={!!justificandoContrato} onOpenChange={(o) => !o && setJustificandoContrato(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Justificar Divergência</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1 font-medium">{justificandoContrato}</p>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Descreva o motivo da divergência entre orçado e executado.
          </p>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Justificativa <span className="text-destructive">*</span>
            </label>
            <textarea
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              rows={4}
              placeholder="Descreva o motivo da divergência…"
              value={textoJustificativa}
              onChange={(e) => setTextoJustificativa(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => setJustificandoContrato(null)}
              className="rounded border border-input px-3 py-1.5 text-sm hover:bg-muted/40 transition-colors"
            >
              Cancelar
            </button>
            <button
              disabled={!textoJustificativa.trim() || salvarJustificativa.isPending}
              onClick={() => {
                const contrato = justificandoContrato!;
                const rowsDoContrato = rows.filter((r) => r.contrato === contrato);
                salvarJustificativa.mutate(
                  { contrato, texto: textoJustificativa.trim(), rowsDoContrato },
                  { onSuccess: () => { setJustificandoContrato(null); setTextoJustificativa(""); } }
                );
              }}
              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {salvarJustificativa.isPending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mini-modal de encerramento */}
      <Dialog open={!!encerrandoContrato} onOpenChange={(o) => !o && setEncerrandoContrato(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Encerrar Contrato</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1 font-medium">{encerrandoContrato}</p>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Todos os registros deste contrato serão marcados como <strong>HISTÓRICO</strong>. Informe a data de encerramento.
          </p>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Data de Encerramento <span className="text-destructive">*</span>
            </label>
            <input
              type="date"
              value={dataEncerramento}
              onChange={(e) => setDataEncerramento(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEncerrandoContrato(null)}
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              disabled={!dataEncerramento || encerrar.isPending}
              onClick={async () => {
                if (!encerrandoContrato || !dataEncerramento) return;
                await encerrar.mutateAsync({ contrato: encerrandoContrato, data_encerramento: dataEncerramento });
                toast.success(`Contrato "${encerrandoContrato}" encerrado.`);
                setEncerrandoContrato(null);
              }}
              className="inline-flex h-9 items-center rounded-md bg-destructive px-4 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              {encerrar.isPending ? "Encerrando…" : "Confirmar Encerramento"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Modal de Breakdown por Cliente ──────────────────────────────────────────

function ClientesModal({ rows, statusMap }: { rows: PlanilhaCustoRow[]; statusMap: Map<string, string> }) {
  const [search, setSearch] = useState("");

  const rowsVigentes = rows.filter((r) => statusMap.get(r.id) === "EM VIGÊNCIA");

  const byCliente = rowsVigentes.reduce<Record<string, {
    cliente: string; contratos: Set<string>;
    orcado: number; executado: number; postos: number;
  }>>((acc, r) => {
    const key = r.cliente;
    if (!acc[key]) acc[key] = { cliente: r.cliente, contratos: new Set(), orcado: 0, executado: 0, postos: 0 };
    const total = r.total_por_empregado * (r.qt_postos || 0);
    if (r.orexec === "EXECUTADO") acc[key].executado += total;
    else acc[key].orcado += total;
    acc[key].postos += r.qt_postos || 0;
    acc[key].contratos.add(r.contrato);
    return acc;
  }, {});

  const lista = Object.values(byCliente)
    .filter((c) => c.cliente.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (b.executado || b.orcado) - (a.executado || a.orcado));

  const totalOrcado = lista.reduce((s, c) => s + c.orcado, 0);
  const totalExecutado = lista.reduce((s, c) => s + c.executado, 0);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-base font-semibold">Breakdown por Cliente</h2>
        <p className="text-xs text-muted-foreground">Total × Postos agrupado por cliente · apenas registros <span className="font-semibold text-success">VIGENTES</span> · Orçado e Executado separados</p>
      </div>

      <div className="relative mb-3 w-full max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar cliente…"
          className="h-8 w-full rounded border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-primary" />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-3 py-2 text-left">Cliente</th>
              <th className="px-3 py-2 text-right">Contratos</th>
              <th className="px-3 py-2 text-right">Postos</th>
              <th className="px-3 py-2 text-right">Orçado</th>
              <th className="px-3 py-2 text-right">Executado</th>
              <th className="px-3 py-2 text-right">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((c) => {
              const diff = c.executado - c.orcado;
              return (
                <tr key={c.cliente} className="border-t border-border hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{c.cliente}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">{c.contratos.size}</td>
                  <td className="px-3 py-2 text-right text-xs">{c.postos}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-info">{c.orcado ? formatBRL(c.orcado) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-success">{c.executado ? formatBRL(c.executado) : "—"}</td>
                  <td className={`px-3 py-2 text-right font-mono text-xs font-semibold whitespace-nowrap ${diff > 0 ? "text-success" : diff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                    {c.orcado && c.executado ? (diff > 0 ? "+" : "") + formatBRL(diff) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-border bg-muted/30">
            <tr className="text-[11px] font-bold uppercase tracking-wider">
              <td colSpan={3} className="px-3 py-2">Total ({lista.length} clientes)</td>
              <td className="px-3 py-2 text-right font-mono text-info">{formatBRL(totalOrcado)}</td>
              <td className="px-3 py-2 text-right font-mono text-success">{formatBRL(totalExecutado)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold">{formatBRL(totalExecutado - totalOrcado)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

// ─── Combobox de Contrato ─────────────────────────────────────────────────────
// Troca o antigo campo de texto livre por seleção da tabela `contratos`: ao
// escolher, o pai grava `contrato_id` (a FK) na origem — fim do casamento por
// texto (fantasmas, de-para por nome, contrato_id vazio no import). Mostra o
// texto atual mesmo quando não casa com nenhum contrato (linhas legadas), sem
// perder o valor.
function ContratoCombobox({
  nome, contratoId, onPick,
}: {
  nome: string;
  contratoId: string | null;
  onPick: (c: ContratoERP | null) => void;
}) {
  const { data: contratos = [] } = useContratosERP();
  const [aberto, setAberto] = useState(false);
  const opcoes = [...contratos].sort(
    (a, b) =>
      (a.status === "ativo" ? 0 : 1) - (b.status === "ativo" ? 0 : 1) ||
      a.nome.localeCompare(b.nome, "pt-BR"),
  );

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          className="flex h-8 w-full items-center justify-between rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
        >
          <span className={cn("truncate", !nome && "text-muted-foreground")}>
            {nome || "Selecionar contrato…"}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar contrato ou cliente…" />
          <CommandList>
            <CommandEmpty>Nenhum contrato encontrado.</CommandEmpty>
            <CommandGroup>
              {opcoes.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${c.nome} ${c.cliente}`}
                  onSelect={() => { onPick(c); setAberto(false); }}
                >
                  <Check className={cn("mr-2 h-4 w-4 shrink-0", contratoId === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{c.nome}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.cliente}{c.status !== "ativo" ? ` · ${c.status}` : ""}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Drawer do formulário ─────────────────────────────────────────────────────

function FormDrawer({
  editRow,
  updateFromRow,
  onClose,
}: {
  editRow?: PlanilhaCustoRow;
  updateFromRow?: PlanilhaCustoRow;
  onClose: () => void;
}) {
  const save = useSavePlanilhaCusto();
  const { empresa } = useEmpresaAtiva();
  const fileRef = useRef<HTMLInputElement>(null);

  // updateFromRow = clonar registro com nova vigência (INSERT, sem id)
  const sourceRow = editRow ?? updateFromRow;

  const [form, setForm] = useState<FormData>(() =>
    sourceRow
      ? {
          orexec: sourceRow.orexec, cliente: sourceRow.cliente, contrato: sourceRow.contrato,
          posto: sourceRow.posto, servico: sourceRow.servico ?? "", sindicato: sourceRow.sindicato ?? "",
          // No modo atualização (updateFromRow), data_vigencia fica vazia para o usuário preencher obrigatoriamente
          data_vigencia: editRow ? (sourceRow.data_vigencia ?? "") : "",
          qt_postos: sourceRow.qt_postos,
          arquivo_origem: sourceRow.arquivo_origem ?? "",
          contrato_id: sourceRow.contrato_id, justificativa_divergencia: sourceRow.justificativa_divergencia,
          salario: sourceRow.salario, insalubridade: sourceRow.insalubridade,
          periculosidade: sourceRow.periculosidade, lideranca: sourceRow.lideranca,
          adicional_noturno_reduzido: sourceRow.adicional_noturno_reduzido,
          adicional_noturno: sourceRow.adicional_noturno, adicional_extra: sourceRow.adicional_extra,
          dsr: sourceRow.dsr, decimo_terceiro: sourceRow.decimo_terceiro,
          adicional_ferias: sourceRow.adicional_ferias, incidencia_enc_41: sourceRow.incidencia_enc_41,
          inss: sourceRow.inss, salario_educacao: sourceRow.salario_educacao, rat_fap: sourceRow.rat_fap,
          sesi: sourceRow.sesi, senai: sourceRow.senai, sebrae: sourceRow.sebrae, incra: sourceRow.incra,
          fgts: sourceRow.fgts, seguro_acidente_trabalho: sourceRow.seguro_acidente_trabalho,
          transporte: sourceRow.transporte, transporte_desconto: sourceRow.transporte_desconto,
          aux_alimentacao: sourceRow.aux_alimentacao,
          aux_alimentacao_desconto: sourceRow.aux_alimentacao_desconto,
          aux_refeicao: sourceRow.aux_refeicao, beneficio_familiar: sourceRow.beneficio_familiar,
          aux_lanche: sourceRow.aux_lanche, seguro_vida: sourceRow.seguro_vida,
          abono_indenizatorio: sourceRow.abono_indenizatorio, aux_educacao: sourceRow.aux_educacao,
          cesta_basica: sourceRow.cesta_basica, assistencia_medica: sourceRow.assistencia_medica,
          hospedagem: sourceRow.hospedagem, odontologico: sourceRow.odontologico,
          manutencao_profissional: sourceRow.manutencao_profissional, cafe: sourceRow.cafe,
          almoco: sourceRow.almoco, janta: sourceRow.janta, ceia: sourceRow.ceia,
          funeral: sourceRow.funeral, assiduidade: sourceRow.assiduidade,
          beneficio_trabalhador: sourceRow.beneficio_trabalhador, patronal: sourceRow.patronal,
          fundo_assistencial: sourceRow.fundo_assistencial, fundo_profissional: sourceRow.fundo_profissional,
          natalidade: sourceRow.natalidade, deducoes: sourceRow.deducoes,
          outros_1: sourceRow.outros_1, outros_1_descricao: sourceRow.outros_1_descricao ?? "",
          outros_2: sourceRow.outros_2, outros_2_descricao: sourceRow.outros_2_descricao ?? "",
          outros_3: sourceRow.outros_3, outros_3_descricao: sourceRow.outros_3_descricao ?? "",
          aviso_indenizado: sourceRow.aviso_indenizado, incidencia_fgts: sourceRow.incidencia_fgts,
          multa_rescisoria: sourceRow.multa_rescisoria, aviso_trabalhado: sourceRow.aviso_trabalhado,
          incidencia_aviso_trabalhado: sourceRow.incidencia_aviso_trabalhado,
          multa_aviso_indenizado: sourceRow.multa_aviso_indenizado,
          contratualidade: sourceRow.contratualidade, sub_ferias: sourceRow.sub_ferias,
          sub_ausencias_legais: sourceRow.sub_ausencias_legais,
          sub_paternidade: sourceRow.sub_paternidade,
          sub_acidente_trabalho: sourceRow.sub_acidente_trabalho,
          sub_maternidade: sourceRow.sub_maternidade, sub_doenca: sourceRow.sub_doenca,
          sub_repouso: sourceRow.sub_repouso, incidencia_maternidade: sourceRow.incidencia_maternidade,
          incidencia_enc_reposicao: sourceRow.incidencia_enc_reposicao,
          incidencia_enc_reposicao_2: sourceRow.incidencia_enc_reposicao_2,
          incidencia_enc_reposicao_3: sourceRow.incidencia_enc_reposicao_3,
          incidencia_enc_reposicao_4: sourceRow.incidencia_enc_reposicao_4,
          uniforme: sourceRow.uniforme, epi: sourceRow.epi, epc: sourceRow.epc,
          materiais: sourceRow.materiais, equipamentos: sourceRow.equipamentos,
          relogio_digital: sourceRow.relogio_digital, ponto_eletronico: sourceRow.ponto_eletronico,
          outros_insumos: sourceRow.outros_insumos, custos_indiretos: sourceRow.custos_indiretos,
          lucro: sourceRow.lucro, cofins: sourceRow.cofins, pis: sourceRow.pis,
          irpj_csll: sourceRow.irpj_csll, iss: sourceRow.iss,
          total_por_empregado: sourceRow.total_por_empregado,
        }
      : { ...EMPTY_FORM },
  );

  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  function set(k: keyof FormData, v: string | number | null) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function numField(k: keyof FormData, label: string, span = 1) {
    return (
      <div className={span > 1 ? `col-span-${span}` : ""}>
        <label className="mb-1 flex min-h-[2rem] items-end text-[10px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
          {label}
        </label>
        <CurrencyInput
          value={String(form[k] as number ?? 0)}
          onChange={(v) => set(k, parseFloat(v) || 0)}
          className="h-8 text-sm"
        />
      </div>
    );
  }

  function textField(k: keyof FormData, label: string, span = 1) {
    return (
      <div className={span > 1 ? `col-span-${span}` : ""}>
        <label className="mb-1 flex min-h-[2rem] items-end text-[10px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
          {label}
        </label>
        <input
          type="text"
          value={(form[k] as string) ?? ""}
          onChange={(e) => set(k, e.target.value)}
          className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
        />
      </div>
    );
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingFile(file);

    // Detectar abas antes de importar
    setImporting(true);
    try {
      const result = await importarPlanilha(file);
      if (result.sheetNames.length > 1) {
        setSheetNames(result.sheetNames);
        setSelectedSheet(result.sheetNames[0]);
        // Já importa a primeira aba
        applyImported(result, file.name);
      } else {
        applyImported(result, file.name);
      }
    } catch (err: any) {
      toast.error("Erro ao importar planilha: " + err.message);
    } finally {
      setImporting(false);
    }
  }

  async function handleSheetSelect(sheetName: string) {
    if (!pendingFile) return;
    setSelectedSheet(sheetName);
    setImporting(true);
    try {
      const result = await importarPlanilha(pendingFile, sheetName);
      applyImported(result, pendingFile.name);
    } catch (err: any) {
      toast.error("Erro ao importar aba: " + err.message);
    } finally {
      setImporting(false);
    }
  }

  function applyImported(r: PlanilhaCustoImportada, fileName: string) {
    setForm((prev) => ({
      ...prev,
      arquivo_origem: fileName,
      salario: r.salario,
      insalubridade: r.insalubridade,
      periculosidade: r.periculosidade,
      lideranca: r.lideranca,
      adicional_noturno_reduzido: r.adicional_noturno_reduzido,
      adicional_noturno: r.adicional_noturno,
      adicional_extra: r.adicional_extra,
      dsr: r.dsr,
      decimo_terceiro: r.decimo_terceiro,
      adicional_ferias: r.adicional_ferias,
      incidencia_enc_41: r.incidencia_enc_41,
      inss: r.inss,
      salario_educacao: r.salario_educacao,
      rat_fap: r.rat_fap,
      sesi: r.sesi,
      senai: r.senai,
      sebrae: r.sebrae,
      incra: r.incra,
      fgts: r.fgts,
      seguro_acidente_trabalho: r.seguro_acidente_trabalho,
      transporte: r.transporte,
      transporte_desconto: r.transporte_desconto,
      aux_alimentacao: r.aux_alimentacao,
      aux_alimentacao_desconto: r.aux_alimentacao_desconto,
      aux_refeicao: r.aux_refeicao,
      beneficio_familiar: r.beneficio_familiar,
      aux_lanche: r.aux_lanche,
      seguro_vida: r.seguro_vida,
      abono_indenizatorio: r.abono_indenizatorio,
      aux_educacao: r.aux_educacao,
      cesta_basica: r.cesta_basica,
      assistencia_medica: r.assistencia_medica,
      hospedagem: r.hospedagem,
      odontologico: r.odontologico,
      manutencao_profissional: r.manutencao_profissional,
      cafe: r.cafe,
      almoco: r.almoco,
      janta: r.janta,
      ceia: r.ceia,
      funeral: r.funeral,
      assiduidade: r.assiduidade,
      beneficio_trabalhador: r.beneficio_trabalhador,
      patronal: r.patronal,
      fundo_assistencial: r.fundo_assistencial,
      fundo_profissional: r.fundo_profissional,
      natalidade: r.natalidade,
      deducoes: r.deducoes,
      aviso_indenizado: r.aviso_indenizado,
      incidencia_fgts: r.incidencia_fgts,
      multa_rescisoria: r.multa_rescisoria,
      aviso_trabalhado: r.aviso_trabalhado,
      incidencia_aviso_trabalhado: r.incidencia_aviso_trabalhado,
      multa_aviso_indenizado: r.multa_aviso_indenizado,
      contratualidade: r.contratualidade,
      sub_ferias: r.sub_ferias,
      sub_ausencias_legais: r.sub_ausencias_legais,
      sub_paternidade: r.sub_paternidade,
      sub_acidente_trabalho: r.sub_acidente_trabalho,
      sub_maternidade: r.sub_maternidade,
      sub_doenca: r.sub_doenca,
      sub_repouso: r.sub_repouso,
      incidencia_maternidade: r.incidencia_maternidade,
      incidencia_enc_reposicao: r.incidencia_enc_reposicao,
      incidencia_enc_reposicao_2: r.incidencia_enc_reposicao_2,
      incidencia_enc_reposicao_3: r.incidencia_enc_reposicao_3,
      incidencia_enc_reposicao_4: r.incidencia_enc_reposicao_4,
      uniforme: r.uniforme,
      epi: r.epi,
      epc: r.epc,
      materiais: r.materiais,
      equipamentos: r.equipamentos,
      relogio_digital: r.relogio_digital,
      ponto_eletronico: r.ponto_eletronico,
      outros_insumos: r.outros_insumos,
      custos_indiretos: r.custos_indiretos,
      lucro: r.lucro,
      cofins: r.cofins,
      pis: r.pis,
      irpj_csll: r.irpj_csll,
      iss: r.iss,
      total_por_empregado: r.total_por_empregado,
    }));
    toast.success(`Planilha "${fileName}" importada. Revise e ajuste os campos.`);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.cliente || !form.contrato || !form.posto) {
      toast.error("Preencha Cliente, Contrato e Posto.");
      return;
    }
    if (updateFromRow && !form.data_vigencia) {
      toast.error("Informe a nova Data de Vigência para registrar a atualização.");
      return;
    }
    try {
      const payload = {
        ...form,
        data_vigencia: form.data_vigencia || null,
        outros_1_descricao: form.outros_1_descricao || null,
        outros_2_descricao: form.outros_2_descricao || null,
        outros_3_descricao: form.outros_3_descricao || null,
        arquivo_origem: form.arquivo_origem || null,
        sindicato: form.sindicato || null,
        servico: form.servico || null,
      };
      await save.mutateAsync({ ...(editRow ? { id: editRow.id } : {}), ...payload });
      toast.success(editRow ? "Registro atualizado." : updateFromRow ? "Nova vigência lançada com sucesso." : "Registro lançado com sucesso.");
      onClose();
    } catch (err: any) {
      toast.error("Erro ao salvar: " + err.message);
    }
  }

  // Totais calculados
  const somaRemuneracao =
    form.salario + form.insalubridade + form.periculosidade + form.lideranca +
    form.adicional_noturno_reduzido + form.adicional_noturno + form.adicional_extra + form.dsr;

  const somaEncargos =
    form.decimo_terceiro + form.adicional_ferias + form.incidencia_enc_41 +
    form.inss + form.salario_educacao + form.rat_fap + form.sesi + form.senai +
    form.sebrae + form.incra + form.fgts + form.seguro_acidente_trabalho;

  const somaBeneficios =
    form.transporte + form.aux_alimentacao + form.aux_refeicao + form.aux_lanche +
    form.beneficio_familiar + form.seguro_vida + form.abono_indenizatorio + form.aux_educacao +
    form.cesta_basica + form.assistencia_medica + form.hospedagem + form.odontologico +
    form.manutencao_profissional + form.cafe + form.almoco + form.janta + form.ceia +
    form.funeral + form.assiduidade + form.beneficio_trabalhador + form.patronal +
    form.fundo_assistencial + form.fundo_profissional + form.natalidade +
    form.outros_1 + form.outros_2 + form.outros_3 + form.aux_alimentacao_desconto + form.transporte_desconto - form.deducoes;

  const somaReposicao =
    form.sub_ferias + form.sub_ausencias_legais + form.sub_paternidade +
    form.sub_acidente_trabalho + form.sub_maternidade + form.sub_doenca + form.sub_repouso +
    form.incidencia_maternidade + form.incidencia_enc_reposicao + form.incidencia_enc_reposicao_2 +
    form.incidencia_enc_reposicao_3 + form.incidencia_enc_reposicao_4;

  const somaRescisao =
    form.aviso_indenizado + form.incidencia_fgts + form.multa_rescisoria +
    form.aviso_trabalhado + form.incidencia_aviso_trabalhado +
    form.multa_aviso_indenizado + form.contratualidade;

  const somaInsumos =
    form.uniforme + form.epi + form.epc + form.materiais + form.equipamentos +
    form.relogio_digital + form.ponto_eletronico + form.outros_insumos;

  const somaCustos =
    form.custos_indiretos + form.lucro + form.cofins + form.pis + form.irpj_csll + form.iss;

  const somaTotal =
    somaRemuneracao + somaEncargos + somaBeneficios + somaReposicao +
    somaRescisao + somaInsumos + somaCustos;

  return (
    <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold">
              {editRow ? "Editar Planilha de Custo" : updateFromRow ? "Atualizar Vigência" : "Inserir Dados"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {updateFromRow
                ? `Clonando: ${updateFromRow.posto} · ${updateFromRow.contrato} — informe a nova data de vigência`
                : "Inclusão e/ou Atualização do Banco de Dados"}
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Building2 className="h-3.5 w-3.5" />
            {empresa.sigla}
          </span>
        </div>

        {/* Botão importar planilha */}
        <div className="border-b border-border bg-muted/30 px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls,.ods,.xlsb"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
              className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <Upload className="h-3.5 w-3.5" />
              {importing ? "Importando…" : "Importar Planilha"}
            </button>

            {sheetNames.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Aba:</span>
                <select
                  value={selectedSheet}
                  onChange={(e) => handleSheetSelect(e.target.value)}
                  className="h-8 rounded border border-border bg-background px-2 text-xs outline-none focus:border-primary"
                >
                  {sheetNames.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            )}

            {form.arquivo_origem && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2.5 py-0.5 text-[11px] font-medium text-success">
                <FileSpreadsheet className="h-3 w-3" />
                {form.arquivo_origem}
              </span>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-4 space-y-5">

            {/* Seção 1 - Cadastro */}
            <Section title="1 — Cadastro do Contrato">
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Orçado / Executado
                  </label>
                  <select
                    value={form.orexec ?? ""}
                    onChange={(e) => set("orexec", e.target.value)}
                    className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="EXECUTADO">EXECUTADO</option>
                    <option value="ORÇADO">ORÇADO</option>
                  </select>
                </div>
                {textField("cliente", "Cliente", 1)}
                <div>
                  <label className="mb-1 flex min-h-[2rem] items-end text-[10px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
                    Contrato
                  </label>
                  <ContratoCombobox
                    nome={form.contrato ?? ""}
                    contratoId={form.contrato_id ?? null}
                    onPick={(c) =>
                      setForm((prev) => ({
                        ...prev,
                        contrato: c?.nome ?? "",
                        contrato_id: c?.id ?? null,
                        // auto-preenche o cliente do contrato escolhido
                        cliente: c ? c.cliente : prev.cliente,
                      }))
                    }
                  />
                </div>
                {textField("posto", "Posto", 1)}
                {textField("servico", "Serviço", 1)}
                {textField("sindicato", "Sindicato", 1)}
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Data de Vigência
                  </label>
                  <input
                    type="date"
                    value={form.data_vigencia ?? ""}
                    onChange={(e) => set("data_vigencia", e.target.value)}
                    className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="mb-1 flex min-h-[2rem] items-end text-[10px] font-semibold uppercase leading-tight tracking-wider text-muted-foreground">
                    Qt. Pessoas
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={form.qt_postos ?? 0}
                    onChange={(e) => set("qt_postos", parseInt(e.target.value) || 0)}
                    className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
                  />
                </div>
              </div>
            </Section>

            {/* Seção 2 - Remuneração */}
            <Section title="2 — Composição da Remuneração" soma={somaRemuneracao}>
              <div className="grid grid-cols-4 gap-4">
                {numField("salario", "Salário Base")}
                {numField("insalubridade", "Insalubridade")}
                {numField("periculosidade", "Periculosidade")}
                {numField("lideranca", "Add. Líder")}
                {numField("adicional_noturno_reduzido", "Add. Not. Reduzida")}
                {numField("adicional_noturno", "Add. Noturno")}
                {numField("adicional_extra", "Add. Horas Extras")}
                {numField("dsr", "DSR")}
              </div>
            </Section>

            {/* Seção 3 - Encargos */}
            <Section title="3 — Encargos Previdenciários, FGTS e Outras" soma={somaEncargos}>
              <div className="grid grid-cols-4 gap-4">
                {numField("decimo_terceiro", "13º Salário")}
                {numField("adicional_ferias", "Add. Férias")}
                {numField("incidencia_enc_41", "Inc. Encargos")}
                {numField("inss", "INSS")}
                {numField("salario_educacao", "Sal. Educação")}
                {numField("rat_fap", "RAT x FAP")}
                {numField("sesi", "SESI/SESC")}
                {numField("senai", "SENAI/SENAC")}
                {numField("sebrae", "SEBRAE")}
                {numField("incra", "INCRA")}
                {numField("fgts", "FGTS")}
                {numField("seguro_acidente_trabalho", "Seg. Acid. Trab.")}
              </div>
            </Section>

            {/* Seção 4 - Benefícios */}
            <Section title="4 — Benefícios Mensais e Diários" soma={somaBeneficios}>
              <div className="grid grid-cols-4 gap-4">
                {numField("transporte", "Transporte")}
                {numField("transporte_desconto", "Dedução VT")}
                {numField("aux_alimentacao", "Aux. Alimentação")}
                {numField("aux_alimentacao_desconto", "Desc. Alimentação")}
                {numField("aux_refeicao", "Aux. Refeição")}
                {numField("aux_lanche", "Aux. Lanche")}
                {numField("beneficio_familiar", "Ben. Sócio Familiar")}
                {numField("seguro_vida", "Seguro de Vida")}
                {numField("abono_indenizatorio", "Abono Indeniz.")}
                {numField("aux_educacao", "Aux. Educação")}
                {numField("cesta_basica", "Cesta Básica")}
                {numField("assistencia_medica", "Assist. Médica")}
                {numField("hospedagem", "Hospedagem")}
                {numField("odontologico", "Médico/Odontológico")}
                {numField("manutencao_profissional", "Manut./Capacit. Prof.")}
                {numField("cafe", "Café")}
                {numField("almoco", "Almoço")}
                {numField("janta", "Janta")}
                {numField("ceia", "Ceia")}
                {numField("funeral", "Aux. Funeral")}
                {numField("assiduidade", "Assiduidade")}
                {numField("beneficio_trabalhador", "Ben. Trabalhador")}
                {numField("patronal", "Assist. Patronal")}
                {numField("fundo_assistencial", "Fundo Assistencial")}
                {numField("fundo_profissional", "Fundo Profissional")}
                {numField("natalidade", "Natalidade")}
                {numField("deducoes", "Deduções")}
              </div>
              <div className="mt-3 grid grid-cols-3 gap-4">
                <div className="flex gap-2">
                  <div className="flex-1">{numField("outros_1", "Outros 1")}</div>
                  <div className="flex-1">{textField("outros_1_descricao", "Descrição 1")}</div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">{numField("outros_2", "Outros 2")}</div>
                  <div className="flex-1">{textField("outros_2_descricao", "Descrição 2")}</div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">{numField("outros_3", "Outros 3")}</div>
                  <div className="flex-1">{textField("outros_3_descricao", "Descrição 3")}</div>
                </div>
              </div>
            </Section>

            {/* Seção 5 - Reposição */}
            <Section title="5 — Custo de Reposição do Profissional Ausente" soma={somaReposicao}>
              <div className="grid grid-cols-4 gap-4">
                {numField("sub_ferias", "Sub. Férias")}
                {numField("sub_ausencias_legais", "Sub. Ausências Legais")}
                {numField("sub_paternidade", "Sub. Paternidade")}
                {numField("sub_acidente_trabalho", "Sub. Acidente Trab.")}
                {numField("sub_maternidade", "Sub. Maternidade")}
                {numField("sub_doenca", "Sub. Doença")}
                {numField("sub_repouso", "Sub. Repouso/Alim.")}
                {numField("incidencia_maternidade", "Inc. Maternidade")}
                {numField("incidencia_enc_reposicao", "Inc. Enc. Repos.")}
                {numField("incidencia_enc_reposicao_2", "Inc. Enc. Repos. 2")}
                {numField("incidencia_enc_reposicao_3", "Inc. Enc. Repos. 3")}
                {numField("incidencia_enc_reposicao_4", "Inc. Enc. Repos. 4")}
              </div>
            </Section>

            {/* Seção 6 - Rescisão */}
            <Section title="6 — Provisão para Rescisão" soma={somaRescisao}>
              <div className="grid grid-cols-4 gap-4">
                {numField("aviso_indenizado", "Aviso Prev. Inden.")}
                {numField("incidencia_fgts", "Inc. FGTS s/ Aviso")}
                {numField("aviso_trabalhado", "Aviso Prev. Trab.")}
                {numField("incidencia_aviso_trabalhado", "Inc. s/ Aviso Trab.")}
                {numField("multa_rescisoria", "Multa Rescisória")}
                {numField("multa_aviso_indenizado", "Multa FGTS Aviso Ind.")}
                {numField("contratualidade", "Multa FGTS Contrat.")}
              </div>
            </Section>

            {/* Seção 7 - Insumos */}
            <Section title="7 — Insumos Diversos" soma={somaInsumos}>
              <div className="grid grid-cols-4 gap-4">
                {numField("uniforme", "Uniformes")}
                {numField("epi", "EPI")}
                {numField("epc", "EPC")}
                {numField("materiais", "Materiais")}
                {numField("equipamentos", "Equipamentos")}
                {numField("ponto_eletronico", "Ponto Eletrônico")}
                {numField("relogio_digital", "Relógio Digital")}
                {numField("outros_insumos", "Outros Insumos")}
              </div>
            </Section>

            {/* Seção 8 - Custos Indiretos */}
            <Section title="8 — Custos Indiretos, Lucro e Tributos" soma={somaCustos}>
              <div className="grid grid-cols-3 gap-3">
                {numField("custos_indiretos", "Custos Indiretos")}
                {numField("lucro", "Lucro")}
                {numField("cofins", "COFINS")}
                {numField("pis", "PIS")}
                {numField("irpj_csll", "IRPJ + CSLL")}
                {numField("iss", "ISS")}
              </div>
            </Section>

            {/* Valor por empregado */}
            <div className="rounded-lg border border-border bg-muted/30 p-4">
              <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Valor por Empregado
              </h4>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1.5">
                  <CompRow label="Grupo 2 — Remuneração" soma={somaRemuneracao} />
                  <CompRow label="Grupos 3 e 4 — Encargos + Benefícios" soma={somaEncargos + somaBeneficios} />
                  <CompRow label="Grupo 5 — Reposição" soma={somaReposicao} />
                  <CompRow label="Grupo 6 — Rescisão" soma={somaRescisao} />
                  <CompRow label="Grupo 7 — Insumos" soma={somaInsumos} />
                  <CompRow label="Grupo 8 — Indireto/Lucro/Tributo" soma={somaCustos} />
                  <div className="border-t border-border pt-1.5">
                    <CompRow label="SOMA TOTAL CALCULADA" soma={somaTotal} highlight />
                  </div>
                </div>
                <div className="flex flex-col justify-end">
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Total p/ Empregado (Planilha)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.total_por_empregado || ""}
                    onChange={(e) => set("total_por_empregado", parseFloat(e.target.value) || 0)}
                    className="h-9 w-full rounded border border-border bg-background px-2 text-right text-base font-semibold outline-none focus:border-primary"
                  />
                  {form.total_por_empregado > 0 && (
                    <p
                      className={`mt-1 text-right text-xs font-medium ${
                        Math.abs(form.total_por_empregado - somaTotal) < 0.1
                          ? "text-success"
                          : "text-destructive"
                      }`}
                    >
                      Diferença: {formatBRL(form.total_por_empregado - somaTotal)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="btn-relief inline-flex h-9 items-center gap-1.5 rounded-md bg-gradient-accent px-5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {save.isPending ? "Salvando…" : "Lançar Banco de Dados"}
            </button>
          </div>
        </form>
    </div>
  );
}

// ─── Modal de Importação de Postos ───────────────────────────────────────────

type PostoImportRow = {
  contrato: string;
  posto: string;
  local: string;
  qt_orcado: number;
  qt_executado: number;
  planilha_custo_ids: string[]; // todas as linhas com mesmo contrato+posto
};

function ImportPostosModal({
  rows,
  empresaId,
  onClose,
}: {
  rows: PlanilhaCustoRow[];
  empresaId: string;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<PostoImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  // índice: "contrato||posto" → lista de todos os planilha_custo_ids (orçado + executado)
  const idxContratoPostoRef = React.useRef<Map<string, string[]>>(new Map());
  React.useEffect(() => {
    const idx = new Map<string, string[]>();
    for (const r of rows) {
      const key = `${r.contrato.trim().toLowerCase()}||${r.posto.trim().toLowerCase()}`;
      const existing = idx.get(key) ?? [];
      idx.set(key, [...existing, r.id]);
    }
    idxContratoPostoRef.current = idx;
  }, [rows]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames.find((s) =>
        s.toLowerCase().includes("posto")
      ) ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      // Detecta linha do cabeçalho buscando "Contrato" ou "Posto"
      let headerRow = 0;
      for (let i = 0; i < Math.min(5, aoa.length); i++) {
        const row = aoa[i] as string[];
        if (row.some((c) => String(c).toLowerCase().includes("contrato"))) {
          headerRow = i;
          break;
        }
      }
      const headers = (aoa[headerRow] as string[]).map((h) => String(h).trim().toLowerCase());
      const col = (name: string) => headers.findIndex((h) => h.includes(name));

      const iContrato = col("contrato");
      const iPosto = col("posto");
      const iLocal = col("local");
      const iOrcado = col("orçado") !== -1 ? col("orçado") : col("orcado");
      const iExecutado = col("executado");

      if (iContrato === -1 || iPosto === -1 || iLocal === -1) {
        toast.error("Colunas Contrato, Posto e Local não encontradas na planilha.");
        return;
      }

      const idx = idxContratoPostoRef.current;
      const result: PostoImportRow[] = [];

      for (let i = headerRow + 1; i < aoa.length; i++) {
        const row = aoa[i] as any[];
        const contrato = String(row[iContrato] ?? "").trim();
        const posto = String(row[iPosto] ?? "").trim();
        const local = String(row[iLocal] ?? "").trim();
        if (!contrato || !posto || !local) continue;

        const key = `${contrato.toLowerCase()}||${posto.toLowerCase()}`;
        const planilha_custo_ids = idx.get(key) ?? [];

        result.push({
          contrato,
          posto,
          local,
          qt_orcado: iOrcado !== -1 ? (parseInt(String(row[iOrcado])) || 0) : 0,
          qt_executado: iExecutado !== -1 ? (parseInt(String(row[iExecutado])) || 0) : 0,
          planilha_custo_ids,
        });
      }

      setParsed(result);
    } catch (err: any) {
      toast.error("Erro ao ler arquivo: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  const vinculados = parsed.filter((r) => r.planilha_custo_ids.length > 0);
  const semVinculo = parsed.filter((r) => r.planilha_custo_ids.length === 0);

  async function handleImport() {
    if (!vinculados.length) return;
    setImporting(true);
    try {
      // gera uma entrada para cada planilha_custo_id (orçado + executado)
      const payload = vinculados.flatMap((r) =>
        r.planilha_custo_ids.map((pid) => ({
          empresa_id: empresaId,
          planilha_custo_id: pid,
          nome: r.local,
          qt_pessoas_orcadas: r.qt_orcado,
          qt_pessoas_executadas: r.qt_executado,
          periculosidade: false,
          insalubridade: false,
        }))
      );

      const LOTE = 200;
      for (let i = 0; i < payload.length; i += LOTE) {
        const { error } = await (supabase as any)
          .from("planilha_posto_localizacao")
          .insert(payload.slice(i, i + LOTE));
        if (error) throw error;
      }

      toast.success(`${vinculados.length} localizações importadas com sucesso!`);
      onClose();
    } catch (err: any) {
      toast.error("Erro na importação: " + err.message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h2 className="text-base font-semibold">Importar Postos / Localizações</h2>
          <p className="text-xs text-muted-foreground">
            Aba "postos" da Base de Contratos Vigentes · vincula pelo Contrato + Posto
          </p>
        </div>
      </div>

      <div className="space-y-4 px-6 py-5">
        <div className="rounded-lg border border-amber-300/50 bg-amber-50/50 px-4 py-3 text-xs text-amber-800">
          <strong>Atenção:</strong> Salve o arquivo <strong>.xlsm</strong> como <strong>.xlsx</strong> antes de selecionar.
          Serão importadas apenas as linhas cujo Contrato + Posto existam na planilha de custo da empresa ativa.
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
          <MapPin className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium">Selecione a Base de Contratos Vigentes</p>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            {loading ? "Lendo arquivo…" : "Selecionar arquivo (.xlsx)"}
          </button>
        </div>

        {parsed.length > 0 && (
          <div className="space-y-3">
            <div className="flex gap-3">
              <div className="flex-1 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-center">
                <p className="text-2xl font-bold text-success">{vinculados.length}</p>
                <p className="text-xs text-success/80">vinculados (serão importados)</p>
              </div>
              <div className="flex-1 rounded-lg border border-border bg-muted/30 px-4 py-3 text-center">
                <p className="text-2xl font-bold text-muted-foreground">{semVinculo.length}</p>
                <p className="text-xs text-muted-foreground">sem vínculo (ignorados)</p>
              </div>
            </div>

            {semVinculo.length > 0 && (
              <details className="rounded-lg border border-border">
                <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/30">
                  Ver {semVinculo.length} linhas sem vínculo (contrato/posto não encontrado)
                </summary>
                <div className="max-h-40 overflow-y-auto px-4 pb-3">
                  {semVinculo.slice(0, 50).map((r, i) => (
                    <p key={i} className="py-0.5 text-[11px] text-muted-foreground">
                      · {r.contrato} · {r.posto} · {r.local}
                    </p>
                  ))}
                  {semVinculo.length > 50 && (
                    <p className="text-[11px] text-muted-foreground">…e mais {semVinculo.length - 50}</p>
                  )}
                </div>
              </details>
            )}

            <div className="rounded-lg border border-border">
              <p className="border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Prévia dos primeiros 8 vinculados
              </p>
              <div className="divide-y divide-border">
                {vinculados.slice(0, 8).map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2 text-xs">
                    <div>
                      <span className="font-medium">{r.posto}</span>
                      <span className="mx-1.5 text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{r.local}</span>
                    </div>
                    <div className="flex gap-3 text-muted-foreground">
                      <span>Orc: <strong>{r.qt_orcado}</strong></span>
                      <span>Exec: <strong>{r.qt_executado}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-6 py-4">
        <button
          onClick={onClose}
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Cancelar
        </button>
        <button
          onClick={handleImport}
          disabled={!vinculados.length || importing}
          className="btn-relief inline-flex h-9 items-center gap-1.5 rounded-md bg-gradient-accent px-5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
        >
          <MapPin className="h-4 w-4" />
          {importing ? "Importando…" : `Importar ${vinculados.length || ""} localizações`}
        </button>
      </div>
    </div>
  );
}

// ─── Modal de Migração em Lote ────────────────────────────────────────────────

// Mapeamento índice 0-based → campo (baseado na estrutura real do arquivo)
const IDX_MAP: Array<[number, keyof Omit<PlanilhaCustoRow, "id" | "empresa_id" | "created_at" | "updated_at"> | "_empresa" | "_irpj" | "_csll" | "_skip"]> = [
  [0,  "_empresa"],         // A: Empresa (HAGG, SN, NH, CANAÃ)
  [1,  "cliente"],          // B
  [2,  "contrato"],         // C
  [3,  "posto"],            // D
  [4,  "servico"],          // E
  [5,  "qt_postos"],        // F
  [6,  "sindicato"],        // G
  [7,  "data_vigencia"],    // H
  [9,  "orexec"],           // J (I=Status, ignorado)
  // Remuneração
  [10, "salario"],          // K
  [11, "insalubridade"],    // L
  [12, "periculosidade"],   // M
  [13, "lideranca"],        // N
  [14, "adicional_noturno_reduzido"], // O
  [15, "adicional_noturno"],          // P
  [16, "adicional_extra"],            // Q
  [17, "dsr"],                        // R
  // Encargos
  [18, "decimo_terceiro"],            // S
  [19, "adicional_ferias"],           // T
  [20, "incidencia_enc_41"],          // U
  [21, "inss"],                       // V
  [22, "salario_educacao"],           // W
  [23, "rat_fap"],                    // X
  [24, "sesi"],                       // Y
  [25, "senai"],                      // Z
  [26, "sebrae"],                     // AA
  [27, "incra"],                      // AB
  [28, "fgts"],                       // AC
  [29, "seguro_acidente_trabalho"],   // AD
  // Benefícios
  [30, "transporte"],                 // AE
  [31, "aux_alimentacao"],            // AF
  [32, "aux_alimentacao_desconto"],   // AG
  [33, "aux_refeicao"],               // AH
  [34, "beneficio_familiar"],         // AI
  [35, "aux_lanche"],                 // AJ
  [36, "seguro_vida"],                // AK
  [37, "abono_indenizatorio"],        // AL
  [38, "aux_educacao"],               // AM
  [39, "cesta_basica"],               // AN
  [40, "assistencia_medica"],         // AO
  [41, "hospedagem"],                 // AP
  [42, "odontologico"],               // AQ
  [43, "manutencao_profissional"],    // AR
  [44, "cafe"],                       // AS
  [45, "almoco"],                     // AT
  [46, "janta"],                      // AU
  [47, "ceia"],                       // AV
  [48, "funeral"],                    // AW
  [49, "assiduidade"],                // AX
  [50, "beneficio_trabalhador"],      // AY
  [51, "patronal"],                   // AZ
  [52, "fundo_assistencial"],         // BA
  [53, "fundo_profissional"],         // BB
  [54, "natalidade"],                 // BC
  [55, "deducoes"],                   // BD
  // Rescisão
  [56, "aviso_indenizado"],           // BE
  [57, "incidencia_fgts"],            // BF
  [58, "multa_rescisoria"],           // BG
  [59, "aviso_trabalhado"],           // BH
  [60, "incidencia_aviso_trabalhado"],// BI
  [61, "multa_aviso_indenizado"],     // BJ
  [62, "contratualidade"],            // BK
  // Reposição
  [63, "sub_ferias"],                 // BL
  [64, "sub_ausencias_legais"],       // BM
  [65, "sub_paternidade"],            // BN
  [66, "sub_acidente_trabalho"],      // BO
  [67, "sub_maternidade"],            // BP
  [68, "sub_doenca"],                 // BQ
  [69, "sub_repouso"],                // BR
  [70, "incidencia_maternidade"],     // BS
  [71, "incidencia_enc_reposicao"],   // BT
  [72, "incidencia_enc_reposicao_2"], // BU
  [73, "incidencia_enc_reposicao_3"], // BV
  [74, "incidencia_enc_reposicao_4"], // BW
  // Insumos
  [75, "uniforme"],                   // BX
  [76, "epi"],                        // BY
  [77, "materiais"],                  // BZ
  [78, "epc"],                        // CA
  [79, "equipamentos"],               // CB (cuidado: tem "ABRIR PLANILHA")
  [80, "relogio_digital"],            // CC
  [81, "ponto_eletronico"],           // CD
  [82, "outros_insumos"],             // CE
  // Custos/tributos
  [83, "custos_indiretos"],           // CF
  [84, "lucro"],                      // CG
  [85, "cofins"],                     // CH
  [86, "pis"],                        // CI
  [87, "_irpj"],                      // CJ (soma com CSLL)
  [88, "_csll"],                      // CK (soma com IRPJ)
  [90, "iss"],                        // CM (CL=Tributos Estaduais ignorado)
  [91, "total_por_empregado"],        // CN
  // Outros livres
  [98,  "outros_1"],                  // CU
  [99,  "outros_1_descricao"],        // CV
  [100, "outros_2"],                  // CW
  [101, "outros_2_descricao"],        // CX
  [102, "outros_3"],                  // CY
  [103, "outros_3_descricao"],        // CZ
  // Dedução de Vale Transporte: fica isolada lá na coluna DB do arquivo do
  // José, fora da sequência dos benefícios (por isso o salto de índice).
  [105, "transporte_desconto"],       // DB
];

const TEXT_FIELDS = new Set([
  "cliente", "contrato", "posto", "servico", "sindicato", "orexec",
  "outros_1_descricao", "outros_2_descricao", "outros_3_descricao",
]);

function toNum(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return isNaN(v) ? 0 : v;
  const s = String(v).replace(/R\$\s*/g, "").replace(/\./g, "").replace(",", ".").trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function toDateStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  // openpyxl/SheetJS podem retornar Date ou serial numérico
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseExcelRows(aoa: unknown[][]): { empresa: string; row: any }[] {
  // Linha 1 (índice 0) = instrução, linha 2 (índice 1) = cabeçalho, dados a partir do índice 2
  const results: { empresa: string; row: any }[] = [];

  for (let i = 2; i < aoa.length; i++) {
    const raw = aoa[i] as unknown[];
    if (!raw || raw.length === 0) continue;
    const cliente = raw[1];
    if (!cliente || String(cliente).trim() === "") continue;

    const rec: any = {};
    let empresa = "";

    for (const [idx, field] of IDX_MAP) {
      const val = idx < raw.length ? raw[idx] : undefined;

      if (field === "_empresa") {
        empresa = val ? String(val).trim() : "";
        continue;
      }
      if (field === "_irpj") { rec.__irpj = toNum(val); continue; }
      if (field === "_csll") { rec.__csll = toNum(val); continue; }
      if (field === "_skip") continue;

      if (field === "data_vigencia") {
        rec[field] = toDateStr(val);
      } else if (TEXT_FIELDS.has(field as string)) {
        rec[field] = val ? String(val).trim() || null : null;
      } else {
        rec[field] = toNum(val);
      }
    }

    rec.irpj_csll = (rec.__irpj ?? 0) + (rec.__csll ?? 0);
    delete rec.__irpj;
    delete rec.__csll;

    results.push({ empresa, row: rec });
  }

  return results;
}

function MigracaoModal({ rows: erpRows, onClose }: { rows: PlanilhaCustoRow[]; onClose: () => void }) {
  const bulk = useBulkInsertPlanilhaCusto();
  const { empresa } = useEmpresaAtiva();
  const fileRef = useRef<HTMLInputElement>(null);
  const [allParsed, setAllParsed] = useState<{ empresa: string; row: any }[]>([]);
  const [empresasNoArquivo, setEmpresasNoArquivo] = useState<string[]>([]);
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("TODOS");
  const [loading, setLoading] = useState(false);

  // Chaves dos registros já existentes no ERP: "contrato||posto||data_vigencia||orexec"
  // (orexec incluso: sem ele, se só o ORÇADO existe no ERP, o EXECUTADO que
  // falta era dado como "já no ERP" e nunca importava)
  const erpKeys = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of erpRows) {
      const key = `${r.contrato.trim().toLowerCase()}||${r.posto.trim().toLowerCase()}||${r.data_vigencia ?? ""}||${(r.orexec ?? "").trim().toLowerCase()}`;
      s.add(key);
    }
    return s;
  }, [erpRows]);

  const filtrados = filtroEmpresa === "TODOS"
    ? allParsed
    : allParsed.filter((r) => r.empresa === filtroEmpresa);

  const keyOf = (row: any) =>
    `${String(row.contrato ?? "").trim().toLowerCase()}||${String(row.posto ?? "").trim().toLowerCase()}||${row.data_vigencia ?? ""}||${String(row.orexec ?? "").trim().toLowerCase()}`;
  const jaNoERP   = filtrados.filter((r) => erpKeys.has(keyOf(r.row)));
  const pendingRows = filtrados.filter((r) => !erpKeys.has(keyOf(r.row))).map((r) => r.row);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      // Aba "Banco de Dados" é a primeira
      const sheetName = wb.SheetNames.find((s) => s.toLowerCase().includes("banco")) ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });

      const parsed = parseExcelRows(aoa);
      setAllParsed(parsed);

      const empresas = [...new Set(parsed.map((r) => r.empresa).filter(Boolean))].sort();
      setEmpresasNoArquivo(empresas);
      // Pré-seleciona empresa ativa se existir no arquivo
      const match = empresas.find((e) => e === empresa.sigla.toUpperCase() || e === empresa.sigla);
      setFiltroEmpresa(match ?? "TODOS");
    } catch (err: any) {
      toast.error("Erro ao ler arquivo: " + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    if (!pendingRows.length) return;
    try {
      // Importa em lotes de 200 para não estourar o limite do Supabase
      const LOTE = 200;
      for (let i = 0; i < pendingRows.length; i += LOTE) {
        await bulk.mutateAsync(pendingRows.slice(i, i + LOTE));
      }
      toast.success(`${pendingRows.length} registros importados com sucesso!`);
      onClose();
    } catch (err: any) {
      toast.error("Erro na importação: " + err.message);
    }
  }

  return (
    <div>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-base font-semibold">Migrar Base Excel</h2>
              <p className="text-xs text-muted-foreground">
                Importa linhas da aba "Banco de Dados" da planilha de contratos vigentes
              </p>
            </div>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div className="rounded-lg border border-amber-300/50 bg-amber-50/50 px-4 py-3 text-xs text-amber-800">
              <strong>Atenção:</strong> Salve o arquivo <strong>.xlsm</strong> como <strong>.xlsx</strong> antes de selecionar.
              Os registros serão vinculados à empresa ativa: <strong>{empresa.sigla}</strong>.
            </div>

            <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
              <DatabaseZap className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">Selecione o arquivo Excel da base</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={loading}
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                {loading ? "Lendo arquivo…" : "Selecionar arquivo"}
              </button>
            </div>

            {allParsed.length > 0 && (
              <div className="space-y-3">
                {/* Filtro por empresa */}
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Filtrar por empresa (coluna A do Excel)
                  </label>
                  <select
                    value={filtroEmpresa}
                    onChange={(e) => setFiltroEmpresa(e.target.value)}
                    className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus:border-primary"
                  >
                    <option value="TODOS">Todos ({allParsed.length} registros)</option>
                    {empresasNoArquivo.map((e) => (
                      <option key={e} value={e}>
                        {e} ({allParsed.filter((r) => r.empresa === e).length} registros)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-success">{pendingRows.length}</p>
                    <p className="text-xs text-success/80">faltando no ERP (serão importados)</p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-muted-foreground">{jaNoERP.length}</p>
                    <p className="text-xs text-muted-foreground">já no ERP (ignorados)</p>
                  </div>
                </div>

                {pendingRows.length > 0 && (
                  <div className="rounded-lg border border-border p-4 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Prévia — faltando (primeiros 5):
                    </p>
                    <ul className="space-y-1">
                      {pendingRows.slice(0, 5).map((r: any, i: number) => (
                        <li key={i} className="text-xs text-muted-foreground break-words">
                          · {r.cliente} · {r.contrato} · {r.posto}
                          {r.data_vigencia ? ` · ${r.data_vigencia}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {jaNoERP.length > 0 && pendingRows.length === 0 && (
                  <div className="rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-xs text-success">
                    Todos os registros do Excel já constam no ERP. Nada a importar.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <button
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              onClick={handleImport}
              disabled={!pendingRows.length || bulk.isPending}
              className="btn-relief inline-flex h-9 items-center gap-1.5 rounded-md bg-gradient-accent px-5 text-sm font-semibold text-accent-foreground disabled:opacity-50"
            >
              <DatabaseZap className="h-4 w-4" />
              {bulk.isPending ? "Importando…" : `Importar ${pendingRows.length || ""} registros`}
            </button>
          </div>
    </div>
  );
}

// ─── Modal de Visualização ────────────────────────────────────────────────────

function ViewModal({
  row,
  onClose,
  onEdit,
}: {
  row: PlanilhaCustoRow;
  onClose: () => void;
  onEdit: () => void;
}) {
  const somaRemuneracao = row.salario + row.insalubridade + row.periculosidade + row.lideranca +
    row.adicional_noturno_reduzido + row.adicional_noturno + row.adicional_extra + row.dsr;
  const somaEncargos = row.decimo_terceiro + row.adicional_ferias + row.incidencia_enc_41 +
    row.inss + row.salario_educacao + row.rat_fap + row.sesi + row.senai +
    row.sebrae + row.incra + row.fgts + row.seguro_acidente_trabalho;
  const somaBeneficios = row.transporte + row.aux_alimentacao + row.aux_refeicao + row.aux_lanche +
    row.beneficio_familiar + row.seguro_vida + row.abono_indenizatorio + row.aux_educacao +
    row.cesta_basica + row.assistencia_medica + row.hospedagem + row.odontologico +
    row.manutencao_profissional + row.cafe + row.almoco + row.janta + row.ceia +
    row.funeral + row.assiduidade + row.beneficio_trabalhador + row.patronal +
    row.fundo_assistencial + row.fundo_profissional + row.natalidade +
    row.outros_1 + row.outros_2 + row.outros_3 + row.aux_alimentacao_desconto + row.transporte_desconto - row.deducoes;
  const somaReposicao = row.sub_ferias + row.sub_ausencias_legais + row.sub_paternidade +
    row.sub_acidente_trabalho + row.sub_maternidade + row.sub_doenca + row.sub_repouso +
    row.incidencia_maternidade + row.incidencia_enc_reposicao + row.incidencia_enc_reposicao_2 +
    row.incidencia_enc_reposicao_3 + row.incidencia_enc_reposicao_4;
  const somaRescisao = row.aviso_indenizado + row.incidencia_fgts + row.multa_rescisoria +
    row.aviso_trabalhado + row.incidencia_aviso_trabalhado + row.multa_aviso_indenizado + row.contratualidade;
  const somaInsumos = row.uniforme + row.epi + row.epc + row.materiais + row.equipamentos +
    row.relogio_digital + row.ponto_eletronico + row.outros_insumos;
  const somaCustos = row.custos_indiretos + row.lucro + row.cofins + row.pis + row.irpj_csll + row.iss;
  const somaTotal = somaRemuneracao + somaEncargos + somaBeneficios + somaReposicao + somaRescisao + somaInsumos + somaCustos;

  function VRow({ label, value }: { label: string; value: number }) {
    if (!value) return null;
    return (
      <div className="flex items-center justify-between py-1 border-b border-border/40 last:border-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs font-medium">{formatBRL(value)}</span>
      </div>
    );
  }

  function VSec({ title, soma, children }: { title: string; soma: number; children: React.ReactNode }) {
    return (
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between bg-muted/40 px-4 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider">{title}</span>
          <span className="font-mono text-xs font-semibold text-primary">{formatBRL(soma)}</span>
        </div>
        <div className="px-4 py-2">{children}</div>
      </div>
    );
  }

  return (
    <div>
          {/* Header */}
          <div className="flex items-start justify-between border-b border-border px-6 py-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">{row.cliente}</h2>
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  row.orexec === "EXECUTADO" ? "bg-success-soft text-success" : "bg-info-soft text-info"
                }`}>
                  {row.orexec}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {row.contrato} · {row.posto}
                {row.servico && ` · ${row.servico}`}
                {row.sindicato && ` · ${row.sindicato}`}
              </p>
              <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                {row.data_vigencia && (
                  <span>Vigência: {new Date(row.data_vigencia + "T00:00:00").toLocaleDateString("pt-BR")}</span>
                )}
                {row.qt_postos > 0 && <span>Pessoas: {row.qt_postos}</span>}
                {row.arquivo_origem && <span>Arquivo: {row.arquivo_origem}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onEdit}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
              >
                <Pencil className="h-3.5 w-3.5" /> Editar
              </button>
            </div>
          </div>

          {/* Conteúdo */}
          <div className="px-6 py-4 space-y-3">

            <VSec title="2 — Composição da Remuneração" soma={somaRemuneracao}>
              <VRow label="Salário Base" value={row.salario} />
              <VRow label="Insalubridade" value={row.insalubridade} />
              <VRow label="Periculosidade" value={row.periculosidade} />
              <VRow label="Add. Líder" value={row.lideranca} />
              <VRow label="Add. Not. Reduzida" value={row.adicional_noturno_reduzido} />
              <VRow label="Add. Noturno" value={row.adicional_noturno} />
              <VRow label="Add. Horas Extras" value={row.adicional_extra} />
              <VRow label="DSR" value={row.dsr} />
            </VSec>

            <VSec title="3 — Encargos Previdenciários, FGTS e Outras" soma={somaEncargos}>
              <VRow label="13º Salário" value={row.decimo_terceiro} />
              <VRow label="Add. Férias" value={row.adicional_ferias} />
              <VRow label="Inc. Encargos" value={row.incidencia_enc_41} />
              <VRow label="INSS" value={row.inss} />
              <VRow label="Sal. Educação" value={row.salario_educacao} />
              <VRow label="RAT x FAP" value={row.rat_fap} />
              <VRow label="SESI/SESC" value={row.sesi} />
              <VRow label="SENAI/SENAC" value={row.senai} />
              <VRow label="SEBRAE" value={row.sebrae} />
              <VRow label="INCRA" value={row.incra} />
              <VRow label="FGTS" value={row.fgts} />
              <VRow label="Seg. Acid. Trab." value={row.seguro_acidente_trabalho} />
            </VSec>

            <VSec title="4 — Benefícios Mensais e Diários" soma={somaBeneficios}>
              <VRow label="Transporte" value={row.transporte} />
              <VRow label="Dedução VT" value={row.transporte_desconto} />
              <VRow label="Aux. Alimentação" value={row.aux_alimentacao} />
              <VRow label="Desc. Alimentação" value={row.aux_alimentacao_desconto} />
              <VRow label="Aux. Refeição" value={row.aux_refeicao} />
              <VRow label="Aux. Lanche" value={row.aux_lanche} />
              <VRow label="Ben. Sócio Familiar" value={row.beneficio_familiar} />
              <VRow label="Seguro de Vida" value={row.seguro_vida} />
              <VRow label="Abono Indeniz." value={row.abono_indenizatorio} />
              <VRow label="Aux. Educação" value={row.aux_educacao} />
              <VRow label="Cesta Básica" value={row.cesta_basica} />
              <VRow label="Assist. Médica" value={row.assistencia_medica} />
              <VRow label="Hospedagem" value={row.hospedagem} />
              <VRow label="Médico/Odontológico" value={row.odontologico} />
              <VRow label="Manut./Capacit. Prof." value={row.manutencao_profissional} />
              <VRow label="Café" value={row.cafe} />
              <VRow label="Almoço" value={row.almoco} />
              <VRow label="Janta" value={row.janta} />
              <VRow label="Ceia" value={row.ceia} />
              <VRow label="Aux. Funeral" value={row.funeral} />
              <VRow label="Assiduidade" value={row.assiduidade} />
              <VRow label="Ben. Trabalhador" value={row.beneficio_trabalhador} />
              <VRow label="Assist. Patronal" value={row.patronal} />
              <VRow label="Fundo Assistencial" value={row.fundo_assistencial} />
              <VRow label="Fundo Profissional" value={row.fundo_profissional} />
              <VRow label="Natalidade" value={row.natalidade} />
              <VRow label="Deduções" value={row.deducoes} />
              {row.outros_1 > 0 && <VRow label={row.outros_1_descricao || "Outros 1"} value={row.outros_1} />}
              {row.outros_2 > 0 && <VRow label={row.outros_2_descricao || "Outros 2"} value={row.outros_2} />}
              {row.outros_3 > 0 && <VRow label={row.outros_3_descricao || "Outros 3"} value={row.outros_3} />}
            </VSec>

            <VSec title="5 — Reposição do Profissional Ausente" soma={somaReposicao}>
              <VRow label="Sub. Férias" value={row.sub_ferias} />
              <VRow label="Sub. Ausências Legais" value={row.sub_ausencias_legais} />
              <VRow label="Sub. Paternidade" value={row.sub_paternidade} />
              <VRow label="Sub. Acidente Trab." value={row.sub_acidente_trabalho} />
              <VRow label="Sub. Maternidade" value={row.sub_maternidade} />
              <VRow label="Sub. Doença" value={row.sub_doenca} />
              <VRow label="Sub. Repouso/Alim." value={row.sub_repouso} />
              <VRow label="Inc. Maternidade" value={row.incidencia_maternidade} />
              <VRow label="Inc. Enc. Repos." value={row.incidencia_enc_reposicao} />
              <VRow label="Inc. Enc. Repos. 2" value={row.incidencia_enc_reposicao_2} />
              <VRow label="Inc. Enc. Repos. 3" value={row.incidencia_enc_reposicao_3} />
              <VRow label="Inc. Enc. Repos. 4" value={row.incidencia_enc_reposicao_4} />
            </VSec>

            <VSec title="6 — Provisão para Rescisão" soma={somaRescisao}>
              <VRow label="Aviso Prev. Indenizado" value={row.aviso_indenizado} />
              <VRow label="Inc. FGTS s/ Aviso" value={row.incidencia_fgts} />
              <VRow label="Aviso Prev. Trabalhado" value={row.aviso_trabalhado} />
              <VRow label="Inc. s/ Aviso Trab." value={row.incidencia_aviso_trabalhado} />
              <VRow label="Multa Rescisória" value={row.multa_rescisoria} />
              <VRow label="Multa FGTS Aviso Ind." value={row.multa_aviso_indenizado} />
              <VRow label="Multa FGTS Contrat." value={row.contratualidade} />
            </VSec>

            <VSec title="7 — Insumos Diversos" soma={somaInsumos}>
              <VRow label="Uniformes" value={row.uniforme} />
              <VRow label="EPI" value={row.epi} />
              <VRow label="EPC" value={row.epc} />
              <VRow label="Materiais" value={row.materiais} />
              <VRow label="Equipamentos" value={row.equipamentos} />
              <VRow label="Ponto Eletrônico" value={row.ponto_eletronico} />
              <VRow label="Relógio Digital" value={row.relogio_digital} />
              <VRow label="Outros Insumos" value={row.outros_insumos} />
            </VSec>

            <VSec title="8 — Custos Indiretos, Lucro e Tributos" soma={somaCustos}>
              <VRow label="Custos Indiretos" value={row.custos_indiretos} />
              <VRow label="Lucro" value={row.lucro} />
              <VRow label="COFINS" value={row.cofins} />
              <VRow label="PIS" value={row.pis} />
              <VRow label="IRPJ + CSLL" value={row.irpj_csll} />
              <VRow label="ISS" value={row.iss} />
            </VSec>

            {/* Total */}
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Soma Total Calculada
                  </p>
                  <p className="font-mono text-lg font-bold text-primary">{formatBRL(somaTotal)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Total por Empregado (Planilha)
                  </p>
                  <p className="font-mono text-lg font-bold">{formatBRL(row.total_por_empregado)}</p>
                  {row.total_por_empregado > 0 && (
                    <p className={`text-xs font-medium ${
                      Math.abs(row.total_por_empregado - somaTotal) < 0.1
                        ? "text-success"
                        : "text-destructive"
                    }`}>
                      Diferença: {formatBRL(row.total_por_empregado - somaTotal)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end border-t border-border px-6 py-4">
            <button
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
            >
              Fechar
            </button>
          </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function Section({
  title,
  soma,
  children,
}: {
  title: string;
  soma?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between bg-muted/40 px-4 py-2.5 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
          {title}
        </span>
        <div className="flex items-center gap-3">
          {soma !== undefined && (
            <span className="font-mono text-xs font-semibold text-primary">
              {formatBRL(soma)}
            </span>
          )}
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

function CompRow({
  label,
  soma,
  highlight,
}: {
  label: string;
  soma: number;
  highlight?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${highlight ? "font-semibold" : ""}`}>
      <span className={`text-xs ${highlight ? "text-foreground" : "text-muted-foreground"}`}>
        {label}
      </span>
      <span className={`font-mono text-xs ${highlight ? "text-primary" : ""}`}>
        {formatBRL(soma)}
      </span>
    </div>
  );
}

function Kpi({ label, v, onClick, clickable }: { label: string; v: string; onClick?: () => void; clickable?: boolean }) {
  return (
    <div
      className={`card-elevated p-5 ${clickable ? "cursor-pointer transition-shadow hover:shadow-md hover:border-primary/30 group" : ""}`}
      onClick={onClick}
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {clickable && <span className="ml-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">↗</span>}
      </p>
      <p className="mt-2 font-display text-2xl font-bold text-primary">{v}</p>
    </div>
  );
}
