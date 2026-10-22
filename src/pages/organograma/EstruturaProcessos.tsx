import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown, ChevronRight, ChevronUp, Download, FileJson, FileSpreadsheet, GitBranch, Loader2, Maximize2, Minimize2, Network, Pencil,
  Printer, Search, Settings2, Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useEstrutura } from "@/hooks/useEstruturaProcessos";
import {
  FILTRO_GERAL_PADRAO, casaBusca, equipeDoSetor, indicadores, linhasCsv, processosDoSetor, processosPrincipais, responsavelDoSetor,
  setoresFiltrados, type Estrutura, type FiltroGeral, type Processo, type Setor, type TipoConexao,
} from "@/lib/organograma/estruturaProcessos";
import { AmostraTraco, Avatar, DefsSetas, IconeSetor, StatusDesenvolvimento, TRACO, cor, seta } from "@/components/organograma-processos/visual";
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
// Clique no setor → equipe do gerente ao jovem, com funções, processos e as
// ligações com outros setores (DetalheSetor). Clique no processo → detalhe.
// Mostra a ÚLTIMA PUBLICAÇÃO; quem edita vê o rascunho em ?previa=1.
// O organograma de pessoas (/app/organograma) continua como está.
// =====================================================================

const PREFIXO = "org-geral-";

