import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity, AlertCircle, AlertTriangle, ArrowLeft, ArrowUpDown, BarChart3, Bug, CheckCircle2, ChevronLeft, ChevronRight,
  Clock, Download, ExternalLink, Eye, GraduationCap, History, LineChart, MoreVertical, Pencil, RefreshCw, Search, Settings,
  UserRound, Users,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissoes } from "@/context/PermissoesContext";
import { useChecklistDados, useHistorico } from "@/hooks/useChecklistModulos";
import { cn } from "@/lib/utils";
import {
  FILTROS_VAZIOS, OPCOES_DEV, OPCOES_TREINAMENTO, OPCOES_VALIDACAO, ROTULO_PENDENTE, checklistEm, filtrarModulos,
  fraseMovimentacao, indicadores, inicioDoMes, montarModulos, ordenarModulos, pct, pct1, variacao, variacaoPP,
  modulosSemTreinamento, prontosSemValidacao,
  type ColunaOrdem, type FiltrosChecklist, type LinhaModulo, type TipoMovimentacao,
} from "@/lib/sistemas/checklistModulos";
import { BarraEfetividade, CardIndicador, MARINHO, MENU_CHECKLIST, StatusPill, fmtDataHora, fmtDataHoraAs } from "./ui";
import { ItemDialog, type AlvoItem } from "./ItemDialog";
import { BugsPainel } from "./BugsPainel";
import { UsoPainel } from "./UsoPainel";
import { HistoricoLista } from "./HistoricoLista";
import { DonutStatusModulos } from "./DonutStatusModulos";
import { AnaliseDialog, type Analise } from "./AnaliseDialog";
import { exportarChecklist } from "./exportar";

// =====================================================================
// Sistemas › CONTROLE DE EFETIVIDADE DOS MÓDULOS (Checklist de Módulos)
// 02/10/2026, migs 20260930000291/292
//
// Solicitação: "acompanhar criação, implantação, treinamento, medição de uso
// de cada módulo por cada usuário, cadastro de bugs e encaminhamento inicial
// de chamados". Pedido do Pablo (02/10): o painel IGUAL ao modelo que ele
// mandou — filtros em cima, cinco indicadores com "vs. mês anterior", a
// lista de módulos em tabela (uma linha por MÓDULO, com Área, status,
// responsável, efetividade) e, embaixo, status geral + últimas
// movimentações + análises. Clicou no módulo, abre a PÁGINA do módulo
// (ModuloDetalhe.tsx, /app/sistemas/checklist-modulos/:moduloId) com tudo
// dele e das telas (submódulos).
//
// Uso do ERP, Bugs e Histórico geral continuam aqui, nos botões do topo
// (?aba=uso|bugs|historico) — o modelo não tinha, mas já estavam em uso.
// Regras e contas: src/lib/sistemas/checklistModulos.ts (com teste).
// =====================================================================

const TODOS = "__todos";
const POR_PAGINA = 12;

