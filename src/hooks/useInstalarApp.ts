import { useEffect, useState } from "react";

// O Chrome/Edge do Android dispara `beforeinstallprompt` uma vez, cedo, e quem
// não guardou o evento perde o pedido. Por isso o ouvinte fica no módulo, e não
// no efeito do hook, que pode montar depois do disparo. O Safari do iPhone não
// tem esse evento: lá se instala por Compartilhar › Adicionar à Tela de Início.
interface PedidoDeInstalacao extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let pedido: PedidoDeInstalacao | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    pedido = e as PedidoDeInstalacao;
    avisar();
  });
  window.addEventListener("appinstalled", () => {
    pedido = null;
    avisar();
  });
}

export function useInstalarApp() {
  const [podeInstalar, setPodeInstalar] = useState(() => !!pedido);
  useEffect(() => {
    const f = () => setPodeInstalar(!!pedido);
    ouvintes.add(f);
    f();
    return () => { ouvintes.delete(f); };
  }, []);
  const instalar = async () => {
    if (!pedido) return;
    const atual = pedido;
    await atual.prompt();
    await atual.userChoice;
    // O evento só vale uma vez, aceito ou recusado.
    pedido = null;
    avisar();
  };
  return { podeInstalar, instalar };
}
