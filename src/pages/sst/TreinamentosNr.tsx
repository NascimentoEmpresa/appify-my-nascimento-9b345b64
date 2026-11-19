import { useMemo, useState } from "react";
import { FileSpreadsheet, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ImportarTreinamentosDialog } from "@/components/sst/ImportarTreinamentos";
import { Indicador } from "@/components/sst/PecasSst";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  MENU_TREINAMENTOS_NR, useContratosTrn, useExcluirObrigatorio, useExcluirTurma, useObrigatorios, useOnlineResumo,
  useSalvarObrigatorio, useSalvarTurma, useTurmas, type SalvarObrigatorio, type SalvarTurma,
} from "@/hooks/useTreinamentosNr";
import {
  COR_STATUS_TRN, contarObrigatorios, EMPRESAS_TRN, fmtData, hojeIso, pct, ROTULO_STATUS_TRN, situacaoTurma, statusObrigatorio,
  validadeObrigatorio, type Obrigatorio, type StatusTrn, type Turma,
} from "@/lib/sst/treinamentosNr";

// =====================================================================
// SST › TREINAMENTOS OBRIGATÓRIOS (NR) — SIS-2026-0816, mig 20261121100000.
//
// Três abas:
//   · Obrigatórios — a matriz contrato × função × treinamento (era o
//     "Plano_Treinamentos_Empresas"), com o status calculado;
//   · Turmas — o cronograma presencial; registrar uma turma realizada pode
//     atualizar a data do último treinamento das linhas que ela cobre;
//   · Online — obrigatório × feito dos cursos da plataforma liberados por
//     contrato/cargo (só leitura; liberação continua em Treinamentos).
// É daqui que a TV do SST tira o bloco de treinamentos.
// =====================================================================

const CORES_SITUACAO_TURMA = {
  realizada: "bg-emerald-100 text-emerald-800 border-emerald-200",
  prevista: "bg-sky-100 text-sky-800 border-sky-200",
  sem_data: "bg-slate-100 text-slate-700 border-slate-200",
  cancelada: "bg-slate-100 text-slate-500 border-slate-200 line-through",
};
const ROTULO_SITUACAO_TURMA = { realizada: "Realizada", prevista: "Prevista", sem_data: "Sem data", cancelada: "Cancelada" };

export default function TreinamentosNr() {
  const podeAlterar = useScreenAccess(MENU_TREINAMENTOS_NR, "alterar").data === true;
  const podeExcluir = useScreenAccess(MENU_TREINAMENTOS_NR, "excluir").data === true;
  const [importando, setImportando] = useState<"plano" | "cronograma" | null>(null);
  const [aba, setAba] = useState("obrigatorios");
  return (
    <div className="space-y-4">
      <PageHeader title="Treinamentos Obrigatórios (NR)" module="SST" breadcrumb={["Treinamentos Obrigatórios (NR)"]}
        subtitle="O que cada contrato e função precisa fazer, quando fez e quando vence — mais as turmas presenciais e os cursos online liberados por contrato."
        actions={podeAlterar && (
          <>
            <Button variant="outline" onClick={() => setImportando("plano")}><FileSpreadsheet className="mr-2 h-4 w-4" /> Importar matriz</Button>
            <Button variant="outline" onClick={() => setImportando("cronograma")}><FileSpreadsheet className="mr-2 h-4 w-4" /> Importar cronograma</Button>
          </>
        )} />
      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          <TabsTrigger value="obrigatorios">Obrigatórios por contrato</TabsTrigger>
          <TabsTrigger value="turmas">Turmas (cronograma)</TabsTrigger>
          <TabsTrigger value="online">Online (plataforma)</TabsTrigger>
        </TabsList>
        <TabsContent value="obrigatorios" className="mt-4"><AbaObrigatorios podeAlterar={podeAlterar} podeExcluir={podeExcluir} /></TabsContent>
        <TabsContent value="turmas" className="mt-4"><AbaTurmas podeAlterar={podeAlterar} podeExcluir={podeExcluir} /></TabsContent>
        <TabsContent value="online" className="mt-4">{aba === "online" && <AbaOnline />}</TabsContent>
      </Tabs>
      {importando && <ImportarTreinamentosDialog tipo={importando} onFechar={() => setImportando(null)} />}
    </div>
  );
}

