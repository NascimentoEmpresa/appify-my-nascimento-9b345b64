import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";

// =====================================================================
// Cliente sem o schema gerado, para as tabelas do Comitê de Ética.
//
// `src/integrations/supabase/types.ts` é gerado e ainda não conhece
// CANAL_DENUNCIA nem COMITE_ETICA_SLA, então o client tipado recusa as
// consultas. O resto do ERP resolve isso com `(supabase as any)` espalhado
// por cada chamada; aqui a exceção fica num lugar só, documentada, e as
// telas continuam sem `any` nenhum.
//
// Quando os tipos forem regerados, é só trocar `db` por `supabase`.
// =====================================================================
export const db = supabase as unknown as SupabaseClient;
