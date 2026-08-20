// Console de tela para aparelhos SEM DevTools (ex.: Smart TV / Android TV).
// Ligado só com ?debug=1 na URL (ou localStorage.tvdebug="1"). Captura erros
// globais, promessas rejeitadas e console.error/warn num buffer que o
// TvDebugOverlay pinta em texto grande. Não roda pra usuário normal.

export type TvDebugEntry = { kind: string; msg: string; ts: number };

const g = globalThis as any;

export function tvDebugAtivo(): boolean {
  try {
    const p = new URLSearchParams(window.location.search);
    return p.get("debug") === "1" || localStorage.getItem("tvdebug") === "1";
  } catch {
    return false;
  }
}

function fmt(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack || a.message;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

// Instala os captadores UMA vez. Chamar em main.tsx ANTES do render pra pegar
// também os erros que estouram durante a montagem do componente da TV.
export function initTvDebug(): void {
  if (g.__tvDebugInit) return;
  g.__tvDebugInit = true;
  const buf: TvDebugEntry[] = (g.__tvDebugBuf = g.__tvDebugBuf || []);
  const push = (kind: string, msg: string) => {
    buf.push({ kind, msg, ts: Date.now() });
    if (buf.length > 200) buf.shift();
    g.__tvDebugNotify?.();
  };

  window.addEventListener("error", (e: ErrorEvent) => {
    const base = e.error?.stack || e.message || String(e);
    push("error", e.filename ? `${base} @ ${e.filename}:${e.lineno}:${e.colno}` : base);
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    push("reject", fmt(e.reason));
  });

  const origErr = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    push("console.error", args.map(fmt).join(" "));
    origErr(...args);
  };
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    push("console.warn", args.map(fmt).join(" "));
    origWarn(...args);
  };

  push("info", "TV debug ligado");
}

// Infos do aparelho úteis pra achar a causa da tela preta: viewport, DPR e —
// principalmente — a GPU real (via WEBGL_debug_renderer_info). GPU de Android
// TV fraca em 4K é o suspeito nº 1 de camada composta que não rasteriza.
export function coletarInfoAparelho(): string[] {
  const linhas: string[] = [];
  try {
    linhas.push(`UA: ${navigator.userAgent}`);
    linhas.push(`viewport: ${window.innerWidth}x${window.innerHeight} · dpr: ${window.devicePixelRatio}`);
    linhas.push(`screen: ${screen.width}x${screen.height}`);
  } catch (e) {
    linhas.push(`info erro: ${fmt(e)}`);
  }
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : "(sem extensão)";
      const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : "(sem extensão)";
      linhas.push(`GPU: ${vendor} · ${renderer}`);
    } else {
      linhas.push("GPU: SEM contexto WebGL (aceleração desligada?)");
    }
  } catch (e) {
    linhas.push(`GPU erro: ${fmt(e)}`);
  }
  return linhas;
}
