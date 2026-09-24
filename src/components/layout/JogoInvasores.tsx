import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, X } from "lucide-react";

// =====================================================================
// CAÇA-BUGS — o joguinho da tela de queda (24/09/2026)
//
// Pedido do Pablo: "um joguinho no cantinho pro usuário ir se distraindo
// enquanto arrumamos o sistema — aquele jogo de nave antigo que dá
// tirinho" (Space Invaders). No mesmo dia: "visual completamente novo,
// baseado no estilo da empresa", "no celular não precisa" e "só abre se
// clicar num ícone de nave branco em algum canto".
//
// A história: os bugs derrubaram o sistema — você os derruba enquanto ele
// volta. A nave é o arco laranja do logo; os inimigos são bugs (laranja,
// branco e azul-claro, patinhas animadas) sobre o marinho do ERP; os
// escudos são placas translúcidas que se desgastam; explosão em
// partículas. Desenho vetorial em canvas com devicePixelRatio (nítido em
// qualquer tela), sobre uma grade lógica de 224×256.
//
// Regras de arcade: 5 fileiras × 11 bugs que andam de lado e descem na
// borda, mais rápidos quanto menos sobram; 1 tiro seu por vez; eles atiram
// de volta; 3 vidas; fase nova quando limpa a tela. Recorde no
// localStorage. Teclado: ← → (ou A/D) move, espaço (ou ↑/W) atira, P
// pausa, Esc fecha. Sem toque: em tela pequena/touch o jogo nem monta. O
// laço só roda com o painel aberto e a aba visível.
// =====================================================================

const W = 224, H = 256;
const COR = {
  laranja: "#f26b1d", laranja2: "#ff9a4d", branco: "#f5f8ff", azul: "#8fb4ff",
  marinho: "#0b2a63", fundo1: "#0f3171", fundo2: "#061636", vermelho: "#ff5c5c",
};
const CHAVE_RECORDE = "si-cacabugs-recorde";

type Tipo = "laranja" | "branco" | "azul";
interface Bug { x: number; y: number; tipo: Tipo; vivo: boolean }
interface Tiro { x: number; y: number; v: number }
interface Escudo { x: number; y: number; px: boolean[][] }
interface Particula { x: number; y: number; vx: number; vy: number; vida: number; cor: string }
interface Estado {
  fase: "inicio" | "jogando" | "pausa" | "morreu" | "fim";
  pontos: number; vidas: number; nivel: number; recorde: number;
  naveX: number; tiro: Tiro | null; tirosDeles: Tiro[];
  bugs: Bug[]; dir: 1 | -1; passoMs: number; acumPasso: number; quadro: 0 | 1;
  acumFogo: number; escudos: Escudo[]; particulas: Particula[]; pausaMorte: number;
  estrelas: { x: number; y: number; v: number; r: number }[];
}

const BUG_L = 11, BUG_A = 8, NAVE_L = 15, NAVE_Y = 226;
const PONTOS: Record<Tipo, number> = { laranja: 30, branco: 20, azul: 10 };
const COR_BUG: Record<Tipo, string> = { laranja: COR.laranja2, branco: COR.branco, azul: COR.azul };

function lerRecorde() { try { return Number(localStorage.getItem(CHAVE_RECORDE)) || 0; } catch { return 0; } }
function gravarRecorde(n: number) { try { localStorage.setItem(CHAVE_RECORDE, String(n)); } catch { /* sem storage: só não guarda */ } }

