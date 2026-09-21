import { useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Settings, Pencil, Plus, Trash2, ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useFormasPagamento,
  useSalvarFormaPagamento,
  useExcluirFormaPagamento,
  useTiposFormaPagamento,
  useCriarTipoFormaPagamento,
  useAtualizarStatusTipoFormaPagamento,
  useExcluirTipoFormaPagamento,
  FluxoAprovacaoFormaPagamento,
} from "@/hooks/useMaloteFormaPagamento";
import { useAprovadoresDisponiveis } from "@/hooks/usePlanejamentoOrcamentario";

const PAGE_SIZE = 10;

// SIS-2026-0170: catálogo nomeado de formas de pagamento (a pedido do
// Iury) — não substitui o Select fixo de forma_pagamento já usado em
// Criar Despesa e outras telas, só o cadastro por enquanto.
export function FormasPagamento({ podeEditar }: { podeEditar: boolean }) {
  const { data: formas = [], isLoading } = useFormasPagamento();
  const { data: tipos = [] } = useTiposFormaPagamento();
  const { data: aprovadoresDisponiveis = [] } = useAprovadoresDisponiveis();
  const salvar = useSalvarFormaPagamento();
  const excluir = useExcluirFormaPagamento();

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("");
  const [ativo, setAtivo] = useState("true");
  // SIS-2026-0439 (Iury): compra no cartão já foi feita na hora — "Fluxo
  // Especial" pula o N1→N2→N3 da Classificação e vai direto pro aprovador
  // único definido aqui, que ao aprovar já manda pra Aguardando Pagamento.
  const [fluxoAprovacao, setFluxoAprovacao] = useState<FluxoAprovacaoFormaPagamento>("normal");
  const [aprovadorEspecialUserId, setAprovadorEspecialUserId] = useState<string | null>(null);
  const [pagina, setPagina] = useState(1);
  const [gerenciarTiposAberto, setGerenciarTiposAberto] = useState(false);

  const opcoesAprovador = useMemo(
    () => aprovadoresDisponiveis.map((a) => ({ value: a.id, label: a.nome })),
    [aprovadoresDisponiveis]
  );
  const nomeAprovadorPorId = useMemo(() => new Map(aprovadoresDisponiveis.map((a) => [a.id, a.nome])), [aprovadoresDisponiveis]);

  const tiposAtivos = useMemo(() => tipos.filter((t) => t.ativo), [tipos]);
  const totalPaginas = Math.max(1, Math.ceil(formas.length / PAGE_SIZE));
  const formasPagina = useMemo(() => formas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE), [formas, pagina]);

  function limparForm() {
    setEditandoId(null);
    setNome("");
    setTipo("");
    setAtivo("true");
    setFluxoAprovacao("normal");
    setAprovadorEspecialUserId(null);
  }

  // [SEM-CHAMADO] (achado do usuário testando o Fluxo Especial): clicar no
  // lápis carregava os dados no formulário lá no topo, mas sem nenhum sinal
  // visual — quem clicasse não percebia que algo tinha mudado, sobretudo
  // com a tabela grande e o formulário fora da tela. Agora rola até o
  // formulário e ele ganha destaque (borda + banner "Editando: <nome>")
  // enquanto editandoId estiver setado.
  const formularioRef = useRef<HTMLDivElement>(null);

  function abrirEditar(f: (typeof formas)[number]) {
    setEditandoId(f.id);
    setNome(f.nome);
    setTipo(f.tipo);
    setAtivo(String(f.ativo));
    setFluxoAprovacao(f.fluxo_aprovacao);
    setAprovadorEspecialUserId(f.aprovador_especial_user_id);
    formularioRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
    if (fluxoAprovacao === "especial" && !aprovadorEspecialUserId) {
      toast.error("Selecione o aprovador do Fluxo Especial.");
      return;
    }
    try {
      await salvar.mutateAsync({
        id: editandoId ?? undefined,
        nome,
        tipo,
        ativo: ativo === "true",
        fluxo_aprovacao: fluxoAprovacao,
        aprovador_especial_user_id: fluxoAprovacao === "especial" ? aprovadorEspecialUserId : null,
      });
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
      <Card ref={formularioRef} className={cn(editandoId && "border-primary ring-1 ring-primary")}>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
              <CreditCard className="h-4.5 w-4.5" />
            </span>
            <div>
              <CardTitle className="text-base">
                {editandoId ? `Editando: ${formas.find((f) => f.id === editandoId)?.nome ?? ""}` : "Formas de Pagamento"}
              </CardTitle>
              <CardDescription>
                {editandoId
                  ? "Altere os campos abaixo e clique em Salvar, ou cancele para voltar ao cadastro."
                  : "Cadastre e gerencie as formas de pagamento utilizadas nas despesas."}
              </CardDescription>
            </div>
          </div>
          {editandoId && (
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={limparForm} title="Cancelar edição">
              <X className="h-4 w-4" />
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto] gap-3 items-end">
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
          <div>
            <Label className="text-xs">Fluxo de Aprovação</Label>
            <Select value={fluxoAprovacao} onValueChange={(v) => setFluxoAprovacao(v as FluxoAprovacaoFormaPagamento)} disabled={!podeEditar}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Fluxo Normal</SelectItem>
                <SelectItem value="especial">Fluxo Especial</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Aprovador {fluxoAprovacao === "especial" && "*"}</Label>
            <SearchableSelect
              value={aprovadorEspecialUserId ?? "none"}
              onChange={(v) => setAprovadorEspecialUserId(v === "none" ? null : v)}
              options={[{ value: "none", label: "—" }, ...opcoesAprovador]}
              placeholder="Selecione o aprovador"
              searchPlaceholder="Buscar aprovador..."
              disabled={!podeEditar || fluxoAprovacao !== "especial"}
            />
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
      {fluxoAprovacao === "especial" && (
        <p className="-mt-2 px-1 text-xs text-muted-foreground">
          Fluxo Especial: a despesa lançada com esta forma de pagamento pula o fluxo N1→N2→N3 da Classificação — quando o
          aprovador definido acima aprovar, ela já vai direto para "Aguardando pagamento".
        </p>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome da Forma de Pagamento</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Fluxo de Aprovação</TableHead>
                  <TableHead>Aprovador</TableHead>
                  <TableHead>Status</TableHead>
                  {podeEditar && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && formas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nenhuma forma de pagamento cadastrada ainda.</TableCell>
                  </TableRow>
                )}
                {formasPagina.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.nome}</TableCell>
                    <TableCell>{f.tipo}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          f.fluxo_aprovacao === "especial"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-400"
                        }
                      >
                        {f.fluxo_aprovacao === "especial" ? "Fluxo Especial" : "Fluxo Normal"}
                      </Badge>
                    </TableCell>
                    <TableCell>{f.aprovador_especial_user_id ? nomeAprovadorPorId.get(f.aprovador_especial_user_id) ?? "—" : "—"}</TableCell>
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
