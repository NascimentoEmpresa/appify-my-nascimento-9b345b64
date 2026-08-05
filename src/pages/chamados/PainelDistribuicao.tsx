import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useChamadoPerms } from "./useChamadoPerms";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ClipboardList, Clock, Users, CheckCircle2, AlertTriangle, ShieldAlert, MoreHorizontal, ChevronLeft, ChevronRight, Eye, UserCog, Trash2, Info } from "lucide-react";
import { FeedAtualizacoes } from "./FeedAtualizacoes";
import { ExcluirChamadoDialog } from "./ExcluirChamadoDialog";
import {
  StatCard, StatusBadge, PrioridadeBadge, STATUS_CHAMADO, PRIORIDADES, CATEGORIAS, labelDe, moduloLabel, iniciais, Estrelas, fmtData, fmtDataHora,
  chamadoAtivo, posicoesFilaGlobal, posicoesFilaDev, CRITERIOS_AVALIACAO, type Chamado,
} from "./types";

const POR_PAGINA = 8;

interface PainelStats { total: number; abertos: number; em_andamento: number; concluidos_mes: number; atrasados: number; }
interface Dev { id: string; display_name: string; em_andamento: number; abertos: number; }

// A fila mostra só quem ainda está na fila (posição 1 pra baixo). Chamados
// concluídos/reprovados não têm posição e aparecem nas próprias abas.
const ABAS = [
  { key: "fila", label: "Fila de chamados" },
  { key: "aberto", label: "Abertos" },
  { key: "em_andamento", label: "Em andamento" },
  { key: "aguardando_retorno", label: "Aguardando retorno" },
  { key: "concluido", label: "Concluídos" },
  { key: "reprovado", label: "Reprovados" },
] as const;

const DONUT = {
  aberto: "hsl(var(--warning))", em_andamento: "hsl(var(--info))",
  aguardando_retorno: "hsl(var(--primary))", concluido: "hsl(var(--success))",
  reprovado: "hsl(var(--destructive))",
};

