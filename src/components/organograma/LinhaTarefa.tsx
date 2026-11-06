import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ExternalLink, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useResolverTarefa } from "@/hooks/useTarefasFuncao";
import { diasDeAtraso, fmtData, resolvidaComAtraso, rotuloPeriodicidade, situacaoDaTarefa, type TarefaItem } from "@/lib/organograma/tarefas";
import { cn } from "@/lib/utils";

/** Uma tarefa do checklist. Com `podeResolver`, marca como feita ou "não se aplica". */
export function LinhaTarefa({ t, hoje, podeResolver = true, mostrarDono = false }: { t: TarefaItem; hoje: string; podeResolver?: boolean; mostrarDono?: boolean }) {
  const resolver = useResolverTarefa();
  const [aberto, setAberto] = useState<"concluir" | "nao_aplica" | null>(null);
  const [obs, setObs] = useState("");
  const situacao = situacaoDaTarefa(t, hoje);
  const enviar = (status: TarefaItem["status"]) =>
    resolver.mutateAsync({ id: t.id, status, obs }).then(() => { setAberto(null); setObs(""); }, (e) => toast.error((e as Error).message));

  return (
    <li className={cn("rounded-md border p-3", situacao === "vencida" && "border-red-300 bg-red-50/60", situacao === "hoje" && "border-amber-300 bg-amber-50/60")}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", situacao === "resolvida" && "text-muted-foreground line-through")}>{t.titulo}</p>
          <p className="text-xs text-muted-foreground">
            {[mostrarDono && t.responsavel_nome, rotuloPeriodicidade(t.periodicidade), t.setor, t.processo && `Processo: ${t.processo}`].filter(Boolean).join(" · ")}
          </p>
          {t.descricao && <p className="mt-1 whitespace-pre-wrap text-sm">{t.descricao}</p>}
          {t.observacao && <p className="mt-1 text-sm text-muted-foreground">Observação: {t.observacao}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {situacao === "vencida" && <Badge className="bg-red-600">Vencida há {diasDeAtraso(t.vencimento, hoje)} dia(s)</Badge>}
          {situacao === "hoje" && <Badge className="bg-amber-500 text-amber-950">Vence hoje</Badge>}
          {situacao === "proxima" && <Badge variant="outline">Vence em {fmtData(t.vencimento)}</Badge>}
          {t.status === "concluida" && <Badge variant="outline" className={resolvidaComAtraso(t) ? "border-amber-400 text-amber-800" : "border-emerald-400 text-emerald-800"}>{resolvidaComAtraso(t) ? "Concluída com atraso" : "Concluída"}</Badge>}
          {t.status === "nao_aplicavel" && <Badge variant="outline">Não se aplica</Badge>}
          {t.link && <Button asChild size="sm" variant="outline"><Link to={t.link}><ExternalLink className="mr-1 h-3.5 w-3.5" /> Abrir</Link></Button>}
          {podeResolver && situacao !== "resolvida" && !aberto && (
            <>
              <Button size="sm" onClick={() => setAberto("concluir")}><Check className="mr-1 h-3.5 w-3.5" /> Concluir</Button>
              <Button size="sm" variant="ghost" onClick={() => setAberto("nao_aplica")}>Não se aplica</Button>
            </>
          )}
          {podeResolver && situacao === "resolvida" && (
            <Button size="sm" variant="ghost" disabled={resolver.isPending} onClick={() => enviar("pendente")}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Reabrir</Button>
          )}
        </div>
      </div>
      {aberto && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input className="min-w-48 flex-1 bg-white" aria-label={aberto === "concluir" ? "Observação" : "Motivo"} autoFocus value={obs} onChange={(e) => setObs(e.target.value)}
            placeholder={aberto === "concluir" ? "Observação (opcional)" : "Por que não se aplica? (obrigatório)"} />
          <Button size="sm" disabled={resolver.isPending} onClick={() => enviar(aberto === "concluir" ? "concluida" : "nao_aplicavel")}>
            {resolver.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />} Confirmar
          </Button>
          <Button size="sm" variant="ghost" aria-label="Voltar" onClick={() => { setAberto(null); setObs(""); }}><X className="h-3.5 w-3.5" /></Button>
        </div>
      )}
    </li>
  );
}
