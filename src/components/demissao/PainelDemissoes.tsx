import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BUCKET, MOTIVO_DEVOLUCAO_MIN, TABELA, TABELA_ANEXOS, corDoStatus, explicaStatus,
  fmtData, fmtDataHora, fmtTamanho, linkDoLocalASO, patchDevolucao, podeDevolver,
  resumoDevolucao, resumoDoASO,
  type AnexoDemissao, type EtapaQueDevolve, type SolicitacaoDemissao,
} from "@/lib/demissao/solicitacao";
import { MapaPicker } from "@/components/sst/MapaPicker";
import {
  CheckCircle2, Clock, Download, Eye, FileText, Loader2, MapPin, Search, Stethoscope,
  ThumbsDown, ThumbsUp, Undo2, XCircle,
} from "lucide-react";
import { ConversaSolicitacao } from "@/components/solicitacoes/ConversaSolicitacao";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const sb = supabase as any;

/**
 * Painel das solicitações de demissão — a mesma tela para as três etapas.
 *
 *   analista    → aprova (segue para o SST) ou reprova COM MOTIVO;
 *   sst         → marca o ASO demissional e manda para o RH;
 *   rh          → confirma, e aí sim a demissão fecha;
 *   operacional → SÓ ACOMPANHA. Abre o card, lê tudo, e não decide nada.
 *
 * SST e RH também DEVOLVEM ao analista (02/09/2026). O erro na solicitação
 * costuma aparecer no fim — é o RH que percebe que o aviso está errado ou que
 * falta documento —, e até então as únicas saídas eram concluir um
 * desligamento errado ou abandonar o card. Devolver volta para `Pendente
 * Analista` com o motivo escrito, e desfaz o que as etapas seguintes já
 * tinham carimbado (ver `patchDevolucao`).
 *
 * Um componente só porque a lista, os filtros, o detalhe e os anexos são
 * idênticos: o que muda é quem pode agir e sobre qual status. Quatro cópias
 * divergiriam na primeira correção feita em uma delas.
 *
 * SST e RH TROCARAM DE LUGAR em 02/09/2026, junto com a entrada do analista.
 * Antes era analista(operacional) → RH → SST, com "Concluída" sendo o fim no
 * SST desde 25/08/2026. Agora o SST marca o ASO e o RH confirma por último —
 * quem fecha a demissão é o RH. As linhas antigas foram convertidas na
 * migration; as já concluídas ficaram como estavam.
 *
 * O OPERACIONAL virou leitura pura no mesmo dia. Ele não perdeu a tela: a
 * pergunta "e a demissão do fulano, andou?" continua sendo dele, só a decisão
 * é que passou para o analista. É o mesmo desenho da Gestão Recrutamento.
 */

export type Etapa = "analista" | "operacional" | "rh" | "sst";

/** Os status que cada etapa enxerga, na ordem em que fazem sentido na fila. */
const STATUS_DA_ETAPA: Record<Etapa, string[]> = {
  analista: ["Pendente Analista", "Pendente SST", "Pendente RH", "Concluída", "Reprovada", "Cancelada"],
  // O Operacional enxerga o mesmo que o analista de propósito: ele acompanha o
  // fluxo inteiro. O que ele não tem é `STATUS_DE_ACAO`.
  operacional: ["Pendente Analista", "Pendente SST", "Pendente RH", "Concluída", "Reprovada", "Cancelada"],
  // O SST continua vendo o que despachou: a pergunta que mais chega depois de
  // marcar o ASO é "e aí, o RH fechou?".
  sst: ["Pendente SST", "Pendente RH", "Concluída"],
  rh: ["Pendente RH", "Concluída"],
};

/**
 * O status em que a etapa TEM trabalho a fazer.
 *
 * `null` no Operacional é o que torna a tela dele somente-leitura: `podeAgir`
 * compara o status com este valor, e nenhum status é igual a null.
 */
const STATUS_DE_ACAO: Record<Etapa, string | null> = {
  analista: "Pendente Analista",
  operacional: null,
  sst: "Pendente SST",
  rh: "Pendente RH",
};

