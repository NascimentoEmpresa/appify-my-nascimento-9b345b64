import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FiltroContratos, passaNoFiltroContratos } from "@/components/solicitacoes/FiltroContratos";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BUCKET, MOTIVO_DEVOLUCAO_MIN, MOTIVO_SEM_VAGA_MIN, STATUS_CANCELAMENTO_SOLICITADO, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, STATUS_SST_RECEBIDA, acaoDoSST,
  aprovarPedeMotivoSemVaga, temMotivoSemVaga,
  TABELA, TABELA_ANEXOS, corDoStatus, explicaStatus,
  erroUltimaDataTrabalhada, limiteUltimaDataTrabalhada,
  fmtData, fmtDataHora, fmtTamanho, linkDoLocalASO, normSetorDemissao, patchDevolucao, podeDevolver,
  resumoDevolucao, resumoDoASO, statusDaEtapa1, visivelNaEtapaDemissao,
  type AnexoDemissao, type EtapaQueDevolve, type SolicitacaoDemissao,
} from "@/lib/demissao/solicitacao";
import { MapaPicker } from "@/components/sst/MapaPicker";
import {
  ArrowUpRight, Ban, CheckCircle2, Clock, Download, Eye, FileText, Loader2, MapPin, Search, Stethoscope,
  ThumbsDown, ThumbsUp, Undo2, X, XCircle,
} from "lucide-react";
import { ConversaSolicitacao } from "@/components/solicitacoes/ConversaSolicitacao";
import { AvisoCancelada, AvisoPedidoCancelamento } from "@/components/demissao/CancelarDemissao";
import { BlocoCancelarReconsideracaoRH, BlocoDecidirCancelamentoRH } from "@/components/demissao/CancelarReconsideracaoRH";
import { TABELA_APROVADOR_SETOR } from "@/components/admin/TrocaFuncaoSetoresUsuario";
import { TABELA_RESCISAO, corStatusRescisao } from "@/lib/demissao/rescisao";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// SISTEMA_SOLICITACOES_DEMISSAO e os anexos não estão no types.ts gerado;
// mesmo padrão de comite-etica/db.ts — a exceção fica num lugar só.
const sb = supabase as unknown as SupabaseClient;

/**
 * Painel das solicitações de demissão — a mesma tela para as três etapas.
 *
 *   operacional → aprova (segue para o RH) ou reprova COM MOTIVO;
 *   rh          → libera para o SST;
 *   sst         → marca o ASO demissional, que fecha a demissão;
 *   analista    → SÓ ACOMPANHA. Abre o card, lê tudo, e não decide nada.
 *
 * OPERACIONAL E ANALISTA TROCARAM DE PAPEL EM 14/09/2026: entre 02/09 e
 * 14/09 o analista decidia e o Operacional olhava; o Pablo pediu o inverso
 * ("o OPERACIONAL aprova e os analistas só veem"). O status voltou a ser
 * "Pendente Operacional" (migration 20260930000103). O que está escrito
 * abaixo sobre "o analista" naquela data vale hoje para o Operacional.
 *
 * SST e RH também DEVOLVEM à etapa 1 (02/09/2026). O erro na solicitação
 * costuma aparecer no fim — é o RH que percebe que o aviso está errado ou que
 * falta documento —, e até então as únicas saídas eram concluir um
 * desligamento errado ou abandonar o card. Devolver volta para `Pendente
 * Operacional` com o motivo escrito, e desfaz o que as etapas seguintes já
 * tinham carimbado (ver `patchDevolucao`).
 *
 * Um componente só porque a lista, os filtros, o detalhe e os anexos são
 * idênticos: o que muda é quem pode agir e sobre qual status. Quatro cópias
 * divergiriam na primeira correção feita em uma delas.
 *
 * SST e RH JÁ TROCARAM DE LUGAR TRÊS VEZES. Era RH → SST (25/08/2026),
 * virou SST → RH (02/09/2026) e em 08/09/2026 voltou a ser RH → SST: o RH
 * libera e o SST agenda o ASO, que passou a ser a última etapa. Quem manda no
 * fluxo é `lib/demissao/solicitacao.ts`; aqui só ficam os botões.
 *
 * O SST ganhou DOIS status próprios no mesmo dia — "recebida" e "agendado".
 * Só o painel dele os define; as outras etapas leem e filtram. É por isso que
 * `STATUS_DE_ACAO` virou LISTA: o SST é a única etapa que age em mais de um
 * status, e comparar com um valor só deixava o segundo botão inalcançável.
 *
 * O ANALISTA é leitura pura desde 14/09/2026 (antes era o Operacional, ver
 * acima). Ele não perdeu a tela: a pergunta "e a demissão do fulano, andou?"
 * continua chegando nele, só a decisão é que voltou para o Operacional.
 */

export type Etapa = "analista" | "operacional" | "diretoria" | "rh" | "sst";

/** Os status que cada etapa enxerga, na ordem em que fazem sentido na fila. */
const TODOS_OS_STATUS = [
  "Pendente Operacional", "Pendente Diretoria", "Pendente RH", "Pendente SST",
  STATUS_SST_RECEBIDA, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO,
  "Concluída", "Reprovada", STATUS_CANCELAMENTO_SOLICITADO, "Cancelada",
];

const STATUS_DA_ETAPA: Record<Etapa, string[]> = {
  operacional: TODOS_OS_STATUS,
  // A Diretoria vê o fluxo inteiro das administrativas (o recorte por
  // escritório/setor é visivelNaEtapaDemissao, não o status).
  diretoria: TODOS_OS_STATUS,
  // O analista enxerga o mesmo que o Operacional de propósito: ele acompanha
  // o fluxo inteiro. O que ele não tem é `STATUS_DE_ACAO`.
  analista: TODOS_OS_STATUS,
  // O SST é a última etapa: vê o que está chegando e o que ele já agendou.
  // "Cancelamento solicitado" (25/09/2026): o card congela esperando o RH;
  // o SST continua vendo, em vermelho, pra não agendar à toa.
  sst: ["Pendente SST", STATUS_SST_RECEBIDA, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, STATUS_CANCELAMENTO_SOLICITADO],
  // O RH continua vendo o que despachou — a pergunta que mais chega depois de
  // liberar é "e aí, o SST agendou?".
  // E as CANCELADAS (18/09/2026): desde que o próprio RH cancela por
  // reconsideração, sumir da fila sem rastro parecia erro.
  // E os PEDIDOS DE CANCELAMENTO do encarregado (25/09/2026), que só o RH decide.
  // E as "Concluída" do desenho antigo (19/10/2026): a tabela de rescisões
  // do RH é o histórico inteiro, como a planilha que ela substitui.
  rh: [STATUS_CANCELAMENTO_SOLICITADO, "Pendente RH", "Pendente SST", STATUS_SST_RECEBIDA, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, "Concluída", "Cancelada"],
};

