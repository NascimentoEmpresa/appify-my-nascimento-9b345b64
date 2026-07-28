import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Notificação (bolinha) dos Chamados de Sistemas na sidebar.
//
// "Tem novidade" = existe chamado relevante pro usuário cujo `updated_at` é mais
// recente do que a última vez que ele abriu a tela correspondente. O momento de
// "visto" fica no localStorage, por usuário e por visão:
//   - meus → tela "Chamados de Sistemas" (solicitante)
//   - dev  → "Painel do Desenvolvedor" (responsável)
//
// updated_at do chamado sobe a cada mudança de status/prazo — inclusive quando o
// dev pede mais informações (→ solicitante) e quando o solicitante responde e o
// chamado volta pra 'em_andamento' (→ dev). Não depende de mudança no schema.

export type ChamadoNotifView = "meus" | "dev";

const SEEN_EVENT = "chamados-seen";
const lsKey = (uid: string, view: ChamadoNotifView) => `chamados_seen_${view}_${uid}`;

/** Marca a visão como lida (chame ao abrir a tela). Limpa a bolinha. */
export function chamadosMarkSeen(uid: string | undefined, view: ChamadoNotifView) {
  if (!uid) return;
  try {
    localStorage.setItem(lsKey(uid, view), new Date().toISOString());
    window.dispatchEvent(new CustomEvent(SEEN_EVENT));
  } catch {
    /* localStorage indisponível — sem bolinha, sem erro */
  }
}

interface ChamadoRow {
  id: string;
  updated_at: string;
  status: string;
  solicitante_id: string;
  responsavel_id: string | null;
}

// Estados que cada papel precisa "ver". Gatilhar por status evita que quem
// causou a mudança acenda a própria bolinha: o solicitante só provoca
// 'em_andamento' (ao responder) — que não está na lista dele; o dev provoca
// 'aguardando_retorno'/'concluido' — fora da lista dele.
const STATUS_MEUS = new Set(["aguardando_retorno", "concluido", "reprovado"]);
const STATUS_DEV = new Set(["aberto", "em_andamento"]);

export function useChamadosNotif() {
  const { user } = useAuth();
  const uid = user?.id;

  const { data: chamados = [] } = useQuery({
    queryKey: ["chamados-notif", uid],
    enabled: !!uid,
    refetchInterval: 60_000,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("CHAMADO_SISTEMA")
        .select("id, updated_at, status, solicitante_id, responsavel_id")
        .or(`solicitante_id.eq.${uid},responsavel_id.eq.${uid}`);
      return (data ?? []) as ChamadoRow[];
    },
  });

  // Timestamps "visto" — recomputados quando muda o usuário ou quando alguma
  // tela dispara o evento de "marcar como visto".
  const readSeen = useCallback(() => {
    if (!uid) return { meus: 0, dev: 0 };
    const get = (v: ChamadoNotifView) => {
      const raw = localStorage.getItem(lsKey(uid, v));
      const t = raw ? Date.parse(raw) : 0;
      return Number.isNaN(t) ? 0 : t;
    };
    return { meus: get("meus"), dev: get("dev") };
  }, [uid]);

  const [seen, setSeen] = useState(readSeen);
  useEffect(() => {
    setSeen(readSeen());
    const h = () => setSeen(readSeen());
    window.addEventListener(SEEN_EVENT, h);
    window.addEventListener("storage", h);
    return () => {
      window.removeEventListener(SEEN_EVENT, h);
      window.removeEventListener("storage", h);
    };
  }, [readSeen]);

  const meus = chamados.some(
    (c) => c.solicitante_id === uid && STATUS_MEUS.has(c.status) && Date.parse(c.updated_at) > seen.meus,
  );
  const dev = chamados.some(
    (c) => c.responsavel_id === uid && STATUS_DEV.has(c.status) && Date.parse(c.updated_at) > seen.dev,
  );

  return { meus, dev };
}
