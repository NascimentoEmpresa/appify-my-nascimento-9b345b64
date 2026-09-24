import { useSyncExternalStore } from "react";
import { monitorDeQueda, verificarAgora } from "@/lib/monitorDeQueda";
import { SistemaIndisponivel } from "./SistemaIndisponivel";

/**
 * Cobre o ERP inteiro com "Sistema temporariamente indisponível" enquanto o
 * banco estiver fora (ver src/lib/monitorDeQueda.ts). Fica FORA das rotas e
 * dos providers: se a queda derrubar o carregamento de perfil/permissões, a
 * tela ainda aparece — é justamente o caso que ela existe para cobrir.
 */
export function MonitorDeQueda() {
  const estado = useSyncExternalStore(monitorDeQueda.assinar, monitorDeQueda.estado);
  const proxima = useSyncExternalStore(monitorDeQueda.assinar, monitorDeQueda.proximaVerificacaoEm);
  if (estado !== "fora") return null;
  return (
    <SistemaIndisponivel
      modo="tela"
      proximaVerificacaoEm={proxima}
      onTentar={() => verificarAgora(true)}
      rotuloTentar={monitorDeQueda.simulado() ? "Sair da simulação" : "Tentar agora"}
      jogo
    />
  );
}
