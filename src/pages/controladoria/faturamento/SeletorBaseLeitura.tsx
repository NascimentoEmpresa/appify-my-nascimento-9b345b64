import { cn } from "@/lib/utils";
import { ROTULO_BASE, type BaseDespesa } from "./regras";

// SIS-2026-0721: escolha de como as DESPESAS do Fluxo de Caixa entram no mês, nas três telas da Controladoria (o valor é compartilhado:
// trocar numa troca nas outras). Faturamento, a receber e executável seguem a competência da nota/planilha.
const OPCOES: { valor: BaseDespesa; titulo: string; dica: string }[] = [
  { valor: "competencia", titulo: "Competência", dica: "A despesa conta no mês da competência do lançamento (sem competência, no mês do pagamento)." },
  { valor: "pagamento", titulo: "Data de pagamento", dica: "A despesa conta no mês em que foi paga (movimentação do Fluxo de Caixa)." },
];

export function SeletorBaseLeitura({ base, onChange }: { base: BaseDespesa; onChange: (b: BaseDespesa) => void }) {
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-0.5"
      title={`Despesas lidas pela ${ROTULO_BASE[base].toLowerCase()}. Vale para Faturamento da Empresa, Lucratividade de Contratos e Fechamento da Empresa.`}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Despesas por</span>
      <div className="inline-flex rounded bg-muted p-0.5">
        {OPCOES.map((o) => (
          <button
            key={o.valor}
            type="button"
            title={o.dica}
            onClick={() => onChange(o.valor)}
            className={cn(
              "rounded px-2 py-0.5 text-xs transition-colors",
              base === o.valor ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.titulo}
          </button>
        ))}
      </div>
    </div>
  );
}
