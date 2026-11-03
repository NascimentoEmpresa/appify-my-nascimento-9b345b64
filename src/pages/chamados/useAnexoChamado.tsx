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
// quebrada no balão. A assinatura sai mesmo quando o arquivo ainda não está
// no nó que respondeu (o espelho entre os bancos roda de minuto em minuto —
// ver TENTATIVAS_IMAGEM abaixo), e o <img> com a URL assinada só descobre
// isso quebrando, sem nova tentativa.
//
// O download vai com apikey + JWT do usuário e vira blob: URL local: se ele
// veio, os bytes estão aqui — dá para tentar de novo até chegarem. Se nem o
// download vier, devolve a assinada; se a imagem ainda assim não decodificar,
// quem desenha mostra o nome do arquivo em vez do ícone quebrado.
// =====================================================================
export async function urlImagemAnexo(path: string): Promise<{ url: string; local: boolean } | null> {
  const { data: blob } = await supabase.storage.from(BUCKET_CHAMADOS).download(path);
  if (blob && blob.size > 0) return { url: URL.createObjectURL(blob), local: true };
  const { data } = await supabase.storage.from(BUCKET_CHAMADOS).createSignedUrl(path, 3600);
  return data?.signedUrl ? { url: data.signedUrl, local: false } : null;
}

// O print recém-enviado pode ainda não estar no nó que respondeu: o
// storage-api grava em disco local e o espelho entre banco1 e banco2 roda de
// minuto em minuto (infra/ha/espelhar-anexos.sh — "a LINHA existe, os bytes
// não"). Conferido em 28/10/2026 no chamado SIS-2026-0745: os dois prints
// das 12:48 quebrados na hora, e a MESMA URL entregando o PNG (219.938 bytes)
// minutos depois. Antes a tela guardava o link 50 min sem tentar de novo.
// Por isso: novas tentativas cobrindo mais de um ciclo do espelho.
const TENTATIVAS_IMAGEM = 5;
const ESPERA_IMAGEM_MS = 15_000;

/**
 * blob: URLs das imagens do chat, por caminho (null = não veio depois de
 * todas as tentativas). Só busca o que é novo — mensagem nova não rebaixa as
 * imagens que já estão na tela — e revoga tudo ao desmontar.
 */
export function useImagensAnexo(caminhos: string[]) {
  const [urls, setUrls] = useState<Record<string, string | null>>({});
  const pedidos = useRef(new Set<string>());
  const locais = useRef<string[]>([]);
  const vivo = useRef(true);
  const chave = caminhos.join("|");

  const buscar = useCallback(async (p: string, tentativa = 1) => {
    // Só o download (blob) prova que os bytes chegaram; a assinada sai mesmo
    // com o arquivo ausente no nó, e aí o <img> quebraria de novo.
    const r = await urlImagemAnexo(p).catch(() => null);
    if (!vivo.current) { if (r?.local) URL.revokeObjectURL(r.url); return; }
    if (r?.local) {
      locais.current.push(r.url);
      setUrls((cur) => ({ ...cur, [p]: r.url }));
      return;
    }
    if (tentativa < TENTATIVAS_IMAGEM) {
      setTimeout(() => { if (vivo.current) buscar(p, tentativa + 1); }, ESPERA_IMAGEM_MS);
      return;
    }
    setUrls((cur) => ({ ...cur, [p]: r?.url ?? null }));
  }, []);

  useEffect(() => {
    const novos = caminhos.filter((p) => !pedidos.current.has(p));
    novos.forEach((p) => pedidos.current.add(p));
    // Uma por vez: cada ida ao Storage é uma conexão do pool dele com o
    // Postgres (ver ModalFotosComprovacao, 21/09/2026).
    (async () => { for (const p of novos) await buscar(p); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; locais.current.forEach((u) => URL.revokeObjectURL(u)); };
  }, []);
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
