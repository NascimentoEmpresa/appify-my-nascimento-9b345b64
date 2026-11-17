import { Badge } from "@/components/ui/badge";
import { DIAS_ALERTA, ROTULO_SITUACAO, emAlerta, situacaoExame, type ItemToxico, type SituacaoExame } from "@/lib/sst/exameToxicologico";
import { cn } from "@/lib/utils";

// Cores do pedido do SST: 30 dias = próximo (amarelo), 15 dias = alerta
// (laranja), vencido = pendência (vermelho).
const COR_SITUACAO: Record<SituacaoExame, string> = {
  em_dia: "bg-emerald-600 text-white hover:bg-emerald-600",
  proximo: "bg-amber-400 text-amber-950 hover:bg-amber-400",
  vencido: "bg-red-600 text-white hover:bg-red-600",
  aguardando: "bg-slate-200 text-slate-800 hover:bg-slate-200",
};
const COR_ALERTA = "bg-orange-500 text-white hover:bg-orange-500";

export function SeloSituacao({ item, hoje, className }: { item: Pick<ItemToxico, "data_validade">; hoje?: string; className?: string }) {
  const s = situacaoExame(item, hoje);
  const alerta = emAlerta(item, hoje);
  return (
    <Badge className={cn("whitespace-nowrap", alerta ? COR_ALERTA : COR_SITUACAO[s], className)}
      title={alerta ? `Vence em até ${DIAS_ALERTA} dias` : undefined}>
      {alerta ? `Alerta · ${ROTULO_SITUACAO[s]}` : ROTULO_SITUACAO[s]}
    </Badge>
  );
}
