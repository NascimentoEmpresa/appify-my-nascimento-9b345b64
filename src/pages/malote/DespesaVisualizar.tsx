import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Paperclip, Trash2, RotateCcw, FileText, Package, DollarSign, Tag, Image as ImageIcon, FileSpreadsheet, File as FileIcon, Check, X, PenLine, ClipboardCheck, Banknote, Upload, AlertTriangle, Users } from "lucide-react";
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
  usePagarParcela,
  uploadAnexosMalote,
  aprovadoresDoNivel,
  nomesAprovadoresDoNivel,
  souAprovadorDoNivel,
  souAprovadorConfigurado,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  STATUS_TERMINAIS,
  STATUS_COM_PARCELA_VISIVEL,
  RateioLinha,
  Parcela,
  TipoSolicitacao,
  DespesaEvento,
  TipoEvento,
} from "@/hooks/useMaloteDespesa";
import { useOrcadoClassificacao, useOrcadoClassificacaoMultiMes } from "@/hooks/useOrcadoClassificacao";
import { useMaloteConfig, usePrazoNormalInclusao, useSouGerenteFinanceiroMalote, exigeJustificativaPorConferenciaAtrasada } from "@/hooks/useMaloteConfig";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { AnexosField } from "./AnexosField";
import { useTiposFormaPagamento } from "@/hooks/useMaloteFormaPagamento";
import { useCartaoBancos, urlLogoCartao } from "@/hooks/useMaloteCartaoCredito";
import { BancoBadge } from "@/components/financeiro/BancoBadge";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { anoMesAtual } from "@/hooks/usePlanilhaCusto";
import { RateioGrid, DimensoesRateio } from "./RateioGrid";
import { RateioAprovadorTable } from "./RateioAprovadorTable";
import { RateioParceladoTable } from "./RateioParceladoTable";
import { FluxoAprovacaoVisual } from "./FluxoAprovacaoVisual";
import { ExcluirPermanentementeButton } from "./ExcluirPermanentementeButton";
import { DiaPagamentoPicker } from "./DiaPagamentoPicker";
import { ExcecaoDiaBloqueadoField } from "./ExcecaoDiaBloqueadoField";
import { montarCombosAlcada, encontrarComboQueEstouraAlcada, rescalarRateioPorTotal } from "./orcamentoUtils";

const TIPO_SOLICITACAO_LABEL: Record<TipoSolicitacao, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

function fmtMoneyResumo(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDataResumo(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v + "T00:00:00").toLocaleDateString("pt-BR");
}

function fmtCompetenciaResumo(anoMes: string): string {
  const [ano, mes] = anoMes.split("-");
  return `${mes}/${ano}`;
}

// SIS-2026-0211 (complemento, pedido do Iury): resumo do que mudou no
// reenvio, pra ficar no Histórico junto do evento "Reenviada para
// aprovação" — sem isso, o histórico só dizia QUE foi reenviado, nunca O
// QUE mudou. Compara campo a campo (não linha a linha de input), pra não
// virar um log de cada tecla digitada.
function resumoAlteracoesRateio(antigo: RateioLinha[], novo: RateioLinha[], contratos: { id: string; nome: string }[]): string[] {
  const nomeContrato = (id: string | null | undefined) => (id ? contratos.find((c) => c.id === id)?.nome ?? "contrato removido" : "sem contrato");
  const antigosPorId = new Map(antigo.filter((l) => l.id).map((l) => [l.id as string, l]));
  const idsNovos = new Set(novo.filter((l) => l.id).map((l) => l.id as string));
  const linhas: string[] = [];

  for (const l of novo) {
    const anterior = l.id ? antigosPorId.get(l.id) : undefined;
    if (!anterior) {
      linhas.push(`Rateio: linha adicionada (${nomeContrato(l.contrato_id)}, ${fmtMoneyResumo(l.valor)})`);
      continue;
    }
    if (Number(anterior.valor) !== Number(l.valor)) {
      linhas.push(`Rateio (${nomeContrato(l.contrato_id)}): valor ${fmtMoneyResumo(anterior.valor)} → ${fmtMoneyResumo(l.valor)}`);
    }
    if ((anterior.contrato_id ?? null) !== (l.contrato_id ?? null)) {
      linhas.push(`Rateio: contrato ${nomeContrato(anterior.contrato_id)} → ${nomeContrato(l.contrato_id)}`);
    }
  }
  for (const l of antigo) {
    if (l.id && !idsNovos.has(l.id)) {
      linhas.push(`Rateio: linha removida (${nomeContrato(l.contrato_id)}, ${fmtMoneyResumo(l.valor)})`);
    }
  }
  return linhas;
}

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
        {evento.descricao && <p className="text-muted-foreground text-xs whitespace-pre-line">{evento.descricao}</p>}
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

// SIS-2026-0212: o comprovante anexado pelo financeiro no pagamento
// (comprovante_pagamento_path, via malote_pagar_despesa) nunca aparecia em
// lugar nenhum depois de salvo — só existia dentro do banco. Mesmo visual
// do TileDestaque, mas clicável (abre o anexo) e com fundo verde de
// propósito, pra ficar destacado igual pedido.
function TileComprovante({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative overflow-hidden rounded-lg border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30 p-3 text-left transition hover:bg-emerald-100 dark:hover:bg-emerald-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
    >
      <div
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1"
        style={{
          WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
        }}
      >
        <span className="[&>svg]:h-14 [&>svg]:w-14 text-emerald-300 dark:text-emerald-800">
          <Paperclip />
        </span>
      </div>
      <p className="relative z-10 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Comprovante de pagamento</p>
      <p className="relative z-10 text-base font-semibold mt-0.5 truncate max-w-[85%] text-emerald-900 dark:text-emerald-200">{label}</p>
    </button>
  );
}

