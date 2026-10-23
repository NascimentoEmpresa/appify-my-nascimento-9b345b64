import { useCallback, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { BUCKET_CHAMADOS, ehImagemAnexo, opcoesDownloadAnexo, type Anexo } from "./types";

// =====================================================================
// Abrir anexo de chamado (23/10/2026, pedido do Pablo: "ao abrir uma imagem
// no chamado, deixa abrir em um card no centro da tela, em vez de abrir outra
// página"). Era um `baixarAnexo` copiado em Acompanhar, Chat, Coordenar e
// Executar, todos com window.open. Agora:
//   · imagem → card no centro (Dialog), com "Abrir em nova aba" e "Baixar";
//   · o resto (PDF, planilha, HTML...) → como antes, nova aba / download.
// O link assinado vale 1 h, igual ao de antes.
// =====================================================================

type AnexoAbrir = Pick<Anexo, "storage_path" | "nome_arquivo" | "mime_type">;

export function useAnexoChamado() {
  const { toast } = useToast();
  const [img, setImg] = useState<{ anexo: AnexoAbrir; url: string } | null>(null);
  const [carregou, setCarregou] = useState(false);

  const abrirAnexo = useCallback(async (a: AnexoAbrir) => {
    const imagem = ehImagemAnexo(a);
    const { data, error } = await supabase.storage.from(BUCKET_CHAMADOS)
      .createSignedUrl(a.storage_path, 3600, imagem ? undefined : opcoesDownloadAnexo(a.storage_path));
    if (error || !data?.signedUrl) { toast({ title: "Erro ao abrir anexo", variant: "destructive" }); return; }
    if (imagem) { setCarregou(false); setImg({ anexo: a, url: data.signedUrl }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }, [toast]);

  // "Baixar" pede um link com download forçado: o da imagem abre no navegador.
  const baixar = async () => {
    if (!img) return;
    const nome = img.anexo.nome_arquivo || (img.anexo.storage_path.split("/").pop() ?? "imagem").replace(/^\d+-/, "");
    const { data, error } = await supabase.storage.from(BUCKET_CHAMADOS)
      .createSignedUrl(img.anexo.storage_path, 3600, { download: nome });
    if (error || !data?.signedUrl) { toast({ title: "Erro ao baixar anexo", variant: "destructive" }); return; }
    window.location.assign(data.signedUrl);
  };

  const visualizador = (
    <Dialog open={!!img} onOpenChange={(o) => { if (!o) setImg(null); }}>
      <DialogContent className="w-auto max-w-[min(92vw,1100px)] gap-3 p-4">
        <div className="pr-8">
          <DialogTitle className="truncate text-sm">{img?.anexo.nome_arquivo}</DialogTitle>
          <DialogDescription className="sr-only">Visualização do anexo do chamado</DialogDescription>
        </div>
        <div className="relative grid min-h-[160px] min-w-[240px] place-items-center rounded-md bg-muted/40">
          {!carregou && <Loader2 className="absolute h-6 w-6 animate-spin text-muted-foreground" />}
          {img && (
            <img
              src={img.url} alt={img.anexo.nome_arquivo}
              onLoad={() => setCarregou(true)} onError={() => setCarregou(true)}
              className="max-h-[75vh] max-w-full rounded-md object-contain"
            />
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => img && window.open(img.url, "_blank", "noopener,noreferrer")}>
            <ExternalLink className="h-4 w-4" /> Abrir em nova aba
          </Button>
          <Button size="sm" className="gap-1.5" onClick={baixar}>
            <Download className="h-4 w-4" /> Baixar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { abrirAnexo, visualizador };
}
