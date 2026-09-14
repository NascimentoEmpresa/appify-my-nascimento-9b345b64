// "Filtros · Contratos" — o mesmo dropdown do Recrutamento e da Conferência
// de Ponto, agora como componente (14/09/2026), pra entrar em toda tela de
// solicitação que tem contrato: demissões, férias, mudança de função,
// advertências.
//
// Checkbox por contrato com a contagem do lado; vazio = todos. Quem chama
// passa as linhas e diz de que campo sai o contrato — o componente conta.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";

// Genérico de propósito: as telas passam interfaces próprias
// (SolicitacaoDemissao, SolicitacaoTroca, Adv...) sem index signature, e
// `Record<string, unknown>[]` não aceita isso — o type-check da PR #566
// reprovou justamente aí.
interface Props<T> {
  /** Todas as linhas (antes dos outros filtros), pra contar por contrato. */
  linhas: T[];
  /** Nome do campo que guarda o contrato, ou uma função que o extrai. */
  campo: keyof T | ((linha: T) => string | null | undefined);
  selecionados: string[];
  onChange: (contratos: string[]) => void;
  rotulo?: string;
  className?: string;
}

export function contratoDaLinha<T>(linha: T, campo: Props<T>["campo"]): string {
  const v = typeof campo === "function" ? campo(linha) : (linha as any)?.[campo as string];
  return String(v ?? "").trim();
}

/** Aplica o filtro: vazio deixa passar tudo. */
export function passaNoFiltroContratos<T>(linha: T, campo: Props<T>["campo"], selecionados: string[]): boolean {
  return selecionados.length === 0 || selecionados.includes(contratoDaLinha(linha, campo));
}

export function FiltroContratos<T>({ linhas, campo, selecionados, onChange, rotulo = "Filtros · Contratos", className }: Props<T>) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");

  const contratos = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linhas) {
      const c = contratoDaLinha(l, campo);
      if (!c) continue;
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].map(([nome, n]) => ({ nome, n })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [linhas, campo]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? contratos.filter(c => c.nome.toLowerCase().includes(q)) : contratos;
  }, [contratos, busca]);

  return (
    <div className={cn("relative", className)}>
      <Button type="button" variant={selecionados.length ? "default" : "outline"} onClick={() => setAberto(v => !v)} className="w-full sm:w-auto">
        <Filter className="mr-2 h-4 w-4" />
        {rotulo}{selecionados.length ? ` (${selecionados.length})` : ""}
      </Button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setAberto(false)} />
          <div className="absolute left-0 z-50 mt-2 flex max-h-96 w-[min(24rem,90vw)] flex-col rounded-xl border bg-popover p-2 shadow-lg">
            <div className="flex items-center justify-between px-2 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mostrar só estes contratos</span>
              {selecionados.length > 0 && (
                <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onChange([])}>Limpar</button>
              )}
            </div>
            {contratos.length > 8 && (
              <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar contrato…"
                     className="mx-2 mb-2 h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {contratos.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">Nenhum contrato nas solicitações.</p>
              ) : visiveis.map(c => {
                const marcado = selecionados.includes(c.nome);
                return (
                  <label key={c.nome}
                         className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm", marcado ? "bg-accent" : "hover:bg-muted/60")}>
                    <Checkbox checked={marcado}
                              onCheckedChange={() => onChange(marcado ? selecionados.filter(x => x !== c.nome) : [...selecionados, c.nome])} />
                    <span className="min-w-0 flex-1 truncate" title={c.nome}>{c.nome}</span>
                    <span className="shrink-0 rounded-full border px-1.5 text-[11px] font-semibold text-muted-foreground">{c.n}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
