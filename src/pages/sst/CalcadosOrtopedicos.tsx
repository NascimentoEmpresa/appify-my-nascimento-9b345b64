import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, FileText, Loader2, Search } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { abrirLaudo, ACCEPT_LAUDO, MENU_CALCADOS, useAnexarLaudoCalcado, useCalcadosOrtopedicos,
  useHistoricoCalcado, useSalvarCalcado } from "@/hooks/useCalcadosOrtopedicos";
import { contarPorStatus, dataBr, diasSemMovimentacao, DIAS_PARADO, ESTILO_STATUS_CALCADO, estaParado,
  exigeLaudo, FILTROS_CALCADO, filtrarCalcados, STATUS_CALCADO, type CalcadoOrtopedico,
  type FiltrosCalcado, type StatusCalcado } from "@/lib/sst/calcadosOrtopedicos";
import { cn } from "@/lib/utils";

// SIS-2026-0888: o pedido nasce em Solicitar Materiais (encarregado) e é
// atendido em Pedidos de Materiais (Compras). Esta tela é o acompanhamento do
// SST: status próprio, laudo e "há quantos dias ninguém mexe".
const avisar = (e: unknown) => toast.error((e as Error).message);
const CARTOES: StatusCalcado[] = ["solicitado", "em_analise", "em_compra", "enviado", "entregue"];

