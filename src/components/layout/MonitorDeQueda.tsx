import { useState, useSyncExternalStore } from "react";
import { monitorDeQueda, verificarAgora } from "@/lib/monitorDeQueda";
import { SistemaIndisponivel } from "./SistemaIndisponivel";

/**
 * Cobre o ERP inteiro com "Sistema temporariamente indisponível" enquanto o
 * banco estiver fora (ver src/lib/monitorDeQueda.ts). Fica FORA das rotas e
 * dos providers: se a queda derrubar o carregamento de perfil/permissões, a
 * tela ainda aparece — é justamente o caso que ela existe para cobrir.
 *
 * "Recarregar" (24/09): testa o servidor antes; voltou → recarrega a página;
 * não voltou → avisa e recomeça a contagem (recarregar às cegas só traria
 * de volta o ERP vazio da queda).
 *
 * SEM "MODO CONSULTA" DESDE 16/10/2026
 * De 02/10 a 16/10 esta tela trocava sozinha, em 8 s, para uma réplica
 * somente leitura. Em 16/10 isso prendeu as abas na réplica, onde o login
 * dava "Database error querying schema", com o banco principal já de volta.
 * Removido a pedido do Pablo; a faxina das abas que ficaram marcadas está em
 * src/integrations/supabase/env.ts. Não reintroduzir a troca automática.
 */
export function MonitorDeQueda() {
  const estado = useSyncExternalStore(monitorDeQueda.assinar, monitorDeQueda.estado);
  const proxima = useSyncExternalStore(monitorDeQueda.assinar, monitorDeQueda.proximaVerificacaoEm);
  const [aviso, setAviso] = useState<string | null>(null);

  // O /404 já é esta tela, com o próprio teste — não empilha duas.
  if (estado !== "fora" || window.location.pathname === "/404") return null;

  return (
    <SistemaIndisponivel
      modo="tela"
      proximaVerificacaoEm={proxima}
      onTentar={async () => {
        setAviso(null);
        const voltou = await verificarAgora(true);
        if (!voltou) setAviso("O sistema ainda está indisponível — tentamos de novo sozinhos em instantes.");
      }}
      rotuloTentar="Recarregar"
      aviso={aviso}
      jogo
    />
  );
}