export default function PainelDistribuicao() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { gestor, canCoordenar, canExcluir } = useChamadoPerms();

  const [aba, setAba] = useState<string>("fila");
  const [busca, setBusca] = useState("");
  const [fCategoria, setFCategoria] = useState("todas");
  const [fPrioridade, setFPrioridade] = useState("todas");
  const [fResponsavel, setFResponsavel] = useState("todos");
  const [fDe, setFDe] = useState("");
  const [fAte, setFAte] = useState("");
  const [pagina, setPagina] = useState(1);
  const [atribChamado, setAtribChamado] = useState<string | null>(null);
  const [atribDev, setAtribDev] = useState<string | null>(null);
  const [excluir, setExcluir] = useState<{ id: string; numero: string } | null>(null);
  const [flashPrioridade, setFlashPrioridade] = useState<string | null>(null);

  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });
  const nomeDe = (id: string | null) => (id ? usuarios.find((u) => u.id === id)?.display_name ?? "—" : "—");

  const { data: stats } = useQuery({
    queryKey: ["chamados-painel-stats"],
    enabled: gestor,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("chamados_painel_stats");
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as PainelStats;
    },
  });

  const { data: devs = [] } = useQuery({
    queryKey: ["chamados-devs"],
    enabled: gestor,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_desenvolvedores_chamados");
      if (error) throw error;
      return (data ?? []) as Dev[];
    },
  });

  // Satisfação por integrante: nota final ponderada + médias por critério
  // (mesma RPC do Painel do Desenvolvedor, que lá só mostra a linha do próprio).
  // A RPC devolve ordenado por nota; a tela reordena por nome — ver abaixo.
  const { data: ranking = [] } = useQuery({
    queryKey: ["chamados-ranking-satisfacao"],
    enabled: gestor,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_ranking_satisfacao");
      return (data ?? []) as Array<{
        responsavel_id: string; avaliacoes: number; media: number;
        qualidade: number; prazo: number; comunicacao: number; clareza: number; facilidade: number; satisfacao: number;
      }>;
    },
  });

  const { data: chamados = [], isLoading } = useQuery({
    queryKey: ["chamados-todos"],
    enabled: gestor,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  // Ordem alfabética por nome. Não é ranking: a posição na tabela não quer
  // dizer nada, então ordenar por nota daria uma hierarquia que não existe.
  const rankingAlfabetico = useMemo(
    () => [...ranking].sort((a, b) => nomeDe(a.responsavel_id).localeCompare(nomeDe(b.responsavel_id), "pt-BR")),
    [ranking, usuarios], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Opções do filtro de responsável: os devs liberados + quem já é responsável
  // por algum chamado (alguém pode ter perdido a capacidade depois de assumir).
  const responsaveis = useMemo(() => {
    const m = new Map<string, string>();
    devs.forEach((d) => m.set(d.id, d.display_name));
    chamados.forEach((c) => { if (c.responsavel_id && !m.has(c.responsavel_id)) m.set(c.responsavel_id, nomeDe(c.responsavel_id)); });
    return [...m].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [devs, chamados, usuarios]);

  // Posição na fila global (ordem de chegada) e posição na fila de cada dev.
  const posicaoFila = useMemo(() => posicoesFilaGlobal(chamados), [chamados]);
  const posicaoDev = useMemo(() => posicoesFilaDev(chamados), [chamados]);

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const deTs = fDe ? new Date(fDe + "T00:00:00").getTime() : null;
    const ateTs = fAte ? new Date(fAte + "T23:59:59").getTime() : null;
    const lista = chamados.filter((c) => {
      if (aba === "fila" ? !chamadoAtivo(c.status) : c.status !== aba) return false;
      if (fCategoria !== "todas" && !c.categorias.includes(fCategoria)) return false;
      if (fPrioridade !== "todas" && c.prioridade !== fPrioridade) return false;
      if (fResponsavel === "sem" ? !!c.responsavel_id : fResponsavel !== "todos" && c.responsavel_id !== fResponsavel) return false;
      const ts = new Date(c.created_at).getTime();
      if (deTs != null && ts < deTs) return false;
      if (ateTs != null && ts > ateTs) return false;
      if (t && ![c.numero, c.assunto, c.solicitante_nome, c.setor].some((v) => String(v ?? "").toLowerCase().includes(t))) return false;
      return true;
    });
    // Quem está na fila vem da posição 1 pra baixo; encerrados, do mais recente.
    return lista.sort((a, b) => {
      const pa = posicaoFila[a.id], pb = posicaoFila[b.id];
      if (pa && pb) return pa - pb;
      if (pa) return -1;
      if (pb) return 1;
      return +new Date(b.created_at) - +new Date(a.created_at);
    });
  }, [chamados, aba, fCategoria, fPrioridade, fResponsavel, fDe, fAte, busca, posicaoFila]);

  // Volta pra página 1 sempre que os filtros mudam.
  useEffect(() => { setPagina(1); }, [aba, fCategoria, fPrioridade, fResponsavel, fDe, fAte, busca]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = useMemo(
    () => filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA),
    [filtrados, paginaAtual],
  );
  const de = filtrados.length === 0 ? 0 : (paginaAtual - 1) * POR_PAGINA + 1;
  const ate = Math.min(paginaAtual * POR_PAGINA, filtrados.length);

  // Fila por prioridade (chamados ativos) para o rodapé.
  const filaPorPrioridade = useMemo(() => {
    const ativos = chamados.filter((c) => c.status !== "concluido" && c.status !== "reprovado");
    return {
      alta: ativos.filter((c) => c.prioridade === "alta"),
      media: ativos.filter((c) => c.prioridade === "media"),
      baixa: ativos.filter((c) => c.prioridade === "baixa"),
      aguardando: chamados.filter((c) => c.status === "aguardando_retorno"),
    };
  }, [chamados]);
  const cargaMax = useMemo(() => Math.max(1, ...devs.map((d) => d.em_andamento + d.abertos)), [devs]);

  // Quem tem acesso ao Painel de Distribuição pode alterar a prioridade.
  const mudarPrioridade = async (id: string, prioridade: string, numero: string) => {
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({ prioridade }).eq("id", id);
    if (error) { toast({ title: "Erro ao alterar prioridade", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: id, tipo: "evento", texto: `Prioridade alterada para ${PRIORIDADES[prioridade]?.label ?? prioridade}`,
    });
    setFlashPrioridade(id); setTimeout(() => setFlashPrioridade(null), 500);
    toast({ title: `Prioridade do #${numero} → ${PRIORIDADES[prioridade]?.label ?? prioridade}` });
    qc.invalidateQueries({ queryKey: ["chamados-todos"] });
  };

  const donutData = useMemo(() => {
    const m: Record<string, number> = {};
    chamados.forEach((c) => { m[c.status] = (m[c.status] ?? 0) + 1; });
    return Object.entries(m).map(([status, value]) => ({ status, value }));
  }, [chamados]);

  // Atribuição rápida: entra no FIM da fila do dev (posição = último lugar).
  const atribuir = async () => {
    if (!atribChamado || !atribDev) return;
    const { error } = await (supabase as any).rpc("chamado_direcionar", {
      p_chamado_id: atribChamado, p_responsavel_id: atribDev, p_posicao: null, p_observacao: null,
    });
    if (error) { toast({ title: "Erro ao atribuir", description: error.message, variant: "destructive" }); return; }
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: atribChamado, evento: "atribuido" } }).catch(() => {});
    supabase.functions.invoke("notificar-chamado-whatsapp", { body: { chamado_id: atribChamado, evento: "atribuido" } }).catch(() => {});
    toast({ title: "Chamado atribuído" });
    setAtribChamado(null); setAtribDev(null);
    qc.invalidateQueries({ queryKey: ["chamados-todos"] });
    qc.invalidateQueries({ queryKey: ["chamados-painel-stats"] });
    qc.invalidateQueries({ queryKey: ["chamados-devs"] });
  };

  if (!gestor) {
    return (
      <div>
        <PageHeader title="Painel de Distribuição de Chamados" module="Sistemas" breadcrumb={["Chamados de Sistemas", "Painel de Distribuição"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Você não tem acesso ao painel de gestão. Peça a liberação de <b>Chamados — Painel de Distribuição</b>, <b>Coordenar</b> ou <b>Aprovar</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Painel de Distribuição de Chamados"
        subtitle="Visualize, organize e distribua as solicitações entre sua equipe."
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", "Painel de Distribuição"]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={ClipboardList} tone="primary" label="Total de chamados" value={stats?.total ?? 0} />
        <StatCard icon={Clock} tone="warning" label="Abertos" value={stats?.abertos ?? 0} />
        <StatCard icon={Users} tone="info" label="Em andamento" value={stats?.em_andamento ?? 0} />
        <StatCard icon={CheckCircle2} tone="success" label="Concluídos (mês)" value={stats?.concluidos_mes ?? 0} />
        <StatCard icon={AlertTriangle} tone="destructive" label="Atrasados" value={stats?.atrasados ?? 0} />
      </div>

      {/* items-start: cada coluna fica com a altura do próprio conteúdo (sem o
          card da esquerda esticar até a altura da coluna da direita). */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-4">
          {/* Abas */}
          <div className="mb-3 flex flex-wrap gap-1 border-b border-border pb-2">
            {ABAS.map((a) => (
              <button key={a.key} onClick={() => setAba(a.key)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${aba === a.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
                {a.label}
              </button>
            ))}
          </div>
          {/* Filtros */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input className="h-8 w-56 text-sm" placeholder="Buscar por ID, assunto ou solicitante…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <Select value={fCategoria} onValueChange={setFCategoria}>
              <SelectTrigger className="h-8 w-44 text-xs"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as categorias</SelectItem>
                {CATEGORIAS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={fPrioridade} onValueChange={setFPrioridade}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue placeholder="Prioridade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="media">Média</SelectItem>
                <SelectItem value="baixa">Baixa</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fResponsavel} onValueChange={setFResponsavel}>
              <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Responsável" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os responsáveis</SelectItem>
                <SelectItem value="sem">Sem responsável</SelectItem>
                {responsaveis.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">Período</span>
              <Input type="date" className="h-8 w-36 text-xs" value={fDe} max={fAte || undefined} onChange={(e) => setFDe(e.target.value)} />
              <span className="text-xs text-muted-foreground">até</span>
              <Input type="date" className="h-8 w-36 text-xs" value={fAte} min={fDe || undefined} onChange={(e) => setFAte(e.target.value)} />
              {(fDe || fAte) && (
                <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => { setFDe(""); setFAte(""); }}>Limpar</Button>
              )}
            </div>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="overflow-x-auto">
              {/* Células compactas: com o padding padrão (p-4) as 10 colunas
                  estouram a largura do card e a tabela ganha scroll lateral. */}
              <Table className="[&_td]:px-2 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-2">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24 text-center" title="Posição na fila geral e, entre parênteses, a posição na fila do responsável">
                      Posição <span className="font-normal text-muted-foreground">(dev)</span>
                    </TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Assunto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Solicitante</TableHead>
                    <TableHead>Abertura</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="w-16 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => nav(`/app/sistemas/chamados/${c.id}/coordenar`)}>
                      <TableCell className="text-center">
                        {posicaoFila[c.id] ? (
                          <span className="inline-flex items-center gap-1">
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                c.prioridade === "alta" ? "bg-destructive/15 text-destructive"
                                : c.prioridade === "media" ? "bg-warning/15 text-warning"
                                : "bg-success/15 text-success"
                              }`}
                              title="Posição na fila geral (ordem de chegada)"
                            >
                              {posicaoFila[c.id]}
                            </span>
                            {posicaoDev[c.id] && (
                              <span
                                className="text-[10px] font-semibold text-muted-foreground"
                                title={`${posicaoDev[c.id]}º na fila de ${nomeDe(c.responsavel_id)}`}
                              >
                                ({posicaoDev[c.id]})
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">#{c.numero}</TableCell>
                      <TableCell className="min-w-[150px] max-w-[240px] text-sm" title={c.assunto}>
                        <span className="line-clamp-2">{c.assunto}</span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.categorias.map((x) => labelDe(CATEGORIAS, x)).join(", ") || "—"}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {c.status !== "concluido" && c.status !== "reprovado" ? (
                          <div className={flashPrioridade === c.id ? "animate-pop" : ""}>
                            <Select value={c.prioridade} onValueChange={(v) => mudarPrioridade(c.id, v, c.numero)}>
                              <SelectTrigger className="h-7 w-[92px] text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="alta">Alta</SelectItem>
                                <SelectItem value="media">Média</SelectItem>
                                <SelectItem value="baixa">Baixa</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ) : (
                          <PrioridadeBadge prioridade={c.prioridade} />
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{c.solicitante_nome || "—"}<div className="text-[10px] text-muted-foreground">{c.setor}</div></TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDataHora(c.created_at)}</TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-xs">{nomeDe(c.responsavel_id)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          {canExcluir && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Excluir chamado"
                              onClick={() => setExcluir({ id: c.id, numero: c.numero })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                              <MoreHorizontal className="h-4 w-4" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => nav(`/app/sistemas/chamados/${c.id}/coordenar`)}>
                                <UserCog className="mr-2 h-4 w-4" /> Coordenar / atribuir
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => nav(`/app/sistemas/chamados/${c.id}`)}>
                                <Eye className="mr-2 h-4 w-4" /> Ver detalhe
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtrados.length === 0 && (
                    <TableRow><TableCell colSpan={10} className="py-6 text-center text-sm text-muted-foreground">Nenhum chamado.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Posição = ordem de chegada na fila geral. Entre parênteses, a posição do chamado na fila do próprio responsável
                (definida ao direcionar o chamado). Concluídos e reprovados saem da fila e ficam nas abas correspondentes.
              </p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Mostrando {de} a {ate} de {filtrados.length} chamados</p>
            {totalPaginas > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 px-2" disabled={paginaAtual <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-xs text-muted-foreground">Página {paginaAtual} de {totalPaginas}</span>
                <Button variant="outline" size="sm" className="h-8 px-2" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </Card>

        {/* Coluna direita */}
        <div className="space-y-4">
          <Card className="p-4">
            <p className="mb-3 text-sm font-bold">Distribuição da equipe</p>
            <div className="space-y-3">
              {devs.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <Avatar className="h-8 w-8"><AvatarFallback className="text-[10px]">{iniciais(d.display_name)}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium">{d.display_name}</p>
                      <p className="shrink-0 text-[10px] text-muted-foreground">{d.em_andamento} · {d.abertos}</p>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.round(((d.em_andamento + d.abertos) / cargaMax) * 100))}%` }} />
                    </div>
                  </div>
                </div>
              ))}
              {devs.length === 0 && <p className="text-xs text-muted-foreground">Nenhum desenvolvedor liberado ainda (código <b>chamados_sistemas_dev</b> ou <b>sistemas_desenvolvedores</b>).</p>}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground">Em andamento · Abertos (barra = carga total relativa)</p>
          </Card>

          {canCoordenar && <Card className="space-y-2 p-4">
            <p className="text-sm font-bold">Atribuição rápida</p>
            <SearchableSelect
              value={atribChamado}
              onChange={(v) => setAtribChamado(v || null)}
              options={chamados.filter((c) => c.status === "aberto").map((c) => ({ value: c.id, label: `#${c.numero} — ${c.assunto}` }))}
              placeholder="Selecione um chamado aberto…"
              searchPlaceholder="Buscar chamado…"
              allowClear clearValue=""
            />
            <SearchableSelect
              value={atribDev}
              onChange={(v) => setAtribDev(v || null)}
              options={devs.map((d) => ({ value: d.id, label: d.display_name }))}
              placeholder="Selecione o responsável…"
              searchPlaceholder="Buscar dev…"
              allowClear clearValue=""
            />
            <Button size="sm" className="w-full" disabled={!atribChamado || !atribDev} onClick={atribuir}>Atribuir chamado</Button>
          </Card>}

          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Gráfico de status</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="status" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2}>
                    {donutData.map((d) => <Cell key={d.status} fill={(DONUT as any)[d.status] ?? "hsl(var(--muted-foreground))"} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1">
              {donutData.map((d) => (
                <div key={d.status} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: (DONUT as any)[d.status] ?? "hsl(var(--muted-foreground))" }} />
                    {STATUS_CHAMADO[d.status]?.label ?? d.status}
                  </span>
                  <span className="font-medium">{d.value}</span>
                </div>
              ))}
            </div>
          </Card>

          <FeedAtualizacoes buildHref={(cid) => `/app/sistemas/chamados/${cid}/coordenar`} />
        </div>
      </div>

      {/* Satisfação por integrante. Não é ranking: sem posição e em ordem
          alfabética — a leitura é "como cada um está", não "quem ganhou". */}
      <Card className="mt-4 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <Users className="h-4 w-4 text-warning" /> Satisfação por integrante
          </p>
          <span className="text-[11px] text-muted-foreground">Nota final ponderada (Qualidade 30% · Prazo 20% · Comunicação 15% · Satisfação 15% · Clareza 10% · Facilidade 10%)</span>
        </div>
        <div className="overflow-x-auto">
          <Table className="[&_td]:px-2 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-2">
            <TableHeader>
              <TableRow>
                <TableHead>Integrante</TableHead>
                <TableHead className="text-center">Avaliações</TableHead>
                {CRITERIOS_AVALIACAO.map((c) => (
                  <TableHead key={c.key} className="text-center">
                    {c.titulo}
                    <span className="block text-[10px] font-normal text-muted-foreground">({(c.peso * 100).toFixed(0)}%)</span>
                  </TableHead>
                ))}
                <TableHead className="text-right">
                  Nota final
                  <span className="block text-[10px] font-normal text-muted-foreground">(100%)</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rankingAlfabetico.map((r) => (
                <TableRow key={r.responsavel_id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{iniciais(nomeDe(r.responsavel_id))}</AvatarFallback></Avatar>
                      <span className="truncate text-xs font-medium">{nomeDe(r.responsavel_id)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-xs text-muted-foreground">{Number(r.avaliacoes)}</TableCell>
                  {CRITERIOS_AVALIACAO.map((c) => (
                    <TableCell key={c.key} className="text-center text-xs">{Number((r as any)[c.key]).toFixed(1).replace(".", ",")}</TableCell>
                  ))}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Estrelas valor={Number(r.media)} size={13} />
                      <span className="text-sm font-bold">{Number(r.media).toFixed(1).replace(".", ",")}</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {rankingAlfabetico.length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">Nenhuma avaliação recebida ainda.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 flex items-center justify-center gap-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> A nota final é calculada com base na média ponderada dos critérios avaliados.
        </p>
      </Card>

      {/* Fila de chamados por prioridade */}
      <Card className="mt-4 p-4">
        <p className="mb-3 text-sm font-bold">Fila de chamados por prioridade</p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {([
            ["Alta prioridade", filaPorPrioridade.alta, "text-destructive"],
            ["Média prioridade", filaPorPrioridade.media, "text-warning"],
            ["Baixa prioridade", filaPorPrioridade.baixa, "text-success"],
            ["Aguardando retorno", filaPorPrioridade.aguardando, "text-primary"],
          ] as const).map(([titulo, lista, cor]) => (
            <div key={titulo}>
              <p className={`mb-2 text-xs font-bold ${cor}`}>{titulo} ({lista.length})</p>
              <div className="space-y-1">
                {lista.slice(0, 4).map((c) => (
                  <button key={c.id} onClick={() => nav(`/app/sistemas/chamados/${c.id}/coordenar`)} className="block w-full truncate rounded border border-border/60 px-2 py-1 text-left text-[11px] hover:border-primary/40">
                    <span className="font-mono font-semibold">#{c.numero}</span> <span className="text-muted-foreground">{c.assunto}</span>
                  </button>
                ))}
                {lista.length === 0 && <p className="text-[11px] text-muted-foreground">—</p>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <ExcluirChamadoDialog
        open={!!excluir}
        onOpenChange={(v) => { if (!v) setExcluir(null); }}
        chamadoId={excluir?.id ?? null}
        numero={excluir?.numero}
        onExcluido={() => {
          setExcluir(null);
          qc.invalidateQueries({ queryKey: ["chamados-todos"] });
          qc.invalidateQueries({ queryKey: ["chamados-painel-stats"] });
          qc.invalidateQueries({ queryKey: ["chamados-devs"] });
          qc.invalidateQueries({ queryKey: ["chamados-feed"] });
        }}
      />
    </div>
  );
}
