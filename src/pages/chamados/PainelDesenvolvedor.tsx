import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chamadosMarkSeen } from "@/hooks/useChamadosNotif";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { useChamadoPerms } from "./useChamadoPerms";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ListChecks, Clock, MessageSquare, CheckCircle2, AlertTriangle, ShieldAlert, CalendarClock, RotateCw, ArrowUpRight, Plus, BookOpen, ClipboardCheck, Sparkles, FileText, Zap, Star, Trophy } from "lucide-react";
import { FeedAtualizacoes } from "./FeedAtualizacoes";
import {
  StatCard, PrioridadeBadge, StatusBadge, STATUS_CHAMADO, PRIORIDADES, Estrelas, iniciais, fmtData, fmtDataHora, type Chamado,
} from "./types";

const DONUT: Record<string, string> = {
  aberto: "hsl(var(--warning))", em_andamento: "hsl(var(--info))",
  aguardando_retorno: "hsl(var(--primary))", concluido: "hsl(var(--success))",
  reprovado: "hsl(var(--destructive))",
};

const ATIVO = (s: string) => s !== "concluido" && s !== "reprovado";

export default function PainelDesenvolvedor() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: access } = useAccessibleMenus("visualizar");
  const { canCoordenar, gestor } = useChamadoPerms();
  const dev = access?.codes.has("chamados_sistemas_dev") ?? false;
  const nome = (user?.user_metadata as any)?.nome || user?.email || "";
  const podeEditarPrioridade = canCoordenar || gestor; // gerência troca a prioridade na fila

  const [flashPrioridade, setFlashPrioridade] = useState<string | null>(null);

  // Abriu o Painel do Desenvolvedor → zera a bolinha de novidades do dev.
  useEffect(() => { chamadosMarkSeen(user?.id, "dev"); }, [user?.id]);

  const { data: chamados = [], isLoading, refetch } = useQuery({
    queryKey: ["chamados-meus-atribuidos", user?.id],
    enabled: !!user?.id && dev,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA")
        .select("*")
        .eq("responsavel_id", user!.id)
        .order("prazo_previsto", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  // Posição na fila global (FIFO) dos chamados atribuídos a este dev.
  const { data: posicoes = {} } = useQuery({
    queryKey: ["chamados-posicao-fila", user?.id],
    enabled: !!user?.id && dev,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_posicao_fila");
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: { chamado_id: string; posicao: number }) => { m[r.chamado_id] = r.posicao; });
      return m;
    },
  });

  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });
  const nomeDe = (uid: string | null) => (uid ? usuarios.find((u) => u.id === uid)?.display_name ?? "—" : "—");

  // Ranking de satisfação da equipe (médias dos 5 critérios por responsável).
  const { data: ranking = [] } = useQuery({
    queryKey: ["chamados-ranking-satisfacao"],
    enabled: dev,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_ranking_satisfacao");
      return (data ?? []) as Array<{
        responsavel_id: string; avaliacoes: number; media: number;
        atendimento: number; tempo: number; solucao: number; clareza: number; satisfacao: number;
      }>;
    },
  });

  // Média geral e por item = média ponderada pelo nº de avaliações de cada dev.
  const satisfacao = useMemo(() => {
    const total = ranking.reduce((s, r) => s + Number(r.avaliacoes), 0);
    if (!total) return null;
    const w = (k: "media" | "atendimento" | "tempo" | "solucao" | "clareza" | "satisfacao") =>
      ranking.reduce((s, r) => s + Number(r[k]) * Number(r.avaliacoes), 0) / total;
    return {
      total,
      media: w("media"),
      itens: [
        { label: "Atendimento do analista", v: w("atendimento") },
        { label: "Tempo de atendimento", v: w("tempo") },
        { label: "Solução apresentada", v: w("solucao") },
        { label: "Clareza das informações", v: w("clareza") },
        { label: "Satisfação geral", v: w("satisfacao") },
      ],
    };
  }, [ranking]);

  const mudarPrioridade = async (id: string, prioridade: string, numero: string) => {
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({ prioridade }).eq("id", id);
    if (error) { toast({ title: "Erro ao alterar prioridade", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: id, tipo: "evento", texto: `Prioridade alterada para ${PRIORIDADES[prioridade]?.label ?? prioridade}`,
    });
    setFlashPrioridade(id); setTimeout(() => setFlashPrioridade(null), 500);
    toast({ title: `Prioridade do #${numero} → ${PRIORIDADES[prioridade]?.label ?? prioridade}` });
    qc.invalidateQueries({ queryKey: ["chamados-meus-atribuidos", user?.id] });
  };

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const stats = useMemo(() => {
    const ativos = chamados.filter((c) => ATIVO(c.status));
    const atrasados = ativos.filter((c) => c.prazo_previsto && new Date(c.prazo_previsto) < hoje);
    const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return {
      abertos: ativos.length,
      em_andamento: chamados.filter((c) => c.status === "em_andamento").length,
      aguardando: chamados.filter((c) => c.status === "aguardando_retorno").length,
      concluidos_mes: chamados.filter((c) => c.status === "concluido" && new Date(c.updated_at) >= mesIni).length,
      atrasados: atrasados.length,
    };
  }, [chamados]);

  const donutData = useMemo(() => {
    const m: Record<string, number> = {};
    chamados.forEach((c) => { m[c.status] = (m[c.status] ?? 0) + 1; });
    return Object.entries(m).map(([status, value]) => ({ status, value }));
  }, [chamados]);

  const proximos = useMemo(
    () => chamados.filter((c) => ATIVO(c.status) && c.prazo_previsto).sort((a, b) => +new Date(a.prazo_previsto!) - +new Date(b.prazo_previsto!)).slice(0, 5),
    [chamados],
  );

  // Chamado alvo dos atalhos = o mais urgente ativo (por prazo), senão o primeiro ativo.
  const chamadoAlvo = proximos[0]?.id ?? chamados.find((c) => ATIVO(c.status))?.id ?? null;
  const filaPrioridade = useMemo(() => {
    const ativos = chamados.filter((c) => ATIVO(c.status));
    return {
      alta: ativos.filter((c) => c.prioridade === "alta").length,
      media: ativos.filter((c) => c.prioridade === "media").length,
      baixa: ativos.filter((c) => c.prioridade === "baixa").length,
    };
  }, [chamados]);

  if (!dev) {
    return (
      <div>
        <PageHeader title="Painel do Desenvolvedor" module="Sistemas" breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito a desenvolvedores. Peça a liberação de <b>Chamados — Painel do Desenvolvedor</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Painel do Desenvolvedor"
        subtitle={`Olá${nome ? ", " + nome : ""}! Acompanhe os chamados, prazos e o andamento das solicitações atribuídas a você.`}
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor"]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={ListChecks} tone="primary" label="Meus chamados abertos" value={stats.abertos} />
        <StatCard icon={Clock} tone="info" label="Em andamento" value={stats.em_andamento} />
        <StatCard icon={MessageSquare} tone="primary" label="Aguardando retorno" value={stats.aguardando} />
        <StatCard icon={CheckCircle2} tone="success" label="Concluídos (mês)" value={stats.concluidos_mes} />
        <StatCard icon={AlertTriangle} tone="destructive" label="Atrasados" value={stats.atrasados} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-4">
          <p className="mb-3 text-sm font-bold">Meus chamados atribuídos</p>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-center">Fila</TableHead>
                    <TableHead>Chamado / Assunto</TableHead>
                    <TableHead>Solicitante / Setor</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Atualização</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chamados.map((c) => {
                    const atrasado = c.prazo_previsto && ATIVO(c.status) && new Date(c.prazo_previsto) < hoje;
                    return (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => nav(`/app/sistemas/chamados/${c.id}`)}>
                        <TableCell className="text-center">
                          {posicoes[c.id] ? (
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                c.prioridade === "alta" ? "bg-destructive/15 text-destructive"
                                : c.prioridade === "media" ? "bg-warning/15 text-warning"
                                : "bg-success/15 text-success"
                              }`}
                              title="Posição na fila por ordem de abertura"
                            >
                              {posicoes[c.id]}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <p className="font-mono text-[11px] font-semibold">#{c.numero}</p>
                          <p className="text-xs">{c.assunto}</p>
                        </TableCell>
                        <TableCell className="text-xs">{c.solicitante_nome || "—"}<div className="text-[10px] text-muted-foreground">{c.setor}</div></TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {podeEditarPrioridade && ATIVO(c.status) ? (
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
                        <TableCell><StatusBadge status={c.status} /></TableCell>
                        <TableCell className={`whitespace-nowrap text-xs ${atrasado ? "font-semibold text-destructive" : ""}`}>{fmtData(c.prazo_previsto)}{atrasado ? " · atrasado" : ""}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDataHora(c.updated_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                  {chamados.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Nenhum chamado atribuído.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Resumo dos meus chamados</p>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} dataKey="value" nameKey="status" cx="50%" cy="50%" innerRadius={34} outerRadius={56} paddingAngle={2}>
                    {donutData.map((d) => <Cell key={d.status} fill={DONUT[d.status] ?? "hsl(var(--muted-foreground))"} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1">
              {donutData.map((d) => (
                <div key={d.status} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: DONUT[d.status] ?? "hsl(var(--muted-foreground))" }} />
                    {STATUS_CHAMADO[d.status]?.label ?? d.status}
                  </span>
                  <span className="font-medium">{d.value}</span>
                </div>
              ))}
              {donutData.length === 0 && <p className="text-xs text-muted-foreground">Sem chamados.</p>}
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><CalendarClock className="h-4 w-4 text-primary" /> Próximos prazos</p>
            <div className="space-y-2">
              {proximos.map((c) => (
                <button key={c.id} onClick={() => nav(`/app/sistemas/chamados/${c.id}`)} className="block w-full rounded border border-border px-2.5 py-1.5 text-left hover:border-primary/40">
                  <p className="text-xs font-medium">{fmtData(c.prazo_previsto)} — #{c.numero}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{c.assunto}</p>
                </button>
              ))}
              {proximos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum prazo próximo.</p>}
            </div>
          </Card>

          <FeedAtualizacoes buildHref={(cid) => `/app/sistemas/chamados/${cid}`} />
        </div>
      </div>

      {/* Satisfação — ranking da equipe + médias por item avaliado */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Trophy className="h-4 w-4 text-warning" /> Ranking de satisfação</p>
            {satisfacao && (
              <div className="flex items-center gap-1.5">
                <Estrelas valor={satisfacao.media} size={15} />
                <span className="text-sm font-bold">{satisfacao.media.toFixed(1).replace(".", ",")}</span>
                <span className="text-[11px] text-muted-foreground">({satisfacao.total})</span>
              </div>
            )}
          </div>
          <div className="space-y-2">
            {ranking.map((r, i) => (
              <div key={r.responsavel_id} className="flex items-center gap-2.5">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  i === 0 ? "bg-warning/20 text-warning"
                  : i === 1 ? "bg-muted-foreground/20 text-muted-foreground"
                  : i === 2 ? "bg-orange-500/20 text-orange-600"
                  : "bg-muted text-muted-foreground"
                }`}>{i + 1}</span>
                <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{iniciais(nomeDe(r.responsavel_id))}</AvatarFallback></Avatar>
                <p className="min-w-0 flex-1 truncate text-xs font-medium">{nomeDe(r.responsavel_id)}</p>
                <Estrelas valor={Number(r.media)} size={13} />
                <span className="w-7 text-right text-xs font-semibold">{Number(r.media).toFixed(1).replace(".", ",")}</span>
                <span className="w-8 text-right text-[10px] text-muted-foreground">({r.avaliacoes})</span>
              </div>
            ))}
            {ranking.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Ainda não há avaliações de chamados concluídos.</p>}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-bold"><Star className="h-4 w-4 text-warning" /> Média de satisfação por item avaliado</p>
          <div className="space-y-2.5">
            {satisfacao ? satisfacao.itens.map((it) => (
              <div key={it.label} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <Estrelas valor={it.v} size={13} />
                <span className="w-7 text-right font-semibold">{it.v.toFixed(1).replace(".", ",")}</span>
                <span className="w-8 text-right text-[10px] text-muted-foreground">({satisfacao.total})</span>
              </div>
            )) : (
              <p className="py-4 text-center text-xs text-muted-foreground">Sem avaliações ainda.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Rodapé: fila por prioridade, atalhos e referências */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <p className="mb-2 text-sm font-bold">Fila de chamados por prioridade</p>
          <div className="space-y-1.5">
            {([
              ["Alta", filaPrioridade.alta, "text-destructive"],
              ["Média", filaPrioridade.media, "text-warning"],
              ["Baixa", filaPrioridade.baixa, "text-success"],
            ] as const).map(([label, n, cor]) => (
              <div key={label} className="flex items-center justify-between text-xs">
                <span className={`font-semibold ${cor}`}>{label}</span>
                <span className="font-medium">{n}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-sm font-bold">Atalhos rápidos</p>
          <div className="grid grid-cols-2 gap-2">
            <button disabled={!chamadoAlvo} onClick={() => chamadoAlvo && nav(`/app/sistemas/chamados/${chamadoAlvo}`)} className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 text-center text-[11px] font-medium hover:border-primary/40 disabled:opacity-50">
              <ArrowUpRight className="h-4 w-4 text-primary" /> Chamado mais urgente
            </button>
            <button onClick={() => refetch()} className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 text-center text-[11px] font-medium hover:border-primary/40">
              <RotateCw className="h-4 w-4 text-info" /> Atualizar lista
            </button>
            <button disabled={!chamadoAlvo} onClick={() => chamadoAlvo && nav(`/app/sistemas/chamados/${chamadoAlvo}`)} className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 text-center text-[11px] font-medium hover:border-primary/40 disabled:opacity-50">
              <MessageSquare className="h-4 w-4 text-warning" /> Solicitar informação
            </button>
            <button onClick={() => nav("/app/sistemas/chamados/novo")} className="flex flex-col items-center gap-1 rounded-lg border border-border p-3 text-center text-[11px] font-medium hover:border-primary/40">
              <Plus className="h-4 w-4 text-success" /> Abrir novo chamado
            </button>
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-2 text-sm font-bold">Documentos e referências</p>
          <div className="space-y-1.5">
            {[
              { icon: BookOpen, label: "Padrão de desenvolvimento" },
              { icon: ClipboardCheck, label: "Checklist de testes" },
              { icon: Sparkles, label: "Boas práticas — ERP" },
              { icon: FileText, label: "Documentação técnica" },
            ].map((d) => (
              <div key={d.label} className="flex items-center gap-2 rounded border border-border/60 px-2.5 py-1.5 text-xs">
                <d.icon className="h-3.5 w-3.5 text-primary" />
                <span className="flex-1">{d.label}</span>
                <Zap className="h-3 w-3 text-muted-foreground/60" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
