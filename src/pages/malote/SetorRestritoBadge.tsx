import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SETOR_ORCAMENTO_RESTRITO } from "./orcamentoUtils";

// SIS-2026-0265 (Iury, complemento): "algo informando que financeiro está
// visualizando" — sinaliza, pra quem tem acesso, que aquela linha é
// restrita ao Financeiro (ver classificacaoVisivelPorSetor em
// orcamentoUtils.ts). setor_responsavel está preenchido em praticamente
// TODA Classificação Malote (Suprimentos, RH, Jurídico...) — é categorização,
// não exclusividade; mostrar o badge pra qualquer valor virou ruído em toda
// linha (achado real, 31/08). Só renderiza quando bate com o setor
// efetivamente restrito.
// SIS-2026-0335: setor_responsavel virou lista — o badge aparece se
// Financeiro estiver ENTRE os setores da Classificação, não só quando for
// o único (mesmo critério de classificacaoVisivelPorSetor).
export function SetorRestritoBadge({ setores }: { setores: string[] | null | undefined }) {
  const restrito = (setores ?? []).some((s) => s?.trim().toUpperCase() === SETOR_ORCAMENTO_RESTRITO);
  if (!restrito) return null;
  return (
    <Badge variant="outline" className="gap-1 border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
      <Lock className="h-3 w-3" /> {SETOR_ORCAMENTO_RESTRITO}
    </Badge>
  );
}