function Kpi({ titulo, valor, icone: Icone, cor }: {
  titulo: string; valor: number; icone: any; cor: string;
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
  const [aberta, setAberta] = useState<SolicitacaoDemissao | null>(null);

  const statusVisiveis = STATUS_DA_ETAPA[etapa];
  const statusDeAcao = STATUS_DE_ACAO[etapa];

  const carregar = async () => {
    setCarregando(true);
    const { data, error } = await sb.from(TABELA)
      .select("*").in("status", statusVisiveis)
      .order("criado_em", { ascending: false }).limit(500);
    if (error) toast.error("Erro ao carregar as solicitações: " + error.message);
    setLinhas(data ?? []);
    setCarregando(false);
  };
  useEffect(() => { carregar(); }, [etapa]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return linhas.filter((s) => {
      if (fStatus && s.status !== fStatus) return false;
      if (!q) return true;
      return [s.colaborador_nome, s.solicitante_nome, s.contrato, s.colaborador_posto, String(s.id)]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  }, [linhas, busca, fStatus]);

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

  const decidir = async (s: SolicitacaoDemissao, patch: Record<string, any>, aviso: string) => {
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
      {/* 5 cartões para quem vê o fluxo inteiro (analista e Operacional), 3 no
          SST e 2 no RH — o grid acompanha em vez de espremer todo mundo em
          quatro colunas fixas, que deixavam o RH com dois cartões perdidos. */}
      <div className={cn("mb-5 grid gap-3 sm:grid-cols-2",
        etapa === "analista" || etapa === "operacional" ? "lg:grid-cols-3 xl:grid-cols-5"
        : etapa === "sst" ? "lg:grid-cols-3" : "")}>
        {etapa === "analista" || etapa === "operacional" ? (
          <>
            <Kpi titulo={etapa === "analista" ? "Aguardando você" : "Com o analista"}
                 valor={contar("Pendente Analista")} icone={Clock} cor="bg-yellow-100 text-yellow-700" />
            <Kpi titulo="No SST" valor={contar("Pendente SST")} icone={Stethoscope} cor="bg-cyan-100 text-cyan-700" />
            <Kpi titulo="No RH" valor={contar("Pendente RH")} icone={FileText} cor="bg-purple-100 text-purple-700" />
            <Kpi titulo="Concluídas" valor={contar("Concluída")} icone={CheckCircle2} cor="bg-green-100 text-green-700" />
            <Kpi titulo="Reprovadas" valor={contar("Reprovada")} icone={XCircle} cor="bg-red-100 text-red-700" />
          </>
        ) : etapa === "sst" ? (
          <>
            <Kpi titulo="ASO a marcar" valor={contar("Pendente SST")} icone={Stethoscope} cor="bg-cyan-100 text-cyan-700" />
            <Kpi titulo="Aguardando o RH" valor={contar("Pendente RH")} icone={Clock} cor="bg-purple-100 text-purple-700" />
            <Kpi titulo="Concluídas" valor={contar("Concluída")} icone={CheckCircle2} cor="bg-green-100 text-green-700" />
          </>
        ) : (
          <>
            <Kpi titulo="Aguardando o RH" valor={contar("Pendente RH")} icone={Clock} cor="bg-purple-100 text-purple-700" />
            <Kpi titulo="Concluídas" valor={contar("Concluída")} icone={CheckCircle2} cor="bg-green-100 text-green-700" />
          </>
        )}
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Solicitações</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
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
                              nunca saiu do analista. Sem o selo, os dois se
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
                          {s.status === statusDeAcao ? "Analisar" : "Ver"}
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
      />
    </>
  );
}

// ── Detalhe + decisão ────────────────────────────────────────────────
function DetalheSolicitacao({ solicitacao, etapa, quemSou, onFechar, onDecidir }: {
  solicitacao: SolicitacaoDemissao | null;
  etapa: Etapa;
  quemSou: string;
  onFechar: () => void;
  onDecidir: (s: SolicitacaoDemissao, patch: Record<string, any>, aviso: string) => Promise<boolean>;
}) {
  const [anexos, setAnexos] = useState<AnexoDemissao[]>([]);
  const [motivo, setMotivo] = useState("");
  const [observacao, setObservacao] = useState("");
  const [salvando, setSalvando] = useState(false);
  // O motivo da DEVOLUÇÃO é campo à parte do motivo da reprovação: são duas
  // recusas diferentes, de gente diferente, e um estado só faria o texto de
  // uma aparecer no formulário da outra.
  const [motivoDevolucao, setMotivoDevolucao] = useState("");
  const [devolvendo, setDevolvendo] = useState(false);
  // O ASO demissional — os mesmos quatro campos do ASO de admissão.
  const [aso, setAso] = useState({ data: "", hora: "", local: "", maps: "" });
  // Texto que centraliza o mapa; só muda quando o SST sai do campo "local",
  // senão o mapa saltaria a cada tecla digitada.
  const [mapPrev, setMapPrev] = useState("");

  useEffect(() => {
    setMotivo(""); setObservacao(""); setAnexos([]);
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
  }, [solicitacao?.id]);

  if (!solicitacao) return null;
  const s = solicitacao;
  const podeAgir = s.status === STATUS_DE_ACAO[etapa];

  // O bucket é privado: o documento abre por URL assinada, válida por 1 hora.
  const abrirAnexo = async (a: AnexoDemissao) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Não consegui abrir o documento."); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  };

  // O ANALISTA é a primeira porta. As colunas continuam `operacional_*` — ver
  // a nota em SolicitacaoDemissao: o dono mudou, o nome da coluna não.
  const aprovar = async () => {
    setSalvando(true);
    await onDecidir(s, {
      status: "Pendente SST", operacional_por: quemSou,
      operacional_em: new Date().toISOString(), operacional_motivo: null,
    }, `Solicitação #${s.id} aprovada e enviada ao SST.`);
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

  // O RH é o ÚLTIMO a falar desde 02/09/2026: confirma o desligamento depois
  // de o SST ter marcado o ASO. Antes ele vinha antes do SST, e o encarregado
  // via "Concluída" com o ASO ainda por marcar.
  const concluir = async () => {
    setSalvando(true);
    await onDecidir(s, {
      status: "Concluída", rh_por: quemSou,
      rh_em: new Date().toISOString(), rh_observacao: observacao.trim() || null,
    }, `Solicitação #${s.id} confirmada pelo RH — desligamento concluído.`);
    setSalvando(false);
  };

  /**
   * Devolve ao analista, com o motivo escrito.
   *
   * É o "reprovar" do SST e do RH: a solicitação volta para a primeira porta
   * em vez de ser concluída errada ou abandonada. `patchDevolucao` limpa os
   * carimbos das etapas já cumpridas — ver o comentário lá.
   */
  const devolver = async () => {
    if (motivoDevolucao.trim().length < MOTIVO_DEVOLUCAO_MIN) {
      toast.error(`Escreva o que precisa ser corrigido (mín. ${MOTIVO_DEVOLUCAO_MIN} caracteres) — é o que o analista vai ler.`);
      return;
    }
    setSalvando(true);
    await onDecidir(
      s,
      patchDevolucao(etapa as EtapaQueDevolve, quemSou, motivoDevolucao),
      `Solicitação #${s.id} devolvida ao analista.`,
    );
    setSalvando(false);
  };

  // O SST marca o ASO demissional e despacha para o RH confirmar.
  const marcarASO = async () => {
    if (!aso.data) { toast.error("Informe a data do ASO."); return; }
    setSalvando(true);
    await onDecidir(s, {
      status: "Pendente RH",
      sst_data_exame: aso.data,
      sst_hora_exame: aso.hora.trim() || null,
      sst_local_exame: aso.local.trim() || null,
      sst_maps_url: aso.maps.trim() || null,
      sst_observacao: observacao.trim() || null,
      sst_por: quemSou, sst_em: new Date().toISOString(),
    }, `ASO demissional marcado — solicitação #${s.id} segue para o RH confirmar.`);
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

        {/* Histórico das decisões já tomadas */}
        {(s.operacional_em || s.rh_em || s.sst_em) && (
          <Secao titulo="Decisões" itens={[
            ["Operacional", s.operacional_por ? `${s.operacional_por} · ${fmtDataHora(s.operacional_em)}` : "—"],
            ["Motivo da reprovação", s.operacional_motivo],
            ["RH", s.rh_por ? `${s.rh_por} · ${fmtDataHora(s.rh_em)}` : "—"],
            ["Observação do RH", s.rh_observacao],
            ["SST (ASO)", s.sst_por ? `${s.sst_por} · ${fmtDataHora(s.sst_em)}` : "—"],
          ]} />
        )}

        {/* A devolução vem PRIMEIRO no detalhe, antes de qualquer campo: é a
            única coisa que importa num card que voltou, e enterrá-la no meio
            faria o analista reaprovar o mesmo erro. */}
        {s.devolvido_em && (
          <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="flex items-center gap-2 font-semibold">
              <Undo2 className="h-4 w-4" /> {resumoDevolucao(s)}
            </p>
            <p>{s.devolvido_motivo}</p>
          </div>
        )}

        {/* O Operacional acompanha, não decide. Dizer isso é melhor do que
            simplesmente não desenhar botão nenhum: sem a frase, quem abria o
            card ficava procurando onde clicar. */}
        {etapa === "operacional" && (
          <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            <Eye className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Esta tela é de <strong>acompanhamento</strong>. Quem aprova a demissão é o
              analista, em Licitações › Analistas Validações. Aqui você vê o andamento
              completo e a conversa da solicitação.
            </span>
          </div>
        )}

        {/* Ações da etapa */}
        {podeAgir && etapa === "analista" && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Sua decisão</h3>
            <div>
              <Label htmlFor="motivo">Motivo da reprovação</Label>
              <Textarea id="motivo" className="mt-1" placeholder="Obrigatório só para reprovar — explique o que precisa ser corrigido."
                value={motivo} onChange={(e) => setMotivo(e.target.value)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={aprovar} disabled={salvando}>
                <ThumbsUp className="mr-2 h-4 w-4" /> Aprovar e enviar ao SST
              </Button>
              <Button variant="destructive" onClick={reprovar} disabled={salvando}>
                <ThumbsDown className="mr-2 h-4 w-4" /> Reprovar
              </Button>
            </div>
          </div>
        )}

        {podeAgir && etapa === "rh" && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Confirmar o desligamento</h3>
            <div>
              <Label htmlFor="obs">Observação (opcional)</Label>
              <Textarea id="obs" className="mt-1" placeholder="O que foi feito, datas do acerto, pendências…"
                value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>
            <Button onClick={concluir} disabled={salvando}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Confirmar e concluir
            </Button>
          </div>
        )}

        {/* SST — os MESMOS campos do ASO de admissão (pages/sst/AsoCandidatos),
            inclusive o seletor no mapa: é a mesma ficha, na outra ponta. */}
        {podeAgir && etapa === "sst" && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <h3 className="text-sm font-semibold">Marcar o ASO demissional</h3>
            <p className="text-sm text-muted-foreground">
              Informe data, hora e local do exame. Marcar o ASO manda a demissão para o RH
              confirmar — e o encarregado passa a ver tudo isso na solicitação dele.
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
              <Stethoscope className="mr-2 h-4 w-4" /> Marcar ASO e concluir
            </Button>
          </div>
        )}

        {/* DEVOLVER AO ANALISTA — o "reprovar" do SST e do RH.
            Fica fora dos blocos de cada etapa porque é a mesma ação nas duas,
            e recolhido por padrão: devolver é a exceção, não o caminho. */}
        {podeDevolver(etapa, s.status) && (
          <div className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Undo2 className="h-4 w-4" /> Devolver ao analista
            </h3>
            <p className="text-sm text-muted-foreground">
              Use quando a solicitação vier com erro. Ela volta para a fila do analista com o que
              você escrever aqui, e o que já tinha sido carimbado nas etapas seguintes é desfeito —
              quando voltar, passa pelo SST de novo.
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
                <Undo2 className="mr-2 h-4 w-4" /> Devolver ao analista
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
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">{rotulo}</dt>
            <dd className="break-words">{valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
