import { useRef, useState } from "react";
import { Eye, FileImage, FileText, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { VisualizacaoDiaria } from "./diarias";

/**
 * As peças de tela compartilhadas pelos DOIS modais de diária — o de
 * diarista (SolicitacaoDiariaModal) e o da UFRGS (DiariaUfrgsModal).
 *
 * Elas nasceram dentro do primeiro modal e saíram para cá quando o segundo
 * apareceu (17/09/2026). Não é abstração preventiva: são componentes que o
 * usuário reconhece como "a mesma coisa" nas duas telas (a seção numerada, o
 * campo com asterisco, o campo travado, o dropzone, o rodapé de quem
 * visualizou), e mantê-los em dobro faria as duas telas divergirem em
 * espaçamento e em rótulo na primeira correção feita só num lado.
 */

export function Secao({
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

export function Campo({
  label,
  obrigatorio,
  erro,
  dica,
  children,
  className,
}: {
  label: string;
  obrigatorio?: boolean;
  erro?: string;
  dica?: string;
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
      {dica && !erro && <p className="text-[11px] text-muted-foreground">{dica}</p>}
      {erro && <p className="text-[11px] font-medium text-destructive">{erro}</p>}
    </div>
  );
}

/** Campo de leitura — mesmo desenho das telas 1.3 e 1.4 (input travado). */
export function Leitura({
  label,
  valor,
  dica,
}: {
  label: string;
  valor: React.ReactNode;
  dica?: string;
}) {
  return (
    <Campo label={label} dica={dica}>
      <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">
        <span className="truncate">{valor || "—"}</span>
      </div>
    </Campo>
  );
}

/**
 * Uma linha de anexo já gravado, com o "olhinho" que abre o arquivo.
 *
 * O resolvedor da URL entra por prop porque os dois modais leem pastas
 * diferentes do bucket e, mais importante, o bucket é PRIVADO: cada clique
 * pede um link assinado de curta duração em vez de montar uma URL pública,
 * que não existiria.
 */
export function AnexoLinha({
  nome,
  tipo,
  tamanho,
  enviadoEm,
  storagePath,
  urlDe,
  aoRemover,
}: {
  nome: string;
  tipo: string;
  tamanho: string;
  enviadoEm: string;
  storagePath: string;
  urlDe: (storagePath: string) => Promise<string>;
  /** Quando existe, mostra o X de remover (só faz sentido nos modos de edição). */
  aoRemover?: () => void;
}) {
  const { toast } = useToast();
  const ehImagem = tipo !== "PDF";
  const abrir = async () => {
    try {
      window.open(await urlDe(storagePath), "_blank", "noopener");
    } catch (e: unknown) {
      toast({
        title: "Não foi possível abrir o anexo",
        description: e instanceof Error && e.message ? e.message : nome,
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
        <p className="truncate text-sm font-medium">{nome}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {tipo} • {tamanho} • Enviado em {enviadoEm}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={abrir}
        aria-label={`Visualizar ${nome}`}
      >
        <Eye className="h-4 w-4" />
      </Button>
      {aoRemover && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 text-destructive"
          onClick={aoRemover}
          aria-label={`Remover ${nome}`}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * Área de arrastar-e-soltar dos arquivos que AINDA não subiram.
 *
 * Os arquivos ficam como File em memória e só vão para o bucket no
 * salvamento — anexar e desistir do modal não deixa lixo no storage.
 *
 * `maxKb` é informativo aqui: quem recusa o arquivo grande é quem chama
 * (e, na última instância, o file_size_limit do próprio bucket). O texto
 * existe para a pessoa não esperar o upload inteiro para descobrir o limite.
 */
export function Dropzone({
  label,
  arquivos,
  onAdicionar,
  onRemover,
  obrigatorio = true,
  maxKb = 10 * 1024,
}: {
  label: string;
  arquivos: File[];
  onAdicionar: (files: FileList) => void;
  onRemover: (nome: string) => void;
  obrigatorio?: boolean;
  maxKb?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);
  const limite = maxKb >= 1024 ? `${Math.round(maxKb / 1024)} MB` : `${maxKb} KB`;
  return (
    <div className="space-y-2">
      <Label className="text-xs font-medium text-muted-foreground">
        {label}
        {obrigatorio && <span className="ml-0.5 text-destructive">*</span>}
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
          sobre
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/40",
        )}
      >
        <Upload className="h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-primary">
            Arraste arquivos aqui ou clique para adicionar documentos
          </p>
          <p className="text-[11px] text-muted-foreground">
            Formatos aceitos: PDF, JPG, PNG (máx. {limite} por arquivo)
          </p>
        </div>
        {obrigatorio && (
          <Badge variant="outline" className="shrink-0 text-[10px]">
            Obrigatório
          </Badge>
        )}
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
 * "Visualizada por Fulano em dd/mm/aaaa - hh:mm", no pé da diária.
 *
 * Uma linha por pessoa, com a PRIMEIRA vez que ela abriu — quem leu, e desde
 * quando. Da mais recente para a mais antiga, porque a pergunta de quem olha
 * é "isso já chegou em alguém?", não "quem foi o primeiro".
 *
 * Mostra cinco e esconde o resto atrás de um "+N": em diária que circulou
 * pelo Operacional e pelo Financeiro inteiros, a lista completa empurraria o
 * rodapé de ações para fora da tela — e ela é rodapé, não conteúdo.
 */
export function VisualizacoesDiaria({ lista }: { lista: VisualizacaoDiaria[] }) {
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
