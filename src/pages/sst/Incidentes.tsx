import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileText, Loader2, Paperclip, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { abrirRelatorio, buscarColaboradoresIncidente, MENU_INCIDENTES, sugestaoIncidente,
  useAnexarRelatorio, useContratosIncidente, useHistoricoIncidente, useIncidentes, useSalvarIncidente,
  type ColaboradorIncidente } from "@/hooks/useIncidentes";
import { dataBr, FILTROS_INCIDENTE, filtrarIncidentes, STATUS_INCIDENTE, type FiltrosIncidente,
  type Incidente, type StatusIncidente } from "@/lib/sst/incidentes";

const avisar = (e: unknown) => toast.error((e as Error).message);
const hoje = () => new Date().toLocaleDateString("en-CA");

export default function Incidentes() {
  const { data: lista = [], isLoading, error } = useIncidentes();
  const { data: contratos = [] } = useContratosIncidente();
  const podeAlterar = useScreenAccess(MENU_INCIDENTES, "alterar").data === true;
  const [params, setParams] = useSearchParams();
  const [novo, setNovo] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosIncidente>(FILTROS_INCIDENTE);
  const alterarFiltro = <K extends keyof FiltrosIncidente>(campo: K, valor: FiltrosIncidente[K]) =>
    setFiltros((f) => ({ ...f, [campo]: valor }));
  const visiveis = useMemo(() => filtrarIncidentes(lista, filtros), [lista, filtros]);
  const id = Number(params.get("id")) || null;
  const aberto = id == null ? null : lista.find((i) => i.id === id) ?? null;
  const fechar = () => { setNovo(false); setParams((p) => { const n = new URLSearchParams(p); n.delete("id"); return n; }, { replace: true }); };

  return <div className="space-y-4">
    <PageHeader title="Incidentes" module="SST" breadcrumb={["Incidentes"]}
      subtitle="Relatórios de incidente, assinaturas e acompanhamento por colaborador."
      actions={podeAlterar && <Button onClick={() => setNovo(true)}><Plus className="mr-2 h-4 w-4" /> Registrar incidente</Button>} />
    <div className="flex flex-wrap items-end gap-3">
      <CampoFiltro titulo="De"><Input type="date" aria-label="Data inicial" value={filtros.de} onChange={(e) => alterarFiltro("de", e.target.value)} /></CampoFiltro>
      <CampoFiltro titulo="Até"><Input type="date" aria-label="Data final" value={filtros.ate} onChange={(e) => alterarFiltro("ate", e.target.value)} /></CampoFiltro>
      <CampoFiltro titulo="Contrato">
        <Select value={filtros.contrato} onValueChange={(v) => alterarFiltro("contrato", v)}><SelectTrigger className="w-52" aria-label="Contrato"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="todos">Todos</SelectItem>{contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent></Select>
      </CampoFiltro>
      <CampoFiltro titulo="Colaborador"><Input className="w-48" placeholder="Nome" aria-label="Colaborador" value={filtros.colaborador} onChange={(e) => alterarFiltro("colaborador", e.target.value)} /></CampoFiltro>
      <CampoFiltro titulo="Encarregado"><Input className="w-48" placeholder="Nome" aria-label="Encarregado" value={filtros.encarregado} onChange={(e) => alterarFiltro("encarregado", e.target.value)} /></CampoFiltro>
      <CampoFiltro titulo="Com afastamento">
        <Select value={filtros.afastamento} onValueChange={(v) => alterarFiltro("afastamento", v as FiltrosIncidente["afastamento"])}>
          <SelectTrigger className="w-36" aria-label="Com afastamento"><SelectValue /></SelectTrigger><SelectContent>
            <SelectItem value="todos">Todos</SelectItem><SelectItem value="sim">Sim</SelectItem><SelectItem value="nao">Não</SelectItem>
          </SelectContent></Select>
      </CampoFiltro>
      <CampoFiltro titulo="Status"><Select value={filtros.status} onValueChange={(v) => alterarFiltro("status", v as FiltrosIncidente["status"])}>
        <SelectTrigger className="w-52" aria-label="Status"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="todos">Todos</SelectItem>{Object.entries(STATUS_INCIDENTE).map(([valor, rotulo]) => <SelectItem key={valor} value={valor}>{rotulo}</SelectItem>)}
        </SelectContent></Select></CampoFiltro>
      {JSON.stringify(filtros) !== JSON.stringify(FILTROS_INCIDENTE) && <Button variant="ghost" onClick={() => setFiltros(FILTROS_INCIDENTE)}>Limpar filtros</Button>}
    </div>
    <Card className="overflow-x-auto"><Table className="min-w-[1050px]"><TableHeader><TableRow>
      <TableHead>Data</TableHead><TableHead>Colaborador</TableHead><TableHead>Contrato</TableHead><TableHead>Encarregado</TableHead>
      <TableHead>Afastamento</TableHead><TableHead>Nº do relatório</TableHead><TableHead>Status</TableHead><TableHead>Documento</TableHead>
    </TableRow></TableHeader><TableBody>
      {isLoading ? <TableRow><TableCell colSpan={8} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></TableCell></TableRow>
        : error ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-destructive">{(error as Error).message}</TableCell></TableRow>
        : visiveis.length === 0 ? <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">{lista.length ? "Nenhum incidente neste filtro." : "Nenhum incidente registrado."}</TableCell></TableRow>
        : visiveis.map((i) => <TableRow key={i.id} className="cursor-pointer" onClick={() => setParams({ id: String(i.id) })}>
          <TableCell>{dataBr(i.data_incidente)}</TableCell><TableCell className="font-medium">
            <button type="button" className="text-left text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setParams({ id: String(i.id) }); }}>{i.nome}</button>
          </TableCell>
          <TableCell>{i.contrato_nome ?? "—"}</TableCell><TableCell>{i.encarregado ?? "—"}</TableCell>
          <TableCell>{i.dias_afastamento ? `${i.dias_afastamento} dia(s)` : "Não"}</TableCell>
          <TableCell>{i.numero_relatorio ?? "—"}</TableCell><TableCell><Badge variant="outline">{STATUS_INCIDENTE[i.status]}</Badge></TableCell>
          <TableCell>{i.arquivo_path ? <Paperclip className="h-4 w-4" aria-label="Relatório anexado" /> : "—"}</TableCell>
        </TableRow>)}
    </TableBody></Table></Card>
    <p className="text-xs text-muted-foreground">{visiveis.length} de {lista.length} incidente(s).</p>
    {(novo || aberto) && <FichaIncidente key={novo ? "novo" : aberto!.id} incidente={novo ? null : aberto} podeAlterar={podeAlterar} onFechar={fechar} />}
  </div>;
}

function CampoFiltro({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{titulo}</Label>{children}</div>;
}

interface Formulario {
  contrato_id: string; encarregado: string; data_incidente: string; dias_afastamento: string;
  numero_relatorio: string; status: StatusIncidente; observacoes: string;
}
const formDe = (i: Incidente | null): Formulario => ({
  contrato_id: i?.contrato_id ?? "", encarregado: i?.encarregado ?? "", data_incidente: i?.data_incidente ?? hoje(),
  dias_afastamento: i?.dias_afastamento?.toString() ?? "", numero_relatorio: i?.numero_relatorio ?? "",
  status: i?.status ?? "elaboracao", observacoes: i?.observacoes ?? "",
});

function FichaIncidente({ incidente, podeAlterar, onFechar }: { incidente: Incidente | null; podeAlterar: boolean; onFechar: () => void }) {
  const { data: contratos = [] } = useContratosIncidente();
  const { data: historico = [] } = useHistoricoIncidente(incidente?.id ?? null);
  const salvar = useSalvarIncidente();
  const anexar = useAnexarRelatorio();
  const [form, setForm] = useState(() => formDe(incidente));
  const [colaborador, setColaborador] = useState<ColaboradorIncidente | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [criadoId, setCriadoId] = useState<number | null>(null);
  const [arquivoEnviado, setArquivoEnviado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const campo = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setForm((f) => ({ ...f, [k]: v }));
  const escolher = (c: ColaboradorIncidente | null) => {
    setColaborador(c);
    if (c) sugestaoIncidente(c.id).then((s) => setForm((f) => ({ ...f,
      contrato_id: f.contrato_id || s.contrato_id || "", encarregado: f.encarregado || s.encarregado || "" })), avisar);
  };
  const gravar = async () => {
    if (!incidente && !colaborador) { toast.error("Escolha o colaborador."); return; }
    if (!form.data_incidente) { toast.error("Informe a data do incidente."); return; }
    if ((form.status === "recebido" || form.status === "finalizado") && !arquivo && !incidente?.arquivo_path && !arquivoEnviado) {
      toast.error("Anexe o relatório assinado antes de marcar como recebido ou finalizado."); return;
    }
    if (form.status === "finalizado" && !form.numero_relatorio.trim()) { toast.error("Informe o número do relatório."); return; }
    setOcupado(true);
    try {
      const payload = { ...form, empregado_id: colaborador?.id };
      const id = incidente?.id ?? criadoId ?? await salvar.mutateAsync({ ...payload, status: "elaboracao" });
      if (!incidente && criadoId == null) setCriadoId(id);
      if (arquivo) { await anexar.mutateAsync({ id, arquivo }); setArquivoEnviado(true); setArquivo(null); }
      if (incidente || criadoId != null || form.status !== "elaboracao") await salvar.mutateAsync({ id, ...payload });
      toast.success(incidente ? "Incidente atualizado." : "Incidente registrado.");
      onFechar();
    } catch (e) { avisar(e); } finally { setOcupado(false); }
  };
  return <Dialog open onOpenChange={(v) => { if (!v && !ocupado) onFechar(); }}><DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
    <DialogHeader><DialogTitle>{incidente ? incidente.nome : "Registrar incidente"}</DialogTitle>
      <DialogDescription>{incidente ? `Incidente de ${dataBr(incidente.data_incidente)}` : "Vincule o registro ao colaborador e acompanhe o relatório assinado."}</DialogDescription>
    </DialogHeader>
    <div className="space-y-4">
      {!incidente && <BuscaColaborador escolhido={colaborador} onEscolher={escolher} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Data do incidente<Input type="date" className="mt-1" value={form.data_incidente} max={hoje()} disabled={!podeAlterar} onChange={(e) => campo("data_incidente", e.target.value)} /></label>
        <CampoFiltro titulo="Contrato"><Select value={form.contrato_id || "nenhum"} disabled={!podeAlterar} onValueChange={(v) => campo("contrato_id", v === "nenhum" ? "" : v)}>
          <SelectTrigger aria-label="Contrato do incidente"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="nenhum">Não informado</SelectItem>
            {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent></Select></CampoFiltro>
        <label className="text-sm font-medium">Encarregado<Input className="mt-1" value={form.encarregado} disabled={!podeAlterar} onChange={(e) => campo("encarregado", e.target.value)} /></label>
        <label className="text-sm font-medium">Dias de afastamento, se houver<Input type="number" min="0" className="mt-1" value={form.dias_afastamento} disabled={!podeAlterar} onChange={(e) => campo("dias_afastamento", e.target.value)} /></label>
        <label className="text-sm font-medium">Número do relatório<Input className="mt-1" value={form.numero_relatorio} disabled={!podeAlterar} onChange={(e) => campo("numero_relatorio", e.target.value)} /></label>
        <CampoFiltro titulo="Status"><Select value={form.status} disabled={!podeAlterar} onValueChange={(v) => campo("status", v as StatusIncidente)}>
          <SelectTrigger aria-label="Status do relatório"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_INCIDENTE).map(([v, nome]) => <SelectItem key={v} value={v}>{nome}</SelectItem>)}</SelectContent>
        </Select></CampoFiltro>
      </div>
      <label className="block text-sm font-medium">Observações<Textarea className="mt-1" value={form.observacoes} disabled={!podeAlterar} onChange={(e) => campo("observacoes", e.target.value)} /></label>
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Relatório de Incidente assinado</p>
        {incidente?.arquivo_path && <Button variant="outline" size="sm" onClick={() => abrirRelatorio(incidente).catch(avisar)}>
          <FileText className="mr-2 h-4 w-4" /> Abrir {incidente.arquivo_nome}</Button>}
        {!incidente?.arquivo_path && <p className="text-xs text-muted-foreground">Ainda não anexado.</p>}
        {podeAlterar && <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" aria-label="Anexar relatório assinado" disabled={ocupado}
          onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />}
        {podeAlterar && <p className="text-xs text-muted-foreground">PDF ou imagem, até 25 MB. Um novo arquivo substitui o anterior.</p>}
      </div>
      {incidente && <div className="space-y-2 border-t pt-3"><h3 className="text-sm font-semibold">Histórico</h3>
        {historico.length ? <ul className="space-y-2">{historico.map((h) => <li key={h.id} className="rounded-md border p-2 text-sm">
          <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-BR")} · {h.autor_nome ?? "Sistema"}</span><p>{h.descricao}</p>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>}</div>}
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onFechar} disabled={ocupado}>Fechar</Button>
        {podeAlterar && <Button onClick={gravar} disabled={ocupado}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{incidente ? "Salvar" : "Registrar"}</Button>}</div>
    </div>
  </DialogContent></Dialog>;
}

function BuscaColaborador({ escolhido, onEscolher }: { escolhido: ColaboradorIncidente | null; onEscolher: (c: ColaboradorIncidente | null) => void }) {
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<ColaboradorIncidente[]>([]);
  useEffect(() => {
    if (escolhido || busca.trim().length < 3) { setLista([]); return; }
    let ativo = true;
    const timer = setTimeout(() => buscarColaboradoresIncidente(busca).then((r) => { if (ativo) setLista(r); }, avisar), 300);
    return () => { ativo = false; clearTimeout(timer); };
  }, [busca, escolhido]);
  return <div className="space-y-1"><Label htmlFor="inc-colaborador">Colaborador</Label>
    {escolhido ? <div className="flex items-center justify-between rounded-md border p-2 text-sm"><span>{escolhido.nome} · {escolhido.filial ?? "Sem filial"}</span>
      <Button size="sm" variant="ghost" onClick={() => { onEscolher(null); setBusca(""); }}>Trocar</Button></div>
      : <><div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input id="inc-colaborador" className="pl-8" placeholder="Digite ao menos 3 letras" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        {lista.length > 0 && <div className="max-h-40 overflow-y-auto rounded-md border">{lista.map((c) => <button key={c.id} type="button"
          className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onEscolher(c)}>
          {c.nome} · {c.filial ?? "Sem filial"}{c.desligado ? " · desligado" : ""}</button>)}</div>}</>}
  </div>;
}
