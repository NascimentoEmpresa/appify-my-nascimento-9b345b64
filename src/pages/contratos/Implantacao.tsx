import { useState, useMemo, useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import {
  useImplantacaoContratos,
  useChecklistItems,
  useRespostas,
  useRespostaUpsert,
  useImplantacaoOrigem,
  useTreinamentosImplantacao,
  calcPrazo,
} from "@/hooks/useImplantacao";
import { PainelOrigemContrato } from "@/components/contratos/PainelOrigemContrato";
import { ROW_INDEX_NO_TOPO } from "@/lib/implantacao/camposOrigem";
import {
  OPCOES_EMISSAO_NOTA,
  OPCOES_FORMA_ENVIO,
  ROW_INDEX_SIM_NAO_DETALHE,
  lerLista,
  lerListaComOutro,
  lerSimNaoDetalhe,
  resumoResposta,
  salvarLista,
  salvarListaComOutro,
  salvarSimNaoDetalhe,
  type OpcaoSimNao,
} from "@/lib/implantacao/camposResposta";
import type { ImplantacaoContrato, ChecklistItem, Resposta, HistoricoEntry } from "@/hooks/useImplantacao";
import { CheckCircle2, Circle, ChevronDown, Trash2, X as XIcon, CheckCircle, History, Plus } from "lucide-react";
import { useUsuariosEmpresa } from "@/hooks/useUsuariosEmpresa";
import { useDocTipos } from "@/hooks/useDocumentos";
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
  const { can } = usePermissoes();
  const podeExcluir = can("excluir", undefined, "implantacao");
  // SIS-2026-0309: lê a implantação de todas as empresas do grupo — o
  // filtro de "empresa ativa" só limitava a visão, sem proteger nada
  // (acesso já é 100% por usuário, nunca por empresa).
  const { data: contratos = [], isLoading, error } = useImplantacaoContratos(null, { todasEmpresas: true });
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
      // SIS-2026-0559: os 11 itens que vêm prontos da Capa/Grade subiram pro
      // painel do topo. Deixá-los também aqui faria responder o mesmo
      // `row_index` em dois lugares. Continuam contando no progresso geral.
      if (ROW_INDEX_NO_TOPO.has(i.row_index)) return false;
      if (momentoFiltro && i.momento !== momentoFiltro) return false;
      if (responsavelFiltro && i.responsavel_acao !== responsavelFiltro && i.responsavel_acao !== "Todos") return false;
      return true;
    });
  }, [checklistItems, momentoFiltro, responsavelFiltro]);

  const responsaveisFiltrados = useMemo(() => [...new Set(itensFiltrados.map((i) => i.responsavel_acao))], [itensFiltrados]);

  // SIS-2026-0309: empresa vem do próprio contrato selecionado (propagação
  // pela origem), não mais da empresa "ativa" do seletor global.
  const { data: respostas = [] } = useRespostas(contratoSelecionado, contrato?.empresa_id ?? null);
  const upsert = useRespostaUpsert(contrato?.empresa_id ?? "");
  // SIS-2026-0559: valores que já existem na Capa de Edital / Grade de Licitações.
  const { data: origem = null, isLoading: carregandoOrigem } = useImplantacaoOrigem(contratoSelecionado);
  const { data: usuarios = [] } = useUsuariosEmpresa();
  const usuariosMap = useMemo(() => {
    const m: Record<string, string> = {};
    usuarios.forEach((u) => { m[u.id] = u.display_name ?? u.email ?? u.id; });
    return m;
  }, [usuarios]);

  async function handleDeleteContrato(id: string) {
    const { error } = await (supabase as any).from("implantacao_contrato").delete().eq("id", id);
    if (error) { toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Contrato excluído." });
    qc.removeQueries({ queryKey: ["implantacao", "todas"] });
    const restantes = contratos.filter((c) => c.id !== id);
    setContratoSelecionado(restantes[0]?.id ?? null);
    setDeleteTarget(null);
    qc.invalidateQueries({ queryKey: ["implantacao", "todas"] });
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

      {isLoading ? (
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

          {/* SIS-2026-0559: dados que já vêm da Capa/Grade, no topo, só pra confirmar.
              Absorve o antigo banner âmbar "O nome do contrato está correto?". */}
          {contrato && (
            <PainelOrigemContrato
              contratoNome={contrato.nome}
              origem={origem}
              carregando={carregandoOrigem}
              respostaMap={respostaMap}
              onSalvar={(rowIndex, resposta) =>
                upsert.mutateAsync({ contratoId: contrato.id, rowIndex, resposta, obs: null })
              }
              nomeConfirmado={nomeConfirmados.has(contrato.id)}
              onConfirmarNome={() => confirmarNome(contrato.id)}
              onEditarNome={() => setEditandoNome(true)}
            />
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
                // SIS-2026-0559: era `respostaMap[i.id]`, e `respostaMap` é indexado
                // por `row_index` (número) enquanto `item.id` é uuid — a conta dava
                // 0 sempre, e a barra de cada setor ficava zerada mesmo com tudo
                // respondido. O contador global embaixo já usava a chave certa.
                const respSetor  = itensSetor.filter((i) => respostaMap[i.row_index]?.resposta).length;
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

                    {/* SIS-2026-0559: lista de linhas (era grade de 3 colunas de cards).
                        Linha respondida fica fechada; quem falta responder fica aberta. */}
                    <div className="divide-y divide-border rounded-xl border border-border bg-card">
                      {itensSetor.map((item) => (
                        <LinhaChecklist
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
            qc.invalidateQueries({ queryKey: ["implantacao", "todas"] });
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

function SelecaoMultiplaComOutro({
  value,
  onChange,
  opcoes,
}: {
  value: string;
  onChange: (v: string) => void;
  opcoes: readonly string[];
}) {
  const selecionadas = useMemo(() => lerLista(value), [value]);
  const [outro, setOutro] = useState("");
  const ehOpcaoPadrao = (item: string) => opcoes.some((opcao) => opcao === item);

  function toggle(opcao: string) {
    onChange(salvarLista(
      selecionadas.includes(opcao)
        ? selecionadas.filter((item) => item !== opcao)
        : [...selecionadas, opcao],
    ));
  }

  function adicionarOutro() {
    const limpo = outro.trim();
    if (!limpo) return;
    onChange(salvarLista([...selecionadas, limpo]));
    setOutro("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {opcoes.map((opcao) => {
          const ativa = selecionadas.includes(opcao);
          return (
            <button
              key={opcao}
              type="button"
              onClick={() => toggle(opcao)}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                ativa
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted/50",
              )}
            >
              {ativa ? "✓ " : ""}{opcao}
            </button>
          );
        })}
      </div>
      {selecionadas.filter((item) => !ehOpcaoPadrao(item)).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selecionadas.filter((item) => !ehOpcaoPadrao(item)).map((item) => (
            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary">
              {item}
              <button type="button" onClick={() => toggle(item)} title={`Remover ${item}`}>
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex max-w-lg gap-2">
        <Input
          value={outro}
          onChange={(e) => setOutro(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              adicionarOutro();
            }
          }}
          placeholder="Adicionar outra forma"
          className="h-8 text-xs"
        />
        <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={!outro.trim()} onClick={adicionarOutro}>
          <Plus className="h-3 w-3" /> Adicionar
        </Button>
      </div>
    </div>
  );
}

function ListaComOutro({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const atual = lerListaComOutro(value, OPCOES_EMISSAO_NOTA);
  return (
    <div className="grid max-w-lg gap-2 sm:grid-cols-2">
      <Select
        value={atual.opcao}
        onValueChange={(opcao) => onChange(salvarListaComOutro(opcao, atual.outro))}
      >
        <SelectTrigger className="h-9 text-xs">
          <SelectValue placeholder="Selecione como a nota será emitida" />
        </SelectTrigger>
        <SelectContent>
          {OPCOES_EMISSAO_NOTA.map((opcao) => (
            <SelectItem key={opcao} value={opcao}>{opcao}</SelectItem>
          ))}
          <SelectItem value="Outro">Outro</SelectItem>
        </SelectContent>
      </Select>
      {atual.opcao === "Outro" && (
        <Input
          autoFocus
          value={atual.outro}
          onChange={(e) => onChange(salvarListaComOutro("Outro", e.target.value))}
          placeholder="Informe a outra forma"
          className="h-9 text-xs"
        />
      )}
    </div>
  );
}

function SimNaoComDetalhe({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const atual = lerSimNaoDetalhe(value);
  const opcoes: OpcaoSimNao[] = ["Sim", "Não", "N/A"];
  return (
    <div className="space-y-2">
      <div className="flex max-w-md gap-2">
        {opcoes.map((opcao) => (
          <button
            key={opcao}
            type="button"
            onClick={() => onChange(salvarSimNaoDetalhe(opcao, atual.detalhe))}
            className={cn(
              "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-all",
              atual.opcao === opcao && opcao === "Sim" && "border-emerald-500 bg-emerald-50 text-emerald-700",
              atual.opcao === opcao && opcao === "Não" && "border-red-500 bg-red-50 text-red-700",
              atual.opcao === opcao && opcao === "N/A" && "border-muted-foreground/40 bg-muted text-muted-foreground",
              atual.opcao !== opcao && "border-border bg-card text-foreground hover:bg-muted/50",
            )}
          >
            {opcao}
          </button>
        ))}
      </div>
      {atual.opcao === "Sim" && (
        <Input
          autoFocus
          value={atual.detalhe}
          onChange={(e) => onChange(salvarSimNaoDetalhe("Sim", e.target.value))}
          placeholder="Quais?"
          className="h-9 max-w-lg text-xs"
        />
      )}
    </div>
  );
}

function TreinamentosMultiSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: treinamentos = [], isLoading, error } = useTreinamentosImplantacao();
  const selecionados = useMemo(() => lerLista(value), [value]);

  function toggle(nome: string) {
    onChange(salvarLista(
      selecionados.includes(nome)
        ? selecionados.filter((item) => item !== nome)
        : [...selecionados, nome],
    ));
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">Carregando treinamentos…</p>;
  if (error) return <p className="text-xs text-destructive">Não foi possível carregar os cursos.</p>;
  if (treinamentos.length === 0) {
    return <p className="text-xs italic text-muted-foreground">Nenhum curso cadastrado em Treinamentos › Cursos.</p>;
  }

  return (
    <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
      {treinamentos.map((curso) => {
        const ativo = selecionados.includes(curso.nome);
        return (
          <button
            key={curso.id}
            type="button"
            onClick={() => toggle(curso.nome)}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/50",
              ativo && "bg-primary/5 text-primary",
            )}
          >
            <span className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              ativo ? "border-primary bg-primary text-primary-foreground" : "border-border",
            )}>
              {ativo && <CheckCircle className="h-3 w-3" />}
            </span>
            <span className="flex-1">{curso.nome}</span>
            {!curso.publicado && <span className="text-[10px] text-muted-foreground">Rascunho</span>}
          </button>
        );
      })}
    </div>
  );
}

function LinhaChecklist({
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
  const isSimNao         = item.tipo_resposta === "simnao";
  const isDocs           = isDocsItem(item);
  const isFormaEnvio     = item.row_index === 8;
  const isEmissaoNota    = item.row_index === 13;
  const isTreinamentos   = item.row_index === 22;
  const isSimNaoDetalhe  = ROW_INDEX_SIM_NAO_DETALHE.has(item.row_index);
  const prazo            = calcPrazo(item, contrato);
  const answered         = !!savedResp?.resposta;
  const rotuloItem       = item.row_index === 22 ? "Marque quais treinamentos exigidos" : item.item;

  const [localResp, setLocalResp] = useState<string>(savedResp?.resposta ?? "");
  const [localObs,  setLocalObs]  = useState<string>(savedResp?.obs ?? "");
  const [state, setState]         = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [showHistorico, setShowHistorico] = useState(false);
  // SIS-2026-0559: linha respondida nasce fechada, linha pendente nasce aberta.
  // É o que faz o "quanto falta" aparecer batendo o olho — o pedido do chamado
  // era justamente enxergar o progresso do preenchimento.
  const [aberta, setAberta] = useState(!answered);
  const historico: HistoricoEntry[] = savedResp?.historico ?? [];

  useEffect(() => {
    if (state === "idle") {
      setLocalResp(savedResp?.resposta ?? "");
      setLocalObs(savedResp?.obs ?? "");
    }
  }, [savedResp]);

  async function salvar(resposta: string, obs: string) {
    if (!resposta) return;
    setState("saving");
    try {
      await onSave(resposta, obs);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
      setAberta(false);
    } catch {
      setState("failed");
      setTimeout(() => setState("idle"), 2500);
    }
  }

  /** Resumo do que está salvo, pra linha fechada mostrar sem abrir. */
  const resumo = useMemo(() => {
    const r = savedResp?.resposta ?? "";
    if (!r) return "";
    if (isDocs) {
      try {
        const lista = JSON.parse(r) as string[];
        return `${lista.length} documento${lista.length !== 1 ? "s" : ""}`;
      } catch { return r; }
    }
    return resumoResposta(item.row_index, r);
  }, [savedResp, isDocs, item.row_index]);

  const respostaValida = useMemo(() => {
    if (!localResp) return false;
    if (isEmissaoNota) {
      const resposta = lerListaComOutro(localResp, OPCOES_EMISSAO_NOTA);
      return !!resposta.opcao && (resposta.opcao !== "Outro" || !!resposta.outro.trim());
    }
    if (!isSimNaoDetalhe) return true;
    const resposta = lerSimNaoDetalhe(localResp);
    return !!resposta.opcao && (resposta.opcao !== "Sim" || !!resposta.detalhe.trim());
  }, [localResp, isEmissaoNota, isSimNaoDetalhe]);

  return (
    <div className={cn("transition-colors", answered && "bg-emerald-500/[0.04]")}>
      {/* Cabeçalho da linha — sempre visível */}
      <div className="flex items-center gap-3 px-3 py-2">
        <button onClick={() => setAberta((p) => !p)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {answered
            ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{rotuloItem}</span>
        </button>

        <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
          {item.categoria && (
            <span className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600">
              {item.categoria}
            </span>
          )}
          {item.momento && (
            <span className="max-w-[140px] truncate text-[10px] text-muted-foreground">{item.momento}</span>
          )}
        </div>

        {/* Sim/Não/N/A direto na linha: um clique salva, sem precisar abrir. */}
        {isSimNao && !isDocs && !isFormaEnvio && !isEmissaoNota && !isTreinamentos && !isSimNaoDetalhe ? (
          <div className="flex shrink-0 gap-1">
            {(["Sim", "Não", "N/A"] as const).map((op) => (
              <button key={op} disabled={state === "saving"} onClick={() => salvar(op, localObs)}
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-semibold transition-all",
                  savedResp?.resposta === op && op === "Sim" && "bg-emerald-50 border-emerald-500 text-emerald-700",
                  savedResp?.resposta === op && op === "Não" && "bg-red-50 border-red-500 text-red-700",
                  savedResp?.resposta === op && op === "N/A" && "bg-muted border-muted-foreground/40 text-muted-foreground",
                  savedResp?.resposta !== op && "bg-card border-border text-muted-foreground hover:bg-muted/50"
                )}>
                {op}
              </button>
            ))}
          </div>
        ) : (
          <span className="hidden max-w-[220px] shrink-0 truncate text-xs text-muted-foreground md:block">{resumo}</span>
        )}

        <button onClick={() => setAberta((p) => !p)} className="shrink-0 text-muted-foreground hover:text-foreground" title={aberta ? "Fechar" : "Abrir"}>
          <ChevronDown className={cn("h-4 w-4 transition-transform", aberta && "rotate-180")} />
        </button>
      </div>

      {/* Corpo — abre pra responder */}
      {aberta && (
        <div className="space-y-3 border-t border-border/60 bg-muted/20 px-3 py-3">
          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Resposta</span>
            {isTreinamentos ? (
              <TreinamentosMultiSelect value={localResp} onChange={setLocalResp} />
            ) : isFormaEnvio ? (
              <SelecaoMultiplaComOutro value={localResp} onChange={setLocalResp} opcoes={OPCOES_FORMA_ENVIO} />
            ) : isEmissaoNota ? (
              <ListaComOutro value={localResp} onChange={setLocalResp} />
            ) : isSimNaoDetalhe ? (
              <SimNaoComDetalhe value={localResp} onChange={setLocalResp} />
            ) : isDocs ? (
              <DocMultiSelect value={localResp} onChange={setLocalResp} />
            ) : isSimNao ? (
              <div className="flex max-w-md gap-2">
                {(["Sim", "Não", "N/A"] as const).map((op) => (
                  <button key={op} onClick={() => setLocalResp(localResp === op ? "" : op)}
                    className={cn(
                      "flex-1 rounded-lg border py-1.5 text-xs font-semibold transition-all",
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

          <div className="space-y-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Observações</span>
            <Textarea placeholder="Adicione observações…" className="min-h-[40px] text-xs resize-y"
              value={localObs} onChange={(e) => setLocalObs(e.target.value)} />
          </div>

          <div className="flex gap-2">
            <Button size="sm"
              className={cn(
                "text-xs font-semibold",
                state === "saved"  && "bg-emerald-600 hover:bg-emerald-600",
                state === "failed" && "bg-destructive hover:bg-destructive",
              )}
              disabled={state === "saving" || !respostaValida}
              onClick={() => salvar(localResp, localObs)}>
              {state === "saving" ? "Salvando…" : state === "saved" ? "✓ Salvo" : state === "failed" ? "✗ Falhou" : "Salvar"}
            </Button>
            {historico.length > 0 && (
              <Button size="sm" variant="outline" className="px-2.5" title="Ver histórico" onClick={() => setShowHistorico(true)}>
                <History className="h-3.5 w-3.5" />
                <span className="ml-1 text-xs">{historico.length}</span>
              </Button>
            )}
          </div>

          {(item.plano_acao || item.responsavel_acao || item.onde || prazo) && (
            <div className="space-y-1.5 rounded-lg bg-muted/60 px-3 py-2.5 text-[11px]">
              <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Meta-block — contexto para execução</p>
              {item.plano_acao && <MetaRow label="Plano de ação" value={item.plano_acao} />}
              {item.responsavel_acao && <MetaRow label="Resp. ação" value={item.responsavel_acao} />}
              {item.onde && <MetaRow label="Onde" value={item.onde} />}
              {prazo && <MetaRow label="Prazo" value={prazo} highlight />}
            </div>
          )}
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
    const { error } = await (supabase as any).from("implantacao_contrato").update({ nome: nome.trim() }).eq("id", contrato.id);
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
