// Estúdio de BI — UM painel: os gráficos numa grade de 12 colunas, os filtros
// no topo, e o modo de edição (adicionar, editar, arrastar, redimensionar,
// pedir pra IA).
//
// Cada widget busca o próprio dado (bi_widget_dados) com os valores dos
// filtros; o painel não junta nada — é o SQL de cada um que decide. O tema
// escuro é do painel (config.tema), pensado pra TV.
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  DndContext, type DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { WidgetGrafico } from "@/components/bi/WidgetGrafico";
import {
  useDadosWidgetBi, useExcluirPainelBi, useExcluirWidgetBi, usePainelBi, useReordenarWidgetsBi, useSalvarPainelBi, useSalvarWidgetBi,
} from "@/hooks/useBiEstudio";
import { LARGURAS, paramsDosFiltros, resultadoParaCsv, type FiltroPainel, type Painel, type Widget, type WidgetRascunho } from "@/lib/bi/estudio";
import {
  ArrowLeft, Download, GripVertical, Loader2, Maximize2, MoreVertical, Pencil, Plus, RefreshCw, Settings2, Sparkles, Trash2, Globe, Lock, Eye, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WidgetEditorDialog } from "./WidgetEditorDialog";
import { AssistenteIA } from "./AssistenteIA";
import { PainelConfigDialog } from "./PainelConfigDialog";

const ALTURA_LINHA = 150; // px por unidade de altura

