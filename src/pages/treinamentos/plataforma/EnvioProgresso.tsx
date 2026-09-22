import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudUpload, Film } from "lucide-react";

// =====================================================================
// TREINAMENTOS — cartão de envio de vídeo (22/09/2026).
// "Deixa um carregamento bonitinho quando tiver enviando o vídeo" (Pablo).
// Nome/tamanho do arquivo, barra com brilho correndo, %, MB enviados,
// velocidade e tempo restante (média móvel dos últimos ~5 s, pra não pular).
// =====================================================================

export interface EstadoEnvio { nome: string; enviado: number; total: number }

const mb = (b: number) => (b / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: b < 10 * 1024 * 1024 ? 1 : 0 });
const tempo = (s: number) => {
  if (!isFinite(s) || s <= 0) return "";
  if (s < 60) return `${Math.ceil(s)} s`;
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m < 60 ? `${m} min ${String(r).padStart(2, "0")} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

export function EnvioProgresso({ envio }: { envio: EstadoEnvio }) {
  const pct = envio.total ? Math.min(100, (envio.enviado / envio.total) * 100) : 0;
  const amostras = useRef<{ t: number; b: number }[]>([]);
  const [velocidade, setVelocidade] = useState(0); // bytes/s

  useEffect(() => {
    const agora = performance.now();
    const a = amostras.current;
    a.push({ t: agora, b: envio.enviado });
    while (a.length > 2 && agora - a[0].t > 5000) a.shift();
    if (a.length >= 2) {
      const dt = (a[a.length - 1].t - a[0].t) / 1000;
      if (dt > 0.3) setVelocidade((a[a.length - 1].b - a[0].b) / dt);
    }
  }, [envio.enviado]);

  const terminou = pct >= 100;
  const restante = velocidade > 0 ? (envio.total - envio.enviado) / velocidade : NaN;

  return (
    <div className="relative mt-2 overflow-hidden rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50 p-4 shadow-sm">
      <style>{`
        @keyframes trn-brilho { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        @keyframes trn-sobe { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
      `}</style>
      <div className="flex items-center gap-3">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${terminou ? "bg-emerald-500" : "bg-gradient-to-br from-orange-500 to-amber-500"} text-white shadow`}>
          {terminou
            ? <CheckCircle2 className="h-6 w-6" />
            : <CloudUpload className="h-6 w-6" style={{ animation: "trn-sobe 1.4s ease-in-out infinite" }} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Film className="h-3.5 w-3.5 shrink-0 text-orange-500" />
            <span className="truncate" title={envio.nome}>{envio.nome}</span>
          </div>
          <div className="text-xs text-slate-500">
            {terminou
              ? "Finalizando…"
              : <>{mb(envio.enviado)} de {mb(envio.total)} MB{velocidade > 0 && <> · {mb(velocidade)} MB/s{restante > 0 && <> · falta{restante >= 2 ? "m" : ""} ~{tempo(restante)}</>}</>}</>}
          </div>
        </div>
        <div className={`text-2xl font-black tabular-nums ${terminou ? "text-emerald-600" : "text-orange-600"}`}>{Math.floor(pct)}%</div>
      </div>

      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-orange-100">
        <div
          className={`relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out ${terminou ? "bg-emerald-500" : "bg-gradient-to-r from-orange-500 via-amber-400 to-orange-500"}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        >
          {!terminou && (
            <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                 style={{ animation: "trn-brilho 1.3s linear infinite" }} />
          )}
        </div>
      </div>

      {!terminou && (
        <p className="mt-2 text-[11px] text-slate-500">
          Não feche esta página até terminar. Se a internet oscilar, o envio continua de onde parou.
        </p>
      )}
    </div>
  );
}
