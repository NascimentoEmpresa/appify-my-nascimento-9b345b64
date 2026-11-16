// =====================================================================
// PRESIDÊNCIA › ACOMPANHAMENTO DE CHAMADOS (/app/presidencia/acompanhamento-chamados)
// SIS-2026-0923, mig 20261116230000.
//
// Painel gerencial dos chamados de Sistemas para a Presidência e a
// Controladoria: TODOS os chamados (não só os do usuário), a conversa de cada
// um (só leitura), indicadores de rendimento por responsável e os pedidos de
// ação — mudar prioridade, ordem da fila, cancelar, reprovar a entrega para
// revisão ou pedir informações. A gestão PEDE e Sistemas DECIDE: nada muda no
// chamado sem a análise do Gestor de Sistemas (ver a migration).
//
// Liberação (Acesso por Usuário, módulo Presidência):
//   presidencia_chamados_gerencial       — "Acompanhamento de Chamados": ver o painel
//   presidencia_chamados_gerencial_acao  — "· Pode solicitar ação": pedir ação
// Dados pelas RPCs chamado_gerencial_* (SECURITY DEFINER + has_screen_access):
// quem vê o painel não precisa de acesso às telas de gestão de chamados.
// Regras de aba/atraso/rendimento: src/lib/chamados/painelGerencial.ts.
// =====================================================================
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronLeft, ChevronRight, Clock, Hourglass, MessageSquare,
  Search, Send, ShieldAlert, Star, X, XCircle, CheckCircle,
} from "lucide-react";
import { PrioridadeBadge, StatCard, StatusBadge, PRIORIDADES, fmtData, fmtDataHora } from "@/pages/chamados/types";
import { useChamadoPerms } from "@/pages/chamados/useChamadoPerms";
import {
  GRUPOS_GERENCIAL, SEM_RESPONSAVEL, STATUS_ACAO_GESTAO, TIPOS_ACAO_GESTAO,
  agruparOutros, atrasadoGerencial, contarPor, dataReferencia, detalheAcao, filtrarChamados, grupoGerencial,
  kpisGerencial, ordenarParaAba, rendimentoPorResponsavel, rotuloDias, rotuloStatusAcao, tamanhoFilas,
  type AcaoGestao, type ChamadoGerencial, type FiltrosGerencial, type GrupoGerencial,
} from "@/lib/chamados/painelGerencial";
import { rpcGerencial, useAcoesGestao, useChamadosGerencial, useInvalidarGerencial } from "@/pages/chamados/acoesGestaoApi";
import { ResponderAcaoGestaoDialog, SolicitarAcaoGestaoDialog, type PedidoParaResponder } from "@/pages/chamados/AcoesGestaoChamado";
import { ConversaGerencialChamado } from "./ConversaGerencialChamado";
import { BarrasHorizontais, RoscaStatus, type FatiaStatus } from "./GraficosGerenciais";

type Aba = GrupoGerencial | "acoes" | "rendimento";
const ABAS_CHAMADOS: GrupoGerencial[] = ["andamento", "validacao", "concluido", "encerrado"];
const POR_PAGINA = 10;
const TODOS = "__todos__";

const CORES_GRUPO: Record<GrupoGerencial, string> = {
  andamento: "hsl(var(--info))",
  validacao: "hsl(var(--warning))",
  concluido: "hsl(var(--success))",
  encerrado: "hsl(var(--muted-foreground))",
};

