import { useState, useMemo, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { usePermissoes } from "@/context/PermissoesContext";
import { cn } from "@/lib/utils";
import {
  useCapaEdital,
  useCapaInsert,
  useCapaUpdate,
  useCapaDelete,
  useCapaPromover,
} from "@/hooks/useCapaEdital";
import type { CapaEdital, CapaStatus } from "@/hooks/useCapaEdital";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Eye, History, FileText, AlertCircle } from "lucide-react";
import { useUsuariosLicitacao } from "@/hooks/useUsuariosLicitacao";
import { useIBGEMunicipios, UFS } from "@/hooks/useIBGEMunicipios";
import { CidadeCombobox } from "@/components/ui/CidadeCombobox";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { PrazoInput } from "@/components/ui/PrazoInput";

const REAJUSTE_OPCOES = ["IPCA", "IGPM", "INPC", "Convenção coletiva"];

const ESCALAS = ["5x2", "6x1", "4x3", "12x36"];
const HORAS_OPCOES = ["20h", "30h", "36h", "40h", "44h"];

// Armazena como "5x2 — 40h" ou texto livre
function CargaHorariaInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // Parse: "5x2 — 40h" → { escala: "5x2", horas: "40h" } | texto livre
  function parse(v: string) {
    const m = v.match(/^(.+?)\s*—\s*(.+)$/);
    if (m) return { escala: m[1].trim(), horas: m[2].trim() };
    const soEscala = ESCALAS.includes(v.trim());
    if (soEscala) return { escala: v.trim(), horas: "" };
    return { escala: "", horas: v };
  }
  const parsed = parse(value);
  const [escala, setEscala] = useState(parsed.escala);
  const [horas, setHoras]   = useState(parsed.horas);

  useEffect(() => {
    const p = parse(value);
    setEscala(p.escala);
    setHoras(p.horas);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(e: string, h: string) {
    if (e && h) onChange(`${e} — ${h}`);
    else if (e) onChange(e);
    else onChange(h);
  }

  return (
    <div className="flex gap-1">
      <Select value={escala || "_"} onValueChange={(v) => { const e = v === "_" ? "" : v; setEscala(e); emit(e, horas); }}>
        <SelectTrigger className="h-9 w-28 shrink-0"><SelectValue placeholder="Escala" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_">— Escala —</SelectItem>
          {ESCALAS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={horas || "_"} onValueChange={(v) => { const h = v === "_" ? "" : v; setHoras(h); emit(escala, h); }}>
        <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Horas" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="_">— Horas —</SelectItem>
          {HORAS_OPCOES.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
          <SelectItem value="outro">Outro</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Constantes ─────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<CapaStatus, string> = {
  "Em andamento": "bg-amber-500/15 text-amber-700 border-amber-300/50",
  "Ganhamos":     "bg-emerald-500/15 text-emerald-700 border-emerald-300/50",
  "Perdemos":     "bg-red-400/15 text-red-700 border-red-300/50",
};

// Alerta de 48h: só exibe se ganhou há menos de 48h E ainda não tem reuniao_alinhamento
function needs48hAlert(capa: CapaEdital): boolean {
  if (capa.status !== "Ganhamos") return false;
  if (capa.reuniao_alinhamento) return false;
  if (!capa.data_homologacao) return false;
  const homol = new Date(capa.data_homologacao).getTime();
  const diff = Date.now() - homol;
  return diff < 48 * 60 * 60 * 1000;
}

// ── Componente principal ───────────────────────────────────────────────────

export default function CadastroEdital() {
  const { empresa } = useEmpresaAtiva();
  const empresaAtivaId = empresa.id;
  const { can } = usePermissoes();

  const canIncluir = can("incluir", "licitacoes", "editais");
  const canAlterar = can("alterar", "licitacoes", "editais");
  const canExcluir = can("excluir", "licitacoes", "editais");

  const { data: capas = [], isLoading, error } = useCapaEdital(empresaAtivaId ?? null);
  const insert = useCapaInsert(empresaAtivaId ?? "");
  const update = useCapaUpdate(empresaAtivaId ?? "");
  const remove = useCapaDelete(empresaAtivaId ?? "");
  const promover = useCapaPromover(empresaAtivaId ?? "");

  const [statusFiltro, setStatusFiltro] = useState<CapaStatus | "Todas">("Todas");
  const [busca, setBusca] = useState("");

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CapaEdital | null>(null);
  const [viewItem, setViewItem] = useState<CapaEdital | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CapaEdital | null>(null);
  const [promoverTarget, setPromoverTarget] = useState<CapaEdital | null>(null);
  const [reuniaoModal, setReuniaoModal] = useState<CapaEdital | null>(null);

  const stats = useMemo(() => {
    const m: Record<CapaStatus, number> = { "Em andamento": 0, "Ganhamos": 0, "Perdemos": 0 };
    capas.forEach((c) => { if (c.status in m) m[c.status]++; });
    return m;
  }, [capas]);

  const filtered = useMemo(() => {
    let list = [...capas];
    if (statusFiltro !== "Todas") list = list.filter((c) => c.status === statusFiltro);
    if (busca.trim()) {
      const q = busca.toLowerCase();
      list = list.filter(
        (c) =>
          c.cidade?.toLowerCase().includes(q) ||
          c.objeto?.toLowerCase().includes(q) ||
          c.modalidade?.toLowerCase().includes(q) ||
          c.escritorio?.toLowerCase().includes(q) ||
          c.responsavel?.toLowerCase().includes(q)
      );
    }
    // Ordena pela abertura mais próxima (sem data vai pro fim)
    list.sort((a, b) => {
      if (!a.abertura && !b.abertura) return 0;
      if (!a.abertura) return 1;
      if (!b.abertura) return -1;
      return a.abertura.localeCompare(b.abertura);
    });
    return list;
  }, [capas, statusFiltro, busca]);

  const alertas = capas.filter(needs48hAlert);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Capa de Edital Licitações"
        breadcrumb={["Capa de Edital Licitações"]}
        subtitle="Detalhamento completo das licitações — do preenchimento à homologação."
        actions={
          canIncluir ? (
            <Button size="sm" onClick={() => { setEditing(null); setSheetOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" /> Nova Licitação
            </Button>
          ) : null
        }
      />

      {/* Alerta 48h */}
      {alertas.length > 0 && (
        <div className="rounded-lg border border-amber-400/50 bg-amber-500/10 p-3">
          <div className="flex items-start gap-2 text-amber-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-xs">
              <span className="font-bold">Atenção — Reunião de alinhamento pendente!</span>
              {alertas.map((a) => (
                <p key={a.id} className="mt-0.5">
                  <strong>{a.objeto || a.cidade || "Licitação"}</strong> ganhou há menos de 48h e ainda não tem reunião agendada.{" "}
                  <button
                    className="underline font-semibold"
                    onClick={() => setReuniaoModal(a)}
                  >
                    Agendar agora
                  </button>
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs de status */}
      <div className="flex flex-wrap gap-2">
        {(["Todas", "Em andamento", "Ganhamos", "Perdemos"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFiltro(s)}
            className={cn(
              "rounded-lg border px-3 py-2 text-xs font-medium transition",
              statusFiltro === s
                ? s === "Todas"
                  ? "border-primary bg-primary text-primary-foreground"
                  : STATUS_COLOR[s as CapaStatus]
                : "border-border bg-card text-muted-foreground hover:bg-secondary"
            )}
          >
            {s}
            {s !== "Todas" && (
              <span className="ml-2 font-bold">{stats[s as CapaStatus]}</span>
            )}
            {s === "Todas" && (
              <span className="ml-2 font-bold">{capas.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Busca */}
      <div className="card-elevated p-3">
        <Input
          placeholder="Buscar por cidade, objeto, modalidade…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="h-9 max-w-sm"
        />
      </div>

      {/* Conteúdo */}
      {!empresaAtivaId ? (
        <Empty title="Selecione uma empresa" message="Escolha uma empresa para ver as licitações." />
      ) : isLoading ? (
        <Empty title="Carregando…" message="Buscando licitações." />
      ) : error ? (
        <Empty title="Erro" message={(error as Error).message} tone="error" />
      ) : filtered.length === 0 ? (
        <Empty
          title="Nenhuma licitação encontrada"
          message={canIncluir ? 'Clique em "Nova Licitação" ou promova da Grade.' : "Nenhum registro ainda."}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((capa) => (
            <CapaCard
              key={capa.id}
              capa={capa}
              canAlterar={canAlterar}
              canExcluir={canExcluir}
              onEdit={() => { setEditing(capa); setSheetOpen(true); }}
              onView={() => setViewItem(capa)}
              onDelete={() => setDeleteTarget(capa)}
              onPromover={() => {
                if (!capa.reuniao_alinhamento) {
                  setReuniaoModal(capa);
                } else {
                  setPromoverTarget(capa);
                }
              }}
              onStatusChange={(status) =>
                update.mutate({ id: capa.id, changes: { status }, current: capa })
              }
            />
          ))}
        </div>
      )}

      {/* Sheet criar/editar */}
      <CapaSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editing={editing}
        onSave={(payload) => {
          if (editing) {
            update.mutate(
              { id: editing.id, changes: payload, current: editing },
              { onSuccess: () => setSheetOpen(false) }
            );
          } else {
            insert.mutate(payload, { onSuccess: () => setSheetOpen(false) });
          }
        }}
        isSaving={insert.isPending || update.isPending}
      />

      {/* Modal visualizar */}
      {viewItem && <ViewModal capa={viewItem} onClose={() => setViewItem(null)} />}

      {/* Modal reunião de alinhamento */}
      {reuniaoModal && (
        <ReuniaoModal
          capa={reuniaoModal}
          onClose={() => setReuniaoModal(null)}
          onConfirm={(data) => {
            update.mutate(
              { id: reuniaoModal.id, changes: { reuniao_alinhamento: data }, current: reuniaoModal },
              {
                onSuccess: () => {
                  setReuniaoModal(null);
                  // Se veio do fluxo de criar contrato, abre confirmação de promoção
                  if (reuniaoModal.status === "Ganhamos" && !reuniaoModal.contrato_id) {
                    setPromoverTarget({ ...reuniaoModal, reuniao_alinhamento: data });
                  }
                },
              }
            );
          }}
        />
      )}

      {/* Confirmar exclusão */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir licitação?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. A licitação <strong>{deleteTarget?.objeto || deleteTarget?.cidade}</strong> será removida.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) remove.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) });
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar criação de contrato */}
      <AlertDialog open={!!promoverTarget} onOpenChange={(o) => !o && setPromoverTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Criar contrato de implantação?</AlertDialogTitle>
            <AlertDialogDescription>
              Um contrato será criado para{" "}
              <strong>{promoverTarget?.objeto || promoverTarget?.cidade || "esta licitação"}</strong> e ficará disponível
              no módulo <strong>Implantação de Contratos</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (promoverTarget)
                  promover.mutate(
                    { capa: promoverTarget, reuniaoAlinhamento: promoverTarget.reuniao_alinhamento ?? "" },
                    { onSuccess: () => setPromoverTarget(null) }
                  );
              }}
            >
              Criar Contrato
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

function CapaCard({
  capa, canAlterar, canExcluir, onEdit, onView, onDelete, onPromover, onStatusChange,
}: {
  capa: CapaEdital;
  canAlterar: boolean;
  canExcluir: boolean;
  onEdit: () => void;
  onView: () => void;
  onDelete: () => void;
  onPromover: () => void;
  onStatusChange: (s: CapaStatus) => void;
}) {
  const alert48 = needs48hAlert(capa);

  return (
    <article className={cn("card-floating space-y-3 p-4", alert48 && "border-amber-400/60")}>
      {alert48 && (
        <div className="flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700">
          <AlertCircle className="h-3 w-3" /> Reunião de alinhamento pendente — 48h
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 flex-1 text-sm font-semibold leading-snug">{capa.objeto || "Sem objeto"}</p>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold", STATUS_COLOR[capa.status])}>
          {capa.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span><span className="font-medium text-foreground">Cidade:</span> {capa.cidade || "—"}</span>
        <span><span className="font-medium text-foreground">Modalidade:</span> {capa.modalidade || "—"}</span>
        <span><span className="font-medium text-foreground">Abertura:</span> {capa.abertura ? capa.abertura.replace(/^(\d{4})-(\d{2})-(\d{2})/, "$3/$2/$1").replace(/H/i, "h") : "—"}</span>
        <span><span className="font-medium text-foreground">Postos:</span> {capa.qtd_postos ?? "—"}</span>
        <span className="col-span-2"><span className="font-medium text-foreground">Responsável:</span> {capa.responsavel || "—"}</span>
        {capa.valor_estimado && (
          <span className="col-span-2"><span className="font-medium text-foreground">Valor:</span> {capa.valor_estimado}</span>
        )}
        {capa.escritorio && (
          <span className="col-span-2"><span className="font-medium text-foreground">Escritório:</span> {capa.escritorio}</span>
        )}
      </div>

      {/* Alterar status — qualquer direção */}
      {canAlterar && (
        <div className="flex flex-wrap gap-1.5 border-t border-border pt-2.5">
          {(["Em andamento", "Ganhamos", "Perdemos"] as CapaStatus[])
            .filter((s) => s !== capa.status)
            .map((s) => (
              <Button
                key={s}
                size="sm" variant="outline"
                className={cn(
                  "h-7 flex-1 text-[11px]",
                  s === "Ganhamos" && "border-emerald-400/50 text-emerald-700 hover:bg-emerald-50",
                  s === "Perdemos" && "border-red-400/50 text-red-700 hover:bg-red-50",
                  s === "Em andamento" && "border-amber-400/50 text-amber-700 hover:bg-amber-50",
                )}
                onClick={() => onStatusChange(s)}
              >
                {s}
              </Button>
            ))}
        </div>
      )}

      {/* Ações */}
      <div className="flex items-center justify-between border-t border-border pt-2.5">
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onView} title="Visualizar">
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {canAlterar && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {canExcluir && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete} title="Excluir">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {canAlterar && capa.status === "Ganhamos" && !capa.contrato_id && (
          <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={onPromover}>
            <FileText className="h-3 w-3" /> Criar Contrato
          </Button>
        )}
        {capa.contrato_id && (
          <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            Contrato criado
          </span>
        )}
      </div>
    </article>
  );
}

// ── Sheet form ─────────────────────────────────────────────────────────────

const EMPTY: Partial<CapaEdital> = {
  cidade: "", uf: "", cliente: "", objeto: "", modalidade: "", local: "", forma_julgamento: "",
  atestado_cap_tecnica: "", escritorio: "", abertura: "", prazo_impugnacao: "",
  prazo_recurso: "", validade_proposta: "", prazo_contrato: "", visita_tecnica: "",
  data_inicio: "", qtd_postos: null, carga_horaria: "", valor_estimado: "",
  issqn: "", vale_transporte_valor: "", garantia: "", garantia_proposta: "", garantia_contratual: "", material: "", material_tipo: "",
  reajuste: [],
  trabalho_escolar: false, emergencial: false, diluicao_meses: 12,
  conta_vinculada: "", conta_vinculada_quem_abre: "",
  responsavel: "", observacoes: "",
};

function CapaSheet({
  open, onOpenChange, editing, onSave, isSaving,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: CapaEdital | null;
  onSave: (p: Partial<CapaEdital>) => void;
  isSaving: boolean;
}) {
  const [f, setF] = useState<Partial<CapaEdital>>({ ...EMPTY });
  const { data: usuarios = [] } = useUsuariosLicitacao();
  const { cidadesPorUF, isLoading: ibgeLoading } = useIBGEMunicipios();
  const cidadesUF = f.uf ? cidadesPorUF(f.uf) : [];

  useEffect(() => {
    if (!open) return;
    setF(editing ? { ...editing } : { ...EMPTY });
  }, [open, editing?.id]);

  const txt = (key: keyof CapaEdital) => (
    <Input
      value={(f[key] as string) ?? ""}
      onChange={(e) => setF((p) => ({ ...p, [key]: e.target.value }))}
      className="h-9"
    />
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(f);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar Licitação" : "Nova Licitação"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-2 space-y-6">

          <Secao title="Identificação">
            <Grid2>
              <F label="UF">
                <Select
                  value={f.uf ?? ""}
                  onValueChange={(v) => setF((p) => ({ ...p, uf: v, cidade: "" }))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="— Selecione —" />
                  </SelectTrigger>
                  <SelectContent>
                    {UFS.map((uf) => (
                      <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </F>
              <F label="Cidade">
                <CidadeCombobox
                  cidades={cidadesUF}
                  value={f.cidade ?? ""}
                  onChange={(v) => setF((p) => ({ ...p, cidade: v }))}
                  disabled={!f.uf || ibgeLoading}
                  placeholder={!f.uf ? "Selecione a UF" : ibgeLoading ? "Carregando…" : "Buscar cidade…"}
                />
              </F>
              <F label="Cliente / Órgão">{txt("cliente")}</F>
              <F label="Modalidade">{txt("modalidade")}</F>
              <F label="Responsável *">
                {usuarios.length > 0 ? (
                  <Select
                    value={f.responsavel ?? ""}
                    onValueChange={(v) => setF((p) => ({ ...p, responsavel: v }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="— Selecione —" />
                    </SelectTrigger>
                    <SelectContent>
                      {usuarios.map((u) => (
                        <SelectItem key={u.id} value={u.display_name ?? u.id}>
                          {u.display_name ?? u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={f.responsavel ?? ""}
                    onChange={(e) => setF((p) => ({ ...p, responsavel: e.target.value }))}
                    className="h-9"
                    placeholder="Nome do responsável"
                    required
                  />
                )}
              </F>
              <F label="Forma de julgamento">{txt("forma_julgamento")}</F>
              <F label="Escritório">{txt("escritorio")}</F>
              <F label="Local">{txt("local")}</F>
              <F label="Atestado cap. técnica">{txt("atestado_cap_tecnica")}</F>
            </Grid2>
            <F label="Objeto">
              <Textarea value={(f.objeto as string) ?? ""} onChange={(e) => setF((p) => ({ ...p, objeto: e.target.value }))} rows={2} />
            </F>
          </Secao>

          <Secao title="Datas e Prazos">
            <Grid2>
              <F label="Abertura">{txt("abertura")}</F>
              <F label="Prazo impugnação">
                <PrazoInput value={(f.prazo_impugnacao as string) ?? ""} onChange={(v) => setF((p) => ({ ...p, prazo_impugnacao: v }))} />
              </F>
              <F label="Prazo recurso">
                <PrazoInput value={(f.prazo_recurso as string) ?? ""} onChange={(v) => setF((p) => ({ ...p, prazo_recurso: v }))} />
              </F>
              <F label="Validade proposta">
                <PrazoInput value={(f.validade_proposta as string) ?? ""} onChange={(v) => setF((p) => ({ ...p, validade_proposta: v }))} />
              </F>
              <F label="Prazo contrato">
                <PrazoInput value={(f.prazo_contrato as string) ?? ""} onChange={(v) => setF((p) => ({ ...p, prazo_contrato: v }))} />
              </F>
              <F label="Visita técnica">{txt("visita_tecnica")}</F>
              <F label="Data início">
                <Input
                  type="date"
                  value={(f.data_inicio as string) ?? ""}
                  onChange={(e) => setF((p) => ({ ...p, data_inicio: e.target.value }))}
                  className="h-9"
                />
              </F>
            </Grid2>
          </Secao>

          <Secao title="Dimensionamento">
            <Grid2>
              <F label="Qtd. postos">
                <Input
                  type="number"
                  value={f.qtd_postos !== null && f.qtd_postos !== undefined ? String(f.qtd_postos) : ""}
                  onChange={(e) => setF((p) => ({ ...p, qtd_postos: e.target.value ? Number(e.target.value) : null }))}
                  className="h-9"
                />
              </F>
              <F label="Carga horária">
                <CargaHorariaInput
                  value={(f.carga_horaria as string) ?? ""}
                  onChange={(v) => setF((p) => ({ ...p, carga_horaria: v }))}
                />
              </F>
              <F label="Valor estimado">
                <CurrencyInput value={(f.valor_estimado as string) ?? ""} onChange={(v) => setF((p) => ({ ...p, valor_estimado: v }))} />
              </F>
              <F label="ISSQN">{txt("issqn")}</F>
              <F label="Vale transporte (valor)">{txt("vale_transporte_valor")}</F>
              <F label="Garantia da Proposta">{txt("garantia_proposta")}</F>
              <F label="Garantia Contratual">{txt("garantia_contratual")}</F>
              <F label="Material">{txt("material")}</F>
              <F label="Material (tipo)">{txt("material_tipo")}</F>
            </Grid2>
          </Secao>

          <Secao title="Condições Operacionais">
            <Grid2>
              {/* Trabalho escolar e Emergencial (item 5) */}
              <F label="Trabalho escolar">
                <div className="flex h-9 items-center gap-2">
                  <input
                    type="checkbox"
                    id="escolar"
                    checked={!!f.trabalho_escolar}
                    onChange={(e) => {
                      const escolar = e.target.checked;
                      setF((p) => ({
                        ...p,
                        trabalho_escolar: escolar,
                        diluicao_meses: escolar || p.emergencial ? (p.diluicao_meses ?? 11) : 12,
                      }));
                    }}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <label htmlFor="escolar" className="text-sm cursor-pointer">Sim</label>
                </div>
              </F>
              <F label="Emergencial">
                <div className="flex h-9 items-center gap-2">
                  <input
                    type="checkbox"
                    id="emergencial"
                    checked={!!f.emergencial}
                    onChange={(e) => {
                      const emerg = e.target.checked;
                      setF((p) => ({
                        ...p,
                        emergencial: emerg,
                        diluicao_meses: p.trabalho_escolar || emerg ? (p.diluicao_meses ?? 11) : 12,
                      }));
                    }}
                    className="h-4 w-4 rounded border-border accent-primary"
                  />
                  <label htmlFor="emergencial" className="text-sm cursor-pointer">Sim</label>
                </div>
              </F>
              {/* Diluição de verbas (item 5) */}
              <F label="Diluição de verbas (meses)">
                <Input
                  type="number"
                  min={1}
                  max={12}
                  value={f.diluicao_meses ?? 12}
                  disabled={!f.trabalho_escolar && !f.emergencial}
                  onChange={(e) => setF((p) => ({ ...p, diluicao_meses: Number(e.target.value) }))}
                  className="h-9"
                />
                {!f.trabalho_escolar && !f.emergencial && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Padrão: 12 meses</p>
                )}
              </F>
              <F label="Conta vinculada">{txt("conta_vinculada")}</F>
              <F label="Conta vinculada — quem abre">{txt("conta_vinculada_quem_abre")}</F>
            </Grid2>

            {/* Reajuste (item 6) */}
            <F label="Reajuste">
              <div className="flex flex-wrap gap-4 pt-1">
                {REAJUSTE_OPCOES.map((op) => (
                  <div key={op} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`reaj-${op}`}
                      checked={(f.reajuste ?? []).includes(op)}
                      onChange={(e) => {
                        const atual = f.reajuste ?? [];
                        setF((p) => ({
                          ...p,
                          reajuste: e.target.checked
                            ? [...atual, op]
                            : atual.filter((r) => r !== op),
                        }));
                      }}
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                    <label htmlFor={`reaj-${op}`} className="text-sm cursor-pointer">{op}</label>
                  </div>
                ))}
              </div>
            </F>
          </Secao>

          <Secao title="Observações">
            <Textarea
              value={(f.observacoes as string) ?? ""}
              onChange={(e) => setF((p) => ({ ...p, observacoes: e.target.value }))}
              rows={4}
              placeholder="Informações relevantes para a equipe…"
            />
          </Secao>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isSaving}>{isSaving ? "Salvando…" : editing ? "Salvar" : "Criar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal de visualização ─────────────────────────────────────────────────

function ViewModal({ capa, onClose }: { capa: CapaEdital; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-semibold", STATUS_COLOR[capa.status])}>
              {capa.status}
            </span>
            {capa.objeto || capa.cidade || "Licitação"}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-2 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {[
              ["Cidade", capa.cidade],
              ["Cliente / Órgão", capa.cliente],
              ["Modalidade", capa.modalidade],
              ["Abertura", capa.abertura],
              ["Data início", capa.data_inicio],
              ["Prazo contrato", capa.prazo_contrato],
              ["Qtd. postos", capa.qtd_postos !== null ? String(capa.qtd_postos) : null],
              ["Valor estimado", capa.valor_estimado],
              ["ISSQN", capa.issqn],
              ["Garantia", capa.garantia],
              ["Material", capa.material],
              ["Conta vinculada", capa.conta_vinculada],
              ["Escritório", capa.escritorio],
              ["Reunião alinhamento", capa.reuniao_alinhamento],
              ["Homologação", capa.data_homologacao],
            ].map(([l, v]) => (
              <div key={String(l)} className="flex gap-2">
                <span className="w-36 shrink-0 text-xs font-medium text-muted-foreground">{l}</span>
                <span className="text-xs">{v || "—"}</span>
              </div>
            ))}
          </div>

          {capa.observacoes && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">{capa.observacoes}</div>
          )}

          {capa.historico.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <History className="h-3.5 w-3.5" /> Histórico
              </p>
              <div className="space-y-1.5">
                {capa.historico.map((h, i) => (
                  <div key={i} className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">{h.campo}</span>: {h.de} → {h.para}
                    <span className="ml-2 text-[10px] opacity-60">{h.ts}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Modal reunião de alinhamento ──────────────────────────────────────────

function ReuniaoModal({ capa, onClose, onConfirm }: {
  capa: CapaEdital;
  onClose: () => void;
  onConfirm: (data: string) => void;
}) {
  const [data, setData] = useState(capa.reuniao_alinhamento ?? "");

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Agendar Reunião de Alinhamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">
            <strong>{capa.objeto || capa.cidade}</strong> — informe a data da reunião de alinhamento antes de criar o contrato.
          </p>
          <div className="space-y-1">
            <Label className="text-xs">Data da reunião</Label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="h-9" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!data} onClick={() => onConfirm(data)}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers de layout ─────────────────────────────────────────────────────

function Secao({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function Empty({ title, message, tone = "muted" }: { title: string; message: string; tone?: "muted" | "error" }) {
  return (
    <div className={cn(
      "rounded-lg border px-4 py-12 text-center text-sm",
      tone === "error" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted/30 text-muted-foreground"
    )}>
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1 text-xs">{message}</p>
    </div>
  );
}
