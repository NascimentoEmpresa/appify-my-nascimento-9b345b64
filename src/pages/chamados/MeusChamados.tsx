import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { chamadosMarkSeen } from "@/hooks/useChamadosNotif";
import { useChamadoPerms } from "./useChamadoPerms";
import { FeedAtualizacoes } from "./FeedAtualizacoes";
import { AvaliarChamadoDialog } from "./AvaliarChamadoDialog";
import { ConfirmarConclusaoDialog } from "./ConfirmarConclusaoDialog";
import { BotaoChatChamado, useChamadosNaoLidos } from "./BotaoChatChamado";
import { BotaoStatusChamado, SeloEtapaValidacao, useValidacoesChamados } from "./StatusValidacao";
import {
  avaliacaoLiberada, abrirChamadoTravado, LIMITE_AVALIACOES_PENDENTES, podeConfirmarConclusao, separarPendencias, descreverPendencias,
  type PendenciaSolicitante,
} from "./validacaoPresidencia";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, ClipboardList, CheckCircle2, Clock, RotateCcw, CalendarClock, Info, MessageSquarePlus, XCircle, Lightbulb, ChevronLeft, ChevronRight, Star, Lock, GraduationCap, Search, Eye, Archive, FilterX, MessageCircle, Users } from "lucide-react";
import {
  StatCard, StatusBadge, SeloConfirmacao, SeloDesenvolvimento, PrioridadeBadge, Estrelas, fmtData, fmtDataHora, moduloLabel,
  chamadoAtivo, mediaAvaliacao, STATUS_CHAMADO, PRIORIDADES, type Chamado, type AvaliacaoChamado,
} from "./types";
import {
  chamadoComPendencia, motivoNaListaPadrao, passaNosFiltros, filtrosAtivos, rankingDevs, mediaSimples, FILTROS_VAZIOS,
  type ConversaSolicitante, type FiltrosMeusChamados, type MotivoNaLista,
} from "./listaSolicitante";

// RPC/tabela fora do types.ts gerado: um ponto sem tipo, em vez de mais
// "(supabase as any)" — a catraca do lint não deixa o arquivo subir de erro.
type RespostaSemTipo = { data: unknown; error: { message: string } | null };
const rpcSemTipo = (fn: string, args?: Record<string, unknown>): Promise<RespostaSemTipo> =>
  (supabase.rpc as unknown as (this: typeof supabase, f: string, a?: Record<string, unknown>) => Promise<RespostaSemTipo>).call(supabase, fn, args);
const tabelaSemTipo = supabase as unknown as {
  from: (t: string) => { select: (c: string) => { eq: (k: string, v: string) => Promise<RespostaSemTipo> } };
};

