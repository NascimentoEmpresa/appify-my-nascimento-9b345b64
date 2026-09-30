import { useEffect, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Copy, Download, ExternalLink, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// =====================================================================
// TREINAMENTOS — "GERAR QRCODE" (30/09/2026).
//
// Um diálogo só para os três lugares que pedem QR: a campanha pública, cada
// vídeo dentro dela (link com #item-<id>, a página rola até o vídeo) e cada
// curso (leva ao Portal do Colaborador, que pede o CPF e volta para o curso).
// "Baixar PNG" gera um cartaz pronto para imprimir: título, QR e o endereço
// por extenso (para quem não tem leitor de QR).
// =====================================================================

async function gerarCartaz(url: string, titulo: string, subtitulo?: string): Promise<string> {
  const W = 1200, H = 1560, Q = 900;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#0f3171"; ctx.fillRect(0, 0, W, 18);

  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, url, { width: Q, margin: 1, errorCorrectionLevel: "M" });
  ctx.drawImage(qr, (W - Q) / 2, 300);

  const quebrar = (txt: string, max: number) => {
    const linhas: string[] = []; let atual = "";
    for (const p of txt.split(/\s+/)) {
      const teste = atual ? `${atual} ${p}` : p;
      if (ctx.measureText(teste).width > max && atual) { linhas.push(atual); atual = p; } else atual = teste;
    }
    if (atual) linhas.push(atual);
    return linhas.slice(0, 2);
  };
  ctx.textAlign = "center";
  ctx.fillStyle = "#0f172a"; ctx.font = "bold 58px Inter, Segoe UI, Arial, sans-serif";
  quebrar(titulo, W - 160).forEach((l, i) => ctx.fillText(l, W / 2, 130 + i * 70));
  if (subtitulo) { ctx.fillStyle = "#475569"; ctx.font = "34px Inter, Segoe UI, Arial, sans-serif"; ctx.fillText(subtitulo, W / 2, 272); }
  ctx.fillStyle = "#f26522"; ctx.font = "bold 40px Inter, Segoe UI, Arial, sans-serif";
  ctx.fillText("Aponte a câmera do celular", W / 2, 1290);
  ctx.fillStyle = "#334155"; ctx.font = "28px Inter, Segoe UI, Arial, sans-serif";
  quebrar(url.replace(/^https?:\/\//, ""), W - 120).forEach((l, i) => ctx.fillText(l, W / 2, 1370 + i * 38));
  ctx.fillStyle = "#94a3b8"; ctx.font = "26px Inter, Segoe UI, Arial, sans-serif";
  ctx.fillText("Grupo Nascimento · Treinamentos", W / 2, 1500);
  return canvas.toDataURL("image/png");
}

/** QR de curso: abre o curso no Portal do Colaborador (pede o CPF e volta para o curso). */
export const urlCursoPortal = (cursoId: string) => `${window.location.origin}/colaborador/treinamentos/${cursoId}`;
export const AVISO_QR_CURSO = "Curso não é público: quem ler o QR entra no Portal do Colaborador com o CPF e só vê o curso se estiver no público dele (Quem vê este curso). Para conteúdo aberto a qualquer um, use uma Campanha.";

const nomeArquivo = (t: string) =>
  "qrcode-" + (t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "treinamento") + ".png";

export function QrCodeDialog({ aberto, onFechar, url, titulo, subtitulo, aviso }: {
  aberto: boolean; onFechar: () => void; url: string; titulo: string; subtitulo?: string; aviso?: ReactNode;
}) {
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    if (!aberto) return;
    let vivo = true;
    QRCode.toDataURL(url, { width: 640, margin: 1, errorCorrectionLevel: "M" }).then((d) => vivo && setImg(d)).catch(() => vivo && setImg(null));
    return () => { vivo = false; };
  }, [aberto, url]);

  const copiar = async () => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copiado."); } catch { toast.error("Não deu para copiar — selecione o link e copie."); }
  };
  const baixar = async () => {
    try {
      const a = document.createElement("a");
      a.href = await gerarCartaz(url, titulo, subtitulo);
      a.download = nomeArquivo(titulo);
      a.click();
    } catch { toast.error("Não deu para gerar a imagem."); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><QrCode className="h-5 w-5 text-orange-600" /> QR Code</DialogTitle>
          <DialogDescription className="line-clamp-2">{titulo}{subtitulo ? ` · ${subtitulo}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="grid place-items-center rounded-xl border bg-white p-4">
          {img ? <img src={img} alt={`QR Code de ${titulo}`} className="h-64 w-64" style={{ imageRendering: "pixelated" }} /> : <div className="h-64 w-64 animate-pulse rounded bg-slate-100" />}
        </div>
        {aviso && <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{aviso}</div>}
        <div className="flex gap-2">
          <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button variant="outline" size="icon" title="Copiar link" onClick={copiar}><Copy className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={baixar} className="flex-1"><Download className="mr-2 h-4 w-4" /> Baixar PNG para imprimir</Button>
          <Button variant="outline" asChild><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Abrir</a></Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Botão "Gerar QR Code" que já traz o diálogo. */
export function BotaoQrCode({ url, titulo, subtitulo, aviso, rotulo = "Gerar QR Code", variant = "outline", size = "sm", className, desabilitado, motivoDesabilitado }: {
  url: string; titulo: string; subtitulo?: string; aviso?: ReactNode; rotulo?: string;
  variant?: "outline" | "default" | "ghost" | "secondary"; size?: "sm" | "default" | "icon"; className?: string;
  desabilitado?: boolean; motivoDesabilitado?: string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} disabled={desabilitado} title={desabilitado ? motivoDesabilitado : rotulo}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setAberto(true); }}>
        <QrCode className={size === "icon" ? "h-4 w-4" : "mr-1.5 h-4 w-4"} />{size !== "icon" && rotulo}
      </Button>
      {/* O botão mora dentro de cards que são <Link>: o clique no diálogo
          (portal) sobe pela árvore do React e navegaria o card. */}
      {aberto && <span onClick={(e) => e.stopPropagation()}><QrCodeDialog aberto onFechar={() => setAberto(false)} url={url} titulo={titulo} subtitulo={subtitulo} aviso={aviso} /></span>}
    </>
  );
}
