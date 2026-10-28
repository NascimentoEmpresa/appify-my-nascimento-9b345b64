import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, type DragEndEvent, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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
import { ClipboardList, Clock, Users, CheckCircle2, AlertTriangle, ShieldAlert, MoreHorizontal, ChevronLeft, ChevronRight, Eye, UserCog, Trash2, RotateCcw, Info, MessageSquareQuote, GraduationCap, UserCheck, ListOrdered, GripVertical } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FeedAtualizacoes } from "./FeedAtualizacoes";
import { ExcluirChamadoDialog } from "./ExcluirChamadoDialog";
import { ReabrirChamadoDialog } from "./ReabrirChamadoDialog";
import { EnviarTreinamentoDialog } from "./StatusValidacao";
import { desenvolvedorDaValidacao, type ValidacaoChamado } from "./validacaoPresidencia";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  StatCard, StatusBadge, PrioridadeBadge, DefinicaoBadge, DEFINICOES, STATUS_CHAMADO, PRIORIDADES, CATEGORIAS, labelDe, moduloLabel, iniciais, Estrelas, fmtData, fmtDataHora,
  chamadoAtivo, podeReabrirChamado, posicoesFilaGlobal, posicoesFilaDev, CRITERIOS_AVALIACAO, mediaAvaliacao, type Chamado,
  CRITERIOS_AVALIACAO_SOLICITANTE, type CriterioSolicitanteKey,
} from "./types";

const POR_PAGINA = 8;
// Avaliações uma a uma: sem paginar, a lista crescia a página inteira.
const AVALIACOES_POR_PAGINA = 20;

interface PainelStats { total: number; abertos: number; em_andamento: number; concluidos_mes: number; atrasados: number; }
interface Dev { id: string; display_name: string; em_andamento: number; abertos: number; }

/** Uma avaliação individual: quem deu, em qual chamado, notas e comentário. */
interface AvaliacaoDetalhe {
  avaliacao_id: string;
  chamado_id: string;
  numero: string;
  assunto: string;
  responsavel_id: string | null;
  avaliador_id: string;
  avaliador_nome: string;
  setor: string | null;
  qualidade: number; prazo: number; comunicacao: number;
  clareza: number; facilidade: number; satisfacao: number;
  comentario: string | null;
  created_at: string;
}

// A fila mostra só quem ainda está na fila (posição 1 pra baixo). Chamados
// concluídos/reprovados não têm posição e aparecem nas próprias abas.
const ABAS = [
  { key: "fila", label: "Fila de chamados" },
  { key: "aberto", label: "Abertos" },
  { key: "em_andamento", label: "Em andamento" },
  { key: "aguardando_retorno", label: "Aguardando retorno" },
  { key: "concluido", label: "Concluídos" },
  { key: "reprovado", label: "Reprovados" },
  { key: "cancelado", label: "Cancelados" },
  // Presidência aprovou e o treinamento está em aberto (mig 273): falta o dev
  // ENVIAR (escolher usuários/setores) ou os participantes confirmarem. O dev
  // envia na execução; a gestão (gerente do dev) pode enviar por ele aqui.
  { key: "treinamento", label: "Pendentes treinamento" },
] as const;

const DONUT = {
  aberto: "hsl(var(--warning))", em_andamento: "hsl(var(--info))",
  aguardando_retorno: "hsl(var(--primary))", concluido: "hsl(var(--success))",
  reprovado: "hsl(var(--destructive))", cancelado: "hsl(var(--muted-foreground))",
};

const CHAVE_FILTROS_PAINEL = "painel-distribuicao:filtros";
type FiltrosPainel = Partial<{ aba: string; busca: string; fCategoria: string; fPrioridade: string; fResponsavel: string; fDe: string; fAte: string; pagina: number }>;
function lerFiltrosPainel(): FiltrosPainel {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_FILTROS_PAINEL) ?? "{}") as FiltrosPainel; } catch { return {}; }
}

// Abas de chamados ATIVOS: aqui a ordem é a da fila de cada desenvolvedor
// (posicao_dev), e com um responsável escolhido dá pra arrastar (20/10/2026).
const ABAS_FILA_DEV = ["em_andamento", "aberto", "aguardando_retorno"];

