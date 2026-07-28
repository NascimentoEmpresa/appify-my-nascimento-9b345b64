import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { Plus, Pencil, Trash2, Building2, CalendarDays, TrendingUp, Download, FileText, ExternalLink } from "lucide-react";
import {
  useContratosERP,
  useContratoERPUpsert,
  useContratoERPDelete,
} from "@/hooks/useContratosERP";
import type { ContratoERP, ContratoERPInput } from "@/hooks/useContratosERP";
import { usePlanilhaCustos } from "@/hooks/usePlanilhaCusto";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useContratoDocsPorContrato } from "@/hooks/useDocumentos";
import { BADGE as DOC_BADGE, periodLabel } from "@/pages/Documentos";

const STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo",
  encerrado: "Encerrado",
  suspenso: "Suspenso",
};

const STATUS_COLOR: Record<string, string> = {
  ativo: "bg-emerald-100 text-emerald-700",
  encerrado: "bg-slate-100 text-slate-500",
  suspenso: "bg-amber-100 text-amber-700",
};

function fmt(v: number | null) {
  if (!v) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtData(d: string | null) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

type FiscalFields =
  | "issqn_pct" | "ir_pct" | "cofins_pct" | "pis_pct" | "csll_pct"
  | "prazo_pagamento" | "codigo_servico_lc116" | "codigo_servico_municipal_cnae"
  | "conta_pagamento" | "email_envio_nf" | "instrucoes_envio";

type ContratoFormState = Omit<ContratoERPInput, FiscalFields>;

const EMPTY: ContratoFormState = {
  nome: "",
  cliente: "",
  cnpj_cliente: null,
  vigencia_meses: null,
  data_inicio: null,
  status: "ativo",
  grade_id: null,
  capa_id: null,
};

interface FiscalForm {
  issqn_pct: string;
  ir_pct: string;
  cofins_pct: string;
  pis_pct: string;
  csll_pct: string;
  prazo_pagamento: string;
  codigo_servico_lc116: string;
  codigo_servico_municipal_cnae: string;
  conta_pagamento: string;
  email_envio_nf: string;
  instrucoes_envio: string;
}

const FISCAL_EMPTY: FiscalForm = {
  issqn_pct: "", ir_pct: "", cofins_pct: "", pis_pct: "", csll_pct: "",
  prazo_pagamento: "", codigo_servico_lc116: "", codigo_servico_municipal_cnae: "",
  conta_pagamento: "", email_envio_nf: "", instrucoes_envio: "",
};

function fiscalParaForm(d: ContratoERP | null | undefined): FiscalForm {
  const pctToStr = (v: number | undefined | null) => (v ? String(Number(v) * 100) : "");
  if (!d) return { ...FISCAL_EMPTY };
  return {
    issqn_pct: pctToStr(d.issqn_pct),
    ir_pct: pctToStr(d.ir_pct),
    cofins_pct: pctToStr(d.cofins_pct),
    pis_pct: pctToStr(d.pis_pct),
    csll_pct: pctToStr(d.csll_pct),
    prazo_pagamento: d.prazo_pagamento ?? "",
    codigo_servico_lc116: d.codigo_servico_lc116 ?? "",
    codigo_servico_municipal_cnae: d.codigo_servico_municipal_cnae ?? "",
    conta_pagamento: d.conta_pagamento ?? "",
    email_envio_nf: d.email_envio_nf ?? "",
    instrucoes_envio: d.instrucoes_envio ?? "",
  };
}

export default function ContratosERP() {
  const navigate = useNavigate();
  const { empresa } = useEmpresaAtiva();
  const { data: contratos = [], isLoading } = useContratosERP();
  const { data: planilha = [] } = usePlanilhaCustos();
  const upsert = useContratoERPUpsert();
  const del = useContratoERPDelete();

  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState<ContratoERP | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContratoERP | null>(null);
  const [form, setForm] = useState<ContratoFormState>(EMPTY);
  const [fiscal, setFiscal] = useState<FiscalForm>(FISCAL_EMPTY);
  const [importando, setImportando] = useState(false);

  const { data: docsContrato = [] } = useContratoDocsPorContrato(editando?.id);

  // Calcula valor mensal EM VIGÊNCIA por contrato_id a partir da planilha
  const valorPorContratoId = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const groupDates = new Map<string, Date[]>();
    for (const r of planilha) {
      if (r.encerrado || !r.data_vigencia) continue;
      const key = `${r.contrato}||${r.posto}`;
      const d = new Date(r.data_vigencia + "T00:00:00");
      const arr = groupDates.get(key) ?? [];
      arr.push(d);
      groupDates.set(key, arr);
    }
    const vigente = new Map<string, Date | null>();
    groupDates.forEach((dates, key) => {
      const past = dates.filter((d) => d <= today).sort((a, b) => b.getTime() - a.getTime());
      vigente.set(key, past[0] ?? null);
    });
    const map = new Map<string, number>();
    for (const r of planilha) {
      if (r.encerrado || !r.data_vigencia || r.orexec !== "EXECUTADO" || !r.contrato_id) continue;
      const key = `${r.contrato}||${r.posto}`;
      const rowDate = new Date(r.data_vigencia + "T00:00:00");
      const v = vigente.get(key) ?? null;
      if (!v || rowDate.getTime() !== v.getTime()) continue;
      map.set(r.contrato_id, (map.get(r.contrato_id) ?? 0) + (r.total_por_empregado ?? 0) * (r.qt_postos || 1));
    }
    return map;
  }, [planilha]);

  async function handleImportar() {
    setImportando(true);
    try {
      // Calcula quais linhas estão EM VIGÊNCIA (replica lógica de computeVigenciaStatus)
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const groupDates = new Map<string, Date[]>();
      for (const r of planilha) {
        if (r.encerrado || !r.data_vigencia) continue;
        const key = `${r.contrato}||${r.posto}`;
        const d = new Date(r.data_vigencia + "T00:00:00");
        const arr = groupDates.get(key) ?? [];
        arr.push(d);
        groupDates.set(key, arr);
      }
      const vigente = new Map<string, Date | null>();
      groupDates.forEach((dates, key) => {
        const past = dates.filter((d) => d <= today).sort((a, b) => b.getTime() - a.getTime());
        vigente.set(key, past[0] ?? null);
      });
      const emVigencia = new Set(
        planilha
          .filter((r) => {
            if (r.encerrado || !r.data_vigencia) return false;
            const key = `${r.contrato}||${r.posto}`;
            const rowDate = new Date(r.data_vigencia + "T00:00:00");
            const v = vigente.get(key) ?? null;
            return !!(v && rowDate.getTime() === v.getTime());
          })
          .map((r) => r.id)
      );

      // Agrupa por contrato só as linhas EXECUTADO EM VIGÊNCIA ou A INICIAR
      const ativos = planilha.filter((r) => r.orexec === "EXECUTADO" && emVigencia.has(r.id));
      const porContrato = new Map<string, { cliente: string; valorMensal: number; dataInicio: string | null }>();
      for (const r of ativos) {
        const key = r.contrato;
        const cur = porContrato.get(key) ?? { cliente: r.cliente, valorMensal: 0, dataInicio: r.data_vigencia ?? null };
        cur.valorMensal += (r.total_por_empregado ?? 0) * (r.qt_postos || 1);
        porContrato.set(key, cur);
      }

      // Filtra os que já existem
      const nomesExistentes = new Set(contratos.map((c) => c.nome));
      const novos = [...porContrato.entries()].filter(([nome]) => !nomesExistentes.has(nome));

      if (novos.length === 0) {
        toast({ title: "Nenhum contrato novo para importar.", description: "Todos já estão cadastrados." });
        return;
      }

      const inserts = novos.map(([nome, v]) => ({
        empresa_id: empresa.id,
        nome,
        cliente: v.cliente,
        valor_mensal: Math.round(v.valorMensal * 100) / 100,
        data_inicio: v.dataInicio,
        status: "ativo" as const,
      }));

      const { error } = await (supabase as any).from("contratos").insert(inserts);
      if (error) throw error;

      toast({ title: `${novos.length} contrato(s) importado(s) com sucesso!` });
      // Força refetch
      window.location.reload();
    } catch (e: any) {
      toast({ title: "Erro ao importar", description: e.message, variant: "destructive" });
    } finally {
      setImportando(false);
    }
  }

  const filtered = useMemo(() => {
    return contratos.filter((c) => {
      if (filtroStatus !== "todos" && c.status !== filtroStatus) return false;
      if (busca) {
        const q = busca.toLowerCase();
        return c.nome.toLowerCase().includes(q) || c.cliente.toLowerCase().includes(q);
      }
      return true;
    });
  }, [contratos, busca, filtroStatus]);

  const ativos   = contratos.filter((c) => c.status === "ativo").length;
  const suspensos = contratos.filter((c) => c.status === "suspenso").length;
  const valorTotal = contratos
    .filter((c) => c.status === "ativo")
    .reduce((s, c) => s + (valorPorContratoId.get(c.id) ?? 0), 0);

  function abrirNovo() {
    setEditando(null);
    setForm(EMPTY);
    setFiscal(FISCAL_EMPTY);
    setModalOpen(true);
  }

  function abrirEditar(c: ContratoERP) {
    setEditando(c);
    setForm({
      nome: c.nome,
      cliente: c.cliente,
      cnpj_cliente: c.cnpj_cliente,
      vigencia_meses: c.vigencia_meses,
      data_inicio: c.data_inicio,
      status: c.status,
      grade_id: c.grade_id,
      capa_id: c.capa_id,
    });
    setFiscal(fiscalParaForm(c));
    setModalOpen(true);
  }

  async function handleSalvar() {
    const pctToNum = (v: string) => (v.trim() ? Number(v) / 100 : 0);
    await upsert.mutateAsync({
      ...form,
      issqn_pct: pctToNum(fiscal.issqn_pct),
      ir_pct: pctToNum(fiscal.ir_pct),
      cofins_pct: pctToNum(fiscal.cofins_pct),
      pis_pct: pctToNum(fiscal.pis_pct),
      csll_pct: pctToNum(fiscal.csll_pct),
      prazo_pagamento: fiscal.prazo_pagamento || null,
      codigo_servico_lc116: fiscal.codigo_servico_lc116 || null,
      codigo_servico_municipal_cnae: fiscal.codigo_servico_municipal_cnae || null,
      conta_pagamento: fiscal.conta_pagamento || null,
      email_envio_nf: fiscal.email_envio_nf || null,
      instrucoes_envio: fiscal.instrucoes_envio || null,
      id: editando?.id,
    });
    setModalOpen(false);
  }

  function field(label: string, key: keyof ContratoERPInput, opts?: { type?: string; required?: boolean }) {
    const val = form[key];
    return (
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{label}{opts?.required && <span className="text-destructive ml-0.5">*</span>}</Label>
        <Input
          type={opts?.type ?? "text"}
          value={val === null || val === undefined ? "" : String(val)}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = opts?.type === "number" ? (raw === "" ? null : Number(raw)) : (raw || null);
            setForm((f) => ({ ...f, [key]: parsed }));
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Contratos"
        description="Gestão dos contratos ativos da empresa."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleImportar} disabled={importando}>
              <Download className="h-4 w-4 mr-1" />
              {importando ? "Importando…" : "Importar da Planilha"}
            </Button>
            <Button size="sm" onClick={abrirNovo}>
              <Plus className="h-4 w-4 mr-1" /> Novo Contrato
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        <KpiCard icon={<Building2 />} label="Contratos Ativos" value={String(ativos)} color="emerald" />
        <KpiCard icon={<TrendingUp />} label="Faturamento Mensal" value={fmt(valorTotal)} color="blue" />
        <KpiCard icon={<CalendarDays />} label="Suspensos" value={String(suspensos)} color="amber" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Buscar por nome ou cliente..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="w-72 h-8 text-sm"
        />
        {(["todos", "ativo", "suspenso", "encerrado"] as const).map((s) => (
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
            {s === "todos" ? "Todos" : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {/* Tabela */}
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <Building2 className="h-10 w-10 opacity-20" />
          <p className="text-sm">Nenhum contrato encontrado.</p>
          <Button size="sm" variant="outline" onClick={abrirNovo}>Cadastrar primeiro contrato</Button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Contrato</th>
                <th className="px-4 py-3 font-medium">Cliente</th>
                <th className="px-4 py-3 font-medium">Início</th>
                <th className="px-4 py-3 font-medium">Prazo</th>
                <th className="px-4 py-3 font-medium">Vlr. Mensal</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{c.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.cliente}</td>
                  <td className="px-4 py-3 text-muted-foreground">{fmtData(c.data_inicio)}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {c.vigencia_meses ? `${c.vigencia_meses} meses` : "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{fmt(valorPorContratoId.get(c.id) ?? null)}</td>
                  <td className="px-4 py-3">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", STATUS_COLOR[c.status])}>
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => abrirEditar(c)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(c)}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive"
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
      )}

      {/* Modal cadastro/edição */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar Contrato" : "Novo Contrato"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2">{field("Nome / Objeto", "nome", { required: true })}</div>
            <div className="col-span-2">{field("Cliente (Órgão)", "cliente", { required: true })}</div>
            {field("CNPJ do Cliente", "cnpj_cliente")}
            {field("Data de Início", "data_inicio", { type: "date" })}
            {field("Prazo (meses)", "vigencia_meses", { type: "number" })}
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Status</Label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ContratoERP["status"] }))}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="ativo">Ativo</option>
                <option value="suspenso">Suspenso</option>
                <option value="encerrado">Encerrado</option>
              </select>
            </div>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
              <div>
                <h4 className="text-sm font-semibold">Dados Fiscais (Emissão de NF)</h4>
                <p className="text-xs text-muted-foreground">
                  Reaproveitados automaticamente em toda NF emitida para este contrato. INSS não entra
                  aqui — é definido por categoria de risco em cada item da NF (alíquota padrão fixa).
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">ISSQN %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.issqn_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, issqn_pct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">IR %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.ir_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, ir_pct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">COFINS %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.cofins_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, cofins_pct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">PIS %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.pis_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, pis_pct: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">CSLL %</Label>
                  <Input type="number" step="0.01" className="h-9" value={fiscal.csll_pct}
                    onChange={(e) => setFiscal((f) => ({ ...f, csll_pct: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Prazo de Pagamento</Label>
                  <Input className="h-9" placeholder="Ex: ATÉ 15 DIAS MÊS SUBSEQUENTE" value={fiscal.prazo_pagamento}
                    onChange={(e) => setFiscal((f) => ({ ...f, prazo_pagamento: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Conta para Pagamento</Label>
                  <Input className="h-9" placeholder="Ex: BANRISUL AG: 0949 / CC: 06.1421700-6" value={fiscal.conta_pagamento}
                    onChange={(e) => setFiscal((f) => ({ ...f, conta_pagamento: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Código do Serviço (LC 116)</Label>
                  <Input className="h-9" value={fiscal.codigo_servico_lc116}
                    onChange={(e) => setFiscal((f) => ({ ...f, codigo_servico_lc116: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Cód. Serviço Municipal / CNAE</Label>
                  <Input className="h-9" value={fiscal.codigo_servico_municipal_cnae}
                    onChange={(e) => setFiscal((f) => ({ ...f, codigo_servico_municipal_cnae: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">E-mail de Envio da NF</Label>
                  <Input type="email" className="h-9" value={fiscal.email_envio_nf}
                    onChange={(e) => setFiscal((f) => ({ ...f, email_envio_nf: e.target.value }))} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Instruções de Envio</Label>
                <Textarea
                  rows={2}
                  placeholder="Instruções gerais sobre a emissão desta NF. Nunca inclua login ou senha de portais externos aqui."
                  value={fiscal.instrucoes_envio}
                  onChange={(e) => setFiscal((f) => ({ ...f, instrucoes_envio: e.target.value }))}
                />
              </div>
            </div>

          {editando && (
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold">Documentos Exigidos</h4>
                  <p className="text-xs text-muted-foreground">
                    Somente consulta — a configuração é feita em Documentos.
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/app/documentos?contrato=${editando.id}`)}
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Gerenciar documentos
                </Button>
              </div>

              {docsContrato.length === 0 ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground italic py-2">
                  <FileText className="h-3.5 w-3.5" /> Nenhum documento configurado ainda.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {docsContrato.map((d) => {
                    const label = periodLabel(d);
                    return (
                      <div key={d.id} className="flex items-center gap-2 flex-wrap text-xs rounded-md border border-border px-3 py-1.5">
                        <span className="font-medium">{d.doc_tipos?.nome ?? "—"}</span>
                        {d.posto && (
                          <span className="text-[10px] text-muted-foreground">· {d.posto}</span>
                        )}
                        {label && (
                          <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold", DOC_BADGE[d.periodicidade!] ?? "bg-muted text-muted-foreground")}>
                            {label}
                          </span>
                        )}
                        {!d.obrigatorio && <span className="text-[10px] text-muted-foreground italic">opcional</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSalvar}
              disabled={!form.nome || !form.cliente || upsert.isPending}
            >
              {upsert.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmar exclusão */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.nome}" será removido permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={async () => {
                await del.mutateAsync(deleteTarget!.id);
                setDeleteTarget(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-500",
    blue: "text-blue-500",
    amber: "text-amber-500",
  };
  return (
    <div className="relative overflow-hidden rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 flex flex-col min-h-[90px]">
      <div
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 opacity-100"
        style={{
          WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
        }}
      >
        <span className={cn("[&>svg]:h-24 [&>svg]:w-24", colors[color])}>{icon}</span>
      </div>
      <p className="relative z-10 text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">{label}</p>
      <p className="relative z-10 text-2xl font-bold text-slate-900 leading-none">{value}</p>
    </div>
  );
}
