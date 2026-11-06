import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import {
  ArrowDown, ArrowUp, Copy, FolderPlus, GripVertical, History, Info, MoveRight, Pencil, Plus, RotateCcw, Save, Search, Trash2, Undo2,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { NAV_MODULOS } from "@/components/layout/Sidebar";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { CHAVE_MENU_LATERAL, useMenuLateralSalvo } from "@/hooks/useMenuLateral";
import { cn } from "@/lib/utils";
import { criarColisaoMenu, destinoDoArrasto } from "@/lib/menuLateral/arrastar";
import {
  copiarItem, criarAtalho, criarCategoria, criarModulo, criarResolvedorDeRotulo, estruturaPadrao, incluirTelasNovas,
  moverCategoria, moverItem, moverModulo, remover, renomear, restaurarOriginal, situacaoDoItem, telasDoCatalogo,
  validarEstrutura, type EstruturaMenu, type SituacaoItem,
} from "@/lib/menuLateral/estrutura";

/**
 * SIS-2026-0772 (fase 2) — Sistemas › Organizar Menu Lateral.
 *
 * Organiza só o LUGAR das telas no menu (módulo, categoria, ordem, nome
 * exibido). A permissão de cada tela continua em Administração › Acesso por
 * Usuário — mover não dá acesso a ninguém e tirar do menu não bloqueia. A
 * regra mora em src/lib/menuLateral/estrutura.ts; a gravação, na RPC
 * menu_lateral_salvar (mig 20261105040000), que confere a permissão
 * "alterar" de menu_lateral e recusa salvar em cima de versão velha.
 */

const MENU = "menu_lateral";

interface Alteracao {
  tipo: string;
  texto: string;
}

type RpcCliente = { rpc: (f: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }> };
const rpc = supabase as unknown as RpcCliente;
// A tabela é nova e não está nos tipos gerados (types.ts); o builder sem tipo
// é o mesmo recurso que ModulosMenusTab usa para screen_permission_user.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tabela = () => (supabase as unknown as { from: (t: string) => any }).from("MENU_LATERAL_VERSAO");

const novoId = (prefixo: string) => `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const ROTULO_SITUACAO: Record<Exclude<SituacaoItem, "original">, { texto: string; classe: string }> = {
  movido: { texto: "Movido", classe: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" },
  copiado: { texto: "Cópia", classe: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200" },
  criado: { texto: "Criado", classe: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
};

export default function OrganizarMenuLateral() {
  const qc = useQueryClient();
  const { data: podeAlterar = false } = useScreenAccess(MENU, "alterar");
  const salvo = useMenuLateralSalvo();
  const padrao = useMemo(() => estruturaPadrao(NAV_MODULOS), []);
  const nomeDe = useMemo(() => criarResolvedorDeRotulo(NAV_MODULOS), []);

  const [trabalho, setTrabalho] = useState<EstruturaMenu | null>(null);
  const [alteracoes, setAlteracoes] = useState<Alteracao[]>([]);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);

  // Ponto de partida: a organização salva (com as telas criadas depois dela)
  // ou o padrão. Recarrega quando chega uma versão nova e não há edição aberta.
  useEffect(() => {
    if (salvo.isLoading || alteracoes.length) return;
    setTrabalho(salvo.data ? incluirTelasNovas(salvo.data.estrutura, NAV_MODULOS) : padrao);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salvo.data, salvo.isLoading, padrao]);

  // Sair da tela com alteração não salva perde o trabalho: o navegador avisa.
  useEffect(() => {
    if (!alteracoes.length) return;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [alteracoes.length]);

  const aplicar = (nova: EstruturaMenu, alt: Alteracao) => {
    if (nova === trabalho) return;
    setTrabalho(nova);
    setAlteracoes((a) => [...a, alt]);
  };

  // ── Diálogos ──────────────────────────────────────────────────────────
  const [pedeNome, setPedeNome] = useState<{ titulo: string; valor: string; ajuda?: string; ok: (v: string) => void } | null>(null);
  const [soltou, setSoltou] = useState<{ itemId: string; destCatId: string; destIndex: number } | null>(null);
  const [destinoDe, setDestinoDe] = useState<string | null>(null);
  const [atalhoEm, setAtalhoEm] = useState<string | null>(null);
  const [alvoArrasto, setAlvoArrasto] = useState<ReturnType<typeof destinoDoArrasto>>(null);
  const [itemArrastadoId, setItemArrastadoId] = useState<string | null>(null);
  const sensores = useSensorsSeguros();

  if (!trabalho) {
    return (
      <div className="p-6">
        <PageHeader title="Organizar Menu Lateral" module="Sistemas" breadcrumb={["Sistemas", "Organizar Menu Lateral"]} />
        <p className="mt-6 text-sm text-muted-foreground">Carregando a organização do menu…</p>
      </div>
    );
  }

  // ── Consultas sobre a estrutura em edição ─────────────────────────────
  const onde = (catId: string) => {
    for (const m of trabalho.modulos) for (const c of m.categorias) if (c.id === catId) return `${m.rotulo} › ${c.rotulo}`;
    return "?";
  };
  const acharItem = (itemId: string) => {
    for (const m of trabalho.modulos)
      for (const c of m.categorias) {
        const i = c.itens.findIndex((x) => x.id === itemId);
        if (i !== -1) return { m, c, i, item: c.itens[i] };
      }
    return null;
  };
  const catDoItem = (itemId: string) => acharItem(itemId)?.c ?? null;

  // ── Ações ─────────────────────────────────────────────────────────────
  const mover = (itemId: string, destCatId: string, destIndex?: number) => {
    const org = acharItem(itemId);
    if (!org) return;
    aplicar(moverItem(trabalho, itemId, destCatId, destIndex), {
      tipo: org.c.id === destCatId ? "ordenar" : "mover",
      texto: org.c.id === destCatId
        ? `Mudou a ordem de "${nomeDe(org.item)}" em ${onde(destCatId)}`
        : `Moveu "${nomeDe(org.item)}": ${onde(org.c.id)} → ${onde(destCatId)}`,
    });
  };
  const copiar = (itemId: string, destCatId: string, destIndex?: number) => {
    const org = acharItem(itemId);
    if (!org) return;
    aplicar(copiarItem(trabalho, itemId, destCatId, novoId("cp:"), destIndex), {
      tipo: "copiar", texto: `Copiou "${nomeDe(org.item)}" de ${onde(org.c.id)} para ${onde(destCatId)}`,
    });
  };

  const salvar = async () => {
    const estrutura: EstruturaMenu = {
      ...trabalho,
      rotasConhecidas: [...new Set([...trabalho.rotasConhecidas, ...padrao.rotasConhecidas])],
    };
    const erros = validarEstrutura(estrutura);
    if (erros.length) { toast.error(`Não dá para salvar: ${erros[0]}`); return; }
    setSalvando(true);
    const { data, error } = await rpc.rpc("menu_lateral_salvar", {
      p_estrutura: estrutura,
      p_versao_base: salvo.data?.versao ?? null,
      p_resumo: alteracoes.length === 1 ? alteracoes[0].texto : `${alteracoes.length} alterações no menu`,
      p_alteracoes: alteracoes,
    });
    setSalvando(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Menu salvo (versão ${data}). Quem já está com o ERP aberto vê a mudança em até 5 minutos ou ao recarregar.`);
    setAlteracoes([]);
    await qc.invalidateQueries({ queryKey: CHAVE_MENU_LATERAL });
    await qc.invalidateQueries({ queryKey: ["menu-lateral-historico"] });
  };

  const descartar = () => {
    setAlteracoes([]);
    setTrabalho(salvo.data ? incluirTelasNovas(salvo.data.estrutura, NAV_MODULOS) : padrao);
  };

  // ── Arrastar e soltar ─────────────────────────────────────────────────
  const arrastando = podeAlterar && !busca;
  const colisao = criarColisaoMenu(trabalho);
  const iniciarArrasto = ({ active }: DragStartEvent) => {
    const id = String(active.id);
    setItemArrastadoId(id.startsWith("item:") ? id.slice(5) : null);
    setAlvoArrasto(null);
  };
  const limparArrasto = () => {
    setItemArrastadoId(null);
    setAlvoArrasto(null);
  };
  const indicarDestino = ({ active, over }: DragOverEvent) => {
    setAlvoArrasto(
      over && active.id !== over.id && String(active.id).startsWith("item:")
        ? destinoDoArrasto(trabalho, String(over.id))
        : null,
    );
  };
  const soltar = ({ active, over }: DragEndEvent) => {
    limparArrasto();
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a === o) return;
    if (a.startsWith("mod:") && o.startsWith("mod:")) {
      const destino = trabalho.modulos.findIndex((m) => `mod:${m.id}` === o);
      const mod = trabalho.modulos.find((m) => `mod:${m.id}` === a);
      if (mod && destino !== -1) aplicar(moverModulo(trabalho, mod.id, destino), { tipo: "ordenar", texto: `Mudou a posição do módulo "${mod.rotulo}"` });
      return;
    }
    if (!a.startsWith("item:")) return;
    const itemId = a.slice(5);
    const org = acharItem(itemId);
    if (!org) return;
    const destino = destinoDoArrasto(trabalho, o);
    if (!destino) return;
    const destCatId = destino.categoria.id;
    const destIndex = destino.indice;
    if (destCatId === org.c.id) {
      if (destIndex !== org.i) mover(itemId, destCatId, destIndex);
      return;
    }
    // Outro lugar: pergunta, como no protótipo — mover ou copiar.
    setSoltou({ itemId, destCatId, destIndex });
  };

  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  const totalEntradas = trabalho.modulos.reduce((n, m) => n + m.categorias.reduce((k, c) => k + c.itens.length, 0), 0);
  const itemArrastado = itemArrastadoId ? acharItem(itemArrastadoId)?.item : null;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="Organizar Menu Lateral"
        subtitle="Arraste os submódulos entre módulos e categorias, crie pastas e atalhos. Salvar vale para o menu de todos."
        module="Sistemas"
        breadcrumb={["Sistemas", "Organizar Menu Lateral"]}
      />

      <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Aqui muda só <strong>onde</strong> cada tela aparece no menu. <strong>Quem vê</strong> cada tela continua sendo definido em
          Administração › Acesso por Usuário: mover uma tela para outro módulo não dá acesso a ninguém, e tirar do menu não bloqueia
          quem tem permissão.
        </p>
      </div>

      <Tabs defaultValue="estrutura">
        <TabsList>
          <TabsTrigger value="estrutura">Estrutura</TabsTrigger>
          <TabsTrigger value="historico"><History className="mr-1.5 h-3.5 w-3.5" />Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="estrutura" className="space-y-4">
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 p-3 backdrop-blur">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar submódulo…" className="pl-8" />
            </div>
            <span className="text-xs text-muted-foreground">{trabalho.modulos.length} módulos · {totalEntradas} entradas</span>
            {podeAlterar && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPedeNome({
                    titulo: "Novo módulo",
                    valor: "",
                    ajuda: "Um módulo é uma pasta no menu. Depois crie categorias dentro dele e arraste submódulos para lá.",
                    ok: (v) => aplicar(criarModulo(trabalho, v, novoId("m:")), { tipo: "criar", texto: `Criou o módulo "${v}"` }),
                  })}
                >
                  <FolderPlus className="mr-1.5 h-4 w-4" />Novo módulo
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => aplicar(padrao, { tipo: "restaurar", texto: "Voltou ao menu padrão (módulos originais em ordem alfabética)" })}
                >
                  <RotateCcw className="mr-1.5 h-4 w-4" />Menu padrão
                </Button>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" size="sm" disabled={!alteracoes.length || salvando} onClick={descartar}>
                    <Undo2 className="mr-1.5 h-4 w-4" />Descartar
                  </Button>
                  <Button size="sm" disabled={!alteracoes.length || salvando} onClick={salvar}>
                    <Save className="mr-1.5 h-4 w-4" />
                    {salvando ? "Salvando…" : `Salvar${alteracoes.length ? ` (${alteracoes.length})` : ""}`}
                  </Button>
                </div>
              </>
            )}
          </div>

          {!podeAlterar && (
            <p className="text-sm text-muted-foreground">Você pode ver a organização, mas não alterar. Peça a permissão "alterar" de Organizar Menu Lateral.</p>
          )}
          {busca && podeAlterar && <p className="text-xs text-muted-foreground">Durante a busca o arrastar fica desligado — limpe a busca para reorganizar.</p>}

          <DndContext sensors={sensores} collisionDetection={colisao}
            onDragStart={iniciarArrasto} onDragOver={indicarDestino} onDragEnd={soltar} onDragCancel={limparArrasto}>
            <SortableContext items={trabalho.modulos.map((m) => `mod:${m.id}`)} strategy={rectSortingStrategy} disabled={!arrastando}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {trabalho.modulos.map((m) => {
                  const cats = m.categorias.map((c) => ({
                    c,
                    itens: c.itens.filter((it) => !termo || nomeDe(it).toLocaleLowerCase("pt-BR").includes(termo)),
                  }));
                  if (termo && !cats.some((x) => x.itens.length)) return null;
                  return (
                    <CartaoModulo key={m.id} id={m.id} titulo={m.rotulo} arrastavel={arrastando}
                      categoriaDestino={alvoArrasto?.modulo.id === m.id ? alvoArrasto.categoria.rotulo : undefined}
                      acoes={podeAlterar && (
                        <>
                          <BotaoIcone titulo="Renomear módulo" onClick={() => setPedeNome({
                            titulo: "Renomear módulo", valor: m.rotulo,
                            ok: (v) => aplicar(renomear(trabalho, m.id, v), { tipo: "renomear", texto: `Renomeou o módulo "${m.rotulo}" para "${v}"` }),
                          })}><Pencil className="h-3.5 w-3.5" /></BotaoIcone>
                          <BotaoIcone titulo="Nova categoria" onClick={() => setPedeNome({
                            titulo: `Nova categoria em ${m.rotulo}`, valor: "",
                            ok: (v) => aplicar(criarCategoria(trabalho, m.id, v, novoId("c:")), { tipo: "criar", texto: `Criou a categoria "${v}" em ${m.rotulo}` }),
                          })}><Plus className="h-3.5 w-3.5" /></BotaoIcone>
                          {m.categorias.every((c) => c.itens.length === 0) && (
                            <BotaoIcone titulo="Apagar módulo vazio" onClick={() => aplicar(remover(trabalho, m.id), { tipo: "remover", texto: `Apagou o módulo vazio "${m.rotulo}"` })}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </BotaoIcone>
                          )}
                        </>
                      )}
                    >
                      {m.categorias.length === 0 && <p className="px-1 py-3 text-xs text-muted-foreground">Módulo vazio. Crie uma categoria (+) para receber submódulos.</p>}
                      {cats.map(({ c, itens }, ci) => (
                        <Categoria key={c.id} id={c.id} titulo={c.rotulo}
                          destinoAtivo={alvoArrasto?.categoria.id === c.id}
                          acoes={podeAlterar && (
                            <>
                              {ci > 0 && <BotaoIcone titulo="Subir categoria" onClick={() => aplicar(moverCategoria(trabalho, c.id, m.id, ci - 1), { tipo: "ordenar", texto: `Subiu a categoria "${c.rotulo}" em ${m.rotulo}` })}><ArrowUp className="h-3 w-3" /></BotaoIcone>}
                              {ci < m.categorias.length - 1 && <BotaoIcone titulo="Descer categoria" onClick={() => aplicar(moverCategoria(trabalho, c.id, m.id, ci + 1), { tipo: "ordenar", texto: `Desceu a categoria "${c.rotulo}" em ${m.rotulo}` })}><ArrowDown className="h-3 w-3" /></BotaoIcone>}
                              <BotaoIcone titulo="Renomear categoria" onClick={() => setPedeNome({
                                titulo: "Renomear categoria", valor: c.rotulo,
                                ok: (v) => aplicar(renomear(trabalho, c.id, v), { tipo: "renomear", texto: `Renomeou a categoria "${c.rotulo}" para "${v}" em ${m.rotulo}` }),
                              })}><Pencil className="h-3 w-3" /></BotaoIcone>
                              <BotaoIcone titulo="Novo submódulo (atalho para uma tela)" onClick={() => setAtalhoEm(c.id)}><Plus className="h-3 w-3" /></BotaoIcone>
                              {c.itens.length === 0 && (
                                <BotaoIcone titulo="Apagar categoria vazia" onClick={() => aplicar(remover(trabalho, c.id), { tipo: "remover", texto: `Apagou a categoria vazia "${c.rotulo}" de ${m.rotulo}` })}>
                                  <Trash2 className="h-3 w-3" />
                                </BotaoIcone>
                              )}
                            </>
                          )}
                        >
                          <SortableContext items={itens.map((it) => `item:${it.id}`)} strategy={verticalListSortingStrategy} disabled={!arrastando}>
                            {itens.map((it) => {
                              const sit = situacaoDoItem(it, m, c, padrao);
                              return (
                                <Entrada key={it.id} id={it.id} nome={nomeDe(it)} rota={it.rota} situacao={sit} arrastavel={arrastando}
                                  acoes={podeAlterar && (
                                    <>
                                      <BotaoIcone titulo="Mover ou copiar para…" onClick={() => setDestinoDe(it.id)}><MoveRight className="h-3 w-3" /></BotaoIcone>
                                      <BotaoIcone titulo="Renomear (vazio volta ao nome original)" onClick={() => setPedeNome({
                                        titulo: "Nome exibido no menu", valor: nomeDe(it),
                                        ajuda: it.ref ? "Deixe em branco para voltar ao nome original da tela." : undefined,
                                        ok: (v) => aplicar(renomear(trabalho, it.id, v), { tipo: "renomear", texto: `Renomeou "${nomeDe(it)}" para "${v || "(nome original)"}" em ${m.rotulo} › ${c.rotulo}` }),
                                        // vazio é permitido aqui: volta ao nome do catálogo
                                      })}><Pencil className="h-3 w-3" /></BotaoIcone>
                                      {sit === "movido" && (
                                        <BotaoIcone titulo="Restaurar posição original" onClick={() => aplicar(restaurarOriginal(trabalho, it.id, padrao), { tipo: "mover", texto: `Devolveu "${nomeDe(it)}" ao lugar original` })}>
                                          <RotateCcw className="h-3 w-3" />
                                        </BotaoIcone>
                                      )}
                                      <BotaoIcone titulo="Tirar do menu" onClick={() => aplicar(remover(trabalho, it.id), {
                                        tipo: "remover", texto: `Tirou "${nomeDe(it)}" de ${m.rotulo} › ${c.rotulo}`,
                                      })}><Trash2 className="h-3 w-3" /></BotaoIcone>
                                    </>
                                  )}
                                />
                              );
                            })}
                          </SortableContext>
                          {itens.length === 0 && !termo && <p className="rounded border border-dashed px-2 py-2 text-[11px] text-muted-foreground">Arraste um submódulo para cá.</p>}
                        </Categoria>
                      ))}
                    </CartaoModulo>
                  );
                })}
              </div>
            </SortableContext>
            {/* O portal escapa do overflow do AppShell. A camada não captura
                o mouse, preservando a detecção dos destinos e a rolagem. */}
            {createPortal(
              <>
                {itemArrastado && <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] bg-black/30" />}
                <DragOverlay dropAnimation={null} zIndex={70} style={{ pointerEvents: "none" }}>
                  {itemArrastado && (
                    <div aria-hidden="true" className="flex cursor-grabbing items-center gap-2 rounded-md border border-primary bg-background px-3 py-2 text-[13px] font-medium text-foreground shadow-2xl ring-2 ring-primary">
                      <GripVertical className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{nomeDe(itemArrastado)}</span>
                    </div>
                  )}
                </DragOverlay>
              </>,
              document.body,
            )}
          </DndContext>

          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {Object.values(ROTULO_SITUACAO).map((s) => <span key={s.texto} className={cn("rounded px-1.5 py-0.5 font-semibold", s.classe)}>{s.texto}</span>)}
            <span>em relação ao menu padrão.</span>
          </div>
        </TabsContent>

        <TabsContent value="historico">
          <Historico podeAlterar={podeAlterar} versaoAtual={salvo.data?.versao ?? null} temEdicaoAberta={alteracoes.length > 0} />
        </TabsContent>
      </Tabs>

      {/* Nome (criar módulo/categoria, renomear) */}
      <DialogoNome estado={pedeNome} fechar={() => setPedeNome(null)} />

      {/* Soltou em outro lugar: mover ou copiar? */}
      <Dialog open={!!soltou} onOpenChange={(v) => !v && setSoltou(null)}>
        <DialogContent className="sm:max-w-md [overflow-wrap:anywhere]">
          <DialogHeader>
            <DialogTitle>O que deseja fazer?</DialogTitle>
            <DialogDescription>
              {soltou && <>"{nomeDe(acharItem(soltou.itemId)!.item)}" → {onde(soltou.destCatId)}</>}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong>Mover</strong> tira do lugar atual. <strong>Copiar</strong> mantém o original e cria outra entrada no destino, apontando para a mesma tela.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setSoltou(null)}>Cancelar</Button>
            <Button variant="outline" onClick={() => { if (soltou) copiar(soltou.itemId, soltou.destCatId, soltou.destIndex); setSoltou(null); }}>
              <Copy className="mr-1.5 h-4 w-4" />Copiar
            </Button>
            <Button onClick={() => { if (soltou) mover(soltou.itemId, soltou.destCatId, soltou.destIndex); setSoltou(null); }}>
              <MoveRight className="mr-1.5 h-4 w-4" />Mover
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mover/copiar sem arrastar (teclado, tela pequena) */}
      <DialogoDestino
        aberto={!!destinoDe}
        nome={destinoDe ? nomeDe(acharItem(destinoDe)!.item) : ""}
        origemCatId={destinoDe ? catDoItem(destinoDe)?.id ?? "" : ""}
        estrutura={trabalho}
        fechar={() => setDestinoDe(null)}
        mover={(cat) => { if (destinoDe) mover(destinoDe, cat); setDestinoDe(null); }}
        copiar={(cat) => { if (destinoDe) copiar(destinoDe, cat); setDestinoDe(null); }}
      />

      {/* Novo submódulo = atalho para uma tela existente */}
      <DialogoAtalho
        aberto={!!atalhoEm}
        destino={atalhoEm ? onde(atalhoEm) : ""}
        fechar={() => setAtalhoEm(null)}
        criar={(rota, nome) => {
          if (atalhoEm) aplicar(criarAtalho(trabalho, atalhoEm, rota, nome, novoId("at:")), { tipo: "criar", texto: `Criou o submódulo "${nome}" (${rota}) em ${onde(atalhoEm)}` });
          setAtalhoEm(null);
        }}
      />
    </div>
  );
}