/**
 * Os status em que a etapa TEM trabalho a fazer.
 *
 * Lista vazia no analista é o que torna a tela dele somente-leitura:
 * `podeAgir` pergunta se o status está aqui, e em lista vazia nunca está.
 *
 * Só o SST tem dois: ele recebe a solicitação e, depois, agenda o ASO.
 */
const STATUS_DE_ACAO: Record<Etapa, string[]> = {
  operacional: ["Pendente Operacional"],
  diretoria: ["Pendente Diretoria"],
  analista: [],
  sst: ["Pendente SST", STATUS_SST_RECEBIDA],
  rh: ["Pendente RH"],
};

/**
 * Cartão de contagem que também FILTRA (21/10/2026): clicar mostra só os
 * status que ele soma; clicar de novo volta a mostrar tudo. Antes o número
 * ficava em cima e o filtro era um dropdown à parte, com outros nomes.
 */
function Kpi({ titulo, valor, icone: Icone, cor, ativo, onClick }: {
  titulo: string; valor: number; icone: LucideIcon; cor: string; ativo?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm transition hover:border-primary/40",
        ativo && "border-primary ring-2 ring-primary/30")}>
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", cor)}>
        <Icone className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{titulo}</span>
        <span className="block text-xl font-bold leading-tight">{valor}</span>
      </span>
    </button>
  );
}

