import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

// A RPC nova só entra nos tipos gerados depois que a migration é aplicada.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const BUCKET = "sup-comprovacoes";

interface PedidoComprovacao {
  id: string;
  pedido_id: string;
}

interface FotoPendente {
  arquivo: File;
  colaborador_nome: string;
}

function extensao(arquivo: File) {
  const porNome = arquivo.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (porNome) return porNome;
  return arquivo.type.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "jpg";
}

export function ModalComprovacaoEntrega({
  pedido,
  onFechar,
  onEnviado,
}: {
  pedido: PedidoComprovacao | null;
  onFechar: () => void;
  onEnviado?: () => void;
}) {
  const qc = useQueryClient();
  const [recebedor, setRecebedor] = useState("");
  const [observacao, setObservacao] = useState("");
  const [fotos, setFotos] = useState<FotoPendente[]>([]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    setRecebedor("");
    setObservacao("");
    setFotos([]);
    setEnviando(false);
  }, [pedido]);

  const adicionarFotos = (arquivos: FileList | null) => {
    if (!arquivos?.length) return;
    setFotos((atuais) => [
      ...atuais,
      ...Array.from(arquivos).map((arquivo) => ({ arquivo, colaborador_nome: "" })),
    ]);
  };

  const enviar = async () => {
    if (!pedido || !recebedor.trim() || fotos.length === 0) return;
    setEnviando(true);
    const enviados: string[] = [];
    let envioConfirmado = false;
    try {
      const payloadFotos = [];
      for (const [ordem, foto] of fotos.entries()) {
        const caminho = `${pedido.id}/${crypto.randomUUID()}.${extensao(foto.arquivo)}`;
        const { error } = await supabase.storage.from(BUCKET).upload(caminho, foto.arquivo, {
          contentType: foto.arquivo.type || undefined,
          upsert: false,
        });
        if (error) throw error;
        enviados.push(caminho);
        payloadFotos.push({ storage_path: caminho, colaborador_nome: foto.colaborador_nome.trim() || null, ordem });
      }

      const { error } = await sb.rpc("sup_ext_comprovacao_enviar", {
        p_pedido_id: pedido.id,
        p_payload: {
          recebedor_nome: recebedor.trim(),
          observacao: observacao.trim() || null,
          fotos: payloadFotos,
        },
      });
      if (error) throw error;
      envioConfirmado = true;
    } catch (erro: unknown) {
      // Se a RPC rejeitar, os uploads desta tentativa não podem virar órfãos.
      // A remoção pode ser barrada para o externo; nesse caso o registro ainda
      // não aponta para os arquivos e uma limpeza administrativa pode removê-los.
      if (enviados.length) await supabase.storage.from(BUCKET).remove(enviados);
      toast.error(erro instanceof Error ? erro.message : "Não foi possível enviar a comprovação.");
      setEnviando(false);
      return;
    }

    // A RPC já confirmou a transação: daqui em diante as fotos não podem mais
    // participar do rollback compensatório, mesmo que a atualização do cache
    // falhe. As invalidações são somente sincronização da interface.
    if (!envioConfirmado) return;
    void Promise.allSettled([
      qc.invalidateQueries({ queryKey: ["sup_ext_meus_pedidos"] }),
      qc.invalidateQueries({ queryKey: ["sup_pedido"] }),
    ]);
    toast.success("Comprovação de entrega enviada.");
    onEnviado?.();
    onFechar();
    setEnviando(false);
  };

  const motivo = !recebedor.trim()
    ? "Informe quem recebeu."
    : fotos.length === 0
      ? "Adicione pelo menos uma foto."
      : null;

  return (
    <Dialog open={!!pedido} onOpenChange={(aberto) => !aberto && !enviando && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Comprovação de entrega · {pedido?.pedido_id}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div>
            <Label htmlFor="comprovacao-recebedor">Nome de quem recebeu *</Label>
            <Input id="comprovacao-recebedor" value={recebedor} onChange={(e) => setRecebedor(e.target.value)} autoComplete="name" />
          </div>
          <div>
            <Label htmlFor="comprovacao-observacao">Observação <span className="text-muted-foreground">(opcional)</span></Label>
            <Textarea id="comprovacao-observacao" value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} />
          </div>
          <div className="space-y-3">
            <div>
              <Label htmlFor="comprovacao-fotos">Fotos dos colaboradores *</Label>
              <p className="mb-2 text-xs text-muted-foreground">No celular, use a câmera. É necessário enviar pelo menos uma foto.</p>
              <Input
                id="comprovacao-fotos"
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={(e) => { adicionarFotos(e.target.files); e.currentTarget.value = ""; }}
              />
            </div>
            {fotos.map((foto, indice) => (
              <div key={`${foto.arquivo.name}-${foto.arquivo.lastModified}-${indice}`} className="grid items-end gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr_auto]">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Foto {indice + 1}</p>
                  <p className="truncate text-sm" title={foto.arquivo.name}>{foto.arquivo.name}</p>
                </div>
                <div>
                  <Label htmlFor={`foto-colaborador-${indice}`}>Nome do colaborador</Label>
                  <Input
                    id={`foto-colaborador-${indice}`}
                    value={foto.colaborador_nome}
                    onChange={(e) => setFotos((atuais) => atuais.map((item, i) => i === indice ? { ...item, colaborador_nome: e.target.value } : item))}
                    placeholder="Opcional"
                  />
                </div>
                <Button type="button" size="icon" variant="ghost" onClick={() => setFotos((atuais) => atuais.filter((_, i) => i !== indice))} aria-label={`Remover foto ${indice + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {fotos.length === 0 && (
              <div className="flex items-center justify-center gap-2 rounded-md border border-dashed py-5 text-sm text-muted-foreground">
                <Camera className="h-4 w-4" /> Nenhuma foto adicionada.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>Cancelar</Button>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={enviar} disabled={enviando || !!motivo}>
              {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</> : "Enviar comprovação"}
            </Button>
            {motivo && <span className="text-xs text-amber-700 dark:text-amber-300">{motivo}</span>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
