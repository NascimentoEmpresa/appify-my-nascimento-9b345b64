import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight, Eraser, Eye, History, Link2, Loader2, Maximize, Minimize, Minus, Move, Network, Plus, Redo2, Save, Search, Send, Spline,
  Undo2, UserX, Users, Wand2, Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useEstrutura, useGravarEstrutura } from "@/hooks/useEstruturaProcessos";
import {
  autoOrganizar, cadeiaDoSetor, conexaoEntreSetores, membrosPendentes, processosDoSetor, type Estrutura, type Membro, type TipoConexao,
} from "@/lib/organograma/estruturaProcessos";
import { AmostraTraco, IconeSetor, StatusDesenvolvimento, cor } from "@/components/organograma-processos/visual";
import { CanvasSetor } from "@/components/organograma-processos/CanvasSetor";
import { PropriedadesProcesso, PropriedadesSetor, type Apagar, type Gravar } from "@/components/organograma-processos/PainelPropriedades";
import { DialogoHistorico, DialogoMembro, DialogoNovoProcesso, DialogoNovoSetor, DialogoPublicar } from "@/components/organograma-processos/Dialogos";

// =====================================================================
// ORGANOGRAMA › CADASTRO DA ESTRUTURA DE SETORES E PROCESSOS
// (mig 20261020000060, 20/10/2026)
//
// Onde se monta o que o Organograma Geral mostra: setores, a equipe de cada
// um (do gerente ao jovem aprendiz, com funções), os processos (P-001…) com
// responsável, frequência, entrada/saída, próxima etapa, e as conexões com
// processos de outros setores. Tela feita sobre a referência do chamado:
// lista de setores à esquerda, o canvas do setor no meio (os setores
// ligados a ele em volta) e as propriedades à direita.
//
// Tudo grava direto no RASCUNHO (as tabelas); arrastar um processo só muda
// a posição local até "Salvar rascunho". "Publicar estrutura" tira o retrato
// que o Organograma Geral passa a mostrar; "Pré-visualizar" abre o Geral
// com o rascunho. Desfazer/refazer valem para as posições do canvas.
// =====================================================================

type Posicoes = Record<string, { x: number; y: number }>;

