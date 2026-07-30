import { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { cn } from "@/lib/utils";
import {
  useImplantacaoContratos,
  useChecklistItems,
  useRespostas,
  useRespostaUpsert,
  calcPrazo,
} from "@/hooks/useImplantacao";
import type { ImplantacaoContrato, ChecklistItem, Resposta, HistoricoEntry } from "@/hooks/useImplantacao";
import { CheckCircle2, Circle, Clock, Pencil, Eye, ArrowRight, Trash2, MapPin, X as XIcon, CheckCircle, History } from "lucide-react";
import { useUsuariosEmpresa } from "@/hooks/useUsuariosEmpresa";
import { useDocTipos } from "@/hooks/useDocumentos";
import { usePlanilhaCustos } from "@/hooks/usePlanilhaCusto";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export default function Implantacao() {
  const { empresa } = useEmpresaAtiva();
  const empresaAtivaId = empresa.id;
  const { can } = usePermissoes();
  const podeExcluir = can("excluir", undefined, "implantacao");
  const { data: contratos = [], isLoading, error } = useImplantacaoContratos(empresaAtivaId);
  const { data: checklistItems = [] } = useChecklistItems();

  const [contratoSelecionado, setContratoSelecionado] = useState<string | null>(null);
  const [momentoFiltro, setMomentoFiltro] = useState<string>("");
  const [responsavelFiltro, setResponsavelFiltro] = useState<string>("");
  const [editandoNome, setEditandoNome] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ImplantacaoContrato | null>(null);
  const [nomeConfirmados, setNomeConfirmados] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("implantacao:nomes-confirmados");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const qc = useQueryClient();

  const contrato = contratos.find((c) => c.id === contratoSelecionado) ?? null;

  useMemo(() => {
    if (contratos.length > 0 && !contratoSelecionado) {
      setContratoSelecionado(contratos[0].id);
    }
  }, [contratos, contratoSelecionado]);

  const momentos      = useMemo(() => [...new Set(checklistItems.map((i) => i.momento).filter(Boolean) as string[])], [checklistItems]);
  const responsaveis  = useMemo(() => [...new Set(checklistItems.map((i) => i.responsavel_acao).filter(Boolean) as string[])].sort(), [checklistItems]);

  const itensFiltrados = useMemo(() => {
    return checklistItems.filter((i) => {
      if (momentoFiltro && i.momento !== momentoFiltro) return false;
      if (responsavelFiltro && i.responsavel_acao !== responsavelFiltro && i.responsavel_acao !== "Todos") return false;
      return true;
    });
  }, [checklistItems, momentoFiltro, responsavelFiltro]);

  const responsaveisFiltrados = useMemo(() => [...new Set(itensFiltrados.map((i) => i.responsavel_acao))], [itensFiltrados]);

  const { data: respostas = [] } = useRespostas(contratoSelecionado, empresaAtivaId ?? null);
  const upsert = useRespostaUpsert(empresaAtivaId ?? "");
  const { data: usuarios = [] } = useUsuariosEmpresa();
  const usuariosMap = useMemo(() => {
    const m: Record<string, string> = {};
    usuarios.forEach((u) => { m[u.id] = u.display_name ?? u.email ?? u.id; });
    return m;
  }, [usuarios]);

  async function handleDeleteContrato(id: string) {
    const { error } = await supabase.from("implantacao_contrato").delete().eq("id", id);
    if (error) { toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Contrato excluído." });
    qc.removeQueries({ queryKey: ["implantacao", empresaAtivaId] });
    const restantes = contratos.filter((c) => c.id !== id);
    setContratoSelecionado(restantes[0]?.id ?? null);
    setDeleteTarget(null);
    qc.invalidateQueries({ queryKey: ["implantacao", empresaAtivaId] });
  }

  const respostaMap = useMemo(() => {
    const m: Record<number, Resposta> = {};
    respostas.forEach((r) => { m[r.row_index] = r; });
    return m;
  }, [respostas]);

  const total       = checklistItems.length;
  const respondidos = checklistItems.filter((i) => respostaMap[i.row_index]?.resposta).length;
  const pct         = total > 0 ? Math.round((respondidos / total) * 100) : 0;

  function confirmarNome(id: string) {
    setNomeConfirmados((prev) => {
      const next = new Set([...prev, id]);
      localStorage.setItem("implantacao:nomes-confirmados", JSON.stringify([...next]));
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Implantação de Contratos"
        breadcrumb={["Contratos", "Implantação"]}
        subtitle="Checklist de implantação por contrato — acompanhe cada setor até a operação plena."
      />

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Kpi label="Contratos ativos"  value={String(contratos.filter((c) => c.status === "ativo").length)} />
        <Kpi label="Itens respondidos" value={`${respondidos}/${total}`} />
        <Kpi label="Progresso"         value={`${pct}%`} highlight={pct === 100} />
      </div>

      {!empresaAtivaId ? (
        <Empty title="Selecione uma empresa" message="" />
      ) : isLoading ? (
        <Empty title="Carregando contratos…" message="" />
      ) : error ? (
        <Empty title="Erro" message={(error as Error).message} tone="error" />
      ) : contratos.length === 0 ? (
        <Empty title="Nenhum contrato" message="Promova licitações ganhas no módulo Capa de Edital para criar contratos aqui." />
      ) : (
        <div className="space-y-4">
          {/* Seletor de contrato */}
          <div className="card-elevated flex flex-wrap items-center gap-3 p-3">
            <Select value={contratoSelecionado ?? ""} onValueChange={setContratoSelecionado}>
              <SelectTrigger className="h-9 min-w-[260px] max-w-sm">
                <SelectValue placeholder="Selecione o contrato" />
              </SelectTrigger>
              <SelectContent>
                {contratos.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contrato && (
              <div className="text-xs text-muted-foreground">
                Início: <span className="font-medium text-foreground">{contrato.data_inicio ?? "—"}</span>
                {" · "}Abertura: <span className="font-medium text-foreground">{contrato.abertura ?? "—"}</span>
              </div>
            )}
            {podeExcluir && contrato && (
              <Button variant="ghost" size="icon" className="ml-auto text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(contrato)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

          {/* Banner confirmação de nome */}
          {contrato && !nomeConfirmados.has(contrato.id) && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/50 bg-amber-500/10 px-4 py-3">
              <div className="text-xs text-amber-700">
                <span className="font-semibold">O nome do contrato está correto?</span>
                <span className="ml-2 font-mono">"{contrato.nome}"</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline"
                  className="h-7 gap-1.5 px-2 text-[11px] border-amber-400/50 text-amber-700 hover:bg-amber-50"
                  onClick={() => setEditandoNome(true)}>
                  <Pencil className="h-3 w-3" /> Editar
                </Button>
                <Button size="sm" className="h-7 px-2 text-[11px] bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => confirmarNome(contrato.id)}>
                  Confirmar
                </Button>
              </div>
            </div>
          )}

          {/* Barra de progresso */}
          {contrato && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Progresso geral</span>
                <span className="font-semibold">{pct}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )}

          {/* Filtro de Momento */}
          {momentos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <FiltroBtn active={momentoFiltro === ""} onClick={() => setMomentoFiltro("")}>Todos momentos</FiltroBtn>
              {momentos.map((m) => (
                <FiltroBtn key={m} active={momentoFiltro === m} onClick={() => setMomentoFiltro(momentoFiltro === m ? "" : m)}>{m}</FiltroBtn>
              ))}
            </div>
          )}

          {/* Filtro de Responsável */}
          {responsaveis.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <FiltroBtn active={responsavelFiltro === ""} onClick={() => setResponsavelFiltro("")} variant="setor">Todos responsáveis</FiltroBtn>
              {responsaveis.map((r) => (
                <FiltroBtn key={r} active={responsavelFiltro === r} onClick={() => setResponsavelFiltro(responsavelFiltro === r ? "" : r)} variant="setor">{r}</FiltroBtn>
              ))}
            </div>
          )}

          {/* Cards por setor */}
          {contrato && checklistItems.length === 0 ? (
            <Empty title="Checklist vazio" message="Nenhum item de checklist cadastrado." />
          ) : contrato ? (
            <div className="space-y-6">
              {responsaveisFiltrados.map((responsavel) => {
                const itensSetor = itensFiltrados.filter((i) => i.responsavel_acao === responsavel);
                const respSetor  = itensSetor.filter((i) => respostaMap[i.id]?.resposta).length;
                return (
                  <section key={responsavel}>
                    {/* Header do responsável */}
                    <div className="flex items-center gap-3 border-b border-border pb-2 mb-3 flex-wrap">
                      <span className="bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">{responsavel}</span>
                      <span className="font-bold text-sm">{responsavel}</span>
                      <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{respSetor}/{itensSetor.length}</span>
                        <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full transition-all"
                            style={{ width: `${itensSetor.length ? Math.round(respSetor / itensSetor.length * 100) : 0}%` }} />
                        </div>
                      </div>
                    </div>

                    {/* Grid de cards */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {itensSetor.map((item) => (
                        <CardChecklist
                          key={item.id}
                          item={item}
                          contrato={contrato}
                          resposta={respostaMap[item.row_index] ?? null}
                          usuariosMap={usuariosMap}
                          onSave={(resposta, obs) =>
                            upsert.mutateAsync({ contratoId: contratoSelecionado!, rowIndex: item.row_index, resposta, obs })
                          }
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {editandoNome && contrato && (
        <EditarNomeModal
          contrato={contrato}
          onClose={() => setEditandoNome(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["implantacao", empresaAtivaId] });
            confirmarNome(contrato.id);
          }}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              O contrato <strong>{deleteTarget?.nome}</strong> e todo o seu checklist serão removidos permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && handleDeleteContrato(deleteTarget.id)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Card individual ───────────────────────────────────────────────────────────

function isDocsItem(item: { categoria?: string | null; item: string }) {
  return item.categoria?.toLowerCase().includes("document") || item.item.toLowerCase().includes("document");
}
function isEnderecosItem(item: { item: string }) {
  return item.item.toLowerCase().includes("endere");
}

function DocMultiSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: tipos = [] } = useDocTipos();
  const [expanded, setExpanded] = useState(false);
  const selected: string[] = useMemo(() => {
    try { return value ? JSON.parse(value) : []; } catch { return value ? [value] : []; }
  }, [value]);

  function toggle(nome: string) {
    const next = selected.includes(nome) ? selected.filter((s) => s !== nome) : [...selected, nome];
    onChange(next.length ? JSON.stringify(next) : "");
  }

  return (
    <div className="space-y-2">
      {/* Resumo sempre visível */}
      {selected.length > 0 && (
        <button onClick={() => setExpanded((p) => !p)}
          className="w-full text-left rounded-md bg-primary/5 border border-primary/20 px-3 py-2 space-y-1 hover:bg-primary/10 transition-colors">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-primary">✓ {selected.length} documento{selected.length !== 1 ? "s" : ""} selecionado{selected.length !== 1 ? "s" : ""}</span>
            <span className="text-[10px] text-primary/70">{expanded ? "▲ fechar" : "▼ editar"}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {selected.map((nome) => (
              <span key={nome} className="text-[10px] text-primary/80">• {nome}</span>
            ))}
          </div>
        </button>
      )}

      {/* Lista completa — abre ao clicar ou quando vazio */}
      {(expanded || selected.length === 0) && (
        <div className="space-y-1">
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1 pb-1">
              {selected.map((nome) => (
                <span key={nome} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  {nome}
                  <button onClick={() => toggle(nome)} className="hover:text-destructive"><XIcon className="w-2.5 h-2.5" /></button>
                </span>
              ))}
            </div>
          )}
          <div className="max-h-40 overflow-y-auto rounded-md border border-border divide-y divide-border">
            {tipos.map((t) => {
              const ativo = selected.includes(t.nome);
              return (
                <button key={t.id} onClick={() => toggle(t.nome)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-muted/40 ${ativo ? "bg-primary/5 font-medium text-primary" : ""}`}>
                  <span className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${ativo ? "border-primary bg-primary text-white" : "border-border"}`}>
                    {ativo && <CheckCircle className="w-2.5 h-2.5" />}
                  </span>
                  {t.nome}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function EnderecosPostos({ contratoNome }: { contratoNome: string }) {
  const { data: planilhaRows = [] } = usePlanilhaCustos();
  const postos = useMemo(() => {
    const seen = new Set<string>();
    return planilhaRows
      .filter((r) => r.orexec === "EXECUTADO" && r.contrato === contratoNome && r.posto)
      .filter((r) => { if (seen.has(r.posto)) return false; seen.add(r.posto); return true; })
      .map((r) => r.posto).sort();
  }, [planilhaRows, contratoNome]);

  if (postos.length === 0)
    return <p className="text-xs text-muted-foreground italic">Nenhum posto encontrado para este contrato na Planilha de Custo.</p>;

  return (
    <div className="rounded-md border border-border divide-y divide-border max-h-48 overflow-y-auto">
      {postos.map((p) => (
        <div key={p} className="flex items-center gap-2 px-3 py-2 text-xs">
          <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span>{p}</span>
        </div>
      ))}
    </div>
  );
}

function CardChecklist({
  item,
  contrato,
  resposta: savedResp,
  usuariosMap,
  onSave,
}: {
  item: ChecklistItem;
  contrato: ImplantacaoContrato;
  resposta: Resposta | null;
  usuariosMap: Record<string, string>;
  onSave: (resposta: string, obs: string) => Promise<unknown>;
}) {
  const isSimNao    = item.tipo_resposta === "simnao";
  const isDocs      = isDocsItem(item);
  const isEnderecos = isEnderecosItem(item);
  const prazo       = calcPrazo(item, contrato);
  const answered   = !!savedResp?.resposta;

  const [localResp, setLocalResp] = useState<string>(savedResp?.resposta ?? "");
  const [localObs,  setLocalObs]  = useState<string>(savedResp?.obs ?? "");
  const [state, setState]         = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [showHistorico, setShowHistorico] = useState(false);
  const historico: HistoricoEntry[] = savedResp?.historico ?? [];

  useEffect(() => {
    if (state === "idle") {
      setLocalResp(savedResp?.resposta ?? "");
      setLocalObs(savedResp?.obs ?? "");
    }
  }, [savedResp]);

  async function handleSave() {
    if (!localResp) return;
    setState("saving");
    try {
      await onSave(localResp, localObs);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  return (
    <div className={cn(
      "rounded-xl border bg-card flex flex-col gap-3 shadow-sm transition-all",
      answered ? "border-l-4 border-l-emerald-400" : "border-border",
      "hover:shadow-md hover:border-primary/30 p-4"
    )}>
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {item.responsavel_acao && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-secondary border border-border px-2 py-0.5 rounded">
              <ArrowRight className="w-3 h-3 text-primary" />
              {item.responsavel_acao}
            </span>
          )}
          {item.categoria && (
            <span className="text-[11px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded">
              {item.categoria}
            </span>
          )}
        </div>
        {item.momento && (
          <span className="text-[10px] text-muted-foreground text-right shrink-0 leading-tight max-w-[120px]">
            {item.momento}
          </span>
        )}
      </div>

      {/* Pergunta */}
      <p className="text-sm font-semibold text-foreground leading-snug">{item.item}</p>

      {/* Resposta */}
      <div className="space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Resposta</span>
        {isEnderecos ? (
          <EnderecosPostos contratoNome={contrato.nome} />
        ) : isDocs ? (
          <DocMultiSelect value={localResp} onChange={setLocalResp} />
        ) : isSimNao ? (
          <div className="flex gap-2">
            {(["Sim", "Não", "N/A"] as const).map((op) => (
              <button key={op} onClick={() => setLocalResp(localResp === op ? "" : op)}
                className={cn(
                  "flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-all",
                  localResp === op && op === "Sim" && "bg-emerald-50 border-emerald-500 text-emerald-700",
                  localResp === op && op === "Não" && "bg-red-50 border-red-500 text-red-700",
                  localResp === op && op === "N/A" && "bg-muted border-muted-foreground/40 text-muted-foreground",
                  localResp !== op && "bg-card border-border text-foreground hover:bg-muted/50"
                )}>
                {op === "Sim" ? "✓ Sim" : op === "Não" ? "✗ Não" : "N/A"}
              </button>
            ))}
          </div>
        ) : (
          <Textarea placeholder="Digite a resposta…" className="min-h-[52px] text-xs resize-y"
            value={localResp} onChange={(e) => setLocalResp(e.target.value)} />
        )}
      </div>

      {/* Observações */}
      <div className="space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Observações</span>
        <Textarea
          placeholder="Adicione observações…"
          className="min-h-[40px] text-xs resize-y"
          value={localObs}
          onChange={(e) => setLocalObs(e.target.value)}
        />
      </div>

      {/* Salvar + Histórico */}
      <div className="flex gap-2">
        <Button
          size="sm"
          className={cn(
            "flex-1 text-xs font-semibold",
            state === "saved"  && "bg-emerald-600 hover:bg-emerald-600",
            state === "failed" && "bg-destructive hover:bg-destructive",
          )}
          disabled={state === "saving" || !localResp}
          onClick={handleSave}
        >
          {state === "saving" ? "Salvando…" : state === "saved" ? "✓ Salvo" : state === "failed" ? "✗ Falhou" : "Salvar"}
        </Button>
        {historico.length > 0 && (
          <Button size="sm" variant="outline" className="px-2.5" title="Ver histórico" onClick={() => setShowHistorico(true)}>
            <History className="h-3.5 w-3.5" />
            <span className="ml-1 text-xs">{historico.length}</span>
          </Button>
        )}
      </div>

      {/* Meta-block */}
      {(item.plano_acao || item.responsavel_acao || item.onde || prazo) && (
        <div className="bg-muted/60 rounded-lg px-3 py-2.5 space-y-1.5 text-[11px]">
          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Meta-block — contexto para execução</p>
          {item.plano_acao && <MetaRow label="Plano de ação" value={item.plano_acao} />}
          {item.responsavel_acao && <MetaRow label="Resp. ação" value={item.responsavel_acao} />}
          {item.onde && <MetaRow label="Onde" value={item.onde} />}
          {prazo && <MetaRow label="Prazo" value={prazo} highlight />}
        </div>
      )}

      {/* Modal histórico */}
      <Dialog open={showHistorico} onOpenChange={setShowHistorico}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4" /> Histórico de alterações
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.item}</p>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">Data</th>
                  <th className="pb-2 pr-4 font-medium">Resposta</th>
                  <th className="pb-2 pr-4 font-medium">Observações</th>
                  <th className="pb-2 font-medium">Por</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...historico].reverse().map((h, i) => (
                  <tr key={i} className="align-top">
                    <td className="py-2 pr-4 text-muted-foreground whitespace-nowrap">
                      {new Date(h.ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-2 pr-4 max-w-[200px]">{h.resposta || "—"}</td>
                    <td className="py-2 pr-4 max-w-[200px] text-muted-foreground">{h.obs || "—"}</td>
                    <td className="py-2 text-muted-foreground whitespace-nowrap">
                      {h.por ? (usuariosMap[h.por] ?? h.por) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetaRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground min-w-[80px] shrink-0 font-semibold">{label}</span>
      <span className={highlight ? "text-orange-600 font-semibold" : "text-foreground"}>{value}</span>
    </div>
  );
}

// ── Filtro pill ───────────────────────────────────────────────────────────────

function FiltroBtn({ children, active, onClick, variant = "momento" }: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  variant?: "momento" | "setor";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-xs font-semibold px-3 py-1 rounded-full border transition-all",
        active
          ? variant === "setor"
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-foreground text-background border-foreground"
          : "bg-card text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

// ── Modal editar nome ─────────────────────────────────────────────────────────

function EditarNomeModal({ contrato, onClose, onSaved }: {
  contrato: ImplantacaoContrato;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState(contrato.nome);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!nome.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("implantacao_contrato").update({ nome: nome.trim() }).eq("id", contrato.id);
    setSaving(false);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Nome atualizado!" });
      onSaved();
      onClose();
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Editar nome do contrato</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <Label className="text-xs">Nome</Label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} className="h-9" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving || !nome.trim()} onClick={handleSave}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="card-elevated p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("mt-2 font-display text-3xl font-bold", highlight ? "text-emerald-600" : "text-foreground")}>{value}</p>
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
      {message && <p className="mt-1 text-xs">{message}</p>}
    </div>
  );
}
