import { AlertTriangle, CheckCircle2, Clock, Fingerprint, HelpCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ROTULO_ESTADO, detalheEstado, fmtDataCurta, fmtDuracao, horasTrabalhadas, resumoPontoDiaria,
  type EstadoPonto, type PontoDiariaMalote,
} from "@/lib/diariaPonto";
import { labelTurno, type TurnoDiaria } from "@/pages/operacional/diarias";

// =====================================================================
// Malote — o ponto do faltante nas despesas de diária (14/10/2026,
// mig 20261014000001, SIS-2026-0626).
//
// Gustavo (Operacional) aprova as diárias no Malote e pediu "um campo que
// informe se o colaborador está com o ponto batido no dia", como o
// Controle de Diárias já mostra. Selo na lista de Aprovações e quadro no
// detalhe da despesa. Só aviso: não trava a aprovação.
// =====================================================================

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaSemana = (iso: string) => DIAS[new Date(`${iso}T12:00:00`).getDay()];

const COR: Record<EstadoPonto, string> = {
  trabalhou: "border-destructive/50 bg-destructive/10 text-destructive",
  sem_marcacao: "border-success/40 bg-success/10 text-success",
  parcial: "border-warning/40 bg-warning/10 text-warning",
  nao_sincronizado: "border-warning/40 bg-warning/10 text-warning",
  sem_vinculo: "border-border bg-muted text-muted-foreground",
  indisponivel: "border-border bg-muted text-muted-foreground",
};

/** Selo da linha em Malote › Aprovações. Sem diária ligada à despesa = nada. */
export function SeloPontoDiaria({ itens, sincronizadoAte }: { itens: PontoDiariaMalote[] | undefined; sincronizadoAte: string | null | undefined }) {
  if (!itens?.length) return null;
  const rs = itens.map((i) => resumoPontoDiaria(i, sincronizadoAte));
  const trabalhou = rs.reduce((n, r) => n + r.trabalhou, 0);
  const aConferir = rs.reduce((n, r) => n + r.aConferir, 0);
  const semVinculo = rs.every((r) => r.semVinculo);
  const datas = rs.flatMap((r) => r.dias.filter((d) => d.estado === "trabalhou").map((d) => `${fmtDataCurta(d.data)} ${d.horarios.join(" ")}`));

  if (trabalhou > 0) {
    return (
      <Badge variant="outline" className={cn("gap-1 text-[10px] font-semibold", COR.trabalhou)} title={`Faltante bateu ponto: ${datas.join(" · ")}`}>
        <AlertTriangle className="h-3 w-3" /> Bateu ponto ({trabalhou} dia{trabalhou > 1 ? "s" : ""})
      </Badge>
    );
  }
  if (semVinculo) {
    return <Badge variant="outline" className={cn("gap-1 text-[10px]", COR.sem_vinculo)} title="CPF do faltante sem matrícula no relógio"><HelpCircle className="h-3 w-3" /> Ponto: sem matrícula</Badge>;
  }
  if (aConferir > 0) {
    return <Badge variant="outline" className={cn("gap-1 text-[10px]", COR.parcial)} title={`Relógio sincronizado até ${sincronizadoAte ? fmtDataCurta(sincronizadoAte) : "—"}`}><Clock className="h-3 w-3" /> Ponto a conferir</Badge>;
  }
  return <Badge variant="outline" className={cn("gap-1 text-[10px]", COR.sem_marcacao)} title="Faltante sem batida em nenhum dia da diária"><CheckCircle2 className="h-3 w-3" /> Ponto: não bateu</Badge>;
}

/** Quadro do detalhe da despesa: cada dia da diária × o relógio de ponto do faltante. */
export function CardPontoDiaria({ itens, sincronizadoAte }: { itens: PontoDiariaMalote[] | undefined; sincronizadoAte: string | null | undefined }) {
  if (!itens?.length) return null;
  const rs = itens.map((i) => ({ item: i, r: resumoPontoDiaria(i, sincronizadoAte) }));
  const trabalhou = rs.reduce((n, x) => n + x.r.trabalhou, 0);
  return (
    <Card className={cn(trabalhou > 0 && "border-destructive/50 bg-destructive/5")}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Fingerprint className={cn("h-5 w-5", trabalhou > 0 ? "text-destructive" : "text-muted-foreground")} />
          <p className="text-sm font-semibold">Ponto do faltante nos dias da diária</p>
          {trabalhou > 0
            ? <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Bateu ponto em {trabalhou} dia{trabalhou > 1 ? "s" : ""}</Badge>
            : <Badge variant="outline" className="text-xs">Nenhuma batida nos dias da diária</Badge>}
          <span className="ml-auto text-xs text-muted-foreground">Relógio sincronizado até {sincronizadoAte ? fmtDataCurta(sincronizadoAte) : "—"}</span>
        </div>
        {trabalhou > 0 && (
          <p className="text-xs text-destructive">
            O colaborador que faltou bateu ponto em dia pago como diária. A aprovação continua liberada — confira com o encarregado antes de aprovar.
          </p>
        )}
        {rs.map(({ item, r }) => (
          <div key={item.solicitacao_id} className="rounded-md border">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/40 px-3 py-2 text-xs">
              <span className="font-mono font-semibold">{item.numero ?? "Diária"}</span>
              <span><b className="text-muted-foreground">Faltante:</b> {item.faltante_nome ?? "—"}</span>
              <span className="text-muted-foreground">{[item.contrato_nome, item.posto_nome].filter(Boolean).join(" · ")}</span>
              {r.semVinculo && <span className="text-muted-foreground">(sem matrícula no relógio — não dá para conferir)</span>}
            </div>
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr><th className="px-3 py-1.5 font-medium">Dia</th><th className="px-3 font-medium">Turno pago</th><th className="px-3 font-medium">Ponto do faltante</th><th className="px-3 font-medium">Batidas</th></tr>
              </thead>
              <tbody>
                {r.dias.map((d, k) => {
                  const h = horasTrabalhadas(d.minutos);
                  return (
                    <tr key={`${d.data}-${k}`} className="border-t align-top">
                      <td className="whitespace-nowrap px-3 py-1.5">{fmtDataCurta(d.data)} <span className="text-muted-foreground">({diaSemana(d.data)})</span></td>
                      <td className="px-3 py-1.5">{labelTurno(d.turno as TurnoDiaria)}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant="outline" className={cn("text-[10px]", COR[d.estado])} title={detalheEstado(d, sincronizadoAte)}>{ROTULO_ESTADO[d.estado]}</Badge>
                      </td>
                      <td className="px-3 py-1.5 tabular-nums">
                        {d.horarios.length ? <>{d.horarios.join(" · ")} <span className="text-muted-foreground">({fmtDuracao(h.minutos)}{h.incompleto ? ", batida ímpar" : ""})</span></> : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
