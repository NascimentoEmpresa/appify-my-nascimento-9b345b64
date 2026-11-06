import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { AlertTriangle, FileUp, Loader2, Pencil, Plus, Workflow } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { AcompanhamentoTarefas } from "@/components/organograma/AcompanhamentoTarefas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  useCargosOrganograma, useImportarEstrutura, useImportarPops, useModelosTarefa, useSalvarModelo, type ModeloTarefa,
} from "@/hooks/useTarefasFuncao";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { DIAS_SEMANA, PERIODICIDADES, lerPlanilhaPops, rotuloPeriodicidade, type LeituraPlanilha, type Periodicidade } from "@/lib/organograma/tarefas";

// =====================================================================
// ORGANOGRAMA › TAREFAS POR FUNÇÃO (SIS-2026-0771, mig 20261106001000)
// Aqui a TI e os gerentes dizem quais atividades cada cargo tem. O cargo vem do
// organograma, o login vem do nó dele, e o checklist de cada pessoa nasce sozinho.
// As atividades entram à mão, pela planilha do Gerador de POPs ou pela Estrutura
// de Processos. Cada um resolve as suas em Minhas Tarefas.
// =====================================================================

const avisarErro = (e: unknown) => toast.error((e as Error).message);
const MENU = "organograma_tarefas";

export default function TarefasPorFuncao() {
  const podeAlterar = useScreenAccess(MENU, "alterar").data === true;
  return (
    <div className="space-y-4">
      <PageHeader title="Tarefas por Função" module="Organograma" breadcrumb={["Tarefas por Função"]}
        subtitle="As atividades de cada cargo viram checklists automáticos para quem tem aquele cargo no organograma." />
      <Tabs defaultValue="acompanhamento">
        <TabsList>
          <TabsTrigger value="acompanhamento">Acompanhamento</TabsTrigger>
          <TabsTrigger value="tarefas">Tarefas de cada função</TabsTrigger>
        </TabsList>
        <TabsContent value="acompanhamento" className="pt-3">
          <AcompanhamentoTarefas podeResolver={podeAlterar} vazio="Nenhuma tarefa gerada neste período. Cadastre as atividades de cada função na outra aba." />
        </TabsContent>
        <TabsContent value="tarefas" className="pt-3"><AbaModelos podeAlterar={podeAlterar} /></TabsContent>
      </Tabs>
    </div>
  );
}

function AbaModelos({ podeAlterar }: { podeAlterar: boolean }) {
  const { data: modelos = [], isLoading, error } = useModelosTarefa(true);
  const importarEstrutura = useImportarEstrutura();
  const [editando, setEditando] = useState<Partial<ModeloTarefa> | null>(null);
  const [importando, setImportando] = useState(false);
  const [busca, setBusca] = useState("");
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const visiveis = modelos
    .filter((m) => mostrarInativas || m.ativo)
    .filter((m) => [m.titulo, m.setor, m.area, ...m.cargos, ...m.pessoas].some((v) => String(v ?? "").toLowerCase().includes(busca.trim().toLowerCase())));
  const semNinguem = modelos.filter((m) => m.ativo && m.com_login === 0).length;

  const trazerEstrutura = () => importarEstrutura.mutateAsync().then(
    (r) => toast.success(`Estrutura de Processos: ${r.novos} nova(s), ${r.atualizados} atualizada(s), ${r.ignorados} fora (sem responsável ou sem frequência recorrente).`),
    avisarErro,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1"><Label htmlFor="mod-busca" className="text-xs">Buscar</Label><Input id="mod-busca" placeholder="Tarefa, setor ou cargo" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <label className="flex h-10 items-center gap-2 text-sm"><Checkbox checked={mostrarInativas} onCheckedChange={(v) => setMostrarInativas(v === true)} /> Mostrar desativadas</label>
        {podeAlterar && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" disabled={importarEstrutura.isPending} onClick={trazerEstrutura}>
              {importarEstrutura.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Workflow className="mr-2 h-4 w-4" />} Trazer da Estrutura de Processos
            </Button>
            <Button variant="outline" onClick={() => setImportando(true)}><FileUp className="mr-2 h-4 w-4" /> Importar planilha de POPs</Button>
            <Button onClick={() => setEditando({ periodicidade: "diaria", cargos: [], ativo: true })}><Plus className="mr-2 h-4 w-4" /> Nova tarefa</Button>
          </div>
        )}
      </div>
      {semNinguem > 0 && (
        <p className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {semNinguem} tarefa(s) ativa(s) sem ninguém com login no cargo: não geram checklist.
        </p>
      )}
      {isLoading ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        : error ? <p className="py-6 text-center text-sm text-destructive">{(error as Error).message}</p>
        : !visiveis.length ? <Card className="p-8 text-center text-sm text-muted-foreground">{modelos.length ? "Nenhuma tarefa neste filtro." : "Nenhuma tarefa cadastrada. Comece pela planilha de POPs dos gerentes ou pela Estrutura de Processos."}</Card>
        : (
          <ul className="space-y-2">
            {visiveis.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                <div className="min-w-56 flex-1">
                  <p className="font-medium">{m.titulo} {!m.ativo && <Badge variant="outline" className="ml-1">Desativada</Badge>}</p>
                  <p className="text-xs text-muted-foreground">
                    {[rotuloPeriodicidade(m.periodicidade), m.area, m.setor, m.processo && `Processo: ${m.processo}`].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-1 text-sm">{[...m.cargos, ...m.pessoas].join(", ") || "Sem cargo"}</p>
                </div>
                <span className={m.com_login === 0 && m.ativo ? "text-sm font-semibold text-amber-800" : "text-sm text-muted-foreground"}>
                  {m.com_login} com login{m.sem_login > 0 ? ` · ${m.sem_login} sem login` : ""}
                </span>
                {podeAlterar && <Button size="sm" variant="ghost" aria-label={`Editar ${m.titulo}`} onClick={() => setEditando(m)}><Pencil className="h-4 w-4" /></Button>}
              </li>
            ))}
          </ul>
        )}
      {editando && <DialogModelo inicial={editando} onFechar={() => setEditando(null)} />}
      {importando && <DialogImportar onFechar={() => setImportando(false)} />}
    </div>
  );
}

