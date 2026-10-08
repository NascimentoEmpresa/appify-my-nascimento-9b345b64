import { useMemo } from "react";
import { AlertTriangle, CalendarDays, Clock, ExternalLink, UserX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDuracao, horariosDoPonto, horasTrabalhadas } from "@/lib/diariaPonto";
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

export function DiariasPontoDialog({ aberto, onFechar, solicitacoes, batidas, sincronizadoAte, onAbrir }: {
  aberto: boolean;
  onFechar: () => void;
  solicitacoes: SolicitacaoDiaria[];
  /** uuid da solicitação → data → minutos batidos */
  batidas: Map<string, Map<string, number[]>>;
  sincronizadoAte: string | null | undefined;
  onAbrir: (s: SolicitacaoDiaria) => void;
}) {
  const lista = useMemo(() => solicitacoes
    .filter((s) => batidas.has(s.uuid))
    .sort((a, b) => Number(pendente(b)) - Number(pendente(a)) || b.id.localeCompare(a.id)), [solicitacoes, batidas]);
  const totalDias = lista.reduce((n, s) => n + (batidas.get(s.uuid)?.size ?? 0), 0);
  const valorEmRisco = lista.reduce((v, s) => v + s.diarias.filter((l) => batidas.get(s.uuid)?.has(l.data)).reduce((a, l) => a + valorTotalLinha(l), 0), 0);

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserX className="h-5 w-5 text-destructive" /> Faltante bateu ponto no dia da diária</DialogTitle>
          <DialogDescription>
            {lista.length} solicitação(ões), {totalDias} dia(s) em que o faltante trabalhou e mesmo assim foi pedida diária no lugar dele ·
            {" "}R$ {fmtBRL(valorEmRisco)} nesses dias · relógio sincronizado até {sincronizadoAte ? new Date(`${sincronizadoAte}T12:00:00`).toLocaleDateString("pt-BR") : "—"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {lista.map((s) => {
            const st = statusExibicaoDiaria(s);
            const dias = batidas.get(s.uuid)!;
            return (
              <div key={s.uuid} className={cn("rounded-lg border p-4", pendente(s) ? "border-destructive/50 bg-destructive/5" : "border-border")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{s.id}</span>
                  <Badge variant="outline" className={cn("text-[10px]", st.cls)}>{st.label}</Badge>
                  {pendente(s) && <Badge variant="destructive" className="gap-1 text-[10px]"><AlertTriangle className="h-3 w-3" /> não pode ser aprovada</Badge>}
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
                    <th className="py-1.5 pr-2">Dia da diária</th><th className="py-1.5 pr-2">Turno pago</th><th className="py-1.5 pr-2 text-right">Valor</th>
                    <th className="py-1.5 pr-2">Batidas do faltante no relógio</th><th className="py-1.5 text-right">Trabalhou</th>
                  </tr></thead>
                  <tbody>
                    {[...s.diarias].sort((a, b) => a.data.localeCompare(b.data)).map((l) => {
                      const mins = dias.get(l.data);
                      const h = mins ? horasTrabalhadas(mins) : null;
                      return (
                        <tr key={l.id} className={cn("border-b border-border/50 align-top", mins && "bg-destructive/5")}>
                          <td className="py-1.5 pr-2 font-medium"><CalendarDays className="mr-1 inline h-3 w-3 text-muted-foreground" />{dataLonga(l.data)}</td>
                          <td className="py-1.5 pr-2">{labelTurno(l.turno)}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">R$ {fmtBRL(valorTotalLinha(l))}</td>
                          <td className="py-1.5 pr-2">
                            {mins ? (
                              <div className="flex flex-wrap gap-1">
                                {horariosDoPonto(mins).map((t, i) => (
                                  <span key={i} className={cn("rounded border px-1.5 py-0.5 font-mono text-[11px]", i % 2 === 0 ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive")}
                                    title={i % 2 === 0 ? "entrada" : "saída"}>
                                    {i % 2 === 0 ? "▶" : "■"} {t}
                                  </span>
                                ))}
                              </div>
                            ) : <span className="text-muted-foreground">sem batida neste dia</span>}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {h ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-destructive">
                                <Clock className="h-3 w-3" /> {fmtDuracao(h.minutos)}{h.incompleto && <span className="font-normal text-warning" title="número ímpar de batidas: faltou bater uma entrada ou saída">*</span>}
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
          {!lista.length && <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma solicitação com batida do faltante no dia da diária.</p>}
        </div>
        <p className="text-[11px] text-muted-foreground">
          ▶ entrada · ■ saída (alternadas na ordem em que o relógio registrou). "(+1d)" = batida depois da meia-noite, da mesma jornada.
          * = número ímpar de batidas (faltou uma entrada ou saída), as horas contam só os pares completos.
        </p>
      </DialogContent>
    </Dialog>
  );
}
