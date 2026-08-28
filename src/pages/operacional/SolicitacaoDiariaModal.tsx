import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Eye,
  FileImage,
  FileText,
  Info,
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
  NovaSolicitacaoDiaria,
  mensagemErroDiaria,
  urlAnexoDiaria,
  useBuscaEmpregadosDiaria,
  useContratosDiaria,
  usePostosDiaria,
} from "@/hooks/useDiarias";
import {
  AnexoDiaria,
  LinhaDiaria,
  SolicitacaoDiaria,
  TURNOS,
  TurnoDiaria,
  avaliarConflitos,
  cpfValido,
  fmtBRL,
  labelTurno,
  mascaraCpf,
  soDigitos,
  textoConflito,
  valorTotalLinha,
  valorTotalSolicitacao,
} from "./diarias";

/**
 * Um único modal para as três telas aprovadas:
 *  - "nova"       → 1.2  formulário editável, com validação de CPF e duplicidade
 *  - "visualizar" → 1.3  solicitação reprovada, somente leitura, sem ações
 *  - "aprovar"    → 1.4  solicitação solicitada, somente leitura + pré-visualização
 *                        do Malote e os botões de reprovar / aprovar
 */
export type ModoModalDiaria = "nova" | "visualizar" | "aprovar";

interface Props {
  aberto: boolean;
  modo: ModoModalDiaria;
  solicitacao?: SolicitacaoDiaria | null;
  /** Base para checar duplicidade das linhas digitadas. */
  existentes: SolicitacaoDiaria[];
  salvando?: boolean;
  onFechar: () => void;
  onSalvar: (s: NovaSolicitacaoDiaria) => void;
  /** Recebem o uuid da solicitação (a chave no banco), não o número exibido. */
  onAprovar: (uuid: string, motivo: string, dataPagamento: string) => void;
  onReprovar: (uuid: string) => void;
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
 * Campo de nome que busca no cadastro de EMPREGADOS e devolve a pessoa
 * inteira — é o que preenche o CPF ao lado.
 *
 * O texto continua livre depois de escolher: diarista nem sempre é empregado
 * da casa, e travar o campo no cadastro impediria justamente o caso mais comum
 * de diária. Quando é gente de fora, o CPF é digitado à mão e validado pelo
 * dígito verificador; quando é do cadastro, o CPF vem de lá e não se digita.
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
      {aberto && valor.trim().length >= 2 && (
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
              <span className="text-sm">{e.nome}</span>
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
  onFechar,
  onSalvar,
  onAprovar,
  onReprovar,
}: Props) {
  const { toast } = useToast();
  const somenteLeitura = modo !== "nova";

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
  const [linhas, setLinhas] = useState<LinhaDiaria[]>([linhaVazia()]);
  const [comprovante, setComprovante] = useState<File[]>([]);
  const [documentos, setDocumentos] = useState<File[]>([]);
  const [observacoes, setObservacoes] = useState("");
  const [tentouSalvar, setTentouSalvar] = useState(false);

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

  // --- estado da aprovação (modo "aprovar", seção 7) ----------------------
  const [maloteMotivo, setMaloteMotivo] = useState("");
  const [maloteData, setMaloteData] = useState("");
  const [tentouAprovar, setTentouAprovar] = useState(false);

  // Reinicia tudo a cada abertura — o modal só existe enquanto `aberto`.
  const chave = `${modo}-${solicitacao?.id ?? "nova"}-${aberto}`;
  const [chaveAtual, setChaveAtual] = useState(chave);
  if (chave !== chaveAtual) {
    setChaveAtual(chave);
    setContratoId("");
    setPostoId("");
    setFaltanteNome("");
    setFaltanteCpf("");
    setFaltanteEmpregadoId(null);
    setDiaristaNome("");
    setDiaristaCpf("");
    setDiaristaEmpregadoId(null);
    setPix("");
    setLinhas([linhaVazia()]);
    setComprovante([]);
    setDocumentos([]);
    setObservacoes("");
    setTentouSalvar(false);
    setMaloteMotivo(solicitacao?.maloteMotivo ?? "");
    setMaloteData(solicitacao?.maloteDataPagamento ?? "");
    setTentouAprovar(false);
  }

  const conflitos = useMemo(
    () =>
      avaliarConflitos(
        { faltanteCpf, diaristaCpf, linhas: linhas.map((l) => ({ data: l.data, turno: l.turno })) },
        existentes,
      ),
    [faltanteCpf, diaristaCpf, linhas, existentes],
  );

  const temConflito = conflitos.some(Boolean);
  const linhasPreenchidas = linhas.every((l) => l.data);
  const cpfsOk = cpfValido(faltanteCpf) && cpfValido(diaristaCpf);
  const pessoasDiferentes =
    soDigitos(faltanteCpf) !== "" && soDigitos(faltanteCpf) !== soDigitos(diaristaCpf);
  const camposOk =
    !!contratoId &&
    !!postoId &&
    !!faltanteNome.trim() &&
    !!diaristaNome.trim() &&
    !!pix.trim() &&
    cpfsOk &&
    pessoasDiferentes &&
    linhasPreenchidas &&
    comprovante.length > 0 &&
    documentos.length > 0;
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
    onSalvar({
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
    });
  };

  // --- cabeçalho -----------------------------------------------------------
  // O número é uma sequência do banco (SD-2026-000123): só existe depois de
  // salvar. Adivinhar aqui daria dois lançamentos simultâneos com o mesmo ID.
  const idExibido = modo === "nova" ? "—" : (solicitacao?.id ?? "");
  const legendaId =
    modo === "nova"
      ? "Gerado automaticamente ao salvar"
      : `Criado em ${solicitacao?.criadoEm ?? ""}`;

