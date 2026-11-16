import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, HardHat, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { contratosQueTrocamDeEncarregado } from "@/lib/operacional/organogramaOperacional";

// Login novo de ENCARREGADO (17/11/2026, mig 20261117000100): de qual(is)
// contrato(s) da Licitação ele é responsável. Grava no Organograma
// Operacional (ope_org_encarregado_login) — a fonte do encarregado do
// contrato para Ponto, Documentos do RH e Solicitar Treinamento.

const sb = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface OpcaoContratoEnc { id: string; nome: string; encarregado_id: number | null; encarregado_nome: string | null }

export function useContratosEncarregadoOpcoes(ativo: boolean) {
  return useQuery({
    queryKey: ["ope-organograma-contratos-opcoes"],
    enabled: ativo,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<OpcaoContratoEnc[]> => {
      const { data, error } = await sb.rpc("ope_org_contratos_opcoes");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function ContratosEncarregadoCampo({ valor, onValor, empregadoId }: {
  valor: string[]; onValor: (v: string[]) => void; empregadoId: number | null;
}) {
  const q = useContratosEncarregadoOpcoes(true);
  const [busca, setBusca] = useState("");
  const opcoes = useMemo(() => q.data ?? [], [q.data]);
  const lista = useMemo(() => {
    const t = semAcento(busca.trim());
    return opcoes.filter((o) => valor.includes(o.id) || !t || semAcento(o.nome).includes(t));
  }, [opcoes, busca, valor]);
  const trocas = contratosQueTrocamDeEncarregado(valor, opcoes, empregadoId);
  const alternar = (id: string) => onValor(valor.includes(id) ? valor.filter((x) => x !== id) : [...valor, id]);

  return (
    <div className="space-y-2 rounded-xl border border-sky-400/50 bg-sky-50/50 p-3 dark:bg-sky-950/20">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-sky-800 dark:text-sky-300">
        <HardHat className="h-3.5 w-3.5" /> Contrato(s) do encarregado *
      </p>
      <p className="text-[11px] text-muted-foreground">
        Obrigatório para encarregado: é quem vai conferir o ponto e receber os documentos do RH destes contratos (Operacional › Organograma › Operacional).
      </p>
      {q.isError ? (
        <p className="text-xs text-destructive">
          {/schema cache|does not exist|não existe|Could not find/i.test((q.error as Error).message)
            ? "A lista de contratos fica disponível quando a atualização do banco entrar."
            : (q.error as Error).message}
        </p>
      ) : q.isLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando contratos…</p>
      ) : (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-8 pl-8 text-sm" placeholder="Buscar contrato…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-md border bg-background p-1">
            {lista.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs hover:bg-muted/60">
                <Checkbox className="mt-0.5" checked={valor.includes(o.id)} onCheckedChange={() => alternar(o.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{o.nome}</span>
                  {o.encarregado_nome && o.encarregado_id !== empregadoId && (
                    <span className="block truncate text-[10.5px] text-muted-foreground">hoje: {o.encarregado_nome}</span>
                  )}
                </span>
              </label>
            ))}
            {!lista.length && <p className="p-2 text-xs text-muted-foreground">Nenhum contrato encontrado.</p>}
          </div>
          <p className="text-[11px] text-muted-foreground">{valor.length ? `${valor.length} escolhido(s)` : "Nenhum escolhido"}</p>
          {trocas.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-100 px-2 py-1.5 text-[11px] text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Troca o encarregado atual de: {trocas.map((t) => `${t.nome} (${t.atual})`).join("; ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
