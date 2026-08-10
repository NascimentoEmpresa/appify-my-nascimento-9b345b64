import { useState } from "react";
import { Car, Check, Wrench, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Disponibilidade, VeiculoFrota } from "@/hooks/useAgendamentoVeiculos";

interface Props {
  veiculo: VeiculoFrota;
  disponibilidade: Disponibilidade;
  selecionado: boolean;
  /** Posição na grade — só para escalonar a entrada dos cards. */
  indice: number;
  onSelecionar: (v: VeiculoFrota) => void;
}

/**
 * O card de escolher o carro.
 *
 * É a peça que o usuário mais olha nesta tela, então ela reage a tudo: entra
 * escalonada, levanta no hover com um brilho passando por cima, e ao ser
 * escolhida marca com um "check" que salta. O carro indisponível não fica só
 * apagado — ele treme quando alguém insiste em clicar, que é mais honesto do
 * que não responder nada.
 *
 * Todo o movimento sai dos keyframes que já existem no tailwind.config.ts
 * (rise-in, pop, check-pop, shake, float-soft, ring-pulse) — nenhuma
 * biblioteca de animação entrou no bundle por causa desta tela.
 */
export function CardVeiculo({ veiculo, disponibilidade, selecionado, indice, onSelecionar }: Props) {
  const [recusando, setRecusando] = useState(false);
  const livre = disponibilidade.disponivel;

  const clicar = () => {
    if (!livre) {
      // Reinicia a animação mesmo em cliques seguidos.
      setRecusando(false);
      requestAnimationFrame(() => setRecusando(true));
      return;
    }
    onSelecionar(veiculo);
  };

  return (
    <button
      type="button"
      onClick={clicar}
      onAnimationEnd={() => setRecusando(false)}
      aria-pressed={selecionado}
      aria-disabled={!livre}
      className={cn(
        "group relative flex w-full flex-col items-start gap-3 overflow-hidden rounded-2xl border p-5 text-left",
        "animate-rise-in transition-all duration-300 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        livre
          ? "border-border bg-card hover:-translate-y-1.5 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/10"
          : "cursor-not-allowed border-dashed border-border/70 bg-muted/30",
        selecionado && "border-primary bg-primary/5 shadow-lg shadow-primary/20 ring-2 ring-primary/40",
        recusando && "animate-shake",
      )}
      style={{ animationDelay: selecionado || recusando ? undefined : `${indice * 60}ms` }}
    >
      {/* Brilho que atravessa o card no hover. Puramente decorativo. */}
      {livre && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-primary/10 to-transparent transition-all duration-700 ease-out group-hover:left-full"
        />
      )}

      {/* Selo de indisponível, no lugar do selo do print. */}
      {!livre && (
        <span className="absolute left-4 top-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
          Indisponível
        </span>
      )}

      {/* Bolinha de status, canto superior direito. */}
      <span
        aria-hidden
        className={cn(
          "absolute right-4 top-4 h-2.5 w-2.5 rounded-full transition-colors",
          livre ? "bg-emerald-500 shadow-[0_0_0_3px_hsl(var(--background))]" : "bg-destructive",
          livre && !selecionado && "animate-pulse-soft",
        )}
      />

      {/* Marca de escolhido. */}
      {selecionado && (
        <span className="absolute right-3 top-3 flex h-6 w-6 animate-check-pop items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      )}

      <div
        className={cn(
          "flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-300",
          // O selo "Indisponível" ocupa o topo do card, então o ícone desce.
          !livre && "mt-3 bg-muted text-muted-foreground",
          livre && !selecionado && "bg-primary/10 text-primary group-hover:animate-float-soft group-hover:bg-primary/15",
          selecionado && "animate-pop bg-primary text-primary-foreground",
        )}
      >
        <Car className="h-7 w-7" />
      </div>

      <div className="w-full">
        <div className={cn("font-semibold leading-tight", livre ? "text-foreground" : "text-muted-foreground")}>
          {veiculo.nome}
        </div>
        {veiculo.identificador && (
          <div className="mt-1.5 inline-block rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono text-xs tracking-wider text-muted-foreground">
            {veiculo.identificador}
          </div>
        )}
        {(veiculo.contrato_nome || veiculo.lotacao) && (
          <div className="mt-1.5 truncate text-xs text-muted-foreground">
            {veiculo.contrato_nome ?? veiculo.lotacao}
          </div>
        )}
        {disponibilidade.detalhe && (
          <div
            className={cn(
              "mt-2 flex items-start gap-1.5 text-xs",
              livre ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
            )}
          >
            {livre ? <CalendarClock className="mt-0.5 h-3 w-3 shrink-0" /> : <Wrench className="mt-0.5 h-3 w-3 shrink-0" />}
            <span>{disponibilidade.detalhe}</span>
          </div>
        )}
      </div>
    </button>
  );
}
