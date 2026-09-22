import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  History,
  Info,
  PenLine,
  Send,
  Trash2,
  UserX,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import {
  FORM_ID_PAINEL_DESPESA_DIARIA,
  PainelDespesaMalote,
} from "@/pages/malote/PainelDespesaMalote";
import { useContratosDiaria, useEmpresaContratoDiaria } from "@/hooks/useDiarias";
import {
  DespesaMaloteUfrgs,
  EventoDiariaUfrgs,
  MIN_BUSCA_MOTORISTA,
  MotoristaUfrgs,
  NovaDiariaUfrgs,
  paraCentavosUfrgs,
  urlAnexoUfrgs,
  useBuscaMotoristasUfrgs,
  useLotacoesUfrgs,
  usePostosUfrgs,
  useTarifasUfrgs,
} from "@/hooks/useDiariasUfrgs";
import { StatusSolicitacao, VisualizacaoDiaria } from "./diarias";
import { AnexoLinha, Campo, Dropzone, Leitura, Secao, VisualizacoesDiaria } from "./diariaUi";
import {
  DiariaUfrgs,
  MAX_BYTES_ANEXO_UFRGS,
  MAX_KB_ANEXO_UFRGS,
  SINDICATOS_UFRGS,
  brlDeCentavos,
  calcularValoresUfrgs,
  fmtData,
  sobreposicaoUfrgs,
  tarifaVigente,
  tituloColuna,
} from "./diariasUfrgs";

/**
 * Modal da Diária UFRGS — os três modos.
 *
 *   "nova"       → formulário em branco
 *   "editar"     → o MESMO formulário, preenchido. Serve para as duas coisas
 *                  que o pedido junta num flag só ("incluir/editar"):
 *                  corrigir uma diária ainda não decidida e reenviar a que
 *                  foi devolvida para ajuste.
 *   "visualizar" → somente leitura, com as ações no rodapé (excluir,
 *                  solicitar ajuste, editar, aprovar, aprovar e enviar para
 *                  malote) — cada uma só aparece para quem tem o flag.
 *
 * OS CAMPOS SÃO OS DA PLANILHA, com os mesmos títulos (a lista canônica é
 * COLUNAS_UFRGS em ./diariasUfrgs, usada aqui, na tabela da tela e na
 * exportação). O que NÃO se digita:
 *
 *   Item              é a posição da linha no relatório exportado
 *   Matr.             vem de EMPREGADOS junto com o motorista escolhido
 *   Fiscal            vem da lotação
 *   Data de Depósito  vem do dia em que o Malote pagou a despesa
 *   Valor Total, Valor VA, Valor Líquido, Tributos, Valor à Faturar
 *                     são as fórmulas da planilha (calcularValoresUfrgs)
 */
export type ModoModalUfrgs = "nova" | "editar" | "visualizar";

/** Os flags de acesso da tela, já resolvidos pela rota que abriu o modal. */
export interface PermissoesDiaria {
  /** 'incluir' — o flag "incluir/editar" do Gerenciamento de Acesso. */
  incluir: boolean;
  excluir: boolean;
  aprovar: boolean;
  enviarMalote: boolean;
  /**
   * Editar a TABELA DE VALORES dos sindicatos (22/09/2026).
   *
   * Chave própria — 'alterar' no menu fantasma 'financeiro_diarias_tarifas'
   * (20260930000212) —, e não um dos flags acima, por duas razões. A de
   * permissão: 'alterar' vem de brinde com o switch da tela, e quem recebe
   * Diárias para CONFERIR não pode ganhar junto o poder de mudar o valor de
   * todas as diárias futuras daquele sindicato. A de rota: o pedido é
   * explícito em "somente na rota /app/financeiro/diarias", então quem
   * resolve este flag (ControleDiarias) também exige a porta do Financeiro.
   */
  editarTarifas: boolean;
}

type DecisaoNegativa = "reprovar" | "ajuste" | "excluir";

interface Props {
  aberto: boolean;
  modo: ModoModalUfrgs;
  diaria?: DiariaUfrgs | null;
  /** Base para o aviso de sobreposição do mesmo motorista. */
  existentes: DiariaUfrgs[];
  salvando?: boolean;
  visualizacoes?: VisualizacaoDiaria[];
  eventos?: EventoDiariaUfrgs[];
  permissoes: PermissoesDiaria;
  /** true quando quem abriu foi quem lançou — ninguém decide a própria. */
  souOSolicitante?: boolean;
  onFechar: () => void;
  onSalvar: (d: NovaDiariaUfrgs) => void;
  onEditar: (d: NovaDiariaUfrgs & { anexosRemovidos: string[] }) => void;
  onDecidir: (uuid: string, status: Extract<StatusSolicitacao, "aprovada" | "reprovada">) => void;
  onEnviarMalote: (uuid: string, despesa: DespesaMaloteUfrgs) => Promise<void> | void;
  onSolicitarAjuste: (uuid: string, motivo: string) => void;
  onExcluir: (uuid: string, motivo: string) => void;
  /** Pedido de "quero editar esta" — a tela reabre o modal em modo "editar". */
  onPedirEdicao: (d: DiariaUfrgs) => void;
  /**
   * Abrir a tabela de tarifas dos sindicatos. Quem RENDERIZA aquele modal é o
   * painel, não este componente: dois Dialog aninhados brigam por foco, e o
   * painel é quem já tem as mutações e a lista de diárias que o aviso de
   * impacto consulta.
   */
  onEditarTarifas?: () => void;
}

/** Situações do cadastro que significam que a pessoa não está mais na empresa. */
const SITUACOES_DESLIGADO = ["DEMITIDO", "DEMITIDA", "RESCISÃO", "DESLIGADO", "DESLIGADA"];
const estaDesligado = (situacao: string | null) =>
  SITUACOES_DESLIGADO.includes((situacao ?? "").trim().toUpperCase());

