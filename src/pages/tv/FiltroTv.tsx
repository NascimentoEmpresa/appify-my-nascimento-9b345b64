import { useEffect, useMemo, useState } from "react";
import bigodinhoNatal from "@/assets/bigodinho-natal.webp";
import type { FiltroTv } from "@/lib/tv/tv";

// =====================================================================
// FILTROS DE TELA das TVs (18/11/2026, mig 20261119060000)
//
// Pablo, com o mascote de Natal: "filtros pras TVs, por enquanto só o de
// Natal — ao adicionar, todas as TVs ficam com esse filtro". Liga/desliga em
// Sistemas › TV's › Filtros (TV_CONFIG, global); a TV recebe no tv_estado.
//
// É uma camada POR CIMA do que a TV mostra, com pointer-events: none, e não
// pode atrapalhar a leitura nem pesar: as TVs rodam o dia inteiro.
//   · só CSS (transform/opacity, que o navegador anima sem redesenhar a
//     página); nada de canvas em loop nem biblioteca;
//   · neve pequena e translúcida; estrelinhas e brilhos só nas bordas, longe
//     dos números;
//   · o bigodinho fica pequeno espiando pela borda, troca de lugar a cada ~40 s (timer
//     local, sem rede) e balança de leve;
//   · anima sempre, mesmo com prefers-reduced-motion (ver CSS_NATAL);
//   · pisca-pisca colorido no topo da tela.
// Filtro novo: um case aqui + FILTROS_TV (src/lib/tv/tv.ts) + o CHECK da TV_CONFIG.
// =====================================================================

export function CamadaFiltroTv({ filtro }: { filtro: FiltroTv | null | undefined }) {
  if (filtro === "natal") return <FiltroNatal />;
  return null;
}