export function PainelDemissoes({ etapa }: { etapa: Etapa }) {
  const { user } = useAuth();
  const [linhas, setLinhas] = useState<SolicitacaoDemissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  // LISTA de status (21/10/2026): os cartões do topo filtram por grupo — "No
  // SST" são três status — e o chip de um status só é a lista de um.
  const [fStatus, setFStatus] = useState<string[]>([]);
  // Mês em que a solicitação foi aberta ("2026-10").
  const [fMes, setFMes] = useState("");
  // Filtros · Contratos (14/09/2026): o mesmo dropdown do Recrutamento.
  const [fContratos, setFContratos] = useState<string[]>([]);
  const [aberta, setAberta] = useState<SolicitacaoDemissao | null>(null);

  const statusVisiveis = STATUS_DA_ETAPA[etapa];
  // Lista, não valor: o SST age em dois status. Comparar com `===` aqui
  // compilava como sempre-falso e fazia TODA linha da fila dizer "Ver",
  // inclusive as que a etapa tinha para resolver.
  const statusDeAcao = STATUS_DE_ACAO[etapa];

  // Setores que EU trato (16/09/2026), marcados em Acesso por Usuário —
  // a mesma configuração da Mudança de Função. Solicitação com setor só
  // aparece (e só se decide) pra quem tem o setor; o banco repete a regra
  // no trigger trg_ssd_guard_aprovador_setor.
  const [meusSetores, setMeusSetores] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (etapa !== "diretoria" || !user?.id) { setMeusSetores(new Set()); return; }
    sb.from(TABELA_APROVADOR_SETOR).select("setor").eq("user_id", user.id)
      .then(({ data }: { data: { setor: string }[] | null }) =>
        setMeusSetores(new Set((data ?? []).map((r) => normSetorDemissao(r.setor)))));
  }, [etapa, user?.id]);

  const [todas, setTodas] = useState<SolicitacaoDemissao[]>([]);
  const carregar = useCallback(async () => {
    setCarregando(true);
    // O RH lê TODAS (19/10/2026): a tabela de rescisões é o histórico, e o
    // corte de 500 sumia com as mais antigas. Página de 1000, que é o teto
    // de linhas por resposta do PostgREST.
    const todasLidas: SolicitacaoDemissao[] = [];
    const pagina = etapa === "rh" ? 1000 : 500;
    for (let de = 0; ; de += pagina) {
      const { data, error } = await sb.from(TABELA)
        .select("*").in("status", statusVisiveis)
        .order("criado_em", { ascending: false }).order("id", { ascending: false }).range(de, de + pagina - 1);
      if (error) { toast.error("Erro ao carregar as solicitações: " + error.message); break; }
      todasLidas.push(...(data ?? []));
      if (etapa !== "rh" || !data || data.length < pagina) break;
    }
    setTodas(todasLidas);
    setCarregando(false);
  }, [statusVisiveis, etapa]);
  useEffect(() => { carregar(); }, [carregar]);

  // Veio do sino (25/09/2026): o link traz ?abrir=<id> — abre o card direto e
  // limpa o parâmetro, pra um "Atualizar" não reabrir.
  const [params, setParams] = useSearchParams();
  const abrirId = Number(params.get("abrir") ?? "");
  useEffect(() => {
    if (!abrirId || carregando) return;
    const alvo = todas.find((s) => s.id === abrirId);
    if (alvo) setAberta(alvo);
    else toast.info(`A solicitação #${abrirId} não está nesta fila (pode já ter andado).`);
    const p = new URLSearchParams(params); p.delete("abrir"); setParams(p, { replace: true });
  }, [abrirId, carregando, todas, params, setParams]);
  // Recorte por escritório/setor em memória: os setores chegam depois das linhas.
  useEffect(() => {
    setLinhas(todas.filter((s) => visivelNaEtapaDemissao(s, etapa, meusSetores)));
  }, [todas, etapa, meusSetores]);

  // O que a etapa tem para resolver vem PRIMEIRO (21/10/2026); dentro de cada
  // grupo, a mais recente em cima. O RH lê o histórico inteiro, e as do dia
  // ficavam no meio das concluídas.
  const precisaDeMim = useCallback((s: SolicitacaoDemissao) =>
    statusDeAcao.includes(s.status) || (etapa === "rh" && s.status === STATUS_CANCELAMENTO_SOLICITADO), [statusDeAcao, etapa]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((s) => {
      if (fStatus.length && !fStatus.includes(s.status)) return false;
      if (fMes && (s.criado_em ?? "").slice(0, 7) !== fMes) return false;
      if (!passaNoFiltroContratos(s, "contrato", fContratos)) return false;
      if (!q) return true;
      return [s.colaborador_nome, s.solicitante_nome, s.contrato, s.colaborador_posto, s.colaborador_cpf, String(s.id)]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    }).sort((a, b) => Number(precisaDeMim(b)) - Number(precisaDeMim(a)));
  }, [linhas, busca, fStatus, fMes, fContratos, precisaDeMim]);

  const contar = (status: string) => linhas.filter((s) => s.status === status).length;
  const filtroAtivo = fStatus.length > 0 || !!fMes || !!busca || fContratos.length > 0;
  const limparFiltros = () => { setFStatus([]); setFMes(""); setBusca(""); setFContratos([]); };
  // Cartão = grupo de status; clicar no grupo que já está ativo desfaz.
  const filtrarGrupo = (grupo: string[]) =>
    setFStatus((atual) => (atual.length === grupo.length && grupo.every((g) => atual.includes(g)) ? [] : grupo));
  const grupoAtivo = (grupo: string[]) => fStatus.length === grupo.length && grupo.every((g) => fStatus.includes(g));

  // O status da RESCISÃO de cada solicitação (só no RH, 21/10/2026): o
  // controle mudou para o módulo Rescisões, e a lista daqui mostra em que pé
  // ele está, com o atalho para lá. Sem ficha ainda = "Por fazer".
  const [statusRescisao, setStatusRescisao] = useState<Map<number, string>>(new Map());
  useEffect(() => {
    if (etapa !== "rh") return;
    (async () => {
      const mapa = new Map<number, string>();
      for (let de = 0; ; de += 1000) {
        const { data, error } = await sb.from(TABELA_RESCISAO).select("solicitacao_id,status_rescisao")
          .not("solicitacao_id", "is", null).order("id").range(de, de + 999);
        if (error) { console.warn("RH_RESCISAO:", error.message); break; }
        for (const r of (data ?? []) as { solicitacao_id: number; status_rescisao: string | null }[]) {
          if (r.status_rescisao) mapa.set(r.solicitacao_id, r.status_rescisao);
        }
        if (!data || data.length < 1000) break;
      }
      setStatusRescisao(mapa);
    })();
  }, [etapa, todas]);

  // Quem decidiu: o nome que fica gravado na solicitação.
  const [quemSou, setQuemSou] = useState("");
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("display_name, email").eq("id", user.id).maybeSingle();
      setQuemSou(data?.display_name ?? data?.email ?? user.email ?? "");
    })();
  }, [user?.id, user?.email]);

  const decidir = async (s: SolicitacaoDemissao, patch: Record<string, unknown>, aviso: string) => {
    const { error } = await sb.from(TABELA)
      .update({ ...patch, atualizado_em: new Date().toISOString() }).eq("id", s.id);
    if (error) { toast.error("Erro ao salvar: " + error.message); return false; }
    toast.success(aviso);
    setAberta(null);
    carregar();
    return true;
  };

  // UMA TELA SÓ (21/10/2026). O RH tinha duas abas — "Rescisões" (a planilha
  // do RH) e "Fila do fluxo" —, e o pedido foi "tira a fila de fluxo, deixa
  // tudo numa tela só, mais simples". A planilha virou o módulo Rescisões
  // (kanban, mig 20261021000030); aqui ficou a lista das solicitações, com o
  // status da rescisão numa coluna e o atalho para lá. Os cartões do topo são
  // o filtro de status; os chips abaixo deles, o status um a um.
  const [exibir, setExibir] = useState(100);
  useEffect(() => { setExibir(100); }, [fStatus, fMes, busca, fContratos]);
  const statusComLinhas = useMemo(
    () => statusVisiveis.map((st) => [st, linhas.filter((s) => s.status === st).length] as const).filter(([, n]) => n > 0),
    [statusVisiveis, linhas],
  );

  const kpis: { titulo: string; grupo: string[]; icone: LucideIcon; cor: string }[] =
    etapa === "analista" || etapa === "operacional" || etapa === "diretoria" ? [
      { titulo: etapa === "analista" ? "Em aprovação" : "Aguardando você",
        grupo: etapa === "diretoria" ? ["Pendente Diretoria"] : etapa === "operacional" ? ["Pendente Operacional"] : ["Pendente Operacional", "Pendente Diretoria"],
        icone: Clock, cor: "bg-yellow-100 text-yellow-700" },
      { titulo: "No RH", grupo: ["Pendente RH"], icone: FileText, cor: "bg-purple-100 text-purple-700" },
      // "No SST" soma os dois status da etapa: para quem acompanha de fora,
      // recebida e a agendar são o mesmo lugar da fila.
      { titulo: "No SST", grupo: ["Pendente SST", STATUS_SST_RECEBIDA], icone: Stethoscope, cor: "bg-cyan-100 text-cyan-700" },
      { titulo: "Agendadas", grupo: [STATUS_SST_AGENDADO, "Concluída"], icone: CheckCircle2, cor: "bg-green-100 text-green-700" },
      { titulo: "Reprovadas", grupo: ["Reprovada"], icone: XCircle, cor: "bg-red-100 text-red-700" },
    ] : etapa === "sst" ? [
      { titulo: "A receber", grupo: ["Pendente SST"], icone: Clock, cor: "bg-cyan-100 text-cyan-700" },
      { titulo: "A agendar", grupo: [STATUS_SST_RECEBIDA], icone: Stethoscope, cor: "bg-sky-100 text-sky-700" },
      { titulo: "Agendadas", grupo: [STATUS_SST_AGENDADO], icone: CheckCircle2, cor: "bg-emerald-100 text-emerald-700" },
    ] : [
      { titulo: "Aguardando você", grupo: ["Pendente RH"], icone: Clock, cor: "bg-purple-100 text-purple-700" },
      { titulo: "Pedidos de cancelamento", grupo: [STATUS_CANCELAMENTO_SOLICITADO], icone: Ban, cor: "bg-red-600 text-white" },
      { titulo: "No SST", grupo: ["Pendente SST", STATUS_SST_RECEBIDA], icone: Stethoscope, cor: "bg-cyan-100 text-cyan-700" },
      { titulo: "Concluídas", grupo: [STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, "Concluída"], icone: CheckCircle2, cor: "bg-green-100 text-green-700" },
    ];

  return (
    <>
      <div className={cn("mb-4 grid gap-3 sm:grid-cols-2",
        kpis.length >= 5 ? "lg:grid-cols-3 xl:grid-cols-5" : kpis.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {kpis.map((k) => (
          <Kpi key={k.titulo} titulo={k.titulo} valor={k.grupo.reduce((n, st) => n + contar(st), 0)} icone={k.icone} cor={k.cor}
            ativo={grupoAtivo(k.grupo)} onClick={() => filtrarGrupo(k.grupo)} />
        ))}
      </div>

      <Card>
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Colaborador, CPF, solicitante, contrato, nº…"
                value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <FiltroContratos linhas={linhas} campo="contrato" selecionados={fContratos} onChange={setFContratos} rotulo="Contratos" />
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              Aberta em
              <Input type="month" className="w-[150px]" value={fMes} onChange={(e) => setFMes(e.target.value)} />
            </div>
            {filtroAtivo && (
              <Button variant="ghost" size="sm" onClick={limparFiltros}><X className="mr-1 h-4 w-4" /> Limpar</Button>
            )}
            <div className="ml-auto flex items-center gap-2">
              {etapa === "rh" && (
                <Button variant="outline" asChild>
                  <Link to="/app/rh/rescisoes">Rescisões <ArrowUpRight className="ml-1 h-4 w-4" /></Link>
                </Button>
              )}
              <Button variant="outline" onClick={carregar} disabled={carregando}>
                {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
              </Button>
            </div>
          </div>
          {statusComLinhas.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {statusComLinhas.map(([st, n]) => {
                const ativo = fStatus.length === 1 && fStatus[0] === st;
                return (
                  <button key={st} type="button" onClick={() => setFStatus(ativo ? [] : [st])}
                    className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium transition", corDoStatus(st),
                      ativo ? "ring-2 ring-primary ring-offset-1" : "opacity-80 hover:opacity-100")}>
                    {st} <b>{n}</b>
                  </button>
                );
              })}
            </div>
          )}
        </CardHeader>
        <CardContent>
          <CardTitle className="mb-2 text-sm font-medium text-muted-foreground">
            {filtradas.length} de {linhas.length} solicitação(ões)
          </CardTitle>
          {carregando ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : filtradas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {linhas.length === 0
                ? "Nenhuma solicitação de demissão por aqui ainda."
                : "Nada bate com o filtro atual."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-[13px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Colaborador</TableHead>
                    <TableHead className="hidden md:table-cell">Contrato</TableHead>
                    <TableHead className="hidden lg:table-cell">Solicitante</TableHead>
                    <TableHead className="hidden sm:table-cell">Datas</TableHead>
                    <TableHead>Status</TableHead>
                    {etapa === "rh" && <TableHead className="hidden xl:table-cell">Rescisão</TableHead>}
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.slice(0, exibir).map((s) => {
                    const minha = precisaDeMim(s);
                    return (
                      <TableRow key={s.id} className={cn("cursor-pointer align-top", minha && "bg-primary/[0.03]")} onClick={() => setAberta(s)}>
                        <TableCell>
                          <div className="font-medium leading-snug">{s.colaborador_nome}</div>
                          <div className="text-xs text-muted-foreground">#{s.id} · {s.colaborador_posto || "—"}</div>
                        </TableCell>
                        <TableCell className="hidden max-w-[260px] text-xs md:table-cell">{s.contrato || "—"}</TableCell>
                        <TableCell className="hidden text-xs lg:table-cell">{s.solicitante_nome || "—"}</TableCell>
                        <TableCell className="hidden text-xs sm:table-cell">
                          <dl className="grid grid-cols-[auto_1fr] gap-x-2">
                            <dt className="text-muted-foreground">Aberta</dt><dd>{fmtData(s.criado_em)}</dd>
                            {s.data_aviso && <><dt className="text-muted-foreground">Aviso</dt><dd>{fmtData(s.data_aviso)}</dd></>}
                            {s.rh_ultima_data_trabalhada && <><dt className="text-muted-foreground">Últ. dia</dt><dd>{fmtData(s.rh_ultima_data_trabalhada)}</dd></>}
                          </dl>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <Badge variant="outline" className={cn("whitespace-normal text-left", corDoStatus(s.status))}>
                              {s.status === STATUS_CANCELAMENTO_SOLICITADO && <Ban className="mr-1 h-3 w-3" />}
                              {s.status}
                            </Badge>
                            {/* Um card devolvido está no MESMO status de um que
                                nunca saiu do Operacional. Sem o selo, os dois se
                                parecem na lista e o retrabalho some no meio. */}
                            {s.devolvido_em && (
                              <Badge variant="outline" className="border-amber-300 bg-amber-100 text-amber-800">
                                <Undo2 className="mr-1 h-3 w-3" /> Devolvida
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {etapa === "rh" && (
                          <TableCell className="hidden xl:table-cell">
                            {s.status !== "Cancelada" && (
                              <Badge variant="outline" className={cn("whitespace-normal text-left text-[11px]", corStatusRescisao(statusRescisao.get(s.id) ?? "Por fazer"))}>
                                {statusRescisao.get(s.id) ?? "Por fazer"}
                              </Badge>
                            )}
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <Button variant={minha ? "default" : "ghost"} size="sm" onClick={(e) => { e.stopPropagation(); setAberta(s); }}>
                            {minha ? "Analisar" : "Ver"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {filtradas.length > exibir && (
                <div className="mt-3 text-center">
                  <Button variant="outline" onClick={() => setExibir((n) => n + 200)}>
                    Mostrar mais ({filtradas.length - exibir} restantes)
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <DetalheSolicitacao
        solicitacao={aberta} etapa={etapa} quemSou={quemSou}
        onFechar={() => setAberta(null)} onDecidir={decidir}
        onCancelada={() => { setAberta(null); carregar(); }}
      />
    </>
  );
}

// ── Detalhe + decisão ────────────────────────────────────────────────
function DetalheSolicitacao({ solicitacao, etapa, quemSou, onFechar, onDecidir, onCancelada }: {
  solicitacao: SolicitacaoDemissao | null;
  etapa: Etapa;
  quemSou: string;
  onFechar: () => void;
  onDecidir: (s: SolicitacaoDemissao, patch: Record<string, unknown>, aviso: string) => Promise<boolean>;
  /** O RH cancelou por reconsideração (RPC, não patch): fecha e recarrega. */
  onCancelada: () => void;
}) {
  const [anexos, setAnexos] = useState<AnexoDemissao[]>([]);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  // RH → SST (17/09/2026): a última data trabalhada é obrigatória e passa por
  // confirmação antes de liberar — é a data que o SST usa pro ASO demissional.
  const [ultimaData, setUltimaData] = useState("");
  const [confirmandoData, setConfirmandoData] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // O motivo da DEVOLUÇÃO é campo à parte do motivo da reprovação: são duas
  // recusas diferentes, de gente diferente, e um estado só faria o texto de
  // uma aparecer no formulário da outra.
  const [motivoDevolucao, setMotivoDevolucao] = useState("");
  // Aprovar SEM a vaga de Substituição (17/09/2026) exige o motivo da
  // exceção — campo próprio, porque o `motivo` acima é o da reprovação.
  const [motivoSemVaga, setMotivoSemVaga] = useState("");
  const [devolvendo, setDevolvendo] = useState(false);
  // O ASO demissional — os mesmos quatro campos do ASO de admissão.
  const [aso, setAso] = useState({ data: "", hora: "", local: "", maps: "" });
  // Texto que centraliza o mapa; só muda quando o SST sai do campo "local",
  // senão o mapa saltaria a cada tecla digitada.
  const [mapPrev, setMapPrev] = useState("");

  useEffect(() => {
    setMotivo(""); setObservacao(""); setMotivoSemVaga(""); setUltimaData(""); setConfirmandoData(false); setAnexos([]);
    // Reabrir uma já marcada mostra o que está gravado — reagendar é editar o
    // que está lá, não redigitar do zero.
    setAso({
      data: solicitacao?.sst_data_exame ?? "",
      hora: solicitacao?.sst_hora_exame ?? "",
      local: solicitacao?.sst_local_exame ?? "",
      maps: solicitacao?.sst_maps_url ?? "",
    });
    setMapPrev(solicitacao?.sst_local_exame ?? "");
    if (!solicitacao) return;
    (async () => {
      const { data } = await sb.from(TABELA_ANEXOS)
        .select("*").eq("solicitacao_id", solicitacao.id).order("id");
      setAnexos(data ?? []);
    })();
    // Só o id nas deps, de propósito: o card recarrega ao TROCAR de solicitação,
    // não a cada refresh da lista (que zeraria o que está sendo digitado).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitacao?.id]);

  if (!solicitacao) return null;
  const s = solicitacao;
  const podeAgir = STATUS_DE_ACAO[etapa].includes(s.status);
  // Sem vaga de Substituição aberta, a etapa 1 só aprova com o motivo da
  // exceção escrito (o banco trava o pedido que respondeu "Sim"; o que
  // respondeu "Não" passa, mas fica registrado por quê).
  const semVaga = aprovarPedeMotivoSemVaga(s);

  // O bucket é privado: o documento abre por URL assinada, válida por 1 hora.
  const abrirAnexo = async (a: AnexoDemissao) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Não consegui abrir o documento."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  // O OPERACIONAL é a primeira porta (de novo, desde 14/09/2026) — as
  // colunas `operacional_*` voltaram a bater com quem decide.
  const aprovar = async () => {
    // Sem a vaga, o motivo da exceção é obrigatório — e é ele que o trigger
    // demissao_exige_vaga aceita no lugar do vaga_id (mig 000169).
    if (semVaga && !temMotivoSemVaga(motivoSemVaga)) {
      toast.error(`Descreva o motivo da exceção — essa demissão não tem vaga de Substituição aberta (mín. ${MOTIVO_SEM_VAGA_MIN} caracteres).`);
      return;
    }
    setSalvando(true);
    await onDecidir(s, {
      status: "Pendente RH", operacional_por: quemSou,
      operacional_em: new Date().toISOString(), operacional_motivo: null,
      ...(semVaga ? { sem_vaga_motivo: motivoSemVaga.trim() } : {}),
    }, semVaga
      ? `Solicitação #${s.id} aprovada SEM vaga de Substituição e enviada ao RH.`
      : `Solicitação #${s.id} aprovada e enviada ao RH.`);
    setSalvando(false);
  };

  const reprovar = async () => {
    // Reprovar sem motivo devolve o encarregado ao ponto de partida sem saber
    // o que corrigir — por isso o motivo é obrigatório aqui, não opcional.
    if (motivo.trim().length < 10) { toast.error("Escreva o motivo da reprovação (mín. 10 caracteres)."); return; }
    setSalvando(true);
    await onDecidir(s, {
      status: "Reprovada", operacional_por: quemSou,
      operacional_em: new Date().toISOString(), operacional_motivo: motivo.trim(),
    }, `Solicitação #${s.id} reprovada.`);
    setSalvando(false);
  };

  // O RH confere o desligamento e LIBERA para o SST agendar o ASO — desde
  // 08/09/2026 ele não é mais quem fecha, é quem passa a bola para a última
  // etapa. O carimbo continua em `rh_*`: a coluna diz quando o RH falou, não
  // que ele encerrou.
  // Primeiro clique valida a data e abre a confirmação ("Confirma?"); o
  // segundo grava. A data vai junto pro SST (rh_ultima_data_trabalhada).
  const pedirConfirmacaoData = () => {
    // Pode ser futura — até 60 dias (o colaborador ainda cumprindo aviso).
    const erro = erroUltimaDataTrabalhada(ultimaData);
    if (erro) { toast.error(erro); return; }
    setConfirmandoData(true);
  };
  const liberarParaSST = async () => {
    if (!ultimaData) { toast.error("Informe a última data trabalhada do colaborador."); return; }
    setSalvando(true);
    await onDecidir(s, {
      status: "Pendente SST", rh_por: quemSou,
      rh_em: new Date().toISOString(), rh_observacao: observacao.trim() || null,
      rh_ultima_data_trabalhada: ultimaData,
    }, `Solicitação #${s.id} liberada pelo RH — segue para o SST agendar o ASO.`);
    setSalvando(false);
    setConfirmandoData(false);
  };

  /**
   * O SST avisa que PEGOU a solicitação, antes de ter data marcada.
   *
   * É o status que responde à pergunta que mais chega ao SST: "vocês viram meu
   * pedido?". Sem ele o card ficava em "Pendente SST" do envio até a clínica
   * responder, e nesse intervalo ninguém sabia se estava parado ou andando.
   */
  const receberSolicitacao = async () => {
    setSalvando(true);
    await onDecidir(s, {
      status: STATUS_SST_RECEBIDA,
    }, `Solicitação #${s.id} marcada como recebida pelo SST.`);
    setSalvando(false);
  };

  /**
   * Devolve ao Operacional, com o motivo escrito.
   *
   * É o "reprovar" do SST e do RH: a solicitação volta para a primeira porta
   * em vez de ser concluída errada ou abandonada. `patchDevolucao` limpa os
   * carimbos das etapas já cumpridas — ver o comentário lá.
   */
  const devolver = async () => {
    if (motivoDevolucao.trim().length < MOTIVO_DEVOLUCAO_MIN) {
      toast.error(`Escreva o que precisa ser corrigido (mín. ${MOTIVO_DEVOLUCAO_MIN} caracteres) — é o que o Operacional vai ler.`);
      return;
    }
    setSalvando(true);
    const volta = statusDaEtapa1(s);
    await onDecidir(
      s,
      patchDevolucao(etapa as EtapaQueDevolve, quemSou, motivoDevolucao, volta),
      `Solicitação #${s.id} devolvida ${volta === "Pendente Diretoria" ? "à Diretoria" : "ao Operacional"}.`,
    );
    setSalvando(false);
  };

  /**
   * O SST agenda o ASO — e com isso FECHA a demissão.
   *
   * Só a partir de "recebida": os dois passos são sequenciais. Ver o bloco do
   * SST no formulário, que explica por que o atalho foi retirado.
   */
  const marcarASO = async () => {
    if (!aso.data) { toast.error("Informe a data do ASO."); return; }
    setSalvando(true);
    await onDecidir(s, {
      status: STATUS_SST_AGENDADO,
      sst_data_exame: aso.data,
      sst_hora_exame: aso.hora.trim() || null,
      sst_local_exame: aso.local.trim() || null,
      sst_maps_url: aso.maps.trim() || null,
      sst_observacao: observacao.trim() || null,
      sst_por: quemSou, sst_em: new Date().toISOString(),
    }, `ASO demissional agendado — solicitação #${s.id} concluída.`);
    setSalvando(false);
  };

  /**
   * O ASO ainda vale — conclui sem exame.
   *
   * Quem fez ASO há menos de 90 dias não precisa de demissional (NR-7; era 60 até 15/09/2026). O
   * SST confirma isso aqui e a demissão fecha na hora, sem data, hora nem
   * local. Mesmo passo do agendamento (depois de "recebida"), pelo mesmo
   * motivo: o SST precisa ter lido o pedido para saber que o exame vale.
   */
  const marcarASOValido = async () => {
    setSalvando(true);
    await onDecidir(s, {
      status: STATUS_SST_ASO_VALIDO,
      sst_data_exame: null, sst_hora_exame: null, sst_local_exame: null, sst_maps_url: null,
      sst_observacao: observacao.trim() || null,
      sst_por: quemSou, sst_em: new Date().toISOString(),
    }, `ASO válido — solicitação #${s.id} concluída sem exame.`);
    setSalvando(false);
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl grid-cols-[minmax(0,1fr)] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Solicitação #{s.id} · {s.colaborador_nome}
            <Badge variant="outline" className={corDoStatus(s.status)}>{s.status}</Badge>
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">{explicaStatus(s.status)}</p>

        <Secao titulo="Colaborador" itens={[
          ["Nome", s.colaborador_nome], ["CPF", s.colaborador_cpf],
          ["Posto", s.colaborador_posto], ["Cargo", s.colaborador_cargo],
          ["Contrato", s.contrato], ["Escala", s.escala],
          ["Admissão", fmtData(s.colaborador_admissao)],
          ["Telefone", s.colaborador_telefone], ["E-mail", s.colaborador_email],
        ]} />

        <Secao titulo="Solicitação" itens={[
          ["Solicitante", s.solicitante_nome], ["E-mail do solicitante", s.solicitante_email],
          ["Data da solicitação", fmtData(s.data_solicitacao)],
          ["Motivo da solicitação", s.motivo_solicitacao], ["Motivo do pedido", s.motivo_pedido],
        ]} />

        <div className="rounded-lg border p-4">
          <h3 className="mb-1 text-sm font-semibold">Relato do encarregado</h3>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{s.relato || "—"}</p>
        </div>

        <Secao titulo="Aviso" itens={[
          ["Término de experiência", s.termino_experiencia],
          ["Data do aviso", fmtData(s.data_aviso)],
          ["Modelo de aviso", s.modelo_aviso],
        ]} />

        <div className="rounded-lg border p-4">
          <h3 className="mb-2 text-sm font-semibold">Documentos ({anexos.length})</h3>
          {anexos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum documento anexado.</p>
          ) : (
            <ul className="space-y-2">
              {anexos.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.nome}</span>
                  <span className="text-xs text-muted-foreground">{fmtTamanho(a.tamanho)}</span>
                  <Button variant="ghost" size="sm" onClick={() => abrirAnexo(a)}>
                    <Download className="mr-1 h-4 w-4" /> Abrir
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* O ASO já marcado — em destaque, porque é a informação que o
            encarregado e o colaborador precisam ter em mãos (onde e quando
            comparecer), não um carimbo de auditoria. */}
        {s.sst_data_exame && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <h3 className="mb-1 text-sm font-semibold text-emerald-800">ASO demissional marcado</h3>
            <p className="text-sm text-emerald-900">{resumoDoASO(s)}</p>
            {linkDoLocalASO(s) && (
              <a href={linkDoLocalASO(s)!} target="_blank" rel="noopener noreferrer"
                 className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-sky-700 hover:underline">
                <MapPin className="h-3.5 w-3.5" /> Ver no mapa
              </a>
            )}
            {s.sst_observacao && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-emerald-900/80">{s.sst_observacao}</p>
            )}
          </div>
        )}

        {/* A última data trabalhada, em destaque pra quem vem depois do RH —
            o SST agenda o ASO demissional a partir dela (17/09/2026). */}
        {s.rh_ultima_data_trabalhada && (
          <div className="flex items-center gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
            <Clock className="h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <div className="text-[12px] font-bold uppercase tracking-wide text-amber-900">Última data trabalhada (informada pelo RH)</div>
              <div className="text-lg font-black text-amber-950">{fmtData(s.rh_ultima_data_trabalhada)}</div>
            </div>
          </div>
        )}

        {/* Histórico das decisões já tomadas */}
        {(s.operacional_em || s.rh_em || s.sst_em) && (
          <Secao titulo="Decisões" itens={[
            ["Operacional", s.operacional_por ? `${s.operacional_por} · ${fmtDataHora(s.operacional_em)}` : "—"],
            ["Motivo da reprovação", s.operacional_motivo],
            ["⚠ Aprovada SEM vaga de Substituição — motivo", s.sem_vaga_motivo],
            ["RH", s.rh_por ? `${s.rh_por} · ${fmtDataHora(s.rh_em)}` : "—"],
            ["Última data trabalhada (RH)", s.rh_ultima_data_trabalhada ? fmtData(s.rh_ultima_data_trabalhada) : null],
            ["Observação do RH", s.rh_observacao],
            ["SST (ASO)", s.sst_por ? `${s.sst_por} · ${fmtDataHora(s.sst_em)}` : "—"],
          ]} />
        )}

        {/* Cancelada pelo encarregado (17/09/2026): em vermelho, com o motivo. */}
        <AvisoCancelada solicitacao={s} />
        {/* Pedido de cancelamento esperando o RH, ou a recusa dele (25/09/2026). */}
        {etapa !== "rh" && <AvisoPedidoCancelamento solicitacao={s} />}

        {/* A devolução vem PRIMEIRO no detalhe, antes de qualquer campo: é a
            única coisa que importa num card que voltou, e enterrá-la no meio
            faria o Operacional reaprovar o mesmo erro. */}
        {s.devolvido_em && (
          <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <Undo2 className="h-4 w-4" /> {resumoDevolucao(s)}
            </p>
            <p>{s.devolvido_motivo}</p>
          </div>
        )}

        {/* O analista acompanha, não decide. Dizer isso é melhor do que
            simplesmente não desenhar botão nenhum: sem a frase, quem abria o
            card ficava procurando onde clicar. */}
        {etapa === "analista" && (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            <Eye className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Esta tela é de <strong>acompanhamento</strong> das demissões de contrato. Quem aprova é o
              Operacional (Operacional › Solicitações de Demissão); as do administrativo ou com setor
              ficam com a Diretoria e não aparecem aqui.
            </span>
          </div>
        )}

        {/* Ações da etapa */}
        {podeAgir && (etapa === "operacional" || etapa === "diretoria") && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Sua decisão</h3>
            {/* Sem vaga de Substituição aberta: aviso em destaque e o motivo
                da exceção obrigatório para aprovar (17/09/2026). Fica ANTES
                do motivo da reprovação para não passar batido. */}
            {semVaga && (
              <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                <p className="text-sm font-bold uppercase tracking-wide text-amber-900">
                  ⚠ Essa demissão não tem vaga de Substituição aberta. Descreva o motivo da exceção:
                </p>
                <Textarea id="motivo-sem-vaga" className="bg-white"
                  placeholder={`Obrigatório para aprovar sem a vaga — por que não haverá substituição? (mín. ${MOTIVO_SEM_VAGA_MIN} caracteres)`}
                  value={motivoSemVaga} onChange={(e) => setMotivoSemVaga(e.target.value)} />
                <p className="text-xs text-amber-800">
                  O motivo fica gravado na solicitação e aparece para o RH e o SST.
                  {s.vaga_obrigatoria ? " Quem solicitou tinha pedido a substituição — a vaga ainda pode ser aberta depois em Encarregados › Solicitações de Demissão." : ""}
                </p>
              </div>
            )}
            <div>
              <Label htmlFor="motivo">Motivo da reprovação</Label>
              <Textarea id="motivo" className="mt-1" placeholder="Obrigatório só para reprovar — explique o que precisa ser corrigido."
                value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={aprovar} disabled={salvando}>
                <ThumbsUp className="mr-2 h-4 w-4" /> Aprovar e enviar ao RH
              </Button>
              <Button variant="destructive" onClick={reprovar} disabled={salvando}>
                <ThumbsDown className="mr-2 h-4 w-4" /> Reprovar
              </Button>
            </div>
          </div>
        )}

        {podeAgir && etapa === "rh" && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Liberar para o SST</h3>
            <p className="text-sm text-muted-foreground">
              Confira o desligamento e libere: o SST recebe a solicitação e agenda o ASO
              demissional, que é a última etapa.
            </p>
            {/* Última data trabalhada (17/09/2026): obrigatória, confirmada, e vai
                pro SST — é a data que baliza o ASO demissional. */}
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
              <Label htmlFor="ultima-data" className="text-[13px] font-bold uppercase tracking-wide text-amber-900">
                Qual foi a última data trabalhada do colaborador? *
              </Label>
              <Input id="ultima-data" type="date" className="mt-1 max-w-xs bg-white" max={limiteUltimaDataTrabalhada()}
                value={ultimaData} onChange={(e) => { setUltimaData(e.target.value); setConfirmandoData(false); }} />
              <p className="mt-1 text-xs text-amber-800">Essa data vai junto pro SST e aparece no card dele.</p>
            </div>
            <div>
              <Label htmlFor="obs">Observação (opcional)</Label>
              <Textarea id="obs" className="mt-1" placeholder="O que foi feito, datas do acerto, pendências…"
                value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>
            {!confirmandoData ? (
              <Button onClick={pedirConfirmacaoData} disabled={salvando}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Liberar e enviar ao SST
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary bg-white p-3">
                <div className="text-sm">
                  <span className="font-bold">Confirma?</span> Última data trabalhada de <b>{s.colaborador_nome}</b>: <b>{fmtData(ultimaData)}</b>.
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setConfirmandoData(false)} disabled={salvando}>Corrigir</Button>
                  <Button onClick={liberarParaSST} disabled={salvando}>
                    <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmo — liberar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {/* CANCELAR | RECONSIDERAÇÃO (18/09/2026): só em Pendente RH. Motivo
            obrigatório, anexo opcional, duas confirmações — o bloco decide
            sozinho se aparece (podeCancelarDemissaoRH). */}
        {/* Não depende de podeAgir (só Pendente RH): o RH também cancela com a
            solicitação no SST (21/09/2026) — o bloco decide pelo status. */}
        {/* PEDIDO do encarregado (25/09/2026): o RH aprova ou recusa aqui. */}
        {etapa === "rh" && (
          <BlocoDecidirCancelamentoRH solicitacao={s} onDecidido={onCancelada}
            avisar={(msg, tipo) => (tipo === "err" ? toast.error(msg) : tipo === "ok" ? toast.success(msg) : toast.info(msg))} />
        )}
        {etapa === "rh" && s.cancel_recusa_em && s.status !== STATUS_CANCELAMENTO_SOLICITADO && <AvisoPedidoCancelamento solicitacao={s} />}
        {etapa === "rh" && (
          <BlocoCancelarReconsideracaoRH solicitacao={s} onCancelada={onCancelada}
            avisar={(msg, tipo) => (tipo === "err" ? toast.error(msg) : tipo === "ok" ? toast.success(msg) : toast.info(msg))} />
        )}
        {/* SST — os MESMOS campos do ASO de admissão (pages/sst/AsoCandidatos),
            inclusive o seletor no mapa: é a mesma ficha, na outra ponta. */}
        {/* PASSO 1 do SST — receber. Enquanto a solicitação está em
            "Pendente SST" esta é a ÚNICA ação: o formulário do ASO nem é
            desenhado.

            Os dois passos são sequenciais de propósito. A primeira versão
            deixava agendar direto, para poupar um clique de quem já tinha a
            data em mãos — mas aí o status "recebida" virava opcional, e um
            status que dá para pular não responde mais a pergunta para a qual
            ele foi criado: o encarregado continuaria sem saber se o SST viu o
            pedido. Um clique a mais é o preço de o status significar algo. */}
        {podeAgir && etapa === "sst" && acaoDoSST(s.status) === "receber" && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Receber a solicitação</h3>
            <p className="text-sm text-muted-foreground">
              Confirme que o pedido de agendamento chegou ao SST. O encarregado passa a ver
              <strong> Solicitação de agendamento de DEMISSIONAL recebida</strong>, e o
              agendamento do ASO abre no passo seguinte.
            </p>
            <Button onClick={receberSolicitacao} disabled={salvando}>
              <Stethoscope className="mr-2 h-4 w-4" /> Solicitação recebida
            </Button>
          </div>
        )}

        {/* PASSO 2 do SST — agendar. Só existe depois de recebida.
            Os MESMOS campos do ASO de admissão (pages/sst/AsoCandidatos),
            inclusive o seletor no mapa: é a mesma ficha, na outra ponta. */}
        {podeAgir && etapa === "sst" && acaoDoSST(s.status) === "agendar" && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Agendar o ASO demissional</h3>

            <p className="text-sm text-muted-foreground">
              Informe data, hora e local do exame. Agendar o ASO <strong>conclui</strong> a
              demissão — e o encarregado passa a ver tudo isso na solicitação dele.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="aso-data">Data do ASO <span className="text-destructive">*</span></Label>
                <Input id="aso-data" type="date" className="mt-1" value={aso.data}
                  onChange={(e) => setAso((v) => ({ ...v, data: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="aso-hora">Horário</Label>
                <Input id="aso-hora" className="mt-1" placeholder="Ex.: 09:00" value={aso.hora}
                  onChange={(e) => setAso((v) => ({ ...v, hora: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label htmlFor="aso-local">Local do exame</Label>
              <Input id="aso-local" className="mt-1" placeholder="Clínica / endereço" value={aso.local}
                onChange={(e) => setAso((v) => ({ ...v, local: e.target.value }))}
                onBlur={() => setMapPrev(aso.local.trim())} />
            </div>

            <div>
              <Label htmlFor="aso-maps">Local exato no Google Maps (opcional)</Label>
              <Input id="aso-maps" className="mt-1" placeholder="Cole o link do Maps (Compartilhar → Copiar link)"
                value={aso.maps} onChange={(e) => setAso((v) => ({ ...v, maps: e.target.value }))} />
              <p className="mt-1 text-xs text-muted-foreground">
                Ou clique no ponto exato no mapa abaixo — o endereço e o link são preenchidos sozinhos.
              </p>
            </div>

            <MapaPicker busca={mapPrev}
              onPick={({ nome, url }) => setAso((v) => ({ ...v, maps: url, local: nome || v.local }))} />

            <div>
              <Label htmlFor="obs-sst">Observação (opcional)</Label>
              <Textarea id="obs-sst" className="mt-1" placeholder="Clínica, orientações ao colaborador, pendências…"
                value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>

            <Button onClick={marcarASO} disabled={salvando}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Agendamento concluído
            </Button>

            {/* A saída sem exame. Fica no mesmo bloco, abaixo, porque é a
                mesma decisão do SST ("o que fazer com este ASO?") — só que a
                resposta é "nada, o que ele tem ainda vale". */}
            <div className="mt-2 space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
              <h4 className="text-sm font-semibold text-emerald-900">ASO ainda válido (menos de 90 dias)</h4>
              <p className="text-sm text-emerald-900/80">
                O colaborador fez ASO há menos de 90 dias e o exame vale como demissional. Marcar
                aqui <strong>conclui</strong> a demissão sem agendar nada — a observação acima, se
                escrita, vai junto.
              </p>
              {/* Verde sólido, e não outline: é uma ação de CONCLUIR, do mesmo
                  peso do "Agendamento concluído" logo acima — só que a que
                  fecha sem exame. Botão apagado passava a ideia de opção
                  secundária, quando é uma das duas saídas do passo. */}
              <Button className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={marcarASOValido} disabled={salvando}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> ASO válido — concluir sem exame
              </Button>
            </div>
          </div>
        )}

        {/* DEVOLVER AO OPERACIONAL — o "reprovar" do SST e do RH.
            Fica fora dos blocos de cada etapa porque é a mesma ação nas duas,
            e recolhido por padrão: devolver é a exceção, não o caminho. */}
        {podeDevolver(etapa, s.status) && (
          <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Undo2 className="h-4 w-4" /> Devolver ao Operacional
            </h3>
            <p className="text-sm text-muted-foreground">
              Use quando a solicitação vier com erro. Ela volta para a fila do Operacional com o que
              você escrever aqui, e o que já tinha sido carimbado nas etapas seguintes é desfeito —
              quando voltar, passa pelo RH e pelo SST de novo.
            </p>
            <div>
              <Label htmlFor="motivo-devolucao">
                O que precisa ser corrigido <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="motivo-devolucao"
                className="mt-1"
                placeholder="Ex.: a data do aviso prévio não bate com o desligamento; falta o documento assinado."
                value={motivoDevolucao}
                onChange={(e) => setMotivoDevolucao(e.target.value)}
              />
            </div>
            {!devolvendo ? (
              <Button variant="outline" onClick={() => setDevolvendo(true)} disabled={salvando}>
                <Undo2 className="mr-2 h-4 w-4" /> Devolver ao Operacional
              </Button>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Devolver mesmo? O que já foi feito se perde.</span>
                <Button variant="destructive" onClick={devolver} disabled={salvando}>
                  <Undo2 className="mr-2 h-4 w-4" /> Sim, devolver
                </Button>
                <Button variant="ghost" onClick={() => setDevolvendo(false)} disabled={salvando}>
                  Cancelar
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Quem pediu a demissão escreve do lado dele, em Minhas Solicitações.
            É o mesmo fio — sem este bloco, o encarregado perguntava e nem o
            Operacional nem o RH viam. */}
        <ConversaSolicitacao
          modulo="demissao" entidadeId={s.id}
          aviso="Quem solicitou lê e responde por Encarregados › Minhas Solicitações. Operacional, RH e SST veem a mesma conversa."
        />
      </DialogContent>
    </Dialog>
  );
}

function Secao({ titulo, itens }: { titulo: string; itens: [string, string | null | undefined][] }) {
  const preenchidos = itens.filter(([, v]) => v);
  if (!preenchidos.length) return null;
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        {preenchidos.map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-[13px] font-bold uppercase tracking-wide text-slate-700">{rotulo}</dt>
            <dd className="break-words">{valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
