import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Clock, Eye, CheckCircle2, Paperclip, Download, Loader2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  urlAssinada, type AnexoCotacao, type CotacaoLicitacao, type CotacaoStatus,
} from "@/hooks/useCotacoesLicitacao";

/**
 * O que as duas telas de Cotação compartilham.
 *
 * O canal é um só (uma linha guardando ida e volta, REPLICAR-MODULO-COMPRAS.md
 * §7.1) visto de dois lugares: Licitação pede em /app/licitacoes/cotacoes,
 * Compras responde em /app/suprimentos/cotacoes. Se cada tela tivesse sua
 * própria paleta e seu próprio agrupamento, o primeiro ajuste de cor faria as
 * duas divergirem e o mesmo item apareceria diferente para cada setor.
 */

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export const STATUS_CONFIG: Record<CotacaoStatus, {
  label: string; icon: React.ElementType; bg: string; text: string;
  border: string; headerBg: string; headerText: string; accent: string;
}> = {
  pendente:    { label: "Pendente",    icon: Clock,        bg: "bg-red-500/15",     text: "text-red-600",     border: "border-red-400/40",     headerBg: "bg-red-500/10",     headerText: "text-red-700 dark:text-red-400",         accent: "border-l-red-500" },
  visualizado: { label: "Visualizado", icon: Eye,          bg: "bg-yellow-500/15",  text: "text-yellow-600",  border: "border-yellow-400/40",  headerBg: "bg-yellow-500/10",  headerText: "text-yellow-700 dark:text-yellow-400",   accent: "border-l-yellow-500" },
  respondido:  { label: "Respondido",  icon: CheckCircle2, bg: "bg-emerald-500/15", text: "text-emerald-600", border: "border-emerald-400/40", headerBg: "bg-emerald-500/10", headerText: "text-emerald-700 dark:text-emerald-400", accent: "border-l-emerald-500" },
};

export function StatusBadge({ status }: { status: CotacaoStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", cfg.bg, cfg.text, cfg.border)}>
      <Icon className="h-3 w-3" /> {cfg.label}
    </span>
  );
}

