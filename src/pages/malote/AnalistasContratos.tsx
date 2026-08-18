import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info, Building2, Pencil, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  useAnalistasContrato,
  useSalvarAnalistaContrato,
  useExcluirAnalistaContrato,
} from "@/hooks/useMaloteAnalistas";
import { useEmpresasGrupo, useContratosAtivos } from "@/hooks/useMaloteDespesa";
import { useAprovadoresDisponiveis } from "@/hooks/usePlanejamentoOrcamentario";

const PAGE_SIZE = 10;

// SIS-2026-0170: vínculo analista<->contrato — o analista é um usuário
// real do sistema (sem filtro por cargo no picker, ver comentário em
// useMaloteAnalistas.ts). Serve pra saber, futuramente, quem deve
// justificar um lançamento do malote quando ultrapassa o
// limite_justificativa_pct cadastrado na Classificação — o enforcement em
// si não é escopo deste chamado.
export function AnalistasContratos({ podeEditar }: { podeEditar: boolean }) {
  const { data: usuarios = [] } = useAprovadoresDisponiveis();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: vinculos = [], isLoading } = useAnalistasContrato();
  const salvarVinculo = useSalvarAnalistaContrato();
  const excluirVinculo = useExcluirAnalistaContrato();

  const usuariosPorId = useMemo(() => new Map(usuarios.map((u) => [u.id, u])), [usuarios]);
  const opcoesUsuarios = useMemo(
    () =>
      usuarios.map((u) => ({
        value: u.id,
        label: u.nome,
        hint: [u.email, u.cargo].filter(Boolean).join(" · "),
      })),
    [usuarios]
  );

  const [analistaUserId, setAnalistaUserId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const [pagina, setPagina] = useState(1);

  const contratosDaEmpresa = useMemo(
    () => (empresaId ? contratos.filter((c) => c.empresa_id === empresaId) : contratos),
    [contratos, empresaId]
  );

  const totalPaginas = Math.max(1, Math.ceil(vinculos.length / PAGE_SIZE));
  const vinculosPagina = vinculos.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  function limparVinculoForm() {
    setEditandoId(null);
    setAnalistaUserId("");
    setEmpresaId("");
    setContratoId("");
  }

  async function handleVincular() {
    if (!analistaUserId) {
      toast.error("Selecione o analista.");
      return;
    }
    if (!contratoId) {
      toast.error("Selecione o contrato.");
      return;
    }
    try {
      await salvarVinculo.mutateAsync({ id: editandoId ?? undefined, analista_user_id: analistaUserId, contrato_id: contratoId, ativo: true });
      toast.success(editandoId ? "Vínculo atualizado." : "Analista vinculado ao contrato.");
      limparVinculoForm();
    } catch (e: any) {
      if (e.code === "23505") {
        toast.error("Este analista já está vinculado a este contrato.");
      } else {
        toast.error(e.message ?? "Erro ao vincular analista.");
      }
    }
  }

  function abrirEditar(v: (typeof vinculos)[number]) {
    setEditandoId(v.id);
    setAnalistaUserId(v.analista_user_id);
    setEmpresaId(v.contrato?.empresa_id ?? "");
    setContratoId(v.contrato?.id ?? "");
  }

  async function handleExcluir(id: string) {
    if (!confirm("Excluir este vínculo?")) return;
    try {
      await excluirVinculo.mutateAsync(id);
      toast.success("Vínculo excluído.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir vínculo.");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
            <Building2 className="h-4.5 w-4.5" />
          </span>
          <div>
            <CardTitle className="text-base">{editandoId ? "Editar Vínculo" : "Vincular Analista a Contrato"}</CardTitle>
            <CardDescription>Defina qual analista será responsável por realizar justificativas quando necessário.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
            <div>
              <Label className="text-xs">Analista *</Label>
              <SearchableSelect
                value={analistaUserId}
                onChange={setAnalistaUserId}
                options={opcoesUsuarios}
                placeholder="Selecione o analista..."
                searchPlaceholder="Buscar por nome, e-mail ou cargo..."
                disabled={!podeEditar}
              />
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={empresaId || "todas"} onValueChange={(v) => { setEmpresaId(v === "todas" ? "" : v); setContratoId(""); }} disabled={!podeEditar}>
                <SelectTrigger><SelectValue placeholder="Selecione a empresa..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Contrato *</Label>
              <Select value={contratoId} onValueChange={setContratoId} disabled={!podeEditar}>
                <SelectTrigger><SelectValue placeholder="Selecione o contrato..." /></SelectTrigger>
                <SelectContent>
                  {contratosDaEmpresa.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {podeEditar && (
              <div className="flex gap-2">
                <Button onClick={handleVincular} disabled={salvarVinculo.isPending} className="gap-1.5">
                  {editandoId ? "Salvar" : "Vincular Analista a Contrato"}
                </Button>
                {editandoId && (
                  <Button variant="outline" onClick={limparVinculoForm}>Cancelar</Button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
            <p className="text-muted-foreground">
              O analista vinculado será o responsável pela justificativa das despesas deste contrato quando o limite
              definido para justificativa for excedido.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Analistas Vinculados aos Contratos</CardTitle>
            <CardDescription>Gerencie os analistas que podem ser responsáveis por justificativas dos contratos.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Analista</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Status</TableHead>
                  {podeEditar && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && vinculos.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhum vínculo cadastrado ainda.</TableCell>
                  </TableRow>
                )}
                {vinculosPagina.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">{usuariosPorId.get(v.analista_user_id)?.nome ?? "—"}</TableCell>
                    <TableCell>{v.contrato?.nome ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {v.contrato?.empresa?.nome_fantasia || v.contrato?.empresa?.razao_social || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge className={v.ativo ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"}>
                        {v.ativo ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    {podeEditar && (
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(v)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExcluir(v.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {vinculos.length > 0 && (
            <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
              <span>
                Mostrando {(pagina - 1) * PAGE_SIZE + 1} a {Math.min(pagina * PAGE_SIZE, vinculos.length)} de {vinculos.length} registros
              </span>
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
    </div>
  );
}
