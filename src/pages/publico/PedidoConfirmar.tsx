import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, PackageCheck } from "lucide-react";

// RPCs novas, ainda fora do types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * O pedido de compra, como o fornecedor vê — sem login.
 *
 * O token na URL é a credencial: quem tem o link recebeu o e-mail. Mesmo
 * desenho do cadastro público de fornecedor.
 *
 * A tela registra DUAS coisas separadas, e a diferença importa numa
 * eventual discussão:
 *   abrir       → prova que a mensagem chegou e foi lida
 *   confirmar   → prova que o fornecedor aceitou o pedido
 *
 * A abertura é registrada sozinha ao carregar; a confirmação exige clique.
 * Só isso já é mais confiável que pixel de rastreamento, que dispara no
 * preview automático do cliente de e-mail sem ninguém ter lido.
 */

interface Item {
  nome: string;
  quantidade: number;
  unidade: string | null;
  tamanho: string | null;
  valor_unitario: number | null;
}

interface Pedido {
  numero: string;
  empresa_nome: string | null;
  fornecedor_nome: string | null;
  valor_total: number | null;
  data_limite_entrega: string | null;
  local_entrega: string | null;
  forma_pagamento: string | null;
  condicoes_negociadas: string | null;
  frete_incluso: boolean;
  observacoes: string | null;
}

const fmtBRL = (v: number | null) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const fmtQtd = (v: number) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

const fmtData = (d: string | null) =>
  !d ? "—" : new Date(d).toLocaleDateString("pt-BR");

const fmtDataHora = (d: string | null) =>
  !d ? "—" : new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function PedidoConfirmar() {
  const { token } = useParams<{ token: string }>();
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [confirmadoEm, setConfirmadoEm] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await sb.rpc("sup_compra_pedido_por_token", { p_token: token });
      if (!vivo) return;
      if (error || !data || data.erro) {
        setErro(data?.erro ?? "Não foi possível abrir o pedido.");
        setCarregando(false);
        return;
      }
      setPedido(data.pedido);
      setItens(data.itens ?? []);
      setConfirmadoEm(data.confirmado_em ?? null);
      setCarregando(false);
      // Registra a abertura sem travar a tela: se falhar, o fornecedor ainda
      // consegue ver e confirmar — a confirmação é o que realmente importa.
      sb.rpc("sup_compra_registrar_visualizacao", { p_token: token, p_acao: "abriu" });
    })();
    return () => { vivo = false; };
  }, [token]);

  const confirmar = async () => {
    setConfirmando(true);
    const { data, error } = await sb.rpc("sup_compra_registrar_visualizacao", {
      p_token: token,
      p_acao: "confirmou",
    });
    setConfirmando(false);
    if (error || data?.erro) {
      setErro(data?.erro ?? "Não foi possível registrar a confirmação.");
      return;
    }
    setConfirmadoEm(data?.confirmado_em ?? new Date().toISOString());
  };

  if (carregando) {
    return (
      <Moldura>
        <p className="py-10 text-center text-sm text-muted-foreground">Carregando…</p>
      </Moldura>
    );
  }

  if (erro || !pedido) {
    return (
      <Moldura>
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <XCircle className="h-10 w-10 text-destructive" />
          <p className="font-medium">Link indisponível</p>
          <p className="max-w-sm text-sm text-muted-foreground">{erro}</p>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="space-y-5">
        <div>
          <p className="text-xs text-muted-foreground">{pedido.empresa_nome}</p>
          <h1 className="text-xl font-semibold">Pedido de compra {pedido.numero}</h1>
          {pedido.fornecedor_nome && (
            <p className="text-sm text-muted-foreground">Para: {pedido.fornecedor_nome}</p>
          )}
        </div>

        {confirmadoEm && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Recebimento confirmado em {fmtDataHora(confirmadoEm)}.</span>
          </div>
        )}

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-right font-medium">Qtd</th>
                <th className="px-3 py-2 text-right font-medium">Valor un.</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2">
                    {i.nome}
                    {i.tamanho && <span className="text-muted-foreground"> ({i.tamanho})</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtQtd(i.quantidade)} {i.unidade || "UN"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmtBRL(i.valor_unitario)}
                  </td>
                </tr>
              ))}
              {itens.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    Sem itens neste pedido.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Linha rotulo="Total" valor={fmtBRL(pedido.valor_total)} forte />
          <Linha rotulo="Entrega prevista" valor={fmtData(pedido.data_limite_entrega)} />
          <Linha rotulo="Pagamento" valor={pedido.forma_pagamento || "—"} />
          <Linha rotulo="Frete" valor={pedido.frete_incluso ? "Incluso" : "Não incluso"} />
          {pedido.local_entrega && <Linha rotulo="Local de entrega" valor={pedido.local_entrega} />}
          {pedido.condicoes_negociadas && (
            <Linha rotulo="Condições" valor={pedido.condicoes_negociadas} />
          )}
        </dl>

        {pedido.observacoes && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Observações</p>
            {pedido.observacoes}
          </div>
        )}

        {!confirmadoEm && (
          <div className="space-y-2 rounded-md border p-4">
            <p className="text-sm">
              Confirme abaixo que recebeu este pedido e está de acordo com os itens, valores e
              prazo.
            </p>
            <Button onClick={confirmar} disabled={confirmando} className="w-full sm:w-auto">
              {confirmando ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PackageCheck className="mr-2 h-4 w-4" />
              )}
              Estou ciente e de acordo
            </Button>
          </div>
        )}
      </div>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-lg border bg-background p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{rotulo}</dt>
      <dd className={forte ? "font-semibold" : ""}>{valor}</dd>
    </div>
  );
}
