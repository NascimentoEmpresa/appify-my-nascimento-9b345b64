import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ImageOff, Loader2 } from "lucide-react";

// As relações da comprovação ainda não existem no types.ts até a migration remota.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const BUCKET = "sup-comprovacoes";

interface FotoComprovacao {
  url: string;
  colaborador_nome: string | null;
}

/**
 * Fotos tiradas no formulário de comprovação de entrega.
 *
 * O PDF do comprovante saía com as fotos anexadas como páginas, e a operação
 * pediu (set/2026) que o documento ficasse só com a folha de comprovação — as
 * fotos passam a abrir aqui, pelo QR code ou pela frase clicável do rodapé do
 * PDF, que apontam para `pedidos-materiais?fotos=<id do pedido>`.
 */
export function ModalFotosComprovacao({ pedidoId, onFechar }: { pedidoId: string | null; onFechar: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sup_pedido_comprovacao_fotos", pedidoId],
    enabled: !!pedidoId,
    // As URLs assinadas valem 1h; não adianta reaproveitar do cache além disso.
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data: pedido, error: erroPedido } = await sb
        .from("sup_pedido")
        .select("pedido_id, sup_pedido_comprovacao(status, sup_pedido_comprovacao_foto(storage_path, colaborador_nome, ordem))")
        .eq("id", pedidoId)
        .single();
      if (erroPedido) throw erroPedido;

      const relacao = pedido.sup_pedido_comprovacao;
      const comprovacao = Array.isArray(relacao) ? relacao[0] : relacao;
      const registros = [...(comprovacao?.sup_pedido_comprovacao_foto ?? [])]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .sort((a: any, b: any) => a.ordem - b.ordem);

      // 21/09/2026: isto assinava as fotos UMA A UMA, em sequência — uma
      // entrega com 15 fotos virava 15 idas ao Storage, uma esperando a outra.
      //
      // Importa mais do que parece: cada chamada ao Storage consome uma
      // conexão do pool que ele mantém com o Postgres, e foi justamente o
      // Storage saltando de 1 para 15 conexões que estourou o teto de 57 e
      // reiniciou o banco às 14:01:59. `createSignedUrls` (plural) resolve
      // tudo numa chamada só — o mesmo padrão já usado em ConversaSolicitacao,
      // ChatChamado e useSupPatrimonio.
      const caminhos = registros.map((r: any) => r.storage_path as string);
      const fotos: FotoComprovacao[] = [];
      if (caminhos.length) {
        const { data: assinadas, error: erroUrl } = await supabase.storage
          .from(BUCKET)
          .createSignedUrls(caminhos, 3600);
        if (erroUrl) throw erroUrl;
        // createSignedUrls devolve na MESMA ordem dos caminhos enviados, e traz
        // `error` por item — uma foto que falhe não pode derrubar as outras.
        (assinadas ?? []).forEach((assinada, i) => {
          if (!assinada?.signedUrl) return;
          fotos.push({ url: assinada.signedUrl, colaborador_nome: registros[i].colaborador_nome });
        });
      }
      return { protocolo: pedido.pedido_id as string, fotos };
    },
  });

  return (
    <Dialog open={!!pedidoId} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Fotos da entrega{data?.protocolo ? ` — ${data.protocolo}` : ""}</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando fotos…
          </div>
        )}
        {error && (
          <p className="py-10 text-center text-sm text-destructive">
            Não foi possível carregar as fotos deste pedido.
          </p>
        )}
        {data && data.fotos.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
            <ImageOff className="h-6 w-6" /> Nenhuma foto enviada nesta comprovação.
          </div>
        )}
        {data && data.fotos.length > 0 && (
          <div className="grid max-h-[70vh] grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2">
            {data.fotos.map((foto, indice) => (
              <a
                key={foto.url}
                href={foto.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group overflow-hidden rounded-md border bg-muted/30"
                title="Abrir em tamanho original"
              >
                <img
                  src={foto.url}
                  alt={foto.colaborador_nome || `Foto ${indice + 1}`}
                  className="h-64 w-full object-contain transition-opacity group-hover:opacity-90"
                  loading="lazy"
                />
                <p className="border-t px-3 py-2 text-sm">
                  {foto.colaborador_nome || `Foto ${indice + 1}`}
                </p>
              </a>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
