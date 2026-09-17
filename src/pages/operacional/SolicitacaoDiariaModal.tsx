import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  FileImage,
  FileText,
  Info,
  PenLine,
  Plus,
  Send,
  Trash2,
  Upload,
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
import { Label } from "@/components/ui/label";
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
import {
  EmpregadoDiaria,
  MIN_BUSCA_EMPREGADO_DIARIA,
  NovaSolicitacaoDiaria,
  DespesaAprovacaoDiaria,
  mensagemErroDiaria,
  urlAnexoDiaria,
  useBuscaEmpregadosDiaria,
  useContratosDiaria,
  useEmpresaContratoDiaria,
  usePostosDiaria,
} from "@/hooks/useDiarias";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import {
  FORM_ID_PAINEL_DESPESA_DIARIA,
  PainelDespesaMalote,
} from "@/pages/malote/PainelDespesaMalote";
import {
  AnexoDiaria,
  LinhaDiaria,
  SolicitacaoDiaria,
  StatusSolicitacao,
  TIPOS_PIX,
  TURNOS,
  TipoPix,
  TurnoDiaria,
  VisualizacaoDiaria,
  avaliarConflitos,
  cpfValido,
  erroChavePix,
  fmtBRL,
  labelTipoPix,
  labelTurno,
  mascaraCpf,
  mascaraPix,
  placeholderPix,
  soDigitos,
  textoConflito,
  valorTotalLinha,
  valorTotalSolicitacao,
} from "./diarias";

/**
 * Um único modal para as quatro telas:
 *  - "nova"       → 1.2  formulário editável, com validação de CPF e duplicidade
 *  - "ajustar"    → o MESMO formulário, preenchido, para quem criou corrigir uma
 *                   solicitação devolvida pelo Operacional e reenviá-la
 *  - "visualizar" → 1.3  solicitação decidida, somente leitura, sem ações
 *  - "aprovar"    → 1.4  solicitação solicitada, somente leitura + pré-visualização
 *                        do Malote e as decisões (aprovar / reprovar / devolver
 *                        para ajuste / excluir)
 */
export type ModoModalDiaria = "nova" | "ajustar" | "visualizar" | "aprovar";

/** O que o Operacional pode fazer além de aprovar, quando clica em "Reprovar". */
export type DecisaoNegativaDiaria = "reprovar" | "ajuste" | "excluir";

interface Props {
  aberto: boolean;
  modo: ModoModalDiaria;
  solicitacao?: SolicitacaoDiaria | null;
  /** Base para checar duplicidade das linhas digitadas. */
  existentes: SolicitacaoDiaria[];
  salvando?: boolean;
  /** Quem já abriu esta solicitação — o rodapé "Visualizada por...". */
  visualizacoes?: VisualizacaoDiaria[];
  /** `operacional_diarias/aprovar`: decidir, devolver para ajuste. */
  podeDecidir?: boolean;
  /**
   * O usuário logado é quem criou esta solicitação. Chega separado de
   * `podeDecidir` porque o motivo de uma decisão sumir muda o que a tela tem
   * que dizer: "você não tem permissão" e "esta solicitação é sua" são
   * recados diferentes, e engolir os dois no mesmo booleano foi o que fez a
   * tela parecer quebrada (relato de 17/09/2026).
   */
  souOSolicitante?: boolean;
  /** `operacional_diarias/excluir`: sem ela, a opção de excluir nem aparece. */
  podeExcluir?: boolean;
  onFechar: () => void;
  onSalvar: (s: NovaSolicitacaoDiaria) => void;
  /** Reenvio depois do ajuste. Só existe no modo "ajustar". */
  onReenviar?: (s: NovaSolicitacaoDiaria & { anexosRemovidos: string[] }) => void;
  /** Recebem o uuid da solicitação (a chave no banco), não o número exibido. */
  onAprovar: (uuid: string, despesa: DespesaAprovacaoDiaria) => Promise<void> | void;
  onReprovar: (uuid: string) => void;
  onSolicitarAjuste?: (uuid: string, motivo: string) => void;
  onExcluir?: (uuid: string, motivo: string) => void;
}

// Zerada: os valores de diária e VT variam por contrato e por dissídio, então
// não há default honesto para chutar — quem lança digita.
const linhaVazia = (): LinhaDiaria => ({
  id: crypto.randomUUID(),
  data: "",
  turno: "manha",
  qtVt: 0,
  valorUnitVt: 0,
  valorDiaria: 0,
});

// ---------------------------------------------------------------------------

function Secao({
  numero,
  titulo,
  acao,
  children,
}: {
  numero: number;
  titulo: string;
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/70 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-primary">
          {numero}. {titulo}
        </h3>
        {acao}
      </div>
      {children}
    </section>
  );
}

function Campo({
  label,
  obrigatorio,
  erro,
  children,
  className,
}: {
  label: string;
  obrigatorio?: boolean;
  erro?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {obrigatorio && <span className="ml-0.5 text-destructive">*</span>}
      </Label>
      {children}
      {erro && <p className="text-[11px] font-medium text-destructive">{erro}</p>}
    </div>
  );
}

/** Campo de leitura — mesmo desenho das telas 1.3 e 1.4 (input travado). */
function Leitura({ label, valor }: { label: string; valor: React.ReactNode }) {
  return (
    <Campo label={label}>
      <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">
        <span className="truncate">{valor || "—"}</span>
      </div>
    </Campo>
  );
}

