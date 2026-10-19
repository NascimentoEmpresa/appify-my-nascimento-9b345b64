// A animação comemorativa do aviso (16/10/2026, pedido do Pablo: "escolher uma
// animação na tela ao enviar o aviso, que mostre na prévia, confetes,
// estrelas, etc. quando for algo a comemorar").
//
// Um <canvas> por cima de tudo, sem biblioteca: confete/estrela/coração/fogos
// são umas poucas dezenas de partículas, e trazer uma lib de animação para
// isso pesaria no bundle de quem só quer ler o aviso. Toca uma vez (10 s),
// não recebe clique (pointer-events-none — o aviso continua respondível
// durante a festa) e some.
//
// prefers-reduced-motion: toca uma versão CURTA e calma (16/10/2026). Antes
// não tocava nada — e o Windows com "Efeitos de animação" desligado (o padrão
// em muita máquina da empresa) faz o navegador dizer reduce, então o Pablo
// não via confete nem na prévia. Versão reduzida: um terço das partículas,
// sem balanço, sem giro e sem piscar — movimento simples, que
// é o que a preferência pede, em vez de sumir com a comemoração.
//
// 10 SEGUNDOS (16/10/2026, pedido do Pablo: "deixa 10seg de animação dos
// confetes e outros"), nas duas versões — a reduzida é a que ele vê, com os
// efeitos do Windows desligados. Para durar sem nascer milhares de
// partículas, quem sai da tela RENASCE do lado de onde vem (confete no topo,
// estrela/coração embaixo) até faltar RENASCE_ATE_MS para o fim; daí a tela
// esvazia sozinha e o último segundo esmaece.
//
// O canvas vai num portal no <body>: dentro do Dialog do mural (que usa
// transform) o `fixed` ficava preso à caixa do diálogo.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Animacao } from "@/lib/notificacoes";

const DURACAO_MS = 10_000;
const DURACAO_REDUZIDA_MS = 10_000;
/** Até quanto antes do fim as partículas que saíram da tela voltam. */
const RENASCE_ATE_MS = 2500;
/** O esmaecimento final. */
const ESMAECE_MS = 1000;
const CORES = ["#f59e0b", "#ef4444", "#3b82f6", "#10b981", "#8b5cf6", "#ec4899", "#facc15"];

interface Particula {
  x: number; y: number; vx: number; vy: number;
  tam: number; giro: number; vgiro: number; cor: string; vida: number; fase: number;
}

const aleatorio = (a: number, b: number) => a + Math.random() * (b - a);
const cor = () => CORES[Math.floor(Math.random() * CORES.length)];

function prefereMenosMovimento(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  } catch {
    return false;
  }
}

function estrela(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const raio = i % 2 === 0 ? r : r * 0.45;
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    ctx.lineTo(Math.cos(ang) * raio, Math.sin(ang) * raio);
  }
  ctx.closePath();
  ctx.fill();
}

function coracao(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  ctx.moveTo(0, r * 0.35);
  ctx.bezierCurveTo(-r * 1.1, -r * 0.45, -r * 0.45, -r * 1.1, 0, -r * 0.45);
  ctx.bezierCurveTo(r * 0.45, -r * 1.1, r * 1.1, -r * 0.45, 0, r * 0.35);
  ctx.fill();
}

/** As partículas iniciais de cada tipo (os fogos ganham mais estouros no caminho). */
function nascer(tipo: Animacao, w: number, h: number, reduzido: boolean): Particula[] {
  const lista: Particula[] = [];
  const n = (k: number) => Math.round((k * Math.min(1, w / 1200) + k * 0.4) * (reduzido ? 0.35 : 1));
  if (tipo === "confetes") {
    for (let i = 0; i < n(110); i++) {
      // Reduzido: começa já na tela, para a festa aparecer de cara.
      lista.push({ x: aleatorio(0, w), y: reduzido ? aleatorio(-h * 0.2, h * 0.3) : aleatorio(-h * 0.6, -10), vx: aleatorio(-1.2, 1.2), vy: aleatorio(2, 4.5),
        tam: aleatorio(6, 11), giro: aleatorio(0, Math.PI), vgiro: aleatorio(-0.2, 0.2), cor: cor(), vida: 1, fase: aleatorio(0, 6) });
    }
  } else if (tipo === "estrelas" || tipo === "coracoes") {
    for (let i = 0; i < n(55); i++) {
      lista.push({ x: aleatorio(0, w), y: reduzido ? aleatorio(h * 0.5, h + 10) : h + aleatorio(10, h * 0.5), vx: aleatorio(-0.6, 0.6), vy: -aleatorio(1.8, 3.6),
        tam: aleatorio(7, 15), giro: aleatorio(0, Math.PI), vgiro: aleatorio(-0.04, 0.04),
        cor: tipo === "estrelas" ? (Math.random() < 0.7 ? "#facc15" : "#fde68a") : (Math.random() < 0.6 ? "#ef4444" : "#ec4899"),
        vida: 1, fase: aleatorio(0, 6) });
    }
  }
  return lista;
}

