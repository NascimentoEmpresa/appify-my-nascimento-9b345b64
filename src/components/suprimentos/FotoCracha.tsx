import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { BUCKET_CRACHAS, nomeArquivoCracha, origemFotoCracha } from "@/lib/suprimentos/fotoCracha";

/**
 * Foto do crachá no card do pedido de admissão.
 *
 * O encarregado anexava a foto em Solicitar Materiais e ela era gravada, mas
 * esta tela nunca a exibia — o Supply não tinha como pegar a imagem para
 * montar o crachá (set/2026). Miniatura no card; clicar abre a foto grande
 * com os botões de abrir e baixar.
 */
export function FotoCracha({ caminho, protocolo }: { caminho: string | null; protocolo: string }) {
  const origem = origemFotoCracha(caminho);
  const [aberta, setAberta] = useState(false);
  const [falhou, setFalhou] = useState(false);

  const { data: urls, isLoading, error } = useQuery({
    queryKey: ["sup_cracha_url", origem?.tipo === "bucket" ? origem.caminho : null],
    enabled: origem?.tipo === "bucket",
    // As URLs assinadas valem 1h; não adianta reaproveitar do cache além disso.
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const c = (origem as { caminho: string }).caminho;
      const ver = await supabase.storage.from(BUCKET_CRACHAS).createSignedUrl(c, 3600);
      if (ver.error) throw ver.error;
      const baixar = await supabase.storage
        .from(BUCKET_CRACHAS)
        .createSignedUrl(c, 3600, { download: nomeArquivoCracha(protocolo, c) });
      if (baixar.error) throw baixar.error;
      return { ver: ver.data.signedUrl, baixar: baixar.data.signedUrl };
    },
  });

  if (!origem) return <span className="text-muted-foreground">não enviada</span>;

  const url = origem.tipo === "url" ? origem.url : urls?.ver;
  // O legado é outro domínio: o navegador ignora `download` e só abre a imagem.
  const urlBaixar = origem.tipo === "bucket" ? urls?.baixar : null;

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> carregando…
      </span>
    );
  }
  if (error || falhou || !url) {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive" title={caminho ?? undefined}>
        <ImageOff className="h-3.5 w-3.5" /> foto indisponível
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        className="group inline-flex items-center gap-2 text-left"
        title="Ver foto do crachá"
      >
        <img
          src={url}
          alt={`Foto do crachá — ${protocolo}`}
          className="h-12 w-10 rounded border object-cover group-hover:opacity-90"
          loading="lazy"
          onError={() => setFalhou(true)}
        />
        <span className="text-primary underline-offset-2 group-hover:underline">ver foto</span>
      </button>

      <Dialog open={aberta} onOpenChange={setAberta}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Foto do crachá — {protocolo}</DialogTitle>
          </DialogHeader>
          <img
            src={url}
            alt={`Foto do crachá — ${protocolo}`}
            className="max-h-[65vh] w-full rounded-md border bg-muted/30 object-contain"
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-4 w-4" /> Abrir em nova aba
              </a>
            </Button>
            {urlBaixar && (
              <Button asChild>
                <a href={urlBaixar}>
                  <Download className="mr-1.5 h-4 w-4" /> Baixar
                </a>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
