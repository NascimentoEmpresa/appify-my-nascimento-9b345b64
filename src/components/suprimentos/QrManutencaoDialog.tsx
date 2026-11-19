import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { type Bem, useEmitirQrManutencao, useRevogarQrManutencao } from "@/hooks/useSupPatrimonio";
import { urlPublicaManutencao } from "@/lib/suprimentos/manutencaoQr";
import { Download, RefreshCw, ShieldOff } from "lucide-react";
import { toast } from "sonner";

const html = (valor: string | null) => String(valor ?? "").replace(/[&<>"']/g, (caractere) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[caractere] ?? caractere));

export function QrManutencaoDialog({ bem, onFechar }: { bem: Bem | null; onFechar: () => void }) {
  const emitir = useEmitirQrManutencao(); const revogar = useRevogarQrManutencao();
  const [token, setToken] = useState<string | null>(bem?.manutencao_qr_ativo ? bem.manutencao_qr_token : null);
  const [imagem, setImagem] = useState("");
  useEffect(() => {
    setToken(bem?.manutencao_qr_ativo ? bem.manutencao_qr_token : null);
  }, [bem]);
  useEffect(() => {
    if (!token) return setImagem("");
    QRCode.toDataURL(urlPublicaManutencao(token), { width: 560, margin: 2, errorCorrectionLevel: "H" })
      .then(setImagem).catch(() => toast.error("Não foi possível desenhar o QR."));
  }, [token]);
  if (!bem) return null;
  async function gerar(rotacionar = false) {
    const novo = await emitir.mutateAsync({ id: bem!.id, rotacionar }); setToken(novo);
    toast.success(rotacionar ? "QR substituído. O anterior deixou de funcionar." : "QR ativado.");
  }
  async function revogarQr() { await revogar.mutateAsync(bem!.id); setToken(null); }
  function imprimir() {
    if (!imagem) return;
    const janela = window.open("", "_blank");
    if (!janela) return toast.error("O navegador bloqueou a impressão.");
    janela.opener = null;
    janela.document.write(`<!doctype html><html><head><title>Etiqueta ${html(bem!.nome)}</title><style>@page{size:A4;margin:18mm}body{font-family:Arial;text-align:center;border:3px solid #111;padding:28px}img{width:105mm;height:105mm}h1{font-size:28px;margin:8px}p{font-size:19px;margin:8px}.aviso{font-size:14px;margin-top:20px}</style></head><body><h1>${html(bem!.nome)}</h1><p><b>Série:</b> ${html(bem!.numero_serie)}</p><p><b>Patrimônio:</b> ${html(bem!.placa_patrimonial)}</p><img src="${imagem}"/><p>Escaneie para acompanhar esta manutenção</p><p class="aviso">QR exclusivo desta máquina. Não compartilhe fora do atendimento.</p><script>onload=()=>print()</script></body></html>`);
    janela.document.close();
  }
  return <Dialog open onOpenChange={(o) => !o && onFechar()}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>QR de manutenção · {bem.nome}</DialogTitle></DialogHeader>
    <div className="space-y-3 text-center"><div className="text-sm"><p>Série: <b>{bem.numero_serie || "não informada"}</b></p><p>Patrimônio: <b>{bem.placa_patrimonial || "não informado"}</b></p></div>{token && imagem ? <><img src={imagem} alt="QR de manutenção" className="mx-auto w-64 rounded border" /><Badge variant="outline">QR ativo</Badge></> : <p className="rounded border border-dashed p-8 text-sm text-muted-foreground">QR inativo. Gere a etiqueta depois de preencher série e patrimônio.</p>}</div>
    <DialogFooter className="flex-wrap">{token ? <><Button variant="outline" onClick={imprimir}><Download className="mr-2 h-4 w-4" />Imprimir A4</Button><Button variant="outline" onClick={() => gerar(true)} disabled={emitir.isPending}><RefreshCw className="mr-2 h-4 w-4" />Trocar QR</Button><Button variant="destructive" onClick={revogarQr} disabled={revogar.isPending}><ShieldOff className="mr-2 h-4 w-4" />Revogar</Button></> : <Button onClick={() => gerar()} disabled={emitir.isPending}>Gerar QR</Button>}<Button variant="ghost" onClick={onFechar}>Fechar</Button></DialogFooter>
  </DialogContent></Dialog>;
}
