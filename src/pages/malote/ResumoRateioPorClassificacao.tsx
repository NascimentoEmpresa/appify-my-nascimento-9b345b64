import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import type { RateioLinha } from "@/hooks/useMaloteDespesa";
import { diferencaDoRateio, mostrarResumoPorClassificacao, totaisPorClassificacao } from "./rateioPorClassificacao";

// SIS-2026-0900: total do rateio por classificação (e por empresa dentro dela), logo abaixo da tabela do Rateio. Pensado para a despesa
// única que mistura classificações (ex.: boleto de FGTS + consignado): quem aprova e quem paga confere o valor de cada uma sem somar na mão.
const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ResumoRateioPorClassificacao({
  linhas, classificacaoPadraoId, valorDespesa, empresas,
}: {
  linhas: RateioLinha[];
  /** Classificação da despesa: vale para a linha do rateio que não tem a sua. */
  classificacaoPadraoId: string | null;
  /** Valor da despesa inteira (a soma do rateio tem que fechar com ele). */
  valorDespesa: number;
  empresas: { id: string; nome: string }[];
}) {
  const { data: classificacoes = [] } = useClassificacoesOrcamentoAdmin();
  const resumo = useMemo(() => totaisPorClassificacao(linhas, classificacaoPadraoId), [linhas, classificacaoPadraoId]);
  const nomeClassificacao = useMemo(() => new Map(classificacoes.map((c) => [c.id, c.nome])), [classificacoes]);
  const nomeEmpresa = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);

  if (!mostrarResumoPorClassificacao(resumo)) return null;
  const dif = diferencaDoRateio(valorDespesa, resumo);

  return (
    <div className="rounded-lg border overflow-hidden" data-testid="resumo-rateio-classificacao">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Total do rateio por classificação</p>
      </div>
      <ul className="divide-y">
        {resumo.grupos.map((g) => (
          <li key={g.classificacaoId ?? "sem"} className="px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-medium" title={nomeClassificacao.get(g.classificacaoId ?? "") ?? ""}>
                {g.classificacaoId ? (nomeClassificacao.get(g.classificacaoId) ?? "Classificação") : "Sem classificação"}
              </p>
              <p className="shrink-0 text-sm font-bold">
                {fmt(g.valor)}
                {g.percentual !== null && <span className="ml-2 text-xs font-normal text-muted-foreground">{g.percentual.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</span>}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground">{g.linhas} {g.linhas === 1 ? "linha" : "linhas"} do rateio</p>
            {g.porEmpresa.length > 1 && (
              <ul className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
                {g.porEmpresa.map((e) => (
                  <li key={e.empresaId ?? "sem"} className="flex justify-between gap-2">
                    <span className="truncate text-muted-foreground" title={nomeEmpresa.get(e.empresaId ?? "") ?? ""}>{e.empresaId ? (nomeEmpresa.get(e.empresaId) ?? "Empresa") : "Sem empresa"}</span>
                    <span className="font-medium">{fmt(e.valor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className={cn("flex items-center justify-between gap-3 border-t px-3 py-2 text-sm", dif === 0 ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-amber-50 dark:bg-amber-950/20")}>
        <span className="flex items-center gap-1.5 font-semibold">
          {dif === 0 ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}
          Total rateado
        </span>
        <span className="text-right">
          <span className="font-bold">{fmt(resumo.total)}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {dif === 0 ? `fecha com o valor da despesa (${fmt(valorDespesa)})` : `${dif > 0 ? "faltam" : "sobram"} ${fmt(Math.abs(dif))} em relação ao valor da despesa (${fmt(valorDespesa)})`}
          </span>
        </span>
      </div>
    </div>
  );
}
