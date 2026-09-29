import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCriarRomaneio } from "@/hooks/useSupPedidos";
import { validarSelecaoRomaneio, volumesValidos } from "@/lib/suprimentos/romaneio";
import { imprimirRomaneio } from "@/lib/suprimentos/romaneioImpressao";
import { Loader2, PackageCheck, Printer } from "lucide-react";
import { toast } from "sonner";

export interface PedidoParaRomaneio {
  id: string;
  pedido_id: string;
  contrato_id: string | null;
  contrato_nome: string;
  posto_nome: string;
  nome_colaborador: string;
  status: string;
  romaneio_id: string | null;
  sup_pedido_item: Array<{ quantidade: number }>;
}

export function ModalRomaneio({
  pedidos,
  aberto,
  onFechar,
  onCriado,
}: {
  pedidos: PedidoParaRomaneio[];
  aberto: boolean;
  onFechar: () => void;
  onCriado: () => void;
}) {
  const criar = useCriarRomaneio();
  const [volumes, setVolumes] = useState("");
  const [observacao, setObservacao] = useState("");
  const validacao = useMemo(() => validarSelecaoRomaneio(pedidos), [pedidos]);

  useEffect(() => {
    if (!aberto) return;
    setVolumes("");
    setObservacao("");
  }, [aberto]);

  const confirmar = async () => {
    if (!validacao.valida || !volumesValidos(volumes)) return;
    // A janela precisa nascer no gesto do clique. Se for aberta apenas depois
    // da resposta da RPC, o navegador a interpreta como pop-up tardio.
    const janelaImpressao = window.open("", "_blank", "width=900,height=900");
    if (janelaImpressao) {
      janelaImpressao.document.write("<!doctype html><html lang=\"pt-BR\"><body style=\"font-family:Arial;padding:32px\">Criando romaneio…</body></html>");
      janelaImpressao.document.close();
    }
    let romaneio;
    try {
      romaneio = await criar.mutateAsync({
        pedidoIds: pedidos.map((pedido) => pedido.id),
        volumes: volumes ? Number(volumes) : null,
        observacao: observacao.trim() || null,
      });
    } catch (erro: unknown) {
      janelaImpressao?.close();
      toast.error(erro instanceof Error ? erro.message : "Não foi possível criar o romaneio.");
      return;
    }

    toast.success(`${romaneio.codigo} criado com ${pedidos.length} pedido(s).`);
    onCriado();
    onFechar();
    if (!janelaImpressao) {
      toast.error("O romaneio foi criado, mas o navegador bloqueou a impressão. Use Reimprimir depois de liberar os pop-ups.");
      return;
    }
    try {
      await imprimirRomaneio({ ...romaneio, pedidos }, janelaImpressao);
    } catch {
      toast.error("O romaneio foi criado, mas não foi possível gerar o QR para impressão. Use Reimprimir para tentar novamente.");
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(valor) => !valor && onFechar()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" /> Gerar romaneio de retirada
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p><strong>Contrato:</strong> {pedidos[0]?.contrato_nome ?? "—"}</p>
            <p><strong>Pedidos:</strong> {pedidos.length}</p>
          </div>

          {!validacao.valida && (
            <p className="rounded-md border border-amber-400/50 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              {validacao.motivo}
            </p>
          )}

          <div className="max-h-64 overflow-y-auto rounded-md border">
            <ul className="divide-y text-sm">
              {pedidos.map((pedido) => (
                <li key={pedido.id} className="flex items-start justify-between gap-3 p-3">
                  <div>
                    <p className="font-mono font-medium">{pedido.pedido_id}</p>
                    <p className="text-xs text-muted-foreground">
                      {pedido.nome_colaborador || "Sem colaborador"} · {pedido.posto_nome}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {pedido.sup_pedido_item.reduce((total, item) => total + item.quantidade, 0)} item(ns)
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="romaneio-volumes">Volumes (opcional)</Label>
              <Input
                id="romaneio-volumes"
                type="number"
                min={1}
                step={1}
                value={volumes}
                onChange={(evento) => setVolumes(evento.target.value)}
                placeholder="Ex.: 3"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="romaneio-observacao">Observação (opcional)</Label>
              <Textarea
                id="romaneio-observacao"
                rows={3}
                value={observacao}
                onChange={(evento) => setObservacao(evento.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button
            onClick={confirmar}
            disabled={!validacao.valida || criar.isPending || !volumesValidos(volumes)}
          >
            {criar.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando…</>
              : <><Printer className="mr-2 h-4 w-4" /> Criar e imprimir</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
