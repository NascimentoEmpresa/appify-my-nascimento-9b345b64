import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Link2 } from "lucide-react";
import { StatusBadge } from "./types";
import { rotuloParte, type ParteSerie } from "@/lib/chamados/vinculos";

// =====================================================================
// CHAMADOS VINCULADOS — a série (Parte 1, Parte 2…) do chamado aberto
// (12/11/2026, mig 20261112002000). Aparece no acompanhamento, na execução
// e na coordenação. A RPC chamado_vinculos devolve a série inteira para quem
// enxerga ESTE chamado; sem vínculo, o cartão não aparece.
// O "O que é preciso a mais" de cada parte fica aqui também — é o que o dev
// precisa ler além da descrição copiada do chamado anterior.
// =====================================================================
// RPC nova (mig 20261112002000), ainda fora dos tipos gerados: tipada aqui em vez de `as any`.
const rpcVinculos = supabase as unknown as {
  rpc(fn: "chamado_vinculos", args: { p_chamado_id: string }): PromiseLike<{ data: ParteSerie[] | null; error: { message: string } | null }>;
};

export function ChamadosVinculados({ chamadoId, hrefDe }: { chamadoId: string; hrefDe: (id: string) => string }) {
  const { data: serie = [] } = useQuery({
    queryKey: ["chamado-vinculos", chamadoId],
    queryFn: async () => {
      const { data, error } = await rpcVinculos.rpc("chamado_vinculos", { p_chamado_id: chamadoId });
      if (error) throw error;
      return data ?? [];
    },
  });
  if (serie.length < 2) return null;
  const atual = serie.find((p) => p.id === chamadoId);

  return (
    <Card className="space-y-3 p-4">
      <p className="flex items-center gap-1.5 text-sm font-bold">
        <Link2 className="h-4 w-4 text-primary" /> Chamados vinculados
        {atual && <span className="text-xs font-normal text-muted-foreground">· este é a {rotuloParte(atual.parte)} de {serie.length}</span>}
      </p>
      {atual?.complemento && (
        <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">O que é preciso a mais</p>
          <p className="mt-1 whitespace-pre-wrap text-sm">{atual.complemento}</p>
        </div>
      )}
      <div className="space-y-1.5">
        {serie.map((p) => (
          p.id === chamadoId ? (
            <div key={p.id} className="flex items-center gap-2 rounded border border-primary/50 bg-primary/5 px-3 py-2 text-sm">
              <span className="w-14 shrink-0 text-xs font-bold text-primary">{rotuloParte(p.parte)}</span>
              <span className="min-w-0 flex-1 truncate"><span className="font-mono text-xs font-semibold">#{p.numero}</span> {p.assunto}</span>
              <StatusBadge status={p.status} />
            </div>
          ) : (
            <Link key={p.id} to={hrefDe(p.id)}
              className="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm hover:border-primary/50"
              title={p.complemento ? `O que é preciso a mais: ${p.complemento}` : undefined}>
              <span className="w-14 shrink-0 text-xs font-semibold text-muted-foreground">{rotuloParte(p.parte)}</span>
              <span className="min-w-0 flex-1 truncate"><span className="font-mono text-xs font-semibold">#{p.numero}</span> {p.assunto}</span>
              <StatusBadge status={p.status} />
            </Link>
          )
        ))}
      </div>
    </Card>
  );
}
