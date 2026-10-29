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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import {
  AlertTriangle, ArrowDown, ArrowRight, ArrowUp, ArrowUpDown, CalendarCheck, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Columns2, Copy, FileText, Filter, GitPullRequest, GraduationCap, Info, LayoutDashboard, Layers, MessageSquare,
  MoreVertical, PlayCircle, Plus, RotateCcw, Search, Settings, ShieldAlert, Star, Trophy, XCircle,
} from "lucide-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { useChamadosNaoLidos } from "./BotaoChatChamado";
import { ReabrirChamadoDialog } from "./ReabrirChamadoDialog";
import { IniciarDesenvolvimentoDialog, type ModoPrazo } from "./IniciarDesenvolvimentoDialog";
import { abrirPrGithub } from "./abrirPrGithub";
import { conclusaoAguardandoConfirmacao } from "./validacaoPresidencia";
import { ResumoParecerIaLinha, useResumosParecerIa } from "./ParecerIaChamado";
import {
  STATUS_PAINEL, mudouNaFila, rotuloPrazo, diasUteisAte, podeDefinirPrazo, podeIniciarDesenvolvimento, projetarPrevisoes,
  situacaoPrazo, statusPainel, variacaoPercentual, type SituacaoPrazo, type StatusPainel,
} from "@/lib/chamados/prazoDesenvolvimento";
import {
  StatCard, PRIORIDADES, Estrelas, iniciais, fmtData, moduloLabel,
  chamadoAtivo, podeReabrirChamado, posicoesFilaDev, CRITERIOS_AVALIACAO, mediaAvaliacao, type Chamado,
} from "./types";

// =====================================================================
// PAINEL DO DESENVOLVEDOR — layout do mockup do chamado SIS-2026-0763
// (28/10/2026). Pedido do Pablo: "preciso que o frontend fique EXATAMENTE
// igual o da imagem, e mude um pouco as regras, o solicitante manda já com o
// prazo esperado, e o desenvolvedor manda com o prazo real de desenvolvimento
// ao iniciar o chamado."
//
//   · Prazo do Solicitante = prazo_solicitante (informado ao abrir, mig 20261028001420).
//   · Prazo* = prazo REAL do dev, em horas, dias úteis ou semanas (mig
//     20261028001900), informado ao INICIAR
//     (chamado_iniciar_desenvolvimento) e travado depois — só redefine quando
//     a tarefa desce na fila (chamado_definir_prazo, mig 20261028001410).
//   · Previsão de entrega / Situação do prazo / Fila: src/lib/chamados/
//     prazoDesenvolvimento.ts (as mesmas regras do banco).
// Abaixo dos 4 cards explicativos fica o bloco "Minha satisfação" que já
// existia — o mockup não mostra, mas a função continua.
// =====================================================================

const ATIVO = (s: string) => chamadoAtivo(s);
const POR_PAGINA = [10, 20, 50];

// Visões do botão Filtros. A padrão é a fila + o que concluí e o solicitante
// ainda não confirmou (Pablo, 29/10/2026: "os concluídos não precisam
// aparecer aqui, apenas os que ainda não foram concluídos pelo solicitante").
// O confirmado sai da lista padrão e continua na visão "Concluídos".
const VISOES = [
  { key: "fila_mes", label: "Minha fila + aguardando confirmação" },
  { key: "ativos", label: "Só a minha fila" },
  { key: "concluidos", label: "Concluídos" },
  { key: "todos", label: "Todos" },
] as const;

const COR_PRIORIDADE: Record<string, { pill: string; dot: string; barra: string }> = {
  alta:  { pill: "border-destructive/30 bg-destructive/10 text-destructive", dot: "bg-destructive", barra: "bg-destructive" },
  media: { pill: "border-warning/40 bg-warning/10 text-warning",             dot: "bg-warning",     barra: "bg-warning" },
  baixa: { pill: "border-info/30 bg-info/10 text-info",                      dot: "bg-info",        barra: "bg-info" },
};

// Situação do prazo como o mockup desenha: 4 estados (o concluído ganha
// "no prazo / com atraso" embaixo, que é a regra B do chamado).
type SituacaoTela = "no_prazo" | "risco" | "atrasado" | "concluido";
const SITUACAO_TELA: Record<SituacaoTela, { label: string; cls: string; barra: string; icon: typeof CheckCircle2 }> = {
  no_prazo:  { label: "No prazo",  cls: "border-success/30 bg-success/10 text-success",            barra: "bg-success",     icon: CheckCircle2 },
  risco:     { label: "Risco",     cls: "border-warning/40 bg-warning/10 text-warning",            barra: "bg-warning",     icon: Clock },
  atrasado:  { label: "Atrasado",  cls: "border-destructive bg-destructive text-destructive-foreground", barra: "bg-destructive", icon: XCircle },
  concluido: { label: "Concluído", cls: "border-success/30 bg-success/10 text-success",            barra: "bg-slate-500",   icon: CheckCircle2 },
};
const paraTela = (s: SituacaoPrazo | null): SituacaoTela | null =>
  s === "no_prazo" || s === "risco" || s === "atrasado" ? s
  : s === "concluido_no_prazo" || s === "concluido_atraso" || s === "concluido" ? "concluido" : null;

/** "#0763" no lugar de "#SIS-2026-0763", como o mockup; o número completo vai no title. */
const numeroCurto = (n: string) => n.split("-").pop() ?? n;

// Métricas da PR que concluiu o chamado (SIS-2026-0765).
interface MetricasGithubConclusao {
  commits: number | null;
  linhasAdicionadas: number | null;
  arquivosAlterados: number | null;
}

interface EventoGithubConclusao {
  chamado_id: string;
  meta: Record<string, unknown> | null;
}

const numeroDaMetrica = (valor: unknown) =>
  typeof valor === "number" && Number.isSafeInteger(valor) && valor >= 0 ? valor : null;