export default function ChecklistModulos() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = useChecklistDados();
  // Histórico completo: dá o "vs. mês anterior" e o histórico de validações
  // (a RPC do painel só traz as 40 últimas movimentações).
  const histCompleto = useHistorico(null, 5000);
  const { can } = usePermissoes();
  const podeAlterar = can("alterar", undefined, MENU_CHECKLIST);
  const podeIncluir = can("incluir", undefined, MENU_CHECKLIST) || podeAlterar;
  const podeExcluir = can("excluir", undefined, MENU_CHECKLIST);
  const podeExportar = can("exportar", undefined, MENU_CHECKLIST);

  const aba = params.get("aba") ?? "painel";
  const irAba = (a: string) => setParams((p) => { const n = new URLSearchParams(p); if (a === "painel") n.delete("aba"); else n.set("aba", a); return n; });

  const [f, setF] = useState<FiltrosChecklist>(FILTROS_VAZIOS);
  const [buscaDigitada, setBuscaDigitada] = useState("");
  const [ordem, setOrdem] = useState<{ col: ColunaOrdem; asc: boolean }>({ col: "ordem", asc: true });
  const [pagina, setPagina] = useState(1);
  const [editando, setEditando] = useState<AlvoItem | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);

  const dados = q.data;
  const modulos = useMemo(() => (dados ? montarModulos(dados) : []), [dados]);
  const filtrados = useMemo(() => ordenarModulos(filtrarModulos(modulos, f), ordem.col, ordem.asc), [modulos, f, ordem]);
  const ind = useMemo(() => indicadores(modulos), [modulos]);
  const indAnterior = useMemo(() => {
    if (!dados || !histCompleto.data) return null;
    return indicadores(montarModulos({ ...dados, checklist: checklistEm(dados.checklist, histCompleto.data, inicioDoMes()) }));
  }, [dados, histCompleto.data]);
  const nomeUsuario = useMemo(() => new Map((dados?.usuarios ?? []).map((u) => [u.id, u.nome])), [dados?.usuarios]);
  const areas = useMemo(() => [...new Set(modulos.filter((m) => m.modulo.ativo).map((m) => m.area))].sort((a, b) => a.localeCompare(b)), [modulos]);
  const responsaveis = useMemo(() => {
    const ids = new Set(modulos.map((m) => m.responsavelId).filter((x): x is string => !!x));
    return [...ids].map((id) => ({ id, nome: nomeUsuario.get(id) ?? "—" })).sort((a, b) => a.nome.localeCompare(b.nome));
  }, [modulos, nomeUsuario]);
  const bugsAbertos = useMemo(() => modulos.reduce((s, m) => s + m.bugsAbertos, 0), [modulos]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA);

  const mudar = (p: Partial<FiltrosChecklist>) => { setF((x) => ({ ...x, ...p })); setPagina(1); };
  const pesquisar = () => mudar({ busca: buscaDigitada });
  const limpar = () => { setF(FILTROS_VAZIOS); setBuscaDigitada(""); setPagina(1); };
  const ordenarPor = (col: ColunaOrdem) => setOrdem((o) => (o.col === col ? { col, asc: !o.asc } : { col, asc: true }));
  const abrir = (m: LinhaModulo) => navigate(`/app/sistemas/checklist-modulos/${m.modulo.id}`);
  const editarModulo = (m: LinhaModulo) => setEditando({
    moduloId: m.modulo.id, moduloNome: m.modulo.nome, moduloCodigo: m.modulo.codigo, menuId: null, item: m.item,
    calculado: {
      status_dev: m.calculado.dev ? m.status.status_dev : null, status_implantacao: m.calculado.implantacao ? m.status.status_implantacao : null,
      status_treinamento: m.calculado.treinamento ? m.status.status_treinamento : null, status_validacao: m.calculado.validacao ? m.status.status_validacao : null,
    },
  });

  const voltar = (
    <Button variant="ghost" size="sm" className="mb-3 gap-1.5 px-2" onClick={() => irAba("painel")}><ArrowLeft className="h-4 w-4" /> Voltar ao painel</Button>
  );

  return (
    <div>
      <PageHeader
        title="Controle de Efetividade dos Módulos"
        subtitle="Acompanhe os módulos do ERP quanto ao status de desenvolvimento, treinamento e validação pelos usuários."
        module="Sistemas"
        breadcrumb={["Controle de Efetividade dos Módulos"]}
        actions={
          <>
            <Button variant={aba === "uso" ? "secondary" : "ghost"} size="sm" className="gap-1.5" onClick={() => irAba(aba === "uso" ? "painel" : "uso")}><Activity className="h-4 w-4" /> Uso do ERP</Button>
            <Button variant={aba === "bugs" ? "secondary" : "ghost"} size="sm" className="gap-1.5" onClick={() => irAba(aba === "bugs" ? "painel" : "bugs")}>
              <Bug className="h-4 w-4" /> Bugs{bugsAbertos ? <span className="rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{bugsAbertos}</span> : null}
            </Button>
            <Button variant={aba === "historico" ? "secondary" : "ghost"} size="sm" className="gap-1.5" onClick={() => irAba(aba === "historico" ? "painel" : "historico")}><History className="h-4 w-4" /> Histórico</Button>
            <Button variant="ghost" size="icon" className="h-9 w-9" title="Atualizar" onClick={() => { q.refetch(); histCompleto.refetch(); }} disabled={q.isFetching}>
              <RefreshCw className={cn("h-4 w-4", q.isFetching && "animate-spin")} />
            </Button>
            {podeExportar && (
              <Button variant="outline" className="h-10 gap-2 px-4 font-semibold" onClick={() => dados && exportarChecklist(modulos, nomeUsuario)} disabled={!dados}>
                <Download className="h-4 w-4" /> Exportar Relatório
              </Button>
            )}
          </>
        }
      />

      {q.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 rounded-xl" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
          <Skeleton className="h-[480px] rounded-xl" />
        </div>
      ) : q.isError || !dados ? (
        <Card className="flex items-start gap-3 border-destructive/40 bg-destructive/5 p-5 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div><p className="font-semibold text-destructive">Não foi possível carregar o painel.</p><p className="text-muted-foreground">{(q.error as Error)?.message}</p></div>
        </Card>
      ) : aba === "uso" ? (
        <div>{voltar}<UsoPainel dados={dados} modulos={modulos} podeAlterar={podeAlterar} /></div>
      ) : aba === "bugs" ? (
        <div>{voltar}<BugsPainel dados={dados} podeIncluir={podeIncluir} podeAlterar={podeAlterar} podeExcluir={podeExcluir} /></div>
      ) : aba === "historico" ? (
        <div>{voltar}<HistoricoLista dados={dados} /></div>
      ) : (
        <div className="space-y-4">
          {/* ── Filtros ─────────────────────────────────────────────── */}
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Filtro rotulo="Área">
                <Select value={f.area || TODOS} onValueChange={(v) => mudar({ area: v === TODOS ? "" : v })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value={TODOS}>Todas</SelectItem>
                    {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Filtro>
              <Filtro rotulo="Status do módulo">
                <Select value={f.dev || TODOS} onValueChange={(v) => mudar({ dev: v === TODOS ? "" : (v as FiltrosChecklist["dev"]) })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos</SelectItem>
                    {OPCOES_DEV.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
                    <SelectItem value="pendente">{ROTULO_PENDENTE}</SelectItem>
                  </SelectContent>
                </Select>
              </Filtro>
              <Filtro rotulo="Treinamento">
                <Select value={f.treinamento || TODOS} onValueChange={(v) => mudar({ treinamento: v === TODOS ? "" : (v as FiltrosChecklist["treinamento"]) })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos</SelectItem>
                    {OPCOES_TREINAMENTO.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
                    <SelectItem value="sem">{ROTULO_PENDENTE}</SelectItem>
                  </SelectContent>
                </Select>
              </Filtro>
              <Filtro rotulo="Validação do usuário">
                <Select value={f.validacao || TODOS} onValueChange={(v) => mudar({ validacao: v === TODOS ? "" : (v as FiltrosChecklist["validacao"]) })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TODOS}>Todos</SelectItem>
                    {OPCOES_VALIDACAO.map((o) => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
                    <SelectItem value="sem">{ROTULO_PENDENTE}</SelectItem>
                  </SelectContent>
                </Select>
              </Filtro>
              <Filtro rotulo="Responsável">
                <Select value={f.responsavel || TODOS} onValueChange={(v) => mudar({ responsavel: v === TODOS ? "" : v })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value={TODOS}>Todos</SelectItem>
                    {responsaveis.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Filtro>
              <Filtro rotulo="Buscar módulo" largo>
                <div className="relative">
                  <Input className="h-10 pr-9" placeholder="Digite o nome do módulo..." value={buscaDigitada}
                    onChange={(e) => { setBuscaDigitada(e.target.value); if (!e.target.value) mudar({ busca: "" }); }}
                    onKeyDown={(e) => e.key === "Enter" && pesquisar()} />
                  <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                </div>
              </Filtro>
              <Button variant="outline" className="h-10 px-5 font-semibold" onClick={limpar}>Limpar filtros</Button>
              <Button className="h-10 gap-2 px-6 font-semibold text-white hover:opacity-90" style={{ background: MARINHO }} onClick={pesquisar}>
                <Search className="h-4 w-4" /> Pesquisar
              </Button>
            </div>
          </Card>

          {/* ── Indicadores ─────────────────────────────────────────── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <CardIndicador icone={<CheckCircle2 className="h-8 w-8" strokeWidth={2.2} />} cor="#16a34a" fundo="#dcfce7"
              valor={String(ind.prontos)} rotulo="Módulos prontos" variacao={indAnterior && variacao(ind.prontos, indAnterior.prontos, true)} />
            <CardIndicador icone={<Settings className="h-8 w-8" strokeWidth={2.2} />} cor="#f97316" fundo="#ffedd5"
              valor={String(ind.emDesenvolvimento)} rotulo="Em desenvolvimento" variacao={indAnterior && variacao(ind.emDesenvolvimento, indAnterior.emDesenvolvimento, false)} />
            <CardIndicador icone={<GraduationCap className="h-8 w-8" strokeWidth={2.2} />} cor="#2563eb" fundo="#dbeafe"
              valor={String(ind.treinados)} rotulo="Treinados" variacao={indAnterior && variacao(ind.treinados, indAnterior.treinados, true)} />
            <CardIndicador icone={<Users className="h-8 w-8" strokeWidth={2.2} />} cor="#7c3aed" fundo="#ede9fe"
              valor={String(ind.validados)} rotulo="Validados pelos usuários" variacao={indAnterior && variacao(ind.validados, indAnterior.validados, true)} />
            <CardIndicador icone={<BarChart3 className="h-8 w-8" strokeWidth={2.2} />} cor="#2563eb" fundo="#dbeafe"
              valor={pct1(ind.efetividade ?? 0)} rotulo="% de efetividade" variacao={indAnterior && variacaoPP(ind.efetividade, indAnterior.efetividade)} />
          </div>

          {/* ── Lista de módulos ────────────────────────────────────── */}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 pt-4">
              <p className="text-[15px] font-bold">
                Lista de Módulos do ERP <span className="font-normal text-muted-foreground">({filtrados.length} {filtrados.length === 1 ? "registro" : "registros"})</span>
              </p>
              {ind.preenchidos < ind.modulos && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-amber-700 dark:text-amber-400">{ind.modulos - ind.preenchidos} de {ind.modulos} módulos</span> sem nenhum status preenchido
                  {podeAlterar ? " — clique no módulo para preencher." : "."}
                </p>
              )}
            </div>
            <div className="overflow-x-auto px-4">
              <table className="w-full min-w-[1120px] text-[13px]">
                <thead>
                  <tr className="border-y border-border bg-muted/40 text-left text-xs font-semibold text-foreground">
                    <th className="w-10 px-3 py-2.5">#</th>
                    <th className="px-3 py-2.5">Módulo</th>
                    <th className="px-3 py-2.5">Área</th>
                    <ThOrdenavel rotulo="Status do desenvolvimento" col="dev" ordem={ordem} onClick={ordenarPor} />
                    <th className="px-3 py-2.5">Treinamento realizado</th>
                    <ThOrdenavel rotulo="Validação do usuário" col="validacao" ordem={ordem} onClick={ordenarPor} />
                    <th className="px-3 py-2.5">Responsável</th>
                    <ThOrdenavel rotulo="Última atualização" col="atualizacao" ordem={ordem} onClick={ordenarPor} />
                    <th className="px-3 py-2.5">Efetividade</th>
                    <th className="w-20 px-3 py-2.5 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-12 text-center text-sm text-muted-foreground">Nenhum módulo neste filtro.</td></tr>
                  )}
                  {visiveis.map((m, i) => (
                    <tr key={m.modulo.id} onClick={() => abrir(m)} className="cursor-pointer border-b border-border transition hover:bg-muted/40">
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{(paginaAtual - 1) * POR_PAGINA + i + 1}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{m.modulo.nome}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {m.ativas} {m.ativas === 1 ? "submódulo" : "submódulos"}
                          {m.bugsAbertos > 0 && <span className="ml-1.5 font-semibold text-red-600">· {m.bugsAbertos} bug{m.bugsAbertos === 1 ? "" : "s"}</span>}
                        </p>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{m.area}</td>
                      <td className="px-3 py-2"><StatusPill etapa="dev" valor={m.status.status_dev} calculado={m.calculado.dev} /></td>
                      <td className="px-3 py-2"><StatusPill etapa="treinamento" valor={m.status.status_treinamento} calculado={m.calculado.treinamento} /></td>
                      <td className="px-3 py-2"><StatusPill etapa="validacao" valor={m.status.status_validacao} calculado={m.calculado.validacao} /></td>
                      <td className="px-3 py-2">{m.responsavelId ? nomeUsuario.get(m.responsavelId) ?? "—" : <span className="text-muted-foreground">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{m.ultimaAtualizacao ? fmtDataHora(m.ultimaAtualizacao) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2"><BarraEfetividade valor={m.efetividade} largura="w-28" /></td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" title="Ver detalhes do módulo" onClick={() => abrir(m)} className="rounded-md p-1.5 text-foreground/80 hover:bg-muted hover:text-foreground">
                            <Eye className="h-4 w-4" />
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" title="Mais ações" className="rounded-md p-1.5 text-foreground/80 hover:bg-muted hover:text-foreground"><MoreVertical className="h-4 w-4" /></button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuItem onClick={() => abrir(m)}><Eye className="mr-2 h-4 w-4" /> Ver detalhes e submódulos</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => window.open(`/app/sistemas/checklist-modulos/${m.modulo.id}`, "_blank")}><ExternalLink className="mr-2 h-4 w-4" /> Abrir em nova janela</DropdownMenuItem>
                              {podeAlterar && <DropdownMenuItem onClick={() => editarModulo(m)}><Pencil className="mr-2 h-4 w-4" /> Editar status do módulo</DropdownMenuItem>}
                              {podeIncluir && <DropdownMenuSeparator />}
                              {podeIncluir && <DropdownMenuItem onClick={() => navigate(`/app/sistemas/checklist-modulos/${m.modulo.id}?aba=bugs&novo=1`)}><Bug className="mr-2 h-4 w-4" /> Registrar bug</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px] text-muted-foreground">
              <span>
                {filtrados.length ? <>Mostrando {(paginaAtual - 1) * POR_PAGINA + 1} a {Math.min(paginaAtual * POR_PAGINA, filtrados.length)} de {filtrados.length} registros</> : "Nenhum registro"}
              </span>
              <Paginacao pagina={paginaAtual} total={totalPaginas} onIr={setPagina} />
            </div>
          </Card>

          {/* ── Rodapé: status geral · movimentações · análises ────── */}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,1.3fr)]">
            <Card className="p-4">
              <p className="mb-3 text-[15px] font-bold">Status Geral dos Módulos</p>
              <DonutStatusModulos porDev={ind.porDev} total={ind.modulos} />
            </Card>

            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[15px] font-bold">Últimas movimentações</p>
                <button type="button" className="text-xs font-semibold text-blue-600 hover:underline" onClick={() => irAba("historico")}>Ver todas</button>
              </div>
              <UltimasMovimentacoes dados={dados} />
            </Card>

            <Card className="p-4">
              <p className="mb-3 text-[15px] font-bold">Análises adicionais sugeridas</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <CardAnalise icone={<GraduationCap className="h-6 w-6 text-blue-600" />} titulo="Módulos sem treinamento"
                  sub={`${modulosSemTreinamento(modulos).length} módulos pendentes`} onClick={() => setAnalise("sem_treinamento")} />
                <CardAnalise icone={<AlertCircle className="h-6 w-6 text-red-600" />} titulo="Módulos prontos sem validação"
                  sub={`${prontosSemValidacao(modulos).length} módulos`} onClick={() => setAnalise("prontos_sem_validacao")} />
                <CardAnalise icone={<BarChart3 className="h-6 w-6 text-blue-600" />} titulo="Ranking de áreas com mais pendências"
                  sub="Ver por área" onClick={() => setAnalise("ranking_areas")} />
                <CardAnalise icone={<LineChart className="h-6 w-6 text-blue-600" />} titulo="Evolução das entregas"
                  sub="Últimos 6 meses" onClick={() => setAnalise("evolucao")} />
                <CardAnalise icone={<UserRound className="h-6 w-6 text-blue-600" />} titulo="Aderência por usuário-chave"
                  sub="Participação nas validações" onClick={() => setAnalise("aderencia")} />
                <CardAnalise icone={<Clock className="h-6 w-6 text-blue-600" />} titulo="Histórico de validações"
                  sub="Ver registros de auditoria" onClick={() => setAnalise("historico_validacoes")} />
              </div>
            </Card>
          </div>
        </div>
      )}

      {editando && dados && <ItemDialog alvo={editando} usuarios={dados.usuarios} onFechar={() => setEditando(null)} />}
      {analise && dados && (
        <AnaliseDialog tipo={analise} modulos={modulos} dados={dados} historico={histCompleto.data ?? null} nomeUsuario={nomeUsuario}
          onAbrirModulo={(id) => navigate(`/app/sistemas/checklist-modulos/${id}`)} onFechar={() => setAnalise(null)} />
      )}
    </div>
  );
}

function Filtro({ rotulo, largo, children }: { rotulo: string; largo?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("min-w-[130px] flex-1 space-y-1.5", largo && "min-w-[190px] flex-[1.3]")}>
      <Label className="text-[13px] font-medium text-foreground">{rotulo}</Label>
      {children}
    </div>
  );
}

function ThOrdenavel({ rotulo, col, ordem, onClick }: { rotulo: string; col: ColunaOrdem; ordem: { col: ColunaOrdem; asc: boolean }; onClick: (c: ColunaOrdem) => void }) {
  const ativo = ordem.col === col;
  return (
    <th className="px-3 py-2.5">
      <button type="button" onClick={() => onClick(col)} className={cn("inline-flex items-center gap-1 whitespace-nowrap hover:text-primary", ativo && "text-primary")}>
        {rotulo}<ArrowUpDown className="h-3 w-3 opacity-60" />
      </button>
    </th>
  );
}

function Paginacao({ pagina, total, onIr }: { pagina: number; total: number; onIr: (p: number) => void }) {
  // 1 2 3 … N, com a página atual sempre visível.
  const nums: (number | "…")[] = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - pagina) <= 1 || (pagina <= 3 && p <= 3)) nums.push(p);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const base = "flex h-8 min-w-8 items-center justify-center rounded-md border border-border px-2 text-[13px] font-medium transition";
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className={cn(base, "disabled:opacity-40")} disabled={pagina <= 1} onClick={() => onIr(pagina - 1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></button>
      {nums.map((n, i) => n === "…"
        ? <span key={`r${i}`} className="px-1 text-foreground">…</span>
        : <button key={n} type="button" onClick={() => onIr(n)} className={cn(base, n === pagina ? "border-transparent text-white" : "border-transparent text-foreground hover:bg-muted")} style={n === pagina ? { background: MARINHO } : undefined}>{n}</button>)}
      <button type="button" className={cn(base, "disabled:opacity-40")} disabled={pagina >= total} onClick={() => onIr(pagina + 1)} aria-label="Próxima"><ChevronRight className="h-4 w-4" /></button>
    </div>
  );
}

const ICONE_MOV: Record<TipoMovimentacao, { icone: typeof CheckCircle2; cor: string; fundo: string }> = {
  validado: { icone: CheckCircle2, cor: "#ffffff", fundo: "#16a34a" },
  treinamento: { icone: GraduationCap, cor: "#2563eb", fundo: "#dbeafe" },
  atualizado: { icone: Settings, cor: "#f97316", fundo: "#ffedd5" },
  atribuido: { icone: Users, cor: "#7c3aed", fundo: "#ede9fe" },
  outro: { icone: History, cor: "#64748b", fundo: "#f1f5f9" },
};

function UltimasMovimentacoes({ dados }: { dados: NonNullable<ReturnType<typeof useChecklistDados>["data"]> }) {
  const nomeModulo = useMemo(() => new Map(dados.modulos.map((m) => [m.id, m.nome])), [dados.modulos]);
  const nomeTela = useMemo(() => new Map(dados.telas.map((t) => [t.id, t.nome])), [dados.telas]);
  const itens = dados.historico.slice(0, 4);
  if (!itens.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <History className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Nenhuma movimentação ainda — cada status preenchido aparece aqui.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {itens.map((h) => {
        const mod = nomeModulo.get(h.modulo_id ?? "") ?? "—";
        const tela = h.menu_id ? nomeTela.get(h.menu_id) ?? "tela removida" : null;
        const fr = fraseMovimentacao(h, mod, tela);
        const ic = ICONE_MOV[fr.tipo];
        const partes = fr.texto.split(fr.destaque);
        return (
          <li key={h.id} className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: ic.fundo, color: ic.cor }}>
              <ic.icone className="h-5 w-5" strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] leading-snug text-foreground">
                {partes.length > 1 ? <>{partes[0]}<b className="font-semibold">{fr.destaque}</b>{partes.slice(1).join(fr.destaque)}</> : fr.texto}
              </p>
              <p className="text-[11.5px] text-muted-foreground">{fmtDataHoraAs(h.created_at)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CardAnalise({ icone, titulo, sub, onClick }: { icone: React.ReactNode; titulo: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-muted/40">
      <span className="shrink-0">{icone}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-semibold leading-tight text-foreground">{titulo}</span>
        <span className="block text-[11.5px] text-muted-foreground">{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
