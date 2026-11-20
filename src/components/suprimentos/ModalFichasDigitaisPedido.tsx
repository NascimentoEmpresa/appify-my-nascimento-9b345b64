import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFichasDigitaisPedido } from "@/hooks/useFichasDigitaisPedido";
import { DECLARACAO_EPI, dataHoraEpi, imprimirComprovanteEpi } from "@/lib/suprimentos/entregaEpi";
import { comprovanteDaFichaDigital } from "@/lib/suprimentos/fichasDigitaisPedido";
import { FileText, Printer } from "lucide-react";
import { toast } from "sonner";

interface PedidoDaFicha {
  id: string;
  pedido_id: string;
}

export function ModalFichasDigitaisPedido({
  pedido, onFechar, onAbrirModelo,
}: {
  pedido: PedidoDaFicha | null;
  onFechar: () => void;
  onAbrirModelo: () => void;
}) {
  const { data: fichas = [], isLoading, error, refetch } = useFichasDigitaisPedido(pedido?.id ?? null);

  return (
    <Dialog open={!!pedido} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fichas de EPI · {pedido?.pedido_id}</DialogTitle>
          <DialogDescription>
            Cada linha representa uma entrega digital deste pedido. Abra a ficha para conferir os EPIs e salvar o comprovante confirmado pelo colaborador.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="py-6 text-sm text-muted-foreground">Buscando fichas digitais…</p>}
        {error && <div className="space-y-2 py-4 text-sm text-destructive">
          <p>Não foi possível consultar as fichas: {(error as Error).message}</p>
          <Button variant="outline" onClick={() => void refetch()}>Tentar novamente</Button>
        </div>}
        {!isLoading && !error && <>
          {fichas.length === 0 ? (
            <p className="rounded-md border p-4 text-sm text-muted-foreground">Nenhuma entrega digital de EPI registrada para este pedido.</p>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {fichas.map((ficha, indice) => (
                <AccordionItem key={ficha.id} value={ficha.id} className="rounded-md border px-3">
                  <AccordionTrigger className="gap-3 text-left hover:no-underline">
                    <span className="flex flex-1 flex-wrap items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0" />
                      <span>Ficha {fichas.length - indice} · {dataHoraEpi(ficha.registrado_em)}</span>
                      <Badge variant={ficha.confirmado_em ? "default" : "secondary"}>
                        {ficha.confirmado_em ? "Confirmada pelo colaborador" : "Aguardando confirmação"}
                      </Badge>
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <div className="grid gap-1 sm:grid-cols-2">
                      <p><b>Colaborador:</b> {ficha.colaborador_nome}</p>
                      <p><b>Matrícula:</b> {ficha.matricula ?? "—"}</p>
                      <p><b>Empresa:</b> {ficha.empresa_nome ?? "—"}</p>
                      <p><b>Contrato / posto:</b> {ficha.contrato_nome} / {ficha.posto_nome}</p>
                      <p><b>Função:</b> {ficha.funcao_nome}</p>
                      <p><b>Responsável pela entrega:</b> {ficha.entregador_nome}</p>
                      <p><b>Confirmado em:</b> {dataHoraEpi(ficha.confirmado_em)}</p>
                    </div>
                    <div className="rounded-md border p-3">
                      <p className="mb-2 font-medium">EPIs desta ficha</p>
                      <ul className="list-inside list-disc space-y-1">
                        {ficha.itens.map((item) => (
                          <li key={`${item.pedido_item_id}-${item.codigo}`}>
                            {item.quantidade} × {item.descricao}{item.tamanho ? ` · ${item.tamanho}` : ""} · Lote {item.codigo} · CA {item.ca ?? "não informado"}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <p className="rounded-md border bg-muted/30 p-3">{DECLARACAO_EPI}</p>
                    {ficha.confirmacao_hash && <p className="break-all text-xs"><b>SHA-256:</b> {ficha.confirmacao_hash}</p>}
                    {ficha.confirmado_em ? (
                      <Button variant="outline" onClick={() => {
                        try { imprimirComprovanteEpi(comprovanteDaFichaDigital(ficha)); }
                        catch (erro) { toast.error(erro instanceof Error ? erro.message : "Não foi possível abrir o comprovante."); }
                      }}><Printer className="mr-2 h-4 w-4" /> Abrir / salvar PDF confirmado</Button>
                    ) : <p className="text-muted-foreground">O PDF confirmado ficará disponível após a confirmação pessoal no Portal do Colaborador.</p>}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </>}

        <Button variant="ghost" className="self-start" onClick={onAbrirModelo}>
          Abrir modelo para impressão sem confirmação digital
        </Button>
      </DialogContent>
    </Dialog>
  );
}
