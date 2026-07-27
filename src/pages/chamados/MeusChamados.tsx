import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useChamadoPerms } from "./useChamadoPerms";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, ClipboardList, CheckCircle2, Clock, RotateCcw, CalendarClock, Info } from "lucide-react";
import {
  StatCard, StatusBadge, PrioridadeBadge, fmtData, fmtDataHora, moduloLabel, type Chamado,
} from "./types";

interface Stats { meus: number; concluidos: number; em_atendimento: number; aguardando_acao: number; tempo_medio: number | null; }

export default function MeusChamados({ base = "/app/central-servicos/chamados" }: { base?: string }) {
  const nav = useNavigate();
  const { user } = useAuth();
  const { canAbrir } = useChamadoPerms();

  const { data: usuarios = [] } = useQuery({
    queryKey: ["chamados-usuarios"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("listar_usuarios_ativos");
      return (data ?? []) as Array<{ id: string; display_name: string }>;
    },
  });
  const nomeDe = (id: string | null) => (id ? usuarios.find((u) => u.id === id)?.display_name ?? "—" : "—");

  const { data: stats } = useQuery({
    queryKey: ["chamados-meus-stats"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("chamados_meus_stats");
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as Stats;
    },
  });

  const { data: chamados = [], isLoading } = useQuery({
    queryKey: ["chamados-meus", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("chamado_sistema")
        .select("*")
        .eq("solicitante_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  return (
    <div>
      <PageHeader
        title="Chamados de Sistemas"
        subtitle="Abra, acompanhe e gerencie seus chamados para ajustes e correções."
        module="Central de Serviços"
        breadcrumb={["Chamados de Sistemas"]}
        actions={canAbrir ? <Button onClick={() => nav(`${base}/novo`)} className="gap-1.5"><Plus className="h-4 w-4" /> Abrir Novo Chamado</Button> : undefined}
      />

      <Card className="mb-4 flex flex-col gap-1 border-info/30 bg-info/5 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-info"><Info className="h-4 w-4" /> Canal exclusivo para ajustes, correções e melhorias em funcionalidades existentes.</p>
          <p className="text-xs text-muted-foreground">Utilize para resolver falhas, inconsistências, dúvidas de uso e solicitações que impactam o seu dia a dia.</p>
        </div>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard icon={ClipboardList} tone="primary" label="Total de solicitações" value={stats?.meus ?? 0} hint="Meus chamados" />
        <StatCard icon={CheckCircle2} tone="success" label="Chamados finalizados" value={stats?.concluidos ?? 0} hint="Concluídos" />
        <StatCard icon={Clock} tone="warning" label="Em análise ou execução" value={stats?.em_atendimento ?? 0} hint="Em atendimento" />
        <StatCard icon={RotateCcw} tone="primary" label="Necessita de retorno" value={stats?.aguardando_acao ?? 0} hint="Aguardando sua ação" />
        <StatCard icon={CalendarClock} tone="muted" label="Prazo médio de conclusão" value={stats?.tempo_medio != null ? `${stats.tempo_medio} dias` : "—"} hint="Tempo médio" />
      </div>

      <Card className="p-4">
        <p className="mb-3 text-sm font-bold">Meus últimos chamados</p>
        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : chamados.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Você ainda não abriu chamados. Clique em <b>Abrir Novo Chamado</b>.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Fila</TableHead>
                  <TableHead>Nº do chamado</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Módulo / Sistema</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Prazo previsto</TableHead>
                  <TableHead>Abertura</TableHead>
                  <TableHead>Observação do gerente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {chamados.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-center text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">#{c.numero}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm" title={c.assunto}>{c.assunto}</TableCell>
                    <TableCell className="text-xs">{moduloLabel(c)}</TableCell>
                    <TableCell><PrioridadeBadge prioridade={c.prioridade} /></TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell className="text-xs">{nomeDe(c.responsavel_id)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtData(c.prazo_previsto)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDataHora(c.created_at)}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={c.observacao_gerente ?? ""}>
                      {c.observacao_gerente || (c.status === "reprovado" && c.motivo_reprovacao ? c.motivo_reprovacao : "—")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
