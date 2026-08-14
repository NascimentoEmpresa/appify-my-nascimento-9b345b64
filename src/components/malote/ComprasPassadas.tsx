import { ShoppingCart, DollarSign, Users, Tag, Info } from "lucide-react";
import { useComprasPassadas, fmtBRL, fmtData } from "@/hooks/useMaloteCotacao";

/**
 * "Compras passadas" — o que já se pagou nessa classificação.
 *
 * Existe para o comprador não cotar no escuro: se o valor médio das últimas
 * 10 compras é R$ 1,18, um orçamento de R$ 3,00 salta aos olhos.
 *
 * Não há base de compras consolidada no ERP. O histórico nasce das próprias
 * cotações aprovadas deste módulo, então começa vazio e ganha densidade com o
 * uso — o mock 3.1.1 já prevê esse estado ("Nenhum histórico encontrado").
 */
export function ComprasPassadas({
  classificacaoId, classificacaoNome, ignorarId,
}: {
  classificacaoId: string | null;
  classificacaoNome: string | null;
  ignorarId?: string;
}) {
  const { data } = useComprasPassadas(classificacaoId, ignorarId);

  if (!classificacaoId) return null;

  const vazio = !data || data.compras === 0;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/[0.03] p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
        <ShoppingCart className="h-4 w-4" />
        Compras passadas — {classificacaoNome ?? "classificação"}
        <Info className="h-3.5 w-3.5 opacity-60" />
      </p>

      {vazio ? (
        <div className="py-6 text-center">
          <p className="text-sm font-medium">Nenhum histórico encontrado.</p>
          <p className="text-xs text-muted-foreground">
            Ainda não há cotações aprovadas para esta classificação.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Cartao
            icone={DollarSign}
            rotulo="Valor médio do item"
            valor={fmtBRL(data.valor_medio)}
            apoio={`Baseado nas últimas ${data.compras} compra${data.compras > 1 ? "s" : ""}`}
          />
          <Cartao
            icone={Users}
            rotulo="Fornecedor mais frequente"
            valor={data.fornecedor_frequente ?? "—"}
            apoio={data.fornecedor_pct != null ? `(${data.fornecedor_pct}% das compras)` : ""}
          />
          <Cartao
            icone={ShoppingCart}
            rotulo="Valor da última compra"
            valor={fmtBRL(data.ultima_valor)}
            apoio={`${fmtData(data.ultima_data)}${data.ultima_fornecedor ? ` · ${data.ultima_fornecedor}` : ""}`}
          />
          <Cartao
            icone={Tag}
            rotulo="Menor valor já comprado"
            valor={fmtBRL(data.menor_valor)}
            apoio={`${fmtData(data.menor_data)}${data.menor_fornecedor ? ` · ${data.menor_fornecedor}` : ""}`}
          />
        </div>
      )}
    </div>
  );
}

function Cartao({
  icone: Icone, rotulo, valor, apoio,
}: { icone: React.ElementType; rotulo: string; valor: string; apoio?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border bg-background/60 p-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icone className="h-4 w-4 text-primary" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-muted-foreground">{rotulo}</p>
        <p className="truncate text-base font-semibold">{valor}</p>
        {apoio && <p className="truncate text-[11px] text-muted-foreground">{apoio}</p>}
      </div>
    </div>
  );
}