function DialogModelo({ inicial, onFechar }: { inicial: Partial<ModeloTarefa>; onFechar: () => void }) {
  const salvar = useSalvarModelo();
  const { data: cargos = [] } = useCargosOrganograma(true);
  const [f, setF] = useState({
    titulo: inicial.titulo ?? "", descricao: inicial.descricao ?? "", area: inicial.area ?? "", setor: inicial.setor ?? "",
    periodicidade: (inicial.periodicidade ?? "diaria") as Periodicidade, dia_semana: String(inicial.dia_semana ?? "5"), dia_mes: String(inicial.dia_mes ?? ""),
    criticidade: inicial.criticidade ?? "", link: inicial.link ?? "", ativo: inicial.ativo ?? true,
  });
  const [selecionados, setSelecionados] = useState<string[]>(inicial.cargos ?? []);
  const [buscaCargo, setBuscaCargo] = useState("");
  const set = (c: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [c]: v }));
  const chave = (c: string) => c.trim().toUpperCase();
  const lista = useMemo(() => {
    const q = buscaCargo.trim().toLowerCase();
    return cargos.filter((c) => !q || c.cargo.toLowerCase().includes(q));
  }, [cargos, buscaCargo]);
  const alternar = (c: string) => setSelecionados((s) => (s.some((x) => chave(x) === chave(c)) ? s.filter((x) => chave(x) !== chave(c)) : [...s, c]));

  const gravar = () => salvar.mutateAsync({
    ...f, id: inicial.id, processo_id: inicial.processo_id, cargos: selecionados,
    dia_semana: f.periodicidade === "semanal" ? f.dia_semana : null, dia_mes: f.periodicidade === "mensal" ? f.dia_mes : null,
  }).then(() => { toast.success("Tarefa salva."); onFechar(); }, avisarErro);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{inicial.id ? "Editar tarefa" : "Nova tarefa"}</DialogTitle>
          <DialogDescription>Ao salvar, quem tem o cargo já recebe a tarefa, se o prazo do período ainda não passou.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="t-titulo">Atividade</Label><Input id="t-titulo" className="mt-1" value={f.titulo} onChange={(e) => set("titulo", e.target.value)} placeholder="Ex.: Aplicar feedback à equipe" /></div>
          <div><Label htmlFor="t-desc">Como fazer (POP)</Label><Textarea id="t-desc" className="mt-1" value={f.descricao} onChange={(e) => set("descricao", e.target.value)} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Periodicidade</Label>
              <Select value={f.periodicidade} onValueChange={(v) => set("periodicidade", v)}>
                <SelectTrigger className="mt-1" aria-label="Periodicidade"><SelectValue /></SelectTrigger>
                <SelectContent>{PERIODICIDADES.map((p) => <SelectItem key={p.valor} value={p.valor}>{p.rotulo}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                {f.periodicidade === "diaria" ? "Vence todo dia, de segunda a sexta." : f.periodicidade === "quinzenal" ? "Vence no dia 15 e no último dia do mês." : ""}
              </p>
            </div>
            {f.periodicidade === "semanal" && (
              <div>
                <Label>Vence na</Label>
                <Select value={f.dia_semana} onValueChange={(v) => set("dia_semana", v)}>
                  <SelectTrigger className="mt-1" aria-label="Dia da semana"><SelectValue /></SelectTrigger>
                  <SelectContent>{DIAS_SEMANA.map((d) => <SelectItem key={d.valor} value={String(d.valor)}>{d.rotulo}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {f.periodicidade === "mensal" && (
              <div>
                <Label htmlFor="t-dia">Vence no dia</Label>
                <Input id="t-dia" type="number" min={1} max={31} className="mt-1" value={f.dia_mes} placeholder="Vazio = último dia do mês" onChange={(e) => set("dia_mes", e.target.value)} />
              </div>
            )}
            <div><Label htmlFor="t-area">Área</Label><Input id="t-area" className="mt-1" value={f.area} onChange={(e) => set("area", e.target.value)} /></div>
            <div><Label htmlFor="t-setor">Setor</Label><Input id="t-setor" className="mt-1" value={f.setor} onChange={(e) => set("setor", e.target.value)} /></div>
            <div><Label htmlFor="t-crit">Criticidade</Label><Input id="t-crit" className="mt-1" value={f.criticidade} onChange={(e) => set("criticidade", e.target.value)} /></div>
            <div><Label htmlFor="t-link">Tela do ERP para fazer a tarefa</Label><Input id="t-link" className="mt-1" value={f.link} placeholder="/app/organograma" onChange={(e) => set("link", e.target.value)} /></div>
          </div>
          <div>
            <Label htmlFor="t-cargo">Cargos que fazem esta tarefa</Label>
            <Input id="t-cargo" className="mt-1" placeholder="Buscar cargo" value={buscaCargo} onChange={(e) => setBuscaCargo(e.target.value)} />
            {selecionados.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{selecionados.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}</div>}
            {!!inicial.pessoas?.length && <p className="mt-1 text-xs text-muted-foreground">Também vale para: {inicial.pessoas.join(", ")} (responsável na Estrutura de Processos).</p>}
            <ul className="mt-2 max-h-48 overflow-y-auto rounded-md border">
              {lista.map((c) => (
                <li key={c.cargo}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted">
                    <Checkbox checked={selecionados.some((x) => chave(x) === chave(c.cargo))} onCheckedChange={() => alternar(c.cargo)} />
                    <span className="flex-1">{c.cargo}</span>
                    <span className={c.com_login === 0 ? "text-xs font-semibold text-amber-800" : "text-xs text-muted-foreground"}>{c.com_login} de {c.pessoas} com login</span>
                  </label>
                </li>
              ))}
              {!lista.length && <li className="p-3 text-center text-sm text-muted-foreground">Nenhum cargo encontrado no organograma.</li>}
            </ul>
          </div>
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={f.ativo} onCheckedChange={(v) => set("ativo", v === true)} /> Ativa (desativar cancela as pendentes)</label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onFechar}>Voltar</Button>
            <Button disabled={salvar.isPending} onClick={gravar}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DialogImportar({ onFechar }: { onFechar: () => void }) {
  const importar = useImportarPops();
  const [leitura, setLeitura] = useState<LeituraPlanilha | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ler = async (arquivo?: File) => {
    if (!arquivo) return;
    try {
      const wb = XLSX.read(await arquivo.arrayBuffer());
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
      setLeitura(lerPlanilhaPops(rows));
    } catch { toast.error("Não consegui ler esta planilha."); }
  };
  const confirmar = () => importar.mutateAsync(leitura!.linhas).then(
    (r) => { toast.success(`${r.novos} tarefa(s) nova(s), ${r.atualizados} atualizada(s).`); onFechar(); }, avisarErro);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar planilha de POPs</DialogTitle>
          <DialogDescription>A mesma planilha do Gerador de POPs. O responsável vira o cargo; importar de novo atualiza, sem duplicar.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input ref={input} aria-label="Planilha de POPs" type="file" accept=".xlsx,.xls,.csv" onChange={(e) => ler(e.target.files?.[0])} />
          {leitura && (
            <>
              <p className="text-sm font-medium">{leitura.linhas.length} atividade(s) para importar.</p>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {leitura.linhas.map((l, i) => <li key={i}>{l.titulo} <span className="text-muted-foreground">· {rotuloPeriodicidade(l.periodicidade)} · {l.cargos.join(", ")}</span></li>)}
                {!leitura.linhas.length && <li className="text-muted-foreground">Nenhuma atividade válida nesta planilha.</li>}
              </ul>
              {leitura.ignoradas.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                  <p className="font-medium">{leitura.ignoradas.length} ficam de fora:</p>
                  <ul className="max-h-32 overflow-y-auto">{leitura.ignoradas.map((l, i) => <li key={i}>{l.atividade}: {l.motivo}</li>)}</ul>
                </div>
              )}
            </>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onFechar}>Voltar</Button>
            <Button disabled={!leitura?.linhas.length || importar.isPending} onClick={confirmar}>{importar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Importar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