export default function PainelDesenvolvedor() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { data: access } = useAccessibleMenus("visualizar");
  const { canCoordenar, canAprovar, gestor } = useChamadoPerms();
  const dev = access?.codes.has("chamados_sistemas_dev") ?? false;
  const podeEditarPrioridade = canCoordenar || gestor; // gerência troca a prioridade na fila

  const [visao, setVisao] = useState<string>("fila_mes");
  const [soDesceram, setSoDesceram] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<string>("todos");
  const [filtroPrioridade, setFiltroPrioridade] = useState<string>("todas");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(10);
  const [filaPrioridadeAberta, setFilaPrioridadeAberta] = useState(false);
  const [reabrir, setReabrir] = useState<Chamado | null>(null);
  // Iniciar (com o prazo real) ou ajustar o prazo quando a posição na fila mudou.
  const [prazoAlvo, setPrazoAlvo] = useState<{ chamado: Chamado; modo: ModoPrazo } | null>(null);

  // Abriu o Painel do Desenvolvedor → zera a bolinha de novidades do dev.
  useEffect(() => { chamadosMarkSeen(user?.id, "dev"); }, [user?.id]);

  const { data: chamados = [], isLoading } = useQuery({
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

  // Parecer da I.A (mig 20261029000900): valor médio + complexidade na linha.
  const pareceresIa = useResumosParecerIa(!!user?.id && dev);

  // A conclusão automática registra as métricas da PR como meta do evento
  // (SIS-2026-0765). A consulta fica separada da lista de chamados para não
  // carregar toda a conversa de cada item apenas para montar esta linha.
  const { data: metricasGithub = {} } = useQuery({
    queryKey: ["chamados-metricas-github", user?.id],
    enabled: !!user?.id && dev,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA_EVENTO")
        .select("chamado_id, meta, created_at")
        .eq("tipo", "evento")
        .contains("meta", { canal: "github", origem: "merge" })
        .order("created_at", { ascending: false });
      if (error) throw error;

      return (data ?? []).reduce((porChamado: Record<string, MetricasGithubConclusao>, evento: EventoGithubConclusao) => {
        if (porChamado[evento.chamado_id]) return porChamado;
        const meta = (evento.meta ?? {}) as Record<string, unknown>;
        porChamado[evento.chamado_id] = {
          commits: numeroDaMetrica(meta.pr_commits),
          linhasAdicionadas: numeroDaMetrica(meta.pr_linhas_adicionadas),
          arquivosAlterados: numeroDaMetrica(meta.pr_arquivos_alterados),
        };
        return porChamado;
      }, {});
    },
  });

  // Chamados em que eu sou PARTICIPANTE EXTRA (20/10/2026): entram na lista
  // com a etiqueta "Participante", mas NÃO na fila nem nas contagens — a fila
  // e os números são do responsável. A RLS já deixa o participante ver o
  // chamado (mig 20261009000003).
  const { data: participando = [] } = useQuery({
    queryKey: ["chamados-participando", user?.id],
    enabled: !!user?.id && dev,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("CHAMADO_SISTEMA")
        .select("*, CHAMADO_SISTEMA_PARTICIPANTE!inner(user_id)")
        .eq("CHAMADO_SISTEMA_PARTICIPANTE.user_id", user!.id)
        .order("updated_at", { ascending: false });
      if (error) return [] as Chamado[];   // sem a tabela de participantes: segue só com os meus
      return ((data ?? []) as Array<Chamado & { CHAMADO_SISTEMA_PARTICIPANTE?: unknown }>)
        .map(({ CHAMADO_SISTEMA_PARTICIPANTE: _p, ...c }) => c as Chamado);
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

  const { data: naoLidos = {} } = useChamadosNaoLidos();

  // Treinamentos que o dev deve ENVIAR (mig 273): a Presidência aprovou o
  // desenvolvimento que ele concluiu e falta ele escolher quem recebe.
  const { data: treinamentosPendentes = [] } = useQuery({
    queryKey: ["chamado-validacoes", "treinamento-dev", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("CHAMADO_SISTEMA_VALIDACAO")
        .select("chamado_id, CHAMADO_SISTEMA!inner(numero, assunto)")
        .eq("etapa", "treinamento")
        .eq("desenvolvedor_id", user!.id)
        .is("treinamento_dev_em", null);
      return ((data ?? []) as Array<{ chamado_id: string; CHAMADO_SISTEMA: { numero: string; assunto: string } }>);
    },
  });

  // Ranking de satisfação da equipe (nota final ponderada + médias por critério).
  const { data: ranking = [] } = useQuery({
    queryKey: ["chamados-ranking-satisfacao"],
    enabled: dev,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_ranking_satisfacao");
      return (data ?? []) as Array<{
        responsavel_id: string; avaliacoes: number; media: number;
        qualidade: number; prazo: number; comunicacao: number; clareza: number; facilidade: number; satisfacao: number;
      }>;
    },
  });

  // Avaliações individuais recebidas por este dev (card ao passar o mouse).
  const { data: minhasAvaliacoes = [] } = useQuery({
    queryKey: ["chamados-minhas-avaliacoes", user?.id],
    enabled: !!user?.id && dev,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("CHAMADO_SISTEMA_AVALIACAO")
        .select("qualidade,prazo,comunicacao,clareza,facilidade,satisfacao,comentario,created_at,CHAMADO_SISTEMA!inner(numero,solicitante_id,responsavel_id)")
        .eq("CHAMADO_SISTEMA.responsavel_id", user!.id)
        .order("created_at", { ascending: false });
      return (data ?? []) as Array<{
        qualidade: number; prazo: number; comunicacao: number; clareza: number; facilidade: number; satisfacao: number;
        comentario: string | null; created_at: string;
        CHAMADO_SISTEMA: { numero: string; solicitante_id: string } | null;
      }>;
    },
  });

  // Só o MEU ranking aparece: minha colocação na equipe + as minhas médias.
  const minhaSatisfacao = useMemo(() => {
    const i = ranking.findIndex((r) => r.responsavel_id === user?.id);
    if (i === -1) return null;
    const r = ranking[i];
    return {
      posicao: i + 1,
      devs: ranking.length,
      total: Number(r.avaliacoes),
      media: Number(r.media),
      itens: CRITERIOS_AVALIACAO.map((c) => ({ label: c.titulo, v: Number((r as any)[c.key]) })),
    };
  }, [ranking, user?.id]);

  // ---- Fila, previsões e situação ---------------------------------------
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const mesIni = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const posicaoMinhaFila = useMemo(() => posicoesFilaDev(chamados), [chamados]);
  const soParticipante = useMemo(() => {
    const meus = new Set(chamados.map((c) => c.id));
    return participando.filter((c) => !meus.has(c.id));
  }, [chamados, participando]);
  const idsParticipante = useMemo(() => new Set(soParticipante.map((c) => c.id)), [soParticipante]);
  const previsoes = useMemo(() => projetarPrevisoes(chamados), [chamados]);
  const situacoes = useMemo(() => {
    const m: Record<string, SituacaoPrazo | null> = {};
    [...chamados, ...soParticipante].forEach((c) => { m[c.id] = situacaoPrazo(c, previsoes[c.id]); });
    return m;
  }, [chamados, soParticipante, previsoes]);
  // Posição na fila mudou (subiu ou desceu) desde que o prazo foi definido:
  // o dev pode ajustar o prazo (mig 20261028001900).
  const desceram = useMemo(() => chamados.filter((c) => mudouNaFila(c)), [chamados]);
  const concluidoNoMes = (c: Chamado) => c.status === "concluido" && !!c.concluido_em && new Date(c.concluido_em) >= mesIni;

  // Base dos painéis laterais: a minha fila + o que concluí no mês.
  const base = useMemo(() => chamados.filter((c) => ATIVO(c.status) || concluidoNoMes(c)), [chamados]);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return [...chamados, ...soParticipante]
      .filter((c) =>
        visao === "fila_mes" ? ATIVO(c.status) || conclusaoAguardandoConfirmacao(c)
        : visao === "ativos" ? ATIVO(c.status)
        : visao === "concluidos" ? !ATIVO(c.status)
        : true)
      .filter((c) => !soDesceram || mudouNaFila(c))
      .filter((c) => filtroStatus === "todos" || statusPainel(c) === filtroStatus)
      .filter((c) => filtroPrioridade === "todas" || c.prioridade === filtroPrioridade)
      .filter((c) => !termo || [c.numero, c.assunto, c.solicitante_nome, c.setor].some((v) => (v ?? "").toLowerCase().includes(termo)))
      .sort((a, b) => {
        const pa = posicaoMinhaFila[a.id], pb = posicaoMinhaFila[b.id];
        if (pa && pb) return pa - pb;
        if (pa) return -1;
        if (pb) return 1;
        return +new Date(b.concluido_em ?? b.updated_at) - +new Date(a.concluido_em ?? a.updated_at);
      });
  }, [chamados, soParticipante, visao, soDesceram, filtroStatus, filtroPrioridade, busca, posicaoMinhaFila]);

  useEffect(() => { setPagina(1); }, [visao, soDesceram, filtroStatus, filtroPrioridade, busca, porPagina]);
  const totalPaginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = lista.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina);
  const de = lista.length === 0 ? 0 : (paginaAtual - 1) * porPagina + 1;
  const ate = Math.min(paginaAtual * porPagina, lista.length);

  // ---- KPIs --------------------------------------------------------------
  const stats = useMemo(() => {
    const ativos = chamados.filter((c) => ATIVO(c.status));
    // Prazo médio de entrega: dias úteis do início do desenvolvimento até a
    // conclusão — últimos 30 dias contra os 30 anteriores (a setinha).
    const media = (de: Date, ate: Date) => {
      const xs = chamados
        .filter((c) => c.status === "concluido" && c.desenvolvimento_iniciado_em && c.concluido_em
          && new Date(c.concluido_em) >= de && new Date(c.concluido_em) < ate)
        .map((c) => Math.max(0, diasUteisAte(new Date(c.desenvolvimento_iniciado_em!), new Date(c.concluido_em!))));
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    const amanha = new Date(hoje); amanha.setDate(amanha.getDate() + 1);
    const d30 = new Date(hoje); d30.setDate(d30.getDate() - 30);
    const d60 = new Date(hoje); d60.setDate(d60.getDate() - 60);
    const atual = media(d30, amanha);
    return {
      abertos: ativos.length,
      em_andamento: chamados.filter((c) => c.status === "em_andamento").length,
      aguardando: chamados.filter((c) => c.status === "aguardando_retorno").length,
      concluidos_mes: chamados.filter(concluidoNoMes).length,
      atrasados: ativos.filter((c) => situacoes[c.id] === "atrasado").length,
      prazo_medio: atual,
      variacao: variacaoPercentual(atual, media(d60, d30)),
    };
  }, [chamados, situacoes]);

  // ---- Painéis laterais --------------------------------------------------
  const statusResumo = useMemo(() => {
    const ordem: StatusPainel[] = ["em_desenvolvimento", "em_analise", "aguardando_retorno", "concluido"];
    const m: Partial<Record<StatusPainel, number>> = {};
    base.forEach((c) => { const s = statusPainel(c); m[s] = (m[s] ?? 0) + 1; });
    return ordem.map((s) => ({ status: s, value: m[s] ?? 0 }));
  }, [base]);
  const totalStatus = statusResumo.reduce((a, b) => a + b.value, 0);

  const prioridades = useMemo(() => {
    const ativos = chamados.filter((c) => ATIVO(c.status));
    return (["alta", "media", "baixa"] as const).map((p) => ({ p, n: ativos.filter((c) => c.prioridade === p).length }));
  }, [chamados]);
  const maxPrioridade = Math.max(1, ...prioridades.map((x) => x.n));

  const situacaoResumo = useMemo(() => {
    const m: Record<SituacaoTela, number> = { no_prazo: 0, risco: 0, atrasado: 0, concluido: 0 };
    base.forEach((c) => { const s = paraTela(situacoes[c.id]); if (s) m[s]++; });
    return m;
  }, [base, situacoes]);
  const maxSituacao = Math.max(1, ...Object.values(situacaoResumo));

  // Fila por prioridade (botão do cabeçalho): ativos agrupados, na ordem da fila.
  const filaPorPrioridade = useMemo(() => {
    const ativos = chamados.filter((c) => ATIVO(c.status))
      .sort((a, b) => (posicaoMinhaFila[a.id] ?? 999) - (posicaoMinhaFila[b.id] ?? 999));
    return (["alta", "media", "baixa"] as const).map((p) => ({ p, itens: ativos.filter((c) => c.prioridade === p) }));
  }, [chamados, posicaoMinhaFila]);

  const mudarPrioridade = async (id: string, prioridade: string, numero: string) => {
    const { error } = await (supabase as any).from("CHAMADO_SISTEMA").update({ prioridade }).eq("id", id);
    if (error) { toast({ title: "Erro ao alterar prioridade", description: error.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: id, tipo: "evento", texto: `Prioridade alterada para ${PRIORIDADES[prioridade]?.label ?? prioridade}`,
    });
    toast({ title: `Prioridade do #${numero} → ${PRIORIDADES[prioridade]?.label ?? prioridade}` });
    qc.invalidateQueries({ queryKey: ["chamados-meus-atribuidos", user?.id] });
  };

  if (!dev) {
    return (
      <div>
        <PageHeader title="Painel do Desenvolvedor" module="Sistemas" breadcrumb={["Central de Chamados", "Painel do Desenvolvedor"]} />
        <Card className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-warning" />
          Acesso restrito a desenvolvedores. Peça a liberação de <b>Chamados — Painel do Desenvolvedor</b> em Acesso por Usuário.
        </Card>
      </div>
    );
  }

  const PrioridadePill = ({ c }: { c: Chamado }) => {
    const cor = COR_PRIORIDADE[c.prioridade] ?? COR_PRIORIDADE.media;
    const pill = (
      <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${cor.pill}`}>
        {c.prioridade === "alta" && <span className={`h-1.5 w-1.5 rounded-full ${cor.dot}`} />}
        {PRIORIDADES[c.prioridade]?.label ?? c.prioridade}
      </span>
    );
    if (!(podeEditarPrioridade && ATIVO(c.status))) return pill;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <button title="Trocar a prioridade (gerência)">{pill}</button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          {(["alta", "media", "baixa"] as const).map((p) => (
            <DropdownMenuItem key={p} onClick={() => mudarPrioridade(c.id, p, c.numero)}>{PRIORIDADES[p].label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <TooltipProvider delayDuration={150}>
    <div>
      <PageHeader
        title="Painel do Desenvolvedor"
        subtitle="Acompanhe suas solicitações, prazos, prioridades e status de desenvolvimento."
        module="Sistemas"
        breadcrumb={["Central de Chamados", "Painel do Desenvolvedor"]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFilaPrioridadeAberta(true)} className="gap-1.5">
              <Copy className="h-4 w-4" /> Ver Fila por Prioridade
            </Button>
            <Button onClick={() => nav("/app/sistemas/chamados/dev/dashboard")} className="gap-1.5">
              <LayoutDashboard className="h-4 w-4" /> Meu Dashboard
            </Button>
          </div>
        }
      />

      {treinamentosPendentes.length > 0 && (
        <Card className="mb-4 space-y-2 border-primary/40 bg-primary/5 p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <GraduationCap className="h-4 w-4" /> A Presidência aprovou {treinamentosPendentes.length} desenvolvimento(s) seu(s) — envie o treinamento, escolhendo quem vai recebê-lo.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {treinamentosPendentes.map((t) => (
              <button key={t.chamado_id} onClick={() => nav(`/app/sistemas/chamados/${t.chamado_id}`)} title={t.CHAMADO_SISTEMA?.assunto}
                className="flex items-center gap-1 rounded border border-primary/40 bg-background px-2 py-1 text-xs transition-transform hover:border-primary hover:bg-primary/5 active:scale-90">
                <GraduationCap className="h-3 w-3 text-primary" /> <span className="font-mono font-semibold">#{t.CHAMADO_SISTEMA?.numero}</span> enviar
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* KPIs */}
      {/* 6 cards numa linha só a partir de 1536 px — abaixo disso os rótulos cortavam. */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard icon={CalendarCheck} tone="primary" label="Meus chamados abertos" value={stats.abertos} />
        <StatCard icon={Clock} tone="info" label="Em andamento" value={stats.em_andamento} />
        <StatCard icon={Layers} tone="muted" label="Aguardando retorno" value={stats.aguardando} />
        <StatCard icon={CheckCircle2} tone="success" label="Concluídos (mês)" value={stats.concluidos_mes} />
        <StatCard icon={AlertTriangle} tone="destructive" label="Atrasados" value={stats.atrasados} />
        <Card className="flex items-center gap-3 p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-info/10 text-info">
            <Columns2 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">Prazo médio de entrega</p>
            <p className="mt-1 flex items-center gap-2 text-xl font-bold leading-none">
              {stats.prazo_medio != null ? `${stats.prazo_medio.toFixed(1).replace(".", ",")} dias` : "—"}
              {stats.variacao != null && (
                <span title="Últimos 30 dias contra os 30 anteriores"
                  className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-semibold ${stats.variacao <= 0 ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  <ArrowRight className="h-3 w-3" /> {stats.variacao > 0 ? "+" : ""}{stats.variacao}%
                </span>
              )}
            </p>
          </div>
        </Card>
      </div>

      {/* Os painéis laterais só ficam ao lado da tabela em tela larga; abaixo
          de 1536 px descem para baixo dela (3 lado a lado) e a tabela de 13
          colunas fica com a largura toda. */}
      <div className="grid items-start gap-4 2xl:grid-cols-[minmax(0,1fr)_260px]">
        {/* Tabela */}
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-sm font-bold">Meus chamados atribuídos ({lista.length})</p>
            {desceram.length > 0 && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{desceram.length} tarefa(s) mudou(aram) de posição na fila. Revise e ajuste o prazo, se necessário.</span>
                <Button size="sm" variant="outline" className="h-7 border-destructive/50 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setSoDesceram((v) => !v)}>
                  {soDesceram ? "Ver todas" : "Ver tarefas"}
                </Button>
              </div>
            )}
            <Button size="sm" className="h-8 gap-1.5 bg-info text-info-foreground hover:bg-info/90" onClick={() => nav("/app/central-servicos/chamados/novo")}>
              <Plus className="h-3.5 w-3.5" /> Adicionar Solicitação
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1.5">
                  <Filter className="h-3.5 w-3.5" /> Filtros
                  {(visao !== "fila_mes" || filtroStatus !== "todos" || filtroPrioridade !== "todas") && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-3">
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mostrar</p>
                  <Select value={visao} onValueChange={setVisao}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{VISOES.map((v) => <SelectItem key={v.key} value={v.key}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</p>
                  <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      {(Object.keys(STATUS_PAINEL) as StatusPainel[]).map((s) => <SelectItem key={s} value={s}>{STATUS_PAINEL[s].label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Prioridade</p>
                  <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todas">Todas</SelectItem>
                      <SelectItem value="alta">Alta</SelectItem>
                      <SelectItem value="media">Média</SelectItem>
                      <SelectItem value="baixa">Baixa</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-full text-xs"
                  onClick={() => { setVisao("fila_mes"); setFiltroStatus("todos"); setFiltroPrioridade("todas"); setSoDesceram(false); }}>
                  Limpar filtros
                </Button>
              </PopoverContent>
            </Popover>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar chamado..." className="h-8 w-44 pl-8 text-xs" />
            </div>
          </div>

          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="[&_td]:px-1.5 [&_td]:py-2.5 [&_th]:h-10 [&_th]:px-1.5 [&_th]:text-[11px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Prior.</TableHead>
                    <TableHead>Chamado / Assunto</TableHead>
                    <TableHead>Solicitante / Setor</TableHead>
                    <TableHead>Módulo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center leading-tight">Prazo do<br />Solicitante</TableHead>
                    <TableHead className="text-center" title="Prazo real do desenvolvedor — horas, dias úteis ou semanas. Obrigatório para iniciar.">
                      Prazo <span className="text-destructive">*</span>
                    </TableHead>
                    <TableHead>Início Dev.</TableHead>
                    <TableHead className="leading-tight">
                      <span className="inline-flex items-center gap-1">Previsão de<br />entrega
                        <Tooltip><TooltipTrigger asChild><Info className="h-3 w-3 shrink-0" /></TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">Início + prazo em dias úteis. Antes de iniciar: projeção depois das tarefas da frente da fila.</TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead>
                      <span className="inline-flex items-center gap-1">Situação do prazo
                        <Tooltip><TooltipTrigger asChild><Info className="h-3 w-3 shrink-0" /></TooltipTrigger>
                          <TooltipContent className="max-w-xs text-xs">No prazo, Risco (vence hoje ou no próximo dia útil), Atrasado (passou da previsão) ou Concluído (no prazo / com atraso).</TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <TableHead className="text-center">Fila</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((c, i) => {
                    const prev = previsoes[c.id];
                    const sitRaw = situacoes[c.id];
                    const sit = paraTela(sitRaw);
                    const desceu = mudouNaFila(c);                 // mudou de posição (subiu ou desceu)
                    const subiu = desceu && (c.posicao_dev ?? 0) < (c.prazo_posicao_fila ?? 0);
                    const participante = idsParticipante.has(c.id);
                    const ehMeu = !participante && (c.responsavel_id === user?.id || canCoordenar || canAprovar);
                    const st = statusPainel(c);
                    const SitIcon = sit ? SITUACAO_TELA[sit].icon : null;
                    const iniciar = ehMeu && podeIniciarDesenvolvimento(c);
                    const metricas = metricasGithub[c.id];
                    return (
                      <TableRow key={c.id} className={`cursor-pointer ${desceu ? "bg-destructive/5 hover:bg-destructive/10" : ""}`}
                        onClick={() => nav(`/app/sistemas/chamados/${c.id}`)}>
                        <TableCell className="whitespace-nowrap font-mono text-[11px] font-semibold" title={c.numero}>#{numeroCurto(c.numero)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}><PrioridadePill c={c} /></TableCell>
                        <TableCell className="min-w-[150px] max-w-[260px]">
                          <p className="line-clamp-3 text-xs" title={c.assunto}>{c.assunto}</p>
                          <ResumoParecerIaLinha resumo={pareceresIa[c.id]} />
                          {metricas && (
                            <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] font-medium text-muted-foreground">
                              <GitPullRequest className="h-3 w-3 text-primary" /> GitHub: {metricas.commits ?? "—"} commits
                              <span>· +{metricas.linhasAdicionadas ?? "—"} linhas</span>
                              <span>· {metricas.arquivosAlterados ?? "—"} arquivos</span>
                            </p>
                          )}
                          {participante && (
                            <span className="mt-0.5 inline-block rounded border border-info/40 bg-info/10 px-1.5 py-px text-[9px] font-bold uppercase text-info"
                              title="Você foi incluído como participante — o responsável pela execução é outra pessoa">
                              Participante · resp.: {nomeDe(c.responsavel_id)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[150px] text-xs">
                          <p className="truncate" title={c.solicitante_nome ?? ""}>{c.solicitante_nome || "—"}</p>
                          {c.setor && <p className="truncate text-[10px] text-muted-foreground" title={c.setor}>{c.setor}</p>}
                        </TableCell>
                        <TableCell className="max-w-[90px] text-xs">{moduloLabel(c)}</TableCell>
                        <TableCell>
                          <span className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold leading-tight ${STATUS_PAINEL[st].cls}`}>{STATUS_PAINEL[st].label}</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-center text-xs">{c.prazo_solicitante ? fmtData(`${c.prazo_solicitante}T12:00:00`) : "—"}</TableCell>
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          {c.prazo_dias ? (
                            <button
                              disabled={!(desceu && ehMeu)}
                              onClick={() => setPrazoAlvo({ chamado: c, modo: "definir" })}
                              title={desceu ? "A posição na fila mudou: clique para ajustar o prazo" : "Prazo travado — só muda se a posição na fila mudar"}
                              className={`inline-flex h-8 min-w-14 items-center justify-center whitespace-nowrap rounded-md border bg-background px-2 text-xs font-semibold ${desceu && ehMeu ? "border-destructive text-destructive hover:bg-destructive/10" : "border-input"}`}>
                              {rotuloPrazo(c.prazo_dias, c.prazo_unidade)}
                            </button>
                          ) : iniciar ? (
                            <Button size="sm" variant="outline" className="h-8 gap-1 px-2 text-[11px]" onClick={() => setPrazoAlvo({ chamado: c, modo: "iniciar" })}
                              title="Informe o prazo real ao iniciar o desenvolvimento">
                              <PlayCircle className="h-3.5 w-3.5" /> Iniciar
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{c.desenvolvimento_iniciado_em ? fmtData(c.desenvolvimento_iniciado_em) : "—"}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {prev ? (
                            <span title={prev.projetada ? "Projeção pela fila (a tarefa ainda não começou)" : "Início + prazo"}>
                              {prev.data.toLocaleDateString("pt-BR")}{prev.projetada && <span className="text-muted-foreground">*</span>}
                              {prev.comHora && <span className="block text-[10px] text-muted-foreground">{prev.data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>}
                            </span>
                          ) : c.prazo_conclusao_em ? fmtData(c.prazo_conclusao_em) : "—"}
                        </TableCell>
                        <TableCell>
                          {sit && SitIcon ? (
                            <div className="flex flex-col items-start gap-0.5">
                              <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[10px] font-semibold ${SITUACAO_TELA[sit].cls}`}>
                                <SitIcon className="h-3 w-3" /> {SITUACAO_TELA[sit].label}
                              </span>
                              {sitRaw === "concluido_no_prazo" && <span className="text-[9px] font-medium text-success">dentro do prazo</span>}
                              {sitRaw === "concluido_atraso" && <span className="text-[9px] font-medium text-destructive">com atraso</span>}
                            </div>
                          ) : sitRaw === "sem_prazo" ? (
                            <span className="text-[10px] text-muted-foreground">Aguardando início</span>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-center text-xs font-semibold">
                          {desceu ? (
                            <span className={`inline-flex items-center gap-1 ${subiu ? "text-success" : "text-destructive"}`}>
                              {subiu ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />} {c.prazo_posicao_fila}º → {c.posicao_dev}º
                              <Tooltip><TooltipTrigger asChild><Info className="h-3 w-3" /></TooltipTrigger>
                                <TooltipContent className="text-xs">{subiu ? "Subiu" : "Desceu"} na fila desde que o prazo foi definido — dá para ajustar o prazo</TooltipContent>
                              </Tooltip>
                            </span>
                          ) : posicaoMinhaFila[c.id] ? `${posicaoMinhaFila[c.id]}º` : "—"}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {desceu && ehMeu ? (
                              <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => setPrazoAlvo({ chamado: c, modo: "definir" })}>
                                Ajustar prazo
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" onClick={() => nav(`/app/sistemas/chamados/${c.id}`)}>
                                <FileText className="h-3.5 w-3.5" /> Abrir
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="relative rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Mais ações">
                                  <MoreVertical className="h-4 w-4" />
                                  {(naoLidos[c.id] ?? 0) > 0 && <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-destructive" />}
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => nav(`/app/sistemas/chamados/${c.id}`)}><FileText className="mr-2 h-4 w-4" /> Abrir chamado</DropdownMenuItem>
                                {iniciar && (
                                  <DropdownMenuItem onClick={() => setPrazoAlvo({ chamado: c, modo: "iniciar" })}><PlayCircle className="mr-2 h-4 w-4" /> Iniciar desenvolvimento</DropdownMenuItem>
                                )}
                                {ehMeu && podeDefinirPrazo(c) && c.prazo_dias != null && (
                                  <DropdownMenuItem onClick={() => setPrazoAlvo({ chamado: c, modo: "definir" })}><CalendarDays className="mr-2 h-4 w-4" /> Ajustar prazo</DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => nav(`/app/sistemas/chamados/${c.id}`)}>
                                  <MessageSquare className="mr-2 h-4 w-4" /> Conversa{(naoLidos[c.id] ?? 0) > 0 ? ` (${naoLidos[c.id]} nova(s))` : ""}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={(e) => abrirPrGithub(c, e as never, user?.id, toast)}><GitPullRequest className="mr-2 h-4 w-4" /> Abrir PR no GitHub</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => nav("/app/sistemas/chamados/dev/github")}><GitPullRequest className="mr-2 h-4 w-4" /> Painel do GitHub</DropdownMenuItem>
                                {podeReabrirChamado(c, { canCoordenar, canAprovar, canDev: dev, userId: user?.id }) && (
                                  <DropdownMenuItem onClick={() => setReabrir(c)}><RotateCcw className="mr-2 h-4 w-4" /> Reabrir</DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <TableRow><TableCell colSpan={13} className="py-6 text-center text-sm text-muted-foreground">
                      {soDesceram ? "Nenhuma tarefa mudou de posição na fila." : "Nenhum chamado para mostrar."}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">Mostrando {de} a {ate} de {lista.length} registros</p>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={paginaAtual <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                {Array.from({ length: totalPaginas }, (_, k) => k + 1).slice(Math.max(0, paginaAtual - 3), Math.max(0, paginaAtual - 3) + 5).map((n) => (
                  <Button key={n} size="sm" variant={n === paginaAtual ? "default" : "ghost"} className="h-8 w-8 p-0 text-xs" onClick={() => setPagina(n)}>{n}</Button>
                ))}
                <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Itens por página:
                <Select value={String(porPagina)} onValueChange={(v) => setPorPagina(Number(v))}>
                  <SelectTrigger className="h-8 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{POR_PAGINA.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                </Select>
              </span>
            </div>
          </div>
        </Card>

        {/* Painéis laterais */}
        <div className="grid items-start gap-4 md:grid-cols-3 2xl:grid-cols-1">
          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Status dos meus chamados</p>
            <div className="relative h-36">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusResumo.filter((d) => d.value > 0)} dataKey="value" nameKey="status" cx="50%" cy="50%" innerRadius={42} outerRadius={62} paddingAngle={2} stroke="none">
                    {statusResumo.filter((d) => d.value > 0).map((d) => <Cell key={d.status} fill={STATUS_PAINEL[d.status].cor} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-3xl font-bold">{totalStatus}</span>
            </div>
            <div className="mt-1 space-y-1">
              {statusResumo.map((d) => (
                <div key={d.status} className="flex items-center justify-between text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: STATUS_PAINEL[d.status].cor }} />
                    {STATUS_PAINEL[d.status].label}
                  </span>
                  <span className="font-semibold">{d.value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Prioridades</p>
            <div className="space-y-2">
              {prioridades.map(({ p, n }) => (
                <div key={p} className="flex items-center gap-2 text-[11px]">
                  <span className="w-10">{PRIORIDADES[p].label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${COR_PRIORIDADE[p].barra}`} style={{ width: `${(n / maxPrioridade) * 100}%` }} />
                  </div>
                  <span className="w-4 text-right font-semibold">{n}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <p className="mb-2 text-sm font-bold">Situação dos prazos</p>
            <div className="space-y-2">
              {(Object.keys(SITUACAO_TELA) as SituacaoTela[]).map((k) => (
                <div key={k} className="flex items-center gap-2 text-[11px]">
                  <span className="flex w-20 items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${SITUACAO_TELA[k].barra}`} /> {SITUACAO_TELA[k].label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${SITUACAO_TELA[k].barra}`} style={{ width: `${(situacaoResumo[k] / maxSituacao) * 100}%` }} />
                  </div>
                  <span className="w-4 text-right font-semibold">{situacaoResumo[k]}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {/* Os 4 cards explicativos do mockup */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="flex gap-3 border-info/40 bg-info/5 p-4">
          <Settings className="h-9 w-9 shrink-0 text-info" />
          <div className="space-y-1.5 text-xs">
            <p className="text-sm font-bold text-info">Prazo – Obrigatório</p>
            <p className="text-muted-foreground">Campo obrigatório preenchido pelo desenvolvedor com o tempo necessário para executar a tarefa — em horas, dias úteis ou semanas.</p>
            <p className="text-info">Sem preencher, não é possível iniciar o desenvolvimento do chamado.</p>
          </div>
        </Card>
        <Card className="flex gap-3 border-warning/40 bg-warning/5 p-4">
          <CalendarDays className="h-9 w-9 shrink-0 text-warning" />
          <div className="space-y-1.5 text-xs">
            <p className="text-sm font-bold text-warning">Previsão de entrega</p>
            <p className="text-muted-foreground">Calculada automaticamente considerando:</p>
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              <li>o prazo informado (horas, dias ou semanas)</li>
              <li>a posição na fila</li>
              <li>as tarefas anteriores</li>
              <li>os finais de semana e feriados (conforme regra do sistema).</li>
            </ul>
          </div>
        </Card>
        <Card className="flex gap-3 border-destructive/40 bg-destructive/5 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center text-destructive"><ArrowUpDown className="h-6 w-6" /></span>
          <div className="space-y-1.5 text-xs">
            <p className="text-sm font-bold text-destructive">Tarefa mudou de posição</p>
            <p className="text-muted-foreground">Quando a posição da tarefa na fila muda (ex.: do 5º para o 6º lugar, ou do 6º para o 5º), a previsão é recalculada automaticamente e o prazo pode ser ajustado.</p>
            <p className="flex items-start gap-1 rounded-md border border-destructive/30 bg-background p-2 text-destructive">
              <ArrowUpDown className="mt-0.5 h-3.5 w-3.5 shrink-0" /> O desenvolvedor deve revisar e ajustar o prazo, se necessário.
            </p>
          </div>
        </Card>
        <Card className="flex gap-3 border-success/40 bg-success/5 p-4">
          <CheckCircle2 className="h-9 w-9 shrink-0 text-success" />
          <div className="space-y-1.5 text-xs">
            <p className="text-sm font-bold text-success">Situação do prazo</p>
            <ul className="space-y-1 text-muted-foreground">
              <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" /> <b className="text-foreground">No prazo</b> – dentro da previsão.</li>
              <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" /> <b className="text-foreground">Risco</b> – próximo do vencimento.</li>
              <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" /> <b className="text-foreground">Atrasado</b> – passou da previsão.</li>
              <li className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-500" /> <b className="text-foreground">Concluído</b> – tarefa finalizada.</li>
            </ul>
          </div>
        </Card>
      </div>

      {/* Satisfação — só a MINHA nota (colocação + médias por item avaliado) */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <HoverCard openDelay={100}>
        <HoverCardTrigger asChild>
        <Card className="cursor-help p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-sm font-bold"><Trophy className="h-4 w-4 text-warning" /> Minha satisfação <span className="text-[10px] font-normal text-muted-foreground">(passe o mouse)</span></p>
            {minhaSatisfacao && (
              <span className="text-[11px] text-muted-foreground">{minhaSatisfacao.posicao}º de {minhaSatisfacao.devs} na equipe</span>
            )}
          </div>
          {minhaSatisfacao ? (
            <div className="flex items-center gap-2.5">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                minhaSatisfacao.posicao === 1 ? "bg-warning/20 text-warning"
                : minhaSatisfacao.posicao === 2 ? "bg-muted-foreground/20 text-muted-foreground"
                : minhaSatisfacao.posicao === 3 ? "bg-orange-500/20 text-orange-600"
                : "bg-muted text-muted-foreground"
              }`}>{minhaSatisfacao.posicao}º</span>
              <Avatar className="h-8 w-8"><AvatarFallback className="text-[10px]">{iniciais(nomeDe(user?.id ?? null))}</AvatarFallback></Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{nomeDe(user?.id ?? null)}</p>
                <p className="text-[10px] text-muted-foreground">{minhaSatisfacao.total} avaliação(ões) recebida(s)</p>
              </div>
              <Estrelas valor={minhaSatisfacao.media} size={15} />
              <span className="text-sm font-bold">{minhaSatisfacao.media.toFixed(1).replace(".", ",")}</span>
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted-foreground">Você ainda não recebeu avaliações de chamados concluídos.</p>
          )}
        </Card>
        </HoverCardTrigger>
        <HoverCardContent align="start" className="max-h-96 w-96 overflow-y-auto p-3">
          <p className="mb-2 text-xs font-bold">Quem avaliou</p>
          {minhasAvaliacoes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma avaliação recebida ainda.</p>
          ) : (
            <div className="space-y-2">
              {minhasAvaliacoes.map((a, i) => (
                <div key={i} className="rounded border border-border/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium">{nomeDe(a.CHAMADO_SISTEMA?.solicitante_id ?? null)}</p>
                      <p className="text-[10px] text-muted-foreground">#{a.CHAMADO_SISTEMA?.numero ?? "—"} · {fmtData(a.created_at)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Estrelas valor={mediaAvaliacao(a)} size={12} />
                      <span className="text-xs font-bold">{mediaAvaliacao(a).toFixed(1).replace(".", ",")}</span>
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 text-[10px] text-muted-foreground">
                    {CRITERIOS_AVALIACAO.map((c) => (
                      <span key={c.key} className="flex justify-between gap-1"><span className="truncate">{c.titulo}</span><span className="font-semibold text-foreground">{Number((a as any)[c.key])}</span></span>
                    ))}
                  </div>
                  {a.comentario && <p className="mt-1 border-t border-border/50 pt-1 text-[10px] italic text-muted-foreground">"{a.comentario}"</p>}
                </div>
              ))}
            </div>
          )}
        </HoverCardContent>
        </HoverCard>

        <Card className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-bold"><Star className="h-4 w-4 text-warning" /> Minha média por item avaliado</p>
          <div className="space-y-2.5">
            {minhaSatisfacao ? minhaSatisfacao.itens.map((it) => (
              <div key={it.label} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <Estrelas valor={it.v} size={13} />
                <span className="w-7 text-right font-semibold">{it.v.toFixed(1).replace(".", ",")}</span>
                <span className="w-8 text-right text-[10px] text-muted-foreground">({minhaSatisfacao.total})</span>
              </div>
            )) : (
              <p className="py-4 text-center text-xs text-muted-foreground">Sem avaliações ainda.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Ver Fila por Prioridade */}
      <Dialog open={filaPrioridadeAberta} onOpenChange={setFilaPrioridadeAberta}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Copy className="h-5 w-5" /> Fila por prioridade</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            {filaPorPrioridade.map(({ p, itens }) => (
              <div key={p}>
                <p className={`mb-1.5 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${COR_PRIORIDADE[p].pill}`}>
                  {PRIORIDADES[p].label} · {itens.length}
                </p>
                {itens.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma tarefa.</p> : (
                  <div className="space-y-1">
                    {itens.map((c) => {
                      const sit = paraTela(situacoes[c.id]);
                      return (
                        <button key={c.id} onClick={() => { setFilaPrioridadeAberta(false); nav(`/app/sistemas/chamados/${c.id}`); }}
                          className="flex w-full items-center gap-2 rounded border border-border px-2.5 py-1.5 text-left text-xs hover:border-primary/40">
                          <span className="w-8 font-semibold">{posicaoMinhaFila[c.id] ? `${posicaoMinhaFila[c.id]}º` : "—"}</span>
                          <span className="font-mono text-[11px] font-semibold">#{numeroCurto(c.numero)}</span>
                          <span className="min-w-0 flex-1 truncate">{c.assunto}</span>
                          <span className="text-muted-foreground">{c.prazo_dias ? rotuloPrazo(c.prazo_dias, c.prazo_unidade) : "sem prazo"}</span>
                          <span className="w-20 text-right">{previsoes[c.id] ? previsoes[c.id].data.toLocaleDateString("pt-BR") : "—"}</span>
                          {sit && <span className={`rounded border px-1.5 py-px text-[10px] font-semibold ${SITUACAO_TELA[sit].cls}`}>{SITUACAO_TELA[sit].label}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <IniciarDesenvolvimentoDialog
        open={!!prazoAlvo}
        onOpenChange={(v) => { if (!v) setPrazoAlvo(null); }}
        chamado={prazoAlvo?.chamado ?? null}
        modo={prazoAlvo?.modo ?? "iniciar"}
      />

      <ReabrirChamadoDialog
        open={!!reabrir}
        onOpenChange={(v) => { if (!v) setReabrir(null); }}
        chamado={reabrir}
        // O chamado reaberto volta para a fila; sem trocar a visão o dev
        // clica e a linha some da tela em que ele está.
        onReaberto={() => setVisao("fila_mes")}
      />
    </div>
    </TooltipProvider>
  );
}
