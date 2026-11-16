import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FileText, Loader2, Paperclip, Search, Trash2 } from "lucide-react";
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
import {
  abrirAsoRetorno, useAnexarAsoRetorno, useListaAsoRetorno, useRemoverAsoRetorno, useSalvarAsoRetorno, type DadosAsoRetorno,
} from "@/hooks/useAsoRetorno";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { fmtData, hojeIso } from "@/lib/sst/asoPeriodico";
import {
  DIAS_EXIGE_ASO, PAINEL_RETORNO, STATUS_RETORNO, contarPainelRetorno, contratoDoRetorno, ordenarRetorno, pendenciasDoRetorno,
  voltouSemAso, type ChavePainelRetorno, type ItemAsoRetorno, type StatusAsoRetorno,
} from "@/lib/sst/asoRetorno";
import { cn } from "@/lib/utils";

// =====================================================================
// SST › ASO DE RETORNO AO TRABALHO (SIS-2026-0852, mig 20261115210000)
//
// A fila do exame de retorno. NÃO há cadastro próprio: cada linha é um caso
// do Controle de Afastamentos, e o que se grava aqui são os campos de ASO
// daquele caso (solicitação, agendamento, clínica, realização, resultado e o
// arquivo). Entra na fila o caso com ASO ligado lá, e também o caso aberto
// com 30 dias ou mais de afastamento — esse aparece como "A solicitar".
// O status do afastamento segue a regra do banco: ASO pendente segura o caso
// em "Aguardando ASO de retorno"; apto libera o retorno; inapto mantém afastado.
// =====================================================================

const COR_STATUS: Record<StatusAsoRetorno, string> = {
  "A solicitar": "bg-red-600 text-white",
  "Aguardando agendamento": "bg-sky-600 text-white",
  Agendado: "bg-indigo-600 text-white",
  "Realizado/recebido": "bg-emerald-600 text-white",
};

export default function AsoRetorno() {
  const podeAlterar = useScreenAccess("sst_aso_retorno", "alterar").data === true;
  const veControle = useScreenAccess("sst_controle_afastamentos", "visualizar").data === true;
  const { data: itens = [], isLoading, error } = useListaAsoRetorno();
  const [cartao, setCartao] = useState<ChavePainelRetorno | null>(null);
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState("pendentes");
  const [contrato, setContrato] = useState("todos");
  const [aberto, setAberto] = useState<ItemAsoRetorno | null>(null);

  const painel = useMemo(() => contarPainelRetorno(itens), [itens]);
  const contratos = useMemo(() => [...new Set(itens.map(contratoDoRetorno))].sort(), [itens]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const doCartao = PAINEL_RETORNO.find((p) => p.chave === cartao)?.filtro;
    return itens
      .filter((i) => doCartao ? doCartao(i)
        : status === "todos" || (status === "pendentes" ? i.status !== "Realizado/recebido" : i.status === status))
      .filter((i) => contrato === "todos" || contratoDoRetorno(i) === contrato)
      .filter((i) => !q || [i.nome, contratoDoRetorno(i), i.funcao, i.motivo, i.aso_clinica].some((v) => String(v ?? "").toLowerCase().includes(q)))
      .sort(ordenarRetorno);
  }, [itens, cartao, busca, status, contrato]);

  return (
    <div className="space-y-4">
      <PageHeader title="ASO de Retorno ao Trabalho" module="SST" breadcrumb={["ASO de Retorno ao Trabalho"]}
        subtitle={`Exame de retorno de quem está afastado. Os casos vêm do Controle de Afastamentos: com ASO de retorno ligado lá ou com ${DIAS_EXIGE_ASO} dias ou mais de afastamento.`} />

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {PAINEL_RETORNO.map((p) => {
          const ativo = cartao === p.chave;
          return (
            <button key={p.chave} type="button" aria-pressed={ativo} onClick={() => setCartao(ativo ? null : p.chave)}
              className={cn("rounded-lg border bg-card p-3 text-left transition hover:border-primary", ativo && "border-primary ring-2 ring-primary/30",
                p.chave === "solicitar" && painel.solicitar > 0 && "border-red-300 bg-red-50")}>
              <span className="block text-2xl font-bold">{painel[p.chave]}</span>
              <span className="block text-xs text-muted-foreground">{p.titulo}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Colaborador, contrato, função, motivo ou clínica" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Filtro rotulo="Status" valor={status} aoMudar={(v) => { setStatus(v); setCartao(null); }} largura="w-56"
          opcoes={[["pendentes", "Pendentes"], ["todos", "Todos"], ...STATUS_RETORNO.map((s) => [s, s] as [string, string])]} />
        <Filtro rotulo="Contrato" valor={contrato} aoMudar={setContrato} largura="w-64" opcoes={[["todos", "Todos"], ...contratos.map((c) => [c, c] as [string, string])]} />
        {veControle && (
          <Button asChild variant="outline"><Link to="/app/sst/controle-afastamentos">Controle de Afastamentos</Link></Button>
        )}
      </div>

      <Card className="overflow-x-auto">
        <Table className="min-w-[1100px]">
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Contrato</TableHead>
              <TableHead>Afastamento</TableHead>
              <TableHead>Previsão de retorno</TableHead>
              <TableHead>Status do ASO</TableHead>
              <TableHead>Solicitação / agendamento</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" /></TableCell></TableRow>
            ) : error ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
            ) : visiveis.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Nenhum ASO de retorno neste filtro.</TableCell></TableRow>
            ) : visiveis.map((i) => <Linha key={i.id} i={i} podeAlterar={podeAlterar} onAbrir={() => setAberto(i)} />)}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">{visiveis.length} de {itens.length} caso(s) na fila do ASO de retorno.</p>

      {aberto && <AsoDialog item={aberto} podeAlterar={podeAlterar} onFechar={() => setAberto(null)} />}
    </div>
  );
}

