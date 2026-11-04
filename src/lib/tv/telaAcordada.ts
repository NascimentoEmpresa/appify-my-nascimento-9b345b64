// =====================================================================
// TELA ACORDADA — o player das TVs (/tv, /tv/<chave>) não pode deixar o
// aparelho apagar a tela nem entrar em "soneca".
//
// 04/11/2026 — "algumas TVs estão desligando a tela / entrando em modo
// soneca". O player já pedia o Screen Wake Lock desde 07/10, mas de um jeito
// que não segurava:
//   · o navegador SOLTA o lock sozinho (aba oculta, bateria/energia baixa,
//     troca de app, às vezes sem motivo aparente) e só pedíamos de novo no
//     `visibilitychange` — um `release` com a página visível deixava a TV sem
//     lock até alguém recarregar. Agora: ouve o `release`, confere a cada
//     minuto e pede de novo;
//   · navegador de TV SEM a API (Tizen/webOS antigos, WebView de Android TV,
//     http sem HTTPS) ficava sem nada. Agora cai na técnica do NoSleep: um
//     vídeo mudo, inline, de 2×2 px, tocando — tocar vídeo é o que o
//     navegador entende como "alguém assistindo". O vídeo sai de um <canvas>
//     (captureStream), então não há arquivo nem base64 para manter;
//   · desde 03/11 a TV não fala mais com o servidor sozinha (TV SEM BUSCA
//     AUTOMÁTICA, TvPlayer.tsx) e um relatório fica parado o dia todo: alguns
//     aparelhos dormem por IMAGEM ESTÁTICA (proteção de tela da própria TV).
//     O player desloca a tela 1 px a cada minuto (ciclo de 4 posições) — é
//     invisível de longe e já tira a imagem do "parado". Esses timers são só
//     locais, NÃO fazem requisição (não contrariam a decisão de 03/11).
//
// O que NÃO dá para resolver por aqui (configuração do aparelho): o
// "desligamento automático" por falta de uso do CONTROLE (Samsung: Geral ›
// Gerenciamento de energia › Desligamento automático / Eco; LG: Geral ›
// Economia de energia / "Desligar automaticamente após 4 h"), timer de
// desligamento e proteção de tela do sistema. Essas desligam a TV mesmo com
// vídeo tocando — precisa desligar no menu da TV.
//
// O resultado (wl = wake lock, vd = vídeo, x = nada) vai no `tela` que a TV
// manda ao ERP (aparece na gestão), no console e em data-tela-acordada.
// =====================================================================

export type ModoTelaAcordada = "pendente" | "wakelock" | "video" | "nenhum";

/** Rótulo curto para o campo `tela` (o banco guarda 30 letras). */
export function rotuloTelaAcordada(modo: ModoTelaAcordada): string {
  return modo === "wakelock" ? "wl" : modo === "video" ? "vd" : modo === "nenhum" ? "x" : "";
}

/**
 * Deslocamento anti-imagem-estática: 4 posições em quadrado (0,0 → 1,0 →
 * 1,1 → 0,1 → …), 1 px por passo, nunca sai mais que 1 px do lugar.
 */
export function deslocamentoAntiEstatica(passo: number): { x: number; y: number } {
  const p = ((Math.trunc(passo) % 4) + 4) % 4;
  return { x: p === 1 || p === 2 ? 1 : 0, y: p >= 2 ? 1 : 0 };
}

export const CONFERE_LOCK_MS = 60_000;
export const PASSO_ANTI_ESTATICA_MS = 60_000;

type Lock = { released?: boolean; release?: () => Promise<void>; addEventListener?: (t: "release", f: () => void) => void };
type Video = { play: () => Promise<void> | void; pause: () => void; remove: () => void; paused?: boolean };

export interface DepsTelaAcordada {
  /** navigator.wakeLock (undefined = navegador sem a API). */
  wakeLock?: { request: (tipo: "screen") => Promise<Lock> };
  documento: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  /** Cria o vídeo-reserva já no DOM (null = não dá para criar). */
  criarVideo: () => Video | null;
  aoMudar?: (modo: ModoTelaAcordada) => void;
  setInterval?: (f: () => void, ms: number) => number;
  clearInterval?: (id: number) => void;
}

/**
 * Mantém a tela acordada enquanto a função devolvida não for chamada.
 * Ordem: wake lock → vídeo-reserva → nada (só avisa).
 */
