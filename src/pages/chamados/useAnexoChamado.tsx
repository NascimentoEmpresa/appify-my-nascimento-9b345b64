import { useCallback, useEffect, useRef, useState } from "react";
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

// =====================================================================
// Imagem do anexo pelo DOWNLOAD AUTENTICADO, não pela URL assinada
// (28/10/2026). Print colado no chat do chamado aparecia como imagem
// quebrada no balão: a assinatura era criada (POST /object/sign → URL
// devolvida), mas o GET da URL assinada, que o <img> faz sem cabeçalho
// nenhum, não entregava a imagem no cluster. Mesmo sintoma da contingência
// em 05/10 (infra/failover/render/monolito/nginx.conf: 401 em JSON onde a
// tag esperava PNG → ERR_BLOCKED_BY_ORB).
//
// O download vai com apikey + JWT do usuário, pelo mesmo caminho dos
// outros arquivos do Storage, e vira blob: URL local — não depende da rota
// de assinatura nem do content-type que o Storage devolve. Se nem o download
// vier, tenta a assinada; se a imagem ainda assim não decodificar, quem
// desenha mostra o nome do arquivo em vez do ícone quebrado.
// =====================================================================
export async function urlImagemAnexo(path: string): Promise<{ url: string; local: boolean } | null> {
  const { data: blob } = await supabase.storage.from(BUCKET_CHAMADOS).download(path);
  if (blob && blob.size > 0) return { url: URL.createObjectURL(blob), local: true };
  const { data } = await supabase.storage.from(BUCKET_CHAMADOS).createSignedUrl(path, 3600);
  return data?.signedUrl ? { url: data.signedUrl, local: false } : null;
}

/**
 * blob: URLs das imagens do chat, por caminho (null = não veio). Só busca o
 * que é novo — mensagem nova não rebaixa as imagens que já estão na tela — e
 * revoga tudo ao desmontar.
 */
export function useImagensAnexo(caminhos: string[]) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const pedidos = useRef(new Set<string>());
  const locais = useRef<string[]>([]);
  const chave = caminhos.join("|");
  useEffect(() => {
    const novos = caminhos.filter((p) => !pedidos.current.has(p));
    novos.forEach((p) => pedidos.current.add(p));
    // Uma por vez: cada ida ao Storage é uma conexão do pool dele com o
    // Postgres (ver ModalFotosComprovacao, 21/09/2026).
    (async () => {
      for (const p of novos) {
        const r = await urlImagemAnexo(p).catch(() => null);
        if (r?.local) locais.current.push(r.url);
        setUrls((cur) => ({ ...cur, [p]: r?.url ?? null }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  useEffect(() => () => { locais.current.forEach((u) => URL.revokeObjectURL(u)); }, []);
  return urls;
}

export function useAnexoChamado() {
  const { toast } = useToast();
  const [img, setImg] = useState<{ anexo: AnexoAbrir; url: string } | null>(null);
  const [carregou, setCarregou] = useState(false);

  const abrirAnexo = useCallback(async (a: AnexoAbrir) => {
    if (ehImagemAnexo(a)) {
      // Card no centro pelo download autenticado — ver urlImagemAnexo.
      const r = await urlImagemAnexo(a.storage_path).catch(() => null);
      if (!r) { toast({ title: "Erro ao abrir anexo", variant: "destructive" }); return; }
      setCarregou(false);
      setImg((cur) => { if (cur?.url.startsWith("blob:")) URL.revokeObjectURL(cur.url); return { anexo: a, url: r.url }; });
      return;
    }
    const { data, error } = await supabase.storage.from(BUCKET_CHAMADOS)
      .createSignedUrl(a.storage_path, 3600, opcoesDownloadAnexo(a.storage_path));
    if (error || !data?.signedUrl) { toast({ title: "Erro ao abrir anexo", variant: "destructive" }); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }, [toast]);

  // "Baixar" pede um link com download forçado: o da imagem abre no navegador.
  const baixar = async () => {
    if (!img) return;
    const nome = img.anexo.nome_arquivo || (img.anexo.storage_path.split("/").pop() ?? "imagem").replace(/^\d+-/, "");
    // Imagem já baixada (blob:): salva dela mesma, sem nova ida ao Storage.
    if (img.url.startsWith("blob:")) {
      const a = document.createElement("a");
      a.href = img.url; a.download = nome;
      document.body.appendChild(a); a.click(); a.remove();
      return;
    }
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
