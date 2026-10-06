import { useEffect, useState, useSyncExternalStore } from "react";
import { BookOpen, Clock } from "lucide-react";
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
 * A TROCA PASSOU A SER AUTOMÁTICA (05/10/2026), E ISSO NÃO É DESCUIDO
 *
 * A versão anterior só OFERECIA um botão. O argumento era que impor a troca
 * arriscaria duas versões da verdade — metade das pessoas gravando na Supabase
 * e metade na réplica. Esse argumento está errado aqui, e vale explicar por
 * que, para ninguém "consertar" isto de volta:
 *
 * a réplica RECUSA ESCRITA no próprio Postgres, por REVOKE nas tabelas e em
 * 451 rotinas. Sem escrita não existe divergência; sem divergência não existe
 * nada para reconciliar quando a Supabase voltar. Logo a troca automática é
 * segura — o que seria perigoso é promover a réplica a produção sozinha, e
 * isso continua sendo decisão humana, por comando no shell.
 *
 * Ainda assim a troca não é instantânea: há uma contagem curta e um botão para
 * ficar esperando o sistema principal. Dois motivos:
 *  - uma queda de 10 segundos não deve jogar ninguém para a cópia;
 *  - trocar DESLOGA (o segredo JWT da réplica é outro, ver contingencia.ts),
 *    e levar alguém para uma tela de login sem avisar parece bug, não socorro.
 *
 * Quem recusa não é perguntado de novo na mesma aba: o botão manual fica lá.
 */

/** Segundos de espera antes de trocar sozinho. Curto, mas não instantâneo. */
const SEGUNDOS_PARA_TROCAR = 8;

/** Marca que a pessoa prefere esperar. Vale só para a aba, como a própria contingência. */
const CHAVE_RECUSOU = "erp:contingencia:esperar";

export function MonitorDeQueda() {
  const estado = useSyncExternalStore(monitorDeQueda.assinar, monitorDeQueda.estado);
  const proxima = useSyncExternalStore(monitorDeQueda.assinar, monitorDeQueda.proximaVerificacaoEm);
  const [aviso, setAviso] = useState<string | null>(null);
  // Guarda a CHAVE que a replica devolveu, nao um sim/nao: e ela que o
  // entrarEmContingencia precisa, e buscar duas vezes seria desperdicio.
  const [chaveReplica, setChaveReplica] = useState<string | null>(null);
  const [restam, setRestam] = useState<number | null>(null);
  const [esperar, setEsperar] = useState(() => {
    try {
      return sessionStorage.getItem(CHAVE_RECUSOU) === "1";
    } catch {
      return false;
    }
  });

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

  // A contagem e a troca. O prazo é calculado por horário de parede, e não
  // somando ticks: aba em segundo plano tem o timer estrangulado pelo
  // navegador, e a contagem somada chegaria atrasada ou travaria em 3.
  useEffect(() => {
    if (!fora || !chaveReplica || esperar) {
      setRestam(null);
      return;
    }
    const fim = Date.now() + SEGUNDOS_PARA_TROCAR * 1000;
    setRestam(SEGUNDOS_PARA_TROCAR);
    const tique = setInterval(() => {
      setRestam(Math.max(0, Math.ceil((fim - Date.now()) / 1000)));
    }, 250);
    const troca = setTimeout(() => entrarEmContingencia(chaveReplica), SEGUNDOS_PARA_TROCAR * 1000);
    return () => {
      clearInterval(tique);
      clearTimeout(troca);
    };
  }, [fora, chaveReplica, esperar]);

  // O /404 já é esta tela, com o próprio teste — não empilha duas.
  if (!fora || window.location.pathname === "/404") return null;

  const trocando = restam !== null;

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
      aviso={
        aviso ??
        (trocando
          ? `Abrindo a cópia para consulta em ${restam}s. Você vai precisar entrar de novo, e nessa cópia não é possível salvar alterações.`
          : null)
      }
      extra={
        trocando ? (
          <button
            type="button"
            className="si-btn si-btn-s"
            onClick={() => {
              try {
                sessionStorage.setItem(CHAVE_RECUSOU, "1");
              } catch {
                /* sem armazenamento: vale para este render, e basta */
              }
              setEsperar(true);
            }}
            title="Continua nesta tela, esperando o sistema principal voltar"
          >
            <Clock size={17} strokeWidth={2.4} aria-hidden />
            Esperar o sistema principal
          </button>
        ) : chaveReplica ? (
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
