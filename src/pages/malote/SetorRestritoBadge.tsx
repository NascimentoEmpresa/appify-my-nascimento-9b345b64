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
export function SetorRestritoBadge({ setor }: { setor: string | null | undefined }) {
  if (setor?.trim().toUpperCase() !== SETOR_ORCAMENTO_RESTRITO) return null;
  return (
    <Badge variant="outline" className="gap-1 border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
      <Lock className="h-3 w-3" /> {setor.trim()}
    </Badge>
  );
}
