import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  CATEGORIAS_CANCELAMENTO_PEDIDO,
  validarMotivoCancelamento,
  type CategoriaCancelamentoPedido,
} from "@/lib/suprimentos/cancelamentoPedido";

export function SolicitarCancelamentoPedido({
  aberto,
  protocolo,
  enviando,
  onFechar,
  onConfirmar,
}: {
  aberto: boolean;
  protocolo: string | null;
  enviando: boolean;
  onFechar: () => void;
  onConfirmar: (categoria: CategoriaCancelamentoPedido, detalhe: string) => Promise<void>;
}) {
  const [categoria, setCategoria] = useState<CategoriaCancelamentoPedido | "">("");
  const [detalhe, setDetalhe] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) {
      setCategoria("");
      setDetalhe("");
      setErro(null);
    }
  }, [aberto]);

  const confirmar = async () => {
    const mensagem = validarMotivoCancelamento(categoria, detalhe);
    if (mensagem || !categoria) {
      setErro(mensagem ?? "Selecione o motivo do cancelamento.");
      return;
    }
    setErro(null);
    await onConfirmar(categoria, detalhe.trim());
  };

  return (
    <Dialog open={aberto} onOpenChange={(valor) => { if (!valor && !enviando) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Solicitar cancelamento de {protocolo}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2 text-sm">
          <p className="text-muted-foreground">
            O pedido continua ativo até o Suprimentos analisar. Pedidos retirados ou despachados não podem ser cancelados por este fluxo.
          </p>
          <div className="space-y-1.5">
            <Label>Motivo *</Label>
            <Select value={categoria} onValueChange={(valor) => setCategoria(valor as CategoriaCancelamentoPedido)}>
              <SelectTrigger><SelectValue placeholder="Selecione o motivo" /></SelectTrigger>
              <SelectContent>
                {CATEGORIAS_CANCELAMENTO_PEDIDO.map((item) => (
                  <SelectItem key={item.valor} value={item.valor}>{item.rotulo}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cancelamento-detalhe">Explique o motivo *</Label>
            <Textarea
              id="cancelamento-detalhe"
              value={detalhe}
              onChange={(evento) => setDetalhe(evento.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Descreva o que aconteceu e por que o pedido não deve continuar."
            />
            <p className="text-xs text-muted-foreground">Mínimo de 10 caracteres · {detalhe.length}/1000</p>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={enviando}>Voltar</Button>
          <Button variant="destructive" onClick={() => void confirmar()} disabled={enviando}>
            {enviando ? "Enviando…" : "Enviar solicitação"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