const contratoDe = (x: { contrato_nome: string | null; contrato_texto: string }) => x.contrato_nome ?? x.contrato_texto;
const normBusca = (v: string | null | undefined) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

function AbaObrigatorios({ podeAlterar, podeExcluir }: { podeAlterar: boolean; podeExcluir: boolean }) {
  const { data: lista = [], isLoading, error } = useObrigatorios();
  const excluir = useExcluirObrigatorio();
  const [status, setStatus] = useState<StatusTrn | "todos">("todos");
  const [empresa, setEmpresa] = useState("todas");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<Obrigatorio | "novo" | null>(null);
  const c = contarObrigatorios(lista);
  const visiveis = useMemo(() => {
    const q = normBusca(busca.trim());
    return lista.filter((o) => (status === "todos" || o.status === status) && (empresa === "todas" || o.empresa === empresa)
      && (!q || normBusca(`${contratoDe(o)} ${o.funcoes} ${o.treinamento} ${o.base_legal}`).includes(q)));
  }, [lista, status, empresa, busca]);
  const alternar = (s: StatusTrn) => setStatus((x) => (x === s ? "todos" : s));

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-5">
        <Indicador valor={c.total} titulo="Obrigatórios (ativos)" ativo={status === "todos"} onClick={() => setStatus("todos")} />
        <Indicador valor={c.em_dia} titulo="Em dia" ativo={status === "em_dia"} onClick={() => alternar("em_dia")} />
        <Indicador valor={c.proximo} titulo="Vencem em 30 dias" destaque={c.proximo ? "aviso" : undefined} ativo={status === "proximo"} onClick={() => alternar("proximo")} />
        <Indicador valor={c.vencido} titulo="Vencidos" destaque={c.vencido ? "erro" : undefined} ativo={status === "vencido"} onClick={() => alternar("vencido")} />
        <Indicador valor={c.pendente} titulo="Pendentes (sem registro)" ativo={status === "pendente"} onClick={() => alternar("pendente")}
          ajuda="Treinamento obrigatório sem nenhuma data de realização registrada" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Label className="text-xs">Contrato, função ou treinamento</Label>
          <Search className="absolute bottom-3 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="mt-1 pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Empresa</Label>
          <Select value={empresa} onValueChange={setEmpresa}>
            <SelectTrigger className="w-36" aria-label="Empresa"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {EMPRESAS_TRN.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {podeAlterar && <Button onClick={() => setEditando("novo")}><Plus className="mr-2 h-4 w-4" /> Novo obrigatório</Button>}
      </div>
      <Card className="overflow-x-auto">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow>
              <TableHead>Contrato</TableHead>
              <TableHead>Funções</TableHead>
              <TableHead>Treinamento</TableHead>
              <TableHead>Periodicidade</TableHead>
              <TableHead>Último</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-red-700">{(error as Error).message}</TableCell></TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                {lista.length ? "Nada com esses filtros." : "Nenhum obrigatório cadastrado. Importe a matriz (Plano de Treinamentos) ou cadastre."}
              </TableCell></TableRow>
            ) : visiveis.map((o) => (
              <TableRow key={o.id} className={!o.ativo ? "opacity-50" : undefined}>
                <TableCell>
                  {o.empresa && <Badge variant="outline" className="mr-1">{o.empresa}</Badge>}
                  <span className="font-medium">{contratoDe(o)}</span>
                  {!o.contrato_id && <span className="block text-xs text-amber-700">contrato não identificado</span>}
                </TableCell>
                <TableCell className="max-w-56 text-sm">{o.funcoes ?? "—"}</TableCell>
                <TableCell className="max-w-72 text-sm">
                  {o.treinamento}
                  {o.base_legal && <span className="block text-xs text-muted-foreground">{o.base_legal}</span>}
                </TableCell>
                <TableCell>{o.periodicidade_meses ? `${o.periodicidade_meses} meses` : "—"}</TableCell>
                <TableCell className="tabular-nums">{fmtData(o.ultimo_treinamento)}</TableCell>
                <TableCell className="tabular-nums">{fmtData(o.validade)}</TableCell>
                <TableCell><Badge variant="outline" className={COR_STATUS_TRN[o.status]}>{ROTULO_STATUS_TRN[o.status]}</Badge></TableCell>
                <TableCell className="text-right">
                  {podeAlterar && <Button size="icon" variant="ghost" onClick={() => setEditando(o)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>}
                  {podeExcluir && (
                    <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => {
                      if (window.confirm(`Excluir "${o.treinamento}" de ${contratoDe(o)}?`)) excluir.mutate(o.id, { onError: (e) => toast.error((e as Error).message) });
                    }}><Trash2 className="h-4 w-4" /></Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {editando && <FormObrigatorio o={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} />}
    </div>
  );
}

function CampoContrato({ valor, onChange }: { valor: string; onChange: (v: string) => void }) {
  const { data: contratos = [] } = useContratosTrn();
  return (
    <>
      <Input list="sst-trn-contratos" value={valor} onChange={(e) => onChange(e.target.value)} placeholder="Nome do contrato" />
      <datalist id="sst-trn-contratos">{contratos.map((c) => <option key={c.id} value={c.nome} />)}</datalist>
    </>
  );
}

function FormObrigatorio({ o, onFechar }: { o: Obrigatorio | null; onFechar: () => void }) {
  const salvar = useSalvarObrigatorio();
  const [p, setP] = useState<SalvarObrigatorio>({
    id: o?.id, empresa: o?.empresa ?? "HAGG", contrato_texto: o ? contratoDe(o) : "", funcoes: o?.funcoes ?? "",
    treinamento: o?.treinamento ?? "", base_legal: o?.base_legal ?? "", periodicidade_meses: o?.periodicidade_meses ?? 12,
    ultimo_treinamento: o?.ultimo_treinamento ?? null, observacoes: o?.observacoes ?? "", ativo: o?.ativo ?? true,
  });
  const campo = <K extends keyof SalvarObrigatorio>(k: K, v: SalvarObrigatorio[K]) => setP((x) => ({ ...x, [k]: v }));
  const previa = statusObrigatorio(p.ultimo_treinamento ?? null, p.periodicidade_meses ?? null);
  const enviar = () => salvar.mutate({ ...p, contrato_id: null }, {
    onSuccess: () => { toast.success("Salvo."); onFechar(); }, onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{o ? "Editar treinamento obrigatório" : "Novo treinamento obrigatório"}</DialogTitle>
          <DialogDescription>{o?.origem === "planilha" ? "Veio da planilha. O que for corrigido aqui não é sobrescrito numa nova importação." : "Uma linha da matriz: contrato, funções e o treinamento exigido."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Empresa</Label>
            <Select value={p.empresa ?? "HAGG"} onValueChange={(v) => campo("empresa", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EMPRESAS_TRN.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Contrato</Label><CampoContrato valor={p.contrato_texto} onChange={(v) => campo("contrato_texto", v)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Funções</Label><Input value={p.funcoes ?? ""} onChange={(e) => campo("funcoes", e.target.value)} placeholder="SERVENTE DE LIMPEZA, SUPERVISOR / TODAS FUNÇÕES" /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Treinamento obrigatório</Label><Input value={p.treinamento} onChange={(e) => campo("treinamento", e.target.value)} placeholder="NR-01, NR-06, NR-17" /></div>
          <div className="space-y-1"><Label>Base legal / contratual</Label><Input value={p.base_legal ?? ""} onChange={(e) => campo("base_legal", e.target.value)} /></div>
          <div className="space-y-1">
            <Label>Periodicidade (meses)</Label>
            <Input type="number" min={1} max={120} value={p.periodicidade_meses ?? ""} onChange={(e) => campo("periodicidade_meses", e.target.value ? Number(e.target.value) : null)} placeholder="vazio = sem reciclagem" />
          </div>
          <div className="space-y-1">
            <Label>Data do último treinamento</Label>
            <Input type="date" max={hojeIso()} value={p.ultimo_treinamento ?? ""} onChange={(e) => campo("ultimo_treinamento", e.target.value || null)} />
          </div>
          <div className="flex items-end gap-2 pb-2 text-sm">
            <Badge variant="outline" className={COR_STATUS_TRN[previa]}>{ROTULO_STATUS_TRN[previa]}</Badge>
            {validadeObrigatorio(p.ultimo_treinamento ?? null, p.periodicidade_meses ?? null) && <span>vale até {fmtData(validadeObrigatorio(p.ultimo_treinamento ?? null, p.periodicidade_meses ?? null))}</span>}
          </div>
          <div className="space-y-1 sm:col-span-2"><Label>Observações</Label><Textarea rows={2} value={p.observacoes ?? ""} onChange={(e) => campo("observacoes", e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={p.ativo !== false} onCheckedChange={(v) => campo("ativo", v === true)} /> Ativo (desmarque se o contrato não exige mais)</label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={enviar} disabled={salvar.isPending || !p.contrato_texto.trim() || !p.treinamento.trim()}>
            {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AbaTurmas({ podeAlterar, podeExcluir }: { podeAlterar: boolean; podeExcluir: boolean }) {
  const anoAtual = Number(hojeIso().slice(0, 4));
  const [ano, setAno] = useState<number>(anoAtual);
  const { data: turmas = [], isLoading, error } = useTurmas(ano);
  const excluir = useExcluirTurma();
  const [editando, setEditando] = useState<Turma | "nova" | null>(null);
  const hoje = hojeIso();
  const realizadas = turmas.filter((t) => situacaoTurma(t, hoje) === "realizada");
  const previstas = turmas.filter((t) => situacaoTurma(t, hoje) === "prevista");
  const participantes = realizadas.reduce((a, t) => a + (t.participantes ?? 0), 0);
  const custo = realizadas.reduce((a, t) => a + (t.custo ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-4">
        <Indicador valor={realizadas.length} titulo={`Turmas realizadas em ${ano}`} />
        <Indicador valor={participantes} titulo="Participantes" />
        <Indicador valor={previstas.length} titulo="Previstas" />
        <Indicador valor={custo.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} titulo="Custo das turmas realizadas" />
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Ano</Label>
          <Select value={String(ano)} onValueChange={(v) => setAno(Number(v))}>
            <SelectTrigger className="w-28" aria-label="Ano"><SelectValue /></SelectTrigger>
            <SelectContent>{[anoAtual + 1, anoAtual, anoAtual - 1, anoAtual - 2].map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex-1" />
        {podeAlterar && <Button onClick={() => setEditando("nova")}><Plus className="mr-2 h-4 w-4" /> Registrar turma</Button>}
      </div>
      <Card className="overflow-x-auto">
        <Table className="min-w-[1000px]">
          <TableHeader>
            <TableRow>
              <TableHead>Nº</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead>Funções</TableHead>
              <TableHead>NRs / tema</TableHead>
              <TableHead className="text-right">Participantes</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-red-700">{(error as Error).message}</TableCell></TableRow>
            ) : turmas.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">Nenhuma turma em {ano}. Importe o cronograma ou registre uma turma.</TableCell></TableRow>
            ) : turmas.map((t) => {
              const s = situacaoTurma(t, hoje);
              return (
                <TableRow key={t.id}>
                  <TableCell className="tabular-nums">{t.numero ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{fmtData(t.data)}</TableCell>
                  <TableCell className="font-medium">{contratoDe(t)}</TableCell>
                  <TableCell className="max-w-64 text-sm">{t.funcoes ?? "—"}</TableCell>
                  <TableCell className="text-sm">{t.nrs ?? ""}{t.tema && <span className="block text-xs text-muted-foreground">{t.tema}</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.participantes ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={CORES_SITUACAO_TURMA[s]}>{ROTULO_SITUACAO_TURMA[s]}</Badge></TableCell>
                  <TableCell className="text-right">
                    {podeAlterar && <Button size="icon" variant="ghost" onClick={() => setEditando(t)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>}
                    {podeExcluir && (
                      <Button size="icon" variant="ghost" aria-label="Excluir" onClick={() => {
                        if (window.confirm(`Excluir a turma de ${contratoDe(t)} (${fmtData(t.data)})?`)) excluir.mutate(t.id, { onError: (e) => toast.error((e as Error).message) });
                      }}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
      {editando && <FormTurma t={editando === "nova" ? null : editando} onFechar={() => setEditando(null)} />}
    </div>
  );
}

function FormTurma({ t, onFechar }: { t: Turma | null; onFechar: () => void }) {
  const salvar = useSalvarTurma();
  const { data: obrigatorios = [] } = useObrigatorios();
  const [p, setP] = useState<SalvarTurma>({
    id: t?.id, numero: t?.numero ?? null, empresa: t?.empresa ?? "HAGG", contrato_texto: t ? contratoDe(t) : "", funcoes: t?.funcoes ?? "",
    nrs: t?.nrs ?? "", tema: t?.tema ?? "", data: t?.data ?? null, participantes: t?.participantes ?? null, custo: t?.custo ?? null,
    instrutor: t?.instrutor ?? "", local: t?.local ?? "", observacoes: t?.observacoes ?? "", cancelada: t?.cancelada ?? false,
  });
  const [marcados, setMarcados] = useState<number[]>([]);
  const campo = <K extends keyof SalvarTurma>(k: K, v: SalvarTurma[K]) => setP((x) => ({ ...x, [k]: v }));
  const doContrato = obrigatorios.filter((o) => o.ativo && normBusca(contratoDe(o)) === normBusca(p.contrato_texto.trim()));
  const realizada = !!p.data && p.data <= hojeIso() && !p.cancelada;
  const enviar = () => salvar.mutate({ turma: { ...p, contrato_id: null }, obrigatorios: realizada ? marcados : [] }, {
    onSuccess: (r) => {
      toast.success(r.obrigatorios_atualizados ? `Turma salva; ${r.obrigatorios_atualizados} obrigatório(s) atualizado(s).` : "Turma salva.");
      onFechar();
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t ? "Editar turma" : "Registrar turma"}</DialogTitle>
          <DialogDescription>Treinamento presencial. Data futura = prevista; até hoje = realizada.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label>Data</Label><Input type="date" value={p.data ?? ""} onChange={(e) => campo("data", e.target.value || null)} /></div>
          <div className="space-y-1"><Label>Nº no cronograma</Label><Input type="number" value={p.numero ?? ""} onChange={(e) => campo("numero", e.target.value ? Number(e.target.value) : null)} /></div>
          <div className="space-y-1">
            <Label>Empresa</Label>
            <Select value={p.empresa ?? "HAGG"} onValueChange={(v) => campo("empresa", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{EMPRESAS_TRN.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Contrato</Label><CampoContrato valor={p.contrato_texto} onChange={(v) => { campo("contrato_texto", v); setMarcados([]); }} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Funções</Label><Input value={p.funcoes ?? ""} onChange={(e) => campo("funcoes", e.target.value)} /></div>
          <div className="space-y-1"><Label>NRs</Label><Input value={p.nrs ?? ""} onChange={(e) => campo("nrs", e.target.value)} placeholder="NR 12 - NR 31" /></div>
          <div className="space-y-1"><Label>Tema</Label><Input value={p.tema ?? ""} onChange={(e) => campo("tema", e.target.value)} /></div>
          <div className="space-y-1"><Label>Participantes</Label><Input type="number" min={0} value={p.participantes ?? ""} onChange={(e) => campo("participantes", e.target.value ? Number(e.target.value) : null)} /></div>
          <div className="space-y-1"><Label>Custo (R$)</Label><Input type="number" min={0} step="0.01" value={p.custo ?? ""} onChange={(e) => campo("custo", e.target.value ? Number(e.target.value) : null)} /></div>
          <div className="space-y-1"><Label>Instrutor</Label><Input value={p.instrutor ?? ""} onChange={(e) => campo("instrutor", e.target.value)} /></div>
          <div className="space-y-1"><Label>Local</Label><Input value={p.local ?? ""} onChange={(e) => campo("local", e.target.value)} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Observações</Label><Textarea rows={2} value={p.observacoes ?? ""} onChange={(e) => campo("observacoes", e.target.value)} /></div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!p.cancelada} onCheckedChange={(v) => campo("cancelada", v === true)} /> Cancelada</label>
          {realizada && doContrato.length > 0 && (
            <div className="space-y-1 rounded border p-2 sm:col-span-2">
              <Label>Esta turma cumpre quais obrigatórios do contrato? (a data do último treinamento passa a ser a desta turma)</Label>
              {doContrato.map((o) => (
                <label key={o.id} className="flex items-start gap-2 text-sm">
                  <Checkbox checked={marcados.includes(o.id)} onCheckedChange={(v) => setMarcados((m) => (v === true ? [...m, o.id] : m.filter((x) => x !== o.id)))} />
                  <span>{o.treinamento} <span className="text-xs text-muted-foreground">· {o.funcoes ?? "todas"} · último {fmtData(o.ultimo_treinamento)}</span></span>
                </label>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={enviar} disabled={salvar.isPending || !p.contrato_texto.trim()}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AbaOnline() {
  const { data, isLoading, error } = useOnlineResumo();
  if (isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin" />;
  if (error) return <p className="text-red-700">{(error as Error).message}</p>;
  if (!data) return null;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Cursos publicados na plataforma de Treinamentos e liberados por contrato ou cargo, para quem não está demitido nem bloqueado.
        Feito = certificado emitido. A liberação é feita em Treinamentos › Cursos.
      </p>
      <div className="grid gap-2 sm:grid-cols-4">
        <Indicador valor={data.obrigatorios} titulo="Obrigatórios (pessoa × curso)" />
        <Indicador valor={data.concluidos} titulo={`Concluídos (${pct(data.concluidos, data.obrigatorios) ?? 0}%)`} />
        <Indicador valor={data.pendentes} titulo="Pendentes" destaque={data.pendentes ? "aviso" : undefined} />
        <Indicador valor={data.pessoas} titulo="Pessoas com curso obrigatório" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <TabelaOnline titulo="Por curso" linhas={data.por_curso.map((x) => ({ nome: x.curso, o: x.obrigatorios, f: x.concluidos }))} />
        <TabelaOnline titulo="Por contrato (mais pendências)" linhas={data.por_contrato.map((x) => ({ nome: x.contrato, o: x.obrigatorios, f: x.concluidos }))} />
      </div>
    </div>
  );
}

function TabelaOnline({ titulo, linhas }: { titulo: string; linhas: { nome: string; o: number; f: number }[] }) {
  return (
    <Card className="overflow-x-auto p-3">
      <p className="mb-2 font-semibold">{titulo}</p>
      {linhas.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum curso liberado por contrato ou cargo.</p> : (
        <Table>
          <TableHeader><TableRow><TableHead /><TableHead className="text-right">Obrigatórios</TableHead><TableHead className="text-right">Feitos</TableHead><TableHead className="text-right">%</TableHead></TableRow></TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.nome}>
                <TableCell className="text-sm">{l.nome}</TableCell>
                <TableCell className="text-right tabular-nums">{l.o}</TableCell>
                <TableCell className="text-right tabular-nums">{l.f}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(l.f, l.o) ?? 0}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
