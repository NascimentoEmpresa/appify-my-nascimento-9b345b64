import { RefreshCw, PencilLine, Ban } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  disponibilidadeDoVeiculo,
  formatarData,
  type Agendamento,
  type VeiculoFrota,
} from "@/hooks/useAgendamentoVeiculos";

interface Props {
  frota: VeiculoFrota[];
  agendamentos: Agendamento[];
  atualizando: boolean;
  onAtualizar: () => void;
}

/**
 * O painel "quem está livre agora". Responde à pergunta que o colaborador faz
 * antes de qualquer outra — sem obrigá-lo a entrar no fluxo de agendamento.
 *
 * Duas coisas tiram um carro de "Livre": a manutenção (que vem do Patrimônio)
 * e uma reserva de hoje. A manutenção manda, porque é a que não tem
 * contorno — não adianta saber quem reservou um carro que está na oficina.
 */
export function StatusRapido({ frota, agendamentos, atualizando, onAtualizar }: Props) {
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PencilLine className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-foreground">Status Rápido</h2>
        </div>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-xs" onClick={onAtualizar}>
          <RefreshCw className={cn("h-3 w-3", atualizando && "animate-spin")} />
          Atualizar
        </Button>
      </div>

      {frota.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhum veículo cadastrado no Patrimônio.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {frota.map((v, i) => {
            const disp = disponibilidadeDoVeiculo(v, hoje);
            const reservaHoje = disp.disponivel
              ? agendamentos.find(
                  (a) =>
                    a.patrimonio_id === v.id &&
                    a.status === "confirmado" &&
                    a.data_inicio <= hoje &&
                    a.data_fim >= hoje,
                )
              : undefined;
            const livre = disp.disponivel && !reservaHoje;

            return (
              <li
                key={v.id}
                className="flex animate-rise-in items-start justify-between gap-3 py-2.5"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full", livre ? "bg-emerald-500" : "bg-amber-500")}
                    />
                    <span className="truncate text-sm font-medium text-foreground">{v.nome}</span>
                  </div>
                  {!disp.disponivel && (
                    <p className="ml-4 mt-0.5 text-xs text-muted-foreground">{disp.detalhe}</p>
                  )}
                  {reservaHoje && (
                    <p className="ml-4 mt-0.5 truncate text-xs text-muted-foreground">
                      {reservaHoje.solicitante_nome ?? "Reservado"} · até {formatarData(reservaHoje.data_fim)}
                    </p>
                  )}
                </div>

                {livre ? (
                  <span className="shrink-0 text-xs font-semibold text-emerald-600 dark:text-emerald-400">Livre</span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-destructive">
                    <Ban className="h-3 w-3" />
                    {disp.disponivel ? "Reservado" : "Indisponível"}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
