import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Assinatura, AssinaturaCertificado } from "./tipos";
import { AssinaturaTraco, BlocoAssinatura, FONTES_ASSINATURA, assinaturaValeParaPublicar, useFontesAssinatura } from "./assinaturaFolha";

// =====================================================================
// TREINAMENTOS — editor de assinatura (mig 20261005000003).
// Usado na tela Cursos › Assinaturas e no "Criar assinatura" do Editar
// curso. Nome completo + cargo e registro (obrigatórios desde 06/10/2026,
// mig 20261006000001), e a assinatura em si: DESENHADA no quadro
// (mouse, caneta ou dedo) ou ESCRITA numa fonte cursiva. A prévia mostra
// o bloco exatamente como sai no certificado.
// =====================================================================

export type RascunhoAssinatura = Partial<Assinatura> & { tipo: Assinatura["tipo"] };

export function AssinaturaEditor({ valor, onChange }: { valor: RascunhoAssinatura; onChange: (v: RascunhoAssinatura) => void }) {
  useFontesAssinatura();
  const set = (p: Partial<RascunhoAssinatura>) => onChange({ ...valor, ...p });
  const previa: AssinaturaCertificado = {
    nome_completo: valor.nome_completo?.trim() || "Nome do treinador", cargo: valor.cargo?.trim() || null, registro: valor.registro?.trim() || null,
    tipo: valor.tipo, imagem: valor.imagem ?? null,
    texto: valor.texto?.trim() || valor.nome_completo?.trim() || "Assinatura", fonte: valor.fonte ?? FONTES_ASSINATURA[0].id,
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="campo">
          <label>Nome completo do treinador *</label>
          <Input value={valor.nome_completo ?? ""} onChange={(e) => set({ nome_completo: e.target.value })} placeholder="Como sai no certificado" />
        </div>
        <div className="campo">
          <label>Cargo *</label>
          <Input list="trn-cargos-assinatura" value={valor.cargo ?? ""} onChange={(e) => set({ cargo: e.target.value })} placeholder="ex.: Técnica em Segurança do Trabalho" />
          <datalist id="trn-cargos-assinatura">
            <option value="Técnica em Segurança do Trabalho" />
            <option value="Técnico em Segurança do Trabalho" />
          </datalist>
        </div>
        <div className="campo sm:col-span-2">
          <label>Registro *</label>
          <Input value={valor.registro ?? ""} onChange={(e) => set({ registro: e.target.value })} placeholder="ex.: 0031036 (registro profissional / MTE)" />
          {/* Mig 20261006000001: curso só publica com assinatura de Técnico(a) em Segurança. */}
          <div className="ajuda">
            {assinaturaValeParaPublicar(valor)
              ? "✓ Vale para publicar cursos (Técnico(a) em Segurança com registro)."
              : "Para publicar um curso, a assinatura tem que ser de Técnico(a) em Segurança, com o registro."}
          </div>
        </div>
      </div>

      <div className="campo">
        <label>Assinatura *</label>
        <div className="mb-2 inline-flex rounded-lg border p-0.5">
          {([["desenho", "Desenhar", PenLine], ["texto", "Escrever", Type]] as const).map(([t, rot, Ic]) => (
            <button key={t} type="button" onClick={() => set({ tipo: t })}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${valor.tipo === t ? "bg-orange-500 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              <Ic className="h-3.5 w-3.5" /> {rot}
            </button>
          ))}
        </div>

        {valor.tipo === "desenho" ? (
          <QuadroAssinatura imagem={valor.imagem ?? null} onChange={(imagem) => set({ imagem })} />
        ) : (
          <div className="grid gap-2">
            <Input value={valor.texto ?? ""} onChange={(e) => set({ texto: e.target.value })}
              placeholder={valor.nome_completo?.trim() || "Escreva a assinatura"} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FONTES_ASSINATURA.map((f) => (
                <button key={f.id} type="button" onClick={() => set({ fonte: f.id, texto: valor.texto?.trim() ? valor.texto : valor.nome_completo ?? "" })}
                  className={`overflow-hidden rounded-lg border-2 bg-white px-2 py-1.5 text-left transition ${valor.fonte === f.id ? "border-orange-500 ring-2 ring-orange-200" : "border-slate-200 hover:border-slate-400"}`}>
                  <AssinaturaTraco a={{ ...previa, tipo: "texto", fonte: f.id }} altura="24px" />
                  <span className="text-[10px] text-slate-500">{f.nome}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Como sai no certificado</p>
        {/* O bloco é medido em cqw da folha; fora dela, escala 2,5 dá o tamanho de leitura. */}
        <div className="flex justify-center rounded-lg border bg-white py-5" style={{ containerType: "inline-size" }}>
          <BlocoAssinatura a={previa} escala={2.5} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Quadro de desenho
// ---------------------------------------------------------------------

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

function QuadroAssinatura({ imagem, onChange }: { imagem: string | null; onChange: (png: string | null) => void }) {
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