export default function CadastroEstruturaProcessos() {
  const q = useEstrutura(false);
  const { user } = useAuth();
  const g = useGravarEstrutura();
  const podeIncluir = useScreenAccess("organograma_processos_cadastro", "incluir").data === true;
  const podeAlterar = useScreenAccess("organograma_processos_cadastro", "alterar").data === true;
  const podeExcluir = useScreenAccess("organograma_processos_cadastro", "excluir").data === true;
  const e = q.data;
  const autor = (user?.user_metadata?.nome as string | undefined) ?? user?.email ?? null;

  const [setorId, setSetorId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [ligandoDe, setLigandoDe] = useState<string | null>(null);
  const [tipoLigacao, setTipoLigacao] = useState<TipoConexao>("intersetorial");
  const [zoom, setZoom] = useState(0.75);
  const [telaCheia, setTelaCheia] = useState(false);
  const [pos, setPos] = useState<Posicoes>({});
  const [sujo, setSujo] = useState(false);
  const desfazer = useRef<Posicoes[]>([]);
  const refazer = useRef<Posicoes[]>([]);
  const [, forcar] = useState(0);
  const [dlg, setDlg] = useState<null | "setor" | "processo" | "publicar" | "historico">(null);
  const [membro, setMembro] = useState<{ m: Membro | null } | null>(null);

  // Começa no primeiro setor; mantém o escolhido entre recargas.
  useEffect(() => {
    if (!e?.setores.length) return;
    if (!setorId || !e.setores.some((s) => s.id === setorId)) setSetorId(e.setores[0].id);
  }, [e, setorId]);

  const layout = useMemo(() => (e && setorId ? autoOrganizar(e, setorId) : null), [e, setorId]);
  // Posições: as do layout (salvas ou automáticas), com o que foi arrastado por cima.
  useEffect(() => {
    if (!layout) return;
    setPos((atual) => {
      const novo: Posicoes = { ...layout.processos };
      if (sujo) for (const [id, p] of Object.entries(atual)) if (novo[id]) novo[id] = p;
      return novo;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);
  useEffect(() => { setSel(null); setLigandoDe(null); setSujo(false); desfazer.current = []; refazer.current = []; }, [setorId]);

  const gravar: Gravar = (tabela, dados) => g.salvar.mutateAsync({ tabela, dados });
  const apagar: Apagar = (tabela, id) => g.excluir.mutateAsync({ tabela, id });

  if (q.isLoading) return <Card className="m-4 flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando a estrutura…</Card>;
  if (q.error || !e) return <Card className="m-4 p-8 text-sm text-red-600">{(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>;

  const setor = e.setores.find((s) => s.id === setorId) ?? null;
  const processoSel = e.processos.find((p) => p.id === sel) ?? null;
  const podeEditar = podeAlterar;

  const guardarHistorico = () => { desfazer.current.push(pos); refazer.current = []; };
  const mover = (id: string, x: number, y: number) => {
    if (!sujo) guardarHistorico();
    setPos((p) => ({ ...p, [id]: { x, y } }));
    setSujo(true);
  };
  const voltar = () => { const ant = desfazer.current.pop(); if (!ant) return; refazer.current.push(pos); setPos(ant); setSujo(true); forcar((n) => n + 1); };
  const avancar = () => { const prox = refazer.current.pop(); if (!prox) return; desfazer.current.push(pos); setPos(prox); setSujo(true); forcar((n) => n + 1); };
  const autoOrg = () => { if (!setorId) return; guardarHistorico(); setPos(autoOrganizar(e, setorId, false).processos); setSujo(true); };
  const ajustar = () => { guardarHistorico(); setPos((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { x: Math.round(v.x / 10) * 10, y: Math.round(v.y / 10) * 10 }]))); setSujo(true); };

  const salvarRascunho = async () => {
    if (!setorId) return;
    const lista = processosDoSetor(e, setorId).map((p) => ({ id: p.id, pos_x: pos[p.id]?.x ?? 0, pos_y: pos[p.id]?.y ?? 0 }));
    try { await g.posicoes.mutateAsync(lista); setSujo(false); toast.success("Rascunho salvo."); }
    catch (err) { toast.error((err as Error).message); }
  };

  const clicarProcesso = async (id: string) => {
    if (!ligandoDe) { setSel(id); return; }
    if (id === ligandoDe) { setLigandoDe(null); return; }
    try {
      await gravar("ORG_PROC_CONEXAO", { origem_id: ligandoDe, destino_id: id, tipo: tipoLigacao });
      toast.success("Conexão criada.");
    } catch (err) { toast.error(/duplicate|unique/i.test((err as Error).message) ? "Essa conexão já existe." : (err as Error).message); }
    setLigandoDe(null);
  };

  const duplicar = async () => {
    if (!processoSel) return;
    const { id, codigo, ...resto } = processoSel;
    try {
      const novo = await gravar("ORG_PROC_PROCESSO", {
        ...resto, nome: `${processoSel.nome} (cópia)`, proximo_id: null, principal: false,
        pos_x: (pos[id]?.x ?? 0) + 30, pos_y: (pos[id]?.y ?? 0) + 30, ordem: processoSel.ordem + 1,
      }) as { id: string };
      setSel(novo.id);
      toast.success("Processo duplicado.");
    } catch (err) { toast.error((err as Error).message); }
  };
  const excluirProcesso = async () => {
    if (!processoSel) return;
    if (!podeExcluir) { toast.error("Sem permissão para excluir."); return; }
    if (!confirm(`Excluir o processo ${processoSel.codigo} — ${processoSel.nome}? As conexões dele também saem.`)) return;
    try {
      // Quem apontava para ele passa a apontar para o seguinte (o fluxo não quebra).
      for (const ant of e.processos.filter((p) => p.proximo_id === processoSel.id)) {
        await gravar("ORG_PROC_PROCESSO", { id: ant.id, proximo_id: processoSel.proximo_id });
      }
      await apagar("ORG_PROC_PROCESSO", processoSel.id);
      setSel(null);
    } catch (err) { toast.error((err as Error).message); }
  };

  const criarProcesso = async (d: { nome: string; setor_id: string; frequencia: string | null; responsavel_membro_id: string | null; encadear: boolean }) => {
    const cadeia = cadeiaDoSetor(processosDoSetor(e, d.setor_id));
    const ultimo = cadeia.filter((p) => !p.proximo_id).pop();
    const novo = await gravar("ORG_PROC_PROCESSO", {
      setor_id: d.setor_id, nome: d.nome, frequencia: d.frequencia, responsavel_membro_id: d.responsavel_membro_id,
      ordem: (Math.max(0, ...cadeia.map((p) => p.ordem)) || 0) + 1,
    }) as { id: string };
    if (d.encadear && ultimo) await gravar("ORG_PROC_PROCESSO", { id: ultimo.id, proximo_id: novo.id });
    setSetorId(d.setor_id); setSel(novo.id);
    toast.success("Processo criado.");
  };

  const telaCheiaCls = telaCheia ? "fixed inset-2 z-50 flex flex-col bg-background shadow-2xl" : "";

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho ── */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <nav className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>ERP</span><ChevronRight className="h-3 w-3" /><span>Organograma</span><ChevronRight className="h-3 w-3" />
            <span className="font-semibold text-foreground">Estrutura de Setores e Processos</span>
          </nav>
          <h1 className="font-display text-2xl font-bold tracking-tight lg:text-[28px]">Cadastro da Estrutura de Setores e Processos</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Cadastre a estrutura funcional de cada setor, os responsáveis, atividades, processos e conexões intersetoriais.
            Organize os blocos livremente e publique a estrutura para visualização no organograma geral.
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <StatusDesenvolvimento />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={salvarRascunho} disabled={!podeEditar || !sujo || g.posicoes.isPending}>
              {g.posicoes.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Salvar rascunho
            </Button>
            <Button onClick={() => setDlg("publicar")} disabled={!podeEditar}><Send className="mr-1.5 h-4 w-4" /> Publicar estrutura</Button>
            <Button variant="outline" onClick={() => setDlg("historico")}><History className="mr-1.5 h-4 w-4" /> Histórico</Button>
            <Button variant="outline" onClick={() => window.open("/app/organograma/processos?previa=1", "_blank")}><Eye className="mr-1.5 h-4 w-4" /> Pré-visualizar</Button>
          </div>
        </div>
      </div>
      {!podeEditar && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">Você está só consultando — editar a estrutura pede “alterar” no Cadastro da Estrutura.</p>}

      <div className="grid gap-3 lg:grid-cols-[250px_minmax(0,1fr)_290px]">
        {/* ── Esquerda: números e setores ── */}
        <Card className="space-y-3 p-3">
          <Numeros e={e} />
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="h-9 pl-8 text-sm" placeholder="Buscar setor, colaborador ou processo..." value={busca} onChange={(x) => setBusca(x.target.value)} />
          </div>
          <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-0.5">
            {listaSetores(e, busca).map((s) => {
              const c = cor(s.cor);
              const n = processosDoSetor(e, s.id).length;
              return (
                <button key={s.id} onClick={() => setSetorId(s.id)}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition", c.fundo,
                    s.id === setorId ? cn("border-2", c.borda, "shadow-sm") : "border-transparent hover:border-slate-200")}>
                  <IconeSetor icone={s.icone} corSetor={s.cor} />
                  <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{s.nome}</div><div className="text-[11px] text-muted-foreground">{n} processos</div></div>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => setDlg("setor")} disabled={!podeIncluir && !podeAlterar}><Plus className="mr-1 h-4 w-4" /> Novo setor</Button>
            <Button size="sm" variant="outline" className="text-primary" onClick={() => setDlg("processo")} disabled={!podeIncluir && !podeAlterar}><Plus className="mr-1 h-4 w-4" /> Novo processo</Button>
          </div>
        </Card>

        {/* ── Meio: canvas ── */}
        <Card className={cn("flex min-w-0 flex-col overflow-hidden", telaCheiaCls)}>
          <div className="flex flex-wrap items-center gap-2 border-b p-2">
            <Select value={setorId ?? ""} onValueChange={setSetorId}>
              <SelectTrigger className="h-9 w-52 font-semibold">
                <SelectValue placeholder="Setor" />
              </SelectTrigger>
              <SelectContent>{e.setores.map((s) => <SelectItem key={s.id} value={s.id}><span className="inline-flex items-center gap-2"><IconeSetor icone={s.icone} corSetor={s.cor} tamanho="sm" />{s.nome}</span></SelectItem>)}</SelectContent>
            </Select>
            <div className="flex rounded-md border">
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Desfazer" onClick={voltar} disabled={!desfazer.current.length}><Undo2 className="h-4 w-4" /></Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Refazer" onClick={avancar} disabled={!refazer.current.length}><Redo2 className="h-4 w-4" /></Button>
            </div>
            <div className="flex items-center rounded-md border">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(0.4, Math.round((z - 0.1) * 10) / 10))}><Minus className="h-4 w-4" /></Button>
              <span className="w-12 text-center text-sm font-medium">{Math.round(zoom * 100)}%</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10))}><Plus className="h-4 w-4" /></Button>
            </div>
            <Button variant="outline" size="icon" className="h-8 w-8" title={telaCheia ? "Sair da tela cheia" : "Tela cheia"} onClick={() => setTelaCheia((t) => !t)}>
              {telaCheia ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="text-primary" onClick={autoOrg} disabled={!podeEditar}><Wand2 className="mr-1.5 h-4 w-4" /> Auto-organizar</Button>
              <Button variant="outline" size="sm" className="text-primary" onClick={ajustar} disabled={!podeEditar}><Spline className="mr-1.5 h-4 w-4" /> Ajustar conexões</Button>
              <Button variant="outline" size="sm" onClick={() => { setSel(null); setLigandoDe(null); }}><Eraser className="mr-1.5 h-4 w-4" /> Limpar seleção</Button>
            </div>
          </div>
          {ligandoDe && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-sky-50 px-3 py-1.5 text-xs text-sky-900">
              <Link2 className="h-3.5 w-3.5" /> Clique no processo que vai <b>receber</b> a conexão (no setor ou nos setores ao redor). Tipo:
              <select value={tipoLigacao} onChange={(x) => setTipoLigacao(x.target.value as TipoConexao)} className="h-6 rounded border bg-white px-1">
                <option value="intersetorial">Conexão intersetorial</option><option value="fluxo">Fluxo principal</option>
                <option value="retorno">Retorno / Validação</option><option value="revisao">Em revisão</option><option value="bloqueado">Bloqueado</option>
              </select>
              <button className="ml-auto underline" onClick={() => setLigandoDe(null)}>Cancelar</button>
            </div>
          )}
          <div className={cn("relative overflow-auto bg-[radial-gradient(circle,#e2e8f0_1px,transparent_1px)] [background-size:18px_18px]", telaCheia ? "flex-1" : "h-[640px]")}>
            {setor && layout ? (
              <div className="mx-auto w-fit p-3">
                <CanvasSetor
                  e={e} setorId={setor.id} layout={layout} pos={pos} zoom={zoom} selecionado={sel} ligandoDe={ligandoDe} podeEditar={podeEditar}
                  onSelecionar={(id) => { if (!ligandoDe) setSel(id); }} onMover={mover} onFimArrasto={() => forcar((n) => n + 1)}
                  onClicarProcesso={clicarProcesso} onAbrirSetor={(id) => setSetorId(id)}
                  onEditar={() => document.getElementById("org-prop-nome")?.focus()}
                  onDuplicar={duplicar} onLigar={() => sel && setLigandoDe(sel)} onExcluir={excluirProcesso}
                  onAlternarPrincipal={() => processoSel && gravar("ORG_PROC_PROCESSO", { id: processoSel.id, principal: !processoSel.principal }).catch((x) => toast.error(x.message))}
                  onAlternarTrava={() => processoSel && gravar("ORG_PROC_PROCESSO", { id: processoSel.id, bloquear_posicao: !processoSel.bloquear_posicao, pos_x: Math.round(pos[processoSel.id]?.x ?? 0), pos_y: Math.round(pos[processoSel.id]?.y ?? 0) }).catch((x) => toast.error(x.message))}
                />
              </div>
            ) : <p className="p-10 text-center text-sm text-muted-foreground">Cadastre o primeiro setor para começar.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-3 py-2 text-xs">
            <span className="font-semibold">Legenda das Conexões:</span>
            {(["fluxo", "intersetorial", "retorno", "bloqueado", "revisao"] as TipoConexao[]).map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><AmostraTraco tipo={t} />
                {t === "fluxo" ? "Fluxo principal" : t === "intersetorial" ? "Conexão intersetorial" : t === "retorno" ? "Retorno / Validação" : t === "bloqueado" ? "Bloqueado" : "Em revisão"}
              </span>
            ))}
            <span className="ml-auto inline-flex items-center gap-1.5 text-muted-foreground"><Move className="h-3.5 w-3.5" /> Arraste os blocos para mover</span>
          </div>
        </Card>

        {/* ── Direita: propriedades ── */}
        <Card className="max-h-[820px] overflow-y-auto p-3" id="org-propriedades">
          {processoSel ? (
            <PropriedadesProcesso key={processoSel.id} e={e} processo={processoSel} podeEditar={podeEditar} gravar={gravar} apagar={apagar} autor={autor} onFechar={() => setSel(null)} />
          ) : setor ? (
            <>
              <div className="mb-2 flex items-center gap-2"><IconeSetor icone={setor.icone} corSetor={setor.cor} tamanho="sm" /><h3 className="text-sm font-semibold">Propriedades do setor</h3></div>
              <p className="mb-3 text-xs text-muted-foreground">Selecione um processo no canvas para ver as propriedades dele.</p>
              <PropriedadesSetor e={e} setor={setor} podeEditar={podeEditar} podeExcluir={podeExcluir} gravar={gravar} apagar={apagar}
                onMembro={(m) => setMembro({ m })}
                onExcluirSetor={async () => {
                  if (!confirm(`Excluir o setor ${setor.nome}, com a equipe e os processos dele?`)) return;
                  try { await apagar("ORG_PROC_SETOR", setor.id); setSetorId(null); toast.success("Setor excluído."); } catch (err) { toast.error((err as Error).message); }
                }} />
            </>
          ) : null}
        </Card>
      </div>

      <DialogoNovoSetor e={e} aberto={dlg === "setor"} onFechar={() => setDlg(null)} onCriar={async (d) => {
        const novo = await gravar("ORG_PROC_SETOR", { ...d, ordem: Math.max(0, ...e.setores.map((s) => s.ordem)) + 1 }) as { id: string };
        setSetorId(novo.id); toast.success("Setor criado.");
      }} />
      <DialogoNovoProcesso e={e} setorId={setorId} aberto={dlg === "processo"} onFechar={() => setDlg(null)} onCriar={criarProcesso} />
      <DialogoPublicar aberto={dlg === "publicar"} onFechar={() => setDlg(null)} onPublicar={async (obs) => {
        if (sujo) await salvarRascunho();
        try { const v = await g.publicar.mutateAsync(obs); toast.success(`Estrutura publicada (versão ${v}).`); } catch (err) { toast.error((err as Error).message); throw err; }
      }} />
      <DialogoHistorico aberto={dlg === "historico"} onFechar={() => setDlg(null)} />
      {setor && (
        <DialogoMembro e={e} setorId={setor.id} membro={membro?.m ?? null} aberto={!!membro} onFechar={() => setMembro(null)}
          onSalvar={async (d) => { await gravar("ORG_PROC_MEMBRO", d as Record<string, unknown>); toast.success("Equipe atualizada."); }} />
      )}
    </div>
  );
}