export function manterTelaAcordada(deps: DepsTelaAcordada): () => void {
  const agendar = deps.setInterval ?? ((f, ms) => window.setInterval(f, ms));
  const cancelar = deps.clearInterval ?? ((id) => window.clearInterval(id));
  let ativo = true;
  let modo: ModoTelaAcordada = "pendente";
  let lock: Lock | null = null;
  let pedindo = false;
  let video: Video | null = null;

  const mudar = (m: ModoTelaAcordada) => {
    if (m === modo) return;
    modo = m;
    deps.aoMudar?.(m);
  };
  const visivel = () => deps.documento.visibilityState === "visible";

  const tocarVideo = async () => {
    if (!ativo) return;
    if (!video) video = deps.criarVideo();
    if (!video) { mudar("nenhum"); return; }
    try { await video.play(); if (ativo) mudar("video"); }
    catch { if (ativo) mudar("nenhum"); }   // autoplay barrado: tenta de novo no próximo toque do controle
  };
  const pararVideo = () => { if (video) { video.pause(); video.remove(); video = null; } };

  const pedirLock = async () => {
    if (!ativo || pedindo || !visivel()) return;
    if (lock && !lock.released) return;
    if (!deps.wakeLock) { await tocarVideo(); return; }
    pedindo = true;
    try {
      const l = await deps.wakeLock.request("screen");
      if (!ativo) { l.release?.().catch?.(() => {}); return; }
      lock = l;
      l.addEventListener?.("release", () => {
        if (lock === l) lock = null;
        // Soltou com a página na tela: pede de novo já (não espera o minuto).
        if (ativo && visivel()) void pedirLock();
      });
      pararVideo();
      mudar("wakelock");
    } catch {
      // NotAllowedError (política, energia baixa, sem HTTPS): reserva.
      lock = null;
      await tocarVideo();
    } finally {
      pedindo = false;
    }
  };

  const aoVisibilidade = () => { if (visivel()) { void pedirLock(); if (video?.paused) void tocarVideo(); } };
  // Gesto do controle/teclado libera autoplay barrado e reconfirma o lock.
  const aoGesto = () => { if (modo === "nenhum" || modo === "video") void tocarVideo(); void pedirLock(); };

  deps.documento.addEventListener("visibilitychange", aoVisibilidade);
  deps.documento.addEventListener("keydown", aoGesto);
  deps.documento.addEventListener("pointerdown", aoGesto);
  const conferir = agendar(() => { void pedirLock(); if (video?.paused) void tocarVideo(); }, CONFERE_LOCK_MS);
  void pedirLock();

  return () => {
    ativo = false;
    cancelar(conferir);
    deps.documento.removeEventListener("visibilitychange", aoVisibilidade);
    deps.documento.removeEventListener("keydown", aoGesto);
    deps.documento.removeEventListener("pointerdown", aoGesto);
    lock?.release?.().catch?.(() => {});
    lock = null;
    pararVideo();
  };
}

/**
 * Vídeo-reserva (NoSleep) a partir de um canvas 2×2 que troca de cor a cada
 * segundo (stream sem quadro novo pode ser tratado como parado). Fica no
 * canto, quase transparente — NÃO display:none nem fora da tela: o Chrome
 * pausa vídeo mudo que não está na área visível.
 */
export function criarVideoReserva(doc: Document = document): Video | null {
  try {
    const canvas = doc.createElement("canvas");
    canvas.width = 2; canvas.height = 2;
    const ctx = canvas.getContext("2d");
    const captura = (canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }).captureStream;
    if (!ctx || typeof captura !== "function") return null;
    let n = 0;
    const pintar = () => { ctx.fillStyle = n++ % 2 ? "#000" : "#010101"; ctx.fillRect(0, 0, 2, 2); };
    pintar();
    const pintor = window.setInterval(pintar, 1000);
    const v = doc.createElement("video");
    v.muted = true; v.defaultMuted = true; v.autoplay = true; v.loop = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;max-width:none;max-height:none;opacity:0.01;pointer-events:none;z-index:2147483647";
    v.srcObject = captura.call(canvas, 1);
    doc.body.appendChild(v);
    return {
      play: () => v.play(),
      pause: () => v.pause(),
      get paused() { return v.paused; },
      remove: () => {
        window.clearInterval(pintor);
        (v.srcObject as MediaStream | null)?.getTracks().forEach((t) => t.stop());
        v.srcObject = null; v.remove();
      },
    };
  } catch {
    return null;
  }
}
