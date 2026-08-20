import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Paperclip, Trash2, RotateCcw, FileText, Package, DollarSign, Tag, Image as ImageIcon, FileSpreadsheet, File as FileIcon, Check, X, PenLine, ClipboardCheck, Banknote, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  useDespesa,
  useDespesaEventos,
  useNomeUsuario,
  useCancelarDespesa,
  useMandarParaAprovacaoNovamente,
  useContratosAtivos,
  useAprovarDespesa,
  useSolicitarAjusteDespesa,
  useReprovarDespesa,
  usePodePagarMalote,
  useMarcarConferidoDespesa,
  useSolicitarAjustePagamentoDespesa,
  usePagarDespesa,
  uploadAnexoMalote,
  aprovadorDoNivel,
  souAprovadorConfigurado,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  STATUS_TERMINAIS,
  RateioLinha,
  TipoSolicitacao,
  DespesaEvento,
  TipoEvento,
} from "@/hooks/useMaloteDespesa";
import { useOrcadoClassificacao } from "@/hooks/useOrcadoClassificacao";
import { anoMesAtual } from "@/hooks/usePlanilhaCusto";
import { RateioGrid, DimensoesRateio } from "./RateioGrid";
import { RateioAprovadorTable } from "./RateioAprovadorTable";
import { FluxoAprovacaoVisual } from "./FluxoAprovacaoVisual";

const TIPO_SOLICITACAO_LABEL: Record<TipoSolicitacao, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

const FORMA_PAGAMENTO_LABEL: Record<string, string> = {
  pix: "Pix",
  ted: "TED",
  boleto: "Boleto",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
};

// Mesmo texto usado no FluxoAprovacaoVisual (EVENTO_META), duplicado aqui
// de propósito — o Histórico é uma lista bruta e cronológica de TODOS os
// eventos (inclusive ciclos repetidos de ajuste/reenvio, que o fluxo
// visual não mostra porque só guarda o desvio mais recente de cada tipo).
const EVENTO_LABEL: Record<TipoEvento, string> = {
  criacao: "Criada",
  edicao: "Editada",
  aguardando_cotacao: "Aguardando cotação",
  cotacao_realizada: "Cotação realizada",
  cotacao_aprovada: "Cotação aprovada",
  solicitacao_aprovada: "Solicitação aprovada",
  solicitacao_reprovada: "Solicitação reprovada",
  despesa_criada: "Despesa criada",
  aprovacao_nivel: "Aprovada",
  necessidade_de_ajuste: "Necessidade de ajuste",
  reenvio_aprovacao: "Reenviada para aprovação",
  aguardando_pagamento: "Aguardando pagamento",
  conferido_pagamento: "Marcada como conferida",
  ajuste_pagamento_solicitado: "Ajuste solicitado no pagamento",
  despesa_paga: "Despesa paga",
  despesa_reprovada: "Despesa reprovada",
  cancelamento: "Cancelada",
};

function LinhaHistorico({ evento, criadoPor }: { evento: DespesaEvento; criadoPor: string }) {
  const { data: nomeAtor } = useNomeUsuario(evento.ator_user_id);
  const papel = evento.ator_user_id === criadoPor ? " (Solicitante)" : evento.nivel ? ` (Nível ${evento.nivel})` : "";
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
      <div>
        <p className="font-medium">
          {EVENTO_LABEL[evento.tipo_evento] ?? evento.tipo_evento}
          {papel}
        </p>
        <p className="text-xs text-muted-foreground">{nomeAtor ?? "—"}</p>
        {evento.descricao && <p className="text-muted-foreground text-xs">{evento.descricao}</p>}
        <p className="text-xs text-muted-foreground">{new Date(evento.created_at).toLocaleString("pt-BR")}</p>
      </div>
    </div>
  );
}

async function abrirAnexo(path: string) {
  const { data, error } = await supabase.storage.from("malote-anexos").createSignedUrl(path, 60);
  if (error || !data) {
    toast.error("Não foi possível abrir o anexo.");
    return;
  }
  window.open(data.signedUrl, "_blank");
}

