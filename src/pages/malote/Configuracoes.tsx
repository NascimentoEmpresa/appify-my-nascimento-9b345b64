import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Save, Shield, Lock, FileText, Plus, Pencil, Trash2, AlertTriangle, Download, Calendar } from "lucide-react";
import { toast } from "sonner";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  useMaloteConfig,
  useSalvarMaloteConfig,
  useMaloteTiposBloqueio,
  useCriarTipoBloqueio,
  useMaloteDiasBloqueados,
  useSalvarDiaBloqueado,
  useExcluirDiaBloqueado,
  useImportarFeriadosNacionais,
  MaloteConfig,
  MaloteDiaBloqueado,
  PrazoPagamentoModo,
  PrazoPagamentoUnidade,
  BloqueioRegra,
} from "@/hooks/useMaloteConfig";

const DIAS_UTEIS_OPCOES = Array.from({ length: 15 }, (_, i) => i + 1);
const ANO_ATUAL = new Date().getFullYear();
const ANOS_IMPORTACAO = [ANO_ATUAL - 1, ANO_ATUAL, ANO_ATUAL + 1, ANO_ATUAL + 2];

export default function Configuracoes() {
  const { can } = usePermissoes();
  const podeEditar = can("alterar", "malote", "malote_configuracoes");

  const { data: config, isLoading } = useMaloteConfig();
  const salvar = useSalvarMaloteConfig();

  const [form, setForm] = useState<MaloteConfig | null>(null);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  async function handleSalvar() {
    if (!form) return;
    try {
      await salvar.mutateAsync(form);
      toast.success("Configurações salvas.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar configurações.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Configurações do Malote"
        subtitle="Defina as regras, prazos e parâmetros que controlam o fluxo do malote."
        module="Malote"
        breadcrumb={["Malote", "Configurações"]}
        actions={
          podeEditar && (
            <Button onClick={handleSalvar} disabled={!form || salvar.isPending}>
              <Save className="h-4 w-4 mr-2" />
              {salvar.isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          )
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Carregando configurações...</p>}

      {form && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-start gap-2">
                <Shield className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Regras Gerais</CardTitle>
                  <CardDescription>Regras principais que regem o fluxo do malote no dia a dia.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <PrazoBlock
                numero="1.1"
                titulo="Prazo para inclusão e aprovação pelo setor"
                horario={form.inclusao_setor_horario}
                onHorarioChange={(v) => setForm((f) => (f ? { ...f, inclusao_setor_horario: v } : f))}
                modo={form.inclusao_setor_pagamento_modo}
                onModoChange={(v) => setForm((f) => (f ? { ...f, inclusao_setor_pagamento_modo: v } : f))}
                dias={form.inclusao_setor_pagamento_dias}
                onDiasChange={(v) => setForm((f) => (f ? { ...f, inclusao_setor_pagamento_dias: v } : f))}
                unidade={form.inclusao_setor_pagamento_unidade}
                onUnidadeChange={(v) => setForm((f) => (f ? { ...f, inclusao_setor_pagamento_unidade: v } : f))}
                disabled={!podeEditar}
              />
              <PrazoBlock
                numero="1.2"
                titulo="Prazo para conferência e aprovação"
                horario={form.conferencia_aprovacao_horario}
                onHorarioChange={(v) => setForm((f) => (f ? { ...f, conferencia_aprovacao_horario: v } : f))}
                modo={form.conferencia_aprovacao_pagamento_modo}
                onModoChange={(v) => setForm((f) => (f ? { ...f, conferencia_aprovacao_pagamento_modo: v } : f))}
                dias={form.conferencia_aprovacao_pagamento_dias}
                onDiasChange={(v) => setForm((f) => (f ? { ...f, conferencia_aprovacao_pagamento_dias: v } : f))}
                unidade={form.conferencia_aprovacao_pagamento_unidade}
                onUnidadeChange={(v) => setForm((f) => (f ? { ...f, conferencia_aprovacao_pagamento_unidade: v } : f))}
                disabled={!podeEditar}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start gap-2">
                <Lock className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Bloqueio de Dias</CardTitle>
                  <CardDescription>Defina como o malote deve se comportar em finais de semana e feriados.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm mb-2">Como aplicar as regras quando o prazo cair em finais de semana ou feriados?</p>
                <RadioGroup
                  value={form.bloqueio_regra}
                  onValueChange={(v) => setForm((f) => (f ? { ...f, bloqueio_regra: v as BloqueioRegra } : f))}
                  className="gap-3"
                >
                  <BloqueioOpcao
                    value="antecipar"
                    label="Antecipar para o último dia útil anterior"
                    descricao="Os prazos serão antecipados para o último dia útil antes do final de semana ou feriado."
                    disabled={!podeEditar}
                  />
                  <BloqueioOpcao
                    value="proximo_dia_util"
                    label="Próximo dia útil"
                    descricao="Os prazos serão transferidos para o próximo dia útil após final de semana ou feriado."
                    disabled={!podeEditar}
                  />
                  <BloqueioOpcao
                    value="manter_original"
                    label="Manter o prazo original"
                    descricao="Os prazos permanecerão inalterados, mesmo que caiam em finais de semana ou feriados."
                    disabled={!podeEditar}
                  />
                </RadioGroup>
                <label className="flex items-start gap-2 text-sm cursor-pointer mt-3">
                  <Checkbox
                    checked={form.bloqueio_impedir_lancamento}
                    onCheckedChange={(checked) =>
                      setForm((f) => (f ? { ...f, bloqueio_impedir_lancamento: checked === true } : f))
                    }
                    disabled={!podeEditar}
                  />
                  <span>
                    <span className="font-medium">Impedir lançamento em dias bloqueados</span>
                    <br />
                    <span className="text-xs text-muted-foreground">
                      Não será permitido incluir despesas com data de vencimento em dias bloqueados.
                    </span>
                  </span>
                </label>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-start gap-2">
                <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Dias Bloqueados Cadastrados</CardTitle>
                  <CardDescription>Datas específicas (feriados, recessos, pontos facultativos) que o malote considera bloqueadas.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <DiasBloqueadosSection podeEditar={podeEditar} />
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">Inclusões de exceções</CardTitle>
                  <CardDescription>Parâmetros para inclusão de despesas fora do fluxo regular.</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                  <Label className="text-sm font-semibold">2.1 Limite para inclusão de exceções</Label>
                  <div className="mt-2">
                    <Label className="text-xs">Horário máximo</Label>
                    <Input
                      type="time"
                      value={form.excecao_limite_inclusao_horario}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, excecao_limite_inclusao_horario: e.target.value } : f))
                      }
                      disabled={!podeEditar}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Até que horário o setor pode incluir despesas como exceção no mesmo dia.
                    </p>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-semibold">2.2 Limite para aprovação de exceções</Label>
                  <div className="mt-2">
                    <Label className="text-xs">Horário máximo</Label>
                    <Input
                      type="time"
                      value={form.excecao_limite_aprovacao_horario}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, excecao_limite_aprovacao_horario: e.target.value } : f))
                      }
                      disabled={!podeEditar}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Até que horário a despesa de exceção deve ser aprovada.
                    </p>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-semibold">2.3 Exigências para inclusão de exceções</Label>
                  <p className="text-xs text-muted-foreground mt-1 mb-2">
                    Selecione as exigências obrigatórias para inclusão de despesas como exceção.
                  </p>
                  <div className="space-y-2">
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={form.excecao_exigir_justificativa_solicitante}
                        onCheckedChange={(checked) =>
                          setForm((f) =>
                            f ? { ...f, excecao_exigir_justificativa_solicitante: checked === true } : f
                          )
                        }
                        disabled={!podeEditar}
                      />
                      <span>
                        <span className="font-medium">Solicitar justificativa do solicitante</span>
                        <br />
                        <span className="text-xs text-muted-foreground">
                          Exigir que o solicitante informe o motivo da inclusão fora do fluxo regular.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={form.excecao_exigir_justificativa_aprovador}
                        onCheckedChange={(checked) =>
                          setForm((f) => (f ? { ...f, excecao_exigir_justificativa_aprovador: checked === true } : f))
                        }
                        disabled={!podeEditar}
                      />
                      <span>
                        <span className="font-medium">Solicitar justificativa do aprovador</span>
                        <br />
                        <span className="text-xs text-muted-foreground">
                          Exigir que o responsável pela aprovação registre a justificativa da exceção.
                        </span>
                      </span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs">
                  <p className="font-medium text-amber-900 dark:text-amber-200">Atenção</p>
                  <p className="text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                    Exceções não inseridas até o horário limite ou não aprovadas até o horário limite não serão pagas
                    no mesmo dia.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