/** Linha da tabela que pode ser arrastada (mesmo dnd-kit da tela de Coordenar). */
function LinhaArrastavel({ id, habilitado, className, onClick, children }: {
  id: string; habilitado: boolean; className?: string; onClick?: () => void;
  children: (alca: React.ReactNode) => React.ReactNode;
}) {
  const s = useSortable({ id, disabled: !habilitado });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(s.transform), transition: s.transition,
    opacity: s.isDragging ? 0.6 : 1, position: "relative", zIndex: s.isDragging ? 10 : undefined,
  };
  const alca = habilitado ? (
    <button type="button" {...s.attributes} {...s.listeners} onClick={(e) => e.stopPropagation()}
      className="cursor-grab rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing" title="Arraste para mudar a ordem na fila do desenvolvedor">
      <GripVertical className="h-4 w-4" />
    </button>
  ) : null;
  return <TableRow ref={s.setNodeRef} style={style} className={className} onClick={onClick}>{children(alca)}</TableRow>;
}

export default function PainelDistribuicao() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { gestor, canCoordenar, canAprovar, canDev, canExcluir } = useChamadoPerms();

  // Filtros LEMBRADOS (20/10/2026): abrir um chamado e voltar zerava tudo —
  // aba, responsável, busca… Ficam na sessão do navegador (some ao fechar a aba).
  const salvos = useMemo(() => lerFiltrosPainel(), []);
  const [aba, setAba] = useState<string>(salvos.aba ?? "fila");
  const [busca, setBusca] = useState(salvos.busca ?? "");
  const [fCategoria, setFCategoria] = useState(salvos.fCategoria ?? "todas");
  const [fPrioridade, setFPrioridade] = useState(salvos.fPrioridade ?? "todas");
  const [fResponsavel, setFResponsavel] = useState(salvos.fResponsavel ?? "todos");
  const [fDe, setFDe] = useState(salvos.fDe ?? "");
  const [fAte, setFAte] = useState(salvos.fAte ?? "");
  const [pagina, setPagina] = useState(salvos.pagina ?? 1);
  useEffect(() => {
    try {
      sessionStorage.setItem(CHAVE_FILTROS_PAINEL, JSON.stringify({ aba, busca, fCategoria, fPrioridade, fResponsavel, fDe, fAte, pagina }));
    } catch { /* sessão indisponível: só não lembra */ }
  }, [aba, busca, fCategoria, fPrioridade, fResponsavel, fDe, fAte, pagina]);
  const [atribChamado, setAtribChamado] = useState<string | null>(null);
  const [atribDev, setAtribDev] = useState<string | null>(null);
  const [atribDefinicao, setAtribDefinicao] = useState<string>("");
  const [excluir, setExcluir] = useState<{ id: string; numero: string } | null>(null);
  const [reabrir, setReabrir] = useState<Chamado | null>(null);
  const [flashPrioridade, setFlashPrioridade] = useState<string | null>(null);
  // Filtro do detalhamento de avaliações: "todos" ou o id do integrante.
  const [fAvaliado, setFAvaliado] = useState("todos");
  const [paginaAval, setPaginaAval] = useState(1);
  const [enviarTreino, setEnviarTreino] = useState<{ chamado: Chamado; v: ValidacaoChamado } | null>(null);
  const [abaInferior, setAbaInferior] = useState("fila");

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

  // As avaliações UMA A UMA. A média por integrante mostra que a nota caiu,
  // mas não quem deu nem por quê — é aqui que sai "onde melhorar".
  const { data: avaliacoes = [] } = useQuery({
    queryKey: ["chamados-avaliacoes-detalhe"],
    enabled: gestor,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_avaliacoes_detalhe");
      return (data ?? []) as AvaliacaoDetalhe[];
    },
  });

  // O outro lado: como os devs avaliaram quem pediu (mig 20261020000070).
  // A RPC só devolve linhas para a gestão.
  const { data: rankingSolicitantes = [] } = useQuery({
    queryKey: ["chamados-ranking-solicitantes"],
    enabled: gestor,
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("chamados_ranking_solicitantes");
      const linhas = (data ?? []) as Array<Record<CriterioSolicitanteKey, number> & {
        avaliado_id: string; nome: string; setor: string | null; avaliacoes: number; media: number; ultimo_comentario: string | null;
      }>;
      return [...linhas].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
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

  // Treinamentos pendentes (etapa "treinamento"): a Presidência aprovou e
  // falta o dev e/ou o solicitante confirmarem. Alimenta a aba própria.
  const { data: treinosPendentes = {} } = useQuery({
    queryKey: ["chamado-validacoes", "painel-treinamento"],
    enabled: gestor,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_SISTEMA_VALIDACAO").select("*").eq("etapa", "treinamento");
      if (error) throw error;
      const m: Record<string, ValidacaoChamado> = {};
      ((data ?? []) as ValidacaoChamado[]).forEach((v) => { m[v.chamado_id] = v; });
      return m;
    },
  });

  const idsTreino = Object.keys(treinosPendentes);
  const { data: participantes = {} } = useQuery({
    queryKey: ["chamado-validacoes", "painel-participantes", [...idsTreino].sort().join(",")],
    enabled: gestor && idsTreino.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHAMADO_TREINAMENTO_DESTINATARIO").select("chamado_id, confirmado_em").in("chamado_id", idsTreino);
      if (error) throw error;
      const m: Record<string, { total: number; confirmados: number }> = {};
      ((data ?? []) as Array<{ chamado_id: string; confirmado_em: string | null }>).forEach((d) => {
        const r = (m[d.chamado_id] ??= { total: 0, confirmados: 0 });
        r.total += 1; if (d.confirmado_em) r.confirmados += 1;
      });
      return m;
    },
  });

  // Ordem alfabética por nome. Não é ranking: a posição na tabela não quer
  // dizer nada, então ordenar por nota daria uma hierarquia que não existe.
  const rankingAlfabetico = useMemo(
    () => [...ranking].sort((a, b) => nomeDe(a.responsavel_id).localeCompare(nomeDe(b.responsavel_id), "pt-BR")),
    [ranking, usuarios], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const avaliacoesFiltradas = useMemo(
    () => (fAvaliado === "todos" ? avaliacoes : avaliacoes.filter((a) => a.responsavel_id === fAvaliado)),
    [avaliacoes, fAvaliado],
  );
  useEffect(() => { setPaginaAval(1); }, [fAvaliado]);
  const totalPaginasAval = Math.max(1, Math.ceil(avaliacoesFiltradas.length / AVALIACOES_POR_PAGINA));
  const paginaAvalAtual = Math.min(paginaAval, totalPaginasAval);
  const avaliacoesPagina = useMemo(
    () => avaliacoesFiltradas.slice((paginaAvalAtual - 1) * AVALIACOES_POR_PAGINA, paginaAvalAtual * AVALIACOES_POR_PAGINA),
    [avaliacoesFiltradas, paginaAvalAtual],
  );
  const deAval = avaliacoesFiltradas.length === 0 ? 0 : (paginaAvalAtual - 1) * AVALIACOES_POR_PAGINA + 1;
  const ateAval = Math.min(paginaAvalAtual * AVALIACOES_POR_PAGINA, avaliacoesFiltradas.length);

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
      if (aba === "treinamento") { if (!treinosPendentes[c.id]) return false; }
      else if (aba === "fila" ? !chamadoAtivo(c.status) : c.status !== aba) return false;
      if (fCategoria !== "todas" && !c.categorias.includes(fCategoria)) return false;
      if (fPrioridade !== "todas" && c.prioridade !== fPrioridade) return false;
      if (fResponsavel === "sem" ? !!c.responsavel_id : fResponsavel !== "todos" && c.responsavel_id !== fResponsavel) return false;
      const ts = new Date(c.created_at).getTime();
      if (deTs != null && ts < deTs) return false;
      if (ateTs != null && ts > ateTs) return false;
      if (t && ![c.numero, c.assunto, c.solicitante_nome, c.setor].some((v) => String(v ?? "").toLowerCase().includes(t))) return false;
      return true;
    });
    // Abas de ativos (Em andamento, Abertos, Aguardando retorno): na ORDEM
    // DA FILA DE CADA DEV (20/10/2026) — responsável por nome, depois a
    // posição na fila dele; sem responsável no fim, por chegada.
    if (ABAS_FILA_DEV.includes(aba)) {
      return lista.sort((a, b) => {
        if (!!a.responsavel_id !== !!b.responsavel_id) return a.responsavel_id ? -1 : 1;
        if (a.responsavel_id && b.responsavel_id && a.responsavel_id !== b.responsavel_id) {
          return nomeDe(a.responsavel_id).localeCompare(nomeDe(b.responsavel_id), "pt-BR");
        }
        const da = posicaoDev[a.id] ?? Number.MAX_SAFE_INTEGER, db = posicaoDev[b.id] ?? Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;
        return (posicaoFila[a.id] ?? Number.MAX_SAFE_INTEGER) - (posicaoFila[b.id] ?? Number.MAX_SAFE_INTEGER);
      });
    }
    // Quem está na fila vem da posição 1 pra baixo; encerrados, do mais recente.
    return lista.sort((a, b) => {
      const pa = posicaoFila[a.id], pb = posicaoFila[b.id];
      if (pa && pb) return pa - pb;
      if (pa) return -1;
      if (pb) return 1;
      return +new Date(b.created_at) - +new Date(a.created_at);
    });
  }, [chamados, aba, fCategoria, fPrioridade, fResponsavel, fDe, fAte, busca, posicaoFila, posicaoDev, treinosPendentes, usuarios]);

  // Volta pra página 1 sempre que os filtros mudam — menos na montagem, senão
  // a página lembrada (voltando de um chamado) se perderia.
  const montou = useRef(false);
  useEffect(() => {
    if (!montou.current) { montou.current = true; return; }
    setPagina(1);
  }, [aba, fCategoria, fPrioridade, fResponsavel, fDe, fAte, busca]);

  // Arrastar para reordenar (20/10/2026): numa aba de ativos, com UM
  // desenvolvedor escolhido no filtro, e para quem coordena — a mesma régua
  // da RPC chamado_reordenar_fila_dev. Arrastando, a lista vem inteira (sem
  // páginas), senão não daria para levar um chamado para outra página.
  const devFiltrado = fResponsavel !== "todos" && fResponsavel !== "sem" ? fResponsavel : null;
  const arrastando = canCoordenar && ABAS_FILA_DEV.includes(aba) && !!devFiltrado;
  const porPagina = arrastando ? Math.max(1, filtrados.length) : POR_PAGINA;
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = useMemo(
    () => filtrados.slice((paginaAtual - 1) * porPagina, paginaAtual * porPagina),
    [filtrados, paginaAtual, porPagina],
  );
  const de = filtrados.length === 0 ? 0 : (paginaAtual - 1) * porPagina + 1;
  const ate = Math.min(paginaAtual * porPagina, filtrados.length);

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  /**
   * Soltou: a ordem nova vale para a fila INTEIRA do dev (inclusive o que a
   * aba atual não mostra — ex.: "Aguardando retorno" quando se está em "Em
   * andamento"). Move o chamado arrastado para o lugar do alvo dentro da fila
   * completa e grava pela mesma RPC da tela de Coordenar.
   */
  const reordenar = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !devFiltrado) return;
    const fila = chamados
      .filter((c) => c.responsavel_id === devFiltrado && chamadoAtivo(c.status))
      .sort((a, b) => (posicaoDev[a.id] ?? Number.MAX_SAFE_INTEGER) - (posicaoDev[b.id] ?? Number.MAX_SAFE_INTEGER));
    const deI = fila.findIndex((c) => c.id === active.id);
    const paraI = fila.findIndex((c) => c.id === over.id);
    if (deI === -1 || paraI === -1) return;
    const nova = arrayMove(fila, deI, paraI);
    const ordem = nova.map((c) => c.id);
    // Otimista: a tabela já mostra a ordem nova enquanto o banco grava.
    qc.setQueryData<Chamado[]>(["chamados-todos"], (velhos) =>
      (velhos ?? []).map((c) => { const i = ordem.indexOf(c.id); return i === -1 ? c : { ...c, posicao_dev: i + 1 }; }));
    const { error } = await (supabase as any).rpc("chamado_reordenar_fila_dev", { p_responsavel_id: devFiltrado, p_ordem: ordem });
    if (error) toast({ title: "Erro ao reordenar a fila", description: error.message, variant: "destructive" });
    else {
      const movido = fila[deI];
      toast({ title: "Fila atualizada", description: `#${movido.numero} agora é o ${paraI + 1}º da fila de ${nomeDe(devFiltrado)}.` });
    }
    qc.invalidateQueries({ queryKey: ["chamados-todos"] });
    qc.invalidateQueries({ queryKey: ["chamados-fila-dev"] });
  };

  // Fila por prioridade (chamados ativos) para o rodapé.
  const filaPorPrioridade = useMemo(() => {
    const ativos = chamados.filter((c) => chamadoAtivo(c.status));
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
  // A definição (Reunião / Extra, mig 20261028001700) é obrigatória aqui
  // também — distribuir é o momento em que ela é registrada.
  const atribuir = async () => {
    if (!atribChamado || !atribDev || !atribDefinicao) return;
    const { error: erroDef } = await (supabase as any).from("CHAMADO_SISTEMA").update({ definicao: atribDefinicao }).eq("id", atribChamado);
    if (erroDef) { toast({ title: "Erro ao gravar a definição", description: erroDef.message, variant: "destructive" }); return; }
    await (supabase as any).from("CHAMADO_SISTEMA_EVENTO").insert({
      chamado_id: atribChamado, tipo: "evento",
      texto: `Definição da prioridade: ${DEFINICOES[atribDefinicao as keyof typeof DEFINICOES]?.label ?? atribDefinicao}`,
    });
    const { error } = await (supabase as any).rpc("chamado_direcionar", {
      p_chamado_id: atribChamado, p_responsavel_id: atribDev, p_posicao: null, p_observacao: null,
    });
    if (error) { toast({ title: "Erro ao atribuir", description: error.message, variant: "destructive" }); return; }
    supabase.functions.invoke("enviar-notificacao-push", { body: { chamado_id: atribChamado, evento: "atribuido" } }).catch(() => {});
    supabase.functions.invoke("notificar-chamado-whatsapp", { body: { chamado_id: atribChamado, evento: "atribuido" } }).catch(() => {});
    toast({ title: "Chamado atribuído" });
    setAtribChamado(null); setAtribDev(null); setAtribDefinicao("");
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
                {a.key === "treinamento" && Object.keys(treinosPendentes).length > 0 && (
                  <span className="ml-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">{Object.keys(treinosPendentes).length}</span>
                )}
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
                    {/* Reunião ou Extra — definida em Coordenar chamado (mig 20261028001700). */}
                    <TableHead>Definição</TableHead>
                    <TableHead>Solicitante</TableHead>
                    <TableHead>Abertura</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="w-16 text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={reordenar}>
                  <SortableContext items={visiveis.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                  {visiveis.map((c) => (
                    <LinhaArrastavel key={c.id} id={c.id} habilitado={arrastando} className="cursor-pointer" onClick={() => nav(`/app/sistemas/chamados/${c.id}/coordenar`)}>
                    {(alca) => (<>
                      <TableCell className="text-center">
                        {ABAS_FILA_DEV.includes(aba) && posicaoDev[c.id] ? (
                          // Abas de ativos: o número grande é a posição na fila DO DEV.
                          <span className="inline-flex items-center gap-1">
                            {alca}
                            <span
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                c.prioridade === "alta" ? "bg-destructive/15 text-destructive"
                                : c.prioridade === "media" ? "bg-warning/15 text-warning"
                                : "bg-success/15 text-success"
                              }`}
                              title={`${posicaoDev[c.id]}º na fila de ${nomeDe(c.responsavel_id)}`}
                            >
                              {posicaoDev[c.id]}
                            </span>
                            {posicaoFila[c.id] && (
                              <span className="text-[10px] font-semibold text-muted-foreground" title="Posição na fila geral (ordem de chegada)">
                                ({posicaoFila[c.id]})
                              </span>
                            )}
                          </span>
                        ) : posicaoFila[c.id] ? (
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
                      {/* Título em destaque e a descrição logo abaixo: dá para
                          entender o pedido sem abrir o chamado. */}
                      <TableCell className="min-w-[220px] max-w-[340px]" title={c.descricao ? `${c.assunto}\n\n${c.descricao}` : c.assunto}>
                        <span className="line-clamp-2 text-sm font-semibold leading-snug">{c.assunto}</span>
                        {c.descricao && <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{c.descricao}</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.categorias.map((x) => labelDe(CATEGORIAS, x)).join(", ") || "—"}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {chamadoAtivo(c.status) ? (
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
                      <TableCell><DefinicaoBadge definicao={c.definicao} /></TableCell>
                      <TableCell className="text-xs">{c.solicitante_nome || "—"}<div className="text-[10px] text-muted-foreground">{c.setor}</div></TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDataHora(c.created_at)}</TableCell>
                      <TableCell>
                        {treinosPendentes[c.id] ? (
                          treinosPendentes[c.id].treinamento_dev_em ? (
                            <div className="space-y-0.5 text-[11px]">
                              <div className="text-success">✓ Enviado · {fmtData(treinosPendentes[c.id].treinamento_dev_em)}</div>
                              <div className="font-semibold text-warning">
                                {participantes[c.id]?.confirmados ?? 0} de {participantes[c.id]?.total ?? "…"} confirmaram
                              </div>
                            </div>
                          ) : (
                            <div className="text-[11px] font-semibold text-warning">○ Envio pendente</div>
                          )
                        ) : <StatusBadge status={c.status} />}
                      </TableCell>
                      <TableCell className="text-xs">{nomeDe(treinosPendentes[c.id] ? desenvolvedorDaValidacao(treinosPendentes[c.id], c) : c.responsavel_id)}</TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-0.5">
                          {treinosPendentes[c.id] && !treinosPendentes[c.id].treinamento_dev_em && (
                            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" title="Enviar o treinamento (escolher usuários/setores)"
                              onClick={() => setEnviarTreino({ chamado: c, v: treinosPendentes[c.id] })}>
                              <GraduationCap className="h-3.5 w-3.5" /> Enviar
                            </Button>
                          )}
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
                              {podeReabrirChamado(c, { canCoordenar, canAprovar, canDev, userId: user?.id }) && (
                                <DropdownMenuItem onClick={() => setReabrir(c)}>
                                  <RotateCcw className="mr-2 h-4 w-4" /> Reabrir chamado
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </>)}
                    </LinhaArrastavel>
                  ))}
                  </SortableContext>
                  </DndContext>
                  {filtrados.length === 0 && (
                    <TableRow><TableCell colSpan={11} className="py-6 text-center text-sm text-muted-foreground">Nenhum chamado.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              {aba === "treinamento" && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Chamados que a Presidência aprovou com o treinamento em aberto. O desenvolvedor envia o treinamento na tela do chamado,
                  escolhendo usuários e/ou setores; a gestão pode enviar por ele aqui (botão Enviar). Cada participante confirma em
                  Central de Serviços › Treinamentos › Treinamentos Sistemas — com todos confirmados, a solicitação finaliza.
                </p>
              )}
              <p className="mt-2 text-[11px] text-muted-foreground">
                {ABAS_FILA_DEV.includes(aba) ? (
                  <>
                    Em ordem da fila de cada desenvolvedor: o número é a posição na fila do responsável; entre parênteses, a posição na fila geral.
                    {arrastando
                      ? <> <b className="text-foreground">Arraste pela alça</b> para mudar a ordem da fila de {nomeDe(devFiltrado)} — vale para a fila inteira dele, inclusive o que esta aba não mostra.</>
                      : canCoordenar ? <> Para <b className="text-foreground">arrastar e mudar a ordem</b>, escolha um responsável no filtro.</> : null}
                  </>
                ) : (
                  <>
                    Posição = ordem de chegada na fila geral. Entre parênteses, a posição do chamado na fila do próprio responsável
                    (definida ao direcionar o chamado). Concluídos e reprovados saem da fila e ficam nas abas correspondentes.
                  </>
                )}
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
            <Select value={atribDefinicao} onValueChange={setAtribDefinicao}>
              <SelectTrigger className="h-9 text-xs" title="Onde a prioridade foi definida — vai para a coluna Definição">
                <SelectValue placeholder="Definição: Reunião ou Extra…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reuniao"><DefinicaoBadge definicao="reuniao" /></SelectItem>
                <SelectItem value="extra"><DefinicaoBadge definicao="extra" /></SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="w-full" disabled={!atribChamado || !atribDev || !atribDefinicao} onClick={atribuir}>Atribuir chamado</Button>
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

      {/* As quatro leituras de baixo em ABAS (20/10/2026). Empilhadas, a
          página passava de cinco telas de altura e a fila por prioridade —
          que é trabalho do dia — ficava no fim, depois de duas tabelas de
          avaliação. */}
      <Tabs value={abaInferior} onValueChange={setAbaInferior} className="mt-4">
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-muted/60 p-1">
          <TabsTrigger value="fila" className="gap-1.5 text-xs"><ListOrdered className="h-3.5 w-3.5" /> Fila por prioridade</TabsTrigger>
          <TabsTrigger value="satisfacao" className="gap-1.5 text-xs"><Users className="h-3.5 w-3.5" /> Satisfação por integrante</TabsTrigger>
          <TabsTrigger value="notas" className="gap-1.5 text-xs"><MessageSquareQuote className="h-3.5 w-3.5" /> Notas e comentários</TabsTrigger>
          <TabsTrigger value="solicitantes" className="gap-1.5 text-xs">
            <UserCheck className="h-3.5 w-3.5" /> Avaliação dos solicitantes
            {rankingSolicitantes.length > 0 && <span className="rounded-full bg-info/15 px-1.5 text-[10px] font-bold text-info">{rankingSolicitantes.length}</span>}
          </TabsTrigger>
        </TabsList>

      {/* Satisfação por integrante. Não é ranking: sem posição e em ordem
          alfabética — a leitura é "como cada um está", não "quem ganhou". */}
      <TabsContent value="satisfacao" className="mt-3">
      <Card className="p-4">
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
                <TableRow
                  key={r.responsavel_id}
                  className={`cursor-pointer ${fAvaliado === r.responsavel_id ? "bg-warning/5" : ""}`}
                  title="Ver as notas e os comentários desta pessoa"
                  onClick={() => setFAvaliado((cur) => (cur === r.responsavel_id ? "todos" : r.responsavel_id))}
                >
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
          <Info className="h-3.5 w-3.5" /> A nota final é calculada com base na média ponderada dos critérios avaliados. Clique num integrante para ver as notas dele uma a uma.
        </p>
      </Card>
      </TabsContent>

      {/* Notas uma a uma: quem deu, em qual chamado e o que escreveu. */}
      <TabsContent value="notas" className="mt-3">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <MessageSquareQuote className="h-4 w-4 text-warning" /> Notas e comentários por avaliação
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Integrante avaliado</span>
            <Select value={fAvaliado} onValueChange={setFAvaliado}>
              <SelectTrigger className="h-8 w-[200px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                {rankingAlfabetico.map((r) => (
                  <SelectItem key={r.responsavel_id} value={r.responsavel_id}>{nomeDe(r.responsavel_id)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="[&_td]:px-2 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-2">
            <TableHeader>
              <TableRow>
                <TableHead>Quem avaliou</TableHead>
                <TableHead>Chamado</TableHead>
                <TableHead>Integrante avaliado</TableHead>
                {CRITERIOS_AVALIACAO.map((c) => (
                  <TableHead key={c.key} className="text-center" title={c.titulo}>
                    {c.titulo.slice(0, 4)}.
                  </TableHead>
                ))}
                <TableHead className="text-center">Nota</TableHead>
                <TableHead>Comentário</TableHead>
                <TableHead className="whitespace-nowrap">Quando</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {avaliacoesPagina.map((a) => {
                const nota = mediaAvaliacao(a);
                return (
                  <TableRow
                    key={a.avaliacao_id}
                    className="cursor-pointer"
                    onClick={() => nav(`/app/sistemas/chamados/${a.chamado_id}/coordenar`)}
                  >
                    <TableCell>
                      <p className="truncate text-xs font-medium">{a.avaliador_nome}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{a.setor || "—"}</p>
                    </TableCell>
                    <TableCell>
                      <p className="font-mono text-[11px] font-semibold">#{a.numero}</p>
                      <p className="max-w-[180px] truncate text-[11px] text-muted-foreground" title={a.assunto}>{a.assunto}</p>
                    </TableCell>
                    <TableCell className="text-xs">{nomeDe(a.responsavel_id)}</TableCell>
                    {CRITERIOS_AVALIACAO.map((c) => {
                      const v = a[c.key];
                      return (
                        <TableCell
                          key={c.key}
                          className={`text-center text-xs font-semibold ${
                            v <= 2 ? "text-destructive" : v < 5 ? "text-warning" : "text-success"
                          }`}
                        >
                          {v}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1">
                        <Estrelas valor={nota} size={11} />
                        <span className="text-xs font-bold">{nota.toFixed(1).replace(".", ",")}</span>
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[280px]">
                      {a.comentario
                        ? <p className="whitespace-pre-wrap break-words text-[11px] [overflow-wrap:anywhere]">{a.comentario}</p>
                        : <span className="text-[11px] text-muted-foreground">— nota cheia, sem comentário</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">{fmtDataHora(a.created_at)}</TableCell>
                  </TableRow>
                );
              })}
              {avaliacoesFiltradas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-6 text-center text-sm text-muted-foreground">
                    {avaliacoes.length === 0
                      ? "Nenhuma avaliação recebida ainda."
                      : "Este integrante ainda não recebeu avaliações."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Mostrando {deAval} a {ateAval} de {avaliacoesFiltradas.length} avaliações</p>
          {totalPaginasAval > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 px-2" disabled={paginaAvalAtual <= 1} onClick={() => setPaginaAval((p) => Math.max(1, p - 1))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-xs text-muted-foreground">Página {paginaAvalAtual} de {totalPaginasAval}</span>
              <Button variant="outline" size="sm" className="h-8 px-2" disabled={paginaAvalAtual >= totalPaginasAval} onClick={() => setPaginaAval((p) => Math.min(totalPaginasAval, p + 1))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        <p className="mt-3 flex items-center justify-center gap-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> Desde 31/08/2026, nota abaixo de 5 em qualquer critério só é aceita com comentário — as avaliações anteriores a isso podem estar sem.
        </p>
      </Card>
      </TabsContent>

      {/* O dev avalia quem pediu (mig 20261020000070): média por pessoa. Mesma
          leitura da satisfação — ordem alfabética, sem posição. */}
      <TabsContent value="solicitantes" className="mt-3">
      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <UserCheck className="h-4 w-4 text-info" /> Avaliação dos solicitantes pelo desenvolvedor
          </p>
          <span className="text-[11px] text-muted-foreground">
            Nota final ponderada ({CRITERIOS_AVALIACAO_SOLICITANTE.map((c) => `${c.titulo} ${Math.round(c.peso * 100)}%`).join(" · ")})
          </span>
        </div>
        <div className="overflow-x-auto">
          <Table className="[&_td]:px-2 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-2">
            <TableHeader>
              <TableRow>
                <TableHead>Solicitante</TableHead>
                <TableHead className="text-center">Avaliações</TableHead>
                {CRITERIOS_AVALIACAO_SOLICITANTE.map((c) => (
                  <TableHead key={c.key} className="text-center">
                    {c.titulo}
                    <span className="block text-[10px] font-normal text-muted-foreground">({Math.round(c.peso * 100)}%)</span>
                  </TableHead>
                ))}
                <TableHead className="text-right">Nota final</TableHead>
                <TableHead>Último comentário</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rankingSolicitantes.map((r) => (
                <TableRow key={r.avaliado_id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-7 w-7"><AvatarFallback className="text-[10px]">{iniciais(r.nome)}</AvatarFallback></Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{r.nome}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{r.setor || "—"}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-center text-xs text-muted-foreground">{Number(r.avaliacoes)}</TableCell>
                  {CRITERIOS_AVALIACAO_SOLICITANTE.map((c) => {
                    const v = Number(r[c.key]);
                    return (
                      <TableCell key={c.key} className={`text-center text-xs font-semibold ${v < 3 ? "text-destructive" : v < 4.5 ? "text-warning" : "text-success"}`}>
                        {v.toFixed(1).replace(".", ",")}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Estrelas valor={Number(r.media)} size={13} />
                      <span className="text-sm font-bold">{Number(r.media).toFixed(1).replace(".", ",")}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    {r.ultimo_comentario
                      ? <p className="line-clamp-2 text-[11px] [overflow-wrap:anywhere]" title={r.ultimo_comentario}>{r.ultimo_comentario}</p>
                      : <span className="text-[11px] text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              ))}
              {rankingSolicitantes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={CRITERIOS_AVALIACAO_SOLICITANTE.length + 4} className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum solicitante avaliado ainda. A avaliação é pedida ao desenvolvedor quando ele conclui um chamado (a partir de 20/10/2026).
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 flex items-center justify-center gap-1.5 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> Cada pessoa que pediu (solicitante e participantes) recebe a própria avaliação. O avaliado não vê a nota.
        </p>
      </Card>
      </TabsContent>

      {/* Fila de chamados por prioridade */}
      <TabsContent value="fila" className="mt-3">
      <Card className="p-4">
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
      </TabsContent>
      </Tabs>

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

      <ReabrirChamadoDialog
        open={!!reabrir}
        onOpenChange={(v) => { if (!v) setReabrir(null); }}
        chamado={reabrir}
        // Reabriu estando na aba "Concluídos"/"Reprovados": o chamado deixa de
        // pertencer a ela. Manda para a fila, que é onde ele passa a estar.
        onReaberto={() => { setReabrir(null); setAba("fila"); setPagina(1); }}
      />

      {/* Enviar o treinamento (mig 273): a gestão escolhe usuários/setores,
          pelo dev quando não é ele. Cada participante confirma em
          Central de Serviços › Treinamentos › Treinamentos Sistemas. */}
      {enviarTreino && (
        <EnviarTreinamentoDialog
          chamado={enviarTreino.chamado} aberto onFechar={() => setEnviarTreino(null)}
          peloDev={(() => { const d = desenvolvedorDaValidacao(enviarTreino.v, enviarTreino.chamado); return d !== user?.id ? nomeDe(d) : null; })()}
        />
      )}
    </div>
  );
}
