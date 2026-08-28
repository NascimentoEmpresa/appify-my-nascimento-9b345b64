import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Mail, Loader2, CheckCircle2, Clock, AlertTriangle } from "lucide-react";

// RPCs novas, ainda fora do types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Manda o pedido ao fornecedor e acompanha a comprovação.
 *
 * O e-mail sai pelo worker (o SMTP mora lá), então esta tela ENFILEIRA e
 * mostra o andamento — não envia. Por isso o estado "na fila": o fornecedor
 * ainda não recebeu nada, e dizer "enviado" ali seria mentira.
 *
 * Três marcos, e a distinção é o que serve de prova depois:
 *   enviado      → o e-mail saiu do nosso lado
 *   visualizado  → ele clicou no link (chegou e foi lido)
 *   confirmado   → ele apertou "estou ciente" (aceitou o pedido)
 */

interface Envio {
  id: string;
  email_destino: string;
  criado_em: string;
  criado_por_nome: string | null;
  enviado_em: string | null;
  erro_envio: string | null;
  visualizado_em: string | null;
  confirmado_em: string | null;
}

const fmt = (d: string | null) =>
  !d ? "—" : new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function EnviarPedidoFornecedor({
  pedidoId,
  numero,
  emailSugerido,
  desabilitado,
}: {
  pedidoId: string;
  numero: string;
  emailSugerido?: string | null;
  desabilitado?: boolean;
}) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const [email, setEmail] = useState("");

  const envios = useQuery({
    queryKey: ["sup_compra_pedido_envio", pedidoId],
    enabled: aberto,
    queryFn: async (): Promise<Envio[]> => {
      const { data, error } = await sb
        .from("sup_compra_pedido_envio")
        .select("*")
        .eq("pedido_id", pedidoId)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const enviar = useMutation({
    mutationFn: async () => {
      const { error } = await sb.rpc("sup_compra_enviar_ao_fornecedor", {
        p_pedido_id: pedidoId,
        p_email: email.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sup_compra_pedido_envio", pedidoId] });
      setEmail("");
      toast.success("Pedido na fila de envio. O e-mail sai no próximo ciclo do worker.");
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar."),
  });

  const lista = envios.data ?? [];
  const ultimoConfirmado = lista.find((e) => e.confirmado_em);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)} disabled={desabilitado}>
        <Mail className="mr-1.5 h-3.5 w-3.5" />
        Enviar ao fornecedor
      </Button>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Enviar o pedido {numero} ao fornecedor</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {ultimoConfirmado && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Fornecedor confirmou em {fmt(ultimoConfirmado.confirmado_em)}.
                </span>
              </div>
            )}

            <div>
              <Label>E-mail do fornecedor</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={emailSugerido || "email@fornecedor.com.br"}
                type="email"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {emailSugerido
                  ? `Em branco, usa o do cadastro: ${emailSugerido}`
                  : "Este fornecedor não tem e-mail no cadastro — informe um."}
              </p>
            </div>

            {lista.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Envios anteriores</p>
                <div className="space-y-1.5 rounded-md border p-2">
                  {lista.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <Estado envio={e} />
                      <span className="font-medium">{e.email_destino}</span>
                      <span className="text-muted-foreground">
                        por {e.criado_por_nome ?? "—"} · {fmt(e.criado_em)}
                      </span>
                      {e.visualizado_em && (
                        <span className="text-muted-foreground">
                          · abriu {fmt(e.visualizado_em)}
                        </span>
                      )}
                      {e.erro_envio && (
                        <span className="w-full text-destructive">{e.erro_envio}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAberto(false)}>Fechar</Button>
            <Button onClick={() => enviar.mutate()} disabled={enviar.isPending}>
              {enviar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {lista.length ? "Enviar de novo" : "Enviar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Estado({ envio }: { envio: Envio }) {
  if (envio.erro_envio) {
    return (
      <Badge variant="destructive" className="gap-1 text-[10px]">
        <AlertTriangle className="h-3 w-3" /> falhou
      </Badge>
    );
  }
  if (envio.confirmado_em) {
    return <Badge className="text-[10px]">confirmado</Badge>;
  }
  if (envio.visualizado_em) {
    return <Badge variant="secondary" className="text-[10px]">visualizado</Badge>;
  }
  if (envio.enviado_em) {
    return <Badge variant="outline" className="text-[10px]">enviado</Badge>;
  }
  return (
    <Badge variant="outline" className="gap-1 text-[10px]">
      <Clock className="h-3 w-3" /> na fila
    </Badge>
  );
}