function Linha({ i, podeAlterar, onAbrir }: { i: ItemAsoRetorno; podeAlterar: boolean; onAbrir: () => void }) {
  const feito = i.status === "Realizado/recebido";
  const acao = feito ? "Ver ASO" : i.status === "A solicitar" ? "Solicitar agendamento" : "Atualizar";
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{i.nome}</span>
        <span className="block text-xs text-muted-foreground">{i.funcao ?? "Sem função"}</span>
      </TableCell>
      <TableCell className="max-w-56">
        <span className="block truncate" title={contratoDoRetorno(i)}>{contratoDoRetorno(i)}</span>
      </TableCell>
      <TableCell>
        <span className="block">{i.motivo}</span>
        <span className="block whitespace-nowrap text-xs text-muted-foreground">
          desde {fmtData(i.data_inicio)}{i.dias_afastado != null ? ` · ${i.dias_afastado} dia(s)` : ""}
        </span>
        <span className="block text-xs text-muted-foreground">{i.status_afastamento}</span>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        {fmtData(i.data_retorno_real ?? i.data_prevista_retorno)}
        {i.data_retorno_real && <span className="block text-xs text-muted-foreground">retornou</span>}
        {voltouSemAso(i) && (
          <span className="block text-xs font-semibold text-red-700" title="A Senior já mostra a pessoa trabalhando e o ASO de retorno não foi concluído.">
            trabalhando na Senior
          </span>
        )}
      </TableCell>
      <TableCell>
        <Badge className={cn("whitespace-normal", COR_STATUS[i.status])}>{i.status}</Badge>
        {feito && i.aso_resultado === "inapto" && <Badge variant="destructive" className="ml-1">Inapto</Badge>}
        {!feito && i.exige_por_prazo && !i.aso_necessario && (
          <span className="block text-xs text-amber-700" title={`Caso aberto com ${DIAS_EXIGE_ASO} dias ou mais de afastamento.`}>{DIAS_EXIGE_ASO}+ dias</span>
        )}
      </TableCell>
      <TableCell className="text-sm">
        {feito ? (
          <span className="block">Realizado {fmtData(i.aso_recebido_em)}{i.aso_clinica ? ` · ${i.aso_clinica}` : ""}</span>
        ) : i.aso_solicitado_em || i.aso_agendado_em ? (
          <>
            {i.aso_solicitado_em && <span className="block">Solicitado {fmtData(i.aso_solicitado_em)}</span>}
            {i.aso_agendado_em && <span className="block">Agendado {fmtData(i.aso_agendado_em)}{i.aso_clinica ? ` · ${i.aso_clinica}` : ""}</span>}
          </>
        ) : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-right">
        <Button size="sm" variant={i.status === "A solicitar" && podeAlterar ? "default" : "outline"} onClick={onAbrir}>
          {podeAlterar ? acao : "Ver"}
        </Button>
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

function AsoDialog({ item, podeAlterar, onFechar }: { item: ItemAsoRetorno; podeAlterar: boolean; onFechar: () => void }) {
  const hoje = hojeIso();
  const encerrado = item.status_afastamento === "Afastamento encerrado";
  const so = !podeAlterar || encerrado;
  const [f, setF] = useState<DadosAsoRetorno>({
    id: item.id,
    // Caso que ainda não tem nada do ASO: a solicitação nasce com a data de hoje.
    aso_solicitado_em: item.aso_solicitado_em ?? (item.status === "A solicitar" && !so ? hoje : null),
    aso_agendado_em: item.aso_agendado_em, aso_clinica: item.aso_clinica, aso_realizado: item.aso_realizado,
    aso_recebido_em: item.aso_recebido_em, aso_resultado: item.aso_resultado,
  });
  const [arquivo, setArquivo] = useState<File | null>(null);
  const salvar = useSalvarAsoRetorno();
  const anexar = useAnexarAsoRetorno();
  const remover = useRemoverAsoRetorno();
  const muda = <K extends keyof DadosAsoRetorno>(k: K, v: DadosAsoRetorno[K]) => setF((x) => ({ ...x, [k]: v }));
  const ocupado = salvar.isPending || anexar.isPending;

  const enviar = async () => {
    const falta = pendenciasDoRetorno(f, hoje);
    if (falta.length) { toast.error(`Confira: ${falta.join(", ")}.`); return; }
    try {
      await salvar.mutateAsync(f);
      if (arquivo) await anexar.mutateAsync({ id: item.id, arquivo });
      toast.success(f.aso_realizado ? "ASO de retorno registrado como realizado/recebido." : "ASO de retorno salvo.");
      onFechar();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item.status === "Realizado/recebido" ? "ASO de retorno realizado" : item.status === "A solicitar" ? "Solicitar agendamento do ASO de retorno" : "Acompanhar ASO de retorno"}</DialogTitle>
          <DialogDescription>
            {item.nome} · {contratoDoRetorno(item)} · {item.motivo}, desde {fmtData(item.data_inicio)}
            {item.data_prevista_retorno ? ` · previsão de retorno ${fmtData(item.data_prevista_retorno)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {encerrado && <p className="rounded-md border p-2 text-sm text-muted-foreground">Afastamento encerrado: o ASO de retorno não pode mais ser alterado.</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="ar-sol" rotulo="Data da solicitação">
              <Input id="ar-sol" type="date" max={hoje} disabled={so} value={f.aso_solicitado_em ?? ""} onChange={(e) => muda("aso_solicitado_em", e.target.value || null)} />
            </Campo>
            <Campo id="ar-age" rotulo="Data do agendamento">
              <Input id="ar-age" type="date" disabled={so} value={f.aso_agendado_em ?? ""} onChange={(e) => muda("aso_agendado_em", e.target.value || null)} />
            </Campo>
          </div>
          <Campo id="ar-cli" rotulo="Clínica responsável">
            <Input id="ar-cli" disabled={so} placeholder="Ex.: Zielo" value={f.aso_clinica ?? ""} onChange={(e) => muda("aso_clinica", e.target.value || null)} />
          </Campo>

          <div className="space-y-3 rounded-md border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox disabled={so} checked={f.aso_realizado} onCheckedChange={(v) => muda("aso_realizado", v === true)} /> Realizado/recebido
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo id="ar-real" rotulo="Data da realização">
                <Input id="ar-real" type="date" max={hoje} disabled={so} value={f.aso_recebido_em ?? ""} onChange={(e) => muda("aso_recebido_em", e.target.value || null)} />
              </Campo>
              <Campo id="ar-res" rotulo="Resultado">
                <Select disabled={so} value={f.aso_resultado ?? ""} onValueChange={(v) => muda("aso_resultado", v === "apto" || v === "inapto" ? v : null)}>
                  <SelectTrigger id="ar-res" aria-label="Resultado"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent><SelectItem value="apto">Apto</SelectItem><SelectItem value="inapto">Inapto</SelectItem></SelectContent>
                </Select>
              </Campo>
            </div>
            {f.aso_realizado && f.aso_resultado === "apto" && <p className="text-xs text-muted-foreground">Apto: o caso passa para “Aguardando retorno” no Controle de Afastamentos.</p>}
            {f.aso_realizado && f.aso_resultado === "inapto" && <p className="text-xs font-medium text-red-700">Inapto: o colaborador segue afastado e não pode ser marcado como retornado. Avise o RH e o Operacional.</p>}
          </div>

          <Campo id="ar-aso" rotulo="ASO (arquivo)">
            {item.documentos.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                <button type="button" className="flex items-center gap-1 text-primary hover:underline" onClick={() => abrirAsoRetorno(d).catch((e) => toast.error((e as Error).message))}>
                  <FileText className="h-4 w-4" /> {d.nome}
                </button>
                {!so && (
                  <Button type="button" size="sm" variant="ghost" disabled={remover.isPending} aria-label="Remover ASO"
                    onClick={() => remover.mutateAsync(d).then(() => { toast.success("ASO removido."); onFechar(); }, (e) => toast.error((e as Error).message))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {!so && (
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <Input id="ar-aso" type="file" accept=".pdf,image/*" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
              </div>
            )}
            {item.documentos.length === 0 && so && <p className="text-sm text-muted-foreground">Sem ASO anexado.</p>}
          </Campo>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onFechar}>{so ? "Fechar" : "Cancelar"}</Button>
            {!so && (
              <Button onClick={enviar} disabled={ocupado}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}