function Numeros({ e }: { e: Estrutura }) {
  const itens = [
    { icone: Network, n: e.setores.length, r: "Setores cadastrados", c: "text-blue-600 bg-blue-50" },
    { icone: Workflow, n: e.processos.filter((p) => p.status === "ativo").length, r: "Processos ativos", c: "text-emerald-600 bg-emerald-50" },
    { icone: Link2, n: e.conexoes.filter((c) => conexaoEntreSetores(e, c)).length, r: "Conexões intersetoriais", c: "text-violet-600 bg-violet-50" },
    { icone: Users, n: e.membros.length - membrosPendentes(e).length, r: "Colaboradores vinculados", c: "text-sky-600 bg-sky-50" },
    // Texto da carga inicial ainda sem pessoa do cadastro (mig 20261022000300):
    // o selo some quando todos estiverem vinculados.
    ...(membrosPendentes(e).length
      ? [{ icone: UserX, n: membrosPendentes(e).length, r: "Pendentes de vínculo (ver a equipe do setor)", c: "text-amber-700 bg-amber-50" }]
      : []),
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {itens.map((x) => (
        <div key={x.r} className="flex items-center gap-2 rounded-lg border p-2">
          <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", x.c)}><x.icone className="h-4 w-4" /></span>
          <div className="min-w-0"><div className="text-lg font-bold leading-none">{x.n}</div><div className="text-[10px] leading-tight text-muted-foreground">{x.r}</div></div>
        </div>
      ))}
    </div>
  );
}

function listaSetores(e: Estrutura, busca: string) {
  const q = busca.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  if (!q) return e.setores;
  const n = (s: string | null | undefined) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return e.setores.filter((s) => n(s.nome).includes(q)
    || e.membros.some((m) => m.setor_id === s.id && n(m.nome).includes(q))
    || e.processos.some((p) => p.setor_id === s.id && (n(p.nome).includes(q) || n(p.codigo).includes(q))));
}