export function fmtDatetime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Iniciais para o avatar do card. */
export function iniciais(nome: string | null) {
  return (nome ?? "?").split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

/** "1,4 MB" — só para dar noção de peso na lista de anexos. */
export function fmtTamanho(bytes: number | null | undefined) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/**
 * Um anexo já gravado. O bucket é privado, então não há URL fixa para pendurar
 * num href: o link é assinado na hora do clique e vale uma hora.
 *
 * O nome aparece INTEIRO, quebrando linha se precisar. Nome de anexo de
 * licitação é longo por natureza ("Ata-REUNIÃO_DE_ALINHAMENTO_…") e cortar com
 * reticências esconde justamente a parte que distingue um arquivo do outro.
 */
export function LinkArquivo({
  anexo, tom = "neutro", onRemover,
}: {
  anexo: AnexoCotacao;
  tom?: "neutro" | "resposta";
  onRemover?: () => void;
}) {
  const [baixando, setBaixando] = useState(false);

  async function abrir() {
    setBaixando(true);
    try {
      const url = await urlAssinada(anexo.caminho, anexo.nome);
      if (!url) {
        toast.error("Não foi possível abrir o arquivo.", {
          description: "Ele pode ter sido removido do armazenamento.",
        });
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBaixando(false);
    }
  }

  return (
    <span className={cn(
      "inline-flex max-w-full items-start gap-1.5 rounded-md border px-2.5 py-1 text-xs",
      tom === "resposta"
        ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
        : "border-border bg-muted/50 text-foreground",
    )}>
      <button type="button" onClick={abrir} disabled={baixando}
              className="flex min-w-0 items-start gap-1.5 text-left hover:underline disabled:opacity-60">
        <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="break-all">{anexo.nome}</span>
        {anexo.tamanho != null && (
          <span className="shrink-0 opacity-60">({fmtTamanho(anexo.tamanho)})</span>
        )}
        {baixando
          ? <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
          : <Download className="mt-0.5 h-3 w-3 shrink-0 opacity-70" />}
      </button>
      {onRemover && (
        <button type="button" onClick={onRemover} title="Remover anexo"
                className="mt-0.5 shrink-0 opacity-60 hover:opacity-100">
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/** Todos os anexos de um lado, um por linha. */
export function ListaAnexos({
  anexos, tom = "neutro", onRemover,
}: {
  anexos: AnexoCotacao[];
  tom?: "neutro" | "resposta";
  onRemover?: (a: AnexoCotacao) => void;
}) {
  if (!anexos.length) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      {anexos.map((a) => (
        <LinkArquivo key={a.id} anexo={a} tom={tom}
                     onRemover={onRemover ? () => onRemover(a) : undefined} />
      ))}
    </div>
  );
}

/**
 * Escolha de arquivos antes do envio: aceita vários, acumula entre cliques
 * (escolher de novo ACRESCENTA em vez de substituir) e deixa tirar um a um.
 */
export function SeletorArquivos({
  arquivos, onChange, label = "Anexar arquivos",
}: {
  arquivos: File[];
  onChange: (f: File[]) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function adicionar(lista: FileList | null) {
    if (!lista) return;
    const aceitos: File[] = [];
    for (const f of Array.from(lista)) {
      const recusa = recusaArquivo(f);
      if (recusa) { toast.error(`"${f.name}" não foi anexado`, { description: recusa }); continue; }
      if (arquivos.some((a) => a.name === f.name && a.size === f.size)) continue;
      aceitos.push(f);
    }
    if (aceitos.length) onChange([...arquivos, ...aceitos]);
    if (inputRef.current) inputRef.current.value = "";  // permite reescolher o mesmo arquivo
  }

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" multiple className="hidden"
             onChange={(e) => adicionar(e.target.files)} />
      <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
              onClick={() => inputRef.current?.click()}>
        {arquivos.length ? <Plus className="mr-1.5 h-3.5 w-3.5" /> : <Paperclip className="mr-1.5 h-3.5 w-3.5" />}
        {arquivos.length ? "Adicionar mais" : label}
      </Button>

      {arquivos.length > 0 && (
        <ul className="space-y-1">
          {arquivos.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`}
                className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs">
              <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-60" />
              {/* nome inteiro, quebrando linha — nunca truncado */}
              <span className="min-w-0 flex-1 break-all">{f.name}</span>
              <span className="shrink-0 opacity-60">{fmtTamanho(f.size)}</span>
              <button type="button" title="Tirar da lista"
                      onClick={() => onChange(arquivos.filter((_, j) => j !== i))}
                      className="shrink-0 opacity-60 hover:opacity-100">
                <X className="mt-0.5 h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface GrupoAno {
  year: number;
  total: number;
  months: { month: number; items: CotacaoLicitacao[] }[];
}

/** Acordeão ano → mês do §7.4, com os dois níveis em ordem decrescente. */
export function agruparPorAnoMes(cotacoes: CotacaoLicitacao[]): GrupoAno[] {
  const byYear = new Map<number, Map<number, CotacaoLicitacao[]>>();
  for (const c of cotacoes) {
    const d = new Date(c.created_at);
    const year = d.getFullYear();
    const month = d.getMonth();
    if (!byYear.has(year)) byYear.set(year, new Map());
    const byMonth = byYear.get(year)!;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(c);
  }
  return Array.from(byYear.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, months]) => ({
      year,
      total: Array.from(months.values()).reduce((s, arr) => s + arr.length, 0),
      months: Array.from(months.entries())
        .sort((a, b) => b[0] - a[0])
        .map(([month, items]) => ({ month, items })),
    }));
}

/** Chaves de expansão inicial: o ano e o mês correntes já abertos. */
export function aberturaInicial() {
  const agora = new Date();
  return {
    anos: new Set([agora.getFullYear()]),
    meses: new Set([`${agora.getFullYear()}-${agora.getMonth()}`]),
  };
}

/**
 * Teto de 10 MB por arquivo, imposto também pelo bucket — aqui é só para
 * avisar antes de o usuário esperar o upload inteiro e levar um erro cru.
 *
 * NÃO existe lista de extensões. O legado restringia a PDF/Excel/Word/ZIP
 * (§7.2), mas na prática chega .dwg, .png, .txt e outros, e barrar isso só
 * empurra o pessoal para o WhatsApp. O que protege contra .html/.svg com
 * script é o download forçado em `urlAssinada`, não uma allowlist.
 */
export const TAMANHO_MAXIMO = 10 * 1024 * 1024;

/** Devolve a mensagem de recusa, ou null se o arquivo serve. */
export function recusaArquivo(f: File | null): string | null {
  if (!f) return null;
  if (f.size === 0) return "O arquivo está vazio.";
  if (f.size > TAMANHO_MAXIMO) {
    return `Tem ${fmtTamanho(f.size)} e o limite é 10 MB por arquivo.`;
  }
  return null;
}