function novaOnda(nivel: number): Pick<Estado, "bugs" | "dir" | "passoMs" | "acumPasso" | "quadro"> {
  const bugs: Bug[] = [];
  const topo = 36 + Math.min(4, nivel - 1) * 8;
  (["laranja", "branco", "branco", "azul", "azul"] as Tipo[]).forEach((tipo, l) => {
    for (let c = 0; c < 11; c++) bugs.push({ x: 22 + c * 16, y: topo + l * 14, tipo, vivo: true });
  });
  return { bugs, dir: 1, passoMs: Math.max(150, 540 - (nivel - 1) * 60), acumPasso: 0, quadro: 0 };
}
// Escudo: grade de 2 px (11×7 células) em arco, como uma placa.
function novosEscudos(): Escudo[] {
  const forma = ["..XXXXXXX..", ".XXXXXXXXX.", "XXXXXXXXXXX", "XXXXXXXXXXX", "XXXXXXXXXXX", "XXX.....XXX", "XX.......XX"];
  return [0, 1, 2, 3].map((i) => ({ x: 22 + i * 52, y: 196, px: forma.map((l) => [...l].map((ch) => ch === "X")) }));
}
function novasEstrelas() {
  return Array.from({ length: 46 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 0.05 + Math.random() * 0.25, r: Math.random() < 0.15 ? 1 : 0.5 }));
}
function novoJogo(recorde: number): Estado {
  return { fase: "inicio", pontos: 0, vidas: 3, nivel: 1, recorde, naveX: W / 2 - NAVE_L / 2, tiro: null, tirosDeles: [],
    ...novaOnda(1), acumFogo: 0, escudos: novosEscudos(), particulas: [], pausaMorte: 0, estrelas: novasEstrelas() };
}

/** Acerto num escudo: apaga a célula e desgasta as vizinhas. */
function morderEscudo(es: Escudo[], x: number, y: number): boolean {
  for (const e of es) {
    const cx = Math.floor((x - e.x) / 2), cy = Math.floor((y - e.y) / 2);
    if (cx < 0 || cy < 0 || cy >= e.px.length || cx >= e.px[0].length || !e.px[cy][cx]) continue;
    e.px[cy][cx] = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const yy = cy + dy, xx = cx + dx;
      if (yy >= 0 && xx >= 0 && yy < e.px.length && xx < e.px[0].length && Math.random() < 0.35) e.px[yy][xx] = false;
    }
    return true;
  }
  return false;
}

function explodir(e: Estado, x: number, y: number, cores: string[], n = 14) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 0.4 + Math.random() * 1.4;
    e.particulas.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vida: 1, cor: cores[i % cores.length] });
  }
}

// ── desenho ────────────────────────────────────────────────────────────
function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function desenharBug(ctx: CanvasRenderingContext2D, b: Bug, quadro: 0 | 1) {
  const cx = b.x + BUG_L / 2, cy = b.y + BUG_A / 2 + 0.5, cor = COR_BUG[b.tipo];
  ctx.strokeStyle = cor; ctx.lineWidth = 0.8; ctx.lineCap = "round";
  // patinhas (alternam entre os dois quadros)
  const p = quadro ? 1 : -1;
  for (const s of [-1, 1]) for (const k of [-1.6, 0, 1.6]) {
    ctx.beginPath(); ctx.moveTo(cx + s * 2.5, cy + k * 0.9); ctx.lineTo(cx + s * 5.2, cy + k * 1.1 + p * (k === 0 ? 0.8 : -0.4)); ctx.stroke();
  }
  // antenas
  ctx.beginPath(); ctx.moveTo(cx - 1, cy - 3); ctx.lineTo(cx - 2.6, cy - 4.8 + (quadro ? 0.4 : 0)); ctx.moveTo(cx + 1, cy - 3); ctx.lineTo(cx + 2.6, cy - 4.8 + (quadro ? 0 : 0.4)); ctx.stroke();
  // corpo + cabeça
  ctx.fillStyle = cor; ctx.beginPath(); ctx.ellipse(cx, cy + 0.6, 2.9, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy - 2.6, 1.7, 0, Math.PI * 2); ctx.fill();
  // listra e olhos
  ctx.strokeStyle = COR.fundo2; ctx.lineWidth = 0.55; ctx.beginPath(); ctx.moveTo(cx, cy - 2.4); ctx.lineTo(cx, cy + 3.6); ctx.stroke();
  ctx.fillStyle = COR.fundo2; ctx.fillRect(cx - 1.1, cy - 3, 0.7, 0.7); ctx.fillRect(cx + 0.4, cy - 3, 0.7, 0.7);
}
/** A nave: base branca com o arco laranja do logo por cima. */
function desenharNave(ctx: CanvasRenderingContext2D, x: number, y: number, escala = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(escala, escala);
  ctx.shadowColor = "rgba(242,107,29,.8)"; ctx.shadowBlur = 6;
  ctx.fillStyle = COR.branco; rrect(ctx, 0, 5, NAVE_L, 4, 1.6); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = COR.laranja; ctx.lineWidth = 2.2; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.arc(NAVE_L / 2, 6, 4.6, Math.PI * 1.02, Math.PI * 1.98); ctx.stroke();
  ctx.fillStyle = COR.laranja; ctx.fillRect(NAVE_L / 2 - 4.6 - 1.1, 3.4, 2.2, 2.2);
  ctx.fillStyle = COR.laranja2; ctx.fillRect(NAVE_L / 2 - 0.6, -0.6, 1.2, 2.4);
  ctx.restore();
}

