import { useState, useMemo } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Clock, Eye, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  useCotacoesLicitacao,
  useCotacaoInsert,
  useCotacaoUpdate,
  useCotacaoDelete,
  useCotacaoMarcarRespostaVista,
  useCotacaoRemoverAnexo,
  type CotacaoLicitacao,
} from "@/hooks/useCotacoesLicitacao";
import { usePermissoes } from "@/context/PermissoesContext";
// Paleta, badge, formatação e agrupamento moram em um só lugar: esta tela e a
// de Compras (/app/suprimentos/cotacoes) mostram a MESMA linha do banco, e
// divergir na aparência confundiria os dois setores sobre o mesmo item.
import {
  MESES, STATUS_CONFIG, StatusBadge, ListaAnexos, SeletorArquivos,
  fmtDatetime, iniciais, agruparPorAnoMes,
} from "@/components/cotacoes/comum";

const TIPOS = ["Cotação", "Outro"];

// ── Card de cotação ───────────────────────────────────────────────────────────
function CotacaoCard({
  cotacao, canEditar, onEdit, onDelete,
}: {
  cotacao: CotacaoLicitacao;
  canEditar: boolean;
  onEdit: (c: CotacaoLicitacao) => void;
  onDelete: (c: CotacaoLicitacao) => void;
}) {
  const marcarVista = useCotacaoMarcarRespostaVista();
  const removerAnexo = useCotacaoRemoverAnexo();
  const [open, setOpen] = useState(false);

  function toggle() {
    // Se respondido e resposta ainda não vista, marca como vista
    if (!open && cotacao.status === "respondido" && !cotacao.resposta_visualizada_em) {
      marcarVista.mutate(cotacao.id);
    }
    setOpen((v) => !v);
  }

  const cfg = STATUS_CONFIG[cotacao.status];

  const initials = iniciais(cotacao.remetente_nome);

  return (
    <div className={cn("rounded-lg border bg-card overflow-hidden transition-shadow border-l-4", cfg.border, cfg.accent, open && "shadow-md")}>
      {/* Header colorido por status */}
      <button
        onClick={toggle}
        className={cn("w-full flex items-center justify-between gap-3 px-4 py-3 text-left", cfg.headerBg)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Avatar de iniciais */}
          <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold", cfg.bg, cfg.text)}>
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className={cn("text-sm font-semibold truncate", cfg.headerText)}>{cotacao.remetente_nome}</p>
              <span className="text-xs text-muted-foreground font-medium">{cotacao.tipo}</span>
              {cotacao.status === "respondido" && !cotacao.resposta_visualizada_em && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">Nova resposta</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{fmtDatetime(cotacao.created_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={cotacao.status} />
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-3 space-y-0 border-t border-border/50">
          {/* Timeline */}
          <div className="relative pl-5">
            {/* Linha vertical */}
            <div className="absolute left-1.5 top-2 bottom-2 w-px bg-border" />

            {/* Mensagem original */}
            <div className="relative mb-4">
              <div className="absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground/50" />
              <div className="space-y-2">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{cotacao.comentario}</p>
                <ListaAnexos
                  anexos={cotacao.anexosSolicitacao}
                  // Tirar anexo só faz sentido enquanto Compras ainda não respondeu.
                  onRemover={canEditar && cotacao.status !== "respondido"
                    ? (a) => removerAnexo.mutate(a.id)
                    : undefined}
                />
                {cotacao.visualizado_por_nome && (
                  <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                    {/* PESSOA, nunca setor: é assim que se enxerga alguém
                        indevido olhando a cotação. */}
                    <Eye className="h-3 w-3" /> Lido por {cotacao.visualizado_por_nome} em {fmtDatetime(cotacao.visualizado_em)}
                  </p>
                )}
                {cotacao.editado_em && (
                  <p className="text-xs text-muted-foreground italic">
                    Editado por {cotacao.editado_por_nome} em {fmtDatetime(cotacao.editado_em)}
                  </p>
                )}
              </div>
            </div>

            {/* Resposta de Compras */}
            {cotacao.status === "respondido" && (
              <div className="relative">
                <div className="absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500" />
                <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 p-3 space-y-2">
                  <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Resposta de {cotacao.respondente_nome}
                  </p>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{cotacao.resposta_comentario}</p>
                  <ListaAnexos anexos={cotacao.anexosResposta} tom="resposta" />
                  <p className="text-xs text-muted-foreground">{fmtDatetime(cotacao.data_resposta)}</p>
                  {cotacao.resposta_visualizada_em && (
                    <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                      {/* Nome de quem leu, não "você": quem abre este card pode
                          não ser quem leu primeiro, e é isso que se quer ver. */}
                      <Eye className="h-3 w-3" /> Lido por {cotacao.resposta_visualizada_por_nome} em {fmtDatetime(cotacao.resposta_visualizada_em)}
                    </p>
                  )}
                </div>
              </div>
            )}

            {cotacao.status === "pendente" && (
              <div className="relative">
                <div className="absolute -left-[13px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-background bg-red-400" />
                <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Aguardando resposta de Compras…
                </p>
              </div>
            )}
          </div>

          {/* Ações */}
          {canEditar && cotacao.status !== "respondido" && (
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={() => onEdit(cotacao)}>
                <Pencil className="h-3.5 w-3.5" /> Editar
              </Button>
              <Button size="sm" variant="destructive" className="gap-1.5 h-8 text-xs" onClick={() => onDelete(cotacao)}>
                <Trash2 className="h-3.5 w-3.5" /> Excluir
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modal de nova / editar cotação ────────────────────────────────────────────
function CotacaoModal({
  editing,
  onClose,
  remetenteNome,
  remetenteId,
}: {
  editing: CotacaoLicitacao | null;
  onClose: () => void;
  remetenteNome: string;
  remetenteId: string;
}) {
  const insert = useCotacaoInsert();
  const update = useCotacaoUpdate();
  const [tipo, setTipo] = useState(editing?.tipo ?? "Cotação");
  const [comentario, setComentario] = useState(editing?.comentario ?? "");
  const [arquivos, setArquivos] = useState<File[]>([]);

  const loading = insert.isPending || update.isPending;

  // Ao editar, os anexos já enviados continuam lá (dá para removê-los pelo
  // card); aqui só se ACRESCENTA. Por isso o obrigatório vale só na criação.
  const jaTemAnexo = (editing?.anexosSolicitacao.length ?? 0) > 0;
  const pronto = !!comentario.trim() && (arquivos.length > 0 || jaTemAnexo) && !loading;

  async function handleSave() {
    if (!pronto) return;
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, comentario, arquivos, editado_por_nome: remetenteNome, editado_por_id: remetenteId });
      } else {
        await insert.mutateAsync({ tipo, comentario, arquivos, remetente_nome: remetenteNome });
      }
      onClose();
    } catch (e) {
      toast.error("Não foi possível enviar", { description: (e as Error).message });
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !loading && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar Solicitação" : "Nova Solicitação"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!editing && (
            <div className="space-y-1.5">
              <Label>Tipo de Solicitação *</Label>
              <Select value={tipo} onValueChange={setTipo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Comentário *</Label>
            <Textarea
              rows={4}
              placeholder="Ex: Cotação da licitação de São Paulo para cotar até dia 05/01/2025"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Anexos * (qualquer formato, até 10 MB cada)</Label>
            {jaTemAnexo && (
              <p className="text-xs text-muted-foreground">
                {editing!.anexosSolicitacao.length} arquivo(s) já enviado(s). O que você escolher
                aqui será acrescentado; para tirar algum, use o X no card.
              </p>
            )}
            <SeletorArquivos arquivos={arquivos} onChange={setArquivos} />
          </div>
          <div className="space-y-1.5">
            <Label>Remetente</Label>
            <Input value={remetenteNome} disabled />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={!pronto}>
            {loading ? "Enviando…" : "Enviar Solicitação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function CotacoesLicitacao() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const { data: cotacoes = [], isLoading } = useCotacoesLicitacao();
  const deleteMutation = useCotacaoDelete();

  const canIncluir = can("incluir", "licitacoes", "cotacoes-licitacao");
  const canAlterar = can("alterar", "licitacoes", "cotacoes-licitacao");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CotacaoLicitacao | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CotacaoLicitacao | null>(null);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set([new Date().getFullYear()]));
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set([
    `${new Date().getFullYear()}-${new Date().getMonth()}`,
  ]));

  // Agrupar por ano → mês
  const grouped = useMemo(() => agruparPorAnoMes(cotacoes), [cotacoes]);

  const pendentesNaoVistas = cotacoes.filter(
    (c) => c.status === "respondido" && !c.resposta_visualizada_em
  ).length;

  function toggleYear(year: number) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      next.has(year) ? next.delete(year) : next.add(year);
      return next;
    });
  }

  function toggleMonth(year: number, month: number) {
    const key = `${year}-${month}`;
    setExpandedMonths((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const remetenteNome = (user as any)?.user_metadata?.display_name ?? user?.email ?? "";
  const remetenteId = user?.id ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cotações"
        breadcrumb={["Licitações", "Cotações"]}
        subtitle="Solicitações de cotação para o setor de Compras."
        actions={
          canIncluir ? (
            <Button size="sm" onClick={() => { setEditing(null); setModalOpen(true); }} className="gap-2">
              <Plus className="h-4 w-4" />
              Nova Solicitação
              {pendentesNaoVistas > 0 && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 text-xs font-bold">{pendentesNaoVistas}</span>
              )}
            </Button>
          ) : null
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : cotacoes.length === 0 ? (
        <div className="card-elevated p-10 text-center text-muted-foreground text-sm">
          Nenhuma cotação enviada ainda.
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ year, total, months }) => (
            <div key={year} className="rounded-lg border border-border overflow-hidden">
              {/* Cabeçalho do ano */}
              <button
                onClick={() => toggleYear(year)}
                className="w-full flex items-center justify-between px-5 py-3 bg-primary text-primary-foreground font-semibold text-sm"
              >
                <span className="flex items-center gap-2">
                  {expandedYears.has(year) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {year}
                </span>
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-bold">{total} cotações</span>
              </button>

              {expandedYears.has(year) && (
                <div className="p-3 space-y-2 bg-card">
                  {months.map(({ month, items }) => {
                    const key = `${year}-${month}`;
                    const pendentes = items.filter((c) => c.status === "pendente").length;
                    const isOpen = expandedMonths.has(key);
                    return (
                      <div key={key} className="rounded-md border border-border overflow-hidden">
                        <button
                          onClick={() => toggleMonth(year, month)}
                          className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/50 hover:bg-muted text-sm font-medium"
                        >
                          <span className="flex items-center gap-2">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {MESES[month]}
                          </span>
                          <span className={cn(
                            "rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                            pendentes > 0
                              ? "bg-red-500/15 text-red-600 border border-red-400/40"
                              : "bg-emerald-500/15 text-emerald-600 border border-emerald-400/40"
                          )}>
                            {pendentes > 0 ? `${pendentes} Pendente${pendentes > 1 ? "s" : ""}` : `${items.length} Respondido${items.length > 1 ? "s" : ""}`}
                          </span>
                        </button>

                        {isOpen && (
                          <div className="p-3 space-y-2">
                            {items.map((c) => (
                              <CotacaoCard
                                key={c.id}
                                cotacao={c}
                                canEditar={canAlterar}
                                onEdit={(item) => { setEditing(item); setModalOpen(true); }}
                                onDelete={setDeleteTarget}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <CotacaoModal
          editing={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          remetenteNome={remetenteNome}
          remetenteId={remetenteId}
        />
      )}

      {deleteTarget && (
        <AlertDialog open onOpenChange={(o) => !o && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir cotação?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async () => {
                  try {
                    await deleteMutation.mutateAsync(deleteTarget.id);
                    toast.success("Cotação excluída.");
                  } catch (e) {
                    toast.error("Não foi possível excluir", { description: (e as Error).message });
                  }
                  setDeleteTarget(null);
                }}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