  const badgeStatus =
    modo === "nova" ? null : solicitacao?.status === "reprovada" ? (
      <Badge
        variant="outline"
        className="gap-1.5 border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive"
      >
        <XCircle className="h-3.5 w-3.5" /> Reprovado
      </Badge>
    ) : solicitacao?.status === "solicitada" ? (
      <Badge
        variant="outline"
        className="gap-1.5 border-warning/40 bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning"
      >
        <Clock className="h-3.5 w-3.5" /> Solicitada
      </Badge>
    ) : (
      <Badge
        variant="outline"
        className="gap-1.5 border-success/40 bg-success/10 px-2.5 py-1 text-xs font-semibold text-success"
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> Aprovada
      </Badge>
    );

  const s = solicitacao;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      {/* `overflow-y-auto` sozinho faz o navegador promover o eixo X para
          "auto" também: qualquer conteúdo mais largo passa a rolar o modal
          inteiro para o lado. O modal acompanha a largura da viewport e trava
          o eixo X — quem encolhe é o conteúdo, não o campo que some. */}
      <DialogContent className="max-h-[92vh] w-[min(96vw,68rem)] max-w-none overflow-y-auto overflow-x-hidden p-0">
        {/* Cabeçalho */}
        <div className="sticky top-0 z-10 border-b border-border bg-background px-6 pb-4 pt-5">
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

        <div className="space-y-4 px-6 pb-6">
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
                      placeholder="Digite o nome ou o CPF do faltante"
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
                  <Leitura label="Pix" valor={s?.pix} />
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
                      placeholder="Digite o nome ou o CPF do diarista"
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
                  <Campo label="Pix" obrigatorio erro={erro(!pix.trim(), "Informe a chave Pix.")}>
                    <Input
                      value={pix}
                      onChange={(e) => setPix(e.target.value)}
                      placeholder="Digite o e-mail, CPF, telefone ou chave Pix"
                    />
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
                <Dropzone
                  label="Comprovante do ponto"
                  arquivos={comprovante}
                  onAdicionar={(f) => anexarArquivos(f, setComprovante)}
                  onRemover={(n) => setComprovante((p) => p.filter((a) => a.nome !== n))}
                />
                <Dropzone
                  label="Documentos"
                  arquivos={documentos}
                  onAdicionar={(f) => anexarArquivos(f, setDocumentos)}
                  onRemover={(n) => setDocumentos((p) => p.filter((a) => a.nome !== n))}
                />
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

          {/* 7. Pré-visualização do Malote — só na aprovação */}
          {modo === "aprovar" && s && (
            <Secao numero={7} titulo="Pré-visualização do Malote">
              <div className="grid gap-4 sm:grid-cols-2">
                <Leitura label="Tipo" valor="Despesa" />
                <Leitura label="Nº" valor="Gerado automaticamente no Malote" />
                <Campo
                  label="Nome / Motivo"
                  obrigatorio
                  erro={tentouAprovar && !maloteMotivo.trim() ? "Informe o nome ou motivo." : undefined}
                >
                  <Input
                    value={maloteMotivo}
                    onChange={(e) => setMaloteMotivo(e.target.value)}
                    placeholder="Informe o nome ou motivo..."
                  />
                </Campo>
                <Leitura label="Classificação" valor="Diária" />
                <Leitura label="Empresa" valor={s.contratoEmpresa} />
                <Leitura label="Contrato" valor={s.contratoNome} />
                <Leitura label="Valor (R$)" valor={fmtBRL(valorTotalSolicitacao(s))} />
                <Campo
                  label="Data de Pagamento"
                  obrigatorio
                  erro={tentouAprovar && !maloteData ? "Informe a data de pagamento." : undefined}
                >
                  <div className="relative">
                    <Input
                      type="date"
                      value={maloteData}
                      onChange={(e) => setMaloteData(e.target.value)}
                    />
                    <CalendarIcon className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </Campo>
                <Leitura label="Solicitante" valor={s.solicitante} />
              </div>
            </Secao>
          )}
        </div>

        {/* Rodapé */}
        {modo === "nova" && (
          <div className="sticky bottom-0 border-t border-border bg-background px-6 py-4">
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

        {modo === "aprovar" && s && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-center gap-3 border-t border-border bg-background px-6 py-4">
            <Button
              variant="outline"
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={salvando}
              onClick={() => onReprovar(s.uuid)}
            >
              <X className="mr-2 h-4 w-4" /> Reprovar solicitação
            </Button>
            <Button
              disabled={salvando}
              onClick={() => {
                setTentouAprovar(true);
                if (!maloteMotivo.trim() || !maloteData) {
                  toast({
                    title: "Complete a pré-visualização do Malote",
                    description: "Nome / Motivo e Data de Pagamento são obrigatórios para aprovar.",
                    variant: "destructive",
                  });
                  return;
                }
                onAprovar(s.uuid, maloteMotivo.trim(), maloteData);
              }}
            >
              <Send className="mr-2 h-4 w-4" /> Aprovar e enviar para malote
            </Button>
          </div>
        )}

        {modo === "visualizar" && (
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-border bg-background px-6 py-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <UserX className="h-3.5 w-3.5" />
              {s?.status === "reprovada"
                ? "Solicitação reprovada — somente visualização."
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
