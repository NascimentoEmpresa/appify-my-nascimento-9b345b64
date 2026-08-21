import { useEffect, useReducer } from "react";
import { tvDebugAtivo, coletarInfoAparelho, type TvDebugEntry } from "@/lib/tvDebug";

// Overlay de diagnóstico para TVs sem DevTools. Texto grande, alto contraste e
// DELIBERADAMENTE sem efeitos (nada de box-shadow / filter / backdrop-filter /
// canvas): se ISTO aparece na TV mas o painel neon não, a causa é a pintura
// pesada/GPU, não JS. Usa top/right/bottom/left longhand (não `inset`) de
// propósito, pra não depender de nada moderno. Ligado só com ?debug=1.
export function TvDebugOverlay() {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const ativo = tvDebugAtivo();

  useEffect(() => {
    if (!ativo) return;
    (globalThis as any).__tvDebugNotify = force;
    const t = setInterval(force, 1000); // re-render pra puxar erros novos
    return () => {
      clearInterval(t);
      (globalThis as any).__tvDebugNotify = undefined;
    };
  }, [ativo]);

  if (!ativo) return null;

  const buf: TvDebugEntry[] = (globalThis as any).__tvDebugBuf || [];
  const info = coletarInfoAparelho();

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 2147483647,
        background: "#000",
        color: "#39ff14",
        fontFamily: "monospace",
        fontSize: 18,
        lineHeight: 1.4,
        padding: 16,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      <div style={{ color: "#fff", fontSize: 24, marginBottom: 10 }}>✅ TV DEBUG VIVO</div>
      {info.map((l, i) => (
        <div key={`info-${i}`} style={{ color: "#77ddff" }}>
          {l}
        </div>
      ))}
      <div style={{ color: "#fff", margin: "14px 0 6px", fontSize: 20 }}>
        — erros / logs capturados ({buf.length}) —
      </div>
      {buf.length === 0 && <div style={{ color: "#888" }}>nenhum erro capturado ainda</div>}
      {buf.map((e, i) => (
        <div
          key={`log-${i}`}
          style={{
            color: e.kind === "error" || e.kind === "reject" || e.kind === "console.error" ? "#ff5555" : "#39ff14",
            marginBottom: 8,
          }}
        >
          [{e.kind}] {e.msg}
        </div>
      ))}
    </div>
  );
}
