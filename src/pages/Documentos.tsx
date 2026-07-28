import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Plus, Pencil, Trash2, FileText, Search, Check, X,
  ChevronRight, Building2, MapPin, ChevronDown,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useDocTipos, useDocTipoSave, useDocTipoDelete,
  useContratoDocsConfig, useContratoDocSave, useContratoDocDelete,
  type DocTipo, type ContratoDocConfig,
} from "@/hooks/useDocumentos";
import { usePlanilhaCustos } from "@/hooks/usePlanilhaCusto";
import { useContratosERP } from "@/hooks/useContratosERP";

const PERIODICIDADES = ["mensal", "trimestral", "semestral", "implantação", "implantação + recorrência"] as const;
const RECORRENCIAS = ["mensal", "trimestral", "semestral", "anual"] as const;

export const BADGE: Record<string, string> = {
  mensal: "bg-info-soft text-info",
  trimestral: "bg-primary/10 text-primary",
  semestral: "bg-warning/15 text-warning-foreground",
  "implantação": "bg-success-soft text-success",
  "implantação + recorrência": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

export function periodLabel(d: Pick<ContratoDocConfig, "periodicidade" | "recorrencia">) {
  if (!d.periodicidade) return null;
  if (d.periodicidade === "implantação + recorrência" && d.recorrencia)
    return `impl. + ${d.recorrencia}`;
  return d.periodicidade;
}

export default function Documentos() {
  const [aba, setAba] = useState<"catalogo" | "contratos">("contratos");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documentos de Contrato"
        breadcrumb={["Licitações", "Documentos"]}
        subtitle="Catálogo de documentos exigidos e configuração por contrato."
      />

      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1 w-fit">
        {(["contratos", "catalogo"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setAba(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              aba === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "catalogo" ? "Catálogo de Tipos" : "Por Contrato"}
          </button>
        ))}
      </div>

      {aba === "catalogo" ? <CatalogoTab /> : <ContratosTab />}
    </div>
  );
}

// ─── Aba Catálogo ─────────────────────────────────────────────────────────────

