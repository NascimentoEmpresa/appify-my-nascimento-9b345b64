import { useEffect, useState } from "react";
import type { ItemTv } from "@/lib/tv/tv";
import { Item } from "./TvPlayer";

// =====================================================================
// /tv/previa — a PRÉVIA da gestão (Sistemas › TV's, 07/10/2026)
//
// "Adiciona uma prévia pra ver como ficaria antes de aplicar." A gestão
// abre esta página num <iframe> de 1920×1080 reduzido, e manda o item do
// formulário por postMessage a cada mudança. Aqui ele é desenhado pelo MESMO
// componente do player (Item) — o que aparece é o que a TV vai mostrar,
// inclusive vh/vw do relatório (o iframe tem o tamanho de uma TV Full HD).
// Relatório da prévia usa o login de quem está na gestão (mesma origem);
// arquivo ainda não enviado vem como blob: (url_previa).
// Só aceita mensagem da própria origem.
// =====================================================================

type Msg = { tipo: "tv-previa"; item: ItemTv | null };

export default function TvPrevia() {
  const [item, setItem] = useState<ItemTv | null>(null);
  // Remonta o item a cada mudança (vídeo recomeça, relatório reconsulta).
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const ouvir = (e: MessageEvent<Msg>) => {
      if (e.origin !== window.location.origin || e.data?.tipo !== "tv-previa") return;
      setItem(e.data.item); setVersao((v) => v + 1);
    };
    window.addEventListener("message", ouvir);
    // Avisa a gestão que está pronta para receber o item atual.
    window.parent?.postMessage({ tipo: "tv-previa-pronta" }, window.location.origin);
    return () => window.removeEventListener("message", ouvir);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      {item ? <Item key={versao} item={item} sozinho aoAcabar={() => {}} token="" previa />
        : <div className="flex h-full items-center justify-center text-[3vh] text-white/50">Preencha o item para ver a prévia</div>}
    </div>
  );
}
