import { supabase } from "@/integrations/supabase/client";
import type { RegistroCobranca } from "./cobrancaNotas";

// SIS-2026-0878: a tabela cobranca_registro e a RPC cobranca_registrar ainda não estão nos tipos gerados do Supabase. Em vez de espalhar
// `(supabase as any)`, este cliente declara só o que a tela de Cobranças usa deles.
type Resposta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

interface ClienteCobranca {
  rpc(fn: "cobranca_registrar", args: { _nf_ids: string[]; _setor: string; _data: string | null; _observacao: string | null }): Resposta<number>;
  from(tabela: "cobranca_registro"): {
    select(colunas: string): { order(coluna: string, opcoes: { ascending: boolean }): { limit(n: number): Resposta<RegistroCobranca[]> } };
  };
}

export const clienteCobranca = supabase as unknown as ClienteCobranca;
