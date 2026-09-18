import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BUCKET, MOTIVO_DEVOLUCAO_MIN, MOTIVO_SEM_VAGA_MIN, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, STATUS_SST_RECEBIDA, acaoDoSST,
  aprovarPedeMotivoSemVaga, temMotivoSemVaga,
  TABELA, TABELA_ANEXOS, corDoStatus, explicaStatus,
  erroUltimaDataTrabalhada, limiteUltimaDataTrabalhada,
  fmtData, fmtDataHora, fmtTamanho, linkDoLocalASO, normSetorDemissao, patchDevolucao, podeDevolver,
  resumoDevolucao, resumoDoASO, statusDaEtapa1, visivelNaEtapaDemissao,
  type AnexoDemissao, type EtapaQueDevolve, type SolicitacaoDemissao,
} from "@/lib/demissao/solicitacao";
import { MapaPicker } from "@/components/sst/MapaPicker";
import {
  CheckCircle2, Clock, Download, Eye, FileText, Loader2, MapPin, Search, Stethoscope,
  ThumbsDown, ThumbsUp, Undo2, XCircle,
} from "lucide-react";
import { ConversaSolicitacao } from "@/components/solicitacoes/ConversaSolicitacao";
import { AvisoCancelada } from "@/components/demissao/CancelarDemissao";
import { BlocoCancelarReconsideracaoRH } from "@/components/demissao/CancelarReconsideracaoRH";
import { TABELA_APROVADOR_SETOR } from "@/components/admin/TrocaFuncaoSetoresUsuario";
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
  "Concluída", "Reprovada", "Cancelada",
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
  sst: ["Pendente SST", STATUS_SST_RECEBIDA, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO],
  // O RH continua vendo o que despachou — a pergunta que mais chega depois de
  // liberar é "e aí, o SST agendou?".
  // E as CANCELADAS (18/09/2026): desde que o próprio RH cancela por
  // reconsideração, sumir da fila sem rastro parecia erro.
  rh: ["Pendente RH", "Pendente SST", STATUS_SST_RECEBIDA, STATUS_SST_AGENDADO, STATUS_SST_ASO_VALIDO, "Cancelada"],
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