export default function CalcadosOrtopedicos() {
  const { data: lista = [], isLoading, error } = useCalcadosOrtopedicos();
  const podeAlterar = useScreenAccess(MENU_CALCADOS, "alterar").data === true;
  const [params, setParams] = useSearchParams();
  const [filtros, setFiltros] = useState<FiltrosCalcado>(FILTROS_CALCADO);
  const alterarFiltro = <K extends keyof FiltrosCalcado>(campo: K, valor: FiltrosCalcado[K]) =>
    setFiltros((f) => ({ ...f, [campo]: valor }));
  const visiveis = useMemo(() => filtrarCalcados(lista, filtros), [lista, filtros]);
  const contagem = useMemo(() => contarPorStatus(lista), [lista]);
  const parados = useMemo(() => lista.filter((c) => estaParado(c)).length, [lista]);
  const semLaudo = useMemo(() => lista.filter((c) => !c.laudo_path && c.status !== "cancelado").length, [lista]);
  const contratos = useMemo(() => [...new Set(lista.map((c) => c.contrato_nome).filter(Boolean) as string[])].sort(), [lista]);
  const id = Number(params.get("id")) || null;
  const aberto = id == null ? null : lista.find((c) => c.id === id) ?? null;
  const fechar = () => setParams((p) => { const n = new URLSearchParams(p); n.delete("id"); return n; }, { replace: true });

  return <div className="space-y-4">
    <PageHeader title="Calçados Ortopédicos" module="SST" breadcrumb={["Calçados Ortopédicos"]}
      subtitle="Pedidos de calçado ortopédico feitos pelos encarregados: laudo, andamento no Compras e entrega." />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
      {CARTOES.map((s) => <CartaoContagem key={s} titulo={STATUS_CALCADO[s]} valor={contagem[s]}
        ativo={filtros.status === s} onClick={() => alterarFiltro("status", filtros.status === s ? "abertos" : s)} />)}
      <CartaoContagem titulo={`Parados há ${DIAS_PARADO}+ dias`} valor={parados} alerta={parados > 0}
        ativo={filtros.parados} onClick={() => alterarFiltro("parados", !filtros.parados)} />
      <CartaoContagem titulo="Laudo pendente" valor={semLaudo} alerta={semLaudo > 0}
        ativo={filtros.laudo === "sem"} onClick={() => alterarFiltro("laudo", filtros.laudo === "sem" ? "todos" : "sem")} />
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <CampoFiltro titulo="Buscar"><div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="w-64 pl-8" placeholder="Colaborador, encarregado ou pedido" aria-label="Buscar"
          value={filtros.busca} onChange={(e) => alterarFiltro("busca", e.target.value)} /></div></CampoFiltro>
      <CampoFiltro titulo="Contrato">
        <Select value={filtros.contrato} onValueChange={(v) => alterarFiltro("contrato", v)}><SelectTrigger className="w-56" aria-label="Contrato"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos</SelectItem>{contratos.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
      </CampoFiltro>
      <CampoFiltro titulo="Status"><Select value={filtros.status} onValueChange={(v) => alterarFiltro("status", v as FiltrosCalcado["status"])}>
        <SelectTrigger className="w-44" aria-label="Status"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="abertos">Em aberto</SelectItem><SelectItem value="todos">Todos</SelectItem>
          {Object.entries(STATUS_CALCADO).map(([valor, rotulo]) => <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>)}
        </SelectContent></Select></CampoFiltro>
      <CampoFiltro titulo="Laudo"><Select value={filtros.laudo} onValueChange={(v) => alterarFiltro("laudo", v as FiltrosCalcado["laudo"])}>
        <SelectTrigger className="w-36" aria-label="Laudo"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="todos">Todos</SelectItem><SelectItem value="com">Anexado</SelectItem><SelectItem value="sem">Pendente</SelectItem>
        </SelectContent></Select></CampoFiltro>
      <label className="flex h-10 items-center gap-2 text-sm"><Checkbox checked={filtros.parados}
        onCheckedChange={(v) => alterarFiltro("parados", !!v)} /> Só parados há {DIAS_PARADO}+ dias</label>
      {JSON.stringify(filtros) !== JSON.stringify(FILTROS_CALCADO) && <Button variant="ghost" onClick={() => setFiltros(FILTROS_CALCADO)}>Limpar filtros</Button>}
    </div>
    <Card className="overflow-x-auto"><Table className="min-w-[1150px]"><TableHeader><TableRow>
      <TableHead>Solicitação</TableHead><TableHead>Colaborador</TableHead><TableHead>Contrato</TableHead><TableHead>Encarregado</TableHead>
      <TableHead>Calçado</TableHead><TableHead>Nº</TableHead><TableHead>Pedido</TableHead><TableHead>Status</TableHead>
      <TableHead>Laudo</TableHead><TableHead>Última atualização</TableHead>
    </TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={10} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
        : error ? <TableRow><TableCell colSpan={10} className="py-10 text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
        : visiveis.length === 0 ? <TableRow><TableCell colSpan={10} className="py-10 text-center text-muted-foreground">{lista.length ? "Nenhum pedido neste filtro." : "Nenhum pedido de calçado ortopédico."}</TableCell></TableRow>
        : visiveis.map((c) => {
          const dias = diasSemMovimentacao(c.updated_at);
          const parado = estaParado(c);
          return <TableRow key={c.id} className={cn("cursor-pointer", parado && "bg-amber-50/70 dark:bg-amber-950/20")} onClick={() => setParams({ id: String(c.id) })}>
            <TableCell>{dataBr(c.data_solicitacao)}</TableCell>
            <TableCell className="font-medium">
              <button type="button" className="text-left text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setParams({ id: String(c.id) }); }}>{c.colaborador_nome ?? "—"}</button>
            </TableCell>
            <TableCell>{c.contrato_nome ?? "—"}</TableCell><TableCell>{c.encarregado_nome ?? "—"}</TableCell>
            <TableCell>{c.item_nome}</TableCell><TableCell>{c.tamanho ?? "—"}</TableCell>
            <TableCell><span className="font-mono text-xs">{c.pedido_codigo ?? "—"}</span>
              {c.pedido_status && <p className="text-[11px] text-muted-foreground">{c.pedido_status}</p>}</TableCell>
            <TableCell><Badge variant="outline" className={ESTILO_STATUS_CALCADO[c.status]}>{STATUS_CALCADO[c.status]}</Badge></TableCell>
            <TableCell>{c.laudo_path
              ? <FileText className="h-4 w-4" aria-label="Laudo anexado" />
              : c.status !== "cancelado" && <span className="text-xs font-medium text-destructive">Pendente</span>}</TableCell>
            <TableCell><span className={cn(parado && "font-medium text-amber-700 dark:text-amber-300")}>
              {parado && <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />}
              {dias === 0 ? "Hoje" : `Há ${dias} dia(s)`}</span>
              <p className="text-[11px] text-muted-foreground">{dataBr(c.updated_at)}</p></TableCell>
          </TableRow>;
        })}
    </TableBody></Table></Card>
    <p className="text-xs text-muted-foreground">{visiveis.length} de {lista.length} pedido(s). O status anda sozinho quando o Compras
      aguarda compra, despacha ou recebe a comprovação de entrega; "Em análise" e "Finalizado" são do SST.</p>
    {aberto && <FichaCalcado key={aberto.id} calcado={aberto} podeAlterar={podeAlterar} onFechar={fechar} />}
  </div>;
}

