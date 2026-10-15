import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDecidirExcecao } from "@/hooks/useMaloteExcecao";
import type { ExcecaoSolicitacao } from "./regras";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.split("T")[0].split("-").reverse().join("/");

export interface AlvoDecisaoExcecao {
  s: ExcecaoSolicitacao;
  aprovar: boolean;
}

// SIS-2026-0668: confirmação de aprovar/reprovar uma exceção. Usado pela Autorizações de Exceção (lista e painel de
// detalhes). Quem decide de verdade é o banco (malote_excecao_decidir); aqui só se pede o motivo da reprovação.
export function DecidirExcecaoDialog({ alvo, onClose }: { alvo: AlvoDecisaoExcecao | null; onClose: () => void }) {
  const decidir = useDecidirExcecao();
  const [motivo, setMotivo] = useState("");

  function fechar() {
    setMotivo("");
    onClose();
  }

  async function confirmar() {
    if (!alvo) return;
    if (!alvo.aprovar && !motivo.trim()) {
      toast.error("Informe o motivo da reprovação.");
      return;
    }
    try {
      const senha = await decidir.mutateAsync({ id: alvo.s.id, aprovar: alvo.aprovar, motivo: motivo.trim() || undefined });
      toast.success(alvo.aprovar ? `Exceção ${alvo.s.numero} aprovada. A senha (${senha}) foi enviada ao solicitante.` : `Exceção ${alvo.s.numero} reprovada.`);
      fechar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar a decisão.");
    }
  }

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => { if (!o) fechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{alvo?.aprovar ? "Aprovar exceção" : "Reprovar exceção"} {alvo?.s.numero}</DialogTitle>
          <DialogDescription>
            {alvo?.s && <>{brl(alvo.s.valor)} · pagamento em {dia(alvo.s.data_pagamento)} · {alvo.s.descricao}</>}
          </DialogDescription>
        </DialogHeader>
        {alvo?.aprovar ? (
          <p className="text-sm text-muted-foreground">
            Ao aprovar, o sistema gera uma senha única, válida por 24 horas, e avisa o solicitante. A senha libera só esta data e esta classificação, até o valor pedido.
          </p>
        ) : (
          <div>
            <label className="text-sm font-medium">Motivo da reprovação *</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
              className="mt-1 min-h-20 w-full rounded-md border border-input bg-background p-2 text-sm"
              placeholder="Explique ao solicitante por que a exceção não foi aprovada…"
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Voltar</Button>
          <Button
            onClick={() => void confirmar()}
            disabled={decidir.isPending}
            className={alvo?.aprovar ? "bg-emerald-600 hover:bg-emerald-700" : undefined}
            variant={alvo?.aprovar ? "default" : "destructive"}
          >
            {decidir.isPending ? "Registrando…" : alvo?.aprovar ? "Aprovar e gerar senha" : "Reprovar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
