import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { History } from "lucide-react";
import { useHistoricoDebitoAutomatico, DebitoAutomaticoLinha, TipoEventoDebito } from "@/hooks/useDebitoAutomatico";

const EVENTO_LABEL: Record<TipoEventoDebito, string> = {
  criacao: "Criado",
  edicao: "Editado",
  pagamento: "Marcado como pago",
  exclusao: "Excluído",
};

const EVENTO_COR: Record<TipoEventoDebito, string> = {
  criacao: "bg-sky-500",
  edicao: "bg-amber-500",
  pagamento: "bg-emerald-500",
  exclusao: "bg-red-500",
};

// SIS-2026-0256: item "pago" continua editável (decisão do Iury) — este
// histórico é o rastro de toda alteração, mesmo padrão de eventos do Malote.
export function HistoricoDebitoDialog({ open, onClose, registro }: { open: boolean; onClose: () => void; registro: DebitoAutomaticoLinha | null }) {
  const { data: eventos = [], isLoading } = useHistoricoDebitoAutomatico(registro?.id ?? null);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Histórico — {registro?.numero}</DialogTitle>
          <DialogDescription>{registro?.descricao}</DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>}
        {!isLoading && eventos.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Nenhum evento registrado.</p>}

        <div className="space-y-3">
          {eventos.map((ev) => (
            <div key={ev.id} className="flex gap-3">
              <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${EVENTO_COR[ev.tipo_evento]}`} />
              <div className="flex-1 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{EVENTO_LABEL[ev.tipo_evento]}</p>
                  <p className="text-[11px] text-muted-foreground">{new Date(ev.created_at).toLocaleString("pt-BR")}</p>
                </div>
                {ev.descricao && <p className="text-xs text-muted-foreground">{ev.descricao}</p>}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