function CatalogoTab() {
  const { data: tipos = [], isLoading } = useDocTipos();
  const save = useDocTipoSave();
  const del = useDocTipoDelete();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DocTipo | null>(null);

  async function handleDelete(id: string) {
    if (!confirm("Remover este tipo? Todos os vínculos com contratos serão removidos.")) return;
    await del.mutateAsync(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {tipos.length} tipo{tipos.length !== 1 ? "s" : ""} cadastrado{tipos.length !== 1 ? "s" : ""}
        </p>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="btn-relief inline-flex h-9 items-center gap-1.5 rounded-md bg-gradient-accent px-3 text-sm font-semibold text-accent-foreground"
        >
          <Plus className="h-4 w-4" /> Novo Tipo
        </button>
      </div>

      <div className="card-elevated overflow-hidden">
        {isLoading && <p className="px-4 py-8 text-center text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && tipos.length === 0 && (
          <div className="px-4 py-12 text-center">
            <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Nenhum tipo cadastrado ainda.</p>
            <button onClick={() => { setEditing(null); setModalOpen(true); }} className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted">
              <Plus className="h-3.5 w-3.5" /> Criar primeiro tipo
            </button>
          </div>
        )}
        {tipos.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-left">Descrição</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{t.nome}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{t.descricao || "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setEditing(t); setModalOpen(true); }} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDelete(t.id)} className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Tipo" : "Novo Tipo de Documento"}</DialogTitle>
          </DialogHeader>
          <TipoForm
            initial={editing}
            onSave={async (payload) => {
              await save.mutateAsync({ ...(editing ? { id: editing.id } : {}), ...payload });
              setModalOpen(false);
            }}
            onCancel={() => setModalOpen(false)}
            saving={save.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TipoForm({ initial, onSave, onCancel, saving }: {
  initial: DocTipo | null;
  onSave: (p: { nome: string; descricao: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [nome, setNome] = useState(initial?.nome ?? "");
  const [descricao, setDescricao] = useState(initial?.descricao ?? "");

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Nome *</label>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Alvará Sanitário, CND Federal…"
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Descrição</label>
        <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={2}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">Cancelar</button>
        <button onClick={() => { if (!nome.trim()) { toast.error("Informe o nome."); return; } onSave({ nome: nome.trim(), descricao: descricao.trim() }); }}
          disabled={saving} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}

// ─── Aba Por Contrato ─────────────────────────────────────────────────────────

function ContratosTab() {
  const [searchParams] = useSearchParams();
  const { data: contratosErp = [] } = useContratosERP();
  const { data: planilhaRows = [] } = usePlanilhaCustos();
  const { data: configs = [] } = useContratoDocsConfig();
  const [search, setSearch] = useState("");
  const [contratoSel, setContratoSel] = useState<string | null>(() => searchParams.get("contrato"));

  const contratos = React.useMemo(() => {
    return contratosErp
      .filter((c) =>
        c.nome.toLowerCase().includes(search.toLowerCase()) ||
        c.cliente.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [contratosErp, search]);

  const contratoAtual = contratosErp.find((c) => c.id === contratoSel) ?? null;

  const configsContrato = React.useMemo(
    () => configs.filter((c) => c.contrato_id === contratoSel),
    [configs, contratoSel]
  );

  const postosDoPlanilha = React.useMemo(() => {
    if (!contratoSel) return [];
    const seen = new Set<string>();
    return planilhaRows
      .filter((r) => r.orexec === "EXECUTADO" && r.contrato_id === contratoSel && r.posto)
      .filter((r) => { if (seen.has(r.posto)) return false; seen.add(r.posto); return true; })
      .map((r) => r.posto)
      .sort();
  }, [planilhaRows, contratoSel]);

  return (
    <div className="grid grid-cols-5 gap-4 min-h-[600px]">
      {/* Lista de contratos */}
      <div className="col-span-2 card-elevated flex flex-col overflow-hidden">
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar contrato…"
              className="h-8 w-full rounded border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary" />
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          {contratos.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum contrato encontrado.</p>}
          {contratos.map((c) => {
            const qtd = configs.filter((cfg) => cfg.contrato_id === c.id).length;
            const ativo = contratoSel === c.id;
            return (
              <button key={c.id} onClick={() => setContratoSel(c.id)}
                className={`flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30 ${ativo ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{c.nome}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.cliente}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {qtd > 0 && <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{qtd}</span>}
                  <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${ativo ? "rotate-90 text-primary" : ""}`} />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detalhe do contrato */}
      <div className="col-span-3 card-elevated flex flex-col overflow-hidden">
        {!contratoAtual ? (
          <div className="flex h-full items-center justify-center py-20">
            <div className="text-center">
              <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Selecione um contrato</p>
            </div>
          </div>
        ) : (
          <ContratoDetail
            contratoId={contratoAtual.id}
            contratoNome={contratoAtual.nome}
            cliente={contratoAtual.cliente}
            postos={postosDoPlanilha}
            configs={configsContrato}
          />
        )}
      </div>
    </div>
  );
}

// ─── Detalhe do Contrato ──────────────────────────────────────────────────────

function ContratoDetail({ contratoId, contratoNome, cliente, postos, configs }: {
  contratoId: string;
  contratoNome: string;
  cliente: string;
  postos: string[];
  configs: ContratoDocConfig[];
}) {
  const { data: tipos = [] } = useDocTipos();
  const save = useContratoDocSave();
  const del = useContratoDocDelete();
  const [addModal, setAddModal] = useState<{ posto: string } | null>(null);
  const [editModal, setEditModal] = useState<ContratoDocConfig | null>(null);
  const [expandedPostos, setExpandedPostos] = useState<Set<string>>(new Set());

  const docsContrato = configs.filter((c) => c.posto === "");
  const postoComDocs = postos.filter((p) => configs.some((c) => c.posto === p));
  const postosTotal = [...new Set([...postoComDocs, ...postos.filter((p) => !postoComDocs.includes(p))])];

  function togglePosto(p: string) {
    setExpandedPostos((prev) => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });
  }

  function tipoNome(id: string) {
    return tipos.find((t) => t.id === id)?.nome ?? id;
  }

  async function handleDelete(id: string) {
    if (!confirm("Remover este documento do contrato?")) return;
    await del.mutateAsync(id);
  }

  return (
    <>
      {/* Header */}
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{contratoNome}</p>
            <p className="text-xs text-muted-foreground">{cliente}</p>
          </div>
          <button
            onClick={() => setAddModal({ posto: "" })}
            className="shrink-0 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar documento
          </button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-border">
        {/* Nível contrato */}
        <section>
          <div className="flex items-center gap-2 bg-muted/30 px-4 py-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Contrato geral
            </span>
            <span className="ml-auto text-[11px] text-muted-foreground">{docsContrato.length} doc{docsContrato.length !== 1 ? "s" : ""}</span>
          </div>
          {docsContrato.length === 0 ? (
            <p className="px-6 py-3 text-xs text-muted-foreground italic">Nenhum documento no nível contrato.</p>
          ) : (
            docsContrato.map((d) => (
              <DocRow key={d.id} d={d} tipoNome={tipoNome(d.doc_tipo_id)}
                onEdit={() => setEditModal(d)} onDelete={() => handleDelete(d.id)} />
            ))
          )}
        </section>

        {/* Nível postos */}
        {postosTotal.map((posto) => {
          const docsPosto = configs.filter((c) => c.posto === posto);
          const expanded = expandedPostos.has(posto);
          return (
            <section key={posto}>
              <button onClick={() => togglePosto(posto)}
                className="flex w-full items-center gap-2 bg-muted/20 px-4 py-2 hover:bg-muted/40 transition-colors">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex-1 text-left truncate">
                  {posto}
                </span>
                <span className="text-[11px] text-muted-foreground">{docsPosto.length} doc{docsPosto.length !== 1 ? "s" : ""}</span>
                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded && (
                <>
                  {docsPosto.length === 0 ? (
                    <p className="px-6 py-3 text-xs text-muted-foreground italic">Nenhum documento específico para este posto.</p>
                  ) : (
                    docsPosto.map((d) => (
                      <DocRow key={d.id} d={d} tipoNome={tipoNome(d.doc_tipo_id)}
                        onEdit={() => setEditModal(d)} onDelete={() => handleDelete(d.id)} />
                    ))
                  )}
                  <div className="px-6 py-2">
                    <button onClick={() => setAddModal({ posto })}
                      className="inline-flex h-7 items-center gap-1.5 rounded border border-dashed border-border px-3 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      <Plus className="h-3 w-3" /> Adicionar doc para este posto
                    </button>
                  </div>
                </>
              )}
            </section>
          );
        })}
      </div>

      {/* Modal adicionar */}
      <Dialog open={!!addModal} onOpenChange={(o) => !o && setAddModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {addModal?.posto ? `Adicionar documento — ${addModal.posto}` : "Adicionar documento — Contrato geral"}
            </DialogTitle>
          </DialogHeader>
          {addModal && (
            <DocForm
              tipos={tipos}
              jaAdicionados={configs.filter((c) => c.posto === addModal.posto).map((c) => c.doc_tipo_id)}
              onSave={async (payload) => {
                await save.mutateAsync({ contrato_id: contratoId, posto: addModal.posto, ...payload });
                setAddModal(null);
              }}
              onCancel={() => setAddModal(null)}
              saving={save.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal editar */}
      <Dialog open={!!editModal} onOpenChange={(o) => !o && setEditModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Editar documento</DialogTitle>
          </DialogHeader>
          {editModal && (
            <DocForm
              tipos={tipos}
              jaAdicionados={[]}
              initial={editModal}
              onSave={async (payload) => {
                await save.mutateAsync({ id: editModal.id, contrato_id: contratoId, posto: editModal.posto, ...payload });
                setEditModal(null);
              }}
              onCancel={() => setEditModal(null)}
              saving={save.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DocRow({ d, tipoNome, onEdit, onDelete }: {
  d: ContratoDocConfig; tipoNome: string;
  onEdit: () => void; onDelete: () => void;
}) {
  const label = periodLabel(d);
  return (
    <div className="flex items-center gap-3 px-6 py-2.5 hover:bg-muted/10">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{tipoNome}</span>
          {label && (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${BADGE[d.periodicidade!] ?? "bg-muted text-muted-foreground"}`}>
              {label}
            </span>
          )}
          {!d.obrigatorio && <span className="text-[10px] text-muted-foreground italic">opcional</span>}
        </div>
        {d.observacoes && <p className="text-[11px] text-muted-foreground mt-0.5">{d.observacoes}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={onEdit} className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={onDelete} className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ─── Form de documento ────────────────────────────────────────────────────────

function DocForm({ tipos, jaAdicionados, initial, onSave, onCancel, saving }: {
  tipos: DocTipo[];
  jaAdicionados: string[];
  initial?: ContratoDocConfig;
  onSave: (p: { doc_tipo_id: string; periodicidade: string | null; recorrencia: string | null; obrigatorio: boolean; observacoes: string | null }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const disponiveis = tipos.filter((t) => initial?.doc_tipo_id === t.id || !jaAdicionados.includes(t.id));
  const [docId, setDocId] = useState(initial?.doc_tipo_id ?? disponiveis[0]?.id ?? "");
  const [periodicidade, setPeriodicidade] = useState<string>(initial?.periodicidade ?? "mensal");
  const [recorrencia, setRecorrencia] = useState<string>(initial?.recorrencia ?? "mensal");
  const [obrigatorio, setObrigatorio] = useState(initial?.obrigatorio ?? true);
  const [observacoes, setObservacoes] = useState(initial?.observacoes ?? "");

  const isImplRec = periodicidade === "implantação + recorrência";

  return (
    <div className="space-y-4">
      {!initial && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Documento *</label>
          <select value={docId} onChange={(e) => setDocId(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary">
            {disponiveis.length === 0 && <option value="">Todos os documentos já foram adicionados</option>}
            {disponiveis.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
      )}

      <div className={`grid gap-3 ${isImplRec ? "grid-cols-3" : "grid-cols-2"}`}>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Periodicidade</label>
          <select value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary">
            <option value="">— sem periodicidade —</option>
            {PERIODICIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {isImplRec && (
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recorrência</label>
            <select value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary">
              {RECORRENCIAS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-col justify-end">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={obrigatorio} onChange={(e) => setObrigatorio(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary" />
            <span>Obrigatório</span>
          </label>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Observações</label>
        <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2}
          placeholder="Informações adicionais sobre este documento neste contrato…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none" />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm hover:bg-muted">Cancelar</button>
        <button
          onClick={() => {
            if (!docId) { toast.error("Selecione um documento."); return; }
            onSave({
              doc_tipo_id: docId,
              periodicidade: periodicidade || null,
              recorrencia: isImplRec ? recorrencia : null,
              obrigatorio,
              observacoes: observacoes.trim() || null,
            });
          }}
          disabled={saving || disponiveis.length === 0}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
