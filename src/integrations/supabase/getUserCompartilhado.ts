import type { SupabaseClient } from "@supabase/supabase-js";
import { compartilhar } from "@/lib/leituraCompartilhada";

// =====================================================================
// supabase.auth.getUser() COMPARTILHADO (03/11/2026)
//
// getUser() sem argumento vai ao GoTrue (GET /auth/v1/user) toda vez. Está
// em 64 lugares do código, e no boot de uma aba eram ~4 idas iguais; no dia
// 03/11 foram 25.287 para no máximo 62 abas (src/lib/leituraCompartilhada.ts).
//
// Aqui chamadas iguais (mesmo token de acesso) dentro de 10 s recebem a mesma
// resposta. A chave é o access_token: trocou o token (refresh, login, logout)
// = chave nova = vai ao GoTrue de novo. E qualquer mudança de sessão esvazia
// o guardado de vez.
//
// Instalado em client.ts logo depois do createClient. Se o Lovable regerar
// client.ts, a linha `compartilharGetUser(supabase)` tem que voltar.
// =====================================================================

export function compartilharGetUser(cliente: SupabaseClient<any, any, any>) {
  const auth = cliente.auth;
  const original = auth.getUser.bind(auth);
  const cache = compartilhar<Awaited<ReturnType<typeof original>>>(10_000);

  auth.onAuthStateChange(() => cache.esquecer());

  auth.getUser = (async (jwt?: string) => {
    if (jwt) return original(jwt);
    const { data } = await auth.getSession();
    const token = data.session?.access_token;
    if (!token) return original();
    return cache.ler(token, async () => {
      const r = await original();
      // erro não fica guardado (o compartilhar só guarda promessa resolvida;
      // aqui o supabase-js RESOLVE com { error }, então derrubamos à mão)
      if (r.error) throw { resposta: r };
      return r;
    }).catch((e) => {
      if (e && typeof e === "object" && "resposta" in e) return (e as { resposta: Awaited<ReturnType<typeof original>> }).resposta;
      throw e;
    });
  }) as typeof auth.getUser;
}
