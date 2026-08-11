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
import { ListChecks, Clock, MessageSquare, CheckCircle2, AlertTriangle, ShieldAlert, CalendarClock, RotateCw, ArrowUpRight, Plus, BookOpen, ClipboardCheck, Sparkles, FileText, Zap, Star, Trophy, GitPullRequest } from "lucide-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import { FeedAtualizacoes } from "./FeedAtualizacoes";
import { BotaoChatChamado, useChamadosNaoLidos } from "./BotaoChatChamado";
import {
  StatCard, PrioridadeBadge, StatusBadge, STATUS_CHAMADO, PRIORIDADES, Estrelas, iniciais, fmtData, fmtDataHora,
  chamadoAtivo, posicoesFilaDev, CRITERIOS_AVALIACAO, mediaAvaliacao, type Chamado,
} from "./types";

const DONUT: Record<string, string> = {
  aberto: "hsl(var(--warning))", em_andamento: "hsl(var(--info))",
  aguardando_retorno: "hsl(var(--primary))", concluido: "hsl(var(--success))",
  reprovado: "hsl(var(--destructive))",
};

const ATIVO = (s: string) => chamadoAtivo(s);

const GITHUB_REPO = "haggltda/appify-my-nascimento-9b345b64";
const DESCRICAO_MAX_URL = 3000; // evita estourar limite prático de tamanho de URL

// Cada dev usa 1 branch pessoal fixa (não uma branch nova por chamado) — os
// nomes exatos como aparecem no GitHub. Mesma ideia de mapeamento por
// profiles.id já usada em .github/workflows/notify_discord.yml e na edge
// function chamado-vincular-pr; atualizar aqui junto quando entrar gente nova.
const DEV_ID_PARA_BRANCH_GITHUB: Record<string, string> = {
  "97260632-2f1a-44e3-9f93-58b2b1f3702c": "eduardo", // Eduardo Jeiel
  "301bfa45-d01a-4e81-abd9-18d48bccef97": "pablo",   // Pablo Flores
  "e2c4faf6-289e-4f80-a235-628c2d674f46": "joao",    // João Victor
};