// Determinístico: a mesma TV desenha a mesma neve (sem Math.random a cada render).
function pseudo(n: number): number {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

/**
 * Onde o bigodinho aparece: ESPIANDO pelas bordas laterais, com mais da metade
 * fora da tela, para ficar só na margem. No canto de baixo inteiro ele cobria
 * "Meta/Onde/Causa/Dono" dos cards (teste de 18/11/2026 na TV Licitações).
 * Longe do cabeçalho (relógio e placar). Largura do mascote ≈ 12vh (2:3 de 18vh).
 */
const CANTOS: React.CSSProperties[] = [
  { left: "-6.4vh", bottom: "8vh", transform: "rotate(12deg)" },
  { right: "-6.4vh", bottom: "8vh", transform: "rotate(-12deg)" },
  { left: "-6.4vh", bottom: "46vh", transform: "rotate(14deg)" },
  { right: "-6.4vh", bottom: "46vh", transform: "rotate(-14deg)" },
];
const TROCA_CANTO_MS = 40_000;

function FiltroNatal() {
  const flocos = useMemo(() => Array.from({ length: 60 }, (_, k) => ({
    left: pseudo(k + 1) * 100,
    tamanho: 4 + pseudo(k + 101) * 7,
    queda: 9 + pseudo(k + 201) * 10,
    atraso: -pseudo(k + 301) * 19,
    balanco: 2.5 + pseudo(k + 401) * 2.5,
    opacidade: 0.55 + pseudo(k + 501) * 0.4,
  })), []);
  // Pisca-pisca no topo da tela: lâmpadas coloridas acendendo em sequência.
  const lampadas = useMemo(() => Array.from({ length: 34 }, (_, k) => ({
    left: 1.5 + k * (97 / 33),
    top: 0.9 + Math.sin((k / 33) * Math.PI * 6) ** 2 * 1.5,
    cor: LAMPADAS[k % LAMPADAS.length],
    atraso: -((k % 4) * 0.45),
  })), []);
  // Estrelas e brilhos só nas faixas das bordas (topo e laterais), onde não há número.
  const estrelas = useMemo(() => Array.from({ length: 18 }, (_, k) => {
    const lado = k % 3; // 0 topo · 1 esquerda · 2 direita
    const a = pseudo(k + 601), b = pseudo(k + 701);
    return {
      left: lado === 0 ? 3 + a * 94 : lado === 1 ? 0.4 + a * 1.6 : 98 - a * 1.6,
      top: lado === 0 ? 0.6 + b * 2.4 : 18 + b * 64,
      tamanho: 10 + pseudo(k + 801) * 12,
      ciclo: 2.2 + pseudo(k + 901) * 2.6,
      atraso: -pseudo(k + 1001) * 4,
      dourada: k % 2 === 0,
    };
  }), []);

  const [canto, setCanto] = useState(() => Math.floor(Math.random() * CANTOS.length));
  const [visivel, setVisivel] = useState(true);
  useEffect(() => {
    let troca: number | undefined;
    const t = window.setInterval(() => {
      setVisivel(false);
      troca = window.setTimeout(() => {
        setCanto((c) => (c + 1 + Math.floor(Math.random() * (CANTOS.length - 1))) % CANTOS.length);
        setVisivel(true);
      }, 900);
    }, TROCA_CANTO_MS);
    return () => { window.clearInterval(t); window.clearTimeout(troca); };
  }, []);

  return (
    <div aria-hidden className="tvf-natal pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 40 }}>
      {flocos.map((f, k) => (
        <span key={`f${k}`} className="tvf-floco" style={{
          left: `${f.left}%`, width: f.tamanho, height: f.tamanho, opacity: f.opacidade,
          animationDuration: `${f.queda}s`, animationDelay: `${f.atraso}s`,
        }}>
          <span className="tvf-floco-miolo" style={{ animationDuration: `${f.balanco}s` }} />
        </span>
      ))}
      <svg className="tvf-fio" viewBox="0 0 1000 40" preserveAspectRatio="none" aria-hidden>
        <path d="M0 6 Q 83 40 167 6 T 333 6 T 500 6 T 667 6 T 833 6 T 1000 6" fill="none" stroke="#2f4a33" strokeWidth="3" />
      </svg>
      {lampadas.map((l, k) => (
        <span key={`l${k}`} className="tvf-lampada" style={{ left: `${l.left}%`, top: `${l.top}vh`, color: l.cor, background: l.cor, animationDelay: `${l.atraso}s` }} />
      ))}
      {estrelas.map((e, k) => (
        <span key={`e${k}`} className="tvf-estrela" style={{
          left: `${e.left}%`, top: `${e.top}%`, width: e.tamanho, height: e.tamanho,
          color: e.dourada ? "#ffd86b" : "#ffffff", animationDuration: `${e.ciclo}s`, animationDelay: `${e.atraso}s`,
        }}>
          <svg viewBox="0 0 24 24" width="100%" height="100%"><path fill="currentColor" d="M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z" /></svg>
        </span>
      ))}
      <div className="tvf-bigodinho-lugar" style={{ ...CANTOS[canto], opacity: visivel ? 1 : 0 }}>
        <img src={bigodinhoNatal} alt="" className="tvf-bigodinho" draggable={false} />
      </div>
      <style>{CSS_NATAL}</style>
    </div>
  );
}

const LAMPADAS = ["#ff3b3b", "#ffd23f", "#3ddc84", "#4aa8ff"];

// 18/11/2026: a 1ª versão parava tudo com prefers-reduced-motion — e o PC do
// Pablo (Windows com "efeitos de animação" desligado) via só estrelas paradas.
// O filtro é decoração ligada de propósito na gestão: anima sempre.
const CSS_NATAL = `
.tvf-natal .tvf-floco { position: absolute; top: -12px; display: block; will-change: transform; animation-name: tvf-cair; animation-timing-function: linear; animation-iteration-count: infinite; }
.tvf-natal .tvf-floco-miolo { display: block; width: 100%; height: 100%; border-radius: 9999px; background: #fff; box-shadow: 0 0 8px 1px rgba(255,255,255,.9); animation-name: tvf-balancar-floco; animation-timing-function: ease-in-out; animation-iteration-count: infinite; animation-direction: alternate; }
.tvf-natal .tvf-estrela { position: absolute; display: block; filter: drop-shadow(0 0 4px currentColor); animation-name: tvf-piscar; animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
.tvf-natal .tvf-bigodinho-lugar { position: absolute; height: 18vh; transition: opacity .8s ease; }
.tvf-natal .tvf-bigodinho { height: 100%; width: auto; transform-origin: 50% 100%; filter: drop-shadow(0 6px 10px rgba(0,0,0,.35)); animation: tvf-wiggle 2.6s ease-in-out infinite; }
@keyframes tvf-cair { from { transform: translate3d(0, -2vh, 0); } to { transform: translate3d(0, 104vh, 0); } }
@keyframes tvf-balancar-floco { from { transform: translateX(-14px); } to { transform: translateX(14px); } }
@keyframes tvf-piscar { 0%, 100% { opacity: .15; transform: scale(.6); } 50% { opacity: .95; transform: scale(1); } }
@keyframes tvf-wiggle { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
.tvf-natal .tvf-fio { position: absolute; left: 0; top: 0; width: 100%; height: 3.4vh; }
.tvf-natal .tvf-lampada { position: absolute; width: 11px; height: 15px; margin-left: -5px; border-radius: 50% 50% 45% 45%; box-shadow: 0 0 10px 3px currentColor; animation: tvf-pisca 1.8s steps(1, end) infinite; }
@keyframes tvf-pisca { 0%, 49% { opacity: 1; } 50%, 100% { opacity: .25; box-shadow: none; } }
`;
