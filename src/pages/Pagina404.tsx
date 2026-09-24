import { useCallback, useEffect, useRef, useState } from "react";
import { SistemaIndisponivel } from "@/components/layout/SistemaIndisponivel";
import { servidorRespondendo } from "@/lib/monitorDeQueda";

const INTERVALO_MS = 15_000;

/**
 * /404 (24/09/2026, pedido do Pablo): a tela "Sistema temporariamente
 * indisponível" num endereço próprio, pública (fora do login).
 *
 * "Recarregar" verifica se o sistema já voltou: respondeu → segue para
 * `?voltar=` (ou o início); não respondeu → avisa e recomeça a contagem.
 * O mesmo teste roda sozinho a cada 15 s, então quem só esperar também é
 * levado de volta quando o banco responder.
 *
 * Não substitui o `*` (rota inexistente continua no NotFound): dizer
 * "sistema indisponível" para quem só digitou um endereço errado seria
 * informação falsa.
 */
export default function Pagina404() {
  const [proxima, setProxima] = useState<number>(() => Date.now() + INTERVALO_MS);
  const [aviso, setAviso] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const destino = () => {
    const v = new URLSearchParams(window.location.search).get("voltar");
    // Só caminho interno: nada de redirecionar para outro domínio pela URL.
    return v && v.startsWith("/") && !v.startsWith("//") && v !== "/404" ? v : "/";
  };

  const verificar = useCallback(async (manual: boolean) => {
    if (timer.current) clearTimeout(timer.current);
    if (manual) setAviso(null);
    if (await servidorRespondendo()) { window.location.replace(destino()); return; }
    if (manual) setAviso("O sistema ainda está indisponível — tentamos de novo sozinhos em instantes.");
    setProxima(Date.now() + INTERVALO_MS);
  }, []);

  useEffect(() => {
    timer.current = setTimeout(() => void verificar(false), Math.max(0, proxima - Date.now()));
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [proxima, verificar]);

  return (
    <SistemaIndisponivel
      modo="tela"
      jogo
      proximaVerificacaoEm={proxima}
      onTentar={() => verificar(true)}
      rotuloTentar="Recarregar"
      aviso={aviso}
    />
  );
}
