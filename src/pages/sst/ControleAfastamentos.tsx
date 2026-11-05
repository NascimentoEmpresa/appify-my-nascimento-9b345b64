import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FichaControleDialog } from "@/components/sst/FichaControleAfastamento";
import {
  buscarColaboradoresControle, useCapturarControle, useListaControle, useSalvarControle, type ColaboradorControle,
} from "@/hooks/useControleAfastamentos";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  COMUNICACOES, INDICADORES, MOTIVOS, ROTULO_ALERTA, STATUS, alertaRetorno, dataDoRetorno, diasAfastados, estaAberto, fmtData, hojeIso,
  pendenciasDocumentais, possivelLimbo, prioridade, semContatoRecente, SEM_CONTATO_DIAS, statusDoMotivo,
  type ChaveIndicador, type ControleItem,
} from "@/lib/sst/controleAfastamentos";
import { cn } from "@/lib/utils";

// =====================================================================
// SST › CONTROLE DE AFASTAMENTOS (mig 20261105030000)
//
// O acompanhamento de cada afastamento até o retorno: contato, Comunicação de
// Benefício, recursos, ASO de retorno, documentos e possível limbo. Os casos
// que pedem atenção vêm primeiro, e cada indicador do painel filtra a lista.
// O atestado e o impacto financeiro continuam em Afastamentos e Telemedicina.
// =====================================================================

const COR_ALERTA = { atingida: "bg-red-600 text-white", "3d": "bg-orange-500 text-white", "7d": "bg-amber-400 text-amber-950" } as const;

