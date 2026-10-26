// =====================================================================
// EFETIVIDADE MENSAL › QUEM FALTOU — a janela do clique no número de
// faltas (26/10/2026). Pedido do Pablo: "preciso conseguir clicar aqui e
// saber quem são as pessoas que estão com as faltas, tá puxando falta DEMAIS
// pros postos, não sei se tá certo".
//
// Por pessoa: os dias de falta e o mês inteiro numa faixa, um quadradinho por
// dia (presente / falta / folga / afastado…). O mouse em cima mostra as
// marcações daquele dia do calendário: falta é dia de trabalho da escala SEM
// NENHUMA marcação (regra 7 de src/lib/efetividade.ts). Junto vão a escala, a
// situação na Senior e a última marcação — é onde aparece o "falta demais"
// que não é falta (férias que não estão na Senior, escala errada, ponto que
// não chega desse relógio).
// =====================================================================
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtDataBR, ROTULO_SITUACAO, type DiaEfet, type SituacaoEfet } from "@/lib/efetividade";
import { faltososDe, horaDaBatida, type ApuracaoColab } from "@/lib/efetividadeMensal";

const COR_DIA: Record<SituacaoEfet, string> = {
  presente: "bg-emerald-500", falta: "bg-red-500", atestado: "bg-amber-400", afastamento: "bg-violet-400", ferias: "bg-sky-400",
  folga: "bg-slate-200 dark:bg-slate-700", feriado: "bg-slate-300 dark:bg-slate-600", aguardando: "bg-slate-100 border border-dashed border-slate-400",
  sem_registro: "bg-slate-400", fora_contrato: "bg-transparent",
};
const LEGENDA: SituacaoEfet[] = ["presente", "falta", "atestado", "afastamento", "ferias", "folga", "sem_registro"];

function dica(d: DiaEfet, bruto: number[] | undefined): string {
  const marc = d.batidas.length ? d.batidas : bruto ?? [];
  return `${fmtDataBR(d.data)} · ${ROTULO_SITUACAO[d.situacao]}\n${marc.length ? `Marcações: ${marc.map(horaDaBatida).join(", ")}` : "Nenhuma marcação no dia"}`;
}

export function QuemFaltou({ aberto, onFechar, titulo, itens, fim }: {
  aberto: boolean; onFechar: () => void; titulo: string; itens: ApuracaoColab[]; fim: string;
}) {
  const lista = useMemo(() => (aberto ? faltososDe(itens, fim) : []), [aberto, itens, fim]);
  const total = lista.reduce((s, f) => s + f.a.faltasEm.length, 0);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-base">Quem faltou — {titulo}</DialogTitle>
          <DialogDescription>
            {total.toLocaleString("pt-BR")} falta{total === 1 ? "" : "s"} de {lista.length} pessoa{lista.length === 1 ? "" : "s"}.
            Falta = dia de trabalho da escala sem nenhuma marcação no dia. Passe o mouse num dia para ver as marcações.
          </DialogDescription>
          <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
            {LEGENDA.map((s) => (
              <span key={s} className="inline-flex items-center gap-1"><i className={cn("inline-block h-2.5 w-2.5 rounded-sm", COR_DIA[s])} />{ROTULO_SITUACAO[s]}</span>
            ))}
          </div>
        </DialogHeader>

        <div className="max-h-[calc(88vh-150px)] overflow-y-auto">
          {lista.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">Ninguém com falta neste recorte.</p>}
          {lista.map(({ a, ultimaMarcacao }) => {
            const c = a.p.c;
            return (
              <div key={c.id} className="border-b px-5 py-3 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{c.nome}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {c.cadastro ?? "—"} · {c.cargo ?? "—"} · {c.posto_nome}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Escala: <b className="font-medium text-foreground">{c.escala?.descricao || "não informada"}</b>
                      {" · "}Senior: <b className="font-medium text-foreground">{c.situacao || "—"}</b>
                      {c.data_afastamento && c.situacao !== "Trabalhando" ? ` desde ${fmtDataBR(c.data_afastamento)}` : ""}
                      {" · "}Última marcação: <b className={cn("font-medium", ultimaMarcacao ? "text-foreground" : "text-destructive")}>
                        {ultimaMarcacao ? fmtDataBR(ultimaMarcacao) : "nenhuma"}</b>
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                    {a.faltasEm.length} falta{a.faltasEm.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* O mês dia a dia */}
                <div className="mt-2 flex flex-wrap gap-[3px]">
                  {a.dias.map((d) => (
                    <span key={d.data} title={dica(d, a.p.brutoPorDia.get(d.data))}
                      className={cn("flex h-5 w-5 items-center justify-center rounded-[3px] text-[9px] font-semibold tabular-nums",
                        COR_DIA[d.situacao], d.situacao === "presente" || d.situacao === "falta" || d.situacao === "sem_registro" ? "text-white" : "text-slate-700")}>
                      {+d.data.slice(8, 10)}
                    </span>
                  ))}
                </div>

                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Dias de falta: <span className="font-medium text-red-700 dark:text-red-400">{a.faltasEm.map((d) => fmtDataBR(d).slice(0, 5)).join(", ")}</span>
                </p>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
