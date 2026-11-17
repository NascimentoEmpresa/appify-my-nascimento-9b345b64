import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, Loader2, Paperclip, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FichaExameToxicologicoDialog } from "@/components/sst/FichaExameToxicologico";
import { ImportarExamesToxicologicosDialog } from "@/components/sst/ImportarExamesToxicologicos";
import { SeloSituacao } from "@/components/sst/SeloSituacaoToxico";
import { buscarColaboradoresToxico, useListaToxico, useSalvarToxico, type ColaboradorToxico } from "@/hooks/useExamesToxicologicos";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  CATEGORIAS_CNH, INDICADORES, ROTULO_SITUACAO, SITUACOES, cnhExibida, cobradoNoCiclo, contaNoPainel, diasParaVencer, fmtData, hojeIso,
  prioridade, responsavelExibido, situacaoExame, type ChaveIndicador, type ItemToxico,
} from "@/lib/sst/exameToxicologico";
import { cn } from "@/lib/utils";

// =====================================================================
// SST › EXAMES TOXICOLÓGICOS (SIS-2026-0887, mig 20261117140000)
//
// Substitui a planilha semanal do SST. A lista vem pronta do banco: todo
// motorista/tratorista ativo na Senior, mais quem o SST incluiu à mão. A
// situação sai da validade (30 dias = próximo, 15 = alerta, vencido =
// pendência), os casos que pedem cobrança vêm primeiro e os indicadores
// seguem o filtro de contrato.
// =====================================================================

type Aberto = { t: number | null; e: number | null };