export function JogoInvasores() {
  const [aberto, setAberto] = useState(false);
  const [fase, setFase] = useState<Estado["fase"]>("inicio");
  const canvas = useRef<HTMLCanvasElement>(null);
  const est = useRef<Estado>(novoJogo(lerRecorde()));
  const teclas = useRef({ esq: false, dir: false, fogo: false });

  // Só computador: tela larga e ponteiro fino. No celular o jogo nem monta.
  const [temTela, setTemTela] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(min-width: 900px) and (pointer: fine)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(min-width: 900px) and (pointer: fine)"); if (!mq) return;
    const f = () => { setTemTela(mq.matches); if (!mq.matches) setAberto(false); };
    mq.addEventListener("change", f); return () => mq.removeEventListener("change", f);
  }, []);

  const iniciar = useCallback(() => {
    const e = est.current;
    if (e.fase === "inicio" || e.fase === "fim") est.current = { ...novoJogo(lerRecorde()), fase: "jogando" };
    else if (e.fase === "pausa") e.fase = "jogando";
    setFase(est.current.fase);
    canvas.current?.focus();
  }, []);
  const pausar = useCallback(() => {
    const e = est.current;
    if (e.fase === "jogando") e.fase = "pausa"; else if (e.fase === "pausa") e.fase = "jogando";
    setFase(e.fase);
  }, []);
  const fechar = useCallback(() => {
    if (est.current.fase === "jogando") est.current.fase = "pausa";
    teclas.current = { esq: false, dir: false, fogo: false };
    setFase(est.current.fase); setAberto(false);
  }, []);

  // Teclado: só com o painel aberto.
  useEffect(() => {
    if (!aberto) return;
    const mapa = (k: string) => (k === "ArrowLeft" || k === "a" || k === "A" ? "esq" : k === "ArrowRight" || k === "d" || k === "D" ? "dir"
      : k === " " || k === "ArrowUp" || k === "w" || k === "W" ? "fogo" : null);
    const baixo = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { fechar(); return; }
      if (ev.key === "p" || ev.key === "P") { pausar(); return; }
      const m = mapa(ev.key); if (!m) return;
      ev.preventDefault();   // espaço/setas não rolam a página nem apertam o botão focado
      const f = est.current.fase;
      if (m === "fogo" && (f === "inicio" || f === "fim")) { iniciar(); return; }
      if (f === "jogando") teclas.current[m] = true;
    };
    const cima = (ev: KeyboardEvent) => { const m = mapa(ev.key); if (m) teclas.current[m] = false; };
    window.addEventListener("keydown", baixo); window.addEventListener("keyup", cima);
    return () => { window.removeEventListener("keydown", baixo); window.removeEventListener("keyup", cima); };
  }, [aberto, iniciar, pausar, fechar]);

  // Laço do jogo.
  useEffect(() => {
    if (!aberto) return;
    const cv = canvas.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const escala = Math.min(4, Math.ceil((cv.clientWidth / W) * (window.devicePixelRatio || 1)));
    cv.width = W * escala; cv.height = H * escala;
    let raf = 0, antes = performance.now();

    const morrer = (e: Estado, fatal: boolean) => {
      e.vidas = fatal ? 0 : e.vidas - 1; e.fase = "morreu"; e.pausaMorte = 1200;
      explodir(e, e.naveX + NAVE_L / 2, NAVE_Y + 5, [COR.laranja, COR.laranja2, COR.branco], 26);
      setFase(e.fase);
    };

    const atualizar = (dt: number) => {
      const e = est.current, s = dt / 16.67;
      e.estrelas.forEach((st) => { st.y += st.v * s; if (st.y > H) { st.y = 0; st.x = Math.random() * W; } });
      e.particulas = e.particulas.filter((p) => { p.x += p.vx * s; p.y += p.vy * s; p.vy += 0.02 * s; p.vida -= 0.025 * s; return p.vida > 0; });
      if (e.fase === "morreu") {
        e.pausaMorte -= dt;
        if (e.pausaMorte <= 0) {
          e.fase = e.vidas > 0 ? "jogando" : "fim"; e.tirosDeles = []; e.naveX = W / 2 - NAVE_L / 2; setFase(e.fase);
          if (e.fase === "fim" && e.pontos > e.recorde) { e.recorde = e.pontos; gravarRecorde(e.pontos); }
        }
        return;
      }
      if (e.fase !== "jogando") return;
      const k = teclas.current;
      e.naveX = Math.max(3, Math.min(W - NAVE_L - 3, e.naveX + ((k.dir ? 1 : 0) - (k.esq ? 1 : 0)) * 1.7 * s));
      if (k.fogo && !e.tiro) e.tiro = { x: e.naveX + NAVE_L / 2, y: NAVE_Y - 2, v: -4.4 };

      const vivos = e.bugs.filter((b) => b.vivo);
      e.acumPasso += dt;
      const passo = Math.max(26, e.passoMs * (0.18 + 0.82 * (vivos.length / 55)));
      if (e.acumPasso >= passo) {
        e.acumPasso = 0; e.quadro = e.quadro ? 0 : 1;
        const bate = vivos.some((b) => (e.dir > 0 ? b.x + BUG_L + 2 > W - 4 : b.x - 2 < 4));
        if (bate) { vivos.forEach((b) => (b.y += 6)); e.dir = e.dir > 0 ? -1 : 1; }
        else vivos.forEach((b) => (b.x += 2 * e.dir));
        vivos.forEach((b) => { for (let dx = 0; dx < BUG_L; dx += 2) morderEscudo(e.escudos, b.x + dx, b.y + BUG_A); });
        if (vivos.some((b) => b.y + BUG_A >= NAVE_Y)) { morrer(e, true); return; }
      }

      e.acumFogo += dt;
      const cadencia = Math.max(360, 1080 - (e.nivel - 1) * 120);
      if (e.acumFogo > cadencia && e.tirosDeles.length < 3 && vivos.length) {
        e.acumFogo = 0;
        const col = vivos[Math.floor(Math.random() * vivos.length)];
        const baixo = vivos.filter((b) => Math.abs(b.x - col.x) < 6).sort((a, b) => b.y - a.y)[0];
        e.tirosDeles.push({ x: baixo.x + BUG_L / 2, y: baixo.y + BUG_A, v: 1.6 + e.nivel * 0.15 });
      }

      if (e.tiro) {
        e.tiro.y += e.tiro.v * s;
        const t = e.tiro;
        if (t.y < 16) e.tiro = null;
        else if (morderEscudo(e.escudos, t.x, t.y)) { explodir(e, t.x, t.y, [COR.branco, COR.azul], 5); e.tiro = null; }
        else {
          const alvo = vivos.find((b) => t.x >= b.x - 0.5 && t.x <= b.x + BUG_L + 0.5 && t.y >= b.y && t.y <= b.y + BUG_A);
          if (alvo) {
            alvo.vivo = false; e.pontos += PONTOS[alvo.tipo]; e.tiro = null;
            explodir(e, alvo.x + BUG_L / 2, alvo.y + BUG_A / 2, [COR_BUG[alvo.tipo], COR.laranja2, COR.branco]);
          } else {
            const i = e.tirosDeles.findIndex((d) => Math.abs(d.x - t.x) < 2.5 && Math.abs(d.y - t.y) < 4);
            if (i >= 0) { explodir(e, t.x, t.y, [COR.branco], 6); e.tirosDeles.splice(i, 1); e.tiro = null; }
          }
        }
      }

      e.tirosDeles = e.tirosDeles.filter((d) => {
        d.y += d.v * s;
        if (d.y > H - 14) return false;
        if (morderEscudo(e.escudos, d.x, d.y + 3)) { explodir(e, d.x, d.y + 3, [COR.branco, COR.azul], 5); return false; }
        if (d.y + 4 >= NAVE_Y + 2 && d.y <= NAVE_Y + 9 && d.x >= e.naveX && d.x <= e.naveX + NAVE_L) { morrer(e, false); return false; }
        return true;
      });

      if (!e.bugs.some((b) => b.vivo)) {
        e.nivel += 1; Object.assign(e, novaOnda(e.nivel)); e.tiro = null; e.tirosDeles = [];
        if (e.nivel % 2 === 1) e.escudos = novosEscudos();
      }
    };

    const texto = (t: string, x: number, y: number, tam: number, cor: string, peso = 800, alinhar: CanvasTextAlign = "left") => {
      ctx.font = `${peso} ${tam}px Inter, "Plus Jakarta Sans", system-ui, sans-serif`;
      ctx.textAlign = alinhar; ctx.fillStyle = cor; ctx.fillText(t, x, y);
    };

    const pintar = () => {
      const e = est.current;
      ctx.setTransform(escala, 0, 0, escala, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, COR.fundo1); g.addColorStop(1, COR.fundo2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const brilho = ctx.createRadialGradient(W * 0.8, -20, 0, W * 0.8, -20, 160);
      brilho.addColorStop(0, "rgba(30,79,179,.55)"); brilho.addColorStop(1, "rgba(30,79,179,0)"); ctx.fillStyle = brilho; ctx.fillRect(0, 0, W, H);
      e.estrelas.forEach((st) => { ctx.fillStyle = `rgba(255,255,255,${st.r > 0.6 ? 0.8 : 0.35})`; ctx.fillRect(st.x, st.y, st.r, st.r); });

      // HUD
      ctx.textBaseline = "middle";
      texto("PONTOS", 8, 10, 5.5, "rgba(255,255,255,.55)", 800);
      texto(String(e.pontos).padStart(4, "0"), 36, 10, 7.5, COR.laranja2, 900);
      texto("RECORDE", 74, 10, 5.5, "rgba(255,255,255,.55)", 800);
      texto(String(Math.max(e.recorde, e.pontos)).padStart(4, "0"), 106, 10, 7.5, COR.branco, 900);
      for (let v = 0; v < e.vidas; v++) desenharNave(ctx, W - 22 - v * 16, 5, 0.8);
      ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(6, 19, W - 12, 0.6);

      e.bugs.forEach((b) => b.vivo && desenharBug(ctx, b, e.quadro));

      e.escudos.forEach((es) => es.px.forEach((l, y) => l.forEach((on, x) => {
        if (!on) return;
        ctx.fillStyle = y < 2 ? "rgba(255,255,255,.62)" : "rgba(255,255,255,.34)";
        ctx.fillRect(es.x + x * 2 + 0.15, es.y + y * 2 + 0.15, 1.7, 1.7);
      })));

      if (e.fase !== "morreu" || e.vidas > 0 && Math.floor(e.pausaMorte / 120) % 2 === 0 && e.pausaMorte < 600) desenharNave(ctx, e.naveX, NAVE_Y);

      if (e.tiro) {
        ctx.shadowColor = COR.laranja; ctx.shadowBlur = 5; ctx.fillStyle = COR.laranja2;
        rrect(ctx, e.tiro.x - 0.7, e.tiro.y, 1.4, 5, 0.7); ctx.fill(); ctx.shadowBlur = 0;
      }
      e.tirosDeles.forEach((d) => {
        ctx.strokeStyle = COR.vermelho; ctx.lineWidth = 0.9; ctx.beginPath();
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + 1, d.y + 1.3); ctx.lineTo(d.x - 1, d.y + 2.6); ctx.lineTo(d.x, d.y + 4); ctx.stroke();
      });
      e.particulas.forEach((p) => { ctx.globalAlpha = Math.max(0, p.vida); ctx.fillStyle = p.cor; ctx.fillRect(p.x, p.y, 1.2, 1.2); });
      ctx.globalAlpha = 1;

      ctx.fillStyle = "rgba(242,107,29,.55)"; ctx.fillRect(0, H - 12, W, 0.8);
      texto(`FASE ${e.nivel}`, 8, H - 6, 5.5, "rgba(255,255,255,.55)", 800);
      texto("GRUPO NASCIMENTO", W - 8, H - 6, 5, "rgba(255,255,255,.35)", 800, "right");

      const cartao = (titulo: string, sub: string, dica: string) => {
        ctx.fillStyle = "rgba(6,22,54,.78)"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "rgba(255,255,255,.06)"; rrect(ctx, 28, 92, W - 56, 72, 10); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.14)"; ctx.lineWidth = 0.6; ctx.stroke();
        desenharNave(ctx, W / 2 - NAVE_L / 2, 100);
        texto(titulo, W / 2, 124, 11, COR.branco, 900, "center");
        texto(sub, W / 2, 138, 6, "rgba(255,255,255,.7)", 600, "center");
        ctx.fillStyle = COR.laranja; rrect(ctx, W / 2 - 46, 148, 92, 11, 5.5); ctx.fill();
        texto(dica, W / 2, 153.8, 5.5, "#fff", 900, "center");
      };
      if (e.fase === "inicio") cartao("CAÇA-BUGS", "Derrube os bugs enquanto o sistema volta", "ESPAÇO PARA COMEÇAR");
      if (e.fase === "pausa") cartao("PAUSADO", "Os bugs esperam você", "P PARA CONTINUAR");
      if (e.fase === "fim") cartao(`${e.pontos} PONTOS`, e.pontos > 0 && e.pontos >= e.recorde ? "Novo recorde!" : `Recorde: ${e.recorde}`, "ESPAÇO PARA JOGAR");
    };

    const quadro = (agora: number) => {
      const dt = Math.min(50, agora - antes); antes = agora;
      if (!document.hidden) { atualizar(dt); pintar(); }
      raf = requestAnimationFrame(quadro);
    };
    raf = requestAnimationFrame(quadro);
    return () => cancelAnimationFrame(raf);
  }, [aberto]);

  if (!temTela) return null;

  if (!aberto) {
    return (
      <button type="button" className="si-jogo-nave" onClick={() => setAberto(true)} title="Jogar enquanto espera" aria-label="Abrir o joguinho Caça-Bugs">
        {/* navezinha branca: a mesma silhueta da nave do jogo */}
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
          <path d="M13 2.5c3.2 2.6 5 6.6 5 11.2v3.1l2.8 2.6v2.1l-4.6-1.6h-6.4L5.2 21.5v-2.1L8 16.8v-3.1c0-4.6 1.8-8.6 5-11.2z" fill="#fff" />
          <circle cx="13" cy="10.5" r="2.1" fill="#0b2a63" />
          <path d="M10.6 21.2h4.8l-1 2.6h-2.8z" fill="#ff9a4d" />
        </svg>
      </button>
    );
  }

  return (
    <div className="si-jogo" role="dialog" aria-label="Joguinho Caça-Bugs">
      <div className="si-jogo-topo">
        <span><b>Caça-Bugs</b> enquanto espera</span>
        <div>
          {(fase === "jogando" || fase === "pausa") && (
            <button type="button" aria-label={fase === "pausa" ? "Continuar" : "Pausar"} onClick={pausar}>
              {fase === "pausa" ? <Play size={13} /> : <Pause size={13} />}
            </button>
          )}
          <button type="button" aria-label="Fechar o jogo" onClick={fechar}><X size={14} /></button>
        </div>
      </div>
      <canvas ref={canvas} width={W} height={H} tabIndex={0} className="si-jogo-tela"
        onPointerDown={() => (fase === "inicio" || fase === "fim") && iniciar()} />
      <div className="si-jogo-dica"><kbd>←</kbd><kbd>→</kbd> mover <kbd>espaço</kbd> atira <kbd>P</kbd> pausa <kbd>Esc</kbd> sai</div>
    </div>
  );
}

