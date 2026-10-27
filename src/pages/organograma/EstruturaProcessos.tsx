import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown, ChevronRight, Download, ExternalLink, FileJson, FileSpreadsheet, GitBranch, Hand, Loader2, Maximize, Maximize2, Minimize2, Minus,
  Network, Pencil, Plus, Printer, Search, Settings2, Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useEstrutura } from "@/hooks/useEstruturaProcessos";
import {
  FILTRO_GERAL_PADRAO, ROTULO_STATUS, casaBusca, equipeDoSetor, indicadores, linhasCsv, processosDoSetor, processosPrincipais, responsavelDoSetor,
  setoresFiltrados, type Estrutura, type FiltroGeral, type Processo, type Setor, type TipoConexao, type Unidade,
} from "@/lib/organograma/estruturaProcessos";
import { AmostraTraco, Avatar, DefsSetas, IconeSetor, cor, seta } from "@/components/organograma-processos/visual";
import { useConectores, type Ligacao } from "@/components/organograma-processos/conectores";
import { DetalheProcesso, DetalheSetor } from "@/components/organograma-processos/DetalheSetor";
import { PerfilPessoa, type PessoaAberta } from "@/components/organograma-processos/PerfilPessoa";

// =====================================================================
// ORGANOGRAMA › ESTRUTURA DE SETORES E PROCESSOS — ORGANOGRAMA GERAL
// (mig 20261020000060, 20/10/2026)
//
// Chamado: "um organograma da estrutura dos setores, diferente do que já
// foi criado, voltado para a atividade de cada um, desde o gerente até o
// jovem, com detalhamento das funções e os processos do setor conectados
// em cada colaborador da equipe e nos processos e pessoas de outros
// setores". Tela feita sobre a referência enviada no chamado: presidência
// e os processos dela, as diretorias, uma coluna por setor (responsável,
// equipe, processos principais) e embaixo os macroprocessos que cruzam os
// setores, com as linhas de cada setor até eles.
//
// CANVAS (27/10/2026, pedido do Pablo): "funcionar como o Organograma" —
// zoom (roda do mouse, +/−, caber na tela) e arrastar para mover, em vez do
// diagrama fixo que estourava a largura com os 11 setores espremidos. Os
// setores agora ficam agrupados debaixo da diretoria deles, com folga, e as
// linhas setor → macroprocesso correm em FAIXAS: cada macroprocesso tem a sua
// altura e a sua cor, e as linhas que vão para ele viram um barramento só
// (antes cada uma dobrava numa altura diferente e embolavam). Passar o mouse
// num setor/macroprocesso acende só as linhas dele.
//
// Clique em qualquer nó EXPANDE com animação (presidência, diretoria, setor,
// processo, macroprocesso); o detalhe completo (equipe do gerente ao jovem,
// funções, ligações — DetalheSetor/DetalheProcesso) abre pelo botão dentro do
// nó expandido. Mostra a ÚLTIMA PUBLICAÇÃO; quem edita vê o rascunho em
// ?previa=1. O organograma de pessoas (/app/organograma) continua como está.
// =====================================================================

const PREFIXO = "org-geral-";
const COR_LINHA = "#94a3b8";

