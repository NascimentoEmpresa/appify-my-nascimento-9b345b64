import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ListTree } from "lucide-react";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useItensParaClassificar, ItemParaClassificar } from "@/hooks/useCartaoFaturaRateio";
import { RateioItemFaturaDialog } from "./RateioItemFaturaDialog";

// SIS-2026-0568: tela enxuta pra quem foi autorizado (por cartão, ver
// malote_cartao_credito.usuarios_classificar_ids) a classificar
// Classificação/Contrato dos itens da fatura — sem acesso ao resto do
// módulo Cartão de Crédito (limite, cadastro do cartão, import completo).
// A RLS já resolve quais itens aparecem aqui (useItensParaClassificar).
export default function ClassificarLancamentos() {
  const { data: itens = [], isLoading } = useItensParaClassificar();
  const [filtroCompetencia, setFiltroCompetencia] = useState("");
  const [itemClassificar, setItemClassificar] = useState<ItemParaClassificar | null>(null);

  const itensFiltrados = useMemo(() => {
    if (!filtroCompetencia) return itens;
    return itens.filter((i) => i.competencia?.slice(0, 7) === filtroCompetencia);
  }, [itens, filtroCompetencia]);

  return (
    <AcessoGate
      menu="financeiro-cartao-credito-classificar"
      acao="visualizar"
      fallback={<div className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</div>}
    >
    <div className="space-y-6 p-6">
      <PageHeader
        title="Classificar Lançamentos de Cartão"
        subtitle="Informe a Classificação e o Contrato de cada item da fatura — pode dividir 1 item entre vários."
        module="Financeiro"
        breadcrumb={["Financeiro", "Gestão Financeira", "Cartão de Crédito", "Classificar Lançamentos"]}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div>
            <Label className="text-xs">Competência</Label>
            <Input
              type="month"
              className="h-8 w-40 text-xs"
              value={filtroCompetencia}
              onChange={(e) => setFiltroCompetencia(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Itens da Fatura</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cartão</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-center">Classificação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && itensFiltrados.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhum item encontrado.
                  </TableCell>
                </TableRow>
              )}
              {itensFiltrados.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-sm">{i.nome_cartao}</TableCell>
                  <TableCell className="text-sm">
                    {i.competencia ? new Date(i.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" }) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {i.data_compra ? new Date(i.data_compra + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{i.descricao}</TableCell>
                  <TableCell className="text-right text-sm font-medium">{formatBRL(i.valor)}</TableCell>
                  <TableCell className="text-center">
                    {i.qtd_rateio === 0 ? (
                      <Badge variant="outline">Pendente</Badge>
                    ) : i.qtd_rateio === 1 ? (
                      <Badge variant="secondary">Classificado</Badge>
                    ) : (
                      <Badge variant="secondary">Rateado ({i.qtd_rateio})</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" title="Classificar" onClick={() => setItemClassificar(i)}>
                      <ListTree className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RateioItemFaturaDialog
        open={!!itemClassificar}
        onClose={() => setItemClassificar(null)}
        itemId={itemClassificar?.id ?? null}
        descricaoItem={itemClassificar?.descricao ?? ""}
        valorItem={Number(itemClassificar?.valor ?? 0)}
      />
    </div>
    </AcessoGate>
  );
}
