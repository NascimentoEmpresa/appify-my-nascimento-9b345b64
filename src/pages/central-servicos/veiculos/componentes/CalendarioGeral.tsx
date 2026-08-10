import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Wrench } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  LABEL_TURNO,
  disponibilidadeDoVeiculo,
  formatarData,
  hojeISO,
  type Agendamento,
  type VeiculoFrota,
} from "@/hooks/useAgendamentoVeiculos";

interface Props {
  agendamentos: Agendamento[];
  frota: VeiculoFrota[];
}

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/** Data local em ISO — `toISOString()` converteria para UTC e trocaria o dia. */
function iso(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/**
 * O mês inteiro da frota numa tela. Serve para a pergunta que o Status Rápido
 * não responde: "em que dia dá para pegar um carro?".
 */
export function CalendarioGeral({ agendamentos, frota }: Props) {
  const agora = new Date();
  const [ano, setAno] = useState(agora.getFullYear());
  const [mes, setMes] = useState(agora.getMonth());
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  const hoje = hojeISO();
  const emManutencao = frota.filter((v) => !disponibilidadeDoVeiculo(v, hoje).disponivel);

  const confirmados = useMemo(
    () => agendamentos.filter((a) => a.status === "confirmado"),
    [agendamentos],
  );

  const celulas = useMemo(() => {
    const primeiro = new Date(ano, mes, 1);
    const diasNoMes = new Date(ano, mes + 1, 0).getDate();
    const vazias = primeiro.getDay();
    const lista: ({ data: string; dia: number } | null)[] = Array(vazias).fill(null);
    for (let d = 1; d <= diasNoMes; d++) lista.push({ data: iso(ano, mes, d), dia: d });
    return lista;
  }, [ano, mes]);

  const doDia = (data: string) =>
    confirmados.filter((a) => a.data_inicio <= data && a.data_fim >= data);

  const navegar = (delta: number) => {
    const d = new Date(ano, mes + delta, 1);
    setAno(d.getFullYear());
    setMes(d.getMonth());
    setDiaAberto(null);
  };

  const agendamentosDoDiaAberto = diaAberto ? doDia(diaAberto) : [];

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navegar(-1)} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h3 className="text-base font-bold text-foreground">
            {MESES[mes]} de {ano}
          </h3>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => navegar(1)} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {DIAS.map((d) => (
            <div key={d} className="pb-1 text-center text-xs font-semibold uppercase text-muted-foreground">
              {d}
            </div>
          ))}
          {celulas.map((c, i) => {
            if (!c) return <div key={`v${i}`} />;
            const reservas = doDia(c.data);
            const ehHoje = c.data === hoje;
            const aberto = diaAberto === c.data;
            return (
              <button
                key={c.data}
                type="button"
                onClick={() => setDiaAberto(aberto ? null : c.data)}
                className={cn(
                  "flex min-h-[68px] flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition-all duration-200",
                  "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm",
                  ehHoje ? "border-primary/60 bg-primary/5" : "border-border bg-card",
                  aberto && "ring-2 ring-primary/40",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-semibold",
                    ehHoje ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {c.dia}
                </span>
                <div className="flex w-full flex-col gap-0.5">
                  {reservas.slice(0, 2).map((r) => (
                    <span
                      key={r.id}
                      className="truncate rounded bg-primary/15 px-1 py-0.5 text-[10px] font-medium text-primary"
                      title={`${r.veiculo_nome} — ${r.solicitante_nome ?? ""}`}
                    >
                      {r.veiculo_nome}
                    </span>
                  ))}
                  {reservas.length > 2 && (
                    <span className="px-1 text-[10px] text-muted-foreground">+{reservas.length - 2}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {diaAberto && (
        <Card className="animate-fade-in p-4">
          <h4 className="mb-3 text-sm font-bold text-foreground">
            {formatarData(diaAberto)} — {agendamentosDoDiaAberto.length}{" "}
            {agendamentosDoDiaAberto.length === 1 ? "reserva" : "reservas"}
          </h4>
          {agendamentosDoDiaAberto.length === 0 ? (
            <p className="text-sm text-muted-foreground">Frota inteira livre neste dia.</p>
          ) : (
            <ul className="space-y-2">
              {agendamentosDoDiaAberto.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5">
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="shrink-0 text-sm font-medium text-foreground">{a.veiculo_nome}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {a.solicitante_nome ?? "—"}
                    </span>
                    {/* Ao lado do nome, como pedido. Uma viagem costuma atender
                        vários contratos — o histórico chega a ter dez numa só —,
                        então só este trecho encolhe: o veículo e a pessoa nunca
                        são cortados, e o texto inteiro fica no title. */}
                    {a.contratos?.length > 0 && (
                      <span
                        className="truncate text-xs text-muted-foreground/80"
                        title={a.contratos.map((c) => c.contrato_nome).join(", ")}
                      >
                        · {a.contratos.map((c) => c.contrato_nome).join(", ")}
                      </span>
                    )}
                    {a.destino && (
                      <span className="shrink-0 text-xs text-muted-foreground">· {a.destino}</span>
                    )}
                  </div>
                  <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {LABEL_TURNO[a.turno]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {emManutencao.length > 0 && (
        <Card className="p-4">
          <h4 className="mb-2 flex items-center gap-2 text-sm font-bold text-foreground">
            <Wrench className="h-4 w-4 text-amber-500" />
            Fora de operação
          </h4>
          <p className="mb-3 text-xs text-muted-foreground">
            Definido no módulo de Patrimônio. Esta tela apenas respeita o que está marcado lá.
          </p>
          <ul className="space-y-1.5">
            {emManutencao.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-foreground">{v.nome}</span>
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {disponibilidadeDoVeiculo(v, hoje).detalhe}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