function IconeArquivo({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return <ImageIcon className="h-4 w-4" />;
  if (["xls", "xlsx", "csv"].includes(ext)) return <FileSpreadsheet className="h-4 w-4" />;
  if (["pdf", "doc", "docx", "txt"].includes(ext)) return <FileText className="h-4 w-4" />;
  return <FileIcon className="h-4 w-4" />;
}

// Mesma técnica visual do KpiCard em PainelExecutivo.tsx: ícone grande com
// máscara em gradiente (opaco perto da borda, sumindo pro centro) — mais
// vivo que um simples opacity-5 e não corta o ícone no canto.
const TILE_COR = {
  emerald: "text-emerald-300 dark:text-emerald-800",
  violet: "text-violet-300 dark:text-violet-800",
} as const;

function TileDestaque({ label, valor, icon, cor }: { label: string; valor: string; icon: React.ReactNode; cor: keyof typeof TILE_COR }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border p-3">
      <div
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1"
        style={{
          WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
        }}
      >
        <span className={cn("[&>svg]:h-14 [&>svg]:w-14", TILE_COR[cor])}>{icon}</span>
      </div>
      <p className="relative z-10 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="relative z-10 text-base font-semibold mt-0.5 truncate max-w-[85%]">{valor}</p>
    </div>
  );
}

