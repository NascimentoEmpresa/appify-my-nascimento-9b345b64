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
import { ClipboardList, Clock, Users, CheckCircle2, AlertTriangle, ShieldAlert, MoreHorizontal, ChevronLeft, ChevronRight, Eye, UserCog } from "lucide-react";
import { FeedAtualizacoes } from "./FeedAtualizacoes";
import {
  StatCard, StatusBadge, PrioridadeBadge, STATUS_CHAMADO, CATEGORIAS, labelDe, moduloLabel, iniciais, fmtData, fmtDataHora, type Chamado,
} from "./types";

const POR_PAGINA = 8;

interface PainelStats { total: number; abertos: number; em_andamento: number; concluidos_mes: number; atrasados: number; }
interface Dev { id: string; display_name: string; em_andamento: number; abertos: number; }

const ABAS = [
  { key: "todos", label: "Todos os chamados" },
  { key: "aberto", label: "Abertos" },
  { key: "em_andamento", label: "Em andamento" },
  { key: "aguardando_retorno", label: "Aguardando retorno" },
  { key: "concluido", label: "Concluídos" },
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
  const { gestor, canCoordenar } = useChamadoPerms();

  const [aba, setAba] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [fCategoria, setFCategoria] = useState("todas");
  const [fPrioridade, setFPrioridade] = useState("todas");
  const [fDe, setFDe] = useState("");
  const [fAte, setFAte] = useState("");
  const [pagina, setPagina] = useState(1);
  const [atribChamado, setAtribChamado] = useState<string | null>(null);
  const [atribDev, setAtribDev] = useState<string | null>(null);

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

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const deTs = fDe ? new Date(fDe + "T00:00:00").getTime() : null;
    const ateTs = fAte ? new Date(fAte + "T23:59:59").getTime() : null;
    return chamados.filter((c) => {
      if (aba !== "todos" && c.status !== aba) return false;
      if (fCategoria !== "todas" && !c.categorias.includes(fCategoria)) return false;
      if (fPrioridade !== "todas" && c.prioridade !== fPrioridade) return false;
      const ts = new Date(c.created_at).getTime();
      if (deTs != null && ts < deTs) return false;
      if (ateTs != null && ts > ateTs) return false;
      if (t && ![c.numero, c.assunto, c.solicitante_nome, c.setor].some((v) => String(v ?? "").toLowerCase().includes(t))) return false;
      return true;
    });
  }, [chamados, aba, fCategoria, fPrioridade, fDe, fAte, busca]);

  // Volta pra página 1 sempre que os filtros mudam.
  useEffect(() => { setPagina(1); }, [aba, fCategoria, fPrioridade, fDe, fAte, busca]);

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

  const donutData = useMemo(() => {
    const m: Record<string, number> = {};
    chamados.forEach((c) => { m[c.status] = (m[c.status] ?? 0) + 1; });
    return Object.entries(m).map(([status, value]) => ({ status, value }));
  }, [chamados]);

  const atribuir = async () => {
    if (!atribChamado || !atribDev) return;
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA")
      .update({ responsavel_id: atribDev, status: "em_andamento" }).eq("id", atribChamado);
    if (error) { toast({ title: "Erro ao atribuir", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: atribChamado, tipo: "evento", texto: `Chamado atribuído a ${nomeDe(atribDev)}`,
    });
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: atribChamado, evento: "atribuido" } }).catch(() => {});
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Assunto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Solicitante</TableHead>
                    <TableHead>Abertura</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => nav(`/app/sistemas/chamados/${c.id}/coordenar`)}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">#{c.numero}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm" title={c.assunto}>{c.assunto}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.categorias.map((x) => labelDe(CATEGORIAS, x)).join(", ") || "—"}</TableCell>
                      <TableCell><PrioridadeBadge prioridade={c.prioridade} /></TableCell>
                      <TableCell className="text-xs">{c.solicitante_nome || "—"}<div className="text-[10px] text-muted-foreground">{c.setor}</div></TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDataHora(c.created_at)}</TableCell>
                      <TableCell><StatusBadge status={c.status} /></TableCell>
                      <TableCell className="text-xs">{nomeDe(c.responsavel_id)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
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
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtrados.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">Nenhum chamado.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
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
    </div>
  );
}