function useSensorsSeguros() {
  return useSensors(
    // 6 px antes de começar a arrastar: clique nos botões da linha não vira arrasto.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

function BotaoIcone({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function CartaoModulo({ id, titulo, acoes, arrastavel, categoriaDestino, children }: {
  id: string; titulo: string; acoes: ReactNode; arrastavel: boolean; categoriaDestino?: string; children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: `mod:${id}`, disabled: !arrastavel });
  return (
    <section
      ref={setNodeRef}
      style={{ transform: DndCSS.Translate.toString(transform), transition }}
      className={cn(
        "relative flex flex-col rounded-xl border bg-card shadow-sm",
        isDragging && "z-20 opacity-80 ring-2 ring-primary",
        categoriaDestino && "z-10 border-primary ring-2 ring-primary shadow-lg shadow-primary/25",
      )}
    >
      {categoriaDestino && (
        <span role="status" className="pointer-events-none absolute -top-3 right-3 max-w-[calc(100%-1.5rem)] truncate rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm">
          Solte em {categoriaDestino}
        </span>
      )}
      <header className="flex items-center gap-1 border-b px-3 py-2">
        {arrastavel && (
          <button ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" title="Arraste para mudar a posição do módulo" className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold" title={titulo}>{titulo}</h3>
        {acoes}
      </header>
      <div className="space-y-3 p-3">{children}</div>
    </section>
  );
}

function Categoria({ id, titulo, acoes, destinoAtivo, children }: { id: string; titulo: string; acoes: ReactNode; destinoAtivo: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `cat:${id}` });
  return (
    <div ref={setNodeRef} className={cn("rounded-lg border border-transparent p-1", destinoAtivo && "border-primary/60 bg-primary/5")}>
      <div className="mb-1 flex items-center gap-1 px-1">
        <p className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" title={titulo}>{titulo}</p>
        {acoes}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Entrada({ id, nome, rota, situacao, arrastavel, acoes }: {
  id: string; nome: string; rota: string; situacao: SituacaoItem; arrastavel: boolean; acoes: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `item:${id}`, disabled: !arrastavel });
  const marca = situacao !== "original" ? ROTULO_SITUACAO[situacao] : null;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: isDragging ? undefined : DndCSS.Translate.toString(transform), transition }}
      className={cn(
        "group flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 text-[13px]",
        arrastavel && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-30 border-dashed",
      )}
      {...attributes}
      {...listeners}
      title={rota}
    >
      {arrastavel && <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />}
      <span className="min-w-0 flex-1 leading-snug [overflow-wrap:anywhere]">{nome}</span>
      {marca && <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", marca.classe)}>{marca.texto}</span>}
      {acoes && (
        // Os botões param o arrasto: clicar neles não pode começar a mover a linha.
        <span className="flex shrink-0 opacity-60 group-hover:opacity-100" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {acoes}
        </span>
      )}
    </div>
  );
}

function DialogoNome({ estado, fechar }: { estado: { titulo: string; valor: string; ajuda?: string; ok: (v: string) => void } | null; fechar: () => void }) {
  const [valor, setValor] = useState("");
  useEffect(() => { setValor(estado?.valor ?? ""); }, [estado]);
  // Renomear entrada aceita vazio (volta ao nome original); o resto não.
  const aceitaVazio = !!estado?.ajuda?.includes("em branco");
  const invalido = (!aceitaVazio && !valor.trim()) || valor.trim().length > 120;
  return (
    <Dialog open={!!estado} onOpenChange={(v) => !v && fechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{estado?.titulo}</DialogTitle>
          {estado?.ajuda && <DialogDescription>{estado.ajuda}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (!invalido && estado) { estado.ok(valor.trim()); fechar(); } }}>
          <Input autoFocus value={valor} maxLength={120} onChange={(e) => setValor(e.target.value)} />
          <DialogFooter className="mt-4 gap-2">
            <Button type="button" variant="ghost" onClick={fechar}>Cancelar</Button>
            <Button type="submit" disabled={invalido}>Confirmar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DialogoDestino({ aberto, nome, origemCatId, estrutura, fechar, mover, copiar }: {
  aberto: boolean; nome: string; origemCatId: string; estrutura: EstruturaMenu;
  fechar: () => void; mover: (catId: string) => void; copiar: (catId: string) => void;
}) {
  const [cat, setCat] = useState("");
  useEffect(() => { if (aberto) setCat(""); }, [aberto]);
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover ou copiar "{nome}"</DialogTitle>
          <DialogDescription>Escolha o módulo e a categoria de destino.</DialogDescription>
        </DialogHeader>
        <Label htmlFor="destino-menu">Destino</Label>
        <select id="destino-menu" value={cat} onChange={(e) => setCat(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
          <option value="">Escolha…</option>
          {estrutura.modulos.map((m) => (
            <optgroup key={m.id} label={m.rotulo}>
              {m.categorias.map((c) => (
                <option key={c.id} value={c.id} disabled={c.id === origemCatId}>{m.rotulo} › {c.rotulo}{c.id === origemCatId ? " (atual)" : ""}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={fechar}>Cancelar</Button>
          <Button variant="outline" disabled={!cat} onClick={() => copiar(cat)}><Copy className="mr-1.5 h-4 w-4" />Copiar</Button>
          <Button disabled={!cat} onClick={() => mover(cat)}><MoveRight className="mr-1.5 h-4 w-4" />Mover</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Novo submódulo": escolhe uma tela que JÁ EXISTE. Não cria tela — criar uma
 * tela de verdade continua sendo trabalho de desenvolvimento. A lista vem do
 * catálogo da Sidebar mais as telas cadastradas em app_menu com endereço.
 */
function DialogoAtalho({ aberto, destino, fechar, criar }: {
  aberto: boolean; destino: string; fechar: () => void; criar: (rota: string, nome: string) => void;
}) {
  const [busca, setBusca] = useState("");
  const [rota, setRota] = useState("");
  const [nome, setNome] = useState("");
  useEffect(() => { if (aberto) { setBusca(""); setRota(""); setNome(""); } }, [aberto]);

  const doCatalogo = useMemo(() => telasDoCatalogo(NAV_MODULOS), []);
  const cadastradas = useQuery({
    queryKey: ["menu-lateral-telas-app-menu"],
    enabled: aberto,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("app_menu").select("nome, rota, ativo").not("rota", "is", null).eq("ativo", true);
      if (error) return [] as { rota: string; nome: string; modulo: string }[];
      return (data ?? []).map((m: { nome: string; rota: string | null }) => ({ rota: m.rota as string, nome: m.nome, modulo: "Cadastro de telas" }));
    },
  });
  const telas = useMemo(() => {
    const vistas = new Set(doCatalogo.map((t) => t.rota));
    const extras = (cadastradas.data ?? []).filter((t) => /^\/app(\/|\?|$)/.test(t.rota) && !vistas.has(t.rota));
    return [...doCatalogo, ...extras];
  }, [doCatalogo, cadastradas.data]);
  const t = busca.trim().toLocaleLowerCase("pt-BR");
  const filtradas = telas.filter((x) => !t || `${x.nome} ${x.modulo} ${x.rota}`.toLocaleLowerCase("pt-BR").includes(t)).slice(0, 80);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && fechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo submódulo</DialogTitle>
          <DialogDescription>
            Um atalho no menu para uma tela que já existe, em {destino}. Só aparece para quem já tem permissão na tela.
          </DialogDescription>
        </DialogHeader>
        <Input autoFocus placeholder="Procurar tela…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="max-h-64 overflow-y-auto rounded-md border">
          {filtradas.map((x) => (
            <button
              key={`${x.modulo}-${x.rota}`}
              type="button"
              onClick={() => { setRota(x.rota); if (!nome) setNome(x.nome); }}
              className={cn("block w-full px-3 py-1.5 text-left text-sm hover:bg-muted", rota === x.rota && "bg-primary/10")}
            >
              <span className="font-medium">{x.nome}</span>
              <span className="ml-2 text-xs text-muted-foreground">{x.modulo} · {x.rota}</span>
            </button>
          ))}
          {!filtradas.length && <p className="p-3 text-sm text-muted-foreground">Nenhuma tela encontrada.</p>}
        </div>
        <Label htmlFor="nome-atalho">Nome no menu</Label>
        <Input id="nome-atalho" value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={fechar}>Cancelar</Button>
          <Button disabled={!rota || !nome.trim()} onClick={() => criar(rota, nome.trim())}>Criar submódulo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface VersaoLinha {
  versao: number;
  resumo: string | null;
  alteracoes: Alteracao[] | null;
  autor_nome: string | null;
  created_at: string;
}

/** Log: cada gravação é uma versão. Restaurar grava a versão escolhida como nova. */
function Historico({ podeAlterar, versaoAtual, temEdicaoAberta }: { podeAlterar: boolean; versaoAtual: number | null; temEdicaoAberta: boolean }) {
  const qc = useQueryClient();
  const [aberta, setAberta] = useState<number | null>(null);
  const [restaurando, setRestaurando] = useState<number | null>(null);
  const hist = useQuery({
    queryKey: ["menu-lateral-historico"],
    queryFn: async (): Promise<VersaoLinha[]> => {
      const { data, error } = await tabela().select("versao, resumo, alteracoes, autor_nome, created_at").order("versao", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const restaurar = async (versao: number) => {
    setRestaurando(versao);
    const { data: linha, error: e1 } = await tabela().select("estrutura").eq("versao", versao).maybeSingle();
    if (e1 || !linha) { setRestaurando(null); toast.error("Não foi possível ler essa versão."); return; }
    const { data, error } = await rpc.rpc("menu_lateral_salvar", {
      p_estrutura: linha.estrutura,
      p_versao_base: versaoAtual,
      p_resumo: `Restaurou a versão ${versao}`,
      p_alteracoes: [{ tipo: "restaurar", texto: `Restaurou a organização da versão ${versao}` }],
    });
    setRestaurando(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Versão ${versao} restaurada como versão ${data}.`);
    await qc.invalidateQueries({ queryKey: CHAVE_MENU_LATERAL });
    await qc.invalidateQueries({ queryKey: ["menu-lateral-historico"] });
  };

  if (hist.isLoading) return <p className="p-4 text-sm text-muted-foreground">Carregando histórico…</p>;
  if (hist.error) return <p className="p-4 text-sm text-destructive">Não foi possível carregar o histórico.</p>;
  if (!hist.data?.length) {
    return <p className="p-4 text-sm text-muted-foreground">Nenhuma alteração salva ainda — o menu está no padrão (módulos originais em ordem alfabética).</p>;
  }

  return (
    <div className="divide-y rounded-lg border">
      {hist.data.map((v) => (
        <div key={v.versao} className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-bold">v{v.versao}</span>
            {v.versao === versaoAtual && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">em uso</span>}
            <span className="text-sm font-medium">{v.resumo ?? "Alteração no menu"}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {v.autor_nome ?? "—"} · {new Date(v.created_at).toLocaleString("pt-BR")}
            </span>
          </div>
          <div className="mt-1 flex gap-2">
            {!!v.alteracoes?.length && (
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setAberta(aberta === v.versao ? null : v.versao)}>
                {aberta === v.versao ? "Esconder" : `Ver ${v.alteracoes.length} alteração(ões)`}
              </Button>
            )}
            {podeAlterar && v.versao !== versaoAtual && (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                disabled={restaurando !== null || temEdicaoAberta}
                title={temEdicaoAberta ? "Salve ou descarte a edição aberta antes de restaurar" : undefined}
                onClick={() => { if (window.confirm(`Restaurar a organização da versão ${v.versao}? Ela vira a versão em uso para todos.`)) restaurar(v.versao); }}
              >
                {restaurando === v.versao ? "Restaurando…" : "Restaurar esta versão"}
              </Button>
            )}
          </div>
          {aberta === v.versao && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {v.alteracoes!.map((a, i) => <li key={i}>{a.texto}</li>)}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