export default function DespesaVisualizar() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading } = useDespesa(id);
  const { data: eventos = [] } = useDespesaEventos(id);
  const { data: solicitanteNome } = useNomeUsuario(data?.despesa?.created_by);
  const { data: contratos = [] } = useContratosAtivos();
  const cancelar = useCancelarDespesa();
  const reenviar = useMandarParaAprovacaoNovamente();
  const aprovar = useAprovarDespesa();
  const solicitarAjuste = useSolicitarAjusteDespesa();
  const reprovar = useReprovarDespesa();
  const { data: podePagarMalote } = usePodePagarMalote();
  const marcarConferido = useMarcarConferidoDespesa();
  const solicitarAjustePagamento = useSolicitarAjustePagamentoDespesa();
  const pagar = usePagarDespesa();

  const [valorAprovado, setValorAprovado] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [comentario, setComentario] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [informacoesPagamento, setInformacoesPagamento] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [dimensoes, setDimensoes] = useState<DimensoesRateio>({ empresa: false, contrato: false, fornecedor: false, integrante: false });
  const [ratearPor, setRatearPor] = useState<"percentual" | "valor">("percentual");
  const [linhasRateio, setLinhasRateio] = useState<RateioLinha[]>([]);
  const [enviando, setEnviando] = useState<"cancelar" | "reenviar" | null>(null);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState<"aprovar" | "reprovar" | "ajuste" | null>(null);
  const [acaoPagamentoEmAndamento, setAcaoPagamentoEmAndamento] = useState<"conferir" | "ajuste" | "reprovar" | null>(null);
  const [pagarAberto, setPagarAberto] = useState(false);
  const [comprovanteFile, setComprovanteFile] = useState<File | null>(null);
  const [dataPagamentoConfirmado, setDataPagamentoConfirmado] = useState("");
  const [observacaoPagamento, setObservacaoPagamento] = useState("");
  const [pagando, setPagando] = useState(false);

  const despesa = data?.despesa;

  // Orçado da Classificação no período da despesa (SIS-2026-0132/0168) —
  // usado só pra decidir se a aprovação escalona pro próximo nível ou vai
  // direto pro pagamento (a % de alçada do aprovador nunca bloqueia o
  // aprovador de agir, só decide o destino depois de aprovado).
  const anoMesDespesa = despesa?.competencia ? despesa.competencia.slice(0, 7) : anoMesAtual();
  const { resolver: resolverOrcado } = useOrcadoClassificacao(despesa?.empresa_id, anoMesDespesa);

  useEffect(() => {
    if (!despesa) return;
    setValorAprovado(despesa.valor_aprovado != null ? String(despesa.valor_aprovado) : String(despesa.valor_total));
    setJustificativa(despesa.justificativa_aprovacao ?? "");
    setFormaPagamento(despesa.forma_pagamento ?? "");
    setInformacoesPagamento(despesa.informacoes_pagamento ?? "");
    setDataPagamento(despesa.data_pagamento ?? "");
    setCompetencia(despesa.competencia ? despesa.competencia.slice(0, 7) : "");
  }, [despesa?.id]);

  useEffect(() => {
    if (!data?.rateio) return;
    setLinhasRateio(data.rateio);
    setDimensoes({
      empresa: data.rateio.some((l) => l.empresa_id != null),
      contrato: data.rateio.some((l) => l.contrato_id != null),
      fornecedor: data.rateio.some((l) => l.fornecedor_id != null),
      integrante: data.rateio.some((l) => l.integrante_empregado_id != null),
    });
  }, [data?.rateio, despesa?.id]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Carregando...</div>;
  if (!despesa) return <div className="p-6 text-muted-foreground">Despesa não encontrada.</div>;

  const bloqueado = STATUS_TERMINAIS.includes(despesa.status);
  const podeAgir = !bloqueado;

  // Papéis do usuário logado em relação a esta despesa — SIS-2026-0132 Fase 1.
  const souSolicitante = despesa.created_by === user?.id;
  const souAprovadorNivelAtual =
    despesa.status === "pendente_aprovacao" &&
    despesa.nivel_aprovacao_atual != null &&
    aprovadorDoNivel(despesa, despesa.nivel_aprovacao_atual) === user?.id;
  const configurado = souAprovadorConfigurado(despesa, user?.id);
  // SIS-2026-0192: "Dados da Aprovação e Pagamento" e "Rateio da Despesa"
  // só podem ser alterados pelo Solicitante (ex.: quando o aprovador pede
  // ajuste) — ninguém mais edita, nem admin/supervisor/aprovador. Pra
  // qualquer outro papel o Rateio vira só-leitura com as colunas de
  // Orçado/Utilizado/Status.
  const rateioEPagamentoEditaveis = !bloqueado && souSolicitante;
  const podeReprovarComoAprovadorPassado =
    configurado && ((despesa.status === "pendente_aprovacao" && !souAprovadorNivelAtual) || despesa.status === "aguardando_pagamento");
  const souAprovadorVendoAjuste = despesa.status === "necessidade_de_ajuste" && configurado && !souSolicitante;
  const proximoNivelExiste =
    despesa.nivel_aprovacao_atual != null && despesa.nivel_aprovacao_atual < 3
      ? aprovadorDoNivel(despesa, (despesa.nivel_aprovacao_atual + 1) as 1 | 2 | 3) != null
      : false;

  // % de alçada (SIS-2026-0132, cadastrado desde sempre mas nunca
  // consumido): o aprovador do nível atual SEMPRE pode aprovar/reprovar,
  // independente do valor — a % só decide se, ao aprovar, a despesa
  // escalona pro próximo nível ou vai direto pro pagamento. Orçado
  // desconhecido ou limite não cadastrado nunca bloqueia (trata como sem
  // trava, pra não quebrar classificações que nunca preencheram o campo).
  const orcadoClassificacao = resolverOrcado(despesa.classificacao_id, despesa.contrato_id);
  const alcadaNivelAtual = (() => {
    const c = despesa.classificacao;
    const nivel = despesa.nivel_aprovacao_atual;
    if (!c || !nivel) return { semLimite: true, limitePct: null as number | null };
    if (nivel === 1) return { semLimite: !!c.aprovador1_sem_limite, limitePct: c.aprovador1_limite_pct ?? null };
    if (nivel === 2) return { semLimite: !!c.aprovador2_sem_limite, limitePct: c.aprovador2_limite_pct ?? null };
    return { semLimite: !!c.aprovador3_sem_limite, limitePct: c.aprovador3_limite_pct ?? null };
  })();
  const valorParaAlcada = Number(valorAprovado) || despesa.valor_total;
  const percentualDoOrcado = orcadoClassificacao ? (valorParaAlcada / orcadoClassificacao) * 100 : null;
  const dentroDaAlcada =
    alcadaNivelAtual.semLimite ||
    alcadaNivelAtual.limitePct == null ||
    orcadoClassificacao == null ||
    percentualDoOrcado == null ||
    percentualDoOrcado <= alcadaNivelAtual.limitePct;
  const proximoNivelConfigurado = proximoNivelExiste && !dentroDaAlcada;

  // Pagamento Malote (SIS-2026-0160) — elegibilidade resolvida só pelo
  // gerenciamento de acesso (usePodePagarMalote), não por linha da despesa.
  const mostrarAcoesPagamento =
    !!podePagarMalote && ["aguardando_pagamento", "pronto_para_pagar", "ajuste_pagamento"].includes(despesa.status);

  function validarAcaoAprovador(): string | null {
    if (!formaPagamento) return "Selecione a forma de pagamento.";
    if (!informacoesPagamento.trim()) return "Informe os dados de pagamento.";
    if (!dataPagamento) return "Informe a data de pagamento.";
    if (!competencia) return "Informe a competência.";
    if (!valorAprovado || Number(valorAprovado) <= 0) return "Informe o valor aprovado.";
    return null;
  }

  async function handleAprovar() {
    const erro = validarAcaoAprovador();
    if (erro) {
      toast.error(erro);
      return;
    }
    setAcaoEmAndamento("aprovar");
    try {
      await aprovar.mutateAsync({
        id: despesa!.id,
        nivelAtual: despesa!.nivel_aprovacao_atual!,
        proximoNivelConfigurado,
        valor_aprovado: Number(valorAprovado),
        justificativa_aprovacao: justificativa || null,
        forma_pagamento: formaPagamento,
        informacoes_pagamento: informacoesPagamento,
        data_pagamento: dataPagamento,
        competencia,
      });
      toast.success(proximoNivelConfigurado ? "Aprovado — enviado pro próximo nível." : "Aprovado — aguardando pagamento.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao aprovar despesa.");
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function handleSolicitarAjusteAprovador() {
    if (!comentario.trim()) {
      toast.error("Descreva o motivo do ajuste no campo Comentário.");
      return;
    }
    setAcaoEmAndamento("ajuste");
    try {
      await solicitarAjuste.mutateAsync({ id: despesa!.id, motivo: comentario.trim() });
      toast.success("Ajuste solicitado ao solicitante.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao solicitar ajuste.");
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function handleReprovarAprovador() {
    if (!comentario.trim()) {
      toast.error("Descreva o motivo da reprovação no campo Comentário.");
      return;
    }
    setAcaoEmAndamento("reprovar");
    try {
      await reprovar.mutateAsync({ id: despesa!.id, motivo: comentario.trim() });
      toast.success("Despesa reprovada.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao reprovar despesa.");
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function handleMarcarConferido() {
    setAcaoPagamentoEmAndamento("conferir");
    try {
      await marcarConferido.mutateAsync(despesa!.id);
      toast.success("Despesa marcada como conferida — pronta para pagar.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao marcar como conferido.");
    } finally {
      setAcaoPagamentoEmAndamento(null);
    }
  }

  async function handleSolicitarAjustePagamento() {
    if (!comentario.trim()) {
      toast.error("Descreva o motivo do ajuste no campo Comentário.");
      return;
    }
    setAcaoPagamentoEmAndamento("ajuste");
    try {
      await solicitarAjustePagamento.mutateAsync({ id: despesa!.id, motivo: comentario.trim() });
      toast.success("Ajuste solicitado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao solicitar ajuste.");
    } finally {
      setAcaoPagamentoEmAndamento(null);
    }
  }

  async function handleReprovarPagamento() {
    if (!comentario.trim()) {
      toast.error("Descreva o motivo da reprovação no campo Comentário.");
      return;
    }
    setAcaoPagamentoEmAndamento("reprovar");
    try {
      await reprovar.mutateAsync({ id: despesa!.id, motivo: comentario.trim() });
      toast.success("Despesa reprovada.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao reprovar despesa.");
    } finally {
      setAcaoPagamentoEmAndamento(null);
    }
  }

  function abrirPagar() {
    setComprovanteFile(null);
    setDataPagamentoConfirmado(despesa!.data_pagamento ?? new Date().toISOString().slice(0, 10));
    setObservacaoPagamento("");
    setPagarAberto(true);
  }

  async function handleConfirmarPagamento() {
    if (!comprovanteFile) {
      toast.error("Anexe o comprovante de pagamento.");
      return;
    }
    if (!dataPagamentoConfirmado) {
      toast.error("Informe a data do pagamento.");
      return;
    }
    setPagando(true);
    try {
      const comprovantePath = await uploadAnexoMalote(comprovanteFile, despesa!.id);
      await pagar.mutateAsync({
        id: despesa!.id,
        data_pagamento: dataPagamentoConfirmado,
        comprovante_path: comprovantePath,
        observacao: observacaoPagamento.trim() || null,
      });
      toast.success("Pagamento confirmado.");
      setPagarAberto(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao confirmar pagamento.");
    } finally {
      setPagando(false);
    }
  }

  async function handleCancelar() {
    setEnviando("cancelar");
    try {
      await cancelar.mutateAsync({ id: despesa!.id });
      toast.success("Despesa cancelada.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao cancelar despesa.");
    } finally {
      setEnviando(null);
    }
  }

  async function handleReenviar() {
    setEnviando("reenviar");
    try {
      await reenviar.mutateAsync({
        id: despesa!.id,
        empresa_id: despesa!.empresa_id,
        classificacao_id: despesa!.classificacao_id,
        origem: despesa!.origem,
        status: despesa!.status,
        nome: despesa!.nome,
        valor_total: despesa!.valor_total,
        valor_aprovado: valorAprovado ? Number(valorAprovado) : null,
        justificativa_aprovacao: justificativa || null,
        forma_pagamento: formaPagamento || null,
        informacoes_pagamento: informacoesPagamento || null,
        data_pagamento: dataPagamento || null,
        competencia: competencia ? competencia + "-01" : null,
        rateio: linhasRateio,
      });
      toast.success("Enviado para aprovação novamente (reiniciado em N1).");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao reenviar para aprovação.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={`Despesa ${despesa.numero}`}
        subtitle="Visualize os detalhes da despesa e acompanhe o fluxo de aprovação."
        module="Malote"
        breadcrumb={["Malote", "Despesa", "Visualizar"]}
        actions={
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
          </Button>
        }
      />

      {/* Bloco 1: cabeçalho */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Nº da Despesa</p>
            <p className="font-mono font-medium">{despesa.numero}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Solicitante</p>
            <p className="font-medium">{solicitanteNome ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Data da solicitação</p>
            <p>{new Date(despesa.created_at).toLocaleString("pt-BR")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Data de pagamento</p>
            <p>{despesa.data_pagamento ? new Date(despesa.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Última atualização</p>
            <p>{new Date(despesa.updated_at).toLocaleString("pt-BR")}</p>
          </div>
          <div className="ml-auto">
            <Badge className={STATUS_BADGE_CLASS[despesa.status]}>
              {STATUS_LABEL[despesa.status]}
              {despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual ? ` N${despesa.nivel_aprovacao_atual}` : ""}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {despesa.status === "necessidade_de_ajuste" && despesa.motivo_ajuste && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">Necessidade de ajuste</p>
            <p className="text-amber-700 dark:text-amber-400 mt-1">{despesa.motivo_ajuste}</p>
          </CardContent>
        </Card>
      )}

      {/* Bloco 2: Dados da Solicitação/Despesa (lado esquerdo) + Fluxo de Aprovação (lado direito) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <Card className="flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    {despesa.origem === "solicitacao" ? <FileText className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                  </div>
                  <p className="text-sm font-semibold">{despesa.origem === "solicitacao" ? "Dados da Solicitação" : "Dados da Despesa"}</p>
                </div>
                <span className="text-[11px] text-muted-foreground">🔒 bloqueado</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <TileDestaque label="Valor" valor={Number(despesa.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} icon={<DollarSign />} cor="emerald" />
                <TileDestaque label="Classificação" valor={despesa.classificacao?.nome ?? "—"} icon={<Tag />} cor="violet" />
              </div>

              <div className="text-sm space-y-2">
                <p>
                  <span className="text-muted-foreground">Nome:</span> {despesa.nome}
                </p>
                {despesa.motivo && (
                  <p>
                    <span className="text-muted-foreground">Motivo:</span> {despesa.motivo}
                  </p>
                )}
                {despesa.descricao && (
                  <p>
                    <span className="text-muted-foreground">Descrição:</span> {despesa.descricao}
                  </p>
                )}
                {despesa.tipo && (
                  <p>
                    <span className="text-muted-foreground">Tipo:</span> {TIPO_SOLICITACAO_LABEL[despesa.tipo]}
                  </p>
                )}
                {despesa.tipo === "contrato" && (
                  <p>
                    <span className="text-muted-foreground">Contrato:</span> {contratos.find((c) => c.id === despesa.contrato_id)?.nome ?? "—"}
                  </p>
                )}
              </div>

              {despesa.arquivos.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Arquivos anexados</p>
                  <div className="grid grid-cols-2 gap-2">
                    {despesa.arquivos.map((path) => (
                      <button
                        key={path}
                        type="button"
                        onClick={() => abrirAnexo(path)}
                        className="flex items-center gap-2 rounded-lg border border-border p-2 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                      >
                        <div className="h-7 w-7 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                          <IconeArquivo path={path} />
                        </div>
                        <span className="text-xs truncate">{path.split("/").pop()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1" />

            <p className="text-xs text-muted-foreground border-t border-border pt-3 mt-4">
              Os dados da solicitação estão bloqueados e não podem ser alterados.
            </p>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <p className="text-sm font-semibold mb-3">Fluxo de Aprovação</p>
            <div className="flex-1 overflow-y-auto pr-1">
              <FluxoAprovacaoVisual despesa={despesa} eventos={eventos} />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Histórico detalhado: lista bruta e cronológica de todos os eventos,
          inclusive ciclos repetidos que o Fluxo de Aprovação visual (acima)
          não mostra — ele só guarda o desvio mais recente de cada tipo. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Histórico detalhado</p>
          <div className="max-h-72 overflow-y-auto pr-1 space-y-3">
            {eventos.map((ev) => (
              <LinhaHistorico key={ev.id} evento={ev} criadoPor={despesa.created_by} />
            ))}
            {eventos.length === 0 && <p className="text-sm text-muted-foreground">Sem eventos registrados ainda.</p>}
          </div>
        </CardContent>
      </Card>

      {/* Bloco 3: Dados da Aprovação e Pagamento */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Dados da Aprovação e Pagamento</p>
          <div className={cn("grid grid-cols-1 sm:grid-cols-3 gap-4", !rateioEPagamentoEditaveis && "opacity-60")}>
            <div>
              <Label>Valor aprovado</Label>
              <Input type="number" step="0.01" value={valorAprovado} onChange={(e) => setValorAprovado(e.target.value)} disabled={!rateioEPagamentoEditaveis} />
            </div>
            <div>
              <Label>Justificativa da aprovação</Label>
              <Input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} disabled={!rateioEPagamentoEditaveis} />
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select value={formaPagamento} onValueChange={setFormaPagamento} disabled={!rateioEPagamentoEditaveis}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FORMA_PAGAMENTO_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dados de pagamento</Label>
              <Input value={informacoesPagamento} onChange={(e) => setInformacoesPagamento(e.target.value)} disabled={!rateioEPagamentoEditaveis} />
            </div>
            <div>
              <Label>Data do pagamento</Label>
              <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} disabled={!rateioEPagamentoEditaveis} />
            </div>
            <div>
              <Label>Competência</Label>
              <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={!rateioEPagamentoEditaveis} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bloco 4: Rateio da Despesa */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Rateio da Despesa</p>
          {rateioEPagamentoEditaveis ? (
            <RateioGrid
              linhas={linhasRateio}
              onChange={setLinhasRateio}
              dimensoes={dimensoes}
              onDimensoesChange={setDimensoes}
              ratearPor={ratearPor}
              onRatearPorChange={setRatearPor}
              valorTotal={Number(valorAprovado) || despesa.valor_total}
              disabled={bloqueado}
            />
          ) : (
            <RateioAprovadorTable
              despesaId={despesa.id}
              linhas={linhasRateio}
              dimensoes={dimensoes}
              classificacaoId={despesa.classificacao_id}
              limiteJustificativaPct={despesa.classificacao?.limite_justificativa_pct ?? null}
              resolverOrcado={resolverOrcado}
              anoMesDespesa={anoMesDespesa}
              podeJustificarComoAprovador={configurado}
            />
          )}
        </CardContent>
      </Card>

      {(souAprovadorNivelAtual || podeReprovarComoAprovadorPassado || mostrarAcoesPagamento) && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <Label>Comentário</Label>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value.slice(0, 500))}
              placeholder="Motivo do ajuste ou da reprovação..."
              className="w-full min-h-20 rounded-md border border-input bg-background p-2 text-sm"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground text-right">{comentario.length}/500</p>
          </CardContent>
        </Card>
      )}

      {souAprovadorNivelAtual && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5"
            onClick={handleReprovarAprovador}
            disabled={acaoEmAndamento !== null}
          >
            <X className="h-4 w-4" /> {acaoEmAndamento === "reprovar" ? "Reprovando..." : "Reprovar despesa"}
          </Button>
          <Button
            variant="outline"
            className="text-amber-700 border-amber-400 hover:bg-amber-50 gap-1.5"
            onClick={handleSolicitarAjusteAprovador}
            disabled={acaoEmAndamento !== null}
          >
            <PenLine className="h-4 w-4" /> {acaoEmAndamento === "ajuste" ? "Enviando..." : "Solicitar ajuste"}
          </Button>
          <Button className="gap-1.5" onClick={handleAprovar} disabled={acaoEmAndamento !== null}>
            <Check className="h-4 w-4" /> {acaoEmAndamento === "aprovar" ? "Aprovando..." : "Aprovar despesa"}
          </Button>
        </div>
      )}

      {!souAprovadorNivelAtual && podeReprovarComoAprovadorPassado && !mostrarAcoesPagamento && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5"
            onClick={handleReprovarAprovador}
            disabled={acaoEmAndamento !== null}
          >
            <X className="h-4 w-4" /> {acaoEmAndamento === "reprovar" ? "Reprovando..." : "Reprovar despesa"}
          </Button>
        </div>
      )}

      {mostrarAcoesPagamento && despesa.status === "ajuste_pagamento" && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5"
            onClick={handleReprovarPagamento}
            disabled={acaoPagamentoEmAndamento !== null}
          >
            <X className="h-4 w-4" /> {acaoPagamentoEmAndamento === "reprovar" ? "Reprovando..." : "Reprovar despesa"}
          </Button>
        </div>
      )}

      {mostrarAcoesPagamento && despesa.status === "aguardando_pagamento" && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5"
            onClick={handleReprovarPagamento}
            disabled={acaoPagamentoEmAndamento !== null}
          >
            <X className="h-4 w-4" /> {acaoPagamentoEmAndamento === "reprovar" ? "Reprovando..." : "Reprovar"}
          </Button>
          <Button
            variant="outline"
            className="text-amber-700 border-amber-400 hover:bg-amber-50 gap-1.5"
            onClick={handleSolicitarAjustePagamento}
            disabled={acaoPagamentoEmAndamento !== null}
          >
            <PenLine className="h-4 w-4" /> {acaoPagamentoEmAndamento === "ajuste" ? "Enviando..." : "Solicitar ajuste"}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={handleMarcarConferido}
            disabled={acaoPagamentoEmAndamento !== null}
          >
            <ClipboardCheck className="h-4 w-4" /> {acaoPagamentoEmAndamento === "conferir" ? "Conferindo..." : "Marcar como conferido"}
          </Button>
          <Button className="gap-1.5" onClick={abrirPagar} disabled={acaoPagamentoEmAndamento !== null}>
            <Banknote className="h-4 w-4" /> Pagar despesa
          </Button>
        </div>
      )}

      {mostrarAcoesPagamento && despesa.status === "pronto_para_pagar" && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5"
            onClick={handleReprovarPagamento}
            disabled={acaoPagamentoEmAndamento !== null}
          >
            <X className="h-4 w-4" /> {acaoPagamentoEmAndamento === "reprovar" ? "Reprovando..." : "Reprovar"}
          </Button>
          <Button
            variant="outline"
            className="text-amber-700 border-amber-400 hover:bg-amber-50 gap-1.5"
            onClick={handleSolicitarAjustePagamento}
            disabled={acaoPagamentoEmAndamento !== null}
          >
            <PenLine className="h-4 w-4" /> {acaoPagamentoEmAndamento === "ajuste" ? "Enviando..." : "Solicitar novo ajuste"}
          </Button>
          <Button className="gap-1.5" onClick={abrirPagar} disabled={acaoPagamentoEmAndamento !== null}>
            <Banknote className="h-4 w-4" /> Pagar despesa
          </Button>
        </div>
      )}

      <Dialog open={pagarAberto} onOpenChange={setPagarAberto}>
        <DialogContent className="sm:max-w-sm p-5">
          <DialogHeader>
            <DialogTitle className="text-base">Comprovante de pagamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Arquivo do comprovante</Label>
              <label className="mt-1 flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5 text-xs cursor-pointer hover:bg-muted/50">
                <Upload className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-muted-foreground">
                  {comprovanteFile ? comprovanteFile.name : "Selecionar arquivo (PDF, JPG, PNG)"}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => setComprovanteFile(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <div>
              <Label className="text-xs">Data do pagamento</Label>
              <Input type="date" className="h-8 text-xs" value={dataPagamentoConfirmado} onChange={(e) => setDataPagamentoConfirmado(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Observação (opcional)</Label>
              <textarea
                value={observacaoPagamento}
                onChange={(e) => setObservacaoPagamento(e.target.value.slice(0, 300))}
                placeholder="Digite uma observação, se necessário..."
                className="w-full min-h-12 rounded-md border border-input bg-background p-2 text-xs"
                maxLength={300}
              />
              <p className="text-[10px] text-muted-foreground text-right">{observacaoPagamento.length}/300</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPagarAberto(false)} disabled={pagando}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleConfirmarPagamento} disabled={pagando}>
              {pagando ? "Confirmando..." : "Confirmar pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!souAprovadorNivelAtual && !podeReprovarComoAprovadorPassado && !souAprovadorVendoAjuste && souSolicitante && podeAgir && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5" onClick={handleCancelar} disabled={enviando !== null}>
            <Trash2 className="h-4 w-4" /> {enviando === "cancelar" ? "Cancelando..." : "Cancelar despesa"}
          </Button>
          <Button variant="outline" className="text-amber-700 border-amber-400 hover:bg-amber-50 gap-1.5" onClick={handleReenviar} disabled={enviando !== null}>
            <RotateCcw className="h-4 w-4" /> {enviando === "reenviar" ? "Enviando..." : "Mandar para aprovação novamente"}
          </Button>
        </div>
      )}
    </div>
  );
}
