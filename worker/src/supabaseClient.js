const { createClient } = require("@supabase/supabase-js");

// Service role key: acesso total, bypassa RLS. Processo de confiança,
// nunca exposto a navegador — mantido só no .env local deste worker.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

module.exports = { supabase };