function estouro(lista: Particula[], w: number, h: number) {
  const x = aleatorio(w * 0.15, w * 0.85), y = aleatorio(h * 0.15, h * 0.5), c = cor();
  for (let i = 0; i < 46; i++) {
    const ang = (Math.PI * 2 * i) / 46, v = aleatorio(2, 5.5);
    lista.push({ x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, tam: aleatorio(2, 3.5), giro: 0, vgiro: 0,
      cor: Math.random() < 0.8 ? c : "#ffffff", vida: 1, fase: 0 });
  }
}

/**
 * Toca a animação uma vez. `chave` muda → toca de novo (o gate passando ao
 * próximo aviso, a prévia reaberta).
 */
export function AnimacaoAviso({ tipo, chave }: { tipo: Animacao | null | undefined; chave?: string | number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ativa, setAtiva] = useState(false);
  const reduzido = useRef(false);

  useEffect(() => {
    if (!tipo) { setAtiva(false); return; }
    reduzido.current = prefereMenosMovimento();
    setAtiva(true);
  }, [tipo, chave]);

  useEffect(() => {
    if (!ativa || !tipo) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const calmo = reduzido.current;
    const duracao = calmo ? DURACAO_REDUZIDA_MS : DURACAO_MS;
    const parts = nascer(tipo, w, h, calmo);
    if (calmo) for (const p of parts) { p.vgiro = 0; p.giro = 0; }
    const inicio = performance.now();
    let proximoEstouro = 0;
    let quadro = 0;

    const passo = (agora: number) => {
      const t = agora - inicio;
      ctx.clearRect(0, 0, w, h);
      // O último segundo esmaece tudo junto, em vez de cortar no meio.
      const fim = Math.max(0, Math.min(1, (duracao - t) / ESMAECE_MS));
      const renasce = t < duracao - RENASCE_ATE_MS;

      // Reduzido: estouros mais espaçados (1 a cada 1,5 s).
      if (tipo === "fogos" && t < duracao - 1200 && t >= proximoEstouro) {
        estouro(parts, w, h);
        proximoEstouro = t + (calmo ? 1500 : aleatorio(350, 650));
      }

      for (const p of parts) {
        if (tipo === "fogos") {
          p.vy += 0.06; p.vx *= 0.985; p.vy *= 0.985; p.vida -= 0.012;
        } else if (tipo === "confetes" && !calmo) {
          p.vx += Math.sin((t / 300) + p.fase) * 0.03;
        }
        p.x += p.vx; p.y += p.vy; p.giro += p.vgiro;
        if (renasce && tipo === "confetes" && p.y > h + 20) { p.y = aleatorio(-60, -10); p.x = aleatorio(0, w); }
        else if (renasce && (tipo === "estrelas" || tipo === "coracoes") && p.y < -20) { p.y = h + aleatorio(10, 60); p.x = aleatorio(0, w); }
        if (p.vida <= 0) continue;

        const piscar = tipo === "estrelas" && !calmo ? 0.55 + 0.45 * Math.sin(t / 160 + p.fase) : 1;
        ctx.globalAlpha = Math.max(0, p.vida * fim * piscar);
        ctx.fillStyle = p.cor;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.giro);
        if (tipo === "confetes") ctx.fillRect(-p.tam / 2, -p.tam / 4, p.tam, p.tam / 2);
        else if (tipo === "estrelas") estrela(ctx, p.tam);
        else if (tipo === "coracoes") coracao(ctx, p.tam);
        else { ctx.beginPath(); ctx.arc(0, 0, p.tam, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      // Fogos: as faíscas apagadas saem da lista (são ~46 por estouro, por 10 s).
      if (tipo === "fogos" && parts.length > 400) {
        for (let i = parts.length - 1; i >= 0; i--) if (parts[i].vida <= 0) parts.splice(i, 1);
      }

      if (t < duracao) quadro = requestAnimationFrame(passo);
      else setAtiva(false);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [ativa, tipo, chave]);

  if (!ativa || typeof document === "undefined") return null;
  // Portal no body, acima do gate (z-[100]), do Dialog (z-50) e da faixa da
  // prévia; não pega clique.
  return createPortal(
    <canvas ref={ref} aria-hidden="true" data-animacao-aviso={tipo ?? ""}
            className="pointer-events-none fixed inset-0 z-[200] h-full w-full" />,
    document.body,
  );
}
