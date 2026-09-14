import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useHistoricoCompetenciaSolicitacaoAjuste, useItensSolicitacaoAjuste } from "@/hooks/useSolicitacaoAjuste";

// SIS-2026-0305: lista as solicitações arquivadas (reaberturas anteriores)
// do mesmo contrato+competência — espelha aju_historico_comp (main.py:3053-3078).

interface Props {
  contratoId: string | null;
  competencia: string | null;
  contratoNome?: string;
  onOpenChange: (open: boolean) => void;
}

function LinhaHistorico({ solicitacaoId, iteracao }: { solicitacaoId: string; iteracao: number }) {
  const { data: itens = [] } = useItensSolicitacaoAjuste(solicitacaoId);
  return (
    <div className="rounded border p-3">
      <Badge variant="secondary" className="mb-2">{iteracao}ª abertura</Badge>
      <ul className="space-y-1 text-sm">
        {itens.map((item) => (
          <li key={item.id} className="flex items-center justify-between">
            <span>{item.numero_item}. {item.descricao}</span>
            <span className="text-xs text-muted-foreground">{item.data_resposta ? `respondido em ${item.data_resposta}` : "sem resposta"}</span>
          </li>
        ))}
        {itens.length === 0 && <li className="text-xs text-muted-foreground">Sem itens.</li>}
      </ul>
    </div>
  );
}

export function HistoricoCompetenciaModal({ contratoId, competencia, contratoNome, onOpenChange }: Props) {
  const { data: solicitacoes = [] } = useHistoricoCompetenciaSolicitacaoAjuste(contratoId, competencia);
  return (
    <Dialog open={!!contratoId && !!competencia} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico da competência {competencia?.slice(0, 7)}{contratoNome ? ` — ${contratoNome}` : ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {solicitacoes.map((sol) => <LinhaHistorico key={sol.id} solicitacaoId={sol.id} iteracao={sol.iteracao} />)}
          {solicitacoes.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma reabertura anterior.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
