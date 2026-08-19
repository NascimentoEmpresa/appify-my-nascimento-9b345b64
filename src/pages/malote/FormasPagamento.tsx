import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Settings, Pencil, Plus, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  useFormasPagamento,
  useSalvarFormaPagamento,
  useExcluirFormaPagamento,
  useTiposFormaPagamento,
  useCriarTipoFormaPagamento,
  useAtualizarStatusTipoFormaPagamento,
  useExcluirTipoFormaPagamento,
} from "@/hooks/useMaloteFormaPagamento";

const PAGE_SIZE = 10;

// SIS-2026-0170: catálogo nomeado de formas de pagamento (a pedido do
// Iury) — não substitui o Select fixo de forma_pagamento já usado em
// Criar Despesa e outras telas, só o cadastro por enquanto.
export function FormasPagamento({ podeEditar }: { podeEditar: boolean }) {
  const { data: formas = [], isLoading } = useFormasPagamento();
  const { data: tipos = [] } = useTiposFormaPagamento();
  const salvar = useSalvarFormaPagamento();
  const excluir = useExcluirFormaPagamento();

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("");
  const [ativo, setAtivo] = useState("true");
  const [pagina, setPagina] = useState(1);
  const [gerenciarTiposAberto, setGerenciarTiposAberto] = useState(false);

  const tiposAtivos = useMemo(() => tipos.filter((t) => t.ativo), [tipos]);
  const totalPaginas = Math.max(1, Math.ceil(formas.length / PAGE_SIZE));
  const formasPagina = useMemo(() => formas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE), [formas, pagina]);

  function limparForm() {
    setEditandoId(null);
    setNome("");
    setTipo("");
    setAtivo("true");
  }

  function abrirEditar(f: (typeof formas)[number]) {
    setEditandoId(f.id);
    setNome(f.nome);
    setTipo(f.tipo);
    setAtivo(String(f.ativo));
  }

  async function handleSalvar() {
    if (!nome.trim()) {
      toast.error("Informe o nome da forma de pagamento.");
      return;
    }
    if (!tipo) {
      toast.error("Selecione o tipo.");
      return;
    }
    try {
      await salvar.mutateAsync({ id: editandoId ?? undefined, nome, tipo, ativo: ativo === "true" });
      toast.success(editandoId ? "Forma de pagamento atualizada." : "Forma de pagamento cadastrada.");
      limparForm();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar forma de pagamento.");
    }
  }

  async function handleExcluir(id: string) {
    if (!confirm("Excluir esta forma de pagamento?")) return;
    try {
      await excluir.mutateAsync(id);
      toast.success("Forma de pagamento excluída.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir forma de pagamento.");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              <CreditCard className="h-4.5 w-4.5" />
            </span>
            <div>
              <CardTitle className="text-base">Formas de Pagamento</CardTitle>
              <CardDescription>Cadastre e gerencie as formas de pagamento utilizadas nas despesas.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-3 items-end">
          <div>
            <Label className="text-xs">Nome da Forma de Pagamento *</Label>
            <Input placeholder="Digite o nome da forma de pagamento" value={nome} onChange={(e) => setNome(e.target.value)} disabled={!podeEditar} />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-xs">Tipo *</Label>
              {podeEditar && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 -mt-1"
                  onClick={() => setGerenciarTiposAberto(true)}
                  title="Gerenciar tipos"
                >
                  <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>
            <Select value={tipo} onValueChange={setTipo} disabled={!podeEditar}>
              <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
              <SelectContent>
                {tiposAtivos.map((t) => (
                  <SelectItem key={t.nome} value={t.nome}>{t.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <Label className="text-xs">Status *</Label>
            <Select value={ativo} onValueChange={setAtivo} disabled={!podeEditar}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Ativo</SelectItem>
                <SelectItem value="false">Inativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {podeEditar && (
            <div className="flex gap-2">
              <Button onClick={handleSalvar} disabled={salvar.isPending}>
                {editandoId ? "Salvar" : "Nova Forma de Pagamento"}
              </Button>
              {editandoId && <Button variant="outline" onClick={limparForm}>Cancelar</Button>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome da Forma de Pagamento</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  {podeEditar && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && formas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">Nenhuma forma de pagamento cadastrada ainda.</TableCell>
                  </TableRow>
                )}
                {formasPagina.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.nome}</TableCell>
                    <TableCell>{f.tipo}</TableCell>
                    <TableCell>
                      <Badge className={f.ativo ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}>
                        {f.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    {podeEditar && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(f)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExcluir(f.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {formas.length > 0 && (
            <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
              <span>Mostrando {(pagina - 1) * PAGE_SIZE + 1} a {Math.min(pagina * PAGE_SIZE, formas.length)} de {formas.length} registros</span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="px-2">{pagina} / {totalPaginas}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <GerenciarTiposDialog open={gerenciarTiposAberto} onOpenChange={setGerenciarTiposAberto} />
    </div>
  );
}

// Modal de gerenciamento do catálogo de Tipos (criar/excluir/ativar-
// desativar) — substitui o campo "criar novo tipo" espremido ao lado do
// Select, que ficava feio (feedback do usuário).
function GerenciarTiposDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: tipos = [], isLoading } = useTiposFormaPagamento();
  const criar = useCriarTipoFormaPagamento();
  const atualizarStatus = useAtualizarStatusTipoFormaPagamento();
  const excluir = useExcluirTipoFormaPagamento();

  const [novoTipo, setNovoTipo] = useState("");

  async function handleCriar() {
    const nome = novoTipo.trim();
    if (!nome) return;
    try {
      await criar.mutateAsync(nome);
      setNovoTipo("");
    } catch (e: any) {
      if (e.code === "23505") {
        toast.error("Já existe um tipo com esse nome.");
      } else {
        toast.error(e.message ?? "Erro ao criar tipo.");
      }
    }
  }

  async function handleToggleAtivo(nome: string, ativo: boolean) {
    try {
      await atualizarStatus.mutateAsync({ nome, ativo });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao atualizar status do tipo.");
    }
  }

  async function handleExcluir(nome: string) {
    if (!confirm(`Excluir o tipo "${nome}"?`)) return;
    try {
      await excluir.mutateAsync(nome);
      toast.success("Tipo excluído.");
    } catch (e: any) {
      if (e.code === "23503") {
        toast.error("Este tipo está em uso por alguma forma de pagamento — desative em vez de excluir.");
      } else {
        toast.error(e.message ?? "Erro ao excluir tipo.");
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Gerenciar Tipos de Forma de Pagamento</DialogTitle>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            placeholder="Nome do novo tipo..."
            value={novoTipo}
            onChange={(e) => setNovoTipo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCriar()}
          />
          <Button type="button" onClick={handleCriar} disabled={!novoTipo.trim() || criar.isPending} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {isLoading && <p className="text-center text-sm text-muted-foreground py-4">Carregando...</p>}
          {!isLoading && tipos.length === 0 && <p className="text-center text-sm text-muted-foreground py-4">Nenhum tipo cadastrado.</p>}
          {tipos.map((t) => (
            <div key={t.nome} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className={t.ativo ? "text-sm" : "text-sm text-muted-foreground line-through"}>{t.nome}</span>
              <div className="flex items-center gap-2 shrink-0">
                <Switch checked={t.ativo} onCheckedChange={(v) => handleToggleAtivo(t.nome, v)} />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExcluir(t.nome)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
