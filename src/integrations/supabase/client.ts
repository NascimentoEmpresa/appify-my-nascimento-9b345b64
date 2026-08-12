// Gerado originalmente pelo Lovable. EDITADO À MÃO: a URL e a chave anon
// saíram do literal e passaram a vir do `.env` (ver ./env.ts). Se o Lovable
// regerar este arquivo, ele volta com as credenciais escritas aqui dentro —
// é só reaplicar estas duas linhas.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});