export default function EstruturaProcessos() {
  const previa = new URLSearchParams(window.location.search).get("previa") === "1";
  const q = useEstrutura(!previa);
  const podeEditar = useScreenAccess("organograma_processos_cadastro", "visualizar").data === true;
  const [f, setF] = useState<FiltroGeral>(FILTRO_GERAL_PADRAO);
  // Abertos: setor (s-), processo (p-), macroprocesso (m-) — nascem fechados.
  // Fechados: presidência/diretoria (u-) — nascem abertos.
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [setorAberto, setSetorAberto] = useState<string | null>(null);
  const [processoAberto, setProcessoAberto] = useState<string | null>(null);
  const [pessoaAberta, setPessoaAberta] = useState<PessoaAberta | null>(null);
  const e = q.data;

  const alternar = useCallback((chave: string) => {
    const conj = chave.startsWith("u-") ? setFechados : setAbertos;
    conj((s) => { const x = new Set(s); if (x.has(chave)) x.delete(chave); else x.add(chave); return x; });
  }, []);
  const expandirTudo = () => {
    if (!e) return;
    setFechados(new Set());
    setAbertos(new Set([...e.setores.map((s) => `s-${s.id}`), ...e.macros.map((m) => `m-${m.id}`)]));
  };
  const recolherTudo = () => { setFechados(new Set()); setAbertos(new Set()); };

  const versao = e && (
    previa ? <span className="font-semibold text-amber-700">Pré-visualização do rascunho (ainda não publicado)</span>
      : e.publicacao ? `Versão ${e.publicacao.versao} publicada em ${new Date(e.publicacao.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}${e.publicacao.por ? ` por ${e.publicacao.por}` : ""}`
      : <span className="text-amber-700">Estrutura ainda não publicada — mostrando o rascunho.</span>
  );

  return (
    <div className="space-y-4 print:space-y-2">
      <style>{CSS_IMPRESSAO}</style>
      {/* O selo "Status de desenvolvimento" já vem do layout (StatusDevTela) — não repetir aqui. */}
      <PageHeader
        className="mb-0"
        title="Estrutura de Setores e Processos"
        subtitle="Hierarquia da empresa, setores, responsáveis e a conexão entre processos internos e intersetoriais."
        module="Organograma"
        breadcrumb={["Estrutura e Processos"]}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5" disabled={!e}><Download className="h-4 w-4" /> Exportar <ChevronDown className="h-3.5 w-3.5" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => e && exportarCsv(e)}><FileSpreadsheet className="mr-2 h-4 w-4" /> Processos (CSV / Excel)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => e && exportarJson(e)}><FileJson className="mr-2 h-4 w-4" /> Estrutura completa (JSON)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {podeEditar && (
              <Button size="sm" className="gap-1.5" asChild><Link to="/app/organograma/processos/cadastro"><Pencil className="h-4 w-4" /> Editar estrutura</Link></Button>
            )}
          </div>
        }
      />
      {versao && <p className="-mt-2 text-xs text-muted-foreground">{versao}</p>}

      {e && <Indicadores e={e} />}

      {/* ── Filtros ── */}
      <Card className="flex flex-wrap items-center gap-2 p-2.5 print:hidden">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Buscar setor, pessoa ou processo…" value={f.busca} onChange={(x) => setF({ ...f, busca: x.target.value })} />
        </div>
        <Seletor valor={f.diretoria} todos="Todas as diretorias" onChange={(v) => setF({ ...f, diretoria: v, setor: "" })}
          opcoes={(e?.unidades ?? []).filter((u) => u.tipo === "diretoria").map((u) => ({ v: u.id, r: u.nome }))} />
        <Seletor valor={f.setor} todos="Todos os setores" onChange={(v) => setF({ ...f, setor: v })}
          opcoes={(e?.setores ?? []).filter((s) => !f.diretoria || s.unidade_id === f.diretoria).map((s) => ({ v: s.id, r: s.nome }))} />
        <Seletor valor={f.unidade} todos="Todos os macroprocessos" onChange={(v) => setF({ ...f, unidade: v })}
          opcoes={(e?.macros ?? []).map((m) => ({ v: m.id, r: m.nome }))} />
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={expandirTudo}><Maximize2 className="h-3.5 w-3.5" /> Expandir tudo</Button>
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={recolherTudo}><Minimize2 className="h-3.5 w-3.5" /> Recolher tudo</Button>
        </div>
      </Card>

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o organograma…</Card>
      ) : q.error || !e ? (
        <Card className="p-8 text-sm text-destructive">{(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : (
        <>
          <Canvas busca={f.busca}>
            <Organograma e={e} f={f} abertos={abertos} fechados={fechados} onAlternar={alternar} onSetor={setSetorAberto} onProcesso={setProcessoAberto} />
          </Canvas>
          <Rodape e={e} onProcesso={setProcessoAberto} />
          <DetalheSetor e={e} setorId={setorAberto} onFechar={() => setSetorAberto(null)} onProcesso={(id) => { setSetorAberto(null); setProcessoAberto(id); }}
            onPessoa={(m) => setPessoaAberta({ membroId: m.id, empregadoId: m.empregado_id })} />
          <DetalheProcesso e={e} processoId={processoAberto} onFechar={() => setProcessoAberto(null)} onProcesso={setProcessoAberto}
            onPessoa={(m) => { setProcessoAberto(null); setPessoaAberta({ membroId: m.id, empregadoId: m.empregado_id }); }} />
          {/* Abre por cima do setor: fechar o perfil volta para a equipe. */}
          <PerfilPessoa e={e} pessoa={pessoaAberta} onFechar={() => setPessoaAberta(null)}
            onProcesso={(id) => { setPessoaAberta(null); setSetorAberto(null); setProcessoAberto(id); }} />
        </>
      )}
    </div>
  );
}