export default function DespesaVisualizar() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading } = useDespesa(id);
  const { data: eventos = [] } = useDespesaEventos(id);
  const { data: solicitanteNome } = useNomeUsuario(data?.despesa?.created_by);
  const { data: pagoPorNome } = useNomeUsuario(data?.despesa?.pago_por);
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
  const pagarParcela = usePagarParcela();

  const [valorAprovado, setValorAprovado] = useState("");
  // SIS-2026-0292 (Iury): "Dados da Despesa" (Nome/Classificação/Arquivos)
  // sempre foi só-leitura, mesmo durante ajuste — lacuna real: o
  // solicitante não tinha como corrigir um erro de digitação no nome ou
  // uma Classificação errada sem cancelar a despesa inteira e começar de
  // novo. Editável no mesmo gate de "Dados da Aprovação e Pagamento"/Rateio
  // (rateioEPagamentoEditaveis, abaixo).
  const [nomeEditado, setNomeEditado] = useState("");
  const [classificacaoIdEditado, setClassificacaoIdEditado] = useState("");
  const [arquivosExistentes, setArquivosExistentes] = useState<string[]>([]);
  const [arquivosNovos, setArquivosNovos] = useState<File[]>([]);
  const [justificativa, setJustificativa] = useState("");
  const [comentario, setComentario] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [informacoesPagamento, setInformacoesPagamento] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [excecao, setExcecao] = useState(false);
  const [justificativaExcecao, setJustificativaExcecao] = useState("");
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
  // SIS-2026-0307 (Iury): "Forma de pagamento" pré-selecionada com a que já
  // está na despesa, mas editável — e "Banco" novo, vindo do catálogo do
  // Cartão de Crédito. Estado PRÓPRIO do dialog de pagamento (não
  // reaproveita o `formaPagamento` do card "Dados de pagamento e
  // Aprovação" mais abaixo — são dois momentos diferentes; usar o mesmo
  // state faria o Select daquele card mudar visualmente antes mesmo de
  // confirmar o pagamento).
  const [formaPagamentoConfirmada, setFormaPagamentoConfirmada] = useState("");
  const [bancoIdConfirmado, setBancoIdConfirmado] = useState("");
  const [pagando, setPagando] = useState(false);
  // SIS-2026-0223: qual parcela está sendo paga no Dialog de comprovante
  // (reaproveitado) — null = pagamento é da despesa inteira (não parcelada).
  const [parcelaEmPagamento, setParcelaEmPagamento] = useState<Parcela | null>(null);
  const [confirmarAprovarParceladoAberto, setConfirmarAprovarParceladoAberto] = useState(false);

  const despesa = data?.despesa;

  // Orçado da Classificação no período da despesa (SIS-2026-0132/0168) —
  // usado só pra decidir se a aprovação escalona pro próximo nível ou vai
  // direto pro pagamento (a % de alçada do aprovador nunca bloqueia o
  // aprovador de agir, só decide o destino depois de aprovado).
  //
  // SIS-2026-0223 (complemento, pedido do Iury): despesa parcelada consome
  // orçamento mês a mês (parcela 1 em agosto, parcela 2 em setembro...), não
  // tudo de uma vez em despesa.competencia. Alinhado com o Iury: só a
  // PARCELA 1 decide a alçada — se ela estourar, escala N1→N2→N3; as
  // seguintes não são checadas de novo (o aprovador só precisa saber que
  // aprovar a despesa aprova todas as parcelas junto — já é o que o modal
  // de confirmação avisa).
  const parcela1 = despesa?.parcelado ? data?.parcelas.find((p) => p.numero_parcela === 1) : undefined;
  const anoMesDespesa = parcela1
    ? parcela1.data_vencimento.slice(0, 7)
    : despesa?.competencia
      ? despesa.competencia.slice(0, 7)
      : anoMesAtual();
  // Fração da parcela 1 sobre o total — cada linha de rateio (que soma o
  // valor CHEIO da despesa) precisa ser escalada por essa fração pra
  // representar só o que a parcela 1 consome do orçamento do mês dela.
  // Sem parcelamento, fator = 1 (não escala nada).
  const fatorParcela1 = despesa?.parcelado && parcela1 && despesa.valor_total ? parcela1.valor / despesa.valor_total : 1;
  // SIS-2026-0212 (complemento): "orcadoCarregando" trava o botão Aprovar —
  // achado real (DM-2026-0041): o aprovador clicou Aprovar antes dos dados
  // de planejamento/rubricas terminarem de carregar, resolverOrcado()
  // devolveu 0 momentaneamente, a % de alçada saiu errada (deu "dentro"
  // quando era 105% do orçado) e essa decisão errada foi gravada pra
  // sempre — o RPC malote_aprovar_despesa confia cegamente no que o
  // client manda, sem reconferir nada no banco.
  const { resolver: resolverOrcado, isLoading: orcadoCarregando } = useOrcadoClassificacao(despesa?.empresa_id, anoMesDespesa);
  // SIS-2026-0261 (Iury): a alçada de uma despesa parcelada precisa checar
  // TODAS as parcelas (mês a mês), não só a 1ª — achado real: a 3ª parcela
  // estourava o orçado do mês dela e mesmo assim a despesa ia direto pro
  // pagamento na aprovação de N1, porque só a parcela 1 era checada (ver
  // dentroDaAlcada abaixo).
  const { resolver: resolverOrcadoMultiMes, isLoading: orcadoMultiMesCarregando } = useOrcadoClassificacaoMultiMes(despesa?.empresa_id);
  const { data: utilizadoLinhasGlobal = [] } = useUtilizadoOrcamento();
  // SIS-2026-0221: "Forma de pagamento" vem do catálogo cadastrável em
  // Configurações do Malote → Formas de Pagamento, não mais de um enum fixo.
  const { data: tiposFormaPagamento = [] } = useTiposFormaPagamento();
  // SIS-2026-0307: Banco do dialog de pagamento vem do mesmo catálogo do
  // Cartão de Crédito (malote_cartao_banco) — não cria catálogo novo.
  const { data: bancos = [] } = useCartaoBancos();
  const { data: maloteConfig } = useMaloteConfig();
  // SIS-2026-0250 (errata: exceção continua nascendo no Nível 1 e passa
  // pela avaliação normal do N1 — não pula mais nada na inclusão). Quando
  // o N1 aprova uma exceção, a escalada pro Nível 2 é obrigatória (ver
  // proximoNivelConfigurado abaixo). A Carol (cargo GERENTE FINANCEIRO)
  // pode agir a partir do Nível 2 em diante, como reforço, mesmo sem
  // estar configurada como aprovadora 2 daquela Classificação — nunca no
  // Nível 1, pra nunca pular a avaliação do N1.
  const { data: souGerenteFinanceiro } = useSouGerenteFinanceiroMalote();
  const { data: prazoNormal } = usePrazoNormalInclusao();
  // SIS-2026-0292: catálogo inteiro de Classificações pro combobox de
  // "corrigir classificação" — a que já vem no join da despesa
  // (despesa.classificacao) só tem a ATUAL, não serve pra listar opções.
  const { data: classificacoesCatalogo = [] } = useClassificacoesOrcamentoAdmin();

  useEffect(() => {
    if (!despesa) return;
    setValorAprovado(despesa.valor_aprovado != null ? String(despesa.valor_aprovado) : String(despesa.valor_total));
    setNomeEditado(despesa.nome);
    setClassificacaoIdEditado(despesa.classificacao_id ?? "");
    setArquivosExistentes(despesa.arquivos ?? []);
    setArquivosNovos([]);
    setJustificativa(despesa.justificativa_aprovacao ?? "");
    setFormaPagamento(despesa.forma_pagamento ?? "");
    setInformacoesPagamento(despesa.informacoes_pagamento ?? "");
    setDataPagamento(despesa.data_pagamento ?? "");
    setExcecao(despesa.excecao);
    setJustificativaExcecao(despesa.justificativa_excecao ?? "");
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

  // SIS-2026-0221: o valor já gravado pode não estar mais entre os Tipos
  // ativos (renomeado/desativado depois) — inclui ele mesmo assim na lista
  // pra não "sumir" o dado já salvo ao abrir a tela.
  const tiposFormaPagamentoAtivos = tiposFormaPagamento.filter((t) => t.ativo);
  const opcoesFormaPagamento =
    formaPagamento && !tiposFormaPagamentoAtivos.some((t) => t.nome === formaPagamento)
      ? [...tiposFormaPagamentoAtivos, { nome: formaPagamento, ativo: false }]
      : tiposFormaPagamentoAtivos;

  // SIS-2026-0307: mesmo padrão acima, só que pro Select "Forma de
  // pagamento" do dialog de pagamento (estado próprio, formaPagamentoConfirmada).
  const opcoesFormaPagamentoConfirmada =
    formaPagamentoConfirmada && !tiposFormaPagamentoAtivos.some((t) => t.nome === formaPagamentoConfirmada)
      ? [...tiposFormaPagamentoAtivos, { nome: formaPagamentoConfirmada, ativo: false }]
      : tiposFormaPagamentoAtivos;

  // SIS-2026-0307: Banco (catálogo do Cartão de Crédito) — mesma ideia de
  // sempre incluir o valor já selecionado, mesmo que tenha sido
  // desativado depois.
  const bancosAtivos = bancos.filter((b) => b.ativo);
  const bancoConfirmadoInativo =
    bancoIdConfirmado && !bancosAtivos.some((b) => b.id === bancoIdConfirmado)
      ? bancos.find((b) => b.id === bancoIdConfirmado)
      : undefined;
  const opcoesBanco = bancoConfirmadoInativo ? [...bancosAtivos, bancoConfirmadoInativo] : bancosAtivos;

  // Papéis do usuário logado em relação a esta despesa — SIS-2026-0132 Fase 1.
  const souSolicitante = despesa.created_by === user?.id;
  // SIS-2026-0250: Carol age em exceção como reforço a partir do Nível 2
  // (nunca no Nível 1 — a exceção sempre precisa passar pela avaliação
  // normal do N1 primeiro), mesmo sem estar configurada como aprovadora 2
  // daquela Classificação.
  const souGerenteFinanceiroDestaExcecao =
    despesa.excecao && despesa.nivel_aprovacao_atual !== 1 && !!souGerenteFinanceiro;
  const souAprovadorNivelAtual =
    despesa.status === "pendente_aprovacao" &&
    despesa.nivel_aprovacao_atual != null &&
    (souAprovadorDoNivel(despesa, despesa.nivel_aprovacao_atual, user?.id) || souGerenteFinanceiroDestaExcecao);
  const configurado = souAprovadorConfigurado(despesa, user?.id) || souGerenteFinanceiroDestaExcecao;
  // SIS-2026-0192: "Dados da Aprovação e Pagamento" e "Rateio da Despesa"
  // só podem ser alterados pelo Solicitante — ninguém mais edita, nem
  // admin/supervisor/aprovador. Pra qualquer outro papel o Rateio vira
  // só-leitura com as colunas de Orçado/Utilizado/Status.
  //
  // SIS-2026-0261 (achado real do Iury): a condição usava só "!bloqueado"
  // (= não terminal), deixando o solicitante editar em QUALQUER status não
  // terminal — inclusive com a despesa já pendente_aprovacao, aguardando N1
  // olhar. O comentário original já dizia a intenção certa ("ex.: quando o
  // aprovador pede ajuste"), só a implementação nunca restringiu de fato.
  // Agora só edita em rascunho (antes de enviar) e necessidade_de_ajuste
  // (depois que o aprovador pediu correção) — nos demais status não
  // terminais (pendente_aprovacao, aguardando_pagamento, etc.), mesmo o
  // solicitante vê só-leitura até virar ajuste de novo ou ser reenviada.
  const rateioEPagamentoEditaveis = souSolicitante && (despesa.status === "rascunho" || despesa.status === "necessidade_de_ajuste");
  // SIS-2026-0223 (complemento 3, pedido do usuário): pra despesa
  // parcelada, o Rateio só é editável na fase de lançamento — depois que
  // entra em fase de pagamento (mesma fronteira de
  // STATUS_COM_PARCELA_VISIVEL), ninguém redistribui empresa/contrato de
  // novo, nem o solicitante, nem durante ajuste_pagamento (que é sobre
  // dado de pagamento, não rateio). Reforçado no banco (WITH CHECK de
  // malote_rateio_linha_all) — isto aqui só decide a UI. Despesa não
  // parcelada mantém o comportamento de sempre.
  const rateioEditavel =
    rateioEPagamentoEditaveis && (!despesa.parcelado || !STATUS_COM_PARCELA_VISIVEL.includes(despesa.status));
  // SIS-2026-0292: opções do combobox de Classificação (corrigir erro de
  // digitação) — inclui a atual mesmo se estiver inativa, pra não "sumir"
  // a seleção já salva (mesmo critério de tiposFormaPagamentoAtivos acima).
  const classificacoesOpcoes = classificacoesCatalogo
    .filter((c) => c.ativo || c.id === despesa.classificacao_id)
    .map((c) => ({ value: c.id, label: c.nome }));
  const classificacaoEditadaCatalogo = classificacoesCatalogo.find((c) => c.id === classificacaoIdEditado);

  // SIS-2026-0292 (Iury): "alterando o Valor Total, altera proporcionalmente
  // o rateio perante as porcentagens" — antes, mudar esse campo não mexia
  // em mais nada (nem no despesa.valor_total salvo no reenvio, nem nas
  // linhas do Rateio, que ficavam com a soma antiga).
  function handleValorTotalChange(valor: string) {
    setValorAprovado(valor);
    const novoTotal = Number(valor);
    if (!novoTotal || novoTotal <= 0) return;
    setLinhasRateio((atual) => rescalarRateioPorTotal(atual, novoTotal));
  }
  // SIS-2026-0212 (pedido do Iury): a "Justificativa da aprovação" é o
  // único campo deste bloco que o aprovador do nível atual também precisa
  // editar — é onde ele registra o motivo de escalar de N1 pra N2 (os
  // outros campos continuam só do solicitante, por SIS-2026-0192).
  const podeEditarJustificativaAprovacao = rateioEPagamentoEditaveis || souAprovadorNivelAtual;
  const podeReprovarComoAprovadorPassado =
    configurado && ((despesa.status === "pendente_aprovacao" && !souAprovadorNivelAtual) || despesa.status === "aguardando_pagamento");
  const souAprovadorVendoAjuste = despesa.status === "necessidade_de_ajuste" && configurado && !souSolicitante;
  const proximoNivelExiste =
    despesa.nivel_aprovacao_atual != null && despesa.nivel_aprovacao_atual < 3
      ? aprovadoresDoNivel(despesa, (despesa.nivel_aprovacao_atual + 1) as 1 | 2 | 3).length > 0
      : false;

  // % de alçada (SIS-2026-0132, cadastrado desde sempre mas nunca
  // consumido): o aprovador do nível atual SEMPRE pode aprovar/reprovar,
  // independente do valor — a % só decide se, ao aprovar, a despesa
  // escalona pro próximo nível ou vai direto pro pagamento. Orçado
  // desconhecido ou limite não cadastrado nunca bloqueia (trata como sem
  // trava, pra não quebrar classificações que nunca preencheram o campo).
  const alcadaNivelAtual = (() => {
    const c = despesa.classificacao;
    const nivel = despesa.nivel_aprovacao_atual;
    if (!c || !nivel) return { semLimite: true, limitePct: null as number | null };
    if (nivel === 1) return { semLimite: !!c.aprovador1_sem_limite, limitePct: c.aprovador1_limite_pct ?? null };
    if (nivel === 2) return { semLimite: !!c.aprovador2_sem_limite, limitePct: c.aprovador2_limite_pct ?? null };
    return { semLimite: !!c.aprovador3_sem_limite, limitePct: c.aprovador3_limite_pct ?? null };
  })();
  // Achado real (SIS-2026-0212, DM-2026-0048): utilizadoAntesNoMes usava só o
  // valor desta despesa (ex.: 500/948 = 52,74%), nunca somava o que outras
  // despesas da mesma Classificação já tinham consumido no mês — por isso
  // a % nunca refletia o estouro de verdade. Mesma soma de "utilizado
  // antes" usada em calcularRateioSnapshot/RateioAprovadorTable, só que
  // aqui na decisão de escalar. Recebe o contrato porque, com Rateio em
  // mais de 1 contrato (ver montarCombosAlcada abaixo), cada linha consome
  // o orçado do SEU contrato, não o do despesa.contrato_id geral.
  function utilizadoAntesNoMes(contratoId: string | null, mes: string): number {
    return utilizadoLinhasGlobal.reduce((soma, u) => {
      if (u.despesa_id === despesa!.id) return soma;
      if (u.classificacao_id !== despesa!.classificacao_id) return soma;
      if (!u.competencia || u.competencia.slice(0, 7) !== mes) return soma;
      if ((u.contrato_id ?? null) !== contratoId) return soma;
      return soma + (Number(u.valor) || 0);
    }, 0);
  }
  // SIS-2026-0261 (Iury, dois achados reais):
  // 1) despesa parcelada checava só a parcela 1 pra decidir a alçada
  //    (premissa anterior de SIS-2026-0223: "as parcelas sempre teriam
  //    orçamento", que não se confirmou — a 3ª parcela de um teste real
  //    estourou o orçado do mês dela e N1 aprovou tudo direto pro
  //    pagamento mesmo assim);
  // 2) despesa com Rateio em MAIS DE 1 contrato checava só
  //    despesa.contrato_id (o contrato "principal" da despesa, quando
  //    tinha um) — um Rateio em 4 contratos, com 2 deles estourando o
  //    orçado deles, também passava direto por N1 sem escalar.
  // A correção (montarCombosAlcada/encontrarComboQueEstouraAlcada, extraídas
  // pra orcamentoUtils.ts como lógica pura testável) junta os dois: cada
  // COMBINAÇÃO (linha de rateio × parcela, ou só a linha quando não é
  // parcelada) é checada contra o orçado do SEU contrato no mês do SEU
  // vencimento — se qualquer combinação estourar a alçada do nível atual, a
  // despesa inteira escala (não dá pra escalar só 1 linha/parcela, o
  // aprovador decide sobre a despesa como um todo).
  const combosParaAlcada = montarCombosAlcada({
    parcelado: !!despesa.parcelado,
    parcelas: data?.parcelas ?? [],
    linhas: linhasRateio,
    valorTotalDespesa: despesa.valor_total,
    anoMesDespesa,
    // "Valor aprovado" (editável pelo aprovador antes de aprovar) só existe
    // pra despesa não parcelada — escala cada linha por esse ajuste, mesma
    // ideia do fatorParcela1 já usado pra parcela.
    fatorValorAprovado: despesa.valor_total ? (Number(valorAprovado) || despesa.valor_total) / despesa.valor_total : 1,
  });
  const parcelaQueEstourouAlcada = encontrarComboQueEstouraAlcada(
    combosParaAlcada,
    alcadaNivelAtual.limitePct,
    (contratoId, mes) => resolverOrcadoMultiMes(despesa!.classificacao_id, contratoId, mes),
    utilizadoAntesNoMes
  );
  const dentroDaAlcada = alcadaNivelAtual.semLimite || alcadaNivelAtual.limitePct == null || !parcelaQueEstourouAlcada;
  // SIS-2026-0261 (Iury, achado real DM-2026-0086): "já vir com a
  // informação pra contextualizar N2" — quem está vendo a despesa (N1
  // decidindo, N2 revisando depois) precisa ver QUAL parcela/contrato
  // estourou o orçado de verdade (>100%), sem precisar navegar parcela a
  // parcela no Rateio pra achar. Deliberadamente >100% fixo aqui, não a %
  // de alçada configurada (essa decide SE escala; isso aqui só explica o
  // motivo em linguagem simples, e continua valendo pra quem vê a despesa
  // depois de já ter escalado, mesmo que o nível atual tenha outra alçada).
  const comboQueEstourouOrcamento = encontrarComboQueEstouraAlcada(
    combosParaAlcada,
    100,
    (contratoId, mes) => resolverOrcadoMultiMes(despesa!.classificacao_id, contratoId, mes),
    utilizadoAntesNoMes
  );
  const infoEstouroOrcamento = (() => {
    if (!comboQueEstourouOrcamento) return null;
    const { mes, contratoId, valor } = comboQueEstourouOrcamento;
    const orcadoDoMes = resolverOrcadoMultiMes(despesa.classificacao_id, contratoId, mes);
    const utilizadoAcumulado = utilizadoAntesNoMes(contratoId, mes) + valor;
    const percentual = orcadoDoMes ? (utilizadoAcumulado / orcadoDoMes) * 100 : null;
    const nomeContrato = contratoId ? contratos.find((c) => c.id === contratoId)?.nome ?? null : null;
    const parcelaCorrespondente = despesa.parcelado ? data?.parcelas.find((p) => p.data_vencimento.slice(0, 7) === mes) : undefined;
    return { mes, orcadoDoMes, utilizadoAcumulado, percentual, nomeContrato, parcelaCorrespondente };
  })();
  // SIS-2026-0250: N1 aprovando uma exceção sempre escala pro Nível 2 —
  // não fica sujeito à alçada (Carol/Gerente Financeiro é o reforço do
  // Nível 2 mesmo quando não há Aprovador 2 configurado na Classificação,
  // então "próximo nível existe" vale mesmo com o array vazio). O RPC
  // malote_aprovar_despesa reforça essa mesma regra no banco.
  const escalaObrigatoriaPorExcecao = despesa.nivel_aprovacao_atual === 1 && despesa.excecao;
  const proximoNivelConfigurado = escalaObrigatoriaPorExcecao || (proximoNivelExiste && !dentroDaAlcada);

  // Pagamento Malote (SIS-2026-0160) — elegibilidade resolvida só pelo
  // gerenciamento de acesso (usePodePagarMalote), não por linha da despesa.
  const mostrarAcoesPagamento =
    !!podePagarMalote && ["aguardando_pagamento", "pronto_para_pagar", "ajuste_pagamento"].includes(despesa.status);

  // SIS-2026-0223: enquanto a despesa ainda está no fluxo de aprovação
  // (N1/N2/N3), as parcelas ainda não são "pagáveis" de verdade — mesma
  // lista de status de STATUS_COM_PARCELA_VISIVEL em useMaloteDespesa.ts.
  const parcelasEmFaseDePagamento = ["aguardando_pagamento", "pronto_para_pagar", "ajuste_pagamento", "despesa_paga"].includes(despesa.status);

  function validarAcaoAprovador(): string | null {
    // SIS-2026-0261: mesmo achado do SIS-2026-0212 (comentário acima de
    // orcadoCarregando) — agora vale também pros dados usados pra checar
    // o orçado de CADA parcela/contrato do Rateio, não só do mês principal.
    if (orcadoCarregando || orcadoMultiMesCarregando) return "Aguarde o orçamento terminar de carregar antes de aprovar.";
    if (!formaPagamento) return "Selecione a forma de pagamento.";
    // SIS-2026-0264: "Informações de pagamento" só é obrigatório quando a
    // despesa NÃO foi lançada como "pagamento só por anexo" — esse flag não
    // é persistido à parte, então o jeito de saber aqui (aprovador) é o
    // mesmo dado que já existe: se não tem texto mas tem ao menos um
    // arquivo anexado, o anexo (ex. boleto) É a informação de pagamento.
    // Achado do Iury: aprovador ficava travado tentando aprovar despesa
    // que a própria tela de criação já validou como válida sem esse campo.
    if (!informacoesPagamento.trim() && despesa!.arquivos.length === 0) {
      return "Informe os dados de pagamento (ou confira se há um arquivo anexado).";
    }
    if (!dataPagamento) return "Informe a data de pagamento.";
    if (!competencia) return "Informe a competência.";
    if (!valorAprovado || Number(valorAprovado) <= 0) return "Informe o Valor Total.";
    // SIS-2026-0212 (pedido do Iury): ao escalar de N1 pra N2 (estourou a
    // alçada do Nível 1), o aprovador do N1 precisa registrar o motivo.
    if (despesa!.nivel_aprovacao_atual === 1 && proximoNivelConfigurado && !justificativa.trim()) {
      return "Informe a justificativa da aprovação — obrigatória quando a despesa escala para o Nível 2.";
    }
    // SIS-2026-0250 (regra 1.2): N1 aprovando depois do horário de
    // conferência exige justificativa também — mesmo campo, outro
    // gatilho. N2/N3 nunca caem aqui (aprovam a qualquer momento).
    // SIS-2026-0272: só dispara quando a despesa precisa ser resolvida hoje
    // (ver exigeJustificativaPorConferenciaAtrasada).
    if (
      despesa!.nivel_aprovacao_atual === 1 &&
      exigeJustificativaPorConferenciaAtrasada(dataPagamento, maloteConfig?.conferencia_aprovacao_horario) &&
      !justificativa.trim()
    ) {
      return `Informe a justificativa da aprovação — obrigatória depois do horário limite de conferência (regra 1.2, ${maloteConfig?.conferencia_aprovacao_horario}) para despesa com pagamento hoje ou vencido.`;
    }
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
        rateio_snapshot: calcularRateioSnapshot(),
      });
      toast.success(
        proximoNivelConfigurado
          ? "Aprovado — enviado pro próximo nível."
          : despesa!.parcelado
            ? `Todas as ${despesa!.numero_parcelas} parcelas aprovadas — aguardando pagamento.`
            : "Aprovado — aguardando pagamento."
      );
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao aprovar despesa.");
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  // SIS-2026-0223: despesa parcelada pede confirmação antes de aprovar —
  // aprovar a despesa aprova as N parcelas juntas de uma vez (só existe 1
  // despesa por baixo, nunca foram unidades de aprovação separadas), então
  // o aviso vem ANTES da ação (evita "já aprovei sem querer, o aviso
  // apareceu depois").
  function onClickAprovar() {
    const erro = validarAcaoAprovador();
    if (erro) {
      toast.error(erro);
      return;
    }
    if (despesa!.parcelado) {
      setConfirmarAprovarParceladoAberto(true);
      return;
    }
    handleAprovar();
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
    setParcelaEmPagamento(null);
    setComprovanteFile(null);
    setDataPagamentoConfirmado(despesa!.data_pagamento ?? new Date().toISOString().slice(0, 10));
    setObservacaoPagamento("");
    // SIS-2026-0307: "pré-selecionada a forma que o usuário selecionou" —
    // parte do que já está na despesa, editável a partir daqui.
    setFormaPagamentoConfirmada(despesa!.forma_pagamento ?? "");
    setBancoIdConfirmado(despesa!.banco_id ?? "");
    setPagarAberto(true);
  }

  // SIS-2026-0223: despesa parcelada é paga parcela por parcela — cada
  // botão "Pagar" da tabela de Parcelas abre o mesmo Dialog de comprovante,
  // guardando qual parcela está sendo paga.
  function abrirPagarParcela(p: Parcela) {
    setParcelaEmPagamento(p);
    setComprovanteFile(null);
    setDataPagamentoConfirmado(p.data_vencimento);
    setObservacaoPagamento("");
    setFormaPagamentoConfirmada(despesa!.forma_pagamento ?? "");
    // Parcela ainda não paga não tem banco próprio — cai pro que já foi
    // usado nas parcelas anteriores (via sincronização em malote_despesa).
    setBancoIdConfirmado(p.banco_id ?? despesa!.banco_id ?? "");
    setPagarAberto(true);
  }

  // SIS-2026-0212 (complemento): mesmo cálculo de "utilizado antes desta
  // despesa" da RateioAprovadorTable, aqui só pra congelar no momento do
  // pagamento — não fica em um hook compartilhado porque só é chamado
  // uma vez, aqui.
  function calcularRateioSnapshot(): { linha_id: string; orcado: number | null; utilizado_com_lancamento: number | null }[] {
    const utilizadoAntesPorContrato = new Map<string, number>();
    for (const u of utilizadoLinhasGlobal) {
      if (u.despesa_id === despesa!.id) continue;
      if (u.classificacao_id !== despesa!.classificacao_id) continue;
      if (!u.competencia || u.competencia.slice(0, 7) !== anoMesDespesa) continue;
      const chave = u.contrato_id ?? "__sem_contrato__";
      utilizadoAntesPorContrato.set(chave, (utilizadoAntesPorContrato.get(chave) ?? 0) + (Number(u.valor) || 0));
    }
    return linhasRateio
      .filter((l) => l.id)
      .map((l) => {
        const orcado = resolverOrcado(despesa!.classificacao_id, l.contrato_id);
        const chave = l.contrato_id ?? "__sem_contrato__";
        const utilizadoAntes = utilizadoAntesPorContrato.get(chave) ?? 0;
        // SIS-2026-0223 (complemento): despesa parcelada congela o que a
        // parcela 1 consumiu (é ela que decidiu a alçada), não o valor
        // cheio da linha de rateio.
        return { linha_id: l.id as string, orcado, utilizado_com_lancamento: utilizadoAntes + (Number(l.valor) || 0) * fatorParcela1 };
      });
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
      // SIS-2026-0291 (Iury): comprovante sobe com "Nome da despesa -
      // Comprovante", não mais UUID cru.
      const [comprovantePath] = await uploadAnexosMalote([comprovanteFile], despesa!.id, `${despesa!.nome} - Comprovante`);
      if (despesa!.parcelado && parcelaEmPagamento) {
        await pagarParcela.mutateAsync({
          despesaId: despesa!.id,
          parcelaId: parcelaEmPagamento.id,
          data_pagamento: dataPagamentoConfirmado,
          comprovante_path: comprovantePath,
          observacao: observacaoPagamento.trim() || null,
          rateio_snapshot: calcularRateioSnapshot(),
          forma_pagamento: formaPagamentoConfirmada || null,
          banco_id: bancoIdConfirmado || null,
        });
        toast.success(`Parcela ${parcelaEmPagamento.numero_parcela}/${despesa!.numero_parcelas} paga.`);
      } else {
        await pagar.mutateAsync({
          id: despesa!.id,
          data_pagamento: dataPagamentoConfirmado,
          comprovante_path: comprovantePath,
          rateio_snapshot: calcularRateioSnapshot(),
          observacao: observacaoPagamento.trim() || null,
          forma_pagamento: formaPagamentoConfirmada || null,
          banco_id: bancoIdConfirmado || null,
        });
        toast.success("Pagamento confirmado.");
      }
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
    if (!nomeEditado.trim()) {
      toast.error("Informe o nome da despesa.");
      return;
    }
    if (!classificacaoIdEditado) {
      toast.error("Selecione a Classificação.");
      return;
    }
    if (!valorAprovado || Number(valorAprovado) <= 0) {
      toast.error("Informe o Valor Total.");
      return;
    }
    setEnviando("reenviar");
    try {
      const valorTotalNovo = Number(valorAprovado);
      // SIS-2026-0291 (reaproveitado aqui): anexo novo sobe já com o nome
      // da despesa (nome ATUAL, que pode ter sido corrigido nesta mesma
      // tela — por isso usa nomeEditado, não despesa!.nome).
      const novosPaths = arquivosNovos.length > 0 ? await uploadAnexosMalote(arquivosNovos, despesa!.id, nomeEditado.trim()) : [];
      const arquivosFinais = [...arquivosExistentes, ...novosPaths];

      // Resumo do que mudou desde a última vez, pro Histórico — compara
      // contra o snapshot original (despesa/data.rateio, antes das edições
      // desta tela), não contra o que já foi salvo em reenvios anteriores.
      const partesResumo: string[] = [];
      // SIS-2026-0292 (Iury): "Dados da Despesa" (Nome/Classificação/Valor/
      // Arquivos) virou editável durante o ajuste — antes o solicitante não
      // tinha como corrigir um erro de digitação sem cancelar tudo.
      if (despesa!.nome !== nomeEditado.trim()) {
        partesResumo.push(`Nome: ${despesa!.nome} → ${nomeEditado.trim()}`);
      }
      if ((despesa!.classificacao_id ?? "") !== classificacaoIdEditado) {
        const nomeAntigo = despesa!.classificacao?.nome ?? "—";
        const nomeNovo = classificacoesCatalogo.find((c) => c.id === classificacaoIdEditado)?.nome ?? "—";
        partesResumo.push(`Classificação: ${nomeAntigo} → ${nomeNovo}`);
      }
      if (arquivosFinais.length !== despesa!.arquivos.length || arquivosNovos.length > 0) {
        partesResumo.push("Arquivos anexados alterados");
      }
      if ((despesa!.forma_pagamento ?? "") !== (formaPagamento || "")) {
        partesResumo.push(
          `Forma de pagamento: ${despesa!.forma_pagamento || "—"} → ${formaPagamento || "—"}`
        );
      }
      if ((despesa!.informacoes_pagamento ?? "") !== informacoesPagamento) {
        partesResumo.push("Dados de pagamento alterados");
      }
      if ((despesa!.data_pagamento ?? "") !== dataPagamento) {
        partesResumo.push(`Data de pagamento: ${fmtDataResumo(despesa!.data_pagamento)} → ${fmtDataResumo(dataPagamento)}`);
      }
      const competenciaAtual = despesa!.competencia ? despesa!.competencia.slice(0, 7) : "";
      if (competenciaAtual !== competencia) partesResumo.push("Competência alterada");
      // SIS-2026-0292: "Valor aprovado" virou "Valor Total" — agora
      // alterá-lo também atualiza despesa.valor_total (antes só ficava
      // gravado à parte, em valor_aprovado, sem refletir em mais nada).
      if (despesa!.valor_total !== valorTotalNovo) {
        partesResumo.push(`Valor Total: ${fmtMoneyResumo(despesa!.valor_total)} → ${fmtMoneyResumo(valorTotalNovo)}`);
      }
      if (despesa!.excecao !== excecao) partesResumo.push(excecao ? "Marcada como Exceção (dia bloqueado)" : "Exceção removida");
      partesResumo.push(...resumoAlteracoesRateio(data?.rateio ?? [], linhasRateio, contratos));

      await reenviar.mutateAsync({
        id: despesa!.id,
        empresa_id: despesa!.empresa_id,
        classificacao_id: classificacaoIdEditado,
        origem: despesa!.origem,
        status: despesa!.status,
        nome: nomeEditado.trim(),
        valor_total: valorTotalNovo,
        valor_aprovado: valorAprovado ? Number(valorAprovado) : null,
        justificativa_aprovacao: justificativa || null,
        forma_pagamento: formaPagamento || null,
        informacoes_pagamento: informacoesPagamento || null,
        data_pagamento: dataPagamento || null,
        excecao,
        justificativa_excecao: excecao ? justificativaExcecao.trim() || null : null,
        competencia: competencia ? competencia + "-01" : null,
        arquivos: arquivosFinais,
        rateio: linhasRateio,
        descricaoEvento: partesResumo.length > 0 ? partesResumo.join("\n") : null,
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
          <div className="flex items-center gap-2">
            <ExcluirPermanentementeButton
              despesaId={despesa.id}
              numero={despesa.numero}
              menu="malote_despesa_visualizar"
              voltarPara="/app/malote/meus-itens"
            />
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
            </Button>
          </div>
        }
      />

      {/* Bloco 1: cabeçalho — SIS-2026-0250: fundo/borda em vermelho quando
          é Exceção, pra chamar atenção antes de qualquer outra coisa. */}
      <Card className={cn(despesa.excecao && "border-destructive/60 bg-destructive/5 dark:bg-destructive/10")}>
        <CardContent className="p-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Nº da Despesa</p>
            <p className="font-mono font-medium flex items-center gap-2">
              {despesa.numero}
              {despesa.excecao && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> Exceção
                </Badge>
              )}
            </p>
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
                {/* SIS-2026-0292 (Iury): "Dados da Despesa" era sempre
                    bloqueado, mesmo durante ajuste — sem jeito de corrigir
                    Nome/Classificação/Valor/Arquivos errados sem cancelar a
                    despesa inteira. Editável no mesmo gate do resto da tela
                    (rateioEPagamentoEditaveis: solicitante, em rascunho ou
                    necessidade_de_ajuste). */}
                <span className="text-[11px] text-muted-foreground">{rateioEPagamentoEditaveis ? "✏️ editável" : "🔒 bloqueado"}</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <TileDestaque
                  label="Valor"
                  valor={(Number(valorAprovado) || despesa.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  icon={<DollarSign />}
                  cor="emerald"
                />
                <TileDestaque label="Classificação" valor={classificacaoEditadaCatalogo?.nome ?? despesa.classificacao?.nome ?? "—"} icon={<Tag />} cor="violet" />
              </div>

              {rateioEPagamentoEditaveis && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Nome da despesa</Label>
                    <Input value={nomeEditado} onChange={(e) => setNomeEditado(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">Classificação</Label>
                    <SearchableSelect
                      value={classificacaoIdEditado}
                      onChange={setClassificacaoIdEditado}
                      options={classificacoesOpcoes}
                      placeholder="Selecione a Classificação..."
                      searchPlaceholder="Buscar Classificação..."
                    />
                  </div>
                </div>
              )}

              <div className="text-sm space-y-2">
                {!rateioEPagamentoEditaveis && (
                  <p>
                    <span className="text-muted-foreground">Nome:</span> {despesa.nome}
                  </p>
                )}
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

              {(despesa.arquivos.length > 0 || rateioEPagamentoEditaveis) && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Arquivos anexados</p>
                  {(rateioEPagamentoEditaveis ? arquivosExistentes : despesa.arquivos).length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {(rateioEPagamentoEditaveis ? arquivosExistentes : despesa.arquivos).map((path) => (
                        <div key={path} className="flex items-center gap-2 rounded-lg border border-border p-2">
                          <button
                            type="button"
                            onClick={() => abrirAnexo(path)}
                            className="flex items-center gap-2 text-left flex-1 min-w-0 hover:text-primary"
                          >
                            <div className="h-7 w-7 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                              <IconeArquivo path={path} />
                            </div>
                            <span className="text-xs truncate">{path.split("/").pop()}</span>
                          </button>
                          {rateioEPagamentoEditaveis && (
                            <button
                              type="button"
                              onClick={() => setArquivosExistentes((atual) => atual.filter((p) => p !== path))}
                              className="text-muted-foreground hover:text-destructive shrink-0"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {rateioEPagamentoEditaveis && <AnexosField arquivos={arquivosNovos} onChange={setArquivosNovos} />}
                </div>
              )}

              {despesa.comprovante_pagamento_path && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Pagamento</p>
                  {/* SIS-2026-0291 (Iury): destaque é o nome do arquivo, não
                      mais "Pago em ..." — essa data foi pro texto de apoio
                      abaixo, junto com "Pago por". */}
                  <TileComprovante
                    label={despesa.comprovante_pagamento_path.split("/").pop() ?? "Comprovante"}
                    onClick={() => abrirAnexo(despesa.comprovante_pagamento_path!)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {despesa.pago_em && <>Pago em {new Date(despesa.pago_em).toLocaleDateString("pt-BR")}. </>}
                    {pagoPorNome && <>Pago por {pagoPorNome}. </>}
                    {despesa.conferido_em && <>Conferido em {new Date(despesa.conferido_em).toLocaleDateString("pt-BR")}. </>}
                    {despesa.observacao_pagamento && <>Observação: {despesa.observacao_pagamento}</>}
                  </p>
                </div>
              )}
            </div>

            <div className="flex-1" />

            <p className="text-xs text-muted-foreground border-t border-border pt-3 mt-4">
              {rateioEPagamentoEditaveis
                ? "Corrija o que precisar e reenvie para aprovação — o Valor Total reescala o Rateio proporcionalmente."
                : "Os dados da solicitação estão bloqueados e não podem ser alterados."}
            </p>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <p className="text-sm font-semibold mb-3">Fluxo de Aprovação</p>
            {/* Achado do usuário: em Meus Itens/na DM só dava pra ver o
                primeiro aprovador pendente (ex. "Yuri Rosa"), sem jeito de
                saber quem mais pode aprovar aquele nível. */}
            {despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs mb-3">
                <Users className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-amber-800/80 dark:text-amber-300/80">
                  Aguardando aprovação do <span className="font-medium">Nível {despesa.nivel_aprovacao_atual}</span>:{" "}
                  <span className="font-medium">
                    {nomesAprovadoresDoNivel(despesa, despesa.nivel_aprovacao_atual).join(", ") || "nenhum aprovador configurado"}
                  </span>
                  {despesa.excecao && despesa.nivel_aprovacao_atual !== 1 && (
                    <> (a Gerente Financeiro também pode aprovar/reprovar, por ser exceção)</>
                  )}
                  .
                </p>
              </div>
            )}
            <div className="flex-1 overflow-y-auto pr-1">
              <FluxoAprovacaoVisual despesa={despesa} eventos={eventos} />
            </div>
          </CardContent>
        </Card>
      </div>

      {despesa.parcelado && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold">Parcelas ({despesa.numero_parcelas}x)</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Parcela</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Pago em</TableHead>
                    <TableHead>Comprovante</TableHead>
                    {mostrarAcoesPagamento && despesa.status !== "ajuste_pagamento" && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data?.parcelas ?? []).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{p.numero_parcela}/{despesa.numero_parcelas}</TableCell>
                      <TableCell className="text-sm">{fmtDataResumo(p.data_vencimento)}</TableCell>
                      <TableCell className="text-right text-sm">{fmtMoneyResumo(p.valor)}</TableCell>
                      <TableCell>
                        {p.status === "paga" ? (
                          <Badge className={STATUS_BADGE_CLASS.despesa_paga}>Paga</Badge>
                        ) : parcelasEmFaseDePagamento ? (
                          <Badge className={STATUS_BADGE_CLASS.aguardando_pagamento}>Aguardando pagamento</Badge>
                        ) : (
                          <Badge className={STATUS_BADGE_CLASS.pendente_aprovacao}>Aguardando aprovação</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{p.pago_em ? fmtDataResumo(p.data_pagamento_real) : "—"}</TableCell>
                      <TableCell>
                        {p.comprovante_pagamento_path ? (
                          <button type="button" onClick={() => abrirAnexo(p.comprovante_pagamento_path!)} className="text-xs text-primary underline">
                            Abrir
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {mostrarAcoesPagamento && despesa.status !== "ajuste_pagamento" && (
                        <TableCell>
                          {p.status !== "paga" && (
                            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => abrirPagarParcela(p)}>
                              <Banknote className="h-3.5 w-3.5" /> Pagar
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

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
          <div className={cn("grid grid-cols-1 sm:grid-cols-3 gap-4", !rateioEPagamentoEditaveis && !podeEditarJustificativaAprovacao && "opacity-60")}>
            <div className={cn(!rateioEPagamentoEditaveis && "opacity-60")}>
              {/* SIS-2026-0292 (Iury): renomeado de "Valor aprovado" — o
                  campo já era só o solicitante quem editava (nunca o
                  aprovador, só leitura pra ele), então "aprovado" não fazia
                  sentido. Agora alterar aqui também atualiza o Valor de
                  "Dados da Despesa" e reescala o Rateio proporcionalmente
                  (ver handleValorTotalChange). */}
              <Label>Valor Total</Label>
              <Input type="number" step="0.01" value={valorAprovado} onChange={(e) => handleValorTotalChange(e.target.value)} disabled={!rateioEPagamentoEditaveis} />
            </div>
            <div>
              <Label>
                Justificativa da aprovação
                {souAprovadorNivelAtual && despesa.nivel_aprovacao_atual === 1 && (
                  <span className="text-xs text-muted-foreground font-normal">
                    {" "}
                    (obrigatória se escalar para N2{despesa.excecao && " — exceção sempre escala"}
                    {maloteConfig?.conferencia_aprovacao_horario && (
                      <> ou se aprovar após {maloteConfig.conferencia_aprovacao_horario} com pagamento hoje ou vencido</>
                    )})
                  </span>
                )}
              </Label>
              <Input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} disabled={!podeEditarJustificativaAprovacao} />
            </div>
            <div className={cn(!rateioEPagamentoEditaveis && "opacity-60")}>
              <Label>Forma de pagamento</Label>
              <Select value={formaPagamento} onValueChange={setFormaPagamento} disabled={!rateioEPagamentoEditaveis}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {opcoesFormaPagamento.map((t) => (
                    <SelectItem key={t.nome} value={t.nome}>
                      {t.nome}
                      {!t.ativo && " (inativo)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={cn(!rateioEPagamentoEditaveis && "opacity-60")}>
              <Label>Dados de pagamento</Label>
              <Input value={informacoesPagamento} onChange={(e) => setInformacoesPagamento(e.target.value)} disabled={!rateioEPagamentoEditaveis} />
            </div>
            <div className={cn(!rateioEPagamentoEditaveis && "opacity-60")}>
              <Label>Data do pagamento</Label>
              <DiaPagamentoPicker
                value={dataPagamento}
                onChange={setDataPagamento}
                disabled={!rateioEPagamentoEditaveis}
                permitirDiasBloqueados={excecao}
              />
            </div>
            <div className={cn(!rateioEPagamentoEditaveis && "opacity-60")}>
              <Label>Competência</Label>
              <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={!rateioEPagamentoEditaveis} />
            </div>
          </div>
          <ExcecaoDiaBloqueadoField
            checked={excecao}
            onCheckedChange={setExcecao}
            justificativa={justificativaExcecao}
            onJustificativaChange={setJustificativaExcecao}
            disabled={!rateioEPagamentoEditaveis}
            foraDoPrazoInclusao={!!dataPagamento && !!prazoNormal && dataPagamento < prazoNormal}
            prazoNormal={prazoNormal}
          />
          {/* SIS-2026-0261: contextualiza QUEM estiver vendo a despesa (N1
              decidindo, N2 revisando depois) sobre qual parcela/contrato
              estourou o orçado de verdade — sem isso, só dava pra descobrir
              navegando parcela a parcela no Rateio abaixo. */}
          {despesa.status === "pendente_aprovacao" && infoEstouroOrcamento && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 dark:bg-destructive/10 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <p className="text-destructive/90">
                Orçamento estourado
                {infoEstouroOrcamento.parcelaCorrespondente && (
                  <>
                    {" "}
                    na <span className="font-medium">parcela {infoEstouroOrcamento.parcelaCorrespondente.numero_parcela}/{despesa.numero_parcelas}</span>
                  </>
                )}
                {infoEstouroOrcamento.nomeContrato && (
                  <>
                    {" "}
                    do contrato <span className="font-medium">{infoEstouroOrcamento.nomeContrato}</span>
                  </>
                )}{" "}
                ({fmtCompetenciaResumo(infoEstouroOrcamento.mes)}): orçado{" "}
                <span className="font-medium">{fmtMoneyResumo(infoEstouroOrcamento.orcadoDoMes)}</span>, utilizado{" "}
                <span className="font-medium">{fmtMoneyResumo(infoEstouroOrcamento.utilizadoAcumulado)}</span>
                {infoEstouroOrcamento.percentual != null && <> ({infoEstouroOrcamento.percentual.toFixed(2)}%)</>} — por isso escala pro próximo
                nível de aprovação.
              </p>
            </div>
          )}
          {/* SIS-2026-0250 (regra 2.2): aviso informativo só — não bloqueia
              a aprovação, só avisa o aprovador do prazo do dia. */}
          {excecao && despesa.status === "pendente_aprovacao" && dataPagamento === new Date().toLocaleDateString("sv-SE") && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-amber-800/80 dark:text-amber-300/80">
                Exceção com pagamento hoje — precisa ser aprovada até{" "}
                <span className="font-medium">{maloteConfig?.excecao_limite_aprovacao_horario}</span> (regra 2.2) pra
                garantir o pagamento no mesmo dia.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bloco 4: Rateio da Despesa */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold">Rateio da Despesa{despesa.parcelado ? " (Parcelado)" : ""}</p>
            {despesa.parcelado && rateioEditavel && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Valor e % abaixo são da despesa <span className="font-medium text-foreground">inteira</span> (todas as {despesa.numero_parcelas}{" "}
                parcelas somadas) — já o Orçado/Utilizado reflete só a parcela pré-visualizada no seletor acima da tabela (use as setas pra conferir o
                impacto de cada uma). Editável só nesta fase de lançamento — depois de aprovada, o rateio trava e passa a mostrar o impacto de cada
                parcela separadamente.
              </p>
            )}
          </div>
          {rateioEditavel ? (
            <RateioGrid
              linhas={linhasRateio}
              onChange={setLinhasRateio}
              dimensoes={dimensoes}
              onDimensoesChange={setDimensoes}
              ratearPor={ratearPor}
              onRatearPorChange={setRatearPor}
              valorTotal={Number(valorAprovado) || despesa.valor_total}
              disabled={bloqueado}
              despesaId={despesa.id}
              // SIS-2026-0292: se o solicitante corrigiu a Classificação
              // nesta mesma tela, o Rateio (Orçado/limite de justificativa)
              // já reflete a NOVA, não a antiga.
              classificacaoId={classificacaoIdEditado || despesa.classificacao_id}
              limiteJustificativaPct={classificacaoEditadaCatalogo?.limite_justificativa_pct ?? despesa.classificacao?.limite_justificativa_pct ?? null}
              resolverOrcado={resolverOrcadoMultiMes}
              anoMesDespesa={anoMesDespesa}
              fatorParcela1={fatorParcela1}
              parcelas={despesa.parcelado ? data?.parcelas : undefined}
              mostrarValorParcela1={despesa.parcelado}
              podeJustificarComoAprovador={configurado}
              souSolicitante={souSolicitante}
            />
          ) : despesa.parcelado ? (
            <RateioParceladoTable
              despesaId={despesa.id}
              empresaId={despesa.empresa_id}
              classificacaoId={despesa.classificacao_id}
              valorTotalDespesa={despesa.valor_total}
              parcelas={data!.parcelas}
              linhas={linhasRateio}
              dimensoes={dimensoes}
              limiteJustificativaPct={despesa.classificacao?.limite_justificativa_pct ?? null}
              podeJustificarComoAprovador={configurado}
              souSolicitante={souSolicitante}
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
              fatorParcela1={fatorParcela1}
              podeJustificarComoAprovador={configurado}
              souSolicitante={souSolicitante}
            />
          )}
        </CardContent>
      </Card>

      {(souAprovadorNivelAtual || podeReprovarComoAprovadorPassado || mostrarAcoesPagamento) && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <Label>Comentário</Label>
            {despesa.excecao && souAprovadorNivelAtual && (
              <p className="text-xs text-muted-foreground">
                Exceção: além de aprovar ou reprovar, dá pra usar "Solicitar ajuste" pra sugerir ao solicitante
                reagendar pra uma data que não seja exceção.
              </p>
            )}
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
          <Button className="gap-1.5" onClick={onClickAprovar} disabled={acaoEmAndamento !== null || orcadoCarregando || orcadoMultiMesCarregando}>
            <Check className="h-4 w-4" />{" "}
            {acaoEmAndamento === "aprovar"
              ? "Aprovando..."
              : orcadoCarregando || orcadoMultiMesCarregando
                ? "Calculando orçamento..."
                : "Aprovar despesa"}
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
          {!despesa.parcelado && (
            <Button className="gap-1.5" onClick={abrirPagar} disabled={acaoPagamentoEmAndamento !== null}>
              <Banknote className="h-4 w-4" /> Pagar despesa
            </Button>
          )}
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
          {!despesa.parcelado && (
            <Button className="gap-1.5" onClick={abrirPagar} disabled={acaoPagamentoEmAndamento !== null}>
              <Banknote className="h-4 w-4" /> Pagar despesa
            </Button>
          )}
        </div>
      )}

      <Dialog open={pagarAberto} onOpenChange={setPagarAberto}>
        <DialogContent className="sm:max-w-sm p-5">
          <DialogHeader>
            <DialogTitle className="text-base">
              {parcelaEmPagamento
                ? `Comprovante — parcela ${parcelaEmPagamento.numero_parcela}/${despesa.numero_parcelas}`
                : "Comprovante de pagamento"}
            </DialogTitle>
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
            {/* SIS-2026-0307 (Iury): forma de pagamento pré-selecionada
                (vem da despesa) mas editável — "deixar possível alterar a
                forma para ir para o fluxo correto" — e Banco novo, do
                catálogo do Cartão de Crédito. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Forma de pagamento</Label>
                <Select value={formaPagamentoConfirmada} onValueChange={setFormaPagamentoConfirmada}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {opcoesFormaPagamentoConfirmada.map((t) => (
                      <SelectItem key={t.nome} value={t.nome}>
                        {t.nome}
                        {!t.ativo && " (inativo)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Banco</Label>
                <Select value={bancoIdConfirmado} onValueChange={setBancoIdConfirmado}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {opcoesBanco.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.nome}
                        {!b.ativo && " (inativo)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {/* Preview com o logo real (ou iniciais coloridas, sem
                    logo cadastrado) — mesmo padrão já usado no Cartão de
                    Crédito pro Select de Banco. */}
                {bancoIdConfirmado && bancos.find((b) => b.id === bancoIdConfirmado) && (
                  <div className="mt-1.5">
                    <BancoBadge
                      nome={bancos.find((b) => b.id === bancoIdConfirmado)!.nome}
                      logoUrl={urlLogoCartao(bancos.find((b) => b.id === bancoIdConfirmado)!.logo_path)}
                    />
                  </div>
                )}
              </div>
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

      <AlertDialog open={confirmarAprovarParceladoAberto} onOpenChange={setConfirmarAprovarParceladoAberto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Aprovar despesa parcelada?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta despesa está dividida em {despesa.numero_parcelas} parcelas. Ao confirmar, você aprova todas as{" "}
              {despesa.numero_parcelas} parcelas de uma vez — elas ficarão aguardando pagamento, cada uma na sua data
              de vencimento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acaoEmAndamento !== null}>Cancelar</AlertDialogCancel>
            <Button
              className="gap-1.5"
              disabled={acaoEmAndamento !== null}
              onClick={() => {
                setConfirmarAprovarParceladoAberto(false);
                handleAprovar();
              }}
            >
              <Check className="h-4 w-4" /> Aprovar {despesa.numero_parcelas} parcelas
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