export default function EstruturaProcessos() {
  const previa = new URLSearchParams(window.location.search).get("previa") === "1";
  const q = useEstrutura(!previa);
  const podeEditar = useScreenAccess("organograma_processos_cadastro", "visualizar").data === true;
  const [f, setF] = useState<FiltroGeral>(FILTRO_GERAL_PADRAO);
  const [expandido, setExpandido] = useState(false);
  const [setorAberto, setSetorAberto] = useState<string | null>(null);
  const [processoAberto, setProcessoAberto] = useState<string | null>(null);
  const [pessoaAberta, setPessoaAberta] = useState<PessoaAberta | null>(null);
  const e = q.data;

  return (
    <div className="space-y-4 print:space-y-2">
      {/* ── Cabeçalho ── */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <nav className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>ERP</span><ChevronRight className="h-3 w-3" /><span>Organograma</span><ChevronRight className="h-3 w-3" />
            <span className="font-semibold text-foreground">Estrutura Organizacional e Processos</span>
          </nav>
          <h1 className="font-display text-2xl font-bold tracking-tight lg:text-[28px]">Organograma Geral com Estrutura de Setores e Processos</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Visualize a hierarquia da empresa, os setores, seus responsáveis e a conexão entre processos internos e intersetoriais.
          </p>
          {e && (
            <p className="mt-1 text-xs text-muted-foreground">
              {previa ? <span className="font-semibold text-amber-700">Pré-visualização do rascunho (ainda não publicado)</span>
                : e.publicacao ? `Versão ${e.publicacao.versao} publicada em ${new Date(e.publicacao.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}${e.publicacao.por ? ` por ${e.publicacao.por}` : ""}`
                : <span className="text-amber-700">Estrutura ainda não publicada — mostrando o rascunho.</span>}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-3">
          <StatusDesenvolvimento />
          {e && <Indicadores e={e} />}
        </div>
      </div>

      {/* ── Barra ── */}
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="h-9 pl-9" placeholder="Buscar setor, pessoa ou processo..." value={f.busca} onChange={(x) => setF({ ...f, busca: x.target.value })} />
        </div>
        <Seletor valor={f.diretoria} todos="Todas as diretorias" onChange={(v) => setF({ ...f, diretoria: v, setor: "" })}
          opcoes={(e?.unidades ?? []).filter((u) => u.tipo === "diretoria").map((u) => ({ v: u.id, r: u.nome }))} />
        <Seletor valor={f.setor} todos="Todos os setores" onChange={(v) => setF({ ...f, setor: v })}
          opcoes={(e?.setores ?? []).filter((s) => !f.diretoria || s.unidade_id === f.diretoria).map((s) => ({ v: s.id, r: s.nome }))} />
        <Seletor valor={f.unidade} todos="Todos os macroprocessos" onChange={(v) => setF({ ...f, unidade: v })}
          opcoes={(e?.macros ?? []).map((m) => ({ v: m.id, r: m.nome }))} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" /> Imprimir</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={!e}><Download className="mr-1.5 h-4 w-4" /> Exportar <ChevronDown className="ml-1 h-3.5 w-3.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => e && exportarCsv(e)}><FileSpreadsheet className="mr-2 h-4 w-4" /> Processos (CSV / Excel)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => e && exportarJson(e)}><FileJson className="mr-2 h-4 w-4" /> Estrutura completa (JSON)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => setExpandido(true)}><Maximize2 className="mr-1.5 h-4 w-4" /> Expandir tudo</Button>
          <Button variant="outline" size="sm" onClick={() => setExpandido(false)}><Minimize2 className="mr-1.5 h-4 w-4" /> Recolher tudo</Button>
          {podeEditar && (
            <Button size="sm" asChild><Link to="/app/organograma/processos/cadastro"><Pencil className="mr-1.5 h-4 w-4" /> Editar estrutura</Link></Button>
          )}
        </div>
      </div>

      {q.isLoading ? (
        <Card className="flex items-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Montando o organograma…</Card>
      ) : q.error || !e ? (
        <Card className="p-8 text-sm text-red-600">{(q.error as Error)?.message ?? "Não foi possível carregar."}</Card>
      ) : (
        <>
          <Organograma e={e} f={f} expandido={expandido} onSetor={setSetorAberto} onProcesso={setProcessoAberto} />
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
    { icone: Users, valor: i.colaboradores, rotulo: "Colaboradores mapeados", cor: "text-blue-600 bg-blue-50" },
    { icone: Network, valor: i.setores, rotulo: "Setores", cor: "text-indigo-600 bg-indigo-50" },
    { icone: Settings2, valor: i.processos, rotulo: "Processos cadastrados", cor: "text-emerald-600 bg-emerald-50" },
    { icone: GitBranch, valor: i.conexoes, rotulo: "Conexões intersetoriais", cor: "text-sky-600 bg-sky-50" },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {itens.map((x) => (
        <div key={x.rotulo} className="flex min-w-[140px] items-center gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-sm">
          <span className={cn("inline-flex h-10 w-10 items-center justify-center rounded-xl", x.cor)}><x.icone className="h-5 w-5" /></span>
          <div><div className="text-xl font-bold leading-none">{x.valor}</div><div className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{x.rotulo}</div></div>
        </div>
      ))}
    </div>
  );
}

function Seletor({ valor, todos, opcoes, onChange }: { valor: string; todos: string; opcoes: { v: string; r: string }[]; onChange: (v: string) => void }) {
  return (
    <Select value={valor || "_"} onValueChange={(v) => onChange(v === "_" ? "" : v)}>
      <SelectTrigger className="h-9 w-52 text-sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="_">{todos}</SelectItem>
        {opcoes.map((o) => <SelectItem key={o.v} value={o.v}>{o.r}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ── O organograma ─────────────────────────────────────────────────────────
function Organograma({ e, f, expandido, onSetor, onProcesso }: {
  e: Estrutura; f: FiltroGeral; expandido: boolean; onSetor: (id: string) => void; onProcesso: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Tudo memorizado: as linhas são medidas a cada mudança destes dados.
  const { presidencia, diretorias, visiveis, porDiretoria, semDiretoria, procsPres, macros } = useMemo(() => {
    const presidencia = e.unidades.find((u) => u.tipo === "presidencia") ?? null;
    const diretorias = e.unidades.filter((u) => u.tipo === "diretoria").sort((a, b) => a.ordem - b.ordem);
    let visiveis = setoresFiltrados(e, f);
    if (f.unidade) visiveis = visiveis.filter((s) => processosDoSetor(e, s.id).some((p) => p.macro_id === f.unidade));
    const porDiretoria = diretorias.map((d) => ({ d, setores: visiveis.filter((s) => s.unidade_id === d.id) })).filter((x) => x.setores.length);
    const semDiretoria = visiveis.filter((s) => !diretorias.some((d) => d.id === s.unidade_id));
    const procsPres = presidencia ? e.processos.filter((p) => p.unidade_id === presidencia.id && !p.setor_id).sort((a, b) => a.ordem - b.ordem) : [];
    const macros = [...(f.unidade ? e.macros.filter((m) => m.id === f.unidade) : e.macros)].sort((a, b) => a.ordem - b.ordem);
    return { presidencia, diretorias, visiveis, porDiretoria, semDiretoria, procsPres, macros };
  }, [e, f]);

  const ligacoes = useMemo<Ligacao[]>(() => {
    const out: Ligacao[] = [];
    if (presidencia) porDiretoria.forEach(({ d }) => out.push({ de: `u-${presidencia.id}`, para: `u-${d.id}`, cor: "#334155", largura: 1.4, dobra: 0.5 }));
    porDiretoria.forEach(({ d, setores }) => setores.forEach((s) => out.push({ de: `u-${d.id}`, para: `s-${s.id}`, cor: "#334155", largura: 1.4, dobra: 0.5, seta: true })));
    // Setor → macroprocesso (pontilhado na cor do setor), uma linha por par.
    const pares: { s: Setor; m: string }[] = [];
    visiveis.forEach((s) => {
      const meus = new Set(processosDoSetor(e, s.id).map((p) => p.macro_id).filter(Boolean) as string[]);
      macros.forEach((m) => { if (meus.has(m.id)) pares.push({ s, m: m.id }); });
    });
    pares.forEach((par, i) => {
      const doSetor = pares.filter((x) => x.s.id === par.s.id);
      const k = doSetor.indexOf(par);
      out.push({
        de: `s-${par.s.id}`, para: `m-${par.m}`, cor: cor(par.s.cor).hex, dash: "5 4", largura: 1.4, seta: true,
        dx1: (k - (doSetor.length - 1) / 2) * 10, dx2: ((i % 7) - 3) * 8, dobra: 0.25 + (i % 9) * 0.07,
      });
    });
    procsPres.slice(0, -1).forEach((p, i) => out.push({ de: `p-${p.id}`, para: `p-${procsPres[i + 1].id}`, cor: "#334155", sentido: "lado", seta: true, largura: 1.3 }));
    if (presidencia && procsPres.length) out.push({ de: `u-${presidencia.id}`, para: `p-${procsPres[0].id}`, cor: "#334155", sentido: "lado", seta: true, largura: 1.3 });
    for (let i = 0; i < macros.length - 1; i++) out.push({ de: `m-${macros[i].id}`, para: `m-${macros[i + 1].id}`, cor: "#334155", sentido: "lado", seta: true, largura: 1.6 });
    return out;
  }, [e, presidencia, porDiretoria, visiveis, macros, procsPres]);

  const { caminhos, tamanho } = useConectores(ref, ligacoes, [expandido, visiveis.length]);

  return (
    <Card className="overflow-x-auto p-0">
      <div ref={ref} className="relative min-w-[1180px] px-6 pb-8 pt-6">
        <svg className="pointer-events-none absolute left-0 top-0" width={tamanho.w} height={tamanho.h}>
          <DefsSetas prefixo={PREFIXO} />
          {caminhos.map((c) => (
            <path key={c.chave} d={c.d} fill="none" stroke={c.cor} strokeWidth={c.largura} strokeDasharray={c.dash}
              markerEnd={c.seta ? seta(PREFIXO, c.cor) : undefined}
              opacity={c.dash ? 0.85 : 1} />
          ))}
        </svg>

        {/* Presidência + processos dela */}
        {presidencia && (
          <div className="relative flex items-start justify-center gap-6">
            <div className="flex-1" />
            <div data-no={`u-${presidencia.id}`} className="w-[300px] rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <Avatar nome={presidencia.responsavel_nome ?? presidencia.nome} foto={presidencia.avatar_url} tamanho={48} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold uppercase">{presidencia.responsavel_nome ?? presidencia.nome}</div>
                  <div className="truncate text-[11px] font-semibold uppercase text-emerald-700">{presidencia.responsavel_cargo ?? presidencia.nome}</div>
                  <div className="truncate text-xs text-muted-foreground">{presidencia.subtitulo}</div>
                </div>
              </div>
              <div className="mt-1 text-center text-[10px] text-muted-foreground"><ChevronUp className="inline h-3 w-3" /> {diretorias.length}</div>
            </div>
            <div className="flex flex-1 justify-start">
              {procsPres.length > 0 && (
                <div className="rounded-xl border bg-card p-3 shadow-sm">
                  <div className="mb-2 text-xs font-semibold">Processos da Presidência</div>
                  <div className="flex gap-6">
                    {procsPres.map((p) => (
                      <button key={p.id} data-no={`p-${p.id}`} onClick={() => onProcesso(p.id)}
                        className={cn("w-[110px] rounded-md border bg-slate-50 px-2 py-1.5 text-center text-[11px] leading-tight hover:border-primary", casaBusca(p.nome, f.busca) && "ring-2 ring-amber-400")}>
                        {p.nome}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Diretorias */}
        <div className="mt-10 flex justify-around gap-6">
          {porDiretoria.map(({ d }) => {
            const c = cor(d.cor);
            return (
              <div key={d.id} data-no={`u-${d.id}`} className={cn("w-[340px] rounded-xl border-2 p-3 shadow-sm", c.borda, c.fundo)}>
                <div className="flex items-center gap-3">
                  <Avatar nome={d.responsavel_nome ?? d.nome} foto={d.avatar_url} tamanho={42} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold uppercase">{d.nome}</div>
                    <div className="truncate text-[11px] uppercase text-muted-foreground">{d.responsavel_nome ?? "Responsável a definir"}</div>
                    <div className="truncate text-xs text-muted-foreground">{d.subtitulo}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Setores */}
        <div className="mt-10 flex items-start gap-2.5">
          {[...porDiretoria.flatMap((x) => x.setores), ...semDiretoria].map((s) => (
            <ColunaSetor key={s.id} e={e} s={s} expandido={expandido} busca={f.busca} onSetor={onSetor} onProcesso={onProcesso} />
          ))}
          {visiveis.length === 0 && <p className="w-full py-10 text-center text-sm text-muted-foreground">Nenhum setor com esses filtros.</p>}
        </div>

        {/* Macroprocessos */}
        {macros.length > 0 && (
          <div className="mt-24 flex items-center justify-around gap-8">
            {macros.map((m) => {
              const c = cor(m.cor);
              return (
                <div key={m.id} data-no={`m-${m.id}`} className={cn("min-w-[150px] rounded-lg border-2 px-4 py-3 text-center text-sm font-semibold shadow-sm", c.borda, c.fundo)}>
                  {m.nome}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}

function ColunaSetor({ e, s, expandido, busca, onSetor, onProcesso }: {
  e: Estrutura; s: Setor; expandido: boolean; busca: string; onSetor: (id: string) => void; onProcesso: (id: string) => void;
}) {
  const c = cor(s.cor);
  const resp = responsavelDoSetor(e, s.id);
  const equipe = equipeDoSetor(e, s.id);
  const todos = processosDoSetor(e, s.id).filter((p) => p.status !== "inativo");
  const lista: Processo[] = expandido ? todos.filter((p) => p.exibir_organograma) : processosPrincipais(e, s.id, 4);
  const achouPessoa = busca.trim() && equipe.some((m) => casaBusca(m.nome, busca) || casaBusca(m.cargo, busca));
  return (
    <div data-no={`s-${s.id}`} className={cn("flex min-w-[118px] flex-1 flex-col overflow-hidden rounded-xl border-2 bg-card shadow-sm", c.borda, achouPessoa && "ring-2 ring-amber-400")}>
      <button onClick={() => onSetor(s.id)} className={cn("px-2.5 pb-2 pt-2.5 text-left transition hover:brightness-95", c.fundo)} title="Ver equipe, funções e processos">
        <div className="flex items-center gap-1.5">
          <IconeSetor icone={s.icone} corSetor={s.cor} tamanho="sm" />
          <span className="line-clamp-2 text-[13px] font-bold leading-tight">{s.nome}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Avatar nome={resp?.nome} foto={resp?.avatar_url} tamanho={20} />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[10.5px] font-medium">{resp?.nome ?? "—"}</div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Users className="h-2.5 w-2.5" /> {equipe.length}</div>
          </div>
        </div>
        <div className={cn("mt-2 rounded-full py-0.5 text-center text-[10.5px] font-semibold", c.pill)}>{todos.length} processos</div>
      </button>
      <div className="flex-1 space-y-1.5 border-t p-2">
        <div className="text-[10px] font-semibold text-muted-foreground">{expandido ? "Processos" : "Processos principais"}</div>
        {lista.map((p) => (
          <button key={p.id} onClick={() => onProcesso(p.id)} title={`${p.codigo} · ${p.nome}`}
            className={cn("line-clamp-2 block w-full rounded-md border bg-slate-50 px-1.5 py-1 text-left text-[10.5px] leading-tight hover:border-primary",
              casaBusca(p.nome, busca) && "ring-2 ring-amber-400")}>
            {p.nome}
          </button>
        ))}
        {!expandido && todos.length > lista.length && <div className="text-center text-[10px] text-muted-foreground">+{todos.length - lista.length}</div>}
      </div>
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
                  <button onClick={() => onProcesso(p.id)} className="rounded-md border bg-slate-50 px-3 py-2 text-center text-xs hover:border-primary">
                    <div className="font-medium">{p.nome}</div>
                    <div className="text-[10px] text-muted-foreground">{s?.nome ?? "Presidência"}</div>
                  </button>
                  {i < cadeia.length - 1 && <span className="text-slate-500">→</span>}
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
