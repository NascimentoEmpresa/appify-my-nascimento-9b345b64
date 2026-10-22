import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

// =====================================================================
// Quadro de desenho da assinatura (mouse, caneta ou dedo) → PNG em data
// URL, recortado ao redor do traço.
//
// Nasceu no editor de assinatura de Treinamentos (AssinaturaEditor, mig
// 20261005000003) e saiu de lá em 22/10/2026 para RH › Documentos assinar
// com o MESMO quadro (mig 20261022000500) — o PNG sai no formato que o
// CHECK da TRN_ASSINATURA e da USUARIO_ASSINATURA aceita.
// =====================================================================

const LARGURA = 640, ALTURA = 200;

/** Recorta o PNG ao redor do traço (sobra de 8px), para a assinatura não boiar num fundo vazio. */
function recortar(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const px = ctx.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (px[(y * w + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const m = 8;
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

export function QuadroAssinatura({ imagem, onChange }: { imagem: string | null; onChange: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [vazio, setVazio] = useState(!imagem);
  const [editarDeNovo, setEditarDeNovo] = useState(!imagem);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1e293b"; ctx.lineWidth = 3.2;
  }, [editarDeNovo]);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (LARGURA / r.width), y: (e.clientY - r.top) * (ALTURA / r.height) };
  };
  const inicio = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    desenhando.current = true;
    ultimo.current = ponto(e);
    const ctx = ref.current!.getContext("2d")!;
    ctx.beginPath(); ctx.arc(ultimo.current.x, ultimo.current.y, 1.4, 0, Math.PI * 2); ctx.fillStyle = "#1e293b"; ctx.fill();
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhando.current || !ultimo.current) return;
    const p = ponto(e);
    const ctx = ref.current!.getContext("2d")!;
    // Curva até o meio do segmento: traço liso em vez de serrilhado.
    const meio = { x: (ultimo.current.x + p.x) / 2, y: (ultimo.current.y + p.y) / 2 };
    ctx.beginPath(); ctx.moveTo(ultimo.current.x, ultimo.current.y); ctx.quadraticCurveTo(ultimo.current.x, ultimo.current.y, meio.x, meio.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    ultimo.current = p;
    if (vazio) setVazio(false);
  };
  const fim = () => {
    if (!desenhando.current) return;
    desenhando.current = false; ultimo.current = null;
    onChange(recortar(ref.current!));
  };
  const limpar = () => {
    const c = ref.current;
    if (c) c.getContext("2d")!.clearRect(0, 0, LARGURA, ALTURA);
    setVazio(true); onChange(null);
  };

  if (imagem && !editarDeNovo) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-white p-3">
        <img src={imagem} alt="Assinatura" className="h-16 max-w-[70%] object-contain" />
        <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => { setEditarDeNovo(true); onChange(null); setVazio(true); }}>
          <Eraser className="mr-1.5 h-3.5 w-3.5" /> Desenhar de novo
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-white">
        <canvas ref={ref} width={LARGURA} height={ALTURA} className="block h-auto w-full cursor-crosshair touch-none"
          onPointerDown={inicio} onPointerMove={move} onPointerUp={fim} onPointerLeave={fim} onPointerCancel={fim} />
        <div className="pointer-events-none absolute inset-x-8 bottom-10 border-b border-slate-300" />
        {vazio && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">Assine aqui com o mouse, a caneta ou o dedo</span>}
      </div>
      <div className="mt-1.5 flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={limpar}><Eraser className="mr-1.5 h-3.5 w-3.5" /> Limpar</Button>
      </div>
    </div>
  );
}