export const CSS_JOGO = `
.si-jogo-nave{position:absolute;right:clamp(16px,2.2vw,32px);bottom:clamp(16px,2.2vw,28px);z-index:6;width:52px;height:52px;border-radius:16px;display:grid;place-items:center;cursor:pointer;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(10px);box-shadow:0 18px 36px -16px rgba(3,10,30,.8);
  transition:transform .2s ease,background .2s ease,box-shadow .2s ease;animation:si-entra .6s .4s both}
.si-jogo-nave svg{transition:transform .25s ease;filter:drop-shadow(0 4px 10px rgba(242,107,29,.45))}
.si-jogo-nave:hover{background:rgba(255,255,255,.16);transform:translateY(-3px);box-shadow:0 22px 40px -14px rgba(242,107,29,.55)}
.si-jogo-nave:hover svg{transform:translateY(-2px) rotate(-8deg)}
.si-jogo{position:absolute;right:clamp(16px,2.2vw,32px);bottom:clamp(16px,2.2vw,28px);z-index:6;width:318px;padding:12px;border-radius:22px;
  background:linear-gradient(160deg,rgba(15,49,113,.92),rgba(6,22,54,.94));border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(14px);
  box-shadow:0 40px 80px -24px rgba(0,0,0,.85),inset 0 1px 0 rgba(255,255,255,.14),0 0 0 1px rgba(242,107,29,.12);animation:si-entra .45s both}
.si-jogo-topo{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:2px 4px 10px;font-size:12px;font-weight:600;color:rgba(255,255,255,.6)}
.si-jogo-topo b{font-weight:900;color:#fff;margin-right:4px}
.si-jogo-topo div{display:flex;gap:5px}
.si-jogo-topo button{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;cursor:pointer;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18)}
.si-jogo-topo button:hover{background:rgba(242,107,29,.35);border-color:rgba(255,154,77,.6)}
.si-jogo-tela{display:block;width:100%;aspect-ratio:224/256;border-radius:14px;outline:none;border:1px solid rgba(255,255,255,.12);cursor:pointer}
.si-jogo-tela:focus-visible{box-shadow:0 0 0 2px rgba(255,154,77,.7)}
.si-jogo-dica{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px;margin-top:9px;font-size:10.5px;font-weight:600;color:rgba(255,255,255,.55)}
.si-jogo-dica kbd{font-family:inherit;font-size:9.5px;font-weight:800;color:#fff;padding:2px 6px;border-radius:5px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18)}
`;