export default function ControleAfastamentos() {
  const podeAlterar = useScreenAccess("sst_controle_afastamentos", "alterar").data === true;
  const { data: itens = [], isLoading, error } = useListaControle();
  const capturar = useCapturarControle();
  const hoje = hojeIso();
  const [params, setParams] = useSearchParams();
  const [aberto, setAberto] = useState<number | null>(null);
  const [novo, setNovo] = useState(false);
  const [indicador, setIndicador] = useState<ChaveIndicador | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("todos");
  const [contrato, setContrato] = useState("todos");
  const [comunicacao, setComunicacao] = useState("todas");
  const [semContato, setSemContato] = useState(false);
  const [encerrados, setEncerrados] = useState(false);

  // Link direto: ?a=<id> abre a ficha.
  useEffect(() => {
    const id = Number(params.get("a") ?? "");
    if (!id) return;
    setAberto(id);
    const p = new URLSearchParams(params); p.delete("a"); setParams(p, { replace: true });
  }, [params, setParams]);

  const contratos = useMemo(() => [...new Set(itens.map(nomeContrato).filter(Boolean))].sort() as string[], [itens]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const ind = INDICADORES.find((i) => i.chave === indicador);
    return itens
      .filter((a) => (ind ? ind.filtro(a, hoje) : encerrados || estaAberto(a) || status !== "todos"))
      .filter((a) => status === "todos" || a.status === status)
      .filter((a) => contrato === "todos" || nomeContrato(a) === contrato)
      .filter((a) => comunicacao === "todas" || a.comunicacao_beneficio === comunicacao)
      .filter((a) => !semContato || semContatoRecente(a, hoje))
      .filter((a) => !q || [a.nome, nomeContrato(a), a.funcao, a.motivo].some((v) => String(v ?? "").toLowerCase().includes(q)))
      .sort((a, b) => prioridade(a, hoje) - prioridade(b, hoje) || a.nome.localeCompare(b.nome));
  }, [itens, hoje, indicador, busca, status, contrato, comunicacao, semContato, encerrados]);

  const trazerDaSenior = () => capturar.mutateAsync().then(
    (r) => toast.success(`${r.novos} afastamento(s) novo(s) da Senior${r.encerrados ? `, ${r.encerrados} encerrado(s) por desligamento` : ""}.`),
    (e) => toast.error((e as Error).message),
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Controle de Afastamentos" module="SST" breadcrumb={["Controle de Afastamentos"]}
        subtitle="Acompanhamento até o retorno: contato, benefício, recursos, ASO e documentos." />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {INDICADORES.map((i) => {
          const n = itens.filter((a) => i.filtro(a, hoje)).length;
          const ativo = indicador === i.chave;
          return (
            <button key={i.chave} type="button" aria-pressed={ativo} onClick={() => setIndicador(ativo ? null : i.chave)}
              className={cn("rounded-lg border bg-card p-3 text-left transition hover:border-primary", ativo && "border-primary ring-2 ring-primary/30",
                i.chave === "limbo" && n > 0 && "border-red-300 bg-red-50")}>
              <span className="block text-2xl font-bold">{n}</span>
              <span className="block text-xs text-muted-foreground">{i.titulo}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Colaborador, contrato, função ou motivo" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Filtro rotulo="Status" valor={status} aoMudar={setStatus} largura="w-52" opcoes={[["todos", "Todos"], ...STATUS.map((s) => [s, s] as [string, string])]} />
        <Filtro rotulo="Contrato" valor={contrato} aoMudar={setContrato} largura="w-56" opcoes={[["todos", "Todos"], ...contratos.map((c) => [c, c] as [string, string])]} />
        <Filtro rotulo="Comunicação de Benefício" valor={comunicacao} aoMudar={setComunicacao} largura="w-48" opcoes={[["todas", "Todas"], ...COMUNICACOES.map((c) => [c, c] as [string, string])]} />
        <label className="flex h-10 items-center gap-2 text-sm"><Checkbox checked={semContato} onCheckedChange={(v) => setSemContato(v === true)} /> Sem contato há +{SEM_CONTATO_DIAS} dias</label>
        <label className="flex h-10 items-center gap-2 text-sm"><Checkbox checked={encerrados} onCheckedChange={(v) => setEncerrados(v === true)} /> Mostrar encerrados</label>
        {podeAlterar && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" disabled={capturar.isPending} onClick={trazerDaSenior}>
              {capturar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Trazer da Senior
            </Button>
            <Button onClick={() => setNovo(true)}><Plus className="mr-2 h-4 w-4" /> Novo afastamento</Button>
          </div>
        )}
      </div>

      <Card className="overflow-x-auto">
        <Table className="min-w-[1200px]">
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead>Início</TableHead>
              <TableHead>Previsão de retorno</TableHead>
              <TableHead className="text-right">Dias</TableHead>
              <TableHead>Situação atual</TableHead>
              <TableHead>Último contato</TableHead>
              <TableHead>Comunicação de Benefício</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">Nenhum afastamento neste filtro.</TableCell></TableRow>
            ) : visiveis.map((a) => <Linha key={a.id} a={a} hoje={hoje} onAbrir={() => setAberto(a.id)} />)}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">{visiveis.length} de {itens.length} afastamento(s).</p>

      {aberto != null && <FichaControleDialog id={aberto} podeAlterar={podeAlterar} onFechar={() => setAberto(null)} />}
      {novo && <NovoAfastamento onFechar={() => setNovo(false)} onCriado={(id) => { setNovo(false); setAberto(id); }} />}
    </div>
  );
}

const nomeContrato = (a: ControleItem) => a.contrato_nome ?? a.filial_nome ?? "";

function Linha({ a, hoje, onAbrir }: { a: ControleItem; hoje: string; onAbrir: () => void }) {
  const alerta = alertaRetorno(a, hoje);
  const limbo = possivelLimbo(a, hoje);
  const pendencias = pendenciasDocumentais(a);
  const semContato = semContatoRecente(a, hoje);
  const retorno = dataDoRetorno(a);
  return (
    <TableRow className={cn("cursor-pointer", limbo && "bg-red-50/70")} onClick={onAbrir}>
      <TableCell>
        <button type="button" className="text-left font-medium text-primary underline-offset-2 hover:underline" onClick={(e) => { e.stopPropagation(); onAbrir(); }}>{a.nome}</button>
        <div className="mt-1 flex flex-wrap gap-1">
          {limbo && <Badge title={limbo} className="bg-red-600"><AlertTriangle className="mr-1 h-3 w-3" /> Possível limbo</Badge>}
          {a.aposentado_afastado && <Badge variant="outline">Aposentado afastado</Badge>}
          {a.aposentado_no_vinculo && <Badge variant="outline">Aposentou no vínculo</Badge>}
          {a.recursos.some((r) => r.instancia === "inss" && r.situacao !== "encerrado") && <Badge variant="outline">Recurso INSS</Badge>}
          {a.recursos.some((r) => r.instancia === "judicial" && r.situacao !== "encerrado") && <Badge variant="outline">Recurso judicial</Badge>}
          {pendencias.length > 0 && <Badge variant="outline" title={pendencias.join("; ")} className="border-amber-400 text-amber-800">{pendencias.length} doc. pendente(s)</Badge>}
        </div>
      </TableCell>
      <TableCell className="max-w-48 truncate" title={nomeContrato(a)}>{nomeContrato(a) || "—"}</TableCell>
      <TableCell>{a.funcao ?? "—"}</TableCell>
      <TableCell>{a.motivo}</TableCell>
      <TableCell className="whitespace-nowrap">{fmtData(a.data_inicio)}</TableCell>
      <TableCell className="whitespace-nowrap">
        {fmtData(retorno)}{!a.data_prevista_retorno && retorno && <span className="block text-xs text-muted-foreground">informada no contato</span>}
        {alerta && <Badge className={cn("mt-1 block w-fit", COR_ALERTA[alerta])}>{ROTULO_ALERTA[alerta]}</Badge>}
      </TableCell>
      <TableCell className="text-right">{diasAfastados(a, hoje)}</TableCell>
      <TableCell><Badge variant="outline" className="whitespace-normal">{a.status}</Badge></TableCell>
      <TableCell className={cn("whitespace-nowrap", semContato && "font-semibold text-red-700")} title={a.ultimo_contato_obs ?? undefined}>
        {a.ultimo_contato_em ? fmtData(a.ultimo_contato_em) : "Sem contato"}
      </TableCell>
      <TableCell className={cn(a.comunicacao_beneficio === "Aguardando" && estaAberto(a) && "font-semibold text-amber-800")}>{a.comunicacao_beneficio}</TableCell>
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

function NovoAfastamento({ onFechar, onCriado }: { onFechar: () => void; onCriado: (id: number) => void }) {
  const salvar = useSalvarControle();
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<ColaboradorControle[]>([]);
  const [colab, setColab] = useState<ColaboradorControle | null>(null);
  const [motivo, setMotivo] = useState("");
  const [inicio, setInicio] = useState("");
  const [previsao, setPrevisao] = useState("");

  useEffect(() => {
    if (colab || busca.trim().length < 3) { setLista([]); return; }
    let vivo = true;
    const t = setTimeout(() => {
      buscarColaboradoresControle(busca).then((r) => { if (vivo) setLista(r); }, (e) => toast.error((e as Error).message));
    }, 300);
    return () => { vivo = false; clearTimeout(t); };
  }, [busca, colab]);

  const criar = () => {
    if (!colab) { toast.error("Escolha o colaborador na lista."); return; }
    if (!motivo) { toast.error("Informe o motivo do afastamento."); return; }
    if (!inicio) { toast.error("Informe a data de início."); return; }
    salvar.mutateAsync({ empregado_id: colab.id, motivo, data_inicio: inicio, data_prevista_retorno: previsao, status: statusDoMotivo(motivo) })
      .then(onCriado, (e) => toast.error((e as Error).message));
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Novo afastamento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="novo-colab">Colaborador</Label>
            {colab ? (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <span>{colab.nome} · {colab.cargo ?? "Sem função"} · {colab.filial ?? "Sem filial"}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => { setColab(null); setBusca(""); }}>Trocar</Button>
              </div>
            ) : (
              <>
                <Input id="novo-colab" className="mt-1" placeholder="Nome ou CPF (mín. 3 letras)" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {lista.length > 0 && (
                  <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border">
                    {lista.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setColab(c)}>
                          <span className="font-medium">{c.nome}</span>
                          <span className="block text-xs text-muted-foreground">{c.situacao ?? "—"} · {c.cargo ?? "Sem função"} · {c.filial ?? "Sem filial"}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
          <div>
            <Label>Motivo do afastamento</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{MOTIVOS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="novo-inicio">Data de início</Label><Input id="novo-inicio" type="date" className="mt-1" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
            <div><Label htmlFor="novo-prev">Data prevista de retorno</Label><Input id="novo-prev" type="date" className="mt-1" value={previsao} onChange={(e) => setPrevisao(e.target.value)} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onFechar}>Voltar</Button>
            <Button onClick={criar} disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registrar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
