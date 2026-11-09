import { useMemo } from "react";
import { AlertTriangle, ExternalLink, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { detalheEstado, type AlertaPontoLinha } from "@/lib/diariaPonto";
import { fmtBRL, labelTurno, statusExibicaoDiaria, valorTotalLinha, type SolicitacaoDiaria } from "./diarias";

// =====================================================================
// Diárias × relógio de ponto — o detalhe (mig 20261007000021).
//
// Pedido do Pablo (08/10/2026): "uma opção pra ver essas solicitações que
// têm as marcações e a diária, e mostrar as marcações, horários, dias".
// Para cada solicitação em que o faltante bateu ponto em algum dia da
// diária: os dias da diária lado a lado com as batidas do relógio
// (espelho."BiMarcacoes"), as horas trabalhadas e o turno pago ao diarista.
// =====================================================================

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const dataLonga = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString("pt-BR")} (${DIAS[d.getDay()]})`;
};
const pendente = (s: SolicitacaoDiaria) => s.status === "solicitada" || s.status === "em_ajuste";

export function DiariasPontoDialog({ aberto, onFechar, solicitacoes, alertas, sincronizadoAte, onAbrir }: {
  aberto: boolean;
  onFechar: () => void;
  solicitacoes: SolicitacaoDiaria[];
  /** uuid da solicitação → id da linha → resultado da comparação */
  alertas: Map<string, Map<string, AlertaPontoLinha>>;
  sincronizadoAte: string | null | undefined;
  onAbrir: (s: SolicitacaoDiaria) => void;
}) {
  const lista = useMemo(() => solicitacoes
    .filter((s) => alertas.has(s.uuid))
    .sort((a, b) => Number(pendente(b)) - Number(pendente(a)) || b.id.localeCompare(a.id)), [solicitacoes, alertas]);
  const totalDias = lista.reduce((n, s) => n + (alertas.get(s.uuid)?.size ?? 0), 0);
  const valorEmRisco = lista.reduce((v, s) => v + s.diarias.filter((l) => alertas.get(s.uuid)?.has(l.id)).reduce((a, l) => a + valorTotalLinha(l), 0), 0);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserX className="h-5 w-5 text-destructive" /> Conflitos de horários e pontos a conferir</DialogTitle>
          <DialogDescription>
            {lista.length} solicitação(ões), {totalDias} linha(s) com sobreposição ou dados insuficientes ·
            {" "}R$ {fmtBRL(valorEmRisco)} nessas linhas · relógio sincronizado até {sincronizadoAte ? new Date(`${sincronizadoAte}T12:00:00`).toLocaleDateString("pt-BR") : "—"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {lista.map((s) => {
            const st = statusExibicaoDiaria(s);
            const dias = alertas.get(s.uuid)!;
            return (
              <div key={s.uuid} className={cn("rounded-lg border p-4", pendente(s) ? "border-destructive/50 bg-destructive/5" : "border-border")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{s.id}</span>
                  <Badge variant="outline" className={cn("text-[10px]", st.cls)}>{st.label}</Badge>
                  {pendente(s) && <Badge variant="destructive" className="gap-1 text-[10px]"><AlertTriangle className="h-3 w-3" /> conferir antes de aprovar</Badge>}
                  <Button size="sm" variant="outline" className="ml-auto h-7 gap-1 text-xs" onClick={() => onAbrir(s)}>
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir solicitação
                  </Button>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  <p><span className="text-muted-foreground">Contrato:</span> {s.contratoNome}</p>
                  <p><span className="text-muted-foreground">Posto:</span> {s.posto}</p>
                  <p><span className="text-muted-foreground">Faltante:</span> <b>{s.faltanteNome}</b> · {s.faltanteCpf}</p>
                  <p><span className="text-muted-foreground">Diarista:</span> {s.diaristaNome}</p>
                  <p><span className="text-muted-foreground">Solicitante:</span> {s.solicitante}</p>
                  <p><span className="text-muted-foreground">Criada:</span> {s.criadoEm}</p>
                </div>

                <table className="mt-3 w-full text-xs">
                  <thead><tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 pr-2">Dia da diária</th><th className="py-1.5 pr-2">Turno e cobertura</th><th className="py-1.5 pr-2 text-right">Valor</th>
                    <th className="py-1.5 pr-2">Conferência dos intervalos</th><th className="py-1.5 text-right">Resultado</th>
                  </tr></thead>
                  <tbody>
                    {[...s.diarias].sort((a, b) => a.data.localeCompare(b.data)).map((l) => {
                      const alerta = dias.get(l.id);
                      return (
                        <tr key={l.id} className={cn("border-b border-border/50 align-top", alerta?.estado === "conflito" && "bg-destructive/5")}>
                          <td className="py-1.5 pr-2 font-medium">{dataLonga(l.data)}</td>
                          <td className="py-1.5 pr-2">{labelTurno(l.turno)}<br />{l.inicioCobertura ?? "—"}–{l.fimCobertura ?? "—"}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">R$ {fmtBRL(valorTotalLinha(l))}</td>
                          <td className="py-1.5 pr-2">{alerta ? detalheEstado(alerta) : "Sem alerta nesta cobertura"}</td>
                          <td className="py-1.5 text-right">{alerta ? (alerta.estado === "conflito" ? "Conflito" : "Conferir") : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
          {!lista.length && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma solicitação com conflito ou necessidade de conferência.</p>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          A comparação usa pares de entrada e saída por matrícula e jornada. Dados incompletos exigem conferência. "+1d" indica término no dia seguinte.
        </p>
      </DialogContent>
    </Dialog>
  );
}
