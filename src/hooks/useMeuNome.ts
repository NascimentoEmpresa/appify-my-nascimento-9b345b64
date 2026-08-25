import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// =====================================================================
// O NOME DE QUEM ESTÁ LOGADO — uma regra só, para todo o sistema.
//
// O padrão espalhado pelas telas era `user_metadata.nome ?? user.email`, e
// `user_metadata.nome` quase nunca existe: quem cria conta pelo painel de
// Administração não passa por lá. O resultado é o e-mail gravado dentro da
// mensagem, do comentário, do formulário — e, uma vez gravado, ele fica.
//
// `profiles.display_name` é a fonte certa: está preenchido para os 181
// perfis, e é ele que o vínculo com EMPREGADOS sobrescreve com o nome
// oficial da Senior. O e-mail continua no fim da fila, como último recurso
// para nunca gravar vazio.
//
// Quem já tem o cadastro em mãos (useVinculoEmpregado) pode passar
// `empregado.nome` como preferido — evita uma consulta e usa o nome oficial.
// =====================================================================

/** Cache por sessão: o nome não muda no meio do uso, e cada tela pedia o seu. */
let cacheUid: string | null = null;
let cacheNome = "";

export function useMeuNome(preferido?: string | null): string {
  const { user } = useAuth();
  const [nome, setNome] = useState(() => (user && cacheUid === user.id ? cacheNome : ""));

  useEffect(() => {
    if (!user) { setNome(""); return; }
    if (cacheUid === user.id && cacheNome) { setNome(cacheNome); return; }
    let vivo = true;
    (async () => {
      const { data } = await (supabase as any).from("profiles")
        .select("display_name").eq("id", user.id).maybeSingle();
      if (!vivo) return;
      const achado = String(data?.display_name ?? "").trim();
      if (achado) { cacheUid = user.id; cacheNome = achado; }
      setNome(achado);
    })();
    return () => { vivo = false; };
  }, [user]);

  const doMetadata = String((user?.user_metadata as { nome?: string } | undefined)?.nome ?? "").trim();
  // O e-mail é o último recurso: melhor um e-mail do que uma mensagem sem
  // autor. Mas só depois de tentar tudo que é nome de verdade.
  return String(preferido ?? "").trim() || nome || doMetadata || user?.email || "";
}
