import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useMinhasDespesas } from "@/hooks/useMaloteDespesa";

const ORIGEM_LABEL: Record<string, string> = {
  solicitacao: "Solicitação",
  despesa_unica: "Despesa",
  despesa_multi_classificacao: "Rateio de Classificação",
};

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente de Aprovação",
};

const STATUS_BADGE: Record<string, string> = {
  rascunho: "bg-muted text-muted-foreground",
  pendente_aprovacao: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
};

export default function MeusItens() {
  const { data: itens = [], isLoading } = useMinhasDespesas();

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Meus Itens"
        subtitle="Solicitações e despesas que você criou no módulo Malote."
        module="Malote"
        breadcrumb={["Malote", "Meus Itens"]}
        actions={
          <Button asChild>
            <Link to="/app/malote/criar-despesa">
              <Plus className="h-4 w-4 mr-2" /> Criar Despesa
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Classificação</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && itens.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Você ainda não criou nenhuma despesa ou solicitação.
                  </TableCell>
                </TableRow>
              )}
              {itens.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.nome}</TableCell>
                  <TableCell>{item.classificacao?.nome ?? "—"}</TableCell>
                  <TableCell>{ORIGEM_LABEL[item.origem] ?? item.origem}</TableCell>
                  <TableCell>{Number(item.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_BADGE[item.status]}>{STATUS_LABEL[item.status] ?? item.status}</Badge>
                  </TableCell>
                  <TableCell>{new Date(item.created_at).toLocaleDateString("pt-BR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
