import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useScreenAccess } from "@/hooks/useScreenAccess";

// =====================================================================
// A BOLINHA DO JURÍDICO — Parecer Jurídico (dúvidas) e Advertências
// (SIS-2026-0434, 18/09/2026)
//
// Mesmo desenho da Mudança de Função (useTrocaFuncaoNotif): "tem coisa
// para mim" = existe demanda parada na etapa que EU trato. Fica acesa
// enquanto houver fila — o sino (triggers da mig 185) avisa que chegou, a
// bolinha lembra que ainda está lá. Nada de "visto": esconder trabalho
// pendente é o oposto do que o chamado pede ("temos prazos").
//
// Quem acende cada uma sai do Acesso por Usuário, o mesmo que a tela usa:
//   Parecer Jurídico  aprovar → dúvidas 'Aberta'
//                     responder → dúvidas 'Aprovada' + complemento pendente
//   Advertências      aprovar → 'Aguardando Aprovação'
//                     aprovar/alterar → 'Aguardando Jurídico'
// A RLS das tabelas é aberta a autenticados; o que a bolinha "vaza" é só
// que há fila numa tela que a pessoa já enxerga.
// =====================================================================

const db = supabase as unknown as SupabaseClient;

export interface JuridicoNotif {
  /** rota → tem pendência? É assim que a sidebar consulta. */
  porRota: Record<string, boolean>;
  /** Quantidades, pro título do item (tooltip). */
  contagens: { duvidas: number; advertencias: number };
}

const VAZIO: JuridicoNotif = { porRota: {}, contagens: { duvidas: 0, advertencias: 0 } };

export function useJuridicoNotif(): JuridicoNotif {
  const { data: aprovaDuvida } = useScreenAccess("duvidas", "aprovar");
  const { data: respondeDuvida } = useScreenAccess("duvidas", "responder");
  const { data: aprovaAdv } = useScreenAccess("advertencias", "aprovar");
  const { data: alteraAdv } = useScreenAccess("advertencias", "alterar");
  const algum = !!(aprovaDuvida || respondeDuvida || aprovaAdv || alteraAdv);

  const { data } = useQuery({
    queryKey: ["juridico-notif", !!aprovaDuvida, !!respondeDuvida, !!aprovaAdv, !!alteraAdv],
    enabled: algum,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<JuridicoNotif> => {
      const [duv, comp, adv] = await Promise.all([
        (aprovaDuvida || respondeDuvida)
          ? db.from("JUR_DUVIDAS").select("id, status").in("status", ["Aberta", "Aprovada", "Respondida"]).limit(2000)
          : Promise.resolve({ data: [] as { id: number; status: string }[] }),
        respondeDuvida
          ? db.from("JUR_DUVIDAS_COMPLEMENTOS").select("duvida_id, tipo, id").order("id").limit(5000)
          : Promise.resolve({ data: [] as { duvida_id: number; tipo: string; id: number }[] }),
        (aprovaAdv || alteraAdv)
          ? db.from("SISTEMA_SOLICITACOES_ADVERTENCIA").select("id, status").in("status", ["Aguardando Aprovação", "Aguardando Jurídico"]).limit(2000)
          : Promise.resolve({ data: [] as { id: number; status: string }[] }),
      ]);
      const duvidas = (duv.data ?? []) as { id: number; status: string }[];
      const compl = (comp.data ?? []) as { duvida_id: number; tipo: string; id: number }[];
      const advs = (adv.data ?? []) as { id: number; status: string }[];

      // Complemento pendente = o último item do fio é uma pergunta.
      const ultimo = new Map<number, string>();
      for (const c of compl) ultimo.set(c.duvida_id, c.tipo);
      const respondidas = new Set(duvidas.filter(d => d.status === "Respondida").map(d => d.id));
      const pendComp = [...ultimo.entries()].filter(([id, tipo]) => tipo === "pergunta" && respondidas.has(id)).length;

      let nDuvidas = 0;
      if (aprovaDuvida) nDuvidas += duvidas.filter(d => d.status === "Aberta").length;
      if (respondeDuvida) nDuvidas += duvidas.filter(d => d.status === "Aprovada").length + pendComp;

      let nAdv = 0;
      if (aprovaAdv) nAdv += advs.filter(a => a.status === "Aguardando Aprovação").length;
      if (aprovaAdv || alteraAdv) nAdv += advs.filter(a => a.status === "Aguardando Jurídico").length;

      return {
        porRota: { "/app/juridico/duvidas": nDuvidas > 0, "/app/juridico/advertencias": nAdv > 0 },
        contagens: { duvidas: nDuvidas, advertencias: nAdv },
      };
    },
  });

  return data ?? VAZIO;
}
