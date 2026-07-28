import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ETAPA_COR, descreverBloqueioResumo, motivoBloqueioLabel, nomeUsuario, salaResumo, type BloqueioAgenda, type ReuniaoCalendario, type Usuario } from "../types";

const DIAS_SEMANA = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

function iniciais(nome: string): string {
  return nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}

export function bloqueioDoDia(dia: Date, bloqueios: BloqueioAgenda[]): BloqueioAgenda | undefined {
  const diaStr = format(dia, "yyyy-MM-dd");
  return bloqueios.find((b) => diaStr >= b.data_inicio && diaStr <= b.data_fim);
}

export function CalendarioMes({
  mesAtual, onMudarMes, diaSelecionado, onSelecionarDia, reunioes, usuarios, bloqueios = [],
}: {
  mesAtual: Date;
  onMudarMes: (data: Date) => void;
  diaSelecionado: Date;
  onSelecionarDia: (data: Date) => void;
  reunioes: ReuniaoCalendario[];
  usuarios: Usuario[];
  /** Bloqueios de agenda a exibir (os próprios por padrão, ou de quem estiver filtrado) — motivo visível pra quem tem acesso à Agenda de Reunião. Pinta o dia de vermelho. */
  bloqueios?: BloqueioAgenda[];
}) {
  const navigate = useNavigate();

  const dias = useMemo(() => {
    const inicio = startOfWeek(startOfMonth(mesAtual));
    const fim = endOfWeek(endOfMonth(mesAtual));
    return eachDayOfInterval({ start: inicio, end: fim });
  }, [mesAtual]);

  const reunioesPorDia = (dia: Date) => reunioes.filter((r) => isSameDay(new Date(r.data_hora), dia));

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="grid grid-cols-7 border-b border-border bg-muted/40">
        {DIAS_SEMANA.map((d) => (
          <div key={d} className="p-2 text-center text-xs font-semibold text-muted-foreground">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {dias.map((dia) => {
          const doDia = reunioesPorDia(dia);
          const foraDoMes = !isSameMonth(dia, mesAtual);
          const selecionado = isSameDay(dia, diaSelecionado);
          const bloqueio = bloqueioDoDia(dia, bloqueios);
          return (
            <button
              key={dia.toISOString()}
              type="button"
              onClick={() => onSelecionarDia(dia)}
              className={cn(
                "flex min-h-28 flex-col items-stretch gap-1 border-b border-r border-border p-1.5 text-left align-top last:border-r-0",
                foraDoMes && "bg-muted/20 text-muted-foreground",
                bloqueio && "bg-destructive/10",
                selecionado && "bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span className={cn(
                  "self-start rounded-full px-1.5 text-xs",
                  isToday(dia) && "bg-primary font-bold text-primary-foreground",
                )}>
                  {format(dia, "d")}
                </span>
                {bloqueio && (
                  <span
                    className="truncate rounded border border-destructive/30 bg-destructive/10 px-1 py-0.5 text-[9px] font-medium text-destructive"
                    title={motivoBloqueioLabel(bloqueio)}
                  >
                    {descreverBloqueioResumo(bloqueio)}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1">
                {doDia.slice(0, 2).map((r) => {
                  const nome = nomeUsuario(usuarios, r.responsavel_preenchimento_user_id);
                  return (
                    <span
                      key={r.id}
                      role="link"
                      onClick={(e) => { e.stopPropagation(); navigate(`/app/central-servicos/reunioes/${r.id}`); }}
                      className={cn("rounded border px-1 py-0.5 text-[10px] leading-tight", ETAPA_COR[r.etapa])}
                      title={r.titulo}
                    >
                      <span className="block truncate font-medium">{format(new Date(r.data_hora), "HH:mm")} {r.titulo}</span>
                      {nome && (
                        <span className="mt-0.5 flex items-center gap-1 truncate opacity-80">
                          <Avatar className="h-3.5 w-3.5 shrink-0">
                            <AvatarFallback className="text-[6px]">{iniciais(nome)}</AvatarFallback>
                          </Avatar>
                          <span className="truncate">{nome} · {salaResumo(r)}</span>
                        </span>
                      )}
                    </span>
                  );
                })}
                {doDia.length > 2 && (
                  <span className="text-[10px] text-muted-foreground">+{doDia.length - 2}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-border p-2">
        <Button variant="ghost" size="sm" onClick={() => onMudarMes(addMonths(mesAtual, -1))}>Anterior</Button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium capitalize">{format(mesAtual, "MMMM 'de' yyyy", { locale: ptBR })}</span>
          <Button
            variant="outline" size="sm"
            onClick={() => { const hoje = new Date(); onMudarMes(hoje); onSelecionarDia(hoje); }}
          >
            Hoje
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => onMudarMes(addMonths(mesAtual, 1))}>Próximo</Button>
      </div>
    </div>
  );
}
