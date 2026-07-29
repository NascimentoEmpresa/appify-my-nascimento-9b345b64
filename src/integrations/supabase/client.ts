// Gerado pelo Lovable, mas EDITADO de propósito: a URL e a chave anon saíram
// do código e passaram a vir do .env (src/integrations/supabase/env.ts).
// Se a ferramenta regenerar este arquivo com os valores hardcoded, refaça o
// import abaixo — credencial não volta pro código.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { SUPABASE_URL, SUPABASE_ANON_KEY as SUPABASE_PUBLISHABLE_KEY } from './env';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});