const UNIDADE_LABEL: Record<PrazoPagamentoUnidade, string> = {
  util: "dia(s) útil(eis)",
  corrido: "dia(s) corrido(s)",
};

function PrazoBlock({
  numero,
  titulo,
  horario,
  onHorarioChange,
  modo,
  onModoChange,
  dias,
  onDiasChange,
  unidade,
  onUnidadeChange,
  disabled,
}: {
  numero: string;
  titulo: string;
  horario: string;
  onHorarioChange: (v: string) => void;
  modo: PrazoPagamentoModo;
  onModoChange: (v: PrazoPagamentoModo) => void;
  dias: number;
  onDiasChange: (v: number) => void;
  unidade: PrazoPagamentoUnidade;
  onUnidadeChange: (v: PrazoPagamentoUnidade) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <Label className="text-sm font-semibold">
        {numero} {titulo}
      </Label>
      <div className="mt-2">
        <Label className="text-xs">Horário máximo</Label>
        <Input type="time" value={horario} onChange={(e) => onHorarioChange(e.target.value)} disabled={disabled} />
      </div>
      <div className="mt-3">
        <Label className="text-xs">Pagamento</Label>
        <p className="text-xs text-muted-foreground mb-1">Despesa aprovada até o horário acima será paga:</p>
        <RadioGroup value={modo} onValueChange={(v) => onModoChange(v as PrazoPagamentoModo)} className="gap-2">
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <RadioGroupItem value="hoje" disabled={disabled} className="mt-0.5" />
            <span>
              <span className="font-medium">No dia de hoje</span>
              <br />
              <span className="text-xs text-muted-foreground">Pagamento será realizado no mesmo dia.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <RadioGroupItem value="dias_uteis" disabled={disabled} className="mt-0.5" />
            <span className="flex-1">
              <span className="inline-flex flex-wrap items-center gap-1.5 font-medium">
                Em até
                <Select
                  value={String(dias)}
                  onValueChange={(v) => onDiasChange(Number(v))}
                  disabled={disabled || modo !== "dias_uteis"}
                >
                  <SelectTrigger className="h-7 w-16 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIAS_UTEIS_OPCOES.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={unidade}
                  onValueChange={(v) => onUnidadeChange(v as PrazoPagamentoUnidade)}
                  disabled={disabled || modo !== "dias_uteis"}
                >
                  <SelectTrigger className="h-7 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="util">dia(s) útil(eis)</SelectItem>
                    <SelectItem value="corrido">dia(s) corrido(s)</SelectItem>
                  </SelectContent>
                </Select>
              </span>
              <br />
              <span className="text-xs text-muted-foreground">
                Pagamento será realizado em até {dias} {UNIDADE_LABEL[unidade]} após a aprovação.
              </span>
            </span>
          </label>
        </RadioGroup>
      </div>
    </div>
  );
}

