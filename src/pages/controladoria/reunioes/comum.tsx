import { Badge } from "@/components/ui/badge";
import type { StatusRegistro, SituacaoAcao } from "@/hooks/useReunioesEncarregados";
import type { TipoRegistro } from "@/lib/controladoria/reunioes";

// Peças comuns das abas de Reuniões com Encarregados (mig 20261006000005).

export const MENU_REUNIOES = "ctrl_reunioes_encarregados";

export const dataBR = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

/** "1050 - UFRGS - LIMPEZA" → "UFRGS - LIMPEZA" (o código da filial só polui). */
export const semCodigo = (c: string | null | undefined) => (c ?? "").replace(/^\s*\d+\s*-\s*/, "");

export function SeloTipo({ tipo }: { tipo: TipoRegistro }) {
  return tipo === "dificuldade"
    ? <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-[10px] text-indigo-700">Dificuldade</Badge>
    : <Badge variant="outline" className="border-orange-300 bg-orange-50 text-[10px] text-orange-700">Dúvida</Badge>;
}

export function SeloStatus({ status }: { status: StatusRegistro }) {
  const m: Record<StatusRegistro, [string, string]> = {
    pendente: ["A revisar", "border-amber-300 bg-amber-50 text-amber-700"],
    validado: ["Validado", "border-emerald-300 bg-emerald-50 text-emerald-700"],
    excluido: ["Excluído", "border-slate-300 bg-slate-50 text-slate-500"],
  };
  return <Badge variant="outline" className={`text-[10px] ${m[status][1]}`}>{m[status][0]}</Badge>;
}

export const ROTULO_SITUACAO: Record<SituacaoAcao, string> = { aberta: "Aberta", andamento: "Em andamento", concluida: "Concluída" };

export function SeloSituacao({ situacao, prazo }: { situacao: SituacaoAcao; prazo: string | null }) {
  const atrasada = situacao !== "concluida" && !!prazo && prazo < new Date().toISOString().slice(0, 10);
  const cor = situacao === "concluida" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : atrasada ? "border-rose-300 bg-rose-50 text-rose-700" : situacao === "andamento" ? "border-sky-300 bg-sky-50 text-sky-700" : "border-slate-300 bg-slate-50 text-slate-600";
  return <Badge variant="outline" className={`text-[10px] ${cor}`}>{atrasada ? "Atrasada" : ROTULO_SITUACAO[situacao]}</Badge>;
}
