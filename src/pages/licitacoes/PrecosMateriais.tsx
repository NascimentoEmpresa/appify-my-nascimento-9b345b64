import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePrecosConsulta, fmtBRL } from "@/hooks/useSupEstoque";
import { LABEL_TIPO_ITEM, type TipoItem } from "@/hooks/useSupCatalogo";
import { Search, Inbox, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Preços de Materiais — consulta da Licitação (SIS-2026-0199).
 *
 * Hoje, para montar a proposta de um edital, a Licitação manda uma planilha
 * para o comprador, ele cota e devolve. Como o gerente de Suprimentos colocou:
 *
 *   "Para o banco de dados que a gente tem de produto cadastrado, nós não
 *    precisaríamos fazer isso. A própria licitação poderia pesquisar: quanto
 *    custa hoje a nossa camiseta mescla, quanto custa a que boa 5 litros."
 *
 * SOMENTE LEITURA, e isso é o ponto — pedido dele nessas palavras: "uma aba de
 * consulta sem edição nenhuma, sem eles poderem alterar". Quem alimenta este
 * banco de preços é o Compras, dando entrada no estoque; aqui só se consulta.
 *
 * A VALIDADE é o que decide se o número serve. O preço tem prazo negociado com
 * o fornecedor ("quanto tempo tu consegue segurar essa cotação?"), e um preço
 * fora do prazo continua sendo referência, mas não fecha proposta — daí ele
 * aparecer marcado, e não escondido.
 */
export default function PrecosMateriais() {
  const [busca, setBusca] = useState("");
  const { data: precos = [], isLoading } = usePrecosConsulta(busca);

  const vencidos = precos.filter((p) => p.vencido).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preços de Materiais"
        subtitle="O que a empresa pagou pela última vez em cada material. Alimentado pelo Compras, na entrada do estoque."
        module="Licitações"
        breadcrumb={["Preços de Materiais"]}
      />

      <div className="flex gap-2 rounded-md border bg-muted/40 p-3 text-sm">
        <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          Consulta apenas. Preço com a validade vencida serve de referência, mas
          precisa de cotação nova antes de virar proposta — peça ao Compras.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)}
               placeholder="Buscar material… (ex.: camiseta, que boa, botina)" className="pl-9" />
      </div>

      {isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : precos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">
            {busca ? `Nenhum material encontrado para "${busca}"` : "Nenhum material com preço cadastrado."}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">
            {busca
              ? "Se o material nunca foi comprado, abra um chamado para o Compras cotar."
              : "Os preços aparecem aqui conforme o Compras dá entrada no estoque com o valor pago."}
          </p>
        </div>
      ) : (
        <>
          {vencidos > 0 && (
            <p className="text-xs text-amber-600">
              {vencidos} {vencidos === 1 ? "preço está" : "preços estão"} com a validade vencida.
            </p>
          )}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Valor unitário</TableHead>
                    <TableHead>Válido até</TableHead>
                    <TableHead>Atualizado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {precos.map((p) => (
                    <TableRow key={p.sup_item_id}>
                      <TableCell className="font-medium">
                        {p.material}
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          {LABEL_TIPO_ITEM[p.tipo as TipoItem] ?? p.tipo}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.fornecedor_nome ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold">{fmtBRL(p.valor_unitario)}</TableCell>
                      <TableCell>
                        {p.valido_ate ? (
                          <span className={cn("text-sm", p.vencido && "text-amber-600")}>
                            {fmtData(p.valido_ate)}
                            {p.vencido && <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">sem prazo definido</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(p.atualizado_em).toLocaleDateString("pt-BR")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/** 'YYYY-MM-DD' → 'DD/MM/AAAA' sem passar por Date. */
function fmtData(v?: string | null): string {
  if (!v) return "—";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}