function Kpi({ titulo, valor, icone: Icone, cor }: {
  titulo: string; valor: number; icone: LucideIcon; cor: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", cor)}>
          <Icone className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
          <p className="text-2xl font-bold leading-tight">{valor}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function PainelDemissoes({ etapa }: { etapa: Etapa }) {
  const { user } = useAuth();
  const [linhas, setLinhas] = useState<SolicitacaoDemissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [fStatus, setFStatus] = useState("");
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
    const { data, error } = await sb.from(TABELA)
      .select("*").in("status", statusVisiveis)
      .order("criado_em", { ascending: false }).limit(500);
    if (error) toast.error("Erro ao carregar as solicitações: " + error.message);
    setTodas(data ?? []);
    setCarregando(false);
  }, [statusVisiveis]);
  useEffect(() => { carregar(); }, [carregar]);
  // Recorte por escritório/setor em memória: os setores chegam depois das linhas.
  useEffect(() => {
    setLinhas(todas.filter((s) => visivelNaEtapaDemissao(s, etapa, meusSetores)));
  }, [todas, etapa, meusSetores]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((s) => {
      if (fStatus && s.status !== fStatus) return false;
      if (!passaNoFiltroContratos(s, "contrato", fContratos)) return false;
      if (!q) return true;
      return [s.colaborador_nome, s.solicitante_nome, s.contrato, s.colaborador_posto, String(s.id)]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [linhas, busca, fStatus, fContratos]);

  const contar = (status: string) => linhas.filter((s) => s.status === status).length;

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

  return (
    <>
      {/* 5 cartões para quem vê o fluxo inteiro (Operacional e analista), 3 no
          SST e 2 no RH — o grid acompanha em vez de espremer todo mundo em
          quatro colunas fixas, que deixavam o RH com dois cartões perdidos. */}
      <div className={cn("mb-5 grid gap-3 sm:grid-cols-2",
        etapa === "analista" || etapa === "operacional" || etapa === "diretoria" ? "lg:grid-cols-3 xl:grid-cols-5"
        : etapa === "sst" || etapa === "rh" ? "lg:grid-cols-3" : "")}>
        {etapa === "analista" || etapa === "operacional" || etapa === "diretoria" ? (
          <>
            <Kpi titulo={etapa === "analista" ? "Em aprovação" : "Aguardando você"}
                 valor={etapa === "diretoria" ? contar("Pendente Diretoria") : etapa === "operacional" ? contar("Pendente Operacional") : contar("Pendente Operacional") + contar("Pendente Diretoria")}
                 icone={Clock} cor="bg-yellow-100 text-yellow-700" />
            <Kpi titulo="No RH" valor={contar("Pendente RH")} icone={FileText} cor="bg-purple-100 text-purple-700" />
            {/* "No SST" soma os dois status da etapa: para quem acompanha de
                fora, recebida e a agendar são o mesmo lugar da fila. */}
            <Kpi titulo="No SST" valor={contar("Pendente SST") + contar(STATUS_SST_RECEBIDA)}
                 icone={Stethoscope} cor="bg-cyan-100 text-cyan-700" />
            <Kpi titulo="Agendadas" valor={contar(STATUS_SST_AGENDADO) + contar("Concluída")}
                 icone={CheckCircle2} cor="bg-green-100 text-green-700" />
            <Kpi titulo="Reprovadas" valor={contar("Reprovada")} icone={XCircle} cor="bg-red-100 text-red-700" />
          </>
        ) : etapa === "sst" ? (
          <>
            <Kpi titulo="A receber" valor={contar("Pendente SST")} icone={Clock} cor="bg-cyan-100 text-cyan-700" />
            <Kpi titulo="A agendar" valor={contar(STATUS_SST_RECEBIDA)} icone={Stethoscope} cor="bg-sky-100 text-sky-700" />
            <Kpi titulo="Agendadas" valor={contar(STATUS_SST_AGENDADO)} icone={CheckCircle2} cor="bg-emerald-100 text-emerald-700" />
          </>
        ) : (
          <>
            <Kpi titulo="Aguardando você" valor={contar("Pendente RH")} icone={Clock} cor="bg-purple-100 text-purple-700" />
            <Kpi titulo="No SST" valor={contar("Pendente SST") + contar(STATUS_SST_RECEBIDA)}
                 icone={Stethoscope} cor="bg-cyan-100 text-cyan-700" />
            <Kpi titulo="Agendadas" valor={contar(STATUS_SST_AGENDADO) + contar("Concluída")}
                 icone={CheckCircle2} cor="bg-green-100 text-green-700" />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Solicitações</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <FiltroContratos linhas={linhas} campo="contrato" selecionados={fContratos} onChange={setFContratos} />
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="w-56 pl-8" placeholder="Colaborador, solicitante, contrato…"
                value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Select value={fStatus || "todos"} onValueChange={(v) => setFStatus(v === "todos" ? "" : v)}>
              <SelectTrigger className="w-52"><SelectValue placeholder="Todos os status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {statusVisiveis.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={carregar} disabled={carregando}>
              {carregando ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Colaborador</TableHead>
                    <TableHead className="hidden md:table-cell">Contrato</TableHead>
                    <TableHead className="hidden lg:table-cell">Solicitante</TableHead>
                    <TableHead className="hidden sm:table-cell">Aberta em</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtradas.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => setAberta(s)}>
                      <TableCell className="text-muted-foreground">{s.id}</TableCell>
                      <TableCell>
                        <div className="font-medium">{s.colaborador_nome}</div>
                        <div className="text-xs text-muted-foreground">{s.colaborador_posto || "—"}</div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{s.contrato || "—"}</TableCell>
                      <TableCell className="hidden lg:table-cell">{s.solicitante_nome || "—"}</TableCell>
                      <TableCell className="hidden sm:table-cell">{fmtData(s.criado_em)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant="outline" className={corDoStatus(s.status)}>{s.status}</Badge>
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
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setAberta(s); }}>
                          {statusDeAcao.includes(s.status) ? "Analisar" : "Ver"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
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
        {podeAgir && etapa === "rh" && (
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