type Visao = "pendentes" | "historico" | "todos";
const TODOS = "__todos";
const fmtDias = (n: number | null) => (n == null ? "—" : `${n.toFixed(1).replace(".", ",")} dias`);

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
      return (data ?? []) as PendenciaSolicitante[];
    },
  });

  // Treinamentos de sistemas que EU devo confirmar (mig 273) — de qualquer
  // chamado, não só dos meus: posso ter recebido pelo meu setor.
  const { data: treinamentosPendentes = 0 } = useQuery({
    queryKey: ["chamado-validacoes", "treinamentos-sistemas-meus", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("treinamentos_sistemas_meus");
      return ((data ?? []) as Array<{ confirmado_em: string | null }>).filter((t) => !t.confirmado_em).length;
    },
  });

  // Posição na fila (FIFO): o chamado ATIVO mais antigo aberto é o nº 1.
  const { data: posicoes = {} } = useQuery({
    queryKey: ["chamados-posicao-fila", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_posicao_fila");
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: { chamado_id: string; posicao: number }) => { m[r.chamado_id] = r.posicao; });
      return m;
    },
  });

  const { data: naoLidos = {} } = useChamadosNaoLidos();

  // Confirmar conclusão (mig 20261028001300) e avaliar contam juntos na trava de 3.
  const { confirmar: confirmacoesPendentes, avaliar: soAvaliacoes } = useMemo(() => separarPendencias(avaliacoesPendentes), [avaliacoesPendentes]);
  const pendentesIds = useMemo(() => new Set(soAvaliacoes.map((p) => p.id)), [soAvaliacoes]);
  const [avaliarAlvo, setAvaliarAlvo] = useState<{ id: string; numero: string; participante?: boolean } | null>(null);
  const [confirmarAlvo, setConfirmarAlvo] = useState<Pick<Chamado, "id" | "numero" | "status" | "responsavel_id" | "assunto"> | null>(null);
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

  // Validação da Presidência (mig 266) dos chamados listados: selo da etapa
  // e a trava da avaliação enquanto a Presidência valida.
  const { data: validacoes = {} } = useValidacoesChamados(chamados.map((c) => c.id));

  // Estado da conversa de cada chamado meu (mig 20261115000900), numa consulta
  // só: decide se o encerrado volta para a lista padrão. Sem a migration
  // aplicada, o mapa fica vazio e só a mensagem não lida traz o chamado de volta.
  const qc = useQueryClient();
  const { data: conversas = {} } = useQuery({
    queryKey: ["chamados-meus-conversa", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await rpcSemTipo("chamados_meus_conversa");
      if (error) return {} as Record<string, ConversaSolicitante>;
      const m: Record<string, ConversaSolicitante> = {};
      ((data ?? []) as Array<ConversaSolicitante & { chamado_id: string }>).forEach((r: ConversaSolicitante & { chamado_id: string }) => { m[r.chamado_id] = r; });
      return m;
    },
  });

  // Notas que EU dei (painel do solicitante): uma consulta, conta no front.
  const { data: minhasNotas = {} } = useQuery({
    queryKey: ["chamados-minhas-avaliacoes", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await tabelaSemTipo
        .from("CHAMADO_SISTEMA_AVALIACAO")
        .select("chamado_id, qualidade, prazo, comunicacao, clareza, facilidade, satisfacao")
        .eq("solicitante_id", user!.id);
      const m: Record<string, number> = {};
      ((data ?? []) as AvaliacaoChamado[]).forEach((a) => { m[a.chamado_id] = mediaAvaliacao(a); });
      return m;
    },
  });

  // Padrão: só o que tem pendência (pedido do solicitante + Pablo, 13/11/2026).
  const [visao, setVisao] = useState<Visao>("pendentes");
  const [filtros, setFiltros] = useState<FiltrosMeusChamados>(FILTROS_VAZIOS);
  const mudarFiltro = (patch: Partial<FiltrosMeusChamados>) => { setFiltros((f) => ({ ...f, ...patch })); setPagina(1); };
  const mudarVisao = (v: Visao) => { setVisao(v); setPagina(1); };

  const todasPendencias = useMemo(() => new Set(avaliacoesPendentes.map((p) => p.id)), [avaliacoesPendentes]);
  const motivos = useMemo(() => {
    const m: Record<string, MotivoNaLista> = {};
    for (const c of chamados) {
      m[c.id] = motivoNaListaPadrao({
        pendente: chamadoComPendencia(c, todasPendencias.has(c.id), !avaliacaoLiberada(validacoes[c.id]).liberada),
        naoLidos: naoLidos[c.id] ?? 0,
        conversa: conversas[c.id],
      });
    }
    return m;
  }, [chamados, todasPendencias, validacoes, naoLidos, conversas]);

  const qtdPendentes = chamados.filter((c) => motivos[c.id]).length;
  const qtdHistorico = chamados.length - qtdPendentes;

  const opcoesResponsavel = [...new Set(chamados.map((c) => c.responsavel_id).filter(Boolean) as string[])]
    .map((id) => ({ id, nome: nomeDe(id) })).sort((a, b) => a.nome.localeCompare(b.nome));
  const opcoesModulo = useMemo(() => [...new Set(chamados.map((c) => moduloLabel(c)))].sort(), [chamados]);

  const filtrados = useMemo(() => chamados.filter((c) => {
    const naLista = !!motivos[c.id];
    if (visao === "pendentes" && !naLista) return false;
    if (visao === "historico" && naLista) return false;
    return passaNosFiltros(c, moduloLabel(c), filtros);
  }), [chamados, motivos, visao, filtros]);

  const marcarVisto = async (c: Chamado) => {
    let { error } = await rpcSemTipo("chamado_marcar_visto", { p_chamado_id: c.id });
    // Antes da migration entrar: ao menos zera a bolinha (arquiva se não respondeu).
    if (error) ({ error } = await rpcSemTipo("chamado_marcar_lido", { p_chamado_id: c.id }));
    if (error) { toast.error(`Não foi possível marcar como visto: ${error.message}`); return; }
    toast.success(`#${c.numero} arquivado — volta se chegar mensagem nova.`);
    qc.invalidateQueries({ queryKey: ["chamados-nao-lidos"] });
    qc.invalidateQueries({ queryKey: ["chamados-meus-conversa"] });
  };

  // Painel do solicitante: só os MEUS chamados (já carregados acima).
  const painel = useMemo(() => {
    const notas = Object.values(minhasNotas);
    return {
      abertos: chamados.filter((c) => chamadoAtivo(c.status)).length,
      notaMedia: mediaSimples(notas),
      qtdNotas: notas.length,
      devs: rankingDevs(chamados, minhasNotas).slice(0, 6),
    };
  }, [chamados, minhasNotas]);

  // Paginação (client-side) para não renderizar centenas de linhas de uma vez.
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = useMemo(
    () => filtrados.slice((paginaAtual - 1) * POR_PAGINA, paginaAtual * POR_PAGINA),
    [filtrados, paginaAtual],
  );
  const de = filtrados.length === 0 ? 0 : (paginaAtual - 1) * POR_PAGINA + 1;
  const ate = Math.min(paginaAtual * POR_PAGINA, filtrados.length);

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
            <Star className="h-4 w-4 shrink-0" />
            <span>
              {descreverPendencias(avaliacoesPendentes)} —{" "}
              {abrirChamadoTravado(avaliacoesPendentes)
                ? "confirme e avalie para poder abrir novos chamados."
                : `com ${LIMITE_AVALIACOES_PENDENTES} pendências (confirmar ou avaliar), a abertura de novos chamados fica bloqueada.`}
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {confirmacoesPendentes.map((p) => (
              <button key={p.id} onClick={() => setConfirmarAlvo({ id: p.id, numero: p.numero, assunto: p.assunto, status: "concluido", responsavel_id: chamados.find((c) => c.id === p.id)?.responsavel_id ?? null })}
                className="flex items-center gap-1 rounded border border-success/40 bg-background px-2 py-1 text-xs transition-transform hover:border-success hover:bg-success/5 active:scale-90">
                <CheckCircle2 className="h-3 w-3 text-success" /> <span className="font-mono font-semibold">#{p.numero}</span> confirmar conclusão
              </button>
            ))}
            {soAvaliacoes.map((p) => (
              <button key={p.id} onClick={() => setAvaliarAlvo({ id: p.id, numero: p.numero, participante: p.pendencia === "avaliacao_participante" })}
                className="flex items-center gap-1 rounded border border-warning/40 bg-background px-2 py-1 text-xs transition-transform hover:border-warning hover:bg-warning/5 active:scale-90">
                <Star className="h-3 w-3 text-warning" /> <span className="font-mono font-semibold">#{p.numero}</span> avaliar
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Treinamentos de sistemas a confirmar (mig 273): a confirmação é em
          Central de Serviços › Treinamentos › Treinamentos Sistemas. */}
      {treinamentosPendentes > 0 && (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-2 border-primary/40 bg-primary/5 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <GraduationCap className="h-4 w-4" /> Você tem {treinamentosPendentes} treinamento(s) de sistemas para confirmar.
          </p>
          <Button size="sm" onClick={() => nav("/app/central-servicos/treinamentos-sistemas")} className="gap-1.5">
            <GraduationCap className="h-4 w-4" /> Ir para Treinamentos Sistemas
          </Button>
        </Card>
      )}

      {/* 5 cards numa linha só a partir de 1536 px — abaixo disso os rótulos cortavam. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <StatCard icon={ClipboardList} tone="primary" label="Total de solicitações" value={stats?.meus ?? 0} hint="Meus chamados" />
        <StatCard icon={CheckCircle2} tone="success" label="Chamados finalizados" value={stats?.concluidos ?? 0} hint="Concluídos" />
        <StatCard icon={RotateCcw} tone="primary" label="Necessita de retorno" value={stats?.aguardando_acao ?? 0} hint="Aguardando sua ação" />
        <StatCard icon={Star} tone="warning" label="Aguardando você" value={avaliacoesPendentes.length}
          hint={`${confirmacoesPendentes.length} a confirmar · ${soAvaliacoes.length} a avaliar`} />
        <StatCard icon={CalendarClock} tone="muted" label="Prazo médio de conclusão" value={stats?.tempo_medio != null ? `${stats.tempo_medio} dias` : "—"} hint="Tempo médio" />
      </div>

      {/* Painel do solicitante (13/11/2026): só com os MEUS chamados. */}
      {chamados.length > 0 && (
        <Card className="mb-4 grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-3 lg:border-r lg:pr-4">
            <p className="text-sm font-bold">Meu painel</p>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-md bg-muted/50 p-2">
                <p className="text-xl font-bold">{painel.abertos}</p>
                <p className="text-[11px] text-muted-foreground">Em aberto</p>
              </div>
              <div className="rounded-md bg-muted/50 p-2">
                <p className="text-xl font-bold">{stats?.concluidos ?? 0}</p>
                <p className="text-[11px] text-muted-foreground">Concluídos</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sua avaliação média dos atendimentos</p>
              {painel.notaMedia != null ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-xl font-bold">{painel.notaMedia.toFixed(1).replace(".", ",")}</span>
                  <Estrelas valor={painel.notaMedia} />
                  <span className="text-[11px] text-muted-foreground">({painel.qtdNotas} {painel.qtdNotas === 1 ? "avaliação" : "avaliações"})</span>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Você ainda não avaliou chamados.</p>
              )}
            </div>
          </div>
          <div className="min-w-0">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Users className="h-4 w-4 text-primary" /> Quem mais atende seus chamados</p>
            {painel.devs.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum chamado seu tem responsável ainda.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table className="[&_td]:px-2 [&_td]:py-1.5 [&_th]:h-8 [&_th]:px-2">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Responsável</TableHead>
                      <TableHead className="text-center">Chamados</TableHead>
                      <TableHead className="text-center">Concluídos</TableHead>
                      <TableHead className="text-center">Prazo médio</TableHead>
                      <TableHead>Sua nota</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {painel.devs.map((d) => (
                      <TableRow key={d.responsavel_id}>
                        <TableCell className="text-xs font-medium">{nomeDe(d.responsavel_id)}</TableCell>
                        <TableCell className="text-center text-xs">{d.quantidade}</TableCell>
                        <TableCell className="text-center text-xs">{d.concluidos}</TableCell>
                        <TableCell className="text-center text-xs">{fmtDias(d.prazo_medio)}</TableCell>
                        <TableCell className="text-xs">
                          {d.nota_media != null ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Estrelas valor={d.nota_media} size={12} /> {d.nota_media.toFixed(1).replace(".", ",")}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold">
            {visao === "pendentes" ? "Meus chamados com pendência" : visao === "historico" ? "Histórico (concluídos e encerrados)" : "Todos os meus chamados"}
          </p>
          <div className="inline-flex rounded-md border p-0.5">
            {([
              ["pendentes", `Com pendência (${qtdPendentes})`],
              ["historico", `Histórico (${qtdHistorico})`],
              ["todos", `Todos (${chamados.length})`],
            ] as const).map(([v, rot]) => (
              <Button key={v} size="sm" variant={visao === v ? "default" : "ghost"} className="h-7 px-2.5 text-xs" onClick={() => mudarVisao(v)}>
                {rot}
              </Button>
            ))}
          </div>
        </div>

        {/* Filtros do topo — por padrão nenhum, e a visão é "com pendência". */}
        <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          <div className="relative sm:col-span-2 lg:col-span-1 2xl:col-span-2">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={filtros.busca} onChange={(e) => mudarFiltro({ busca: e.target.value })} placeholder="Nº ou assunto" className="h-9 pl-8" />
          </div>
          <Select value={filtros.status || TODOS} onValueChange={(v) => {
            const status = v === TODOS ? "" : v;
            mudarFiltro({ status });
            // Status de encerrado só existe fora da visão de pendências.
            if (status && !chamadoAtivo(status) && visao === "pendentes") setVisao("todos");
          }}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os status</SelectItem>
              {Object.entries(STATUS_CHAMADO).map(([k, s]) => <SelectItem key={k} value={k}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtros.responsavel || TODOS} onValueChange={(v) => mudarFiltro({ responsavel: v === TODOS ? "" : v })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os responsáveis</SelectItem>
              <SelectItem value="sem">Sem responsável</SelectItem>
              {opcoesResponsavel.map((r) => <SelectItem key={r.id} value={r.id}>{r.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtros.modulo || TODOS} onValueChange={(v) => mudarFiltro({ modulo: v === TODOS ? "" : v })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Módulo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os módulos</SelectItem>
              {opcoesModulo.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtros.prioridade || TODOS} onValueChange={(v) => mudarFiltro({ prioridade: v === TODOS ? "" : v })}>
            <SelectTrigger className="h-9"><SelectValue placeholder="Prioridade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as prioridades</SelectItem>
              {Object.entries(PRIORIDADES).map(([k, p]) => <SelectItem key={k} value={k}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtros.campoData} onValueChange={(v) => mudarFiltro({ campoData: v as FiltrosMeusChamados["campoData"] })}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="abertura">Data de abertura</SelectItem>
              <SelectItem value="conclusao">Data de conclusão</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 sm:col-span-2 lg:col-span-2 2xl:col-span-1">
            <Input type="date" value={filtros.de} onChange={(e) => mudarFiltro({ de: e.target.value })} className="h-9 px-2 text-xs" title="De" />
            <Input type="date" value={filtros.ate} onChange={(e) => mudarFiltro({ ate: e.target.value })} className="h-9 px-2 text-xs" title="Até" />
          </div>
        </div>
        {filtrosAtivos(filtros) && (
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{filtrados.length} chamado(s) com esses filtros</span>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => mudarFiltro(FILTROS_VAZIOS)}>
              <FilterX className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
        )}

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : chamados.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Você ainda não abriu chamados. Clique em <b>Abrir Novo Chamado</b>.</p>
        ) : filtrados.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {visao === "pendentes" && !filtrosAtivos(filtros)
              ? <p>Nenhum chamado com pendência. Tudo em dia!</p>
              : <p>Nenhum chamado encontrado.</p>}
            {visao === "pendentes" && qtdHistorico > 0 && (
              <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => mudarVisao("historico")}>
                <Archive className="h-4 w-4" /> Mostrar chamados já concluídos ({qtdHistorico})
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* Células compactas (como os painéis): com o padding padrão a
                tabela tinha 1.530 px num card de 1.060 e saía para o lado. */}
            <Table className="[&_td]:px-2 [&_td]:py-2.5 [&_th]:px-2">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center leading-tight">Posição<br />na fila</TableHead>
                  <TableHead>Nº do chamado</TableHead>
                  <TableHead>Assunto</TableHead>
                  <TableHead>Módulo / Sistema</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Prazo previsto</TableHead>
                  <TableHead>Abertura</TableHead>
                  {/* Só em tela larga — a observação também aparece no acompanhamento. */}
                  <TableHead className="hidden 2xl:table-cell">Observação do gerente</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.map((c) => {
                  const aguardando = c.status === "aguardando_retorno";
                  return (
                  <TableRow
                    key={c.id}
                    className={`cursor-pointer ${aguardando ? "bg-primary/5 hover:bg-primary/10" : ""}`}
                    onClick={() => nav(`${base}/${c.id}/acompanhar`)}
                  >
                    <TableCell className="text-center">
                      {posicoes[c.id] ? (
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                            c.prioridade === "alta" ? "bg-destructive/15 text-destructive"
                            : c.prioridade === "media" ? "bg-warning/15 text-warning"
                            : "bg-success/15 text-success"
                          }`}
                          title={`Fila por ordem de abertura · prioridade ${c.prioridade}`}
                        >
                          {posicoes[c.id]}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">#{c.numero}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm" title={c.assunto}>
                      {c.assunto}
                      {aguardando && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-primary">
                          <MessageSquarePlus className="h-3 w-3" /> Adicionar mais informações
                        </span>
                      )}
                      {/* Encerrado que voltou à lista por causa da conversa. */}
                      {motivos[c.id] === "mensagem_nova" && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-destructive">
                          <MessageCircle className="h-3 w-3" /> Mensagem nova no chat
                        </span>
                      )}
                      {motivos[c.id] === "respondeu" && (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-info">
                          <MessageCircle className="h-3 w-3" /> Você respondeu — aguardando retorno
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{moduloLabel(c)}</TableCell>
                    <TableCell><PrioridadeBadge prioridade={c.prioridade} /></TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={c.status} />
                        <SeloDesenvolvimento chamado={c} />
                        {avaliacaoLiberada(validacoes[c.id]).liberada && <SeloConfirmacao chamado={c} paraSolicitante />}
                        <SeloEtapaValidacao v={validacoes[c.id]} compacto />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{nomeDe(c.responsavel_id)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{c.prazo_conclusao_em ? fmtData(c.prazo_conclusao_em) : fmtData(c.prazo_previsto)}</TableCell>
                    <TableCell className="min-w-[78px] text-xs text-muted-foreground">{fmtDataHora(c.created_at)}</TableCell>
                    <TableCell className="hidden max-w-[200px] truncate text-xs text-muted-foreground 2xl:table-cell" title={c.observacao_gerente ?? ""}>
                      {c.observacao_gerente
                        || (c.status === "reprovado" && c.motivo_reprovacao ? c.motivo_reprovacao
                        : c.status === "cancelado" && c.motivo_cancelamento ? `Cancelado: ${c.motivo_cancelamento}` : "—")}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="ml-auto flex max-w-[220px] flex-wrap items-center justify-end gap-1">
                      <BotaoStatusChamado chamado={c} validacao={validacoes[c.id] ?? null} nomeDe={nomeDe} />
                      <BotaoChatChamado
                        chamado={c}
                        perfil="solicitante"
                        naoLidos={naoLidos[c.id] ?? 0}
                        responsavelNome={nomeDe(c.responsavel_id)}
                      />
                      {(motivos[c.id] === "mensagem_nova" || motivos[c.id] === "respondeu") && (
                        <Button variant="outline" size="sm" onClick={() => marcarVisto(c)}
                          title="Tira o chamado da lista de pendências — ele volta se chegar mensagem nova"
                          className="h-8 gap-1.5 transition-transform active:scale-90">
                          <Eye className="h-3.5 w-3.5" /> Marcar como visto
                        </Button>
                      )}
                      {c.status === "cancelado" ? null : c.status !== "concluido" ? (
                        <Button variant="ghost" size="sm" disabled className="h-8 cursor-not-allowed gap-1.5 text-muted-foreground/60">
                          <Lock className="h-3.5 w-3.5" /> Avaliar
                        </Button>
                      ) : podeConfirmarConclusao(c, validacoes[c.id], user?.id) ? (
                        // O time concluiu: o solicitante confirma antes de avaliar (mig 20261028001300).
                        <Button size="sm" onClick={() => setConfirmarAlvo(c)}
                          className="h-8 gap-1.5 transition-transform active:scale-90">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Confirmar conclusão
                        </Button>
                      ) : !avaliacaoLiberada(validacoes[c.id]).liberada ? (
                        // Presidência validando (mig 273): a avaliação abre depois que ela aprovar.
                        <Button variant="ghost" size="sm" disabled
                          title="Aguardando a validação da Presidência — a avaliação abre depois que ela aprovar"
                          className="h-8 cursor-not-allowed gap-1.5 text-muted-foreground/60">
                          <Lock className="h-3.5 w-3.5" /> Avaliar
                        </Button>
                      ) : pendentesIds.has(c.id) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAvaliarAlvo({ id: c.id, numero: c.numero })}
                          className="h-8 gap-1.5 border-warning/50 text-warning transition-transform hover:bg-warning/10 active:scale-90"
                        >
                          <Star className="h-3.5 w-3.5" /> Avaliar
                        </Button>
                      ) : (
                        <span className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Avaliado
                        </span>
                      )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs text-muted-foreground">Mostrando {de} a {ate} de {filtrados.length} chamados</p>
                {visao === "pendentes" && qtdHistorico > 0 && (
                  <Button variant="link" size="sm" className="h-7 gap-1 px-1 text-xs" onClick={() => mudarVisao("historico")}>
                    <Archive className="h-3.5 w-3.5" /> Mostrar chamados já concluídos ({qtdHistorico})
                  </Button>
                )}
              </div>
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
            <p className="text-xs font-medium">Segunda a Sexta-feira · 8h às 12h e 13h às 17h</p>
            <p className="text-xs text-muted-foreground">Chamados fora do horário serão avaliados no próximo dia útil.</p>
          </Card>
        </div>
        <FeedAtualizacoes scope="solicitante" buildHref={(cid) => `${base}/${cid}/acompanhar`} />
      </div>

      <ConfirmarConclusaoDialog
        open={!!confirmarAlvo}
        onOpenChange={(v) => { if (!v) setConfirmarAlvo(null); }}
        chamado={confirmarAlvo}
        onConfirmado={() => confirmarAlvo && setAvaliarAlvo({ id: confirmarAlvo.id, numero: confirmarAlvo.numero })}
      />

      <AvaliarChamadoDialog
        open={!!avaliarAlvo}
        onOpenChange={(v) => { if (!v) setAvaliarAlvo(null); }}
        chamado={avaliarAlvo}
        comoParticipante={!!avaliarAlvo?.participante}
      />
    </div>
  );
}