export default function BiEstudioPainel() {
  const { id } = useParams();
  const painelId = Number(id);
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = usePainelBi(painelId || null);
  const { data: podeAlterar } = useScreenAccess("bi_estudio", "alterar");
  const salvarPainel = useSalvarPainelBi();
  const excluirPainel = useExcluirPainelBi();
  const salvarWidget = useSalvarWidgetBi(painelId);
  const excluirWidget = useExcluirWidgetBi(painelId);
  const reordenar = useReordenarWidgetsBi(painelId);

  const painel = data?.painel ?? null;
  // useMemo de propósito: `?? []` novo a cada render faria o efeito de
  // ordem rodar sempre e o setState virar loop.
  const widgets = useMemo(() => data?.widgets ?? [], [data?.widgets]);
  const souDono = !!painel && painel.dono_id === user?.id;
  const podeEditar = souDono || !!podeAlterar;
  const [editando, setEditando] = useState(sp.get("editar") === "1");
  useEffect(() => { if (sp.get("editar") === "1" && podeEditar) setEditando(true); }, [sp, podeEditar]);

  // Valores dos filtros (começam no padrão)
  const [valores, setValores] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!painel) return;
    setValores(v => {
      const n = { ...v };
      for (const f of painel.filtros ?? []) if (n[f.chave] === undefined) n[f.chave] = f.padrao ?? "";
      return n;
    });
  }, [painel?.id, painel?.filtros]);
  const params = useMemo(() => paramsDosFiltros(painel?.filtros ?? [], valores), [painel?.filtros, valores]);

  const [editor, setEditor] = useState<{ aberto: boolean; inicial: Partial<Widget> & Partial<WidgetRascunho> }>({ aberto: false, inicial: {} });
  const [ia, setIa] = useState<{ aberta: boolean; modo: "widget" | "ajustar"; atual?: Partial<WidgetRascunho> | null; editandoId?: number }>({ aberta: false, modo: "widget" });
  const [configAberta, setConfigAberta] = useState(false);
  const [telaCheia, setTelaCheia] = useState(false);
  const [ordemLocal, setOrdemLocal] = useState<number[]>([]);
  useEffect(() => { setOrdemLocal(widgets.map(w => w.id)); }, [widgets]);

  const escuro = painel?.config?.tema === "escuro";
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const de = ordemLocal.indexOf(Number(active.id));
    const para = ordemLocal.indexOf(Number(over.id));
    const nova = arrayMove(ordemLocal, de, para);
    setOrdemLocal(nova);
    reordenar.mutate(nova);
  };

  const widgetsOrdenados = useMemo(() => {
    const por = new Map(widgets.map(w => [w.id, w]));
    return ordemLocal.map(i => por.get(i)).filter(Boolean) as Widget[];
  }, [widgets, ordemLocal]);

  const atualizarTudo = () => qc.invalidateQueries({ queryKey: ["bi_widget_dados"] });

  const salvarW = async (w: Partial<Widget>) => {
    await salvarWidget.mutateAsync({ ...w, ordem: w.id ? undefined : widgets.length });
    toast.success(w.id ? "Gráfico atualizado." : "Gráfico adicionado.");
    qc.invalidateQueries({ queryKey: ["bi_widget_dados"] });
  };

  const adicionarDaIa = async (ws: WidgetRascunho[]) => {
    const w = ws[0];
    if (!w) return;
    if (ia.modo === "ajustar" && ia.editandoId) {
      await salvarWidget.mutateAsync({ id: ia.editandoId, titulo: w.titulo, subtitulo: w.subtitulo, tipo: w.tipo, sql: w.sql, config: w.config, largura: w.largura, altura: w.altura, criado_por_ia: true });
      toast.success("Gráfico ajustado pela IA.");
    } else {
      await salvarWidget.mutateAsync({ titulo: w.titulo, subtitulo: w.subtitulo, tipo: w.tipo, sql: w.sql, config: w.config, largura: w.largura, altura: w.altura, ordem: widgets.length, criado_por_ia: true });
      toast.success(`"${w.titulo}" adicionado ao painel.`);
    }
    qc.invalidateQueries({ queryKey: ["bi_widget_dados"] });
    if (ia.modo === "ajustar") setIa({ aberta: false, modo: "widget" });
  };

  const duplicar = async (w: Widget) => {
    await salvarWidget.mutateAsync({ titulo: w.titulo + " (cópia)", subtitulo: w.subtitulo, tipo: w.tipo, sql: w.sql, config: w.config, largura: w.largura, altura: w.altura, ordem: widgets.length, criado_por_ia: w.criado_por_ia });
  };

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Carregando painel…</div>;
  if (error) return <div className="p-8 text-sm text-destructive">Erro: {(error as Error).message}</div>;
  if (!painel) return (
    <div className="p-8 text-center text-sm text-muted-foreground">
      Painel não encontrado ou sem permissão.
      <div className="mt-3"><Button variant="outline" onClick={() => nav("/app/bi/estudio")}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button></div>
    </div>
  );

  const fundo = escuro ? "#0d0d0d" : undefined;
  const tinta = escuro ? "#ffffff" : undefined;

  return (
    <div className={cn("mx-auto max-w-[1600px]", telaCheia && "fixed inset-0 z-[60] max-w-none overflow-auto p-4")} style={{ background: fundo, color: tinta }}>
      {/* Cabeçalho */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {!telaCheia && (
            <Button variant="ghost" size="icon" className="mt-0.5 shrink-0" onClick={() => nav("/app/bi/estudio")} style={{ color: tinta }}><ArrowLeft className="h-5 w-5" /></Button>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight">{painel.nome}</h1>
              <Badge variant="outline" className="gap-1 text-[10px]" style={{ color: tinta }}>{painel.publico ? <><Globe className="h-3 w-3" /> Público</> : <><Lock className="h-3 w-3" /> Privado</>}</Badge>
              {editando && <Badge className="text-[10px]">Editando</Badge>}
            </div>
            {painel.descricao && <p className="mt-0.5 text-sm text-muted-foreground" style={{ color: escuro ? "#c3c2b7" : undefined }}>{painel.descricao}</p>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={atualizarTudo} title="Recarregar todos os gráficos"><RefreshCw className="h-4 w-4" /></Button>
          <Button variant="outline" size="sm" onClick={() => setTelaCheia(v => !v)} title="Tela cheia"><Maximize2 className="h-4 w-4" /></Button>
          {podeEditar && !editando && (
            <Button size="sm" onClick={() => setEditando(true)}><Pencil className="mr-2 h-4 w-4" /> Editar</Button>
          )}
          {editando && (
            <>
              <AcessoGate menu="bi_estudio" acao="executar_ia">
                <Button variant="outline" size="sm" onClick={() => setIa({ aberta: true, modo: "widget" })}><Sparkles className="mr-2 h-4 w-4" /> Criar com IA</Button>
              </AcessoGate>
              <Button variant="outline" size="sm" onClick={() => setEditor({ aberto: true, inicial: { largura: 6, altura: 2, tipo: "barras", config: {} } })}><Plus className="mr-2 h-4 w-4" /> Gráfico</Button>
              <Button variant="outline" size="sm" onClick={() => setConfigAberta(true)}><Settings2 className="mr-2 h-4 w-4" /> Painel</Button>
              <Button size="sm" onClick={() => { setEditando(false); setSp({}); }}><Eye className="mr-2 h-4 w-4" /> Concluir</Button>
            </>
          )}
        </div>
      </div>

      {/* Filtros */}
      {(painel.filtros ?? []).length > 0 && (
        <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border p-3" style={{ borderColor: escuro ? "#383835" : undefined }}>
          {(painel.filtros as FiltroPainel[]).map(f => (
            <div key={f.chave} className="min-w-[160px]">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" style={{ color: escuro ? "#c3c2b7" : undefined }}>{f.rotulo}</label>
              {f.tipo === "lista" ? (
                <Select value={valores[f.chave] || "__todos"} onValueChange={v => setValores(x => ({ ...x, [f.chave]: v === "__todos" ? "" : v }))}>
                  <SelectTrigger className="mt-1 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="__todos">Todos</SelectItem>{(f.opcoes ?? []).map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input className="mt-1 h-8" type={f.tipo === "data" ? "date" : f.tipo === "numero" ? "number" : "text"} value={valores[f.chave] ?? ""} onChange={e => setValores(x => ({ ...x, [f.chave]: e.target.value }))} />
              )}
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setValores(Object.fromEntries((painel.filtros ?? []).map(f => [f.chave, f.padrao ?? ""])))}>Limpar</Button>
        </div>
      )}

      {/* Grade */}
      {widgetsOrdenados.length === 0 ? (
        <div className="rounded-xl border border-dashed p-14 text-center text-sm text-muted-foreground">
          Painel vazio. {editando ? "Adicione um gráfico ou peça pra IA." : podeEditar ? "Clique em Editar para adicionar gráficos." : ""}
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ordemLocal} strategy={rectSortingStrategy} disabled={!editando}>
            <div className="grid grid-cols-12 gap-3">
              {widgetsOrdenados.map(w => (
                <CardWidget key={w.id} w={w} params={params} editando={editando} escuro={escuro}
                  atualizarSeg={painel.config?.atualizar_a_cada_seg}
                  onEditar={() => setEditor({ aberto: true, inicial: w })}
                  onIa={() => setIa({ aberta: true, modo: "ajustar", atual: w, editandoId: w.id })}
                  onDuplicar={() => duplicar(w)}
                  onLargura={(l) => salvarWidget.mutate({ id: w.id, largura: l })}
                  onAltura={(a) => salvarWidget.mutate({ id: w.id, altura: a })}
                  onExcluir={async () => { await excluirWidget.mutateAsync(w.id); toast.success("Gráfico removido."); }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {editor.aberto && (
        <WidgetEditorDialog aberto onFechar={() => setEditor({ aberto: false, inicial: {} })} inicial={editor.inicial}
          filtros={painel.filtros ?? []} params={params} onSalvar={salvarW} escuro={escuro}
          onPedirIa={(atual) => { setEditor({ aberto: false, inicial: {} }); setIa({ aberta: true, modo: "ajustar", atual, editandoId: (editor.inicial as any).id }); }} />
      )}
      {ia.aberta && (
        <AssistenteIA aberto onFechar={() => setIa({ aberta: false, modo: "widget" })} modo={ia.modo} painelId={painel.id}
          filtros={painel.filtros ?? []} params={params} widgetAtual={ia.atual} onAplicar={adicionarDaIa} salvando={salvarWidget.isPending} escuro={escuro} />
      )}
      {configAberta && (
        <PainelConfigDialog aberto onFechar={() => setConfigAberta(false)} painel={painel}
          onSalvar={async (p) => { await salvarPainel.mutateAsync(p); toast.success("Painel salvo."); }}
          onExcluir={async () => { await excluirPainel.mutateAsync(painel.id); toast.success("Painel excluído."); nav("/app/bi/estudio"); }} />
      )}
    </div>
  );
}

function CardWidget({ w, params, editando, escuro, atualizarSeg, onEditar, onIa, onDuplicar, onLargura, onAltura, onExcluir }: {
  w: Widget; params: Record<string, string | null>; editando: boolean; escuro: boolean; atualizarSeg?: number;
  onEditar: () => void; onIa: () => void; onDuplicar: () => void; onLargura: (l: number) => void; onAltura: (a: number) => void; onExcluir: () => Promise<void>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: w.id, disabled: !editando });
  const { data, isLoading, error, refetch, isFetching } = useDadosWidgetBi(w.id, params, atualizarSeg);
  const [confirmar, setConfirmar] = useState(false);
  const alturaPx = w.altura * ALTURA_LINHA;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition,
    background: escuro ? "#1a1a19" : "#fcfcfb", borderColor: escuro ? "#383835" : undefined,
    opacity: isDragging ? 0.6 : 1,
  };
  const colLg = { 3: "lg:col-span-3", 4: "lg:col-span-4", 6: "lg:col-span-6", 8: "lg:col-span-8", 12: "lg:col-span-12" }[w.largura] ?? "lg:col-span-6";

  const exportar = () => {
    if (!data) return;
    const blob = new Blob(["﻿" + resultadoParaCsv(data)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${w.titulo.replace(/[^\w\- ]+/g, "")}.csv`; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div ref={setNodeRef} style={style} className={cn("col-span-12 flex flex-col overflow-hidden rounded-xl border shadow-sm", colLg)}>
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {editando && <button type="button" {...attributes} {...listeners} className="cursor-grab text-muted-foreground hover:text-foreground" title="Arrastar"><GripVertical className="h-4 w-4" /></button>}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" style={{ color: escuro ? "#fff" : "#0b0b0b" }}>{w.titulo}</p>
            {w.subtitulo && <p className="truncate text-[11px]" style={{ color: escuro ? "#c3c2b7" : "#52514e" }}>{w.subtitulo}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isFetching && !isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7" style={{ color: escuro ? "#c3c2b7" : undefined }}><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" /> Atualizar</DropdownMenuItem>
              <AcessoGate menu="bi_estudio" acao="exportar"><DropdownMenuItem onClick={exportar} disabled={!data}><Download className="mr-2 h-4 w-4" /> Exportar CSV</DropdownMenuItem></AcessoGate>
              {editando && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onEditar}><Pencil className="mr-2 h-4 w-4" /> Editar</DropdownMenuItem>
                  <AcessoGate menu="bi_estudio" acao="executar_ia"><DropdownMenuItem onClick={onIa}><Sparkles className="mr-2 h-4 w-4" /> Ajustar com IA</DropdownMenuItem></AcessoGate>
                  <DropdownMenuItem onClick={onDuplicar}><Copy className="mr-2 h-4 w-4" /> Duplicar</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={() => setConfirmar(true)}><Trash2 className="mr-2 h-4 w-4" /> Remover</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="min-h-0 flex-1 px-2 pb-2 pt-1" style={{ height: alturaPx }}>
        {confirmar ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
            <span>Remover "{w.titulo}"?</span>
            <div className="flex gap-2"><Button size="sm" variant="destructive" onClick={onExcluir}>Remover</Button><Button size="sm" variant="ghost" onClick={() => setConfirmar(false)}>Cancelar</Button></div>
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Consultando…</div>
        ) : error ? (
          <div className="flex h-full items-center justify-center px-3 text-center text-xs text-destructive">{(error as Error).message}</div>
        ) : (
          <WidgetGrafico tipo={w.tipo} config={w.config} dados={data} escuro={escuro} altura={alturaPx - 12} />
        )}
      </div>

      {editando && (
        <div className="flex items-center justify-between gap-2 border-t px-2 py-1 text-[10px] text-muted-foreground" style={{ borderColor: escuro ? "#383835" : undefined }}>
          <span className="flex items-center gap-1">Largura
            {LARGURAS.map(l => <button key={l} type="button" onClick={() => onLargura(l)} className={cn("rounded px-1", w.largura === l ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{l}</button>)}
          </span>
          <span className="flex items-center gap-1">Altura
            {[1, 2, 3, 4].map(a => <button key={a} type="button" onClick={() => onAltura(a)} className={cn("rounded px-1", w.altura === a ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>{a}</button>)}
          </span>
          {w.criado_por_ia && <span className="flex items-center gap-0.5"><Sparkles className="h-3 w-3" /> IA</span>}
        </div>
      )}
    </div>
  );
}