// ── Indicadores do topo ───────────────────────────────────────────────────
function Indicadores({ e }: { e: Estrutura }) {
  const i = indicadores(e);
  const itens = [
    { icone: Users, valor: i.colaboradores, rotulo: "Colaboradores mapeados", cor: "text-blue-600 bg-blue-50 dark:bg-blue-500/15" },
    { icone: Network, valor: i.setores, rotulo: "Setores", cor: "text-indigo-600 bg-indigo-50 dark:bg-indigo-500/15" },
    { icone: Settings2, valor: i.processos, rotulo: "Processos cadastrados", cor: "text-emerald-600 bg-emerald-50 dark:bg-emerald-500/15" },
    { icone: GitBranch, valor: i.conexoes, rotulo: "Conexões intersetoriais", cor: "text-sky-600 bg-sky-50 dark:bg-sky-500/15" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {itens.map((x) => (
        <Card key={x.rotulo} className="flex items-center gap-3 p-3.5">
          <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", x.cor)}><x.icone className="h-5 w-5" /></span>
          <div className="min-w-0">
            <div className="text-2xl font-bold leading-none tabular-nums">{x.valor}</div>
            <div className="mt-1 truncate text-xs text-muted-foreground">{x.rotulo}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Seletor({ valor, todos, opcoes, onChange }: { valor: string; todos: string; opcoes: { v: string; r: string }[]; onChange: (v: string) => void }) {
  return (
    <Select value={valor || "_"} onValueChange={(v) => onChange(v === "_" ? "" : v)}>
      <SelectTrigger className="h-9 w-full text-sm sm:w-52"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="_">{todos}</SelectItem>
        {opcoes.map((o) => <SelectItem key={o.v} value={o.v}>{o.r}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Abre/fecha com animação de altura, opacidade e escala (grid 0fr → 1fr). */
function Recolhivel({ aberto, children, className, largura }: { aberto: boolean; children: ReactNode; className?: string; largura?: boolean }) {
  return (
    <div aria-hidden={!aberto} {...(aberto ? {} : { inert: "" })}
      className={cn("grid transition-all duration-300 ease-out motion-reduce:transition-none", aberto ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        largura && (aberto ? "grid-cols-[1fr]" : "grid-cols-[0fr]"))}>
      <div className={cn("min-h-0 min-w-0 overflow-hidden transition-transform duration-300 ease-out", aberto ? "scale-100" : "scale-95", className)}>
        {children}
      </div>
    </div>
  );
}

// ── Canvas: zoom e arrastar (como o Organograma) ──────────────────────────
const ESCALA_MIN = 0.25, ESCALA_MAX = 1.8;
const limitar = (s: number) => Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, s));

function Canvas({ busca, children }: { busca: string; children: ReactNode }) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const mundoRef = useRef<HTMLDivElement>(null);
  // A vista fica em ref e vai direto no style: arrastar não re-renderiza a árvore.
  const vista = useRef({ x: 24, y: 24, s: 1 });
  const [escala, setEscala] = useState(1);
  const [arrastando, setArrastando] = useState(false);
  const arraste = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const aplicar = useCallback((suave: boolean) => {
    const m = mundoRef.current;
    if (!m) return;
    m.style.transition = suave ? "transform 280ms cubic-bezier(.2,.8,.2,1)" : "none";
    m.style.transform = `translate(${vista.current.x}px, ${vista.current.y}px) scale(${vista.current.s})`;
    setEscala(vista.current.s);
  }, []);

  const zoom = useCallback((fator: number, suave: boolean, px?: number, py?: number) => {
    const c = caixaRef.current;
    if (!c) return;
    const { x, y, s } = vista.current;
    const ns = limitar(s * fator);
    const cx = px ?? c.clientWidth / 2, cy = py ?? c.clientHeight / 2;
    vista.current = { s: ns, x: cx - (cx - x) * (ns / s), y: cy - (cy - y) * (ns / s) };
    aplicar(suave);
  }, [aplicar]);

  /** Cabe na tela; só pela largura na abertura (a árvore é alta e ficaria minúscula). */
  const ajustar = useCallback((soLargura: boolean, suave = true) => {
    const c = caixaRef.current, m = mundoRef.current;
    if (!c || !m) return;
    const w = m.offsetWidth, h = m.offsetHeight;
    const s = limitar(Math.min(1, (c.clientWidth - 48) / w, soLargura ? Infinity : (c.clientHeight - 48) / h));
    vista.current = { s, x: Math.max(24, (c.clientWidth - w * s) / 2), y: 24 };
    aplicar(suave);
  }, [aplicar]);

  useLayoutEffect(() => { ajustar(true, false); }, [ajustar]);

  // Roda do mouse = zoom no ponto do cursor (listener não passivo para segurar a rolagem da página).
  useEffect(() => {
    const c = caixaRef.current;
    if (!c) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = c.getBoundingClientRect();
      zoom(Math.exp(-ev.deltaY * 0.0015), false, ev.clientX - r.left, ev.clientY - r.top);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [zoom]);

  // Busca: leva a vista até o primeiro achado.
  useEffect(() => {
    if (busca.trim().length < 2) return;
    const t = window.setTimeout(() => {
      const c = caixaRef.current, alvo = mundoRef.current?.querySelector<HTMLElement>("[data-achado]");
      if (!c || !alvo) return;
      const rc = c.getBoundingClientRect(), ra = alvo.getBoundingClientRect();
      vista.current = { ...vista.current, x: vista.current.x + rc.width / 2 - (ra.left - rc.left + ra.width / 2), y: vista.current.y + rc.height / 3 - (ra.top - rc.top + ra.height / 2) };
      aplicar(true);
    }, 350);
    return () => window.clearTimeout(t);
  }, [busca, aplicar]);

  return (
    <div ref={caixaRef}
      onPointerDown={(ev) => {
        if (ev.button !== 0 || (ev.target as HTMLElement).closest("button,a,input,[role=button]")) return;
        arraste.current = { px: ev.clientX, py: ev.clientY, x: vista.current.x, y: vista.current.y };
        ev.currentTarget.setPointerCapture(ev.pointerId);
        setArrastando(true);
      }}
      onPointerMove={(ev) => {
        const a = arraste.current;
        if (!a) return;
        vista.current = { ...vista.current, x: a.x + ev.clientX - a.px, y: a.y + ev.clientY - a.py };
        aplicar(false);
      }}
      onPointerUp={() => { arraste.current = null; setArrastando(false); }}
      onPointerCancel={() => { arraste.current = null; setArrastando(false); }}
      className={cn("ep-canvas relative h-[calc(100vh-200px)] min-h-[520px] touch-none select-none overflow-hidden rounded-2xl border",
        "bg-muted/20 bg-[radial-gradient(circle,_hsl(var(--border))_1px,_transparent_1px)] [background-size:20px_20px]",
        arrastando ? "cursor-grabbing" : "cursor-grab")}>
      <div ref={mundoRef} className="ep-mundo absolute left-0 top-0 w-max origin-top-left will-change-transform">
        {children}
      </div>

      <div className="ep-controles absolute right-3 top-3 z-10 flex items-center gap-0.5 rounded-xl border bg-background/95 p-1 shadow-sm backdrop-blur">
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Diminuir" onClick={() => zoom(1 / 1.2, true)}><Minus className="h-4 w-4" /></Button>
        <button type="button" className="w-12 text-center text-xs font-semibold tabular-nums hover:text-primary" title="Tamanho real" onClick={() => zoom(1 / vista.current.s, true)}>
          {Math.round(escala * 100)}%
        </button>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Aumentar" onClick={() => zoom(1.2, true)}><Plus className="h-4 w-4" /></Button>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Caber na tela" onClick={() => ajustar(false)}><Maximize className="h-4 w-4" /></Button>
      </div>
      <div className="ep-controles pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-background/80 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur">
        <Hand className="h-3.5 w-3.5" /> Arraste para mover · roda do mouse para zoom · clique num nó para expandir
      </div>
    </div>
  );
}

// ── O organograma ─────────────────────────────────────────────────────────
function Organograma({ e, f, abertos, fechados, onAlternar, onSetor, onProcesso }: {
  e: Estrutura; f: FiltroGeral; abertos: Set<string>; fechados: Set<string>; onAlternar: (chave: string) => void;
  onSetor: (id: string) => void; onProcesso: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [foco, setFoco] = useState<string | null>(null);
  // Tudo memorizado: as linhas são medidas a cada mudança destes dados.
  const { presidencia, porDiretoria, visiveis, semDiretoria, procsPres, macros } = useMemo(() => {
    const presidencia = e.unidades.find((u) => u.tipo === "presidencia") ?? null;
    const diretorias = e.unidades.filter((u) => u.tipo === "diretoria").sort((a, b) => a.ordem - b.ordem);
    let visiveis = setoresFiltrados(e, f);
    if (f.unidade) visiveis = visiveis.filter((s) => processosDoSetor(e, s.id).some((p) => p.macro_id === f.unidade));
    const porDiretoria = diretorias.map((d) => ({ d, setores: visiveis.filter((s) => s.unidade_id === d.id) })).filter((x) => x.setores.length);
    const semDiretoria = visiveis.filter((s) => !diretorias.some((d) => d.id === s.unidade_id));
    const procsPres = presidencia ? e.processos.filter((p) => p.unidade_id === presidencia.id && !p.setor_id).sort((a, b) => a.ordem - b.ordem) : [];
    const macros = [...(f.unidade ? e.macros.filter((m) => m.id === f.unidade) : e.macros)].sort((a, b) => a.ordem - b.ordem);
    return { presidencia, porDiretoria, visiveis, semDiretoria, procsPres, macros };
  }, [e, f]);

  const presAberta = !!presidencia && !fechados.has(`u-${presidencia.id}`);
  // Setores na tela (os de diretoria recolhida não ganham linha).
  const setoresNaTela = useMemo(() => [
    ...porDiretoria.filter(({ d }) => !fechados.has(`u-${d.id}`)).flatMap((x) => x.setores), ...semDiretoria,
  ], [porDiretoria, semDiretoria, fechados]);

  const ligacoes = useMemo<Ligacao[]>(() => {
    const out: Ligacao[] = [];
    if (presidencia) porDiretoria.forEach(({ d }) => out.push({ de: `u-${presidencia.id}`, para: `u-${d.id}`, cor: COR_LINHA, largura: 1.6, dobra: 0.5 }));
    porDiretoria.forEach(({ d, setores }) => {
      if (fechados.has(`u-${d.id}`)) return;
      setores.forEach((s) => out.push({ de: `u-${d.id}`, para: `s-${s.id}`, cor: COR_LINHA, largura: 1.6, dobra: 0.5, seta: true }));
    });
    // Setor → macroprocesso: na COR DO MACROPROCESSO, dobrando na faixa dele.
    // Saídas espalhadas na base do setor, na ordem dos macroprocessos
    // (esquerda → direita); chegadas todas no meio do topo do macroprocesso.
    setoresNaTela.forEach((s) => {
      const meus = new Set(processosDoSetor(e, s.id).map((p) => p.macro_id).filter(Boolean) as string[]);
      const alvos = macros.map((m, i) => ({ m, i })).filter(({ m }) => meus.has(m.id));
      alvos.forEach(({ m, i }, k) => out.push({
        de: `s-${s.id}`, para: `m-${m.id}`, cor: cor(m.cor).hex, dash: "6 4", largura: 1.6, seta: true,
        dx1: (k - (alvos.length - 1) / 2) * 14, faixa: "faixas", faixaPos: (i + 1) / (macros.length + 1),
      }));
    });
    if (presAberta && presidencia && procsPres.length) {
      out.push({ de: `u-${presidencia.id}`, para: `p-${procsPres[0].id}`, cor: COR_LINHA, sentido: "lado", seta: true, largura: 1.4 });
      procsPres.slice(0, -1).forEach((p, i) => out.push({ de: `p-${p.id}`, para: `p-${procsPres[i + 1].id}`, cor: COR_LINHA, sentido: "lado", seta: true, largura: 1.4 }));
    }
    for (let i = 0; i < macros.length - 1; i++) out.push({ de: `m-${macros[i].id}`, para: `m-${macros[i + 1].id}`, cor: "#334155", sentido: "lado", seta: true, largura: 1.8 });
    return out;
  }, [e, presidencia, presAberta, porDiretoria, fechados, setoresNaTela, macros, procsPres]);

  const { caminhos, tamanho, medir } = useConectores(ref, ligacoes, [visiveis.length]);
  // Re-mede a cada quadro enquanto a animação de abrir/fechar corre.
  useEffect(() => {
    const fim = performance.now() + 420;
    let id = 0;
    const passo = () => { medir(); if (performance.now() < fim) id = requestAnimationFrame(passo); };
    id = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(id);
  }, [abertos, fechados, medir]);

  const ligado = (chave: string) => !!foco && (chave.startsWith(`${foco}>`) || chave.includes(`>${foco}>`));
  const focar = (chave: string | null) => () => setFoco(chave);

  return (
    <div ref={ref} className="relative px-16 pb-16 pt-12">
      <svg className="pointer-events-none absolute left-0 top-0" width={tamanho.w} height={tamanho.h}>
        <DefsSetas prefixo={PREFIXO} />
        {caminhos.map((c) => (
          <path key={c.chave} d={c.d} fill="none" stroke={c.cor} strokeWidth={ligado(c.chave) ? c.largura + 1 : c.largura} strokeDasharray={c.dash}
            markerEnd={c.seta ? seta(PREFIXO, c.cor) : undefined} strokeLinejoin="round"
            style={{ transition: "opacity 200ms, stroke-width 200ms", opacity: foco ? (ligado(c.chave) ? 1 : 0.12) : c.dash ? 0.8 : 1 }} />
        ))}
      </svg>

      {/* Presidência + processos dela */}
      {presidencia && (
        <div className="relative flex items-start justify-center gap-10">
          <div className="flex-1" />
          <NoUnidade u={presidencia} presidencia aberta={presAberta} total={procsPres.length} rotuloTotal="processos" busca={f.busca}
            onClick={() => onAlternar(`u-${presidencia.id}`)} />
          <div className="flex flex-1 justify-start">
            {procsPres.length > 0 && (
              <Recolhivel aberto={presAberta} className="origin-left p-1">
                <div className="rounded-2xl border bg-card p-3 shadow-sm">
                  <div className="mb-2.5 text-xs font-semibold text-muted-foreground">Processos da Presidência</div>
                  <div className="flex items-start gap-8">
                    {procsPres.map((p) => (
                      <div key={p.id} data-no={`p-${p.id}`} className="w-[150px]">
                        <ItemProcesso p={p} busca={f.busca} aberto={abertos.has(`p-${p.id}`)} onAlternar={() => onAlternar(`p-${p.id}`)} onAbrir={() => onProcesso(p.id)} />
                      </div>
                    ))}
                  </div>
                </div>
              </Recolhivel>
            )}
          </div>
        </div>
      )}

      {/* Diretorias, cada uma com os seus setores embaixo */}
      <div className="mt-16 flex items-start justify-center gap-24">
        {porDiretoria.map(({ d, setores }) => {
          const aberta = !fechados.has(`u-${d.id}`);
          return (
            <div key={d.id} className="flex flex-col items-center">
              <NoUnidade u={d} aberta={aberta} total={setores.length} rotuloTotal="setores" busca={f.busca} onClick={() => onAlternar(`u-${d.id}`)} />
              <Recolhivel aberto={aberta} largura className="origin-top">
                <div className="flex w-max items-start gap-7 px-2 pb-3 pt-16">
                  {setores.map((s) => (
                    <ColunaSetor key={s.id} e={e} s={s} abertos={abertos} busca={f.busca} onAlternar={onAlternar} onSetor={onSetor} onProcesso={onProcesso}
                      onFoco={focar} />
                  ))}
                </div>
              </Recolhivel>
            </div>
          );
        })}
        {semDiretoria.length > 0 && (
          <div className="flex flex-col items-center">
            <div className="rounded-xl border border-dashed px-4 py-2 text-xs font-semibold uppercase text-muted-foreground">Sem diretoria</div>
            <div className="flex items-start gap-7 px-2 pb-3 pt-16">
              {semDiretoria.map((s) => (
                <ColunaSetor key={s.id} e={e} s={s} abertos={abertos} busca={f.busca} onAlternar={onAlternar} onSetor={onSetor} onProcesso={onProcesso} onFoco={focar} />
              ))}
            </div>
          </div>
        )}
        {visiveis.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Nenhum setor com esses filtros.</p>}
      </div>

      {/* Faixas por onde correm as linhas setor → macroprocesso (uma altura por macroprocesso) */}
      {macros.length > 0 && <div data-no="faixas" style={{ height: 48 + macros.length * 30 }} />}

      {/* Macroprocessos */}
      {macros.length > 0 && (
        <div className="flex items-start justify-around gap-16 px-10">
          {macros.map((m) => {
            const c = cor(m.cor);
            const aberto = abertos.has(`m-${m.id}`);
            const participantes = setoresNaTela
              .map((s) => ({ s, n: processosDoSetor(e, s.id).filter((p) => p.macro_id === m.id && p.status !== "inativo").length }))
              .filter((x) => x.n > 0);
            return (
              <div key={m.id} className="w-[230px]" onMouseEnter={focar(`m-${m.id}`)} onMouseLeave={focar(null)}>
                <button type="button" data-no={`m-${m.id}`} onClick={() => onAlternar(`m-${m.id}`)}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-xl border-2 bg-card px-4 py-3 text-left text-sm font-semibold shadow-sm transition hover:shadow-md",
                    c.borda, aberto && c.fundo)}>
                  <span className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.hex }} />{m.nome}</span>
                  <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300", aberto && "rotate-180")} />
                </button>
                <Recolhivel aberto={aberto} className="origin-top">
                  <div className="mt-2 space-y-1 rounded-xl border bg-card p-2.5 shadow-sm">
                    <div className="mb-1 text-[11px] font-semibold text-muted-foreground">{participantes.length} setor(es) participam</div>
                    {participantes.map(({ s, n }) => (
                      <button key={s.id} type="button" onClick={() => onSetor(s.id)}
                        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted">
                        <IconeSetor icone={s.icone} corSetor={s.cor} tamanho="sm" />
                        <span className="min-w-0 flex-1 truncate">{s.nome}</span>
                        <span className="text-[10.5px] text-muted-foreground">{n} proc.</span>
                      </button>
                    ))}
                    {!participantes.length && <p className="text-xs text-muted-foreground">Nenhum setor visível neste macroprocesso.</p>}
                  </div>
                </Recolhivel>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Presidência ou diretoria: clicar abre/fecha o que vem abaixo (ou ao lado). */
function NoUnidade({ u, presidencia, aberta, total, rotuloTotal, busca, onClick }: {
  u: Unidade; presidencia?: boolean; aberta: boolean; total: number; rotuloTotal: string; busca: string; onClick: () => void;
}) {
  const c = cor(u.cor);
  const titulo = presidencia ? (u.responsavel_nome ?? u.nome) : u.nome;
  const linha2 = presidencia ? (u.responsavel_cargo ?? u.nome) : (u.responsavel_nome ?? "Responsável a definir");
  const achou = casaBusca(titulo, busca) || casaBusca(linha2, busca);
  return (
    <button type="button" data-no={`u-${u.id}`} data-achado={achou || undefined} onClick={onClick} title={aberta ? "Recolher" : "Expandir"}
      className={cn("group relative w-[320px] rounded-2xl border-2 p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
        presidencia ? "border-emerald-300 bg-emerald-50/70 dark:bg-emerald-500/10" : cn(c.borda, c.fundo), achou && "ring-4 ring-amber-300")}>
      <div className="flex items-center gap-3">
        <Avatar nome={u.responsavel_nome ?? u.nome} foto={u.avatar_url} tamanho={presidencia ? 50 : 44} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold uppercase">{titulo}</div>
          <div className={cn("truncate text-[11px] font-semibold uppercase", presidencia ? "text-emerald-700" : "text-muted-foreground")}>{linha2}</div>
          {u.subtitulo && <div className="truncate text-xs text-muted-foreground">{u.subtitulo}</div>}
        </div>
      </div>
      <span className="absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 items-center gap-1 rounded-full border bg-background px-2 text-[10px] font-bold text-muted-foreground shadow-sm group-hover:text-foreground">
        <ChevronDown className={cn("h-3 w-3 transition-transform duration-300", aberta && "rotate-180")} /> {total} {rotuloTotal}
      </span>
    </button>
  );
}

function ColunaSetor({ e, s, abertos, busca, onAlternar, onSetor, onProcesso, onFoco }: {
  e: Estrutura; s: Setor; abertos: Set<string>; busca: string; onAlternar: (chave: string) => void;
  onSetor: (id: string) => void; onProcesso: (id: string) => void; onFoco: (chave: string | null) => () => void;
}) {
  const c = cor(s.cor);
  const resp = responsavelDoSetor(e, s.id);
  const equipe = equipeDoSetor(e, s.id);
  const todos = processosDoSetor(e, s.id).filter((p) => p.status !== "inativo");
  const principais = processosPrincipais(e, s.id, 4);
  const extras = todos.filter((p) => p.exibir_organograma && !principais.includes(p));
  // Processo achado na busca que está entre os "extras" abre o setor sozinho.
  const aberto = abertos.has(`s-${s.id}`) || extras.some((p) => casaBusca(p.nome, busca));
  const achouPessoa = !!busca.trim() && equipe.some((m) => casaBusca(m.nome, busca) || casaBusca(m.cargo, busca));
  const achouSetor = casaBusca(s.nome, busca) || achouPessoa;
  return (
    <div data-no={`s-${s.id}`} data-achado={achouSetor || undefined} onMouseEnter={onFoco(`s-${s.id}`)} onMouseLeave={onFoco(null)}
      className={cn("w-[220px] shrink-0 overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md",
        aberto && "shadow-md ring-2 ring-primary/20", achouSetor && "ring-4 ring-amber-300")}>
      <div className="h-1.5" style={{ background: c.hex }} />
      <button type="button" onClick={() => onAlternar(`s-${s.id}`)} title={aberto ? "Recolher" : "Expandir"}
        className={cn("w-full px-3 pb-3 pt-2.5 text-left transition hover:brightness-[.97]", c.fundo)}>
        <div className="flex items-start gap-2">
          <IconeSetor icone={s.icone} corSetor={s.cor} tamanho="sm" />
          <span className="line-clamp-2 min-w-0 flex-1 text-[13.5px] font-bold leading-tight">{s.nome}</span>
          <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300", aberto && "rotate-180")} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Avatar nome={resp?.nome} foto={resp?.avatar_url} tamanho={24} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[11.5px] font-medium">{resp?.nome ?? "—"}</div>
            <div className="flex items-center gap-1 text-[10.5px] text-muted-foreground"><Users className="h-3 w-3" /> {equipe.length} na equipe</div>
          </div>
        </div>
        <div className={cn("mt-2.5 rounded-full py-0.5 text-center text-[11px] font-semibold", c.pill)}>{todos.length} processos</div>
      </button>
      <div className="space-y-1.5 border-t p-2.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Processos principais</div>
        {principais.map((p) => (
          <ItemProcesso key={p.id} p={p} busca={busca} aberto={abertos.has(`p-${p.id}`)} onAlternar={() => onAlternar(`p-${p.id}`)} onAbrir={() => onProcesso(p.id)} />
        ))}
        {!principais.length && <p className="text-[11px] text-muted-foreground">Nenhum processo no organograma.</p>}
        <Recolhivel aberto={aberto}>
          <div className="space-y-1.5 pt-0.5">
            {extras.length > 0 && <div className="pt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">Demais processos</div>}
            {extras.map((p) => (
              <ItemProcesso key={p.id} p={p} busca={busca} aberto={abertos.has(`p-${p.id}`)} onAlternar={() => onAlternar(`p-${p.id}`)} onAbrir={() => onProcesso(p.id)} />
            ))}
            {equipe.length > 0 && (
              <div className="flex -space-x-1.5 pt-1.5">
                {equipe.slice(0, 7).map((m) => <Avatar key={m.id} nome={m.nome} foto={m.avatar_url} tamanho={24} className="ring-2 ring-card" />)}
                {equipe.length > 7 && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-muted px-1 text-[10px] font-semibold ring-2 ring-card">+{equipe.length - 7}</span>}
              </div>
            )}
            <Button variant="outline" size="sm" className="h-7 w-full gap-1.5 text-[11px]" onClick={() => onSetor(s.id)}>
              <Users className="h-3.5 w-3.5" /> Equipe, funções e ligações
            </Button>
          </div>
        </Recolhivel>
        {!aberto && extras.length > 0 && (
          <button type="button" onClick={() => onAlternar(`s-${s.id}`)} className="w-full rounded-md py-0.5 text-center text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
            +{extras.length} processo(s)
          </button>
        )}
      </div>
    </div>
  );
}

/** Um processo: clicar mostra código, status, frequência e descrição; o detalhe completo abre pelo botão. */
function ItemProcesso({ p, busca, aberto, onAlternar, onAbrir }: {
  p: Processo; busca: string; aberto: boolean; onAlternar: () => void; onAbrir: () => void;
}) {
  const achou = casaBusca(p.nome, busca) || casaBusca(p.codigo, busca);
  return (
    <div data-achado={achou || undefined}
      className={cn("rounded-lg border bg-muted/40 transition-colors", aberto && "border-primary/40 bg-primary/5", achou && "ring-2 ring-amber-400")}>
      <button type="button" onClick={onAlternar} title={`${p.codigo} · ${p.nome}`}
        className="flex w-full items-start gap-1 px-2 py-1.5 text-left text-[11.5px] leading-snug hover:text-primary">
        <ChevronRight className={cn("mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-300", aberto && "rotate-90")} />
        <span className="line-clamp-2">{p.nome}</span>
      </button>
      <Recolhivel aberto={aberto}>
        <div className="space-y-1.5 px-2 pb-2 text-[10.5px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-1">
            <span className="rounded bg-background px-1.5 py-0.5 font-mono font-semibold text-foreground">{p.codigo}</span>
            <span>{ROTULO_STATUS[p.status]}</span>
            {p.frequencia && <span>· {p.frequencia}</span>}
          </div>
          {p.descricao && <p className="line-clamp-4 leading-snug">{p.descricao}</p>}
          <Button variant="secondary" size="sm" className="h-6 w-full gap-1 text-[10.5px]" onClick={onAbrir}>
            <ExternalLink className="h-3 w-3" /> Abrir processo
          </Button>
        </div>
      </Recolhivel>
    </div>
  );
}

// ── Rodapé: cadeia intersetorial de exemplo, legenda e níveis ─────────────
function Rodape({ e, onProcesso }: { e: Estrutura; onProcesso: (id: string) => void }) {
  const cadeia = useMemo(() => cadeiaIntersetorial(e), [e]);
  const tipos: TipoConexao[] = ["fluxo", "intersetorial", "revisao", "retorno"];
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] print:break-inside-avoid">
      <Card className="p-4">
        <div className="mb-3 text-sm font-semibold">Processos intersetoriais (exemplos)</div>
        {cadeia.length < 2 ? <p className="text-xs text-muted-foreground">Cadastre conexões entre setores para ver o caminho aqui.</p> : (
          <div className="flex flex-wrap items-center gap-2">
            {cadeia.map((p, i) => {
              const s = e.setores.find((x) => x.id === p.setor_id);
              return (
                <div key={p.id} className="flex items-center gap-2">
                  <button onClick={() => onProcesso(p.id)} className="rounded-lg border bg-muted/40 px-3 py-2 text-center text-xs transition hover:border-primary hover:bg-primary/5">
                    <div className="font-medium">{p.nome}</div>
                    <div className="text-[10px] text-muted-foreground">{s?.nome ?? "Presidência"}</div>
                  </button>
                  {i < cadeia.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold">Legenda de Conexões</div>
        <ul className="space-y-1.5 text-xs">
          {tipos.map((t) => (
            <li key={t} className="flex items-center gap-2"><AmostraTraco tipo={t} />
              {t === "fluxo" ? "Fluxo principal de processos" : t === "intersetorial" ? "Conexão entre setores" : t === "revisao" ? "Processo intersetorial" : "Retorno / Validação"}
            </li>
          ))}
          <li className="pt-1 text-[11px] text-muted-foreground">No organograma, cada macroprocesso tem a sua cor de linha.<br />Passe o mouse num setor para ver só as linhas dele.</li>
        </ul>
      </Card>
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold">Níveis da Estrutura</div>
        <ul className="space-y-1.5 text-xs">
          {[["#22c55e", "Presidência"], ["#3b82f6", "Diretorias"], ["#60a5fa", "Setores"], ["#cbd5e1", "Processos"]].map(([c, r]) => (
            <li key={r} className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{r}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/** O caminho mais longo pelas conexões entre setores (até 6 passos) — o "exemplo" do rodapé. */
function cadeiaIntersetorial(e: Estrutura): Processo[] {
  const saidas = new Map<string, string[]>();
  for (const c of e.conexoes) {
    const o = e.processos.find((p) => p.id === c.origem_id), d = e.processos.find((p) => p.id === c.destino_id);
    if (!o || !d || o.setor_id === d.setor_id || c.tipo === "bloqueado") continue;
    saidas.set(o.id, [...(saidas.get(o.id) ?? []), d.id]);
  }
  let melhor: string[] = [];
  const andar = (id: string, cam: string[]) => {
    if (cam.length > melhor.length) melhor = cam;
    if (cam.length >= 6) return;
    for (const n of saidas.get(id) ?? []) if (!cam.includes(n)) andar(n, [...cam, n]);
  };
  for (const id of saidas.keys()) andar(id, [id]);
  return melhor.map((id) => e.processos.find((p) => p.id === id)!).filter(Boolean);
}

function baixar(nome: string, conteudo: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportarCsv(e: Estrutura) {
  const csv = linhasCsv(e).map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  baixar("estrutura-processos.csv", "﻿" + csv, "text/csv;charset=utf-8");
}
function exportarJson(e: Estrutura) {
  baixar("estrutura-processos.json", JSON.stringify(e, null, 2), "application/json");
}

// Impressão: o canvas sai do zoom/arraste e imprime inteiro.
const CSS_IMPRESSAO = `
@media print{
  .ep-canvas{height:auto!important;overflow:visible!important;border:0!important;background:none!important}
  .ep-mundo{position:static!important;transform:none!important;transition:none!important}
  .ep-controles{display:none!important}
}
`;