// Abre a tela de criação de PR do GitHub já com título e corpo preenchidos
// (prefixo do chamado + assunto + descrição), pra ninguém precisar copiar o
// número do chamado na mão — nem escolher a branch na tela.
//
// O GitHub só mantém o título/corpo pré-preenchidos vindos da URL quando ela
// já inclui base E branch de destino (compare/main...SUABRANCH?title=...).
// Como cada dev tem uma branch pessoal fixa e conhecida, a gente já sabe qual
// é (pelo usuário logado) e monta a URL completa de primeira — zero digitação.
// Só cai no prompt manual se o dev logado não estiver no mapa acima.
function abrirPrGithub(
  c: Chamado, e: React.MouseEvent, devId: string | undefined,
  toast: (o: { title: string; description?: string }) => void,
) {
  e.stopPropagation();
  const titulo = `${c.numero}: ${c.assunto}`;
  const descricaoBruta = c.descricao ?? "";
  const descricao = descricaoBruta.length > DESCRICAO_MAX_URL
    ? `${descricaoBruta.slice(0, DESCRICAO_MAX_URL)}\n\n…(descrição truncada — veja o restante no chamado)`
    : descricaoBruta;
  const corpo = [
    "<!-- chamado:auto:start -->",
    `**Chamado:** ${c.numero} — ${c.assunto}`,
    "",
    `**Descrição:** ${descricao || "—"}`,
    "<!-- chamado:auto:end -->",
    "",
    "## O que mudou",
    "",
    "## Como testar",
    "",
  ].join("\n");
  const params = `?quick_pull=1&expand=1&title=${encodeURIComponent(titulo)}&body=${encodeURIComponent(corpo)}`;

  const branchConhecida = devId ? DEV_ID_PARA_BRANCH_GITHUB[devId] : undefined;
  const branch = branchConhecida ?? window.prompt(
    "Não achei sua branch cadastrada. Digite o nome dela (ex: Eduardo) — assim o título e a descrição já vêm prontos na PR:",
    "",
  )?.trim();

  if (branch) {
    const url = `https://github.com/${GITHUB_REPO}/compare/main...${encodeURIComponent(branch)}${params}`;
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  // Sem branch (nem no mapa, nem digitada): a URL não sobrevive à escolha
  // manual da branch no GitHub, então copia título+corpo como reforço.
  navigator.clipboard?.writeText(`${titulo}\n\n${corpo}`).catch(() => {});
  toast({
    title: "Título e descrição copiados",
    description: "Cole na hora de criar a PR — sem a branch eu não consigo pré-preencher automaticamente.",
  });
  window.open(`https://github.com/${GITHUB_REPO}/compare/main`, "_blank", "noopener,noreferrer");
}

// Por padrão a lista mostra só o que está na fila; concluídos são opcionais.
const VISOES = [
  { key: "ativos", label: "Na minha fila" },
  { key: "concluidos", label: "Concluídos" },
  { key: "todos", label: "Todos" },
] as const;

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
  const [visao, setVisao] = useState<string>("ativos");

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

  const { data: naoLidos = {} } = useChamadosNaoLidos();

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

  // Avaliações individuais recebidas por este dev (quem avaliou + as notas),
  // para o card que aparece ao passar o mouse sobre "Minha satisfação".
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

  // Posição na MINHA fila (1 = próximo a executar) + lista conforme a visão.
  const posicaoMinhaFila = useMemo(() => posicoesFilaDev(chamados), [chamados]);
  const visiveis = useMemo(() => {
    const lista = chamados.filter((c) =>
      visao === "ativos" ? ATIVO(c.status)
      : visao === "concluidos" ? !ATIVO(c.status)
      : true);
    return lista.sort((a, b) => {
      const pa = posicaoMinhaFila[a.id], pb = posicaoMinhaFila[b.id];
      if (pa && pb) return pa - pb;
      if (pa) return -1;
      if (pb) return 1;
      return +new Date(b.updated_at) - +new Date(a.updated_at);
    });
  }, [chamados, visao, posicaoMinhaFila]);

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

      {/* items-start: cada coluna com a altura do próprio conteúdo (evita o
          vão branco embaixo da tabela quando a lista é curta). */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold">Meus chamados atribuídos</p>
            <div className="flex gap-1 rounded-lg bg-muted p-0.5">
              {VISOES.map((v) => (
                <button
                  key={v.key} onClick={() => setVisao(v.key)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${visao === v.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <div className="overflow-x-auto">
              {/* Mesmas células compactas do Painel de Distribuição. */}
              <Table className="[&_td]:px-2 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-2">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16 text-center">Fila</TableHead>
                    <TableHead>Chamado / Assunto</TableHead>
                    <TableHead>Solicitante / Setor</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Atualização</TableHead>
                    <TableHead className="text-right">Conversa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiveis.map((c) => {
                    const atrasado = c.prazo_previsto && ATIVO(c.status) && new Date(c.prazo_previsto) < hoje;
                    return (
                      <TableRow key={c.id} className="cursor-pointer" onClick={() => nav(`/app/sistemas/chamados/${c.id}`)}>
                        <TableCell className="text-center">
                          {posicaoMinhaFila[c.id] ? (
                            <span className="inline-flex items-center gap-1">
                              <span
                                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                                  c.prioridade === "alta" ? "bg-destructive/15 text-destructive"
                                  : c.prioridade === "media" ? "bg-warning/15 text-warning"
                                  : "bg-success/15 text-success"
                                }`}
                                title="Posição na minha fila de execução"
                              >
                                {posicaoMinhaFila[c.id]}
                              </span>
                              {posicoes[c.id] && (
                                <span className="text-[10px] font-semibold text-muted-foreground" title={`${posicoes[c.id]}º na fila geral (ordem de chegada)`}>
                                  ({posicoes[c.id]})
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <p className="font-mono text-[11px] font-semibold">#{c.numero}</p>
                          <p className="text-xs">{c.assunto}</p>
                          <button
                            onClick={(e) => abrirPrGithub(c, e, user?.id, toast)}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
                            title="Abrir PR no GitHub já preenchida com os dados deste chamado"
                          >
                            <GitPullRequest className="h-3 w-3" /> Abrir PR
                          </button>
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
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <BotaoChatChamado chamado={c} perfil="equipe" naoLidos={naoLidos[c.id] ?? 0} responsavelNome={nomeDe(c.responsavel_id)} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                      {visao === "concluidos" ? "Nenhum chamado concluído." : "Nenhum chamado na sua fila."}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Fila = a sua ordem de execução (1 = próximo a fazer), definida pela coordenação. Entre parênteses, a posição na fila geral.
              </p>
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

          <FeedAtualizacoes scope="involved" buildHref={(cid) => `/app/sistemas/chamados/${cid}`} />
        </div>
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
