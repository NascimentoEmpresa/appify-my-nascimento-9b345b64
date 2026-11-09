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
// 09/11/2026 — "a TV do compras fica desligando nesse painel". O player já
// tinha tudo acima, mas com dois buracos:
//   · o vídeo só tocava quando o wake lock FALHAVA. Navegador de TV que diz
//     "lock concedido" e não segura (o sistema da TV não respeita) ficava sem
//     reserva, e a gestão mostrava "wl" como se estivesse tudo bem. Agora o
//     vídeo toca SEMPRE, junto com o lock (wv = os dois);
//   · o vídeo saía de canvas.captureStream, que navegador de TV antigo não
//     tem (justamente quem mais precisa da reserva) — ali caía em "x". Agora é
//     um arquivo de verdade embutido no código (MP4 H.264 e WebM, ~1 KB cada,
//     16×16, 2 s, data: URI): NENHUMA requisição, nem ao banco nem ao Storage.
//     Foram gravados com MediaRecorder num canvas de quadros quase pretos.
//
// O que NÃO dá para resolver por aqui (configuração do aparelho): o
// "desligamento automático" por falta de uso do CONTROLE (Samsung: Geral ›
// Gerenciamento de energia › Desligamento automático / Eco; LG: Geral ›
// Economia de energia / "Desligar automaticamente após 4 h"), timer de
// desligamento e proteção de tela do sistema. Essas desligam a TV mesmo com
// vídeo tocando — precisa desligar no menu da TV.
//
// O resultado (wl = wake lock, vd = vídeo, wv = os dois, x = nada) vai no `tela` que a TV
// manda ao ERP (aparece na gestão), no console e em data-tela-acordada.
// =====================================================================

export type ModoTelaAcordada = "pendente" | "wakelock" | "video" | "ambos" | "nenhum";

