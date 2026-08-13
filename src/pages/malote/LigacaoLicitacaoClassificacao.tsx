import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Pencil, Trash2, ArrowUpDown, Info, Briefcase, Building2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useLigacoesLicitacaoClassificacao,
  useSalvarLigacaoLicitacaoClassificacao,
  useSalvarLigacoesLicitacaoClassificacao,
  useExcluirLigacaoLicitacaoClassificacao,
  LigacaoLicitacaoClassificacao,
} from "@/hooks/useMaloteLicitacaoClassificacaoLink";
import {
  useLigacoesAdministrativoClassificacao,
  useSalvarLigacaoAdministrativoClassificacao,
  useSalvarLigacoesAdministrativoClassificacao,
  useExcluirLigacaoAdministrativoClassificacao,
  LigacaoAdministrativoClassificacao,
} from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";
import { useClassificacoesAdministrativoAdmin } from "@/hooks/useMaloteClassificacaoAdministrativo";
import { CLASSIFICACOES_LICITACAO, labelClassificacaoLicitacao } from "@/lib/planilhaCustoClassificacoes";

// Destaque visual pras duas seções de Ligação (Licitação vs Administrativo)
// — mesma técnica de ícone grande com máscara em gradiente do TileDestaque
// em DespesaVisualizar.tsx / KpiCard em PainelExecutivo.tsx, aqui como um
// banner de cabeçalho pra sinalizar rápido qual seção é qual.
const BANNER_COR = {
  amber: {
    bg: "bg-amber-50 dark:bg-amber-950/20",
    border: "border-amber-200 dark:border-amber-900",
    icon: "text-amber-300 dark:text-amber-900",
    badge: "bg-amber-600 text-white",
  },
  blue: {
    bg: "bg-blue-50 dark:bg-blue-950/20",
    border: "border-blue-200 dark:border-blue-900",
    icon: "text-blue-300 dark:text-blue-900",
    badge: "bg-blue-600 text-white",
  },
} as const;

export function LigacaoSectionBanner({
  titulo,
  subtitulo,
  icon,
  cor,
}: {
  titulo: string;
  subtitulo: string;
  icon: React.ReactNode;
  cor: keyof typeof BANNER_COR;
}) {
  const c = BANNER_COR[cor];
  return (
    <div className={cn("relative overflow-hidden rounded-lg border p-3 mb-2", c.bg, c.border)}>
      <div
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1"
        style={{
          WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
        }}
      >
        <span className={cn("[&>svg]:h-16 [&>svg]:w-16", c.icon)}>{icon}</span>
      </div>
      <div className="relative z-10 flex items-center gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-md", c.badge)}>
          <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        </span>
        <div>
          <h3 className="text-sm font-semibold">{titulo}</h3>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
      </div>
    </div>
  );
}

type Coluna = "licitacao" | "malote";

interface FormState {
  id?: string;
  // Em modo "novo" pode ter vários campos (liga vários de uma vez à mesma
  // Classificação Malote); em modo "editar" tem sempre 1 (não dá pra trocar
  // qual campo uma ligação existente aponta, só o destino).
  campos: string[];
  classificacaoMaloteId: string;
}