function BloqueioOpcao({
  value,
  label,
  descricao,
  disabled,
}: {
  value: string;
  label: string;
  descricao: string;
  disabled: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <RadioGroupItem value={value} disabled={disabled} className="mt-0.5" />
      <span>
        <span className="font-medium">{label}</span>
        <br />
        <span className="text-xs text-muted-foreground">{descricao}</span>
      </span>
    </label>
  );
}

interface DiaBloqueadoForm {
  id?: string;
  data: string;
  tipo: string;
  descricao: string;
}

function DiasBloqueadosSection({ podeEditar }: { podeEditar: boolean }) {
  const { data: dias = [], isLoading } = useMaloteDiasBloqueados();
  const { data: tipos = [] } = useMaloteTiposBloqueio();
  const salvarDia = useSalvarDiaBloqueado();
  const excluirDia = useExcluirDiaBloqueado();
  const criarTipo = useCriarTipoBloqueio();
  const importarFeriados = useImportarFeriadosNacionais();

  const [filtroData, setFiltroData] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editando, setEditando] = useState<DiaBloqueadoForm | null>(null);
  const [novoTipo, setNovoTipo] = useState("");
  const [anoImportar, setAnoImportar] = useState(String(ANO_ATUAL));

  async function handleImportarFeriados() {
    try {
      const { total, importados } = await importarFeriados.mutateAsync(Number(anoImportar));
      toast.success(
        importados > 0
          ? `${importados} feriado(s) de ${anoImportar} importado(s).`
          : `Nenhum feriado novo — os ${total} de ${anoImportar} já estavam cadastrados.`
      );
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao importar feriados.");
    }
  }

  const filtrados = useMemo(
    () =>
      dias.filter((d) => {
        if (filtroData && d.data !== filtroData) return false;
        if (filtroTipo !== "todos" && d.tipo !== filtroTipo) return false;
        return true;
      }),
    [dias, filtroData, filtroTipo]
  );

  function abrirNovo() {
    setEditando({ data: "", tipo: "", descricao: "" });
    setNovoTipo("");
    setOpen(true);
  }

  function abrirEditar(d: MaloteDiaBloqueado) {
    setEditando({ id: d.id, data: d.data, tipo: d.tipo, descricao: d.descricao ?? "" });
    setNovoTipo("");
    setOpen(true);
  }

  async function handleSalvar() {
    if (!editando?.data) {
      toast.error("Informe a data.");
      return;
    }
    if (!editando?.tipo) {
      toast.error("Informe o tipo.");
      return;
    }
    try {
      await salvarDia.mutateAsync({
        id: editando.id,
        data: editando.data,
        tipo: editando.tipo,
        descricao: editando.descricao.trim() || null,
      });
      toast.success("Dia bloqueado salvo.");
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar dia bloqueado.");
    }
  }

  async function handleExcluir(id: string) {
    if (!confirm("Excluir este dia bloqueado?")) return;
    try {
      await excluirDia.mutateAsync(id);
      toast.success("Dia bloqueado excluído.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir.");
    }
  }

  async function handleCriarTipo() {
    const nome = novoTipo.trim();
    if (!nome) return;
    try {
      await criarTipo.mutateAsync(nome);
      setEditando((v) => (v ? { ...v, tipo: nome } : v));
      setNovoTipo("");
      toast.success("Tipo criado.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao criar tipo.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Input
          type="date"
          value={filtroData}
          onChange={(e) => setFiltroData(e.target.value)}
          className="w-auto"
          placeholder="Buscar por data"
        />
        <Select value={filtroTipo} onValueChange={setFiltroTipo}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os tipos</SelectItem>
            {tipos.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="h-9 py-2">Data</TableHead>
              <TableHead className="h-9 py-2">Tipo</TableHead>
              <TableHead className="h-9 py-2">Descrição</TableHead>
              {podeEditar && <TableHead className="h-9 py-2 text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && filtrados.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-4">
                  Nenhum dia bloqueado cadastrado.
                </TableCell>
              </TableRow>
            )}
            {filtrados.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="py-1.5">{new Date(d.data + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                <TableCell className="py-1.5">{d.tipo}</TableCell>
                <TableCell className="py-1.5 text-muted-foreground">{d.descricao ?? "—"}</TableCell>
                {podeEditar && (
                  <TableCell className="py-1.5 text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEditar(d)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExcluir(d.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {podeEditar && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={abrirNovo} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar bloqueio de dia
          </Button>
          <Select value={anoImportar} onValueChange={setAnoImportar}>
            <SelectTrigger className="h-9 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANOS_IMPORTACAO.map((a) => (
                <SelectItem key={a} value={String(a)}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImportarFeriados}
            disabled={importarFeriados.isPending}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            {importarFeriados.isPending ? "Importando..." : "Importar feriados nacionais"}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        A importação cobre só os feriados nacionais (fixos + móveis calculados pela Páscoa). Feriados estaduais,
        municipais e pontos facultativos locais continuam sendo cadastro manual.
      </p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{editando?.id ? "Editar bloqueio de dia" : "Adicionar bloqueio de dia"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>
                Data <span className="text-destructive">*</span>
              </Label>
              <Input
                type="date"
                value={editando?.data ?? ""}
                onChange={(e) => setEditando((v) => (v ? { ...v, data: e.target.value } : v))}
              />
            </div>
            <div>
              <Label>
                Tipo <span className="text-destructive">*</span>
              </Label>
              <Select value={editando?.tipo ?? ""} onValueChange={(v) => setEditando((s) => (s ? { ...s, tipo: v } : s))}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o tipo..." />
                </SelectTrigger>
                <SelectContent>
                  {tipos.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2 mt-2">
                <Input
                  placeholder="Criar novo tipo..."
                  value={novoTipo}
                  onChange={(e) => setNovoTipo(e.target.value)}
                />
                <Button type="button" variant="outline" size="sm" onClick={handleCriarTipo} disabled={!novoTipo.trim()}>
                  Criar
                </Button>
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input
                placeholder="Ex.: Independência do Brasil"
                value={editando?.descricao ?? ""}
                onChange={(e) => setEditando((v) => (v ? { ...v, descricao: e.target.value } : v))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSalvar} disabled={salvarDia.isPending}>
              {salvarDia.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
