import { useEffect, useState, useSyncExternalStore } from "react";
import { BookOpen } from "lucide-react";
import { monitorDeQueda, verificarAgora } from "@/lib/monitorDeQueda";
import {
  CONTINGENCIA_CONFIGURADA,
  entrarEmContingencia,
  replicaRespondendo,
} from "@/integrations/supabase/contingencia";
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
 * CONSULTAR EM MODO LEITURA (02/10/2026): existe uma réplica completa do banco
 * rodando fora da Supabase. Quando ela responde, a tela passa a OFERECER a
 * consulta em vez de só pedir paciência — conferir um pedido ou uma escala é a
 * maior parte do uso, e não depende de gravar nada.
 *
 * A oferta só aparece depois de a réplica confirmar que está no ar: um botão
 * que leva a uma tela que não carrega seria pior que botão nenhum. E a réplica
 * recusa escrita no próprio Postgres, então aceitar não arrisca perder
 * trabalho — ver integrations/supabase/contingencia.ts.
 */
export function MonitorDeQueda() {
  const estado = useSyncExternalStore(monitorDeQueda.assinar, monitorDeQueda.estado);
  const proxima = useSyncExternalStore(monitorDeQueda.assinar, monitorDeQueda.proximaVerificacaoEm);
  const [aviso, setAviso] = useState<string | null>(null);
  // Guarda a CHAVE que a replica devolveu, nao um sim/nao: e ela que o
  // entrarEmContingencia precisa, e buscar duas vezes seria desperdicio.
  const [chaveReplica, setChaveReplica] = useState<string | null>(null);

  const fora = estado === "fora";

  useEffect(() => {
    // Só sonda quando a queda está confirmada: em operação normal isto nunca
    // roda, e o ERP não paga nada por existir.
    if (!fora || !CONTINGENCIA_CONFIGURADA) return;
    let vivo = true;
    void replicaRespondendo().then((chave) => {
      if (vivo) setChaveReplica(chave);
    });
    return () => {
      vivo = false;
    };
  }, [fora]);

  // O /404 já é esta tela, com o próprio teste — não empilha duas.
  if (!fora || window.location.pathname === "/404") return null;

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
      extra={
        chaveReplica ? (
          <button
            type="button"
            className="si-btn si-btn-s"
            onClick={() => entrarEmContingencia(chaveReplica)}
            title="Abre uma cópia do sistema onde você consulta os dados, mas não consegue salvar alterações"
          >
            <BookOpen size={17} strokeWidth={2.4} aria-hidden />
            Consultar em modo leitura
          </button>
        ) : undefined
      }
      jogo
    />
  );
}
