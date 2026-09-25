import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Printer } from "lucide-react";
import { toast } from "sonner";
import {
  gerarHtmlFichaEpi, imprimirFichaEpi, montarFichaEpi,
  type CamposFicha, type PedidoFicha, type RespostaFichaEpi,
} from "@/lib/suprimentos/fichaEpi";

/**
 * Ficha de Controle e Entrega de EPI de um pedido.
 *
 * Abre já preenchida: empresa do contrato no cabeçalho, colaborador pelo RH
 * quando ele é encontrado em EMPREGADOS, e os itens do pedido na grade. Os
 * campos de texto ficam editáveis porque admissão costuma chegar sem
 * matrícula e sem cargo oficial — o Supply completa na hora, sem precisar
 * editar o pedido só para imprimir a ficha.
 *
 * A prévia é o MESMO HTML que vai para a impressora (num iframe), para não
 * existir diferença entre o que se confere na tela e o que sai no papel.
 */

// A RPC é nova (20260930000095) e ainda não está no types.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const CAMPOS: { chave: keyof CamposFicha; rotulo: string; placeholder?: string }[] = [
  { chave: "nome", rotulo: "Nome" },
  { chave: "registro", rotulo: "Nº de registro" },
  { chave: "admissao", rotulo: "Data de admissão", placeholder: "dd/mm/aaaa" },
  { chave: "funcao", rotulo: "Função" },
  { chave: "secao", rotulo: "Seção/Local" },
  { chave: "demissao", rotulo: "Data de demissão", placeholder: "dd/mm/aaaa" },
  { chave: "data", rotulo: "Data da declaração", placeholder: "dd/mm/aaaa" },
];

/** A migration não foi aplicada no banco (PostgREST não acha a função). */
function faltaFuncao(erro: unknown) {
  const e = erro as { code?: string; message?: string } | null;
  return e?.code === "PGRST202" || /sup_pedido_ficha_epi/.test(e?.message ?? "");
}

export function ModalFichaEpi({ pedido, onFechar }: { pedido: PedidoFicha | null; onFechar: () => void }) {
  const { data: resposta, error, isLoading } = useQuery({
    queryKey: ["sup_pedido_ficha_epi", pedido?.id],
    enabled: !!pedido,
    retry: false,
    queryFn: async (): Promise<RespostaFichaEpi> => {
      const { data, error } = await sb.rpc("sup_pedido_ficha_epi", { p_pedido_id: pedido!.id });
      if (error) throw error;
      return data as RespostaFichaEpi;
    },
  });

  const base = useMemo(
    () => (pedido && !isLoading ? montarFichaEpi(pedido, resposta ?? null) : null),
    [pedido, resposta, isLoading],
  );

  // Os campos editados ficam no estado local e só são repostos quando muda o
  // PEDIDO ou chega resposta nova do banco — não a cada refetch da fila, que
  // recria o objeto do pedido e apagaria o que o usuário acabou de digitar.
  const [campos, setCampos] = useState<CamposFicha | null>(null);
  useEffect(() => {
    setCampos(base ? base.campos : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido?.id, resposta, isLoading]);

  const dados = useMemo(() => (base && campos ? { ...base, campos } : null), [base, campos]);
  const html = useMemo(() => (dados ? gerarHtmlFichaEpi(dados) : ""), [dados]);

  const imprimir = () => {
    if (!dados) return;
    try {
      imprimirFichaEpi(dados);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir a impressão.");
    }
  };

  const alterar = (chave: keyof CamposFicha, valor: string) =>
    setCampos((atual) => (atual ? { ...atual, [chave]: valor } : atual));

  return (
    <Dialog open={!!pedido} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[94vh] max-w-5xl overflow-y-auto">
        <DialogHeader className="flex-row items-start justify-between gap-3 space-y-0 pr-8">
          <div className="space-y-1">
            <DialogTitle>Ficha de EPI · {pedido?.pedido_id}</DialogTitle>
            <DialogDescription>
              Confira os dados, ajuste o que faltar e imprima.
            </DialogDescription>
          </div>
          <Button onClick={imprimir} disabled={!dados || !!error} title="Imprimir ficha de EPI">
            <Printer className="mr-2 h-4 w-4" /> Imprimir
          </Button>
        </DialogHeader>

        {isLoading ? (
          <p className="py-16 text-center text-sm text-muted-foreground">Buscando empresa e dados do colaborador…</p>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50/60 p-2 text-xs dark:bg-amber-950/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-amber-900 dark:text-amber-200">
                  {faltaFuncao(error)
                    ? "A função do banco que confirma os itens enviados ainda não foi aplicada. A impressão foi bloqueada para não incluir itens pendentes."
                    : `Não foi possível confirmar os itens enviados: ${(error as Error).message}. A impressão foi bloqueada para não incluir itens pendentes.`}
                </p>
              </div>
            )}
            {!error && resposta && !dados?.empresa && (
              <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50/60 p-2 text-xs dark:bg-amber-950/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-amber-900 dark:text-amber-200">
                  O contrato deste pedido não tem empresa vinculada — o cabeçalho sai sem razão social e CNPJ.
                  Ajuste o contrato em Licitações.
                </p>
              </div>
            )}
            {!error && resposta && !resposta.colaborador && (
              <p className="text-xs text-muted-foreground">
                Colaborador não encontrado no cadastro do RH (comum em admissão) — os dados abaixo vieram do pedido.
              </p>
            )}

            {campos && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {CAMPOS.map((c) => (
                  <div key={c.chave} className={c.chave === "nome" ? "sm:col-span-2" : undefined}>
                    <Label className="text-xs">{c.rotulo}</Label>
                    <Input
                      value={campos[c.chave]}
                      placeholder={c.placeholder}
                      onChange={(e) => alterar(c.chave, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Largura fixa de folha A4: a prévia rola de lado em tela
                estreita, em vez de espremer a ficha e mentir sobre o papel. */}
            <div className="overflow-x-auto rounded-md border bg-muted/40 p-3">
              <iframe
                title="Prévia da ficha de EPI"
                srcDoc={html}
                sandbox=""
                className="mx-auto block h-[297mm] w-[210mm] max-w-none bg-white shadow"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
