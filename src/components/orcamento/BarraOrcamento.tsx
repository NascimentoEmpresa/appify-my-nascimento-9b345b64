import { cn } from "@/lib/utils";

/**
 * Barra de consumo do orçamento.
 *
 * Nasceu dentro de `malote/OrcamentoGeral.tsx` como `BarraUtilizado`. Foi
 * extraída para cá quando o Suprimentos passou a mostrar orçamento também:
 * duplicar significaria as duas telas divergirem no dia em que alguém mudar
 * uma faixa de cor, e um dirigente veria "amarelo" num lugar e "verde" no
 * outro para o mesmo percentual.
 *
 * As faixas são as originais do Malote, mantidas de propósito: acima de 100%
 * vermelho, de 80% em diante âmbar, abaixo disso verde.
 */
export function BarraOrcamento({
  orcado,
  usado,
  className,
}: {
  orcado: number;
  usado: number;
  className?: string;
}) {
  if (!orcado) return <span className="text-xs text-muted-foreground">—</span>;

  const pct = (usado / orcado) * 100;
  const cor = pct > 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className={cn("flex min-w-[120px] items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", cor)}
          // O preenchimento trava em 100% mas o número não: estourar o
          // orçamento precisa aparecer como "127,4%", não como barra cheia
          // igual a quem gastou exatamente o previsto.
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="w-16 text-right text-xs font-medium tabular-nums">{pct.toFixed(1)}%</span>
    </div>
  );
}

/**
 * Barra com duas faixas: o que já virou pagamento e o que está comprometido
 * por pedido emitido mas ainda não pagou.
 *
 * A separação é o ponto do chamado. Um único número esconderia justamente o
 * que o Cassio não enxergava — o dinheiro que já saiu da mão dele, foi para o
 * fornecedor, e ainda não apareceu no financeiro.
 */
export function BarraOrcamentoDupla({
  orcado,
  pago,
  comprometido,
}: {
  orcado: number;
  pago: number;
  comprometido: number;
}) {
  if (!orcado) return <span className="text-xs text-muted-foreground">—</span>;

  const pctPago = (pago / orcado) * 100;
  const pctComp = (comprometido / orcado) * 100;
  const total = pctPago + pctComp;
  const corTexto = total > 100 ? "text-red-600" : total >= 80 ? "text-amber-600" : "";

  return (
    <div className="flex min-w-[160px] items-center gap-2">
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-emerald-500"
          style={{ width: `${Math.min(pctPago, 100)}%` }}
          title={`Pago: ${pctPago.toFixed(1)}%`}
        />
        <div
          // Listrado, não sólido: comprometido ainda pode não virar despesa —
          // pedido é cancelável. A textura diz "isto é previsão", que um bloco
          // sólido ao lado do pago não diria.
          className="h-full bg-amber-500/70 bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,rgba(255,255,255,.45)_3px,rgba(255,255,255,.45)_6px)]"
          style={{ width: `${Math.min(pctComp, Math.max(100 - pctPago, 0))}%` }}
          title={`Comprometido: ${pctComp.toFixed(1)}%`}
        />
      </div>
      <span className={cn("w-16 text-right text-xs font-medium tabular-nums", corTexto)}>
        {total.toFixed(1)}%
      </span>
    </div>
  );
}