export default function AcompanhamentoChamados() {
  const { toast } = useToast();
  const { user } = useAuth();
  const invalidar = useInvalidarGerencial();
  const { data: access, isLoading: carregandoAcesso } = useAccessibleMenus("visualizar");
  const podePedir = !!access?.codes.has("presidencia_chamados_gerencial_acao");
  const podeVer = !!access && (access.codes.has("presidencia_chamados_gerencial") || podePedir);
  // Quem decide (Gestor de Sistemas/Coordenar) e também vê o painel responde daqui.
  const { canGestorSistemas, canCoordenar } = useChamadoPerms();
  const podeDecidir = canGestorSistemas || canCoordenar;

  const [params, setParams] = useSearchParams();
  const abaParam = params.get("aba") as Aba | null;
  const aba: Aba = abaParam && (abaParam in GRUPOS_GERENCIAL || abaParam === "acoes" || abaParam === "rendimento") ? abaParam : "andamento";
  const trocarAba = (v: string) => { setPagina(1); setParams((p) => { p.set("aba", v); return p; }, { replace: true }); };

  const [filtros, setFiltros] = useState<FiltrosGerencial>({});
  const [pagina, setPagina] = useState(1);
  const [conversa, setConversa] = useState<ChamadoGerencial | null>(null);
  const [pedindo, setPedindo] = useState<ChamadoGerencial | null>(null);
  const [respondendo, setRespondendo] = useState<{ pedido: PedidoParaResponder; aceitar: boolean } | null>(null);

  const { data: chamados = [], isLoading, error } = useChamadosGerencial(podeVer);
  const { data: acoes = [] } = useAcoesGestao(podeVer);

  const filtrados = useMemo(() => filtrarChamados(chamados, filtros), [chamados, filtros]);
  const filas = useMemo(() => tamanhoFilas(chamados), [chamados]);
  // "Agora" fixo da abertura da tela: atrasado não muda a cada render.
  const [agora] = useState(() => new Date());

  const porGrupo = useMemo(() => {
    const m: Record<GrupoGerencial, ChamadoGerencial[]> = { andamento: [], validacao: [], concluido: [], encerrado: [] };
    filtrados.forEach((c) => m[grupoGerencial(c)].push(c));
    return m;
  }, [filtrados]);

  // Pedidos: mesmos filtros (setor, responsável, prioridade, período pela data do pedido, busca).
  const acoesFiltradas = useMemo(() => {
    const q = (filtros.busca ?? "").trim().toLowerCase();
    return acoes.filter((a) =>
      (!filtros.setor || (a.setor ?? "") === filtros.setor)
      && (!filtros.responsavelId || (filtros.responsavelId === SEM_RESPONSAVEL ? !a.responsavel_id : a.responsavel_id === filtros.responsavelId))
      && (!filtros.prioridade || a.prioridade === filtros.prioridade)
      && (!filtros.de || a.created_at.slice(0, 10) >= filtros.de)
      && (!filtros.ate || a.created_at.slice(0, 10) <= filtros.ate)
      && (!q || [a.numero, a.assunto, a.responsavel_nome, a.solicitado_por_nome].some((x) => (x ?? "").toLowerCase().includes(q))));
  }, [acoes, filtros]);
  const pendentes = acoes.filter((a) => a.status === "pendente");

  const kpis = useMemo(() => kpisGerencial(filtrados, pendentes.length, agora), [filtrados, pendentes.length, agora]);
  const rendimento = useMemo(() => rendimentoPorResponsavel(filtrados, agora), [filtrados, agora]);

  const opcoesSetor = useMemo(() => [...new Set(chamados.map((c) => c.setor).filter((s): s is string => !!s))]
    .sort((a, b) => a.localeCompare(b, "pt-BR")), [chamados]);
  const opcoesResp = useMemo(() => {
    const m = new Map<string, string>();
    chamados.forEach((c) => { if (c.responsavel_id) m.set(c.responsavel_id, c.responsavel_nome ?? "—"); });
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  }, [chamados]);

  const setFiltro = (k: keyof FiltrosGerencial, v: string) => {
    setPagina(1);
    setFiltros((f) => ({ ...f, [k]: v === TODOS ? undefined : v || undefined }));
  };
  const temFiltro = Object.values(filtros).some(Boolean);

  const retirar = async (a: AcaoGestao) => {
    const { error: e } = await rpcGerencial("chamado_gestao_acao_cancelar", { p_acao_id: a.id });
    if (e) { toast({ title: "Não deu certo", description: e.message, variant: "destructive" }); return; }
    toast({ title: "Pedido retirado" });
    invalidar();
  };

  if (carregandoAcesso) return <p className="p-6 text-sm text-muted-foreground">Carregando…</p>;
  if (!podeVer) {
    return (
      <div>
        <PageHeader title="Acompanhamento de Chamados" module="Presidência" breadcrumb={["Presidência", "Acompanhamento de Chamados"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito. Peça a liberação de <b>Acompanhamento de Chamados</b> (módulo Presidência) em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  const listaAba = ABAS_CHAMADOS.includes(aba as GrupoGerencial) ? ordenarParaAba(porGrupo[aba as GrupoGerencial], aba as GrupoGerencial) : [];
  const totalAba = aba === "acoes" ? acoesFiltradas.length : listaAba.length;
  const paginas = Math.max(1, Math.ceil(totalAba / POR_PAGINA));
  const pag = Math.min(pagina, paginas);
  const fatia = <T,>(l: T[]) => l.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);

  const fatiasStatus: FatiaStatus[] = ABAS_CHAMADOS.map((g) => ({
    chave: g, nome: GRUPOS_GERENCIAL[g].label, valor: porGrupo[g].length, cor: CORES_GRUPO[g],
  }));
  const distribuicao = contarPor(porGrupo.andamento, (c) => c.responsavel_nome ?? (c.responsavel_id ? "—" : null), "Sem responsável")
    .map((x) => ({ nome: x.nome, valor: x.total, rotulo: String(x.total) }));

  return (
    <div>
      <PageHeader
        title="Acompanhamento de Chamados"
        subtitle="Acompanhe as demandas de Sistemas e solicite ações: mudar prioridade ou ordem, cancelar, revisar a entrega ou pedir informações."
        module="Presidência"
        breadcrumb={["Presidência", "Acompanhamento de Chamados"]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={Clock} tone="info" label="Em andamento" value={kpis.andamento} />
        <StatCard icon={CheckCircle2} tone="success" label="Concluídos" value={kpis.concluidos} hint="Entregues e validados" />
        <StatCard icon={Hourglass} tone="warning" label="Aguardando validação" value={kpis.validacao} hint="Solicitante ou Presidência" />
        <StatCard icon={ArrowLeftRight} tone="primary" label="Solicitações pendentes" value={kpis.acoesPendentes} hint="Aguardando Sistemas" />
        <StatCard icon={AlertTriangle} tone="destructive" label="Atrasados" value={kpis.atrasados} hint="Previsão do dev vencida" />
      </div>

      {pendentes.length > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-2 border-warning/40 bg-warning/5 px-4 py-2.5 text-sm">
          <span className="flex items-center gap-2"><Clock className="h-4 w-4 text-warning" />
            {pendentes.length === 1 ? "1 solicitação de ação aguardando" : `${pendentes.length} solicitações de ação aguardando`} análise de Sistemas
          </span>
          <Button size="sm" variant="outline" onClick={() => trocarAba("acoes")}>Ver solicitações</Button>
        </Card>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs">Setor solicitante</Label>
            <Select value={filtros.setor ?? TODOS} onValueChange={(v) => setFiltro("setor", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os setores</SelectItem>
                {opcoesSetor.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Responsável</Label>
            <Select value={filtros.responsavelId ?? TODOS} onValueChange={(v) => setFiltro("responsavelId", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os responsáveis</SelectItem>
                {opcoesResp.map(([id, nome]) => <SelectItem key={id} value={id}>{nome}</SelectItem>)}
                <SelectItem value={SEM_RESPONSAVEL}>Sem responsável</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prioridade</Label>
            <Select value={filtros.prioridade ?? TODOS} onValueChange={(v) => setFiltro("prioridade", v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas as prioridades</SelectItem>
                {Object.entries(PRIORIDADES).map(([k, p]) => <SelectItem key={k} value={k}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="fg-de">Período — de</Label>
            <Input id="fg-de" type="date" className="h-9" value={filtros.de ?? ""} onChange={(e) => setFiltro("de", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="fg-ate">Período — até</Label>
            <Input id="fg-ate" type="date" className="h-9" value={filtros.ate ?? ""} onChange={(e) => setFiltro("ate", e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[14rem] flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="h-9 pl-8 text-sm" placeholder="Buscar por nº, assunto, solicitante ou responsável…"
              value={filtros.busca ?? ""} onChange={(e) => setFiltro("busca", e.target.value)} />
          </div>
          {temFiltro && (
            <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setFiltros({}); setPagina(1); }}>
              <X className="h-4 w-4" /> Limpar filtros
            </Button>
          )}
          <p className="w-full text-[11px] text-muted-foreground">
            O período olha a abertura dos chamados em andamento, a conclusão dos entregues e o cancelamento dos cancelados.
          </p>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="min-w-0 p-4">
          <Tabs value={aba} onValueChange={trocarAba}>
            <TabsList className="mb-3 h-auto flex-wrap">
              {ABAS_CHAMADOS.map((g) => (
                <TabsTrigger key={g} value={g} className="gap-1.5 text-xs">
                  {GRUPOS_GERENCIAL[g].label}
                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold">{porGrupo[g].length}</span>
                </TabsTrigger>
              ))}
              <TabsTrigger value="acoes" className="gap-1.5 text-xs">
                Solicitações de ação
                <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold">{acoesFiltradas.length}</span>
              </TabsTrigger>
              <TabsTrigger value="rendimento" className="text-xs">Rendimento</TabsTrigger>
            </TabsList>
          </Tabs>

          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : error ? (
            <p className="py-10 text-center text-sm text-destructive">Não foi possível carregar: {(error as Error).message}</p>
          ) : aba === "rendimento" ? (
            <AbaRendimento lista={filtrados} rendimento={rendimento} />
          ) : aba === "acoes" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chamado</TableHead>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Detalhamento</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Solicitado</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fatia(acoesFiltradas).map((a) => {
                  const pedido: PedidoParaResponder = { ...a };
                  return (
                    <TableRow key={a.id} className="align-top">
                      <TableCell className="text-xs">
                        <b className="font-mono">#{a.numero}</b>
                        <p className="max-w-[14rem] text-muted-foreground [overflow-wrap:anywhere]">{a.assunto}</p>
                        {a.setor && <p className="text-[11px] text-muted-foreground">{a.setor}</p>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">{TIPOS_ACAO_GESTAO[a.tipo]?.curto ?? a.tipo}</Badge>
                      </TableCell>
                      <TableCell className="max-w-[18rem] text-xs">
                        <p className="font-medium">{detalheAcao(a)}</p>
                        <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{a.justificativa}</p>
                        {a.resposta && (
                          <p className="mt-1 rounded border-l-2 border-primary/50 bg-muted/40 px-2 py-1 [overflow-wrap:anywhere]">
                            <b>Sistemas{a.decidido_por_nome ? ` (${a.decidido_por_nome})` : ""}:</b> {a.resposta}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{a.responsavel_nome ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {fmtDataHora(a.created_at)}
                        <p className="text-muted-foreground">{a.solicitado_por_nome ?? "—"}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`text-[10px] font-semibold ${STATUS_ACAO_GESTAO[a.status]?.cls ?? ""}`}>
                          {rotuloStatusAcao(a)}
                        </Badge>
                        {a.decidido_em && a.status !== "pendente" && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">{fmtDataHora(a.decidido_em)}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-col items-end gap-1">
                          {a.status === "pendente" && podeDecidir && (
                            <>
                              <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => setRespondendo({ pedido, aceitar: true })}>
                                <CheckCircle className="h-3.5 w-3.5" /> {a.tipo === "informacoes" ? "Responder" : "Aceitar"}
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-destructive"
                                onClick={() => setRespondendo({ pedido, aceitar: false })}>
                                <XCircle className="h-3.5 w-3.5" /> Recusar
                              </Button>
                            </>
                          )}
                          {a.status === "pendente" && a.solicitado_por === user?.id && (
                            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => retirar(a)}>Retirar</Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs"
                            onClick={() => { const c = chamados.find((x) => x.id === a.chamado_id); if (c) setConversa(c); }}>
                            <MessageSquare className="h-3.5 w-3.5" /> Conversa
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {acoesFiltradas.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">Nenhuma solicitação encontrada.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {aba === "andamento" && <TableHead title="Posição na fila do responsável">Fila</TableHead>}
                  <TableHead>Nº</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>{aba === "andamento" ? "Abertura" : aba === "encerrado" ? "Encerramento" : "Conclusão"}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fatia(listaAba).map((c) => (
                  <TableRow key={c.id} className="align-top">
                    {aba === "andamento" && (
                      <TableCell>
                        {c.posicao_dev ? (
                          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-bold text-primary">
                            {c.posicao_dev}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    )}
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{c.numero}</TableCell>
                    <TableCell><PrioridadeBadge prioridade={c.prioridade} /></TableCell>
                    <TableCell className="max-w-[18rem] text-sm">
                      <button type="button" className="text-left font-medium hover:underline [overflow-wrap:anywhere]" onClick={() => setConversa(c)}>
                        {c.assunto}
                      </button>
                      <p className="text-[11px] text-muted-foreground">{c.solicitante_nome ?? "—"}</p>
                    </TableCell>
                    <TableCell className="text-xs">{c.setor ?? "—"}</TableCell>
                    <TableCell className="text-xs">{c.responsavel_nome ?? <span className="text-muted-foreground">Sem responsável</span>}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtData(dataReferencia(c))}</TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={c.status} />
                        {atrasadoGerencial(c, agora) && (
                          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] text-destructive">
                            Atrasado
                          </Badge>
                        )}
                        {c.etapa_validacao === "validacao_presidencia" && c.status === "concluido" && (
                          <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">Validação da Presidência</Badge>
                        )}
                        {c.avaliacao_nota != null && (
                          <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
                            <Star className="h-3 w-3 fill-warning text-warning" /> {c.avaliacao_nota.toFixed(1).replace(".", ",")}
                          </span>
                        )}
                        {(c.acoes_pendentes ?? 0) > 0 && (
                          <span className="text-[10px] font-semibold text-primary">
                            {c.acoes_pendentes === 1 ? "1 pedido pendente" : `${c.acoes_pendentes} pedidos pendentes`}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        {podePedir && (
                          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => setPedindo(c)}>
                            <Send className="h-3.5 w-3.5" /> Solicitar ação
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setConversa(c)}>
                          <MessageSquare className="h-3.5 w-3.5" /> Conversa
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {listaAba.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">Nenhum chamado encontrado.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}

          {aba !== "rendimento" && totalAba > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Exibindo {(pag - 1) * POR_PAGINA + 1} a {Math.min(pag * POR_PAGINA, totalAba)} de {totalAba}</span>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={pag <= 1} onClick={() => setPagina(pag - 1)} aria-label="Página anterior">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 font-semibold text-foreground">{pag} / {paginas}</span>
                <Button size="icon" variant="outline" className="h-7 w-7" disabled={pag >= paginas} onClick={() => setPagina(pag + 1)} aria-label="Próxima página">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>

        <aside className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Em andamento por responsável</h3>
            <BarrasHorizontais dados={distribuicao} vazio="Nenhum chamado em andamento no filtro." />
          </Card>
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Últimas solicitações de ação</h3>
            {acoes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma solicitação registrada.</p>
            ) : (
              <ul className="space-y-2">
                {acoes.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3).map((a) => (
                  <li key={a.id} className="rounded-md border border-border p-2 text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <span><b className="font-mono">#{a.numero}</b> · {TIPOS_ACAO_GESTAO[a.tipo]?.curto}</span>
                      <Badge variant="outline" className={`text-[10px] ${STATUS_ACAO_GESTAO[a.status]?.cls ?? ""}`}>{rotuloStatusAcao(a)}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-muted-foreground [overflow-wrap:anywhere]">{a.justificativa}</p>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="link" size="sm" className="mt-1 h-auto px-0 text-xs" onClick={() => trocarAba("acoes")}>Ver todas as solicitações</Button>
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Chamados por situação</h3>
            <RoscaStatus fatias={fatiasStatus} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              Atrasados ({kpis.atrasados}) é um indicador à parte: são chamados em andamento com a previsão do desenvolvedor vencida.
            </p>
          </Card>
        </aside>
      </div>

      <ConversaGerencialChamado
        chamado={conversa}
        onClose={() => setConversa(null)}
        podePedir={podePedir}
        onSolicitarAcao={(c) => { setConversa(null); setPedindo(c); }}
      />
      <SolicitarAcaoGestaoDialog
        chamado={pedindo}
        tamanhoFila={pedindo?.responsavel_id ? filas[pedindo.responsavel_id] ?? 1 : 1}
        onClose={() => setPedindo(null)}
      />
      <ResponderAcaoGestaoDialog pedido={respondendo?.pedido ?? null} aceitar={respondendo?.aceitar ?? true}
        onClose={() => setRespondendo(null)} />
    </div>
  );
}

function AbaRendimento({ lista, rendimento }: { lista: ChamadoGerencial[]; rendimento: ReturnType<typeof rendimentoPorResponsavel> }) {
  const concluidos = rendimento.filter((r) => r.concluidos > 0)
    .map((r) => ({ nome: r.nome, valor: r.concluidos, rotulo: String(r.concluidos) }));
  const rapidez = rendimento.filter((r) => r.tempoDevMedianoDias != null)
    .sort((a, b) => a.tempoDevMedianoDias! - b.tempoDevMedianoDias!)
    .map((r) => ({ nome: r.nome, valor: Math.round(r.tempoDevMedianoDias! * 10) / 10, rotulo: rotuloDias(r.tempoDevMedianoDias) }));
  const avaliacao = rendimento.filter((r) => r.avaliacaoMedia != null)
    .sort((a, b) => b.avaliacaoMedia! - a.avaliacaoMedia!)
    .map((r) => ({ nome: r.nome, valor: Math.round(r.avaliacaoMedia! * 100) / 100,
      rotulo: `${r.avaliacaoMedia!.toFixed(1).replace(".", ",")} (${r.avaliacoes})` }));
  const setores = agruparOutros(contarPor(lista, (c) => c.setor), 8)
    .map((x) => ({ nome: x.nome, valor: x.total, rotulo: String(x.total) }));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Responsável</TableHead>
              <TableHead className="text-right">Concluídos</TableHead>
              <TableHead className="text-right" title="Mediana do início do desenvolvimento até a conclusão">Tempo de dev.</TableHead>
              <TableHead className="text-right" title="Mediana da abertura até a conclusão (inclui a espera na fila)">Abertura → conclusão</TableHead>
              <TableHead className="text-right" title="Entre os concluídos que tinham previsão">No prazo</TableHead>
              <TableHead className="text-right">Avaliação</TableHead>
              <TableHead className="text-right">Em andamento</TableHead>
              <TableHead className="text-right">Atrasados</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rendimento.map((r, i) => (
              <TableRow key={r.responsavelId}>
                <TableCell className="text-sm font-medium">{i + 1}. {r.nome}</TableCell>
                <TableCell className="text-right tabular-nums">{r.concluidos}</TableCell>
                <TableCell className="text-right tabular-nums">{rotuloDias(r.tempoDevMedianoDias)}</TableCell>
                <TableCell className="text-right tabular-nums">{rotuloDias(r.tempoTotalMedianoDias)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.pctNoPrazo == null ? "—" : `${r.pctNoPrazo}%`}
                  {r.entreguesNoPrazo + r.entreguesComAtraso > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">({r.entreguesNoPrazo}/{r.entreguesNoPrazo + r.entreguesComAtraso})</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.avaliacaoMedia == null ? "—" : r.avaliacaoMedia.toFixed(1).replace(".", ",")}
                  {r.avaliacoes > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({r.avaliacoes})</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.emAndamento}</TableCell>
                <TableCell className={`text-right tabular-nums ${r.atrasados > 0 ? "font-semibold text-destructive" : ""}`}>{r.atrasados}</TableCell>
              </TableRow>
            ))}
            {rendimento.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">Nenhum chamado com responsável no filtro atual.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Ordem: mais concluídos; no empate, quem entrega mais rápido. "Tempo de dev." conta do início do desenvolvimento à
          conclusão — a espera na fila depende da ordem definida pela coordenação. Avaliação: nota ponderada dos solicitantes (0 a 5).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border p-3">
          <h4 className="mb-2 text-sm font-semibold">Chamados concluídos por responsável</h4>
          <BarrasHorizontais dados={concluidos} />
        </div>
        <div className="rounded-lg border border-border p-3">
          <h4 className="mb-2 text-sm font-semibold">Quem entrega mais rápido</h4>
          <p className="-mt-1 mb-2 text-[11px] text-muted-foreground">Mediana do início do desenvolvimento à conclusão (menor é melhor)</p>
          <BarrasHorizontais dados={rapidez} unidade="dias" />
        </div>
        <div className="rounded-lg border border-border p-3">
          <h4 className="mb-2 text-sm font-semibold">Avaliação média dos solicitantes</h4>
          <p className="-mt-1 mb-2 text-[11px] text-muted-foreground">Escala de 0 a 5 · entre parênteses, quantas avaliações</p>
          <BarrasHorizontais dados={avaliacao} dominioMax={5} />
        </div>
        <div className="rounded-lg border border-border p-3">
          <h4 className="mb-2 text-sm font-semibold">Chamados por setor solicitante</h4>
          <BarrasHorizontais dados={setores} />
        </div>
      </div>
    </div>
  );
}
