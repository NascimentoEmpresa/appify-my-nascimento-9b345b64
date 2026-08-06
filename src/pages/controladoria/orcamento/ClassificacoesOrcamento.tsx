import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, ArrowLeft, FolderCog, UserRound, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  useClassificacoesOrcamentoAdmin,
  useSalvarClassificacaoOrcamento,
  useAprovadoresDisponiveis,
  useSetoresCatalogo,
  ClassificacaoOrcamento,
  TipoClassificacaoOrcamento,
} from "@/hooks/usePlanejamentoOrcamentario";

interface FormState {
  id?: string;
  nome: string;
  ativo: boolean;
  requerSolicitacao: boolean;
  tipo: TipoClassificacaoOrcamento | null;
  setorResponsavel: string | null;
  aprovador1UserId: string | null;
  aprovador1Nome: string | null;
  aprovador1LimitePct: string;
  aprovador2UserId: string | null;
  aprovador2Nome: string | null;
  aprovador2LimitePct: string;
  aprovador3UserId: string | null;
  aprovador3Nome: string | null;
  aprovador3LimitePct: string;
}

const VAZIO: FormState = {
  nome: "",
  ativo: true,
  requerSolicitacao: false,
  tipo: null,
  setorResponsavel: null,
  aprovador1UserId: null,
  aprovador1Nome: null,
  aprovador1LimitePct: "",
  aprovador2UserId: null,
  aprovador2Nome: null,
  aprovador2LimitePct: "",
  aprovador3UserId: null,
  aprovador3Nome: null,
  aprovador3LimitePct: "",
};

function paraFormState(c: ClassificacaoOrcamento): FormState {
  return {
    id: c.id,
    nome: c.nome,
    ativo: c.ativo,
    requerSolicitacao: c.requer_solicitacao,
    tipo: c.tipo,
    setorResponsavel: c.setor_responsavel,
    aprovador1UserId: c.aprovador1_user_id,
    aprovador1Nome: c.aprovador1_nome,
    aprovador1LimitePct: c.aprovador1_limite_pct != null ? String(c.aprovador1_limite_pct) : "",
    aprovador2UserId: c.aprovador2_user_id,
    aprovador2Nome: c.aprovador2_nome,
    aprovador2LimitePct: c.aprovador2_limite_pct != null ? String(c.aprovador2_limite_pct) : "",
    aprovador3UserId: c.aprovador3_user_id,
    aprovador3Nome: c.aprovador3_nome,
    aprovador3LimitePct: c.aprovador3_limite_pct != null ? String(c.aprovador3_limite_pct) : "",
  };
}

const TIPO_LABEL: Record<TipoClassificacaoOrcamento, string> = {
  contrato: "Contrato",
  administrativo: "Administrativo",
};

