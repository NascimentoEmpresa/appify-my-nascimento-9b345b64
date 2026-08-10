import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const PASSOS = ["Veículo", "Data e Turno", "Contratos", "Confirmar"] as const;
export type IndicePasso = 0 | 1 | 2 | 3;

interface Props {
  atual: IndicePasso;
  /** Até onde o usuário já chegou — só aí a volta atrás é clicável. */
  maximoAlcancado: IndicePasso;
  onIr: (p: IndicePasso) => void;
}

/**
 * A trilha dos 4 passos. Voltar é livre até onde o usuário já chegou; pular
 * adiante, não — cada passo depende da escolha do anterior.
 */
export function Passos({ atual, maximoAlcancado, onIr }: Props) {
  return (
    <ol className="flex items-center gap-2 overflow-x-auto pb-1">
      {PASSOS.map((nome, i) => {
        const concluido = i < atual;
        const ativo = i === atual;
        const acessivel = i <= maximoAlcancado;
        return (
          <li key={nome} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!acessivel}
              onClick={() => acessivel && onIr(i as IndicePasso)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-full px-1 py-1 transition-colors",
                acessivel ? "cursor-pointer" : "cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
                  ativo && "animate-pop bg-primary text-primary-foreground ring-4 ring-primary/20",
                  concluido && "bg-primary/15 text-primary",
                  !ativo && !concluido && "bg-muted text-muted-foreground",
                )}
              >
                {concluido ? <Check className="h-3.5 w-3.5 animate-check-pop" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  "whitespace-nowrap text-xs font-semibold uppercase tracking-wide transition-colors",
                  ativo ? "text-foreground" : concluido ? "text-primary" : "text-muted-foreground",
                )}
              >
                {nome}
              </span>
            </button>
            {i < PASSOS.length - 1 && (
              <span className="h-px flex-1 bg-border">
                <span
                  className="block h-px bg-primary transition-all duration-500 ease-out"
                  style={{ width: concluido ? "100%" : "0%" }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
