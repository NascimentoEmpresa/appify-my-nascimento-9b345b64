import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { EntradaOsc, ResultadoOsc, SituacaoMes } from "@/lib/oscFinanceiro";
import { NOME_MES_LONGO, SEM_RUBRICA } from "@/lib/oscFinanceiro";
import type {
  OscAno, OscCompetencia, OscDePara, OscLancamento, OscPagamentoMalote, OscParceria, OscPrevisao,
  OscPrevisaoMes, OscProjeto, OscRubrica,
} from "@/hooks/useOscCanaa";

// SIS-2026-0922 — peças comuns às abas da tela OSC Canaã.

export interface DadosOsc {
  ano: OscAno | null;
  rubricas: OscRubrica[];
  depara: OscDePara[];
  competencias: OscCompetencia[];
  previsoes: OscPrevisao[];
  previsoesMes: OscPrevisaoMes[];
  lancamentos: OscLancamento[];
  projetos: OscProjeto[];
}

export interface PermsOsc {
  incluir: boolean;
  alterar: boolean;
  excluir: boolean;
  aprovar: boolean;
  exportar: boolean;
}

export interface CtxOsc {
  parceria: OscParceria;
  ano: number;
  dados: DadosOsc;
  pagamentos: OscPagamentoMalote[];
  entrada: EntradaOsc;
  resultado: ResultadoOsc;
  perms: PermsOsc;
}

export const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const brlCurto = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1000) return `${v < 0 ? "−" : ""}R$ ${(a / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return brl(v);
};
export const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const dataBR = (d: string | null | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "—");
export const mesAno = (comp: string | null | undefined) =>
  comp ? `${NOME_MES_LONGO[Number(comp.slice(5, 7)) - 1]}/${comp.slice(0, 4)}` : "—";
export const erroMsg = (e: unknown) => (e as { message?: string })?.message ?? "Erro inesperado.";
export const corValor = (v: number) => (v < 0 ? "text-red-600 dark:text-red-400" : "");

export const GRUPO_LABEL: Record<string, string> = {
  pessoal: "Pessoal",
  encargos: "Encargos",
  ocupacao: "Ocupação",
  consumo: "Consumo",
  servicos: "Serviços",
  materiais: "Materiais",
  tarifas: "Tarifas",
  impostos: "Impostos e taxas",
  outros: "Outros",
  reserva: "Reserva (férias/13º)",
};

export const CRITERIO_LABEL: Record<string, string> = {
  manual: "Valor fixo",
  ultimo_realizado: "Último mês fechado",
  media_realizado: "Média dos meses fechados",
};

export const STATUS_PROJETO_LABEL: Record<string, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  executado: "Executado",
  cancelado: "Cancelado",
};
export const STATUS_PROJETO_CLASSE: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900",
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900",
  executado: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900",
  cancelado: "bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700",
};

const SITUACAO: Record<SituacaoMes, { label: string; classe: string }> = {
  fechada: { label: "Fechado", classe: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900" },
  em_aberto: { label: "Em aberto", classe: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900" },
  prevista: { label: "Previsto", classe: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900" },
};
export function SituacaoBadge({ situacao }: { situacao: SituacaoMes }) {
  return <Badge variant="outline" className={cn("whitespace-nowrap border", SITUACAO[situacao].classe)}>{SITUACAO[situacao].label}</Badge>;
}
export const SITUACAO_LABEL = (s: SituacaoMes) => SITUACAO[s].label;

export function nomeRubrica(ctx: Pick<CtxOsc, "dados">, id: string | null | undefined) {
  if (!id || id === SEM_RUBRICA) return "Sem rubrica";
  return ctx.dados.rubricas.find((r) => r.id === id)?.nome ?? "—";
}

export const LINK_DESPESA_MALOTE = (despesaId: string) => `/app/malote/despesa/${despesaId}`;