export default function ClassificacoesOrcamento() {
  const { data: classificacoes = [], isLoading } = useClassificacoesOrcamentoAdmin();
  const { data: aprovadores1 = [] } = useAprovadoresDisponiveis(1);
  const { data: aprovadores2 = [] } = useAprovadoresDisponiveis(2);
  const { data: aprovadores3 = [] } = useAprovadoresDisponiveis(3);
  const { data: setores = [] } = useSetoresCatalogo();
  const salvar = useSalvarClassificacaoOrcamento();

  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<FormState | null>(null);

  const todosAprovadores = useMemo(
    () => [...aprovadores1, ...aprovadores2, ...aprovadores3],
    [aprovadores1, aprovadores2, aprovadores3]
  );

  // Garante que um aprovador já salvo apareça selecionado mesmo se o cargo
  // dele não bater mais com o filtro do slot (ex.: mudou de função) — sem
  // isso a edição "perderia" visualmente quem já estava escolhido.
  function comSelecaoAtual(opcoes: { value: string; label: string }[], userId: string | null, nome: string | null) {
    if (!userId || opcoes.some((o) => o.value === userId)) return opcoes;
    return [...opcoes, { value: userId, label: nome ?? userId }];
  }

  const opcoesAprovador1 = comSelecaoAtual(
    aprovadores1.map((a) => ({ value: a.id, label: a.nome })),
    editando?.aprovador1UserId ?? null,
    editando?.aprovador1Nome ?? null
  );
  const opcoesAprovador2 = comSelecaoAtual(
    aprovadores2.map((a) => ({ value: a.id, label: a.nome })),
    editando?.aprovador2UserId ?? null,
    editando?.aprovador2Nome ?? null
  );
  const opcoesAprovador3 = comSelecaoAtual(
    aprovadores3.map((a) => ({ value: a.id, label: a.nome })),
    editando?.aprovador3UserId ?? null,
    editando?.aprovador3Nome ?? null
  );

  function abrirNovo() {
    setEditando({ ...VAZIO });
    setOpen(true);
  }

  function abrirEditar(row: ClassificacaoOrcamento) {
    setEditando(paraFormState(row));
    setOpen(true);
  }

  function setAprovador(slot: 1 | 2 | 3, userId: string) {
    const nome = todosAprovadores.find((a) => a.id === userId)?.nome ?? null;
    setEditando((v) =>
      v ? { ...v, [`aprovador${slot}UserId`]: userId || null, [`aprovador${slot}Nome`]: userId ? nome : null } : v
    );
  }

  function parsePct(valor: string): number | null {
    if (!valor.trim()) return null;
    const n = Number(valor.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }

  async function handleSalvar() {
    if (!editando) return;
    if (!editando.nome.trim()) {
      toast.error("Informe o nome da classificação.");
      return;
    }
    if (!editando.tipo) {
      toast.error("Selecione o tipo de classificação.");
      return;
    }
    if (!editando.setorResponsavel) {
      toast.error("Selecione o setor responsável.");
      return;
    }
    if (!editando.aprovador1UserId) {
      toast.error("Informe o Aprovador 1.");
      return;
    }
    const limite1 = parsePct(editando.aprovador1LimitePct);
    if (limite1 === null || limite1 < 0 || limite1 > 100) {
      toast.error("Informe um limite de alçada válido (0 a 100%) para o Aprovador 1.");
      return;
    }
    const limite2 = parsePct(editando.aprovador2LimitePct);
    if (editando.aprovador2UserId && limite2 === null) {
      toast.error("Informe o limite de alçada do Aprovador 2.");
      return;
    }
    if (limite2 !== null && limite2 <= limite1) {
      toast.error("O limite do Aprovador 2 deve ser maior que o do Aprovador 1.");
      return;
    }
    const limite3 = parsePct(editando.aprovador3LimitePct);
    if (editando.aprovador3UserId && limite3 === null) {
      toast.error("Informe o limite de alçada do Aprovador 3.");
      return;
    }
    if (limite3 !== null && limite2 !== null && limite3 <= limite2) {
      toast.error("O limite do Aprovador 3 deve ser maior que o do Aprovador 2.");
      return;
    }

    try {
      await salvar.mutateAsync({
        id: editando.id,
        nome: editando.nome,
        ativo: editando.ativo,
        tipo: editando.tipo,
        setor_responsavel: editando.setorResponsavel,
        requer_solicitacao: editando.requerSolicitacao,
        aprovador1_user_id: editando.aprovador1UserId,
        aprovador1_nome: editando.aprovador1Nome ?? "",
        aprovador1_limite_pct: limite1,
        aprovador2_user_id: editando.aprovador2UserId,
        aprovador2_nome: editando.aprovador2Nome,
        aprovador2_limite_pct: limite2,
        aprovador3_user_id: editando.aprovador3UserId,
        aprovador3_nome: editando.aprovador3Nome,
        aprovador3_limite_pct: limite3,
      });
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
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Setor Responsável</TableHead>
                <TableHead>Requer Solicitação?</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
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
              {!isLoading && classificacoes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Nenhuma classificação cadastrada ainda.
                  </TableCell>
                </TableRow>
              )}
              {classificacoes.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell>{c.tipo ? TIPO_LABEL[c.tipo] : "—"}</TableCell>
                  <TableCell>{c.setor_responsavel ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={c.requer_solicitacao ? "default" : "outline"}>
                      {c.requer_solicitacao ? "Sim" : "Não"}
                    </Badge>
                  </TableCell>
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
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
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
              <span className="text-xs text-muted-foreground">
                Classificações inativas não poderão ser utilizadas nos orçamentos.
              </span>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <FolderCog className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Configurações para o Malote</p>
                  <p className="text-xs text-muted-foreground">
                    Estas opções definem regras de fluxo no módulo Malote.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="requer-solicitacao"
                  className="mt-0.5"
                  checked={editando?.requerSolicitacao ?? false}
                  onCheckedChange={(checked) =>
                    setEditando((v) => (v ? { ...v, requerSolicitacao: checked === true } : v))
                  }
                />
                <div>
                  <Label htmlFor="requer-solicitacao" className="flex items-center gap-1.5">
                    <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
                    Requer solicitação
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Quando marcada, lançamentos desta classificação no Malote só poderão ser realizados após o
                    processo de solicitação.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>
                  Tipo de classificação <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Selecione se esta classificação será usada para contratos ou administrativas.
                </p>
                <div className="space-y-2">
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="tipo-classificacao"
                      className="mt-1"
                      checked={editando?.tipo === "contrato"}
                      onChange={() => setEditando((v) => (v ? { ...v, tipo: "contrato" } : v))}
                    />
                    <span>
                      <span className="font-medium">Contrato</span>
                      <br />
                      <span className="text-xs text-muted-foreground">
                        Usada em contratos com clientes / prestação de serviços.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="tipo-classificacao"
                      className="mt-1"
                      checked={editando?.tipo === "administrativo"}
                      onChange={() => setEditando((v) => (v ? { ...v, tipo: "administrativo" } : v))}
                    />
                    <span>
                      <span className="font-medium">Administrativo</span>
                      <br />
                      <span className="text-xs text-muted-foreground">Usada em despesas administrativas da empresa.</span>
                    </span>
                  </label>
                </div>
              </div>
              <div>
                <Label>
                  Setor responsável <span className="text-destructive">*</span>
                </Label>
                <p className="text-xs text-muted-foreground mb-2">Setor responsável pela gestão desta classificação.</p>
                <Select
                  value={editando?.setorResponsavel ?? ""}
                  onValueChange={(v) => setEditando((s) => (s ? { ...s, setorResponsavel: v } : s))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o setor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {setores.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Users className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Definição de Aprovadores e Limites de Alçada</p>
                  <p className="text-xs text-muted-foreground">
                    Informe os aprovadores em ordem de hierarquia e seus respectivos limites de alçada.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>
                    Aprovador 1 <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground mb-1">Gerentes e supervisores.</p>
                  <SearchableSelect
                    value={editando?.aprovador1UserId ?? ""}
                    onChange={(v) => setAprovador(1, v)}
                    options={opcoesAprovador1}
                    placeholder="Buscar aprovador..."
                    searchPlaceholder="Buscar aprovador..."
                  />
                </div>
                <div>
                  <Label>
                    Limite da alçada 1 (%) <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="Ex.: 10,00"
                    value={editando?.aprovador1LimitePct ?? ""}
                    onChange={(e) => setEditando((v) => (v ? { ...v, aprovador1LimitePct: e.target.value } : v))}
                  />
                </div>

                <div>
                  <Label>Aprovador 2</Label>
                  <p className="text-xs text-muted-foreground mb-1">Diretores.</p>
                  <SearchableSelect
                    value={editando?.aprovador2UserId ?? ""}
                    onChange={(v) => setAprovador(2, v)}
                    options={opcoesAprovador2}
                    placeholder="Buscar aprovador..."
                    searchPlaceholder="Buscar aprovador..."
                    allowClear
                  />
                </div>
                <div>
                  <Label>Limite da alçada 2 (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="Ex.: 25,00"
                    value={editando?.aprovador2LimitePct ?? ""}
                    onChange={(e) => setEditando((v) => (v ? { ...v, aprovador2LimitePct: e.target.value } : v))}
                  />
                </div>

                <div>
                  <Label>Aprovador 3</Label>
                  <p className="text-xs text-muted-foreground mb-1">Presidência.</p>
                  <SearchableSelect
                    value={editando?.aprovador3UserId ?? ""}
                    onChange={(v) => setAprovador(3, v)}
                    options={opcoesAprovador3}
                    placeholder="Buscar aprovador..."
                    searchPlaceholder="Buscar aprovador..."
                    allowClear
                  />
                </div>
                <div>
                  <Label>Limite da alçada 3 (%)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="Ex.: 50,00"
                    value={editando?.aprovador3LimitePct ?? ""}
                    onChange={(e) => setEditando((v) => (v ? { ...v, aprovador3LimitePct: e.target.value } : v))}
                  />
                </div>
              </div>
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