export function LigacaoLicitacaoClassificacao({ podeEditar }: { podeEditar: boolean }) {
  const { data: ligacoes = [], isLoading } = useLigacoesLicitacaoClassificacao();
  const { data: classificacoesMalote = [] } = useClassificacoesOrcamentoAdmin();
  const salvar = useSalvarLigacaoLicitacaoClassificacao();
  const salvarVarias = useSalvarLigacoesLicitacaoClassificacao();
  const excluir = useExcluirLigacaoLicitacaoClassificacao();

  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<FormState | null>(null);
  const [ordem, setOrdem] = useState<{ coluna: Coluna; asc: boolean }>({ coluna: "licitacao", asc: true });

  // Itens já ligados não aparecem de novo pro picker de "Adicionar ligação"
  // (pedido do Iury) — cada campo só pode estar em uma ligação por vez, o
  // picker de edição continua mostrando o próprio valor atual (disabled).
  const camposJaLigados = useMemo(() => new Set(ligacoes.map((l) => l.campo_planilha_custo)), [ligacoes]);
  const opcoesLicitacaoDisponiveis = CLASSIFICACOES_LICITACAO.filter((c) => !camposJaLigados.has(c.campo)).map((c) => ({
    value: c.campo,
    label: c.label,
    hint: c.grupo,
  }));
  const opcoesMalote = classificacoesMalote.map((c) => ({ value: c.id, label: c.nome }));

  const ordenadas = useMemo(() => {
    const copia = [...ligacoes];
    copia.sort((a, b) => {
      const va = ordem.coluna === "licitacao" ? labelClassificacaoLicitacao(a.campo_planilha_custo) : a.classificacao_malote?.nome ?? "";
      const vb = ordem.coluna === "licitacao" ? labelClassificacaoLicitacao(b.campo_planilha_custo) : b.classificacao_malote?.nome ?? "";
      return ordem.asc ? va.localeCompare(vb, "pt-BR") : vb.localeCompare(va, "pt-BR");
    });
    return copia;
  }, [ligacoes, ordem]);

  function alternarOrdem(coluna: Coluna) {
    setOrdem((o) => (o.coluna === coluna ? { coluna, asc: !o.asc } : { coluna, asc: true }));
  }

  function abrirNovo() {
    setEditando({ campos: [], classificacaoMaloteId: "" });
    setOpen(true);
  }

  function abrirEditar(l: LigacaoLicitacaoClassificacao) {
    setEditando({ id: l.id, campos: [l.campo_planilha_custo], classificacaoMaloteId: l.classificacao_malote_id });
    setOpen(true);
  }

  const salvando = salvar.isPending || salvarVarias.isPending;

  async function handleSalvar() {
    if (!editando?.campos.length) {
      toast.error("Selecione ao menos uma Classificação Licitação.");
      return;
    }
    if (!editando?.classificacaoMaloteId) {
      toast.error("Selecione a Classificação Malote.");
      return;
    }
    try {
      if (editando.id) {
        await salvar.mutateAsync({
          id: editando.id,
          campo_planilha_custo: editando.campos[0],
          classificacao_malote_id: editando.classificacaoMaloteId,
        });
      } else {
        await salvarVarias.mutateAsync({
          campos_planilha_custo: editando.campos,
          classificacao_malote_id: editando.classificacaoMaloteId,
        });
      }
      toast.success(editando.campos.length > 1 ? "Ligações salvas." : "Ligação salva.");
      setOpen(false);
    } catch (e: any) {
      if (e.code === "23505") {
        toast.error("Uma dessas Classificações Licitação já está vinculada — use editar para alterar.");
      } else {
        toast.error(e.message ?? "Erro ao salvar ligação.");
      }
    }
  }

  async function handleExcluir(id: string) {
    if (!confirm("Excluir esta ligação?")) return;
    try {
      await excluir.mutateAsync(id);
      toast.success("Ligação excluída.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Relações Cadastradas</CardTitle>
          <CardDescription>Gerencie as ligações entre classificações de licitação e classificações do malote.</CardDescription>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={abrirNovo} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Adicionar ligação
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="h-9 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => alternarOrdem("licitacao")}>
                    Classificação Licitação <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="h-9 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => alternarOrdem("malote")}>
                    Classificação Malote <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                {podeEditar && <TableHead className="h-9 py-2 text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && ordenadas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Nenhuma ligação cadastrada ainda.
                  </TableCell>
                </TableRow>
              )}
              {ordenadas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="py-1.5">{labelClassificacaoLicitacao(l.campo_planilha_custo)}</TableCell>
                  <TableCell className="py-1.5">{l.classificacao_malote?.nome ?? "—"}</TableCell>
                  {podeEditar && (
                    <TableCell className="py-1.5 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(l)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExcluir(l.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar ligação" : "Adicionar ligação"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {editando?.id
              ? "Altere a Classificação Malote desta ligação."
              : "Selecione uma ou mais Classificações Licitação e a Classificação Malote de destino."}
          </p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div>
              <Label>
                Classificação Licitação <span className="text-destructive">*</span>
              </Label>
              {editando?.id ? (
                <SearchableSelect
                  value={editando.campos[0] ?? ""}
                  onChange={() => {}}
                  options={CLASSIFICACOES_LICITACAO.map((c) => ({ value: c.campo, label: c.label, hint: c.grupo }))}
                  placeholder="Selecione a classificação..."
                  searchPlaceholder="Buscar..."
                  disabled
                />
              ) : (
                <SearchableMultiSelect
                  value={editando?.campos ?? []}
                  onChange={(v) => setEditando((s) => (s ? { ...s, campos: v } : s))}
                  options={opcoesLicitacaoDisponiveis}
                  placeholder="Selecione uma ou mais..."
                  searchPlaceholder="Buscar..."
                />
              )}
            </div>
            <span className="pb-2.5 text-muted-foreground">→</span>
            <div>
              <Label>
                Classificação Malote <span className="text-destructive">*</span>
              </Label>
              <Select
                value={editando?.classificacaoMaloteId ?? ""}
                onValueChange={(v) => setEditando((s) => (s ? { ...s, classificacaoMaloteId: v } : s))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a classificação..." />
                </SelectTrigger>
                <SelectContent>
                  {opcoesMalote.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-muted-foreground">
              Atenção: cada classificação de licitação pode ter apenas uma classificação de malote vinculada — por
              isso itens já ligados não aparecem mais nessa lista. Pra trocar o destino de uma ligação já cadastrada,
              use a opção editar.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSalvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Adicionar ligação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

type ColunaAdm = "administrativo" | "malote";

interface FormStateAdm {
  id?: string;
  // Igual à seção de Licitação: em "novo" pode ter vários; em "editar" só 1.
  classificacoesAdministrativas: string[];
  classificacaoMaloteId: string;
}

// SIS-2026-0125: segundo par da Ligação — Classificação Administrativo
// (catálogo simples) ↔ Classificação do Malote (aprovadores/alçadas). É o
// que permite o Orçamento Geral trazer aprovadores pras linhas do
// Orçamento Administrativo. Mesmo padrão de tela do componente acima.
export function LigacaoAdministrativoClassificacaoSection({ podeEditar }: { podeEditar: boolean }) {
  const { data: ligacoes = [], isLoading } = useLigacoesAdministrativoClassificacao();
  const { data: classificacoesAdm = [] } = useClassificacoesAdministrativoAdmin();
  const { data: classificacoesMalote = [] } = useClassificacoesOrcamentoAdmin();
  const salvar = useSalvarLigacaoAdministrativoClassificacao();
  const salvarVarias = useSalvarLigacoesAdministrativoClassificacao();
  const excluir = useExcluirLigacaoAdministrativoClassificacao();

  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<FormStateAdm | null>(null);
  const [ordem, setOrdem] = useState<{ coluna: ColunaAdm; asc: boolean }>({ coluna: "administrativo", asc: true });

  const administrativasJaLigadas = useMemo(
    () => new Set(ligacoes.map((l) => l.classificacao_administrativa_id)),
    [ligacoes]
  );
  const opcoesAdministrativoDisponiveis = classificacoesAdm
    .filter((c) => !administrativasJaLigadas.has(c.id))
    .map((c) => ({ value: c.id, label: c.nome }));
  const opcoesAdministrativoTodas = classificacoesAdm.map((c) => ({ value: c.id, label: c.nome }));
  const opcoesMalote = classificacoesMalote.map((c) => ({ value: c.id, label: c.nome }));

  const ordenadas = useMemo(() => {
    const copia = [...ligacoes];
    copia.sort((a, b) => {
      const va = ordem.coluna === "administrativo" ? a.classificacao_administrativa?.nome ?? "" : a.classificacao_malote?.nome ?? "";
      const vb = ordem.coluna === "administrativo" ? b.classificacao_administrativa?.nome ?? "" : b.classificacao_malote?.nome ?? "";
      return ordem.asc ? va.localeCompare(vb, "pt-BR") : vb.localeCompare(va, "pt-BR");
    });
    return copia;
  }, [ligacoes, ordem]);

  function alternarOrdem(coluna: ColunaAdm) {
    setOrdem((o) => (o.coluna === coluna ? { coluna, asc: !o.asc } : { coluna, asc: true }));
  }

  function abrirNovo() {
    setEditando({ classificacoesAdministrativas: [], classificacaoMaloteId: "" });
    setOpen(true);
  }

  function abrirEditar(l: LigacaoAdministrativoClassificacao) {
    setEditando({ id: l.id, classificacoesAdministrativas: [l.classificacao_administrativa_id], classificacaoMaloteId: l.classificacao_malote_id });
    setOpen(true);
  }

  const salvando = salvar.isPending || salvarVarias.isPending;

  async function handleSalvar() {
    if (!editando?.classificacoesAdministrativas.length) {
      toast.error("Selecione ao menos uma Classificação Administrativo.");
      return;
    }
    if (!editando?.classificacaoMaloteId) {
      toast.error("Selecione a Classificação Malote.");
      return;
    }
    try {
      if (editando.id) {
        await salvar.mutateAsync({
          id: editando.id,
          classificacao_administrativa_id: editando.classificacoesAdministrativas[0],
          classificacao_malote_id: editando.classificacaoMaloteId,
        });
      } else {
        await salvarVarias.mutateAsync({
          classificacoes_administrativas_ids: editando.classificacoesAdministrativas,
          classificacao_malote_id: editando.classificacaoMaloteId,
        });
      }
      toast.success(editando.classificacoesAdministrativas.length > 1 ? "Ligações salvas." : "Ligação salva.");
      setOpen(false);
    } catch (e: any) {
      if (e.code === "23505") {
        toast.error("Uma dessas Classificações Administrativo já está vinculada — use editar para alterar.");
      } else {
        toast.error(e.message ?? "Erro ao salvar ligação.");
      }
    }
  }

  async function handleExcluir(id: string) {
    if (!confirm("Excluir esta ligação?")) return;
    try {
      await excluir.mutateAsync(id);
      toast.success("Ligação excluída.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir.");
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Relações Cadastradas</CardTitle>
          <CardDescription>Gerencie as ligações entre classificações administrativo e classificações do malote.</CardDescription>
        </div>
        {podeEditar && (
          <Button size="sm" onClick={abrirNovo} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> Adicionar ligação
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <div className="max-h-96 overflow-y-auto overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="h-9 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => alternarOrdem("administrativo")}>
                    Classificação Administrativo <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                <TableHead className="h-9 py-2">
                  <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => alternarOrdem("malote")}>
                    Classificação Malote <ArrowUpDown className="h-3 w-3" />
                  </button>
                </TableHead>
                {podeEditar && <TableHead className="h-9 py-2 text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && ordenadas.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Nenhuma ligação cadastrada ainda.
                  </TableCell>
                </TableRow>
              )}
              {ordenadas.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="py-1.5">{l.classificacao_administrativa?.nome ?? "—"}</TableCell>
                  <TableCell className="py-1.5">{l.classificacao_malote?.nome ?? "—"}</TableCell>
                  {podeEditar && (
                    <TableCell className="py-1.5 text-right">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(l)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExcluir(l.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar ligação" : "Adicionar ligação"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {editando?.id
              ? "Altere a Classificação Malote desta ligação."
              : "Selecione uma ou mais Classificações Administrativo e a Classificação Malote de destino."}
          </p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <div>
              <Label>
                Classificação Administrativo <span className="text-destructive">*</span>
              </Label>
              {editando?.id ? (
                <SearchableSelect
                  value={editando.classificacoesAdministrativas[0] ?? ""}
                  onChange={() => {}}
                  options={opcoesAdministrativoTodas}
                  placeholder="Selecione a classificação..."
                  searchPlaceholder="Buscar..."
                  disabled
                />
              ) : (
                <SearchableMultiSelect
                  value={editando?.classificacoesAdministrativas ?? []}
                  onChange={(v) => setEditando((s) => (s ? { ...s, classificacoesAdministrativas: v } : s))}
                  options={opcoesAdministrativoDisponiveis}
                  placeholder="Selecione uma ou mais..."
                  searchPlaceholder="Buscar..."
                />
              )}
            </div>
            <span className="pb-2.5 text-muted-foreground">→</span>
            <div>
              <Label>
                Classificação Malote <span className="text-destructive">*</span>
              </Label>
              <Select
                value={editando?.classificacaoMaloteId ?? ""}
                onValueChange={(v) => setEditando((s) => (s ? { ...s, classificacaoMaloteId: v } : s))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a classificação..." />
                </SelectTrigger>
                <SelectContent>
                  {opcoesMalote.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-muted-foreground">
              Atenção: cada Classificação Administrativo pode ter apenas uma Classificação do Malote vinculada — por
              isso itens já ligados não aparecem mais nessa lista. Pra trocar o destino de uma ligação já cadastrada,
              use a opção editar.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSalvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Adicionar ligação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
