import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useMeusPedidos, ESTILO_STATUS, fmtDataBR, type MeuPedido } from "@/hooks/useSupPedidos";
import { Search, Package, Plus, MessageSquare, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Meus Pedidos — acompanhamento do solicitante.
 *
 * Substitui o "Consultar Pedido por protocolo" do site legado: aqui a pessoa
 * já está identificada, então a lista vem pronta pela RPC sup_ext_meus_pedidos,
 * que casa por (contrato, identificação) além do auth.uid() da sessão. É isso
 * que faz o histórico sobreviver a trocar de aparelho.
 *
 * Editar e cancelar NÃO existem aqui por decisão de produto — são do Supply.
 */
export default function MeusPedidos() {
  const { data: pedidos = [], isLoading } = useMeusPedidos();
  const [busca, setBusca] = useState("");

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return pedidos;
    // Busca "varre tudo": qualquer coisa visível no card encontra o pedido.
    // É a melhor decisão de UX do legado (REPLICAR §5.4) e vale preservar.
    return pedidos.filter((p) =>
      [
        p.pedido_id, p.status, p.contrato_nome, p.posto_nome, p.funcao_nome,
        p.nome_colaborador, p.matricula_colaborador, p.observacoes_solicitante, p.observacao,
        fmtDataBR(p.data_solicitacao),
        ...(p.itens ?? []).flatMap((i) => [i.nome, i.tamanho ?? ""]),
      ].filter(Boolean).join(" ").toLowerCase().includes(t),
    );
  }, [pedidos, busca]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Meus Pedidos"
        subtitle="Acompanhe o andamento dos materiais que você solicitou."
        module="Encarregados"
        breadcrumb={["Meus Pedidos"]}
        actions={
          <Button asChild>
            <Link to="/app/encarregados/solicitar-materiais">
              <Plus className="mr-2 h-4 w-4" /> Novo pedido
            </Link>
          </Button>
        }
      />

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por protocolo, colaborador, material, data…"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtrados.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">
            {busca ? `Nenhum resultado para "${busca}"` : "Você ainda não fez nenhum pedido."}
          </p>
          <p className="text-sm text-muted-foreground">
            {busca ? "Tente outro termo de busca." : "Comece solicitando os materiais do seu posto."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtrados.map((p) => <CardPedido key={p.id} pedido={p} />)}
        </div>
      )}
    </div>
  );
}

function CardPedido({ pedido: p }: { pedido: MeuPedido }) {
  const estilo = ESTILO_STATUS[p.status] ?? ESTILO_STATUS["EM PREPARACAO"];
  // O cabeçalho da lista fala a língua do pedido — pequeno toque do legado.
  const tituloItens =
    p.tipo_pedido === "uniforme" ? "Uniformes"
    : p.tipo_pedido === "insumos" ? "EPIs e Insumos"
    : "Materiais";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <span className="font-mono text-sm font-semibold">{p.pedido_id}</span>
        <Badge variant="outline" className={cn("shrink-0", estilo.classe)}>{estilo.rotulo}</Badge>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Posto</dt><dd>{p.posto_nome}</dd>
          <dt className="text-muted-foreground">Função</dt><dd>{p.funcao_nome}</dd>
          {p.nome_colaborador && (<><dt className="text-muted-foreground">Colaborador</dt><dd>{p.nome_colaborador}</dd></>)}
          <dt className="text-muted-foreground">Solicitado</dt><dd>{fmtDataBR(p.data_solicitacao)}</dd>
          {p.data_despachado && (
            <><dt className="text-muted-foreground">Despachado</dt><dd>{fmtDataBR(p.data_despachado)}</dd></>
          )}
        </dl>

        <div className="rounded-md border bg-muted/40 p-2">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Package className="h-3.5 w-3.5" /> {tituloItens}
          </p>
          <ul className="space-y-0.5">
            {(p.itens ?? []).map((i, idx) => (
              <li key={idx} className="flex justify-between gap-2 text-xs">
                <span className="truncate">{i.nome}</span>
                <span className="shrink-0 text-muted-foreground">
                  {[i.tamanho && `Tam. ${i.tamanho}`, `Qtd. ${i.quantidade}`, i.litros && `${i.litros} L`]
                    .filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {p.observacoes_solicitante && (
          <p className="text-xs text-muted-foreground">
            <strong>Sua observação:</strong> {p.observacoes_solicitante}
          </p>
        )}

        {/* Retorno do Supply — o que o encarregado mais quer ver. */}
        {p.observacao && (
          <div className="flex items-start gap-2 rounded-md border border-blue-300/50 bg-blue-50/60 p-2 text-xs dark:bg-blue-950/20">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
            <p><strong>Compras:</strong> {p.observacao}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
