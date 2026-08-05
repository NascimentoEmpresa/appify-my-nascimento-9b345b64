import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useClassificacoesOrcamentoAdmin, useSalvarClassificacaoOrcamento } from "@/hooks/usePlanejamentoOrcamentario";

interface FormState {
  id?: string;
  nome: string;
  ativo: boolean;
}

export default function ClassificacoesOrcamento() {
  const { data: classificacoes = [], isLoading } = useClassificacoesOrcamentoAdmin();
  const salvar = useSalvarClassificacaoOrcamento();

  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<FormState | null>(null);

  function abrirNovo() {
    setEditando({ nome: "", ativo: true });
    setOpen(true);
  }

  function abrirEditar(row: FormState) {
    setEditando({ ...row });
    setOpen(true);
  }

  async function handleSalvar() {
    if (!editando?.nome.trim()) {
      toast.error("Informe o nome da classificação.");
      return;
    }
    try {
      await salvar.mutateAsync(editando);
      toast.success("Classificação salva.");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar classificação.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Cadastro de Classificação"
        subtitle="Lista de classificações usadas no Planejamento Orçamentário — compartilhada entre todas as empresas do grupo."
        module="Controladoria & Orçamento"
        breadcrumb={["Orçamento", "Cadastro de Classificação"]}
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/app/controladoria/orcamento-administrativo">
                <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
              </Link>
            </Button>
            <Button onClick={abrirNovo}>
              <Plus className="h-4 w-4 mr-2" />
              Nova Classificação
            </Button>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{classificacoes.length} classificação(ões)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && classificacoes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    Nenhuma classificação cadastrada ainda.
                  </TableCell>
                </TableRow>
              )}
              {classificacoes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell>
                    {c.ativo ? <Badge variant="secondary">Ativa</Badge> : <Badge variant="outline">Inativa</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => abrirEditar(c)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar Classificação" : "Nova Classificação"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>
                Nome <span className="text-destructive">*</span>
              </Label>
              <Input
                value={editando?.nome ?? ""}
                onChange={(e) => setEditando((v) => (v ? { ...v, nome: e.target.value } : v))}
                placeholder="Ex: Salários, Aluguel, Combustível..."
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="classificacao-ativa"
                checked={editando?.ativo ?? true}
                onCheckedChange={(checked) => setEditando((v) => (v ? { ...v, ativo: checked === true } : v))}
              />
              <Label htmlFor="classificacao-ativa">Ativa</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSalvar} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