function AnexoLinha({ a }: { a: AnexoDiaria }) {
  const { toast } = useToast();
  const ehImagem = a.tipo !== "PDF";
  // O bucket é privado: o "olhinho" pede um link assinado de curta duração em
  // vez de montar uma URL pública, que não existiria.
  const abrir = async () => {
    try {
      window.open(await urlAnexoDiaria(a.storagePath), "_blank", "noopener");
    } catch (e: unknown) {
      toast({
        title: "Não foi possível abrir o anexo",
        description: mensagemErroDiaria(e, a.nome),
        variant: "destructive",
      });
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          ehImagem ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive",
        )}
      >
        {ehImagem ? <FileImage className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{a.nome}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {a.tipo} • {a.tamanho} • Enviado em {a.enviadoEm}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={abrir}
        aria-label={`Visualizar ${a.nome}`}
      >
        <Eye className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Dropzone({
  label,
  arquivos,
  onAdicionar,
  onRemover,
}: {
  label: string;
  /** Arquivos ainda em memória — só sobem para o bucket ao salvar. */
  arquivos: File[];
  onAdicionar: (files: FileList) => void;
  onRemover: (nome: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        <span className="ml-0.5 text-destructive">*</span>
      </Label>
      <div
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSobre(false);
          if (e.dataTransfer.files?.length) onAdicionar(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-md border border-dashed px-4 py-3 transition-colors",
          sobre ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/40",
        )}
      >
        <Upload className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-primary">
            Arraste arquivos aqui ou clique para adicionar documentos
          </p>
          <p className="text-[11px] text-muted-foreground">
            Formatos aceitos: PDF, JPG, PNG (máx. 10 MB por arquivo)
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          Obrigatório
        </Badge>
        <input
          ref={ref}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onAdicionar(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {arquivos.length > 0 && (
        <div className="space-y-1.5">
          {arquivos.map((a) => (
            <div
              key={a.name}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-xs"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{a.name}</span>
              <span className="shrink-0 text-muted-foreground">
                {(a.size / 1024).toFixed(0)} KB
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-destructive"
                onClick={() => onRemover(a.name)}
                aria-label={`Remover ${a.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * "Visualizada por Fulano em dd/mm/aaaa - hh:mm", no pé da solicitação.
 *
 * Uma linha por pessoa, com a PRIMEIRA vez que ela abriu — quem leu, e desde
 * quando. Da mais recente para a mais antiga, porque a pergunta de quem olha
 * é "isso já chegou em alguém?", não "quem foi o primeiro".
 *
 * Mostra cinco e esconde o resto atrás de um "+N": em solicitação que circulou
 * pelo Operacional inteiro, a lista completa empurraria o rodapé de ações para
 * fora da tela — e ela é rodapé, não conteúdo.
 */
function VisualizacoesDiaria({ lista }: { lista: VisualizacaoDiaria[] }) {
  const [tudo, setTudo] = useState(false);
  if (lista.length === 0) return null;
  const visiveis = tudo ? lista : lista.slice(0, 5);
  const ocultas = lista.length - visiveis.length;
  return (
    <div className="pt-1">
      {visiveis.map((v) => (
        <p key={v.userId} className="text-[10px] leading-relaxed text-muted-foreground">
          Visualizada por {v.nome} em {v.quando}
        </p>
      ))}
      {ocultas > 0 && (
        <button
          type="button"
          onClick={() => setTudo(true)}
          className="text-[10px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          +{ocultas} {ocultas === 1 ? "visualização" : "visualizações"}
        </button>
      )}
    </div>
  );
}

/** Situações do cadastro que significam que a pessoa não está mais na empresa. */
const SITUACOES_DESLIGADO = ["DEMITIDO", "DEMITIDA", "RESCISÃO", "DESLIGADO", "DESLIGADA"];

function estaDesligado(situacao: string | null) {
  return SITUACOES_DESLIGADO.includes((situacao ?? "").trim().toUpperCase());
}

/**
 * Campo de nome que busca no cadastro de EMPREGADOS e devolve a pessoa
 * inteira — é o que preenche o CPF ao lado.
 *
 * O texto continua livre depois de escolher: diarista nem sempre é empregado
 * da casa, e travar o campo no cadastro impediria justamente o caso mais comum
 * de diária. Quando é gente de fora, o CPF é digitado à mão e validado pelo
 * dígito verificador; quando é do cadastro, o CPF vem de lá e não se digita.
 *
 * A lista inclui quem já foi desligado — a diária existe muitas vezes para
 * cobrir o posto que ficou vago — com a situação escrita em cada sugestão.
 * A busca só sai daqui a partir de MIN_BUSCA_EMPREGADO_DIARIA caracteres:
 * EMPREGADOS passa de 10 mil linhas e uma consulta por tecla não se paga.
 */
function BuscaEmpregado({
  valor,
  onEscolher,
  onDigitar,
  placeholder,
}: {
  valor: string;
  onEscolher: (e: EmpregadoDiaria) => void;
  onDigitar: (nome: string) => void;
  placeholder: string;
}) {
  const [aberto, setAberto] = useState(false);
  const {
    data: achados = [],
    isFetching,
    isError,
    error,
  } = useBuscaEmpregadosDiaria(valor);

  return (
    <div className="relative">
      <Input
        value={valor}
        onChange={(e) => {
          onDigitar(e.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        // `onBlur` com atraso: sem ele o clique na sugestão fecha a lista antes
        // do onClick disparar, e a escolha se perde.
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {aberto && valor.trim().length > 0 && valor.trim().length < MIN_BUSCA_EMPREGADO_DIARIA && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover p-1 shadow-md">
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Digite pelo menos {MIN_BUSCA_EMPREGADO_DIARIA} caracteres para buscar no cadastro.
          </p>
        </div>
      )}
      {aberto && valor.trim().length >= MIN_BUSCA_EMPREGADO_DIARIA && (
        <div className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {isFetching && achados.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Buscando...</p>
          )}
          {isError && (
            <p className="px-2 py-1.5 text-xs text-destructive">
              {mensagemErroDiaria(error, "Não foi possível consultar EMPREGADOS.")}
            </p>
          )}
          {!isFetching && !isError && achados.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Ninguém encontrado no cadastro — pode digitar nome e CPF à mão.
            </p>
          )}
          {achados.map((e) => (
            <button
              key={e.id}
              type="button"
              className="flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-left hover:bg-accent"
              onClick={() => {
                onEscolher(e);
                setAberto(false);
              }}
            >
              <span className="flex w-full items-center gap-1.5 text-sm">
                <span className="truncate">{e.nome}</span>
                {estaDesligado(e.situacao) && (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-700"
                  >
                    {e.situacao}
                  </Badge>
                )}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {e.cpf}
                {e.cargo ? ` • ${e.cargo}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SolicitacaoDiariaModal({
  aberto,
  modo,
  solicitacao,
  existentes,
  salvando,
  visualizacoes = [],
  podeDecidir = false,
  souOSolicitante = false,
  podeExcluir = false,
  onFechar,
  onSalvar,
  onReenviar,
  onAprovar,
  onReprovar,
  onSolicitarAjuste,
  onExcluir,
}: Props) {
  const { toast } = useToast();
  // "ajustar" é o MESMO formulário de "nova", preenchido — daí os dois
  // ficarem do lado editável desta linha. É o que evita manter duas telas de
  // lançamento de diária que precisariam ser corrigidas em dobro.
  const editavel = modo === "nova" || modo === "ajustar";
  const somenteLeitura = !editavel;

  // --- estado do formulário (modo "nova") ---------------------------------
  const [contratoId, setContratoId] = useState("");
  const [postoId, setPostoId] = useState("");
  const [faltanteNome, setFaltanteNome] = useState("");
  const [faltanteCpf, setFaltanteCpf] = useState("");
  const [faltanteEmpregadoId, setFaltanteEmpregadoId] = useState<number | null>(null);
  const [diaristaNome, setDiaristaNome] = useState("");
  const [diaristaCpf, setDiaristaCpf] = useState("");
  const [diaristaEmpregadoId, setDiaristaEmpregadoId] = useState<number | null>(null);
  const [pix, setPix] = useState("");
  const [pixTipo, setPixTipo] = useState<TipoPix | "">("");
  const [linhas, setLinhas] = useState<LinhaDiaria[]>([linhaVazia()]);
  const [comprovante, setComprovante] = useState<File[]>([]);
  const [documentos, setDocumentos] = useState<File[]>([]);
  const [observacoes, setObservacoes] = useState("");
  const [tentouSalvar, setTentouSalvar] = useState(false);
  // Anexos que JÁ estão no bucket e a pessoa tirou durante o ajuste. Só saem
  // do Storage depois de a RPC aceitar o reenvio (ver useAjustarSolicitacaoDiaria).
  const [anexosRemovidos, setAnexosRemovidos] = useState<string[]>([]);
  // A decisão negativa em curso (reprovar / devolver / excluir) e o motivo que
  // o Operacional está escrevendo para ela.
  const [decisaoNegativa, setDecisaoNegativa] = useState<DecisaoNegativaDiaria | null>(null);
  const [motivoDecisao, setMotivoDecisao] = useState("");

  // Contratos e postos vêm do banco (ver src/hooks/useDiarias.ts). O posto só
  // é buscado depois de escolher o contrato — é uma cascata.
  const {
    data: contratos = [],
    isLoading: buscandoContratos,
    isError: falhaContratos,
    error: erroContratos,
  } = useContratosDiaria();
  const {
    data: postos = [],
    isFetching: buscandoPostos,
    isError: falhaPostos,
    error: erroPostos,
  } = usePostosDiaria(contratoId || null);
  const posto = postos.find((p) => p.id === postoId)?.nome ?? "";

  // Contexto do painel do Malote. O backend resolve tudo outra vez na RPC;
  // estes ids existem para alimentar o mesmo formulário/rateio da tela normal.
  const { data: empresaContratoId, isLoading: buscandoEmpresaContrato } =
    useEmpresaContratoDiaria(solicitacao?.contratoId);
  const { data: classificacoesMalote = [], isLoading: buscandoClassificacoes } =
    useClassificacoesOrcamento();
  const classificacaoDiaria = useMemo(
    () => classificacoesMalote.find((c) =>
      c.ativo && c.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() === "diaria"
    ) ?? null,
    [classificacoesMalote],
  );

  // Reinicia tudo a cada abertura — o modal só existe enquanto `aberto`.
  //
  // No modo "ajustar" o formulário nasce PREENCHIDO com o que foi lançado: a
  // pessoa está corrigindo um ponto específico que o Operacional apontou, não
  // redigitando a solicitação. Redigitar é onde nasce o segundo erro.
  const chave = `${modo}-${solicitacao?.id ?? "nova"}-${aberto}`;
  const [chaveAtual, setChaveAtual] = useState(chave);
  if (chave !== chaveAtual) {
    const base = modo === "ajustar" ? solicitacao : null;
    setChaveAtual(chave);
    // Contrato e posto são cascata (o posto depende do contrato carregado), e
    // o posto é escolhido por id — que a solicitação não guarda, só o nome.
    // Um efeito adiante casa o nome de volta com o id assim que a lista chega.
    setContratoId(base?.contratoId ?? "");
    setPostoId("");
    // Os ids de EMPREGADOS voltam nulos porque a solicitação guarda nome e CPF
    // gravados, não o id (o snapshot é de propósito: o cadastro muda e o
    // pagamento antigo tem que continuar mostrando para quem foi pago). Isso
    // deixa os CPFs editáveis no ajuste, o que é o comportamento certo —
    // trocar a pessoa é justamente um dos motivos de devolver a solicitação.
    setFaltanteNome(base?.faltanteNome ?? "");
    setFaltanteCpf(base?.faltanteCpf ?? "");
    setFaltanteEmpregadoId(null);
    setDiaristaNome(base?.diaristaNome ?? "");
    setDiaristaCpf(base?.diaristaCpf ?? "");
    setDiaristaEmpregadoId(null);
    setPix(base?.pix ?? "");
    setPixTipo(base?.pixTipo ?? "");
    setLinhas(
      base && base.diarias.length > 0
        ? base.diarias.map((l) => ({ ...l }))
        : [linhaVazia()],
    );
    setComprovante([]);
    setDocumentos([]);
    setAnexosRemovidos([]);
    setObservacoes(base?.observacoes ?? "");
    setTentouSalvar(false);
    setDecisaoNegativa(null);
    setMotivoDecisao("");
  }

  // O posto vem gravado por NOME na solicitação (de propósito: posto renomeado
  // não pode reescrever o histórico). Para o Select funcionar no ajuste, o id
  // precisa ser recuperado do catálogo — o que só dá para fazer depois de a
  // lista do contrato chegar. Se o posto foi desativado no meio do caminho, o
  // campo fica vazio e a pessoa escolhe outro, que é o comportamento certo.
  const [postoCasado, setPostoCasado] = useState("");
  if (modo === "ajustar" && postoCasado !== chave && postos.length > 0 && !postoId) {
    setPostoCasado(chave);
    const achado = postos.find((p) => p.nome === solicitacao?.posto);
    if (achado) setPostoId(achado.id);
  }

  // Os anexos que já estavam gravados e continuam valendo depois das remoções
  // feitas nesta sessão de ajuste.
  const comprovantesMantidos = (solicitacao?.comprovantePonto ?? []).filter(
    (a) => !anexosRemovidos.includes(a.storagePath),
  );
  const documentosMantidos = (solicitacao?.documentos ?? []).filter(
    (a) => !anexosRemovidos.includes(a.storagePath),
  );

  /**
   * A base contra a qual as linhas digitadas são conferidas.
   *
   * No ajuste, a própria solicitação sai da base: ela está "em_ajuste", que
   * OCUPA escala (vai voltar), então deixá-la aqui faria cada linha acusar
   * duplicidade contra a versão antiga dela mesma — e o reenvio ficaria
   * travado sem que houvesse conflito nenhum. No banco isso não acontece
   * porque diaria_editar_solicitacao() apaga as linhas antes de regravar.
   */
  const baseConflito = useMemo(
    () =>
      modo === "ajustar" && solicitacao
        ? existentes.filter((x) => x.uuid !== solicitacao.uuid)
        : existentes,
    [modo, existentes, solicitacao],
  );

  const conflitos = useMemo(
    () =>
      avaliarConflitos(
        { faltanteCpf, diaristaCpf, linhas: linhas.map((l) => ({ data: l.data, turno: l.turno })) },
        baseConflito,
      ),
    [faltanteCpf, diaristaCpf, linhas, baseConflito],
  );

  const temConflito = conflitos.some(Boolean);
  const linhasPreenchidas = linhas.every((l) => l.data);
  const cpfsOk = cpfValido(faltanteCpf) && cpfValido(diaristaCpf);
  const pessoasDiferentes =
    soDigitos(faltanteCpf) !== "" && soDigitos(faltanteCpf) !== soDigitos(diaristaCpf);
  const erroPix = erroChavePix(pixTipo, pix);
  // No ajuste, o anexo que já está gravado conta: exigir upload novo obrigaria
  // a pessoa a reenviar o comprovante de ponto para corrigir um valor de VT.
  const totalComprovantes = comprovante.length + comprovantesMantidos.length;
  const totalDocumentos = documentos.length + documentosMantidos.length;
  const camposOk =
    !!contratoId &&
    !!postoId &&
    !!faltanteNome.trim() &&
    !!diaristaNome.trim() &&
    !erroPix &&
    cpfsOk &&
    pessoasDiferentes &&
    linhasPreenchidas &&
    totalComprovantes > 0 &&
    totalDocumentos > 0;
  const podeSalvar = camposOk && !temConflito;

  const totalGeral = linhas.reduce((acc, l) => acc + valorTotalLinha(l), 0);

  const erro = (cond: boolean, msg: string) => (tentouSalvar && cond ? msg : undefined);

  // O arquivo é guardado como File e só sobe para o bucket no salvamento —
  // anexar e desistir do modal não deixa lixo no storage.
  const anexarArquivos = (files: FileList, set: (fn: (a: File[]) => File[]) => void) => {
    const novos = Array.from(files);
    const grandes = novos.filter((f) => f.size > 10 * 1024 * 1024);
    if (grandes.length) {
      toast({
        title: "Arquivo acima de 10 MB",
        description: grandes.map((f) => f.name).join(", "),
        variant: "destructive",
      });
    }
    const aceitos = novos.filter((f) => f.size <= 10 * 1024 * 1024);
    set((prev) => [...prev.filter((p) => !aceitos.some((n) => n.name === p.name)), ...aceitos]);
  };

  const salvar = () => {
    setTentouSalvar(true);
    if (!podeSalvar) {
      toast({
        title: "Não foi possível salvar",
        description: temConflito
          ? "Corrija as duplicidades para habilitar o salvamento."
          : "Preencha todos os campos obrigatórios e anexe os dois documentos.",
        variant: "destructive",
      });
      return;
    }
    const dados: NovaSolicitacaoDiaria = {
      contratoId,
      postoId: postoId || null,
      postoNome: posto,
      faltanteEmpregadoId,
      faltanteNome: faltanteNome.trim(),
      faltanteCpf,
      diaristaEmpregadoId,
      diaristaNome: diaristaNome.trim(),
      diaristaCpf,
      pix: pix.trim(),
      pixTipo,
      observacoes: observacoes.trim(),
      linhas: linhas.map((l) => ({
        data: l.data,
        turno: l.turno,
        qtVt: l.qtVt,
        valorUnitVt: l.valorUnitVt,
        valorDiaria: l.valorDiaria,
      })),
      comprovantePonto: comprovante,
      documentos,
    };
    if (modo === "ajustar") onReenviar?.({ ...dados, anexosRemovidos });
    else onSalvar(dados);
  };

  /**
   * Confirma a decisão negativa escolhida no menu de "Reprovar".
   *
   * Devolver para ajuste e excluir EXIGEM motivo escrito — o primeiro porque é
   * literalmente a instrução que o solicitante vai seguir, o segundo porque é
   * o que fica na trilha de uma solicitação de pagamento que sumiu da lista.
   * Reprovar continua sem campo, como sempre foi: o banco não guarda motivo de
   * reprovação, e inventar um aqui seria texto que ninguém leria.
   */
  const confirmarDecisao = () => {
    if (!solicitacao || !decisaoNegativa) return;
    if (decisaoNegativa === "reprovar") {
      onReprovar(solicitacao.uuid);
      return;
    }
    const motivo = motivoDecisao.trim();
    if (!motivo) {
      toast({
        title: "Escreva o motivo",
        description: "É o que o solicitante vai ler para saber o que fazer.",
        variant: "destructive",
      });
      return;
    }
    if (decisaoNegativa === "ajuste") onSolicitarAjuste?.(solicitacao.uuid, motivo);
    else onExcluir?.(solicitacao.uuid, motivo);
  };

  // --- cabeçalho -----------------------------------------------------------
  // O número é uma sequência do banco (SD-2026-000123): só existe depois de
  // salvar. Adivinhar aqui daria dois lançamentos simultâneos com o mesmo ID.
  const idExibido = modo === "nova" ? "—" : (solicitacao?.id ?? "");
  const legendaId =
    modo === "nova"
      ? "Gerado automaticamente ao salvar"
      : `Criado em ${solicitacao?.criadoEm ?? ""}`;

  // Um mapa em vez da escada de ternários que existia aqui: com seis status,
  // a escada ficou ilegível e cada novo estado pedia mais um degrau.
  const BADGE_STATUS: Record<
    StatusSolicitacao,
    { icone: typeof Clock; texto: string; cls: string }
  > = {
    solicitada: {
      icone: Clock,
      texto: "Solicitada",
      cls: "border-warning/40 bg-warning/10 text-warning",
    },
    em_ajuste: {
      icone: PenLine,
      texto: "Em ajuste",
      cls: "border-info/40 bg-info/10 text-info",
    },
    aprovada: {
      icone: CheckCircle2,
      texto: "Aprovada",
      cls: "border-success/40 bg-success/10 text-success",
    },
    paga: {
      icone: CheckCircle2,
      texto: "Paga",
      cls: "border-primary/40 bg-primary/10 text-primary",
    },
    reprovada: {
      icone: XCircle,
      texto: "Reprovado",
      cls: "border-destructive/40 bg-destructive/10 text-destructive",
    },
    excluida: {
      icone: Trash2,
      texto: "Excluída",
      cls: "border-muted-foreground/40 bg-muted text-muted-foreground",
    },
  };

  const badgeStatus = (() => {
    if (modo === "nova" || !solicitacao) return null;
    const { icone: Icone, texto, cls } = BADGE_STATUS[solicitacao.status];
    return (
      <Badge variant="outline" className={cn("gap-1.5 px-2.5 py-1 text-xs font-semibold", cls)}>
        <Icone className="h-3.5 w-3.5" /> {texto}
      </Badge>
    );
  })();

  const s = solicitacao;

  /**
   * Quais decisões negativas cabem NESTE estado. Espelham exatamente o que o
   * banco aceita — oferecer um botão que a RPC vai recusar é pior do que não
   * ter botão:
   *
   *   reprovar → só de 'solicitada' (diaria_guard exige OLD.status assim).
   *   ajuste   → de 'solicitada' e de 'reprovada' (diaria_solicitar_ajuste).
   *   excluir  → de tudo menos 'aprovada'/'paga' (virou despesa no Malote;
   *              desfazer é por lá) e 'excluida' (já está).
   */
  // Decidir exige a permissão E não ser o próprio solicitante: diaria_guard()
  // recusa "quem solicitou não aprova nem reprova a própria" no banco, então
  // mostrar o botão aqui só produziria um erro no clique.
  const podeDecidirEsta = podeDecidir && !souOSolicitante;
  const podeReprovarAgora = podeDecidirEsta && s?.status === "solicitada";
  const podePedirAjusteAgora =
    podeDecidirEsta && (s?.status === "solicitada" || s?.status === "reprovada");
  const podeExcluirAgora =
    podeExcluir &&
    !!s &&
    s.status !== "aprovada" &&
    s.status !== "paga" &&
    s.status !== "excluida";

  /**
   * A reprovada "fica ali parada" — era o relato. Abrir uma solicitação já
   * reprovada não oferecia saída nenhuma: nem devolver para ajuste, nem tirar
   * da lista. A devolvida para ajuste tinha o mesmo destino se o solicitante
   * simplesmente nunca a corrigisse.
   */
  const mostraDecisoes =
    modo === "visualizar" &&
    (podeReprovarAgora || podePedirAjusteAgora || podeExcluirAgora);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      {/* O conteúdo conserva a largura em que a grade de diárias permanece
          legível. Em telas menores, o próprio modal oferece rolagem horizontal
          em vez de comprimir ou esconder campos. */}
      <DialogContent className="max-h-[92vh] w-[min(96vw,68rem)] max-w-none overflow-x-auto overflow-y-auto p-0">
        {/* Cabeçalho */}
        <div className="sticky top-0 z-10 min-w-[68rem] border-b border-border bg-background px-6 pb-4 pt-5">
          <DialogTitle className="font-display text-xl font-bold tracking-tight">
            Solicitação de Pagamento de Diária
          </DialogTitle>
          <p className="mt-2 text-[11px] font-medium text-muted-foreground">ID da solicitação</p>
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold text-primary">{idExibido}</span>
            {badgeStatus}
          </div>
          <p className="text-[11px] text-muted-foreground">{legendaId}</p>
        </div>

        <div className="min-w-[68rem] space-y-4 px-6 pb-6">
          {/* O que o Operacional pediu. Fica ANTES da seção 1 de propósito:
              quem abre uma solicitação devolvida está procurando exatamente
              isto, e achar depois de rolar seis seções é achar tarde. */}
          {s?.status === "em_ajuste" && s.ajusteMotivo && (
            <div className="flex items-start gap-2.5 rounded-lg border border-info/40 bg-info/5 px-4 py-3">
              <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-info">
                  {modo === "ajustar"
                    ? "Esta solicitação voltou para ajuste"
                    : "Devolvida para ajuste do solicitante"}
                </p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{s.ajusteMotivo}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Pedido por {s.ajustePedidoPor ?? "—"}
                  {s.ajustePedidoEm ? ` em ${s.ajustePedidoEm}` : ""}
                </p>
              </div>
            </div>
          )}

          {s?.status === "excluida" && (
            <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted px-4 py-3">
              <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">Solicitação excluída</p>
                <p className="mt-0.5 whitespace-pre-line text-sm">{s.exclusaoMotivo ?? "—"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Excluída por {s.excluidaPor ?? "—"}
                  {s.excluidaEm ? ` em ${s.excluidaEm}` : ""}
                </p>
              </div>
            </div>
          )}

          {/* 1. Informações gerais */}
          <Secao numero={1} titulo="Informações gerais">
            <div className="grid gap-4 sm:grid-cols-2">
              {somenteLeitura ? (
                <>
                  <Leitura label="Contrato" valor={s?.contratoNome} />
                  <Leitura label="Posto" valor={s?.posto} />
                </>
              ) : (
                <>
                  <Campo label="Contrato" obrigatorio erro={erro(!contratoId, "Selecione o contrato.")}>
                    <Select
                      value={contratoId}
                      disabled={buscandoContratos || falhaContratos}
                      onValueChange={(v) => {
                        setContratoId(v);
                        setPostoId("");
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            buscandoContratos ? "Carregando..." : "Selecione um contrato"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {contratos.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nome}
                            {c.cliente ? ` - ${c.cliente}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {falhaContratos && (
                      <p className="text-[11px] font-medium text-destructive">
                        {mensagemErroDiaria(erroContratos, "Não foi possível carregar contratos.")}
                      </p>
                    )}
                  </Campo>
                  <Campo
                    label="Posto"
                    obrigatorio
                    erro={
                      // Contrato sem posto cadastrado é o caso que mais trava a
                      // tela na prática; dizer o que falta cadastrar poupa um
                      // chamado.
                      falhaPostos
                        ? mensagemErroDiaria(erroPostos, "Não foi possível carregar os postos.")
                        : contratoId && !buscandoPostos && postos.length === 0
                        ? "Este contrato ainda não tem posto cadastrado no catálogo."
                        : erro(!postoId, "Selecione o posto.")
                    }
                  >
                    <Select
                      value={postoId}
                      onValueChange={setPostoId}
                      disabled={!contratoId || buscandoPostos || falhaPostos}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={buscandoPostos ? "Carregando..." : "Selecione um posto"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {postos.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.nome}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                </>
              )}
            </div>
          </Secao>

          {/* 2. Faltante */}
          <Secao numero={2} titulo="Faltante">
            <div className="grid gap-4 sm:grid-cols-2">
              {somenteLeitura ? (
                <>
                  <Leitura label="Nome do faltante" valor={s?.faltanteNome} />
                  <Leitura label="CPF do faltante" valor={s?.faltanteCpf} />
                </>
              ) : (
                <>
                  <Campo
                    label="Nome do faltante"
                    obrigatorio
                    erro={erro(!faltanteNome.trim(), "Informe o nome do faltante.")}
                  >
                    <BuscaEmpregado
                      valor={faltanteNome}
                      placeholder={`Digite o nome do faltante (mínimo ${MIN_BUSCA_EMPREGADO_DIARIA} caracteres para iniciar a busca)`}
                      onDigitar={(v) => {
                        setFaltanteNome(v);
                        setFaltanteCpf("");
                        setFaltanteEmpregadoId(null);
                      }}
                      onEscolher={(e) => {
                        setFaltanteNome(e.nome);
                        setFaltanteCpf(mascaraCpf(e.cpf));
                        setFaltanteEmpregadoId(e.id);
                      }}
                    />
                  </Campo>
                  <Campo
                    label="CPF do faltante"
                    obrigatorio
                    erro={
                      tentouSalvar && !cpfValido(faltanteCpf)
                        ? faltanteCpf
                          ? "CPF inexistente."
                          : "Informe o CPF do faltante."
                        : undefined
                    }
                  >
                    <Input
                      value={faltanteCpf}
                      onChange={(e) => setFaltanteCpf(mascaraCpf(e.target.value))}
                      placeholder="000.000.000-00"
                      inputMode="numeric"
                      readOnly={faltanteEmpregadoId !== null}
                      className={cn(
                        soDigitos(faltanteCpf).length === 11 &&
                          !cpfValido(faltanteCpf) &&
                          "border-destructive focus-visible:ring-destructive",
                        faltanteEmpregadoId !== null && "bg-muted/40",
                      )}
                    />
                  </Campo>
                </>
              )}
            </div>
          </Secao>

          {/* 3. Diarista */}
          <Secao numero={3} titulo="Diarista">
            <div className="grid gap-4 sm:grid-cols-3">
              {somenteLeitura ? (
                <>
                  <Leitura label="Nome do diarista" valor={s?.diaristaNome} />
                  <Leitura label="CPF do diarista" valor={s?.diaristaCpf} />
                  {/* O tipo entra no rótulo, não numa linha só dele: quem
                      confere o pagamento precisa saber se aquele número é CPF
                      ou telefone, e isso não cabe adivinhar pelo formato. */}
                  <Leitura
                    label={s?.pixTipo ? `Pix (${labelTipoPix(s.pixTipo)})` : "Pix"}
                    valor={s?.pix}
                  />
                </>
              ) : (
                <>
                  <Campo
                    label="Nome do diarista"
                    obrigatorio
                    erro={erro(!diaristaNome.trim(), "Informe o nome do diarista.")}
                  >
                    <BuscaEmpregado
                      valor={diaristaNome}
                      placeholder={`Digite o nome do diarista (mínimo ${MIN_BUSCA_EMPREGADO_DIARIA} caracteres para iniciar a busca)`}
                      onDigitar={(v) => {
                        setDiaristaNome(v);
                        setDiaristaCpf("");
                        setDiaristaEmpregadoId(null);
                      }}
                      onEscolher={(e) => {
                        setDiaristaNome(e.nome);
                        setDiaristaCpf(mascaraCpf(e.cpf));
                        setDiaristaEmpregadoId(e.id);
                      }}
                    />
                  </Campo>
                  <Campo
                    label="CPF do diarista"
                    obrigatorio
                    erro={
                      tentouSalvar && !cpfValido(diaristaCpf)
                        ? diaristaCpf
                          ? "CPF inexistente."
                          : "Informe o CPF do diarista."
                        : tentouSalvar && !pessoasDiferentes
                          ? "O diarista precisa ser diferente do faltante."
                          : undefined
                    }
                  >
                    <Input
                      value={diaristaCpf}
                      onChange={(e) => setDiaristaCpf(mascaraCpf(e.target.value))}
                      placeholder="000.000.000-00"
                      inputMode="numeric"
                      readOnly={diaristaEmpregadoId !== null}
                      className={cn(
                        soDigitos(diaristaCpf).length === 11 &&
                          !cpfValido(diaristaCpf) &&
                          "border-destructive focus-visible:ring-destructive",
                        diaristaEmpregadoId !== null && "bg-muted/40",
                      )}
                    />
                  </Campo>
                  {/* O tipo vem ANTES da chave: é ele que decide o que o campo
                      pede, como formata e o que recusa. Chave Pix errada é
                      dinheiro na conta de outra pessoa, e o erro só aparece
                      depois do pagamento. */}
                  <Campo label="Chave Pix" obrigatorio erro={erro(!!erroPix, erroPix ?? "")}>
                    <div className="flex gap-2">
                      <Select
                        value={pixTipo}
                        onValueChange={(v) => {
                          const novo = v as TipoPix;
                          setPixTipo(novo);
                          // A chave digitada para o tipo anterior não vale para
                          // o novo (um CPF mascarado não vira e-mail). Reformata
                          // o que dá e deixa o resto para a validação.
                          setPix((atual) => mascaraPix(novo, atual));
                        }}
                      >
                        <SelectTrigger className="w-32 shrink-0">
                          <SelectValue placeholder="Tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          {TIPOS_PIX.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={pix}
                        onChange={(e) => setPix(mascaraPix(pixTipo, e.target.value))}
                        placeholder={placeholderPix(pixTipo)}
                        disabled={!pixTipo}
                        inputMode={
                          pixTipo === "email" || !pixTipo ? undefined : "numeric"
                        }
                        className={cn(
                          "min-w-0 flex-1",
                          // Erra só depois de a pessoa ter digitado algo: campo
                          // vazio com borda vermelha ao abrir o modal é ruído.
                          !!pix.trim() && !!erroPix &&
                            "border-destructive focus-visible:ring-destructive",
                        )}
                      />
                    </div>
                  </Campo>
                </>
              )}
            </div>
          </Secao>

          {/* 4. Dados das diárias */}
          <Secao
            numero={4}
            titulo="Dados das diárias"
            acao={
              somenteLeitura ? undefined : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLinhas((p) => [...p, linhaVazia()])}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar diária
                </Button>
              )
            }
          >
            {/* `table-fixed` + larguras em porcentagem: as colunas dividem a
                largura disponível e encolhem juntas, então todos os campos da
                diária continuam visíveis sem rolagem horizontal. */}
            <div>
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[15%]" />
                  <col className="w-[12%]" />
                  <col className="w-[7%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className="w-[12%]" />
                  <col className={somenteLeitura ? "w-[30%]" : "w-[24%]"} />
                  {!somenteLeitura && <col className="w-[6%]" />}
                </colgroup>
                <thead>
                  <tr className="text-left align-bottom text-[11px] font-medium text-muted-foreground">
                    <th className="pb-2 pr-2 font-medium">Data da diária</th>
                    <th className="pb-2 pr-2 font-medium">Turno</th>
                    <th className="pb-2 pr-2 font-medium">Qt VT</th>
                    <th className="pb-2 pr-2 font-medium">Valor Unit. VT (R$)</th>
                    <th className="pb-2 pr-2 font-medium">Valor Diária (R$)</th>
                    <th className="pb-2 pr-2 font-medium">Valor Total (R$)</th>
                    <th className="pb-2 pr-2 font-medium">Status</th>
                    {!somenteLeitura && <th className="pb-2 font-medium">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {(somenteLeitura ? (s?.diarias ?? []) : linhas).map((l, i) => {
                    const conflito = somenteLeitura ? null : conflitos[i];
                    const total = valorTotalLinha(l);
                    return (
                      <tr key={l.id} className="align-top">
                        <td className="py-1 pr-2">
                          {somenteLeitura ? (
                            <div className="flex h-9 w-full min-w-0 items-center truncate rounded-md border border-border bg-muted/40 px-2 text-xs">
                              {new Date(`${l.data}T00:00:00`).toLocaleDateString("pt-BR")}
                            </div>
                          ) : (
                            <Input
                              type="date"
                              value={l.data}
                              onChange={(e) =>
                                setLinhas((p) =>
                                  p.map((x, j) => (j === i ? { ...x, data: e.target.value } : x)),
                                )
                              }
                              className="h-9 w-full min-w-0 px-2 text-xs"
                            />
                          )}
                        </td>
                        <td className="py-1 pr-2">
                          {somenteLeitura ? (
                            <div className="flex h-9 w-full min-w-0 items-center truncate rounded-md border border-border bg-muted/40 px-2 text-xs">
                              {labelTurno(l.turno)}
                            </div>
                          ) : (
                            <Select
                              value={l.turno}
                              onValueChange={(v) =>
                                setLinhas((p) =>
                                  p.map((x, j) => (j === i ? { ...x, turno: v as TurnoDiaria } : x)),
                                )
                              }
                            >
                              <SelectTrigger className="h-9 w-full min-w-0 px-2 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TURNOS.map((t) => (
                                  <SelectItem key={t.value} value={t.value}>
                                    {t.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </td>
                        <td className="py-1 pr-2">
                          {somenteLeitura ? (
                            <div className="flex h-9 w-full min-w-0 items-center truncate rounded-md border border-border bg-muted/40 px-2 text-xs">
                              {l.qtVt}
                            </div>
                          ) : (
                            <Input
                              type="number"
                              min={0}
                              value={l.qtVt}
                              onChange={(e) =>
                                setLinhas((p) =>
                                  p.map((x, j) =>
                                    j === i ? { ...x, qtVt: Number(e.target.value) || 0 } : x,
                                  ),
                                )
                              }
                              className="h-9 w-full min-w-0 px-2 text-xs"
                            />
                          )}
                        </td>
                        <td className="py-1 pr-2">
                          {somenteLeitura ? (
                            <div className="flex h-9 w-full min-w-0 items-center truncate rounded-md border border-border bg-muted/40 px-2 text-xs">
                              {fmtBRL(l.valorUnitVt)}
                            </div>
                          ) : (
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={l.valorUnitVt}
                              onChange={(e) =>
                                setLinhas((p) =>
                                  p.map((x, j) =>
                                    j === i ? { ...x, valorUnitVt: Number(e.target.value) || 0 } : x,
                                  ),
                                )
                              }
                              className="h-9 w-full min-w-0 px-2 text-xs"
                            />
                          )}
                        </td>
                        <td className="py-1 pr-2">
                          {somenteLeitura ? (
                            <div className="flex h-9 w-full min-w-0 items-center truncate rounded-md border border-border bg-muted/40 px-2 text-xs">
                              {fmtBRL(l.valorDiaria)}
                            </div>
                          ) : (
                            <Input
                              type="number"
                              step="0.01"
                              min={0}
                              value={l.valorDiaria}
                              onChange={(e) =>
                                setLinhas((p) =>
                                  p.map((x, j) =>
                                    j === i ? { ...x, valorDiaria: Number(e.target.value) || 0 } : x,
                                  ),
                                )
                              }
                              className="h-9 w-full min-w-0 px-2 text-xs"
                            />
                          )}
                        </td>
                        <td className="py-1 pr-2">
                          <div className="flex h-9 w-full min-w-0 items-center truncate rounded-md border border-border bg-muted/40 px-2 text-xs font-medium">
                            {fmtBRL(total)}
                          </div>
                        </td>
                        <td className="py-1 pr-2">
                          <div className="min-w-0">
                            {conflito ? (
                              <div className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-1.5">
                                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                                <div className="min-w-0">
                                  <p className="break-words text-[11px] font-semibold leading-tight text-destructive">
                                    {textoConflito(conflito)}
                                  </p>
                                  <p className="text-[11px] leading-tight text-destructive/80">
                                    {conflito.detalhe}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 rounded-md border border-success/40 bg-success/5 px-2.5 py-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                                <span className="text-xs font-semibold text-success">Válida</span>
                              </div>
                            )}
                          </div>
                        </td>
                        {!somenteLeitura && (
                          <td className="py-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              disabled={linhas.length === 1}
                              onClick={() => setLinhas((p) => p.filter((_, j) => j !== i))}
                              aria-label="Remover diária"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
              <p className="text-xs text-muted-foreground">
                O status verifica se já existe pagamento de diária para o mesmo Faltante e/ou
                Diarista, no mesmo turno e data.
              </p>
            </div>
          </Secao>

          {/* 5. Documentos */}
          <Secao numero={5} titulo="Documentos">
            {somenteLeitura ? (
              <div className="space-y-2">
                {[...(s?.comprovantePonto ?? []), ...(s?.documentos ?? [])].map((a) => (
                  <AnexoLinha key={a.nome} a={a} />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-right text-[11px] text-muted-foreground">
                  Ambos os anexos são obrigatórios para aceitar a solicitação.
                </p>
                {/* No ajuste, o que já subiu CONTINUA valendo: exigir reenvio do
                    comprovante de ponto para corrigir um valor de VT faria a
                    pessoa caçar de novo um arquivo que já está lá. Remover é
                    ato explícito, e só acontece de verdade depois que o
                    reenvio é aceito. */}
                {modo === "ajustar" &&
                  (comprovantesMantidos.length > 0 || documentosMantidos.length > 0) && (
                    <div className="space-y-3 rounded-md border border-border bg-muted/30 p-3">
                      {/* Separado por categoria porque AnexoLinha não diz qual
                          é qual, e o que o Operacional devolve costuma ser
                          exatamente "o comprovante de ponto está errado". */}
                      {(
                        [
                          ["Comprovante do ponto já anexado", comprovantesMantidos],
                          ["Documentos já anexados", documentosMantidos],
                        ] as const
                      ).map(([titulo, itens]) =>
                        itens.length === 0 ? null : (
                          <div key={titulo} className="space-y-2">
                            <p className="text-[11px] font-medium text-muted-foreground">
                              {titulo}
                            </p>
                            {itens.map((a) => (
                              <div key={a.storagePath} className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <AnexoLinha a={a} />
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 text-destructive"
                                  onClick={() =>
                                    setAnexosRemovidos((p) => [...p, a.storagePath])
                                  }
                                  aria-label={`Remover ${a.nome}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                {modo === "ajustar" && anexosRemovidos.length > 0 && (
                  <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
                    <p className="text-[11px] text-destructive">
                      {anexosRemovidos.length}{" "}
                      {anexosRemovidos.length === 1 ? "anexo será removido" : "anexos serão removidos"}{" "}
                      ao reenviar.
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
                <Dropzone
                  label={modo === "ajustar" ? "Novo comprovante do ponto" : "Comprovante do ponto"}
                  arquivos={comprovante}
                  onAdicionar={(f) => anexarArquivos(f, setComprovante)}
                  onRemover={(n) => setComprovante((p) => p.filter((a) => a.name !== n))}
                />
                <Dropzone
                  label={modo === "ajustar" ? "Novos documentos" : "Documentos"}
                  arquivos={documentos}
                  onAdicionar={(f) => anexarArquivos(f, setDocumentos)}
                  onRemover={(n) => setDocumentos((p) => p.filter((a) => a.name !== n))}
                />
                {tentouSalvar && (totalComprovantes === 0 || totalDocumentos === 0) && (
                  <p className="text-[11px] font-medium text-destructive">
                    {totalComprovantes === 0
                      ? "Anexe o comprovante do ponto."
                      : "Anexe ao menos um documento."}
                  </p>
                )}
              </div>
            )}
          </Secao>

          {/* 6. Observações gerais */}
          <Secao numero={6} titulo="Observações gerais">
            {somenteLeitura ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5">
                <p className="whitespace-pre-line text-sm">{s?.observacoes || "—"}</p>
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {(s?.observacoes ?? "").length}/500
                </p>
              </div>
            ) : (
              <>
                <Textarea
                  value={observacoes}
                  maxLength={500}
                  rows={3}
                  onChange={(e) => setObservacoes(e.target.value)}
                  placeholder="Digite observações gerais (opcional)..."
                />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">
                  {observacoes.length}/500
                </p>
              </>
            )}
          </Secao>

          {/* 7. Mesmo painel da criação do Malote — SIS-2026-0287. */}
          {modo === "aprovar" && s && (
            <Secao numero={7} titulo="Despesa do Malote">
              <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Leitura label="Tipo" valor="Despesa" />
                <Leitura label="Nº" valor="Gerado automaticamente no Malote" />
                <Leitura label="Classificação" valor="Diária" />
                <Leitura label="Empresa" valor={s.contratoEmpresa} />
                <Leitura label="Contrato" valor={s.contratoNome} />
                <Leitura label="Solicitante" valor={s.solicitante} />
              </div>
              <PainelDespesaMalote
                key={chave}
                classificacaoId={classificacaoDiaria?.id ?? ""}
                classificacaoTipo={classificacaoDiaria?.tipo ?? "contrato"}
                empresaId={empresaContratoId ?? null}
                ativo={!!empresaContratoId && !!classificacaoDiaria}
                nomeInicial={s.maloteMotivo ?? `Pagamento de diária ${s.id}`}
                valorInicial={valorTotalSolicitacao(s)}
                inicial={{
                  dataPagamento: s.maloteDataPagamento ?? "",
                  competencia: s.diarias[0]?.data.slice(0, 7) ?? "",
                  informacoesPagamento: `PIX: ${s.pix}`,
                }}
                aoSalvar={async (payload) => onAprovar(s.uuid, payload)}
                rotuloEnviar="Aprovar e enviar para malote"
              />
              {!buscandoEmpresaContrato && !buscandoClassificacoes && (!empresaContratoId || !classificacaoDiaria) && (
                <p className="mt-2 text-xs font-medium text-destructive">
                  Não foi possível resolver a empresa do contrato ou a classificação ativa “Diária”.
                </p>
              )}
            </Secao>
          )}

          <VisualizacoesDiaria lista={visualizacoes} />
        </div>

        {/* Rodapé */}
        {modo === "nova" && (
          <div className="sticky bottom-0 min-w-[68rem] border-t border-border bg-background px-6 py-4">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={temConflito || salvando}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {salvando ? "Enviando anexos e salvando..." : "Salvar solicitação"}
              </Button>
            </div>
            {temConflito && (
              <p className="mt-2 text-right text-[11px] font-medium text-destructive">
                Corrija as duplicidades para habilitar o salvamento.
              </p>
            )}
          </div>
        )}

        {modo === "ajustar" && (
          <div className="sticky bottom-0 min-w-[68rem] border-t border-border bg-background px-6 py-4">
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button onClick={salvar} disabled={temConflito || salvando}>
                <Send className="mr-2 h-4 w-4" />
                {salvando ? "Enviando anexos e salvando..." : "Reenviar para aprovação"}
              </Button>
            </div>
            <p className="mt-2 text-right text-[11px] text-muted-foreground">
              Ao reenviar, a solicitação volta para “Solicitada” e o Operacional decide de novo.
            </p>
            {temConflito && (
              <p className="mt-1 text-right text-[11px] font-medium text-destructive">
                Corrija as duplicidades para habilitar o reenvio.
              </p>
            )}
          </div>
        )}

        {(modo === "aprovar" || mostraDecisoes) && s && (
          <div className="sticky bottom-0 min-w-[68rem] border-t border-border bg-background px-6 py-4">
            {/* O painel de motivo toma o lugar dos botões enquanto está aberto:
                as duas decisões que pedem texto (devolver e excluir) são as que
                mais precisam de um momento de parada antes do clique final. */}
            {decisaoNegativa ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold">
                  {decisaoNegativa === "reprovar"
                    ? "Reprovar esta solicitação?"
                    : decisaoNegativa === "ajuste"
                      ? "O que precisa ser ajustado?"
                      : "Por que esta solicitação está sendo excluída?"}
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
                          ? "Ex.: o comprovante de ponto é de outro dia; corrija e reenvie."
                          : "Ex.: lançamento duplicado do mesmo diarista."
                      }
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {decisaoNegativa === "ajuste"
                        ? `${s.solicitante} recebe este texto como notificação e ajusta a solicitação pela tela de Encarregados.`
                        : "A solicitação sai da lista, mas continua no histórico com este motivo."}
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
                        : "Excluir solicitação"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {/* POR QUE faltam opções no menu.
                    Sem esta linha, quem criou a diária e depois a abria pelo
                    Operacional via só "Excluir" e nenhuma explicação — parecia
                    tela quebrada (relato de 17/09/2026). A regra é antiga e é
                    do banco (diaria_guard); o que faltava era dizê-la. */}
                {podeDecidir && souOSolicitante && (
                  <p className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                    <span>
                      Aprovar, reprovar e devolver para ajuste não aparecem porque{" "}
                      <strong className="font-semibold">esta solicitação foi criada por você</strong>.
                      Quem pede a diária não decide a própria — a decisão é de outro usuário
                      autorizado do Operacional.
                    </span>
                  </p>
                )}
                {!podeDecidir && podeExcluirAgora && (
                  <p className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                    <span>
                      Você não tem a permissão de <strong className="font-semibold">Aprovar</strong>{" "}
                      em Controle de Diárias, então só a exclusão aparece aqui.
                    </span>
                  </p>
                )}
                {/* O status também tinha explicação no rodapé antigo, e ela
                    sumia sempre que este menu aparecia. */}
                {modo !== "aprovar" && s.status === "reprovada" && (
                  <p className="text-center text-xs text-muted-foreground">
                    Solicitação reprovada. Devolver para ajuste deixa o solicitante corrigir e
                    reenviar.
                  </p>
                )}
                {modo !== "aprovar" && s.status === "em_ajuste" && (
                  <p className="text-center text-xs text-muted-foreground">
                    Aguardando o ajuste do solicitante — somente ele pode corrigir e reenviar.
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={salvando}
                    >
                      <X className="mr-2 h-4 w-4" />
                      {/* Na decisão do dia (modo "aprovar") o botão é o par do
                          "Aprovar", e o rótulo tem que ser "Reprovar" — foi
                          exatamente daí que veio o pedido. Numa solicitação já
                          decidida, reprovar não é mais uma das opções, e
                          chamar o menu de "Reprovar" seria mentira. */}
                      {modo === "aprovar" ? "Reprovar" : "Ações"}
                      <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" className="w-72">
                    {podeReprovarAgora && (
                      <DropdownMenuItem onClick={() => setDecisaoNegativa("reprovar")}>
                        <XCircle className="mr-2 h-4 w-4 text-destructive" />
                        <div>
                          <p className="text-sm">Reprovar solicitação</p>
                          <p className="text-[11px] text-muted-foreground">
                            Encerra o pedido como reprovado.
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
                            Devolve a quem criou, com o que precisa mudar.
                          </p>
                        </div>
                      </DropdownMenuItem>
                    )}
                    {podeExcluirAgora && (
                      <DropdownMenuItem onClick={() => setDecisaoNegativa("excluir")}>
                        <Trash2 className="mr-2 h-4 w-4 text-destructive" />
                        <div>
                          <p className="text-sm">Excluir solicitação</p>
                          <p className="text-[11px] text-muted-foreground">
                            Tira da lista; o histórico continua registrado.
                          </p>
                        </div>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {modo === "aprovar" ? (
                  <Button
                    type="submit"
                    form={FORM_ID_PAINEL_DESPESA_DIARIA}
                    disabled={salvando || !empresaContratoId || !classificacaoDiaria}
                  >
                    <Send className="mr-2 h-4 w-4" /> Aprovar e enviar para malote
                  </Button>
                ) : (
                  <Button variant="outline" onClick={onFechar}>
                    Fechar
                  </Button>
                )}
                </div>
              </div>
            )}
          </div>
        )}

        {modo === "visualizar" && !mostraDecisoes && (
          <div className="sticky bottom-0 flex min-w-[68rem] items-center justify-between gap-3 border-t border-border bg-background px-6 py-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <UserX className="h-3.5 w-3.5" />
              {s?.status === "reprovada"
                ? "Solicitação reprovada — somente visualização."
                : s?.status === "excluida"
                  ? "Solicitação excluída — somente visualização."
                  : s?.status === "em_ajuste"
                    ? "Aguardando o ajuste do solicitante — somente ele pode corrigir e reenviar."
                    : s?.status === "paga"
                      ? "Solicitação paga no Malote — somente visualização."
                      : s?.status === "aprovada"
                        ? "Solicitação aprovada — somente visualização."
                        : "Solicitação aguardando aprovação — a decisão deve ser feita por outro usuário autorizado."}
            </p>
            <Button variant="outline" onClick={onFechar}>
              Fechar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