function CartaoContagem({ titulo, valor, ativo, alerta, onClick }: { titulo: string; valor: number; ativo: boolean; alerta?: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={cn("rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted",
    ativo && "border-primary ring-1 ring-primary", alerta && "border-amber-300")}>
    <p className="text-xs text-muted-foreground">{titulo}</p>
    <p className={cn("text-2xl font-semibold", alerta && "text-amber-700 dark:text-amber-300")}>{valor}</p>
  </button>;
}

function CampoFiltro({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{titulo}</Label>{children}</div>;
}

function FichaCalcado({ calcado: c, podeAlterar, onFechar }: { calcado: CalcadoOrtopedico; podeAlterar: boolean; onFechar: () => void }) {
  const { data: historico = [] } = useHistoricoCalcado(c.id);
  const salvar = useSalvarCalcado();
  const anexar = useAnexarLaudoCalcado();
  const [status, setStatus] = useState<StatusCalcado>(c.status);
  const [observacoes, setObservacoes] = useState(c.observacoes ?? "");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const gravar = async () => {
    if (exigeLaudo(status) && !c.laudo_path && !arquivo) { toast.error("Anexe o laudo antes de finalizar."); return; }
    setOcupado(true);
    try {
      if (arquivo) await anexar.mutateAsync({ id: c.id, arquivo });
      if (status !== c.status || observacoes.trim() !== (c.observacoes ?? ""))
        await salvar.mutateAsync({ id: c.id, status, observacoes });
      toast.success("Pedido atualizado.");
      onFechar();
    } catch (e) { avisar(e); } finally { setOcupado(false); }
  };
  return <Dialog open onOpenChange={(v) => { if (!v && !ocupado) onFechar(); }}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
    <DialogHeader><DialogTitle>{c.colaborador_nome ?? "Colaborador não informado"}</DialogTitle>
      <DialogDescription>{c.item_nome}{c.tamanho ? ` · nº ${c.tamanho}` : ""} · pedido {c.pedido_codigo ?? "—"} de {dataBr(c.data_solicitacao)}</DialogDescription>
    </DialogHeader>
    <div className="space-y-4">
      <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
        <p><span className="text-muted-foreground">Contrato: </span>{c.contrato_nome ?? "—"}</p>
        <p><span className="text-muted-foreground">Encarregado: </span>{c.encarregado_nome ?? "—"}</p>
        <p><span className="text-muted-foreground">Quantidade: </span>{c.quantidade ?? "—"}</p>
        <p><span className="text-muted-foreground">Status no Compras: </span>{c.pedido_status ?? (c.pedido_id ? "—" : "pedido excluído")}</p>
      </div>
      <CampoFiltro titulo="Status do SST"><Select value={status} disabled={!podeAlterar} onValueChange={(v) => setStatus(v as StatusCalcado)}>
        <SelectTrigger aria-label="Status do SST"><SelectValue /></SelectTrigger><SelectContent>
          {Object.entries(STATUS_CALCADO).map(([v, nome]) => <SelectItem key={v} value={v}>{nome}</SelectItem>)}
        </SelectContent></Select></CampoFiltro>
      <label className="block text-sm font-medium">Observações<Textarea className="mt-1" value={observacoes} disabled={!podeAlterar}
        onChange={(e) => setObservacoes(e.target.value)} placeholder="Ex.: cobrado o Compras em 18/11; aguardando fornecedor." /></label>
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Laudo</p>
        {c.laudo_path ? <Button variant="outline" size="sm" onClick={() => abrirLaudo(c).catch(avisar)}>
          <FileText className="mr-2 h-4 w-4" /> Abrir {c.laudo_nome}</Button>
          : <p className="text-xs font-medium text-destructive">Laudo pendente — o encarregado não anexou no pedido.</p>}
        {podeAlterar && <Input type="file" accept={ACCEPT_LAUDO} aria-label="Anexar laudo" disabled={ocupado}
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />}
        {podeAlterar && <p className="text-xs text-muted-foreground">PDF ou imagem, até 10 MB. Um novo arquivo substitui o anterior. Finalizar exige laudo.</p>}
      </div>
      <div className="space-y-2 border-t pt-3"><h3 className="text-sm font-semibold">Histórico</h3>
        {historico.length ? <ul className="space-y-2">{historico.map((h) => <li key={h.id} className="rounded-md border p-2 text-sm">
          <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")} · {h.autor_nome ?? "Sistema"}</span><p>{h.descricao}</p>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>}</div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onFechar} disabled={ocupado}>Fechar</Button>
        {podeAlterar && <Button onClick={gravar} disabled={ocupado}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Salvar</Button>}</div>
    </div>
  </DialogContent></Dialog>;
}