export default function ExamesToxicologicos() {
  const podeAlterar = useScreenAccess("sst_exames_toxicologicos", "alterar").data === true;
  const { data: itens = [], isLoading, error } = useListaToxico();
  const hoje = hojeIso();
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [importando, setImportando] = useState(false);
  const [incluindo, setIncluindo] = useState(false);
  const [indicador, setIndicador] = useState<ChaveIndicador | null>(null);
  const [busca, setBusca] = useState("");
  const [contrato, setContrato] = useState("todos");
  const [situacao, setSituacao] = useState("todas");
  const [responsavel, setResponsavel] = useState("todos");
  const [naoPrecisa, setNaoPrecisa] = useState(false);
  const [desligados, setDesligados] = useState(false);

  const contratos = useMemo(() => [...new Set(itens.map((i) => i.contrato_nome ?? "").filter(Boolean))].sort(), [itens]);
  const responsaveis = useMemo(() => [...new Set(itens.map((i) => responsavelExibido(i).nome ?? "").filter(Boolean))].sort(), [itens]);
  const doContrato = useMemo(() => itens.filter((i) => contrato === "todos" || i.contrato_nome === contrato), [itens, contrato]);
  const noPainel = useMemo(() => doContrato.filter(contaNoPainel), [doContrato]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const ind = INDICADORES.find((i) => i.chave === indicador);
    return doContrato
      .filter((i) => (ind ? contaNoPainel(i) && ind.filtro(i, hoje) : (naoPrecisa || i.precisa_exame) && (desligados || !i.desligado)))
      .filter((i) => situacao === "todas" || situacaoExame(i, hoje) === situacao)
      .filter((i) => responsavel === "todos" || responsavelExibido(i).nome === responsavel)
      .filter((i) => !q || [i.nome, i.contrato_nome, i.local_trabalho, i.cargo, i.responsavel].some((v) => String(v ?? "").toLowerCase().includes(q)))
      .sort((a, b) => prioridade(a, hoje) - prioridade(b, hoje) || a.nome.localeCompare(b.nome));
  }, [doContrato, hoje, indicador, busca, situacao, responsavel, naoPrecisa, desligados]);

  // O registro nasce na primeira gravação: a ficha segue a pessoa pelo id ou pelo colaborador.
  const itemAberto = aberto
    ? itens.find((i) => (aberto.t != null && i.toxicologico_id === aberto.t) || (aberto.e != null && i.empregado_id === aberto.e)) ?? null
    : null;
  const abrir = (i: Pick<ItemToxico, "toxicologico_id" | "empregado_id">) => setAberto({ t: i.toxicologico_id, e: i.empregado_id });

  return (
    <div className="space-y-4">
      <PageHeader title="Exames Toxicológicos" module="SST" breadcrumb={["Exames Toxicológicos"]}
        subtitle="Validade do exame de cada motorista, por contrato: quem vence, quem venceu e a cobrança ao encarregado."
        actions={podeAlterar && (
          <>
            <Button variant="outline" onClick={() => setImportando(true)}><FileSpreadsheet className="mr-2 h-4 w-4" /> Importar planilha</Button>
            <Button onClick={() => setIncluindo(true)}><Plus className="mr-2 h-4 w-4" /> Incluir colaborador</Button>
          </>
        )} />

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {INDICADORES.map((ind) => {
          const n = noPainel.filter((i) => ind.filtro(i, hoje)).length;
          const ativo = indicador === ind.chave;
          return (
            <button key={ind.chave} type="button" aria-pressed={ativo} onClick={() => setIndicador(ativo || ind.chave === "total" ? null : ind.chave)}
              className={cn("rounded-lg border bg-card p-3 text-left transition hover:border-primary", ativo && "border-primary ring-2 ring-primary/30",
                ind.chave === "vencido" && n > 0 && "border-red-300 bg-red-50", ind.chave === "proximo" && n > 0 && "border-amber-300 bg-amber-50")}>
              <span className="block text-2xl font-bold">{n}</span>
              <span className="block text-xs text-muted-foreground">{ind.titulo}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Colaborador, contrato, local ou função" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Filtro rotulo="Contrato" valor={contrato} aoMudar={setContrato} largura="w-64" opcoes={[["todos", "Todos"], ...contratos.map((c) => [c, c] as [string, string])]} />
        <Filtro rotulo="Situação" valor={situacao} aoMudar={setSituacao} largura="w-52" opcoes={[["todas", "Todas"], ...SITUACOES.map((s) => [s, ROTULO_SITUACAO[s]] as [string, string])]} />
        <Filtro rotulo="Responsável" valor={responsavel} aoMudar={setResponsavel} largura="w-56" opcoes={[["todos", "Todos"], ...responsaveis.map((r) => [r, r] as [string, string])]} />
        <label className="flex h-10 items-center gap-2 text-sm"><Checkbox checked={naoPrecisa} onCheckedChange={(v) => setNaoPrecisa(v === true)} /> Mostrar quem não precisa (CNH A/B)</label>
        <label className="flex h-10 items-center gap-2 text-sm"><Checkbox checked={desligados} onCheckedChange={(v) => setDesligados(v === true)} /> Mostrar desligados</label>
      </div>

      <Card className="overflow-x-auto">
        <Table className="min-w-[1200px]">
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>CNH</TableHead>
              <TableHead>Último exame</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Responsável</TableHead>
              <TableHead>Última cobrança</TableHead>
              <TableHead>Último contato</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">Nenhum colaborador neste filtro.</TableCell></TableRow>
            ) : visiveis.map((i) => <Linha key={`${i.toxicologico_id}-${i.empregado_id}`} i={i} hoje={hoje} onAbrir={() => abrir(i)} />)}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">{visiveis.length} de {itens.length} colaborador(es).</p>

      {itemAberto && <FichaExameToxicologicoDialog item={itemAberto} podeAlterar={podeAlterar} onFechar={() => setAberto(null)} />}
      {importando && <ImportarExamesToxicologicosDialog onFechar={() => setImportando(false)} />}
      {incluindo && (
        <IncluirColaborador onFechar={() => setIncluindo(false)}
          onAbrir={(empregadoId) => { setIncluindo(false); setAberto({ t: null, e: empregadoId }); }} />
      )}
    </div>
  );
}

function Linha({ i, hoje, onAbrir }: { i: ItemToxico; hoje: string; onAbrir: () => void }) {
  const s = situacaoExame(i, hoje);
  const dias = diasParaVencer(i, hoje);
  const cnh = cnhExibida(i);
  const resp = responsavelExibido(i);
  const conta = contaNoPainel(i);
  return (
    <TableRow className={cn("cursor-pointer", conta && s === "vencido" && "bg-red-50/70", !conta && "text-muted-foreground")} onClick={onAbrir}>
      <TableCell>
        <button type="button" className="text-left font-medium text-primary underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); onAbrir(); }}>{i.nome}</button>
        <div className="mt-1 flex flex-wrap gap-1">
          {i.desligado && <Badge variant="outline">Desligado</Badge>}
          {!i.desligado && i.situacao_senior && i.situacao_senior !== "Trabalhando" && <Badge variant="outline">{i.situacao_senior}</Badge>}
          {!i.precisa_exame && <Badge variant="outline">Não precisa</Badge>}
          {conta && s !== "em_dia" && cobradoNoCiclo(i) && (
            <Badge variant="outline" className="border-sky-400 text-sky-800">Cobrado em {fmtData(i.ultima_cobranca_em)}</Badge>
          )}
          {i.documentos > 0 && <Badge variant="outline" title="Laudo anexado"><Paperclip className="mr-1 h-3 w-3" />{i.documentos}</Badge>}
        </div>
      </TableCell>
      <TableCell className="max-w-56">
        <span className="block truncate" title={i.contrato_nome ?? undefined}>{i.contrato_nome ?? "—"}</span>
        {i.local_trabalho && <span className="block truncate text-xs text-muted-foreground" title={i.local_trabalho}>{i.local_trabalho}</span>}
      </TableCell>
      <TableCell>{i.cargo ?? "—"}</TableCell>
      <TableCell title={cnh.doCargo ? "Pelo título do cargo; não informada" : undefined}>
        {cnh.cnh ?? "—"}{cnh.doCargo && <span className="text-xs text-muted-foreground"> (cargo)</span>}
      </TableCell>
      <TableCell className="whitespace-nowrap">{fmtData(i.data_ultimo_exame)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {fmtData(i.data_validade)}
        {dias != null && conta && s !== "em_dia" && (
          <span className={cn("block text-xs", dias < 0 ? "font-semibold text-red-700" : "text-muted-foreground")}>
            {dias < 0 ? `vencido há ${-dias} dia(s)` : dias === 0 ? "vence hoje" : `faltam ${dias} dia(s)`}
          </span>
        )}
      </TableCell>
      <TableCell>{conta ? <SeloSituacao item={i} hoje={hoje} /> : "—"}</TableCell>
      <TableCell className={cn("max-w-48 truncate", resp.doOrganograma && "italic text-muted-foreground")}
        title={resp.doOrganograma ? "Superior no Organograma (responsável não informado)" : resp.nome ?? undefined}>{resp.nome ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap">{fmtData(i.ultima_cobranca_em)}</TableCell>
      <TableCell className="max-w-48" title={i.ultimo_contato_obs ?? undefined}>
        <span className="whitespace-nowrap">{fmtData(i.ultimo_contato_em)}</span>
        {i.ultimo_contato_obs && <span className="block truncate text-xs text-muted-foreground">{i.ultimo_contato_obs}</span>}
      </TableCell>
    </TableRow>
  );
}

function Filtro({ rotulo, valor, aoMudar, opcoes, largura }: { rotulo: string; valor: string; aoMudar: (v: string) => void; opcoes: [string, string][]; largura: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{rotulo}</Label>
      <Select value={valor} onValueChange={aoMudar}>
        <SelectTrigger className={largura} aria-label={rotulo}><SelectValue /></SelectTrigger>
        <SelectContent>{opcoes.map(([v, r]) => <SelectItem key={v} value={v}>{r}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

const SEM_CNH = "sem";

/** Quem dirige sem ter cargo de motorista na Senior. Quem já está na lista abre a ficha. */
function IncluirColaborador({ onFechar, onAbrir }: { onFechar: () => void; onAbrir: (empregadoId: number) => void }) {
  const salvar = useSalvarToxico();
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<ColaboradorToxico[]>([]);
  const [colab, setColab] = useState<ColaboradorToxico | null>(null);
  const [cnh, setCnh] = useState(SEM_CNH);
  const [local, setLocal] = useState("");
  const [resp, setResp] = useState("");

  useEffect(() => {
    if (colab || busca.trim().length < 3) { setLista([]); return; }
    let vivo = true;
    const t = setTimeout(() => {
      buscarColaboradoresToxico(busca).then((r) => { if (vivo) setLista(r); }, (e) => toast.error((e as Error).message));
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, colab]);

  const incluir = () => {
    if (!colab) { toast.error("Escolha o colaborador na lista."); return; }
    salvar.mutateAsync({ empregado_id: colab.id, categoria_cnh: cnh === SEM_CNH ? "" : cnh, local_trabalho: local, responsavel: resp })
      .then(() => { toast.success(`${colab.nome} incluído no controle.`); onAbrir(colab.id); }, (e) => toast.error((e as Error).message));
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Incluir colaborador</DialogTitle>
          <DialogDescription>Motoristas e tratoristas ativos na Senior já aparecem sozinhos. Use para quem dirige com outro cargo.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="tox-colab">Colaborador</Label>
            {colab ? (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>{colab.nome} · {colab.cargo ?? "Sem função"} · {colab.filial ?? "Sem filial"}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setColab(null); setBusca(""); }}>Trocar</Button>
              </div>
            ) : (
              <>
                <Input id="tox-colab" className="mt-1" placeholder="Nome ou CPF (mín. 3 letras)" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {lista.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border">
                    {lista.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => (c.no_controle ? onAbrir(c.id) : setColab(c))}>
                          <span className="font-medium">{c.nome}</span>
                          <span className="block text-xs text-muted-foreground">
                            {c.no_controle ? "Já está no controle: abrir a ficha" : `${c.situacao ?? "—"} · ${c.cargo ?? "Sem função"} · ${c.filial ?? "Sem filial"}`}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div>
            <Label>Categoria da CNH</Label>
            <Select value={cnh} onValueChange={setCnh}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_CNH}>Não informada</SelectItem>
                {CATEGORIAS_CNH.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label htmlFor="tox-inc-local">Local de trabalho</Label><Input id="tox-inc-local" className="mt-1" value={local} onChange={(e) => setLocal(e.target.value)} /></div>
          <div><Label htmlFor="tox-inc-resp">Responsável pela atualização</Label><Input id="tox-inc-resp" className="mt-1" value={resp} onChange={(e) => setResp(e.target.value)} placeholder="Vazio: superior no Organograma" /></div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onFechar}>Voltar</Button>
            <Button onClick={incluir} disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Incluir</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
