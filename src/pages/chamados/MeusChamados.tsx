import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chamadosMarkSeen } from "@/hooks/useChamadosNotif";
import { useChamadoPerms } from "./useChamadoPerms";
import { FeedAtualizacoes } from "./FeedAtualizacoes";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, ClipboardList, CheckCircle2, Clock, RotateCcw, CalendarClock, Info, MessageSquarePlus, XCircle, Lightbulb, ChevronLeft, ChevronRight, Star } from "lucide-react";
import {
  StatCard, StatusBadge, PrioridadeBadge, fmtData, fmtDataHora, moduloLabel, type Chamado,
} from "./types";

const POR_PAGINA = 8;

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

  // Abriu "Meus chamados" → zera a bolinha de novidades do solicitante.
  useEffect(() => { chamadosMarkSeen(user?.id, "meus"); }, [user?.id]);

  const { data: avaliacoesPendentes = [] } = useQuery({
    queryKey: ["chamados-avaliacoes-pendentes"],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_meus_avaliacoes_pendentes");
      return (data ?? []) as Array<{ id: string; numero: string; assunto: string }>;
    },
  });

  const [pagina, setPagina] = useState(1);

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
        .from("CHAMADO_SISTEMA")
        .select("*")
        .eq("solicitante_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Chamado[];
    },
  });

  // Paginação (client-side) para não renderizar centenas de linhas de uma vez.
  const totalPaginas = Math.max(1, Math.ceil(chamados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = useMemo(
    () => chamados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA),
    [chamados, paginaAtual],
  );
  const de = chamados.length === 0 ? 0 : (paginaAtual - 1) * POR_PAGINA + 1;
  const ate = Math.min(paginaAtual * POR_PAGINA, chamados.length);

  return (
    <div>
      <PageHeader
        title="Chamados de Sistemas"
        subtitle="Abra, acompanhe e gerencie seus chamados para ajustes e correções."
        module="Central de Serviços"
        breadcrumb={["Chamados de Sistemas"]}
        actions={canAbrir ? <Button onClick={() => nav(`${base}/novo`)} className="gap-1.5"><Plus className="h-4 w-4" /> Abrir Novo Chamado</Button> : undefined}
      />

      <Card className="mb-4 grid gap-4 border-info/30 bg-info/5 p-4 md:grid-cols-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-info"><Info className="h-4 w-4" /> Este canal é exclusivo para solicitações de ajustes, correções e melhorias em funcionalidades existentes.</p>
          <p className="mt-1 text-xs text-muted-foreground">Utilize para resolver falhas, inconsistências, dúvidas de uso e solicitações que impactam o seu dia a dia.</p>
          <p className="mt-1 text-xs text-muted-foreground">Nosso time analisará e retornará o mais breve possível.</p>
        </div>
        <div className="md:border-l md:border-info/20 md:pl-4">
          <p className="text-sm font-semibold text-destructive">Não utilize para:</p>
          <ul className="mt-1 space-y-1">
            {[
              "Criação de novos módulos ou funcionalidades",
              "Novas integrações ou automações complexas",
              "Solicitações estratégicas ou mudanças de processo",
            ].map((t) => (
              <li key={t} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      {avaliacoesPendentes.length > 0 && (
        <Card className="mb-4 space-y-2 border-warning/40 bg-warning/5 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
            <Star className="h-4 w-4" /> Você tem {avaliacoesPendentes.length} avaliação(ões) pendente(s) — avalie para poder abrir novos chamados.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {avaliacoesPendentes.map((p) => (
              <button key={p.id} onClick={() => nav(`${base}/${p.id}/acompanhar`)}
                className="flex items-center gap-1 rounded border border-warning/40 bg-background px-2 py-1 text-xs hover:border-warning">
                <Star className="h-3 w-3 text-warning" /> <span className="font-mono font-semibold">#{p.numero}</span> avaliar
              </button>
            ))}
          </div>
        </Card>
      )}

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
                {visiveis.map((c, i) => {
                  const aguardando = c.status === "aguardando_retorno";
                  return (
                  <TableRow
                    key={c.id}
                    className={`cursor-pointer ${aguardando ? "bg-primary/5 hover:bg-primary/10" : ""}`}
                    onClick={() => nav(`${base}/${c.id}/acompanhar`)}
                  >
                    <TableCell className="text-center text-xs text-muted-foreground">{de + i}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">#{c.numero}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm" title={c.assunto}>
                      {c.assunto}
                      {aguardando && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary">
                          <MessageSquarePlus className="h-3 w-3" /> Adicionar mais informações
                        </span>
                      )}
                    </TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Mostrando {de} a {ate} de {chamados.length} chamados</p>
              {totalPaginas > 1 && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" className="h-8 gap-1 px-2" disabled={paginaAtual <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-2 text-xs text-muted-foreground">Página {paginaAtual} de {totalPaginas}</span>
                  <Button variant="outline" size="sm" className="h-8 gap-1 px-2" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="space-y-1 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Lightbulb className="h-4 w-4 text-warning" /> Quando abrir um chamado?</p>
            <p className="text-xs text-muted-foreground">
              Utilize este canal para solicitar ajustes, correções e melhorias em funcionalidades existentes,
              incluindo situações que impactam seu trabalho diário.
            </p>
          </Card>
          <Card className="space-y-1 p-4">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Clock className="h-4 w-4 text-info" /> Horário de atendimento</p>
            <p className="text-xs font-medium">Segunda a Sexta-feira · 8h às 18h</p>
            <p className="text-xs text-muted-foreground">Chamados fora do horário serão avaliados no próximo dia útil.</p>
          </Card>
        </div>
        <FeedAtualizacoes buildHref={(cid) => `${base}/${cid}/acompanhar`} />
      </div>
    </div>
  );
}