/**
 * Campo de nome que busca motoristas em EMPREGADOS e devolve a pessoa
 * inteira — é o que preenche a matrícula ao lado.
 *
 * O texto continua livre depois de escolher: na planilha entregue, sete das
 * 128 linhas mostram " FALSO" na coluna Matr. porque o nome digitado não
 * batia com a tabela de apoio. Escolher no cadastro resolve o caso normal;
 * digitar à mão continua possível para quem não está lá, e aí a matrícula é
 * informada junto.
 *
 * A busca só sai daqui a partir de MIN_BUSCA_MOTORISTA caracteres:
 * EMPREGADOS passa de 10 mil linhas e uma consulta por tecla não se paga.
 */
function BuscaMotorista({
  valor,
  onEscolher,
  onDigitar,
}: {
  valor: string;
  onEscolher: (m: MotoristaUfrgs) => void;
  onDigitar: (nome: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const { data: achados = [], isFetching } = useBuscaMotoristasUfrgs(valor);
  const curto = valor.trim().length > 0 && valor.trim().length < MIN_BUSCA_MOTORISTA;

  return (
    <div className="relative">
      <Input
        value={valor}
        onChange={(e) => {
          onDigitar(e.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => window.setTimeout(() => setAberto(false), 150)}
        placeholder="Digite o nome ou a matrícula do motorista"
      />
      {aberto && (curto || isFetching || achados.length > 0) && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {curto && (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">
              Digite ao menos {MIN_BUSCA_MOTORISTA} caracteres.
            </p>
          )}
          {!curto && isFetching && achados.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-muted-foreground">Buscando...</p>
          )}
          {achados.map((m) => (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onEscolher(m);
                setAberto(false);
              }}
              className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate">
                {m.nome}
                {m.matricula && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    Matr. {m.matricula}
                  </span>
                )}
              </span>
              {estaDesligado(m.situacao) && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-destructive/40 bg-destructive/10 text-[9px] text-destructive"
                >
                  {m.situacao}
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Campo de quantidade.
 *
 * Fica no TOPO do módulo, não dentro do componente do modal: componente
 * declarado no corpo do pai é um tipo novo a cada render, o React desmonta e
 * remonta a árvore dele, e o input perdia o foco a cada tecla digitada.
 */
function CampoQt({
  chave,
  valor,
  set,
  travado,
}: {
  chave: string;
  valor: number;
  set: (n: number) => void;
  travado: boolean;
}) {
  return (
    <Campo label={tituloColuna(chave)}>
      {travado ? (
        <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
          {valor}
        </div>
      ) : (
        <Input
          type="number"
          min={0}
          value={valor}
          onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
          className="h-9"
        />
      )}
    </Campo>
  );
}

/** Valor derivado das fórmulas da planilha: nunca editável, em modo nenhum. */
function CampoValor({ chave, centavos }: { chave: string; centavos: number }) {
  return (
    <Campo label={`${tituloColuna(chave)} (R$)`}>
      <div
        className={cn(
          "flex h-9 items-center justify-end rounded-md border border-border bg-muted/40 px-3 text-sm font-medium tabular-nums",
          centavos < 0 && "text-destructive",
        )}
      >
        {brlDeCentavos(centavos)}
      </div>
    </Campo>
  );
}

const BADGE_STATUS: Record<
  StatusSolicitacao,
  { icone: typeof Clock; texto: string; cls: string }
> = {
  solicitada: { icone: Clock, texto: "Solicitada", cls: "border-warning/40 bg-warning/10 text-warning" },
  em_ajuste: { icone: PenLine, texto: "Em ajuste", cls: "border-info/40 bg-info/10 text-info" },
  aprovada: { icone: CheckCircle2, texto: "Aprovada", cls: "border-success/40 bg-success/10 text-success" },
  paga: { icone: CheckCircle2, texto: "Paga", cls: "border-primary/40 bg-primary/10 text-primary" },
  reprovada: { icone: XCircle, texto: "Reprovada", cls: "border-destructive/40 bg-destructive/10 text-destructive" },
  excluida: { icone: Trash2, texto: "Excluída", cls: "border-muted-foreground/40 bg-muted text-muted-foreground" },
};

export function DiariaUfrgsModal({
  aberto,
  modo,
  diaria,
  existentes,
  salvando,
  visualizacoes = [],
  eventos = [],
  permissoes,
  onEditarTarifas,
  souOSolicitante = false,
  onFechar,
  onSalvar,
  onEditar,
  onDecidir,
  onEnviarMalote,
  onSolicitarAjuste,
  onExcluir,
  onPedirEdicao,
}: Props) {
  const { toast } = useToast();
  const editavel = modo === "nova" || modo === "editar";
  const somenteLeitura = !editavel;

  const [contratoId, setContratoId] = useState("");
  const [codFornecedor, setCodFornecedor] = useState("");
  const [matricula, setMatricula] = useState("");
  const [motoristaNome, setMotoristaNome] = useState("");
  const [motoristaId, setMotoristaId] = useState<number | null>(null);
  const [sindicato, setSindicato] = useState("");
  const [lotacao, setLotacao] = useState("");
  const [numeroOficio, setNumeroOficio] = useState("");
  const [saida, setSaida] = useState("");
  const [retorno, setRetorno] = useState("");
  const [destino, setDestino] = useState("");
  const [posto, setPosto] = useState("");
  const [valorPostoVariavel, setValorPostoVariavel] = useState(0);
  const [qtHospedagem, setQtHospedagem] = useState(0);
  const [qtCafe, setQtCafe] = useState(0);
  const [qtAlmoco, setQtAlmoco] = useState(0);
  const [qtJanta, setQtJanta] = useState(0);
  const [qtVa, setQtVa] = useState(0);
  const [observacoes, setObservacoes] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [anexosRemovidos, setAnexosRemovidos] = useState<string[]>([]);
  const [tentouSalvar, setTentouSalvar] = useState(false);
  const [decisaoNegativa, setDecisaoNegativa] = useState<DecisaoNegativa | null>(null);
  const [motivoDecisao, setMotivoDecisao] = useState("");
  // O painel do Malote só aparece quando a pessoa pede para enviar: ele é um
  // formulário inteiro (rateio, parcelas, comprovante) e abri-lo sempre faria
  // quem só queria conferir a diária rolar por cima dele.
  const [enviandoMalote, setEnviandoMalote] = useState(false);

  const { data: contratos = [] } = useContratosDiaria();
  const { data: tarifas = [] } = useTarifasUfrgs();
  const { data: lotacoes = [] } = useLotacoesUfrgs();
  const { data: postos = [] } = usePostosUfrgs();

  // Reinicia tudo a cada abertura — o modal só existe enquanto `aberto`.
  // No modo "editar" o formulário nasce PREENCHIDO: a pessoa está corrigindo
  // um ponto específico, não redigitando a linha. Redigitar é onde nasce o
  // segundo erro.
  const chave = `${modo}-${diaria?.uuid ?? "nova"}-${aberto}`;
  const [chaveAtual, setChaveAtual] = useState(chave);
  if (chave !== chaveAtual) {
    const base = modo === "editar" ? diaria : null;
    setChaveAtual(chave);
    setContratoId(base?.contratoId ?? "");
    setCodFornecedor(base?.codFornecedor ?? "");
    setMatricula(base?.matricula ?? "");
    setMotoristaNome(base?.motoristaNome ?? "");
    setMotoristaId(base?.motoristaEmpregadoId ?? null);
    setSindicato(base?.sindicato ?? "");
    setLotacao(base?.lotacao ?? "");
    setNumeroOficio(base?.numeroOficio ?? "");
    setSaida(base?.saida ?? "");
    setRetorno(base?.retorno ?? "");
    setDestino(base?.destino ?? "");
    setPosto(base?.posto ?? "");
    setValorPostoVariavel((base?.valorPostoVariavelCentavos ?? 0) / 100);
    setQtHospedagem(base?.qtHospedagem ?? 0);
    setQtCafe(base?.qtCafe ?? 0);
    setQtAlmoco(base?.qtAlmoco ?? 0);
    setQtJanta(base?.qtJanta ?? 0);
    setQtVa(base?.qtVa ?? 0);
    setObservacoes(base?.observacoes ?? "");
    setArquivos([]);
    setAnexosRemovidos([]);
    setTentouSalvar(false);
    setDecisaoNegativa(null);
    setMotivoDecisao("");
    setEnviandoMalote(false);
  }

  const d = diaria;

  // Contexto do painel do Malote. O backend resolve tudo outra vez na RPC;
  // estes ids existem para alimentar o mesmo formulário/rateio da tela normal.
  const { data: empresaContratoId, isLoading: buscandoEmpresa } = useEmpresaContratoDiaria(
    d?.contratoId,
  );
  const { data: classificacoes = [], isLoading: buscandoClassificacoes } =
    useClassificacoesOrcamento();
  const classificacaoDiaria = useMemo(
    () =>
      classificacoes.find(
        (c) =>
          c.ativo &&
          c.nome
            .normalize("NFD")
            .replace(/[̀-ͯ]/g, "")
            .trim()
            .toLowerCase() === "diaria",
      ) ?? null,
    [classificacoes],
  );

  const fiscal = lotacoes.find((l) => l.lotacao === lotacao)?.fiscal ?? "";
  const postoEscolhido = postos.find((p) => p.codigo === posto) ?? null;

  // A tarifa é escolhida pela data de SAÍDA, nunca por hoje: lançamento
  // retroativo tem que usar a tabela que valia no dia da viagem.
  const tarifa = useMemo(() => tarifaVigente(tarifas, sindicato, saida), [tarifas, sindicato, saida]);

  const valores = useMemo(
    () =>
      tarifa
        ? calcularValoresUfrgs({ qtHospedagem, qtCafe, qtAlmoco, qtJanta, qtVa }, tarifa)
        : null,
    [tarifa, qtHospedagem, qtCafe, qtAlmoco, qtJanta, qtVa],
  );

  const anexosMantidos = (d?.anexos ?? []).filter((a) => !anexosRemovidos.includes(a.storagePath));

  const sobreposicao = useMemo(
    () =>
      editavel
        ? sobreposicaoUfrgs(
            { uuid: d?.uuid, motoristaEmpregadoId: motoristaId, motoristaNome, saida, retorno },
            existentes,
          )
        : null,
    [editavel, d?.uuid, motoristaId, motoristaNome, saida, retorno, existentes],
  );

  const temQuantidade = qtHospedagem + qtCafe + qtAlmoco + qtJanta > 0;
  const datasOk = !!saida && !!retorno && retorno >= saida;
  const camposOk =
    !!contratoId &&
    !!motoristaNome.trim() &&
    !!sindicato &&
    !!lotacao &&
    !!numeroOficio.trim() &&
    !!destino.trim() &&
    datasOk &&
    temQuantidade &&
    !!tarifa;

  const erro = (cond: boolean, msg: string) => (tentouSalvar && cond ? msg : undefined);

  /**
   * O arquivo é guardado como File e só sobe para o bucket no salvamento —
   * anexar e desistir do modal não deixa lixo no storage.
   *
   * O limite é o do bucket (10 MB por arquivo, ver MAX_KB_ANEXO_UFRGS):
   * recusar aqui é o que evita a pessoa esperar o upload inteiro para só
   * então tomar um erro do Storage.
   */
  const anexar = (files: FileList) => {
    const novos = Array.from(files);
    const grandes = novos.filter((f) => f.size > MAX_BYTES_ANEXO_UFRGS);
    if (grandes.length) {
      toast({
        title: `Arquivo acima de ${MAX_KB_ANEXO_UFRGS} KB`,
        description: grandes.map((f) => f.name).join(", "),
        variant: "destructive",
      });
    }
    const aceitos = novos.filter((f) => f.size <= MAX_BYTES_ANEXO_UFRGS);
    setArquivos((prev) => [...prev.filter((p) => !aceitos.some((n) => n.name === p.name)), ...aceitos]);
  };

  const salvar = () => {
    setTentouSalvar(true);
    if (!camposOk) {
      toast({
        title: "Não foi possível salvar",
        description: !tarifa
          ? "Não há tarifa cadastrada para este sindicato na data de saída."
          : !temQuantidade
            ? "Informe ao menos uma hospedagem, café, almoço ou janta."
            : "Preencha todos os campos obrigatórios.",
        variant: "destructive",
      });
      return;
    }
    const dados: NovaDiariaUfrgs = {
      contratoId,
      codFornecedor: codFornecedor.trim(),
      matricula: matricula.trim(),
      motoristaEmpregadoId: motoristaId,
      motoristaNome: motoristaNome.trim(),
      sindicato,
      lotacao,
      numeroOficio: numeroOficio.trim(),
      saida,
      retorno,
      destino: destino.trim(),
      posto,
      valorPostoVariavelCentavos: paraCentavosUfrgs(valorPostoVariavel),
      qtHospedagem,
      qtCafe,
      qtAlmoco,
      qtJanta,
      qtVa,
      observacoes: observacoes.trim(),
      anexos: arquivos,
    };
    if (modo === "editar") onEditar({ ...dados, anexosRemovidos });
    else onSalvar(dados);
  };

  const confirmarDecisao = () => {
    if (!d || !decisaoNegativa) return;
    if (decisaoNegativa === "reprovar") {
      onDecidir(d.uuid, "reprovada");
      return;
    }
    const motivo = motivoDecisao.trim();
    if (!motivo) {
      toast({
        title: "Escreva o motivo",
        description: "É o que fica no histórico da diária.",
        variant: "destructive",
      });
      return;
    }
    if (decisaoNegativa === "ajuste") onSolicitarAjuste(d.uuid, motivo);
    else onExcluir(d.uuid, motivo);
  };

  /**
   * Quais ações cabem NESTE estado e para ESTE usuário. Espelham exatamente o
   * que as RPCs aceitam — oferecer um botão que o banco vai recusar é pior do
   * que não ter botão.
   *
   *   editar   → 'solicitada'/'em_ajuste' (diaria_ufrgs_editar)
   *   aprovar  → 'solicitada', e nunca a própria (diaria_ufrgs_decidir)
   *   reprovar → idem
   *   ajuste   → 'solicitada'/'reprovada' (diaria_ufrgs_solicitar_ajuste)
   *   malote   → 'solicitada'/'aprovada' e sem despesa ainda
   *   excluir  → tudo menos 'excluida' e o que já virou despesa
   */
  const podeEditarAgora =
    permissoes.incluir && !!d && (d.status === "solicitada" || d.status === "em_ajuste");
  const podeDecidirAgora = permissoes.aprovar && d?.status === "solicitada" && !souOSolicitante;
  const podePedirAjusteAgora =
    permissoes.aprovar && !!d && (d.status === "solicitada" || d.status === "reprovada");
  const podeEnviarMaloteAgora =
    permissoes.enviarMalote &&
    !!d &&
    !d.maloteDespesaId &&
    (d.status === "aprovada" || (d.status === "solicitada" && permissoes.aprovar && !souOSolicitante));
  const podeExcluirAgora =
    permissoes.excluir && !!d && d.status !== "excluida" && !d.maloteDespesaId;

  const temAlgumaAcao =
    podeEditarAgora ||
    podeDecidirAgora ||
    podePedirAjusteAgora ||
    podeEnviarMaloteAgora ||
    podeExcluirAgora;

  const idExibido = modo === "nova" ? "—" : (d?.id ?? "");
  const legendaId = modo === "nova" ? "Gerado automaticamente ao salvar" : `Criado em ${d?.criadoEm ?? ""}`;

  const badgeStatus = (() => {
    if (modo === "nova" || !d) return null;
    const { icone: Icone, texto, cls } = BADGE_STATUS[d.status];
    return (
      <Badge variant="outline" className={cn("gap-1.5 px-2.5 py-1 text-xs font-semibold", cls)}>
        <Icone className="h-3.5 w-3.5" /> {texto}
      </Badge>
    );
  })();

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] w-[min(96vw,68rem)] max-w-none overflow-y-auto overflow-x-hidden p-0">
        <div className="sticky top-0 z-10 border-b border-border bg-background px-6 pb-4 pt-5">
          <DialogTitle className="font-display text-xl font-bold tracking-tight">
            Diária UFRGS
          </DialogTitle>
          <p className="mt-2 text-[11px] font-medium text-muted-foreground">Nº da diária</p>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-primary">{idExibido}</span>
            {badgeStatus}
          </div>
          <p className="text-[11px] text-muted-foreground">{legendaId}</p>
        </div>

        <div className="space-y-4 px-6 pb-6">
          {/* O que precisa mudar fica ANTES da seção 1: quem abre uma diária
              devolvida está procurando exatamente isto. */}
          {d?.status === "em_ajuste" && d.ajusteMotivo && (
            <div className="flex items-start gap-2.5 rounded-lg border border-info/40 bg-info/5 px-4 py-3">
              <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-info">
                  {modo === "editar"
                    ? "Esta diária voltou para ajuste"
                    : "Devolvida para ajuste do solicitante"}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{d.ajusteMotivo}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Pedido por {d.ajustePedidoPor ?? "—"}
                  {d.ajustePedidoEm ? ` em ${d.ajustePedidoEm}` : ""}
                </p>
              </div>
            </div>
          )}

          {d?.status === "excluida" && (
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted px-4 py-3">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Diária excluída</p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{d.exclusaoMotivo ?? "—"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Excluída por {d.excluidaPor ?? "—"}
                  {d.excluidaEm ? ` em ${d.excluidaEm}` : ""}
                </p>
              </div>
            </div>
          )}

          {/* 1. Identificação */}
          <Secao
            numero={1}
            titulo="Identificação"
            acao={
              // O botão fica AQUI, colado no campo Sindicato, porque é aqui
              // que a pessoa descobre que a tarifa está errada: ela escolhe o
              // sindicato, olha o bloco 4 e vê um valor que não é mais o do
              // contrato. Aparece nos três modos (inclusive em leitura) —
              // conferir uma diária aprovada é justamente quando se percebe
              // que a tabela mudou.
              permissoes.editarTarifas && onEditarTarifas ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={onEditarTarifas}
                >
                  <PenLine className="mr-1.5 h-3 w-3" /> Editar tarifas
                </Button>
              ) : undefined
            }
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {somenteLeitura ? (
                <Leitura label="Contrato" valor={d?.contratoNome} />
              ) : (
                <Campo label="Contrato" obrigatorio erro={erro(!contratoId, "Selecione o contrato.")}>
                  <Select value={contratoId} onValueChange={setContratoId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o contrato" />
                    </SelectTrigger>
                    <SelectContent>
                      {contratos.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nome}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}

              {somenteLeitura ? (
                <Leitura label={tituloColuna("codFornecedor")} valor={d?.codFornecedor} />
              ) : (
                <Campo label={tituloColuna("codFornecedor")}>
                  <Input
                    value={codFornecedor}
                    onChange={(e) => setCodFornecedor(e.target.value)}
                    placeholder="Opcional"
                  />
                </Campo>
              )}

              {somenteLeitura ? (
                <Leitura label={tituloColuna("numeroOficio")} valor={d?.numeroOficio} />
              ) : (
                <Campo
                  label={tituloColuna("numeroOficio")}
                  obrigatorio
                  erro={erro(!numeroOficio.trim(), "Informe o número do ofício.")}
                >
                  <Input
                    value={numeroOficio}
                    onChange={(e) => setNumeroOficio(e.target.value)}
                    placeholder="Ex.: 001/2026"
                  />
                </Campo>
              )}

              {somenteLeitura ? (
                <Leitura label={tituloColuna("sindicato")} valor={d?.sindicato} />
              ) : (
                <Campo
                  label={tituloColuna("sindicato")}
                  obrigatorio
                  erro={erro(!sindicato, "Selecione o sindicato.")}
                  dica="Define a tarifa de hospedagem, café, almoço, janta e VA."
                >
                  <Select value={sindicato} onValueChange={setSindicato}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o sindicato" />
                    </SelectTrigger>
                    <SelectContent>
                      {SINDICATOS_UFRGS.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}

              {somenteLeitura ? (
                <Leitura label={tituloColuna("lotacao")} valor={d?.lotacao} />
              ) : (
                <Campo
                  label={tituloColuna("lotacao")}
                  obrigatorio
                  erro={erro(!lotacao, "Selecione a lotação.")}
                >
                  <Select value={lotacao} onValueChange={setLotacao}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a lotação" />
                    </SelectTrigger>
                    <SelectContent>
                      {lotacoes.map((l) => (
                        <SelectItem key={l.lotacao} value={l.lotacao}>
                          {l.lotacao}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}

              {/* Fiscal não se digita: acompanha a lotação (a VLOOKUP da
                  coluna W da planilha). */}
              <Leitura
                label={tituloColuna("fiscal")}
                valor={somenteLeitura ? d?.fiscal : fiscal}
                dica={somenteLeitura ? undefined : "Preenchido pela lotação escolhida."}
              />
            </div>
          </Secao>

          {/* 2. Motorista */}
          <Secao numero={2} titulo="Motorista">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {somenteLeitura ? (
                <Leitura label={tituloColuna("motoristaNome")} valor={d?.motoristaNome} />
              ) : (
                <Campo
                  label={tituloColuna("motoristaNome")}
                  obrigatorio
                  erro={erro(!motoristaNome.trim(), "Informe o motorista.")}
                  className="lg:col-span-2"
                >
                  <BuscaMotorista
                    valor={motoristaNome}
                    onDigitar={(nome) => {
                      setMotoristaNome(nome);
                      // Digitar de novo desfaz a escolha do cadastro: a
                      // matrícula volta a ser de quem digita, senão ficaria a
                      // matrícula de uma pessoa com o nome de outra.
                      setMotoristaId(null);
                    }}
                    onEscolher={(m) => {
                      setMotoristaNome(m.nome);
                      setMotoristaId(m.id);
                      setMatricula(m.matricula);
                    }}
                  />
                </Campo>
              )}

              {somenteLeitura || motoristaId !== null ? (
                <Leitura
                  label={tituloColuna("matricula")}
                  valor={somenteLeitura ? d?.matricula : matricula}
                  dica={somenteLeitura ? undefined : "Vem do cadastro do motorista."}
                />
              ) : (
                <Campo
                  label={tituloColuna("matricula")}
                  dica="Motorista fora do cadastro: informe a matrícula à mão."
                >
                  <Input value={matricula} onChange={(e) => setMatricula(e.target.value)} />
                </Campo>
              )}
            </div>

            {sobreposicao && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p className="text-[11px] text-warning">
                  {sobreposicao.motoristaNome} já tem a diária {sobreposicao.id} de{" "}
                  {fmtData(sobreposicao.saida)} a {fmtData(sobreposicao.retorno)} (ofício{" "}
                  {sobreposicao.numeroOficio}). Duas viagens no mesmo período são possíveis — só
                  confira se esta não é a mesma lançada duas vezes.
                </p>
              </div>
            )}
          </Secao>

          {/* 3. Viagem */}
          <Secao numero={3} titulo="Viagem">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {somenteLeitura ? (
                <Leitura label={tituloColuna("saida")} valor={fmtData(d?.saida ?? "")} />
              ) : (
                <Campo
                  label={tituloColuna("saida")}
                  obrigatorio
                  erro={erro(!saida, "Informe a data de saída.")}
                  dica="Define qual tabela de tarifa vale nesta diária."
                >
                  <Input type="date" value={saida} onChange={(e) => setSaida(e.target.value)} />
                </Campo>
              )}

              {somenteLeitura ? (
                <Leitura label={tituloColuna("retorno")} valor={fmtData(d?.retorno ?? "")} />
              ) : (
                <Campo
                  label={tituloColuna("retorno")}
                  obrigatorio
                  erro={erro(!datasOk, !retorno ? "Informe o retorno." : "O retorno não pode ser antes da saída.")}
                >
                  <Input type="date" value={retorno} onChange={(e) => setRetorno(e.target.value)} />
                </Campo>
              )}

              {somenteLeitura ? (
                <Leitura label={tituloColuna("destino")} valor={d?.destino} />
              ) : (
                <Campo
                  label={tituloColuna("destino")}
                  obrigatorio
                  erro={erro(!destino.trim(), "Informe o destino.")}
                >
                  <Input
                    value={destino}
                    onChange={(e) => setDestino(e.target.value)}
                    placeholder="Ex.: URUGUAIANA"
                  />
                </Campo>
              )}

              {somenteLeitura ? (
                <Leitura
                  label={tituloColuna("posto")}
                  valor={d?.posto}
                  dica={d?.postoDescricao || undefined}
                />
              ) : (
                <Campo label={tituloColuna("posto")} dica={postoEscolhido?.descricao}>
                  <Select value={posto} onValueChange={setPosto}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o posto" />
                    </SelectTrigger>
                    <SelectContent>
                      {postos.map((p) => (
                        <SelectItem key={p.codigo} value={p.codigo}>
                          {p.codigo} — {p.localidade}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}

              {somenteLeitura ? (
                <Leitura
                  label={`${tituloColuna("valorPostoVariavel")} (R$)`}
                  valor={brlDeCentavos(d?.valorPostoVariavelCentavos ?? 0)}
                />
              ) : (
                <Campo label={`${tituloColuna("valorPostoVariavel")} (R$)`}>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={valorPostoVariavel}
                    onChange={(e) => setValorPostoVariavel(Math.max(0, Number(e.target.value) || 0))}
                  />
                </Campo>
              )}

              {/* Data de Depósito não se digita nunca: é o dia em que o Malote
                  pagou a despesa desta diária. */}
              <Leitura
                label={tituloColuna("dataDeposito")}
                valor={d?.dataDeposito ? fmtData(d.dataDeposito) : ""}
                dica={
                  d?.dataDeposito
                    ? undefined
                    : "Preenchida sozinha no dia em que a diária for paga no malote."
                }
              />
            </div>
          </Secao>

          {/* 4. Quantidades e valores */}
          <Secao numero={4} titulo="Quantidades e valores">
            {tarifa ? (
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">
                  Tarifa {tarifa.sindicato} (desde {fmtData(tarifa.vigenciaInicio)})
                </span>
                <span>Hosp. R$ {brlDeCentavos(tarifa.hospedagemCentavos)}</span>
                <span>Café R$ {brlDeCentavos(tarifa.cafeCentavos)}</span>
                <span>Alm. R$ {brlDeCentavos(tarifa.almocoCentavos)}</span>
                <span>Janta R$ {brlDeCentavos(tarifa.jantaCentavos)}</span>
                <span>VA R$ {brlDeCentavos(tarifa.vaCentavos)}</span>
                <span>
                  Tributos {((tarifa.aliquotaPis + tarifa.aliquotaCofins + tarifa.aliquotaIss) * 100).toFixed(2)}%
                </span>
              </div>
            ) : (
              editavel && (
                <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <p className="text-[11px] text-muted-foreground">
                    Escolha o sindicato e a data de saída para o sistema calcular os valores.
                  </p>
                </div>
              )
            )}

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <CampoQt chave="qtHospedagem" valor={qtHospedagem} set={setQtHospedagem} travado={somenteLeitura} />
              <CampoQt chave="qtCafe" valor={qtCafe} set={setQtCafe} travado={somenteLeitura} />
              <CampoQt chave="qtAlmoco" valor={qtAlmoco} set={setQtAlmoco} travado={somenteLeitura} />
              <CampoQt chave="qtJanta" valor={qtJanta} set={setQtJanta} travado={somenteLeitura} />
              {/* Dias de VA: na planilha este número nunca existia como campo
                  — a coluna "Valor VA" trazia "=31.69*2" digitado à mão e a
                  coluna Y recuperava o 2 dividindo de volta. */}
              <CampoQt chave="qtVa" valor={qtVa} set={setQtVa} travado={somenteLeitura} />
            </div>
            {tentouSalvar && !temQuantidade && (
              <p className="mt-2 text-[11px] font-medium text-destructive">
                Informe ao menos uma hospedagem, café, almoço ou janta.
              </p>
            )}

            <div className="mt-4 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
              <CampoValor
                chave="valorTotal"
                centavos={somenteLeitura ? (d?.valorTotalCentavos ?? 0) : (valores?.valorTotalCentavos ?? 0)}
              />
              <CampoValor
                chave="valorVa"
                centavos={somenteLeitura ? (d?.valorVaCentavos ?? 0) : (valores?.valorVaCentavos ?? 0)}
              />
              <CampoValor
                chave="valorLiquido"
                centavos={
                  somenteLeitura ? (d?.valorLiquidoCentavos ?? 0) : (valores?.valorLiquidoCentavos ?? 0)
                }
              />
              <CampoValor
                chave="tributos"
                centavos={somenteLeitura ? (d?.tributosCentavos ?? 0) : (valores?.tributosCentavos ?? 0)}
              />
              <CampoValor
                chave="valorFaturar"
                centavos={
                  somenteLeitura ? (d?.valorFaturarCentavos ?? 0) : (valores?.valorFaturarCentavos ?? 0)
                }
              />
            </div>
            {/* Líquido negativo existe na planilha (o VA descontado passou do
                que a viagem gerou) e não é erro — mas não vira despesa, então
                a tela avisa antes de a pessoa tentar enviar para o malote. */}
            {(somenteLeitura ? (d?.valorLiquidoCentavos ?? 0) : (valores?.valorLiquidoCentavos ?? 0)) < 0 && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warning">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                O VA descontado é maior que o valor da viagem, então o líquido ficou negativo. A
                diária pode ser registrada assim, mas não pode ser enviada ao malote.
              </p>
            )}
          </Secao>

          {/* 5. Anexos */}
          <Secao numero={5} titulo="Anexos">
            <div className="space-y-3">
              {anexosMantidos.length > 0 && (
                <div className="space-y-2">
                  {anexosMantidos.map((a) => (
                    <AnexoLinha
                      key={a.storagePath}
                      nome={a.nome}
                      tipo={a.tipo}
                      tamanho={a.tamanho}
                      enviadoEm={a.enviadoEm}
                      storagePath={a.storagePath}
                      urlDe={urlAnexoUfrgs}
                      aoRemover={
                        modo === "editar"
                          ? () => setAnexosRemovidos((p) => [...p, a.storagePath])
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
              {modo === "editar" && anexosRemovidos.length > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <p className="text-[11px] text-destructive">
                    {anexosRemovidos.length}{" "}
                    {anexosRemovidos.length === 1 ? "anexo será removido" : "anexos serão removidos"}{" "}
                    ao salvar.
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => setAnexosRemovidos([])}
                  >
                    Desfazer
                  </Button>
                </div>
              )}
              {editavel && (
                <Dropzone
                  label={modo === "editar" ? "Novos anexos" : "Ofício, comprovantes e notas"}
                  arquivos={arquivos}
                  onAdicionar={anexar}
                  onRemover={(n) => setArquivos((p) => p.filter((a) => a.name !== n))}
                  obrigatorio={false}
                  maxKb={MAX_KB_ANEXO_UFRGS}
                />
              )}
              {somenteLeitura && anexosMantidos.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum anexo nesta diária.</p>
              )}
            </div>
          </Secao>

          {/* 6. Observações */}
          <Secao numero={6} titulo="Observações">
            {somenteLeitura ? (
              <p className="whitespace-pre-line text-sm">{d?.observacoes || "—"}</p>
            ) : (
              <Textarea
                value={observacoes}
                maxLength={1000}
                rows={3}
                onChange={(e) => setObservacoes(e.target.value)}
                placeholder="Qualquer detalhe da viagem que o relatório não mostra."
              />
            )}
          </Secao>

          {/* 7. Despesa do Malote — o MESMO painel da criação normal, como na
              aprovação da diária de diarista (SIS-2026-0287). */}
          {enviandoMalote && d && (
            <Secao numero={7} titulo="Despesa do Malote">
              <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Leitura label="Tipo" valor="Despesa" />
                <Leitura label="Nº" valor="Gerado automaticamente no Malote" />
                <Leitura label="Classificação" valor="Diária" />
                <Leitura label="Empresa" valor={d.contratoEmpresa} />
                <Leitura label="Contrato" valor={d.contratoNome} />
                <Leitura label="Solicitante" valor={d.solicitante} />
              </div>
              <PainelDespesaMalote
                key={chave}
                classificacaoId={classificacaoDiaria?.id ?? ""}
                classificacaoTipo={classificacaoDiaria?.tipo ?? "contrato"}
                empresaId={empresaContratoId ?? null}
                ativo={!!empresaContratoId && !!classificacaoDiaria}
                nomeInicial={d.maloteMotivo ?? `Pagamento de diária UFRGS ${d.id}`}
                // O que sai de caixa é o Valor à Faturar (líquido + tributos)
                // — é ele que a planilha soma em "Valor da Fatura", e a RPC
                // recusa despesa com outro valor.
                valorInicial={d.valorFaturarCentavos / 100}
                inicial={{
                  dataPagamento: d.maloteDataPagamento ?? "",
                  competencia: d.competencia?.slice(0, 7) ?? "",
                  informacoesPagamento: `Diária UFRGS ${d.id} — ofício ${d.numeroOficio}, ${d.motoristaNome}`,
                }}
                aoSalvar={async (payload) => onEnviarMalote(d.uuid, payload)}
                rotuloEnviar={
                  d.status === "solicitada" ? "Aprovar e enviar para malote" : "Enviar para malote"
                }
              />
              {!buscandoEmpresa && !buscandoClassificacoes && (!empresaContratoId || !classificacaoDiaria) && (
                <p className="mt-2 text-xs font-medium text-destructive">
                  Não foi possível resolver a empresa do contrato ou a classificação ativa “Diária”.
                </p>
              )}
            </Secao>
          )}

          {/* A trilha. É o "controle, histórico e rastreabilidade" que motivou
              tirar esta planilha do Excel. */}
          {somenteLeitura && eventos.length > 0 && (
            <Secao numero={enviandoMalote ? 8 : 7} titulo="Histórico">
              <div className="space-y-2">
                {eventos.map((e) => (
                  <div key={e.id} className="flex items-start gap-2.5 text-xs">
                    <History className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="font-medium">
                        {e.descricao || e.tipo}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {e.autor} • {e.quando}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Secao>
          )}

          <VisualizacoesDiaria lista={visualizacoes} />
        </div>

        {/* Rodapé */}
        {editavel && (
          <div className="sticky bottom-0 border-t border-border bg-background px-6 py-4">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={salvando}>
                {modo === "editar" ? (
                  <Send className="mr-2 h-4 w-4" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                {salvando
                  ? "Enviando anexos e salvando..."
                  : modo === "editar"
                    ? "Salvar alterações"
                    : "Salvar diária UFRGS"}
              </Button>
            </div>
            {modo === "editar" && d?.status === "em_ajuste" && (
              <p className="mt-2 text-right text-[11px] text-muted-foreground">
                Ao salvar, a diária volta para “Solicitada” e quem aprova decide de novo.
              </p>
            )}
          </div>
        )}

        {somenteLeitura && d && (
          <div className="sticky bottom-0 border-t border-border bg-background px-6 py-4">
            {decisaoNegativa ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold">
                  {decisaoNegativa === "reprovar"
                    ? "Reprovar esta diária?"
                    : decisaoNegativa === "ajuste"
                      ? "O que precisa ser ajustado?"
                      : "Por que esta diária está sendo excluída?"}
                </p>
                {decisaoNegativa === "reprovar" ? (
                  <p className="text-xs text-muted-foreground">
                    Ela fica registrada como reprovada. Se a ideia é que o solicitante corrija e
                    reenvie, use “Solicitar ajuste” — ele recebe uma notificação com o que mudar.
                  </p>
                ) : (
                  <>
                    <Textarea
                      value={motivoDecisao}
                      maxLength={500}
                      rows={3}
                      autoFocus
                      onChange={(e) => setMotivoDecisao(e.target.value)}
                      placeholder={
                        decisaoNegativa === "ajuste"
                          ? "Ex.: o ofício 12/2026 é de outra viagem; corrija e reenvie."
                          : "Ex.: lançamento duplicado do mesmo ofício."
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {decisaoNegativa === "ajuste"
                        ? `${d.solicitante} recebe este texto como notificação e corrige a diária.`
                        : "A diária sai da lista, mas continua no histórico com este motivo."}
                    </p>
                  </>
                )}
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <Button
                    variant="outline"
                    disabled={salvando}
                    onClick={() => {
                      setDecisaoNegativa(null);
                      setMotivoDecisao("");
                    }}
                  >
                    Voltar
                  </Button>
                  <Button
                    variant={decisaoNegativa === "ajuste" ? "default" : "destructive"}
                    disabled={salvando}
                    onClick={confirmarDecisao}
                  >
                    {decisaoNegativa === "reprovar"
                      ? "Confirmar reprovação"
                      : decisaoNegativa === "ajuste"
                        ? "Devolver para ajuste"
                        : "Excluir diária"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <UserX className="h-3.5 w-3.5" />
                  {d.status === "paga"
                    ? "Diária paga no malote — somente visualização."
                    : d.status === "excluida"
                      ? "Diária excluída — somente visualização."
                      : !temAlgumaAcao
                        ? "Você não tem permissão para agir nesta diária."
                        : souOSolicitante && d.status === "solicitada"
                          ? "Quem lança não aprova a própria diária."
                          : "Escolha uma ação para esta diária."}
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {(podeEditarAgora || podePedirAjusteAgora || podeExcluirAgora || podeDecidirAgora) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" disabled={salvando}>
                          Ações <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-72">
                        {podeEditarAgora && (
                          <DropdownMenuItem onClick={() => onPedirEdicao(d)}>
                            <PenLine className="mr-2 h-4 w-4 text-primary" />
                            <div>
                              <p className="text-sm">Editar diária</p>
                              <p className="text-[11px] text-muted-foreground">
                                Corrigir os dados antes da decisão.
                              </p>
                            </div>
                          </DropdownMenuItem>
                        )}
                        {podePedirAjusteAgora && (
                          <DropdownMenuItem onClick={() => setDecisaoNegativa("ajuste")}>
                            <PenLine className="mr-2 h-4 w-4 text-info" />
                            <div>
                              <p className="text-sm">Solicitar ajuste</p>
                              <p className="text-[11px] text-muted-foreground">
                                Devolve a quem lançou, com o que precisa mudar.
                              </p>
                            </div>
                          </DropdownMenuItem>
                        )}
                        {podeDecidirAgora && (
                          <DropdownMenuItem onClick={() => setDecisaoNegativa("reprovar")}>
                            <XCircle className="mr-2 h-4 w-4 text-destructive" />
                            <div>
                              <p className="text-sm">Reprovar diária</p>
                              <p className="text-[11px] text-muted-foreground">
                                Encerra o pedido como reprovado.
                              </p>
                            </div>
                          </DropdownMenuItem>
                        )}
                        {podeExcluirAgora && (
                          <DropdownMenuItem onClick={() => setDecisaoNegativa("excluir")}>
                            <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                            <div>
                              <p className="text-sm">Excluir diária</p>
                              <p className="text-[11px] text-muted-foreground">
                                Tira da lista; o histórico continua registrado.
                              </p>
                            </div>
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {podeDecidirAgora && (
                    <Button
                      variant="outline"
                      className="border-success/50 text-success hover:bg-success/10 hover:text-success"
                      disabled={salvando}
                      onClick={() => onDecidir(d.uuid, "aprovada")}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" /> Aprovar
                    </Button>
                  )}

                  {podeEnviarMaloteAgora &&
                    (enviandoMalote ? (
                      <>
                        <Button
                          variant="outline"
                          disabled={salvando}
                          onClick={() => setEnviandoMalote(false)}
                        >
                          <X className="mr-2 h-4 w-4" /> Cancelar envio
                        </Button>
                        <Button
                          type="submit"
                          form={FORM_ID_PAINEL_DESPESA_DIARIA}
                          disabled={salvando || !empresaContratoId || !classificacaoDiaria}
                        >
                          <Send className="mr-2 h-4 w-4" />
                          {d.status === "solicitada" ? "Aprovar e enviar" : "Enviar para malote"}
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={salvando || d.valorFaturarCentavos <= 0}
                        onClick={() => setEnviandoMalote(true)}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {d.status === "solicitada"
                          ? "Aprovar e enviar para malote"
                          : "Enviar para malote"}
                      </Button>
                    ))}

                  <Button variant="outline" onClick={onFechar}>
                    Fechar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
