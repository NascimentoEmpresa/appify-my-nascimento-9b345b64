import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();
  // Guarda o último uid visto para detectar TROCA de usuário — não dá para
  // usar o state `user` aqui porque o callback do listener fecha sobre o valor
  // da primeira renderização.
  const uidRef = useRef<string | null>(null);

  useEffect(() => {
    // 1) Listener primeiro (evita perder eventos)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);

      // Trocou de usuário (login, logout, ou externo → interno): joga fora o
      // cache do React Query inteiro. Sem isso, qualquer hook cujo queryKey não
      // inclua o usuário devolve o dado da sessão anterior enquanto estiver
      // fresco — e o sintoma típico é tela vazia, não erro. Refresh de token
      // mantém o mesmo uid e NÃO limpa nada.
      const nextUid = newSession?.user?.id ?? null;
      if (uidRef.current !== nextUid) {
        if (uidRef.current !== null) queryClient.clear();
        uidRef.current = nextUid;
      }

      // Preserva a referência se o usuário é o mesmo — evita re-renders em contextos
      // que dependem de `user` (PermissoesContext, EmpresaAtivaContext) a cada token refresh.
      setUser(prev => {
        const next = newSession?.user ?? null;
        if (prev?.id && next?.id && prev.id === next.id) return prev;
        return next;
      });
    });

    // 2) Sessão inicial
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      // Semeia o uid conhecido: a página pode ter carregado já com sessão, e
      // sem isso a primeira troca de usuário passaria despercebida.
      uidRef.current = data.session?.user?.id ?? null;
      setUser(prev => {
        const next = data.session?.user ?? null;
        if (prev?.id && next?.id && prev.id === next.id) return prev;
        return next;
      });
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
