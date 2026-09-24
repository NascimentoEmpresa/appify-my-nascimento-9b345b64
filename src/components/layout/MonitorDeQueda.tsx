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