/** Rótulo curto para o campo `tela` (o banco guarda 30 letras). */
export function rotuloTelaAcordada(modo: ModoTelaAcordada): string {
  return modo === "ambos" ? "wv" : modo === "wakelock" ? "wl" : modo === "video" ? "vd" : modo === "nenhum" ? "x" : "";
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
 * Wake lock E vídeo-reserva ao mesmo tempo (um não substitui o outro, ver
 * 09/11/2026 no topo); sem nenhum dos dois, só avisa.
 */
export function manterTelaAcordada(deps: DepsTelaAcordada): () => void {
  const agendar = deps.setInterval ?? ((f, ms) => window.setInterval(f, ms));
  const cancelar = deps.clearInterval ?? ((id) => window.clearInterval(id));
  let ativo = true;
  let iniciando = true;
  let modo: ModoTelaAcordada = "pendente";
  let lock: Lock | null = null;
  let pedindo = false;
  let video: Video | null = null;
  let videoTocando = false;

  const avaliar = () => {
    if (!ativo || iniciando) return;
    const temLock = !!lock && !lock.released;
    const m: ModoTelaAcordada = temLock && videoTocando ? "ambos" : temLock ? "wakelock" : videoTocando ? "video" : "nenhum";
    if (m === modo) return;
    modo = m;
    deps.aoMudar?.(m);
  };
  const visivel = () => deps.documento.visibilityState === "visible";

  const tocarVideo = async () => {
    if (!ativo) return;
    if (!video) video = deps.criarVideo();
    if (!video) { videoTocando = false; avaliar(); return; }
    try { await video.play(); videoTocando = true; }
    catch { videoTocando = false; }   // autoplay barrado: tenta de novo no próximo toque do controle
    avaliar();
  };
  const garantirVideo = () => { if (!video || video.paused || !videoTocando) void tocarVideo(); };
  const pararVideo = () => { if (video) { video.pause(); video.remove(); video = null; } videoTocando = false; };

  const pedirLock = async () => {
    if (!ativo || pedindo || !visivel() || !deps.wakeLock) return;
    if (lock && !lock.released) return;
    pedindo = true;
    try {
      const l = await deps.wakeLock.request("screen");
      if (!ativo) { l.release?.().catch?.(() => {}); return; }
      lock = l;
      l.addEventListener?.("release", () => {
        if (lock === l) lock = null;
        avaliar();
        // Soltou com a página na tela: pede de novo já (não espera o minuto).
        if (ativo && visivel()) void pedirLock();
      });
    } catch {
      // NotAllowedError (política, energia baixa, sem HTTPS): fica o vídeo.
      lock = null;
    } finally {
      pedindo = false;
      avaliar();
    }
  };

  const aoVisibilidade = () => { if (visivel()) { void pedirLock(); garantirVideo(); } };
  // Gesto do controle/teclado libera autoplay barrado e reconfirma o lock.
  const aoGesto = () => { garantirVideo(); void pedirLock(); };

  deps.documento.addEventListener("visibilitychange", aoVisibilidade);
  deps.documento.addEventListener("keydown", aoGesto);
  deps.documento.addEventListener("pointerdown", aoGesto);
  const conferir = agendar(() => { if (visivel()) { void pedirLock(); garantirVideo(); } }, CONFERE_LOCK_MS);
  // Um aviso só com o resultado dos dois (sem "wakelock" e logo depois "ambos").
  void Promise.all([tocarVideo(), pedirLock()]).finally(() => { iniciando = false; avaliar(); });

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

// Vídeos de 16×16, 2 s, quadros quase pretos (ver 09/11/2026 no topo). MP4
// primeiro: H.264 é o que todo decodificador de TV entende.
const VIDEO_RESERVA_MP4 = "data:video/mp4;base64,AAAAJGZ0eXBpc29tAAACAGlzb21pc282aXNvMmF2YzFtcDQxAAACyW1vb3YAAAB4bXZoZAEAAAAAAAAA5xdyyAAAAADnF3LIAAAD6AAAAAAAAAf5AAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAIhdHJhawAAAGh0a2hkAQAAAwAAAADnF3LIAAAAAOcXcsgAAAABAAAAAAAAAAAAAAf5AAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAQAAAAEAAAAAABsW1kaWEAAAAsbWRoZAEAAAAAAAAA5xdyyAAAAADnF3LIAAB1MAAAAAAAAAf5VcQAAAAAAC1oZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAVmlkZW9IYW5kbGVyAAAAAVBtaW5mAAAAFHZtaGQAAAABAAAAAAAAAAAAAAAlZGluZgAAAB1kcmVmAAAAAAAAAAEAAAANdXJsIAAAAAEAAAABD3N0YmwAAAAQc3RzYwAAAAAAAAAAAAAAEHN0dHMAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAMNzdHNkAAAAAAAAAAEAAACzYXZjMQAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAQABAASAAAAEgAAAAAAAAAAQtBVkMxIENvZGluZwAAAAAAAAAAAAAAAAAAAAAAAAAAABj//wAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAAAAAAAAAAAAACZhdmNDAULACv/hAA9nQsAKjGnJqDAwMDwiEagBAARozjyAAAAAE2NvbHJuY2x4AAYABgAGAAAAAChtdmV4AAAAIHRyZXgAAAAAAAAAAQAAAAEAAAAAAAAAAAAAAAAAAACobW9vZgAAABBtZmhkAAAAAAAAAAEAAACQdHJhZgAAABR0ZmhkAAIAIAAAAAEBAQAAAAAAFHRmZHQBAAAAAAAAAAAAAAAAAABgdHJ1bgEAAwUAAAAJAAAAsAIAAAAAAB5VAAAAEQAAHVwAAAAKAAAdfAAAAAsAABwLAAAAFAAAHZ8AAAAUAAAdZQAAABQAAB24AAAAFAAAHWAAAAAUAAAD5wAAABQAAACmbWRhdAAAAA1luAAEf//+HooAAgR/AAAABmHgAH5HqAAAAAdh4AC+QfqAAAAAEGHgAP5A3+Mu7u7u7u7u7vAAAAAQYeABPkDf4yqqqqqqqqqqsAAAABBh4AF+QN/jLu7u7u7u7u7wAAAAEGHgAb5Av+MqqqqqqqqqqrAAAAAQYeAB/kH/jLu7u7u7u7u7wAAAABBh4AI+Qf+MqqqqqqqqqqrAAAAATG1mcmEAAAA0dGZyYQEAAAAAAAABAAAAPwAAAAEAAAAAAAAAAAAAAAAAAALtAAAAAQAAAAEAAAABAAAAEG1mcm8AAAAAAAAATA==";
const VIDEO_RESERVA_WEBM = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYECGFOAZwEAAAAAAAMOEU2bdLlNu4tTq4QVSalmU6yBbk27i1OrhBZUrmtTrIGTTbuLU6uEH0O2dVOsgcFNu4xTq4QcU7trU6yCAvzsrgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmoCrXsYMPQkBEiYRE+9hiTYCGQ2hyb21lV0GGQ2hyb21lFlSua6mup9eBAXPFh91mAybWW3WDgQFV7oEBhoVWX1ZQOOCKsIEQuoEQU8CBAR9DtnUBAAAAAAACL+eBAKDNoaOBAAAAEAIAnQEqEAAQAAEHCIWFiJmEiAYCAAwNYAD+/m0QAHWhpaaj7oEBpZ4QAgCdASoQABAABIcIhYWImYSIGAIADA1gAP72pQCguaGZgQD6ALEBAAQQTAAYADA/9AwAAAD+/TZoAHWhmKaW7oEBpZGxAQASEPAAGAAYWC/0AAgAAPuBAKC5oZmBAgEAsQEABBBEABgAMD/0DAAAAP79XQgAdaGYppbugQGlkbEBABIRDAAYABhYL/QACAAA+4H6oLqhmYEC9QCxAQAEECwAGAAwP/QMAAAA/v6lNgB1oZimlu6BAaWRsQEAEhEoABgAGFgv9AAIAAD7ggIBoLqhmYED6QCxAQAEECQAGAAwP/QMAAAA/v7oWAB1oZimlu6BAaWRsQEAEhFMABgAGFgv9AAIAAD7ggL1oLqhmYEE5wCxAQAEECAAGAAwP/QMAAAA/v8NZAB1oZimlu6BAaWRsQEAEhFoABgAGFgv9AAIAAD7ggPpoLqhmYEF5wCxAQAEEBwAGAAwP/QMAAAA/v9VIAB1oZimlu6BAaWRsQEAEhGMABgAGFgv9AAIAAD7ggTnoLmhmIEG4wCRAQAEEEQUYADA/9AwAAD+/W5IAHWhmKaW7oEBpZGxAQASEEAUYABhYL/QACAAAPuCBeeguqGZgQfeALEBAAQQFAAYADA/9AwAAAD+/4hiAHWhmKaW7oEBpZGxAQASEcAAGAAYWC/0AAgAAPuCBuMcU7trjbuLs4EAt4b3gQHxgcE=";

/**
 * Vídeo-reserva (técnica do NoSleep): arquivo real embutido, em loop. Fica no
 * canto, quase transparente — NÃO display:none nem fora da tela: o Chrome
 * pausa vídeo mudo que não está na área visível.
 */
export function criarVideoReserva(doc: Document = document): Video | null {
  try {
    const v = doc.createElement("video");
    v.muted = true; v.defaultMuted = true; v.autoplay = true; v.loop = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.setAttribute("aria-hidden", "true");
    v.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;max-width:none;max-height:none;opacity:0.01;pointer-events:none;z-index:2147483647";
    for (const [src, type] of [[VIDEO_RESERVA_MP4, "video/mp4"], [VIDEO_RESERVA_WEBM, "video/webm"]]) {
      const fonte = doc.createElement("source");
      fonte.src = src; fonte.type = type;
      v.appendChild(fonte);
    }
    doc.body.appendChild(v);
    return {
      play: () => v.play(),
      pause: () => v.pause(),
      get paused() { return v.paused; },
      remove: () => { v.pause(); v.remove(); },
    };
  } catch {
    return null;
  }
}
