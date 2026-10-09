import { useEffect, useState } from "react";
import type { ItemTv, TelaTv } from "@/lib/tv/tv";
import { Alerta, Centro, Item, Ocioso } from "./TvPlayer";

// =====================================================================
// /tv/previa — a tela de TV que a gestão desenha (Sistemas › TV's)
//
// "Adiciona uma prévia pra ver como ficaria antes de aplicar." A gestão
// abre esta página num <iframe> de 1920×1080 reduzido, e manda o que mostrar
// por postMessage. Aqui é desenhado pelos MESMOS componentes do player
// (Item, Ocioso, Alerta) — o que aparece é o que a TV mostra, inclusive
// vh/vw do relatório (o iframe tem o tamanho de uma TV Full HD).
// Relatório usa o login de quem está na gestão (mesma origem); arquivo ainda
// não enviado vem como blob: (url_previa). Só aceita mensagem da própria origem.
//
// 08/10/2026 — AO VIVO × PRÉVIA: a mensagem passou a ser a TELA inteira
// (TelaTv: item, relógio, pausada ou offline, com o aviso geral por cima).
// A `chave` decide quando remontar: mesma chave = nada muda (o vídeo não
// recomeça a cada atualização). Vídeo que acaba avisa a gestão
// (tv-previa-fim), que passa para o próximo item da prévia.
// =====================================================================

type Msg = { tipo: "tv-previa"; item: ItemTv | null } | { tipo: "tv-tela"; tela: TelaTv | null };

export default function TvPrevia() {
  const [tela, setTela] = useState<TelaTv | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    const ouvir = (e: MessageEvent<Msg>) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.tipo === "tv-tela") { setTela(e.data.tela); return; }
      // Formato antigo (um item só): remonta a cada mensagem.
      if (e.data?.tipo === "tv-previa") {
        setVersao((v) => v + 1);
        setTela(e.data.item ? { modo: "item", item: e.data.item, chave: `antigo|${Date.now()}` } : null);
      }
    };
    window.addEventListener("message", ouvir);
    // Avisa a gestão que está pronta para receber a tela atual.
    window.parent?.postMessage({ tipo: "tv-previa-pronta" }, window.location.origin);
    return () => window.removeEventListener("message", ouvir);
  }, []);

  const fim = () => window.parent?.postMessage({ tipo: "tv-previa-fim" }, window.location.origin);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      {!tela ? <div className="flex h-full items-center justify-center text-[3vh] text-white/50">Preencha o item para ver a prévia</div>
        : tela.modo === "item" ? <Item key={`${tela.chave}|${versao}`} item={tela.item} sozinho={false} aoAcabar={fim} token="" previa inicioS={tela.inicioS ?? 0} />
        : tela.modo === "relogio" ? <Ocioso nome={tela.nome} />
        : tela.modo === "pausada" ? <Centro titulo={tela.nome} sub="TV pausada no ERP" />
        : <Centro titulo={`${tela.nome} está offline`} sub={`A TV não fala com o ERP desde ${tela.visto}. Quando voltar, ela retoma a playlist sozinha.`} />}
      {tela && tela.modo !== "offline" && tela.alerta && <Alerta texto={tela.alerta.texto} cor={tela.alerta.cor} />}
    </div>
  );
}
