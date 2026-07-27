import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import { ListChecks, Clock, MessageSquare, CheckCircle2, AlertTriangle, ShieldAlert, CalendarClock } from "lucide-react";
import {
  StatCard, PrioridadeBadge, TarefaStatusBadge, STATUS_TAREFA, fmtData, type Tarefa,
} from "./types";

type TarefaJoin = Tarefa & { chamado_sistema: { numero: string; assunto: string; solicitante_nome: string | null; setor: string | null; status: string } | null };

const DONUT: Record<string, string> = {
  em_andamento: "hsl(var(--info))", aguardando_informacoes: "hsl(var(--primary))",
  pendente: "hsl(var(--warning))", concluida: "hsl(var(--success))",
};

export default function PainelDesenvolvedor() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { data: access } = useAccessibleMenus("visualizar");
  const dev = access?.codes.has("chamados_sistemas_dev") ?? false;
  const nome = (user?.user_metadata as any)?.nome || user?.email || "";

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ["chamados-minhas-tarefas", user?.id],
    enabled: !!user?.id && dev,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("chamado_sistema_tarefa")
        .select("*, chamado_sistema(numero,assunto,solicitante_nome,setor,status)")
        .eq("responsavel_id", user!.id)
        .order("ordem", { ascending: true });
      if (error) throw error;
      return (data ?? []) as TarefaJoin[];
    },
  });

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const stats = useMemo(() => {
    const ativas = tarefas.filter((t) => t.status !== "concluida");
    const atrasadas = ativas.filter((t) => t.prazo && new Date(t.prazo) < hoje);
    const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    return {
      abertas: ativas.length,
      em_andamento: tarefas.filter((t) => t.status === "em_andamento").length,
      aguardando: tarefas.filter((t) => t.status === "aguardando_informacoes").length,
      concluidas_mes: tarefas.filter((t) => t.status === "concluida" && new Date(t.updated_at) >= mesIni).length,
      atrasadas: atrasadas.length,
    };
  }, [tarefas]);

  const donutData = useMemo(() => {
    const m: Record<string, number> = {};
    tarefas.forEach((t) => { m[t.status] = (m[t.status] ?? 0) + 1; });
    return Object.entries(m).map(([status, value]) => ({ status, value }));
  }, [tarefas]);

  const proximos = useMemo(
    () => tarefas.filter((t) => t.status !== "concluida" && t.prazo).sort((a, b) => +new Date(a.prazo!) - +new Date(b.prazo!)).slice(0, 5),
    [tarefas],
  );

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
        subtitle={`Olá${nome ? ", " + nome : ""}! Acompanhe suas tarefas, prazos e o andamento dos chamados atribuídos a você.`}
        module="Sistemas"
        breadcrumb={["Chamados de Sistemas", "Painel do Desenvolvedor"]}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={ListChecks} tone="primary" label="Minhas tarefas abertas" value={stats.abertas} />
        <StatCard icon={Clock} tone="info" label="Em andamento" value={stats.em_andamento} />
        <StatCard icon={MessageSquare} tone="primary" label="Aguardando infos" value={stats.aguardando} />
        <StatCard icon={CheckCircle2} tone="success" label="Concluídas (mês)" value={stats.concluidas_mes} />
        <StatCard icon={AlertTriangle} tone="destructive" label="Atrasadas" value={stats.atrasadas} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-4">
          <p className="mb-3 text-sm font-bold">Minhas tarefas atribuídas</p>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Chamado / Tarefa</TableHead>
                    <TableHead>Solicitante / Setor</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prazo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tarefas.map((t, i) => {
                    const atrasada = t.prazo && t.status !== "concluida" && new Date(t.prazo) < hoje;
                    return (
                      <TableRow key={t.id} className="cursor-pointer" onClick={() => nav(`/app/sistemas/chamados/${t.chamado_id}`)}>
                        <TableCell className="text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                        <TableCell>
                          <p className="font-mono text-[11px] font-semibold">#{t.chamado_sistema?.numero}</p>
                          <p className="text-xs">{t.titulo}</p>
                        </TableCell>
                        <TableCell className="text-xs">{t.chamado_sistema?.solicitante_nome || "—"}<div className="text-[10px] text-muted-foreground">{t.chamado_sistema?.setor}</div></TableCell>
                        <TableCell><PrioridadeBadge prioridade={t.prioridade} /></TableCell>
                        <TableCell><TarefaStatusBadge status={t.status} /></TableCell>
                        <TableCell className={`whitespace-nowrap text-xs ${atrasada ? "font-semibold text-destructive" : ""}`}>{fmtData(t.prazo)}{atrasada ? " · atrasado" : ""}</TableCell>
                      </TableRow>
                    );
                  })}
                  {tarefas.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">Nenhuma tarefa atribuída.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Resumo das minhas tarefas</p>
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
                    {STATUS_TAREFA[d.status]?.label ?? d.status}
                  </span>
                  <span className="font-medium">{d.value}</span>
                </div>
              ))}
              {donutData.length === 0 && <p className="text-xs text-muted-foreground">Sem tarefas.</p>}
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><CalendarClock className="h-4 w-4 text-primary" /> Próximos prazos</p>
            <div className="space-y-2">
              {proximos.map((t) => (
                <button key={t.id} onClick={() => nav(`/app/sistemas/chamados/${t.chamado_id}`)} className="block w-full rounded border border-border px-2.5 py-1.5 text-left hover:border-primary/40">
                  <p className="text-xs font-medium">{fmtData(t.prazo)} — #{t.chamado_sistema?.numero}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{t.titulo}</p>
                </button>
              ))}
              {proximos.length === 0 && <p className="text-xs text-muted-foreground">Nenhum prazo próximo.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
