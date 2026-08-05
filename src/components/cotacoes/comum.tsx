import { useState } from "react";
import { cn } from "@/lib/utils";
import { Clock, Eye, CheckCircle2, Paperclip, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { urlAssinada, type CotacaoLicitacao, type CotacaoStatus } from "@/hooks/useCotacoesLicitacao";

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

/**
 * Anexo do canal. O bucket é privado, então não há URL fixa para pendurar num
 * href: o link é assinado na hora do clique e vale uma hora.
 */
export function LinkArquivo({
  caminho, nome, tom = "neutro",
}: {
  caminho: string | null;
  nome: string | null;
  tom?: "neutro" | "resposta";
}) {
  const [baixando, setBaixando] = useState(false);
  if (!caminho) return null;

  async function abrir() {
    setBaixando(true);
    try {
      const url = await urlAssinada(caminho);
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
    <button
      type="button"
      onClick={abrir}
      disabled={baixando}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors disabled:opacity-60",
        tom === "resposta"
          ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
          : "border-border bg-muted/50 text-foreground hover:bg-muted",
      )}
    >
      <Paperclip className="h-3.5 w-3.5 opacity-70" />
      {nome ?? "Arquivo"}
      {baixando
        ? <Loader2 className="h-3 w-3 animate-spin" />
        : <Download className="h-3 w-3 opacity-70" />}
    </button>
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

/** Aceitos no canal (§7.2). Usado no `accept` e na validação antes do upload. */
export const EXTENSOES_ACEITAS = ".pdf,.xlsx,.xls,.doc,.docx,.zip";
export const TAMANHO_MAXIMO = 10 * 1024 * 1024;

/** Devolve a mensagem de recusa, ou null se o arquivo serve. */
export function recusaArquivo(f: File | null): string | null {
  if (!f) return null;
  if (f.size > TAMANHO_MAXIMO) {
    return `O arquivo tem ${(f.size / 1024 / 1024).toFixed(1)} MB. O limite é 10 MB.`;
  }
  const ext = "." + (f.name.split(".").pop() ?? "").toLowerCase();
  if (!EXTENSOES_ACEITAS.split(",").includes(ext)) {
    return `Formato ${ext} não aceito. Envie PDF, Excel, Word ou ZIP.`;
  }
  return null;
}
