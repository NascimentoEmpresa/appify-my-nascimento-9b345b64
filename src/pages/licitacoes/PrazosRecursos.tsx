import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Download, Plus, Trash2, Trophy } from "lucide-react";
import * as XLSX from "xlsx";
import { PageHeader } from "@/components/layout/PageHeader";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useUsuariosLicitacao } from "@/hooks/useUsuariosLicitacao";

type Modalidade = "recurso" | "contrarrazao" | "impugnacao" | "mandado_seguranca" | "denuncia_tce" | "repactuacao";
type Status = "aberto" | "em_andamento" | "protocolado" | "concluido" | "cancelado";
type Resultado = "favoravel" | "desfavoravel";
type Demanda = {
  id: string; modalidade: Modalidade; processo: string; orgao: string | null; objeto: string | null;
  prazo: string | null; protocolo_em: string | null; status: Status; resultado: Resultado | null;
  responsavel_id: string | null; solicitante_id: string; observacoes: string | null; criado_por: string | null;
  atualizado_por: string | null; created_at: string; updated_at: string;
};
type RespostaBanco<T> = { data: T | null; error: Error | null };
type TabelaPrazos = {
  select: (colunas: string) => { order: (coluna: string, opcoes: { ascending: boolean; nullsFirst: boolean }) => Promise<RespostaBanco<Demanda[]>> };
  insert: (dados: Record<string, unknown>) => Promise<RespostaBanco<unknown>>;
  update: (dados: Record<string, unknown>) => { eq: (coluna: string, valor: string) => Promise<RespostaBanco<unknown>> };
  delete: () => { eq: (coluna: string, valor: string) => Promise<RespostaBanco<unknown>> };
};

const tabelaPrazos = () => (supabase as unknown as { from: (tabela: string) => TabelaPrazos }).from("LIC_PRAZO_RECURSO");
const modalidades: Record<Modalidade, string> = {
  recurso: "Recurso", contrarrazao: "Contrarrazão", impugnacao: "Impugnação",
  mandado_seguranca: "Mandado de segurança", denuncia_tce: "Denúncia ao TCE", repactuacao: "Cobrança / repactuação",
};
const vazio = { modalidade: "recurso" as Modalidade, processo: "", orgao: "", objeto: "", prazo: "", responsavel_id: "", observacoes: "" };
const textoStatus: Record<Status, string> = { aberto: "Aberto", em_andamento: "Em andamento", protocolado: "Protocolado", concluido: "Concluído", cancelado: "Cancelado" };
const OTNIEL = "Otniel Souza Moreira";
const hoje = () => new Date().toISOString().slice(0, 10);

function diasAte(data: string | null) {
  if (!data) return null;
  return Math.ceil((new Date(`${data}T00:00:00`).getTime() - new Date(`${hoje()}T00:00:00`).getTime()) / 86_400_000);
}

function nomeResponsavel(id: string | null, usuarios: { id: string; display_name: string | null; email: string | null }[]) {
  const usuario = usuarios.find((item) => item.id === id);
  return usuario?.display_name || usuario?.email || "Não atribuído";
}

function textoResultado(resultado: Resultado | null) {
  if (resultado === "favoravel") return "Deferido";
  if (resultado === "desfavoravel") return "Indeferido";
  return "—";
}

export default function PrazosRecursos() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: usuarios = [] } = useUsuariosLicitacao({ todasEmpresas: true });
  const { data: podeExcluir = false } = useScreenAccess("licitacoes_prazos_recursos_excluir", "excluir");
  const { data: podeMarcarPronto = false } = useScreenAccess("licitacoes_prazos_recursos_pronto", "alterar");
  const [modal, setModal] = useState(false);
  const [edicao, setEdicao] = useState<Demanda | null>(null);
  const [filtro, setFiltro] = useState<"todos" | Modalidade>("todos");
  const [form, setForm] = useState(vazio);
  const [excluirAlvo, setExcluirAlvo] = useState<Demanda | null>(null);

  const consulta = useQuery({
    queryKey: ["lic-prazos-recursos"],
    queryFn: async (): Promise<Demanda[]> => {
      const { data, error } = await tabelaPrazos().select("*").order("prazo", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        ...form, orgao: form.orgao || null, objeto: form.objeto || null, prazo: form.prazo || null,
        responsavel_id: form.responsavel_id || null, observacoes: form.observacoes || null,
      };
      const resposta = edicao ? await tabelaPrazos().update(payload).eq("id", edicao.id) : await tabelaPrazos().insert(payload);
      if (resposta.error) throw resposta.error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lic-prazos-recursos"] });
      setModal(false);
      toast({ title: edicao ? "Demanda atualizada" : "Demanda criada", description: "Os alertas foram enviados aos envolvidos." });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível salvar", description: erro.message, variant: "destructive" }),
  });

  const concluir = useMutation({
    mutationFn: async (demanda: Demanda) => {
      const { error } = await tabelaPrazos().update({ status: "concluido", protocolo_em: demanda.protocolo_em || hoje() }).eq("id", demanda.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lic-prazos-recursos"] });
      toast({ title: "Material marcado como pronto", description: "O responsável recebeu uma notificação." });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível concluir", description: erro.message, variant: "destructive" }),
  });

  const excluir = useMutation({
    mutationFn: async (demanda: Demanda) => {
      const { error } = await tabelaPrazos().delete().eq("id", demanda.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lic-prazos-recursos"] });
      setExcluirAlvo(null);
      toast({ title: "Demanda excluída", description: "A exclusão ficou registrada no histórico de auditoria." });
    },
    onError: (erro: Error) => toast({ title: "Não foi possível excluir", description: erro.message, variant: "destructive" }),
  });

  const linhas = useMemo(() => (consulta.data ?? []).filter((item) => filtro === "todos" || item.modalidade === filtro), [consulta.data, filtro]);
  const total = linhas.length;
  const abertos = linhas.filter((item) => item.status !== "concluido" && item.status !== "cancelado" && (diasAte(item.prazo) ?? 999) >= 0).length;
  const exitos = linhas.filter((item) => item.resultado === "favoravel").length;
  const naoExitos = linhas.filter((item) => item.resultado === "desfavoravel").length;

  function abrir(demanda?: Demanda) {
    setEdicao(demanda ?? null);
    setForm(demanda ? {
      modalidade: demanda.modalidade, processo: demanda.processo, orgao: demanda.orgao ?? "", objeto: demanda.objeto ?? "",
      prazo: demanda.prazo ?? "", responsavel_id: demanda.responsavel_id ?? "", observacoes: demanda.observacoes ?? "",
    } : vazio);
    setModal(true);
  }

  async function atualizarResultado(resultado: Resultado) {
    if (!edicao) return;
    const { error } = await tabelaPrazos().update({ resultado }).eq("id", edicao.id);
    if (error) {
      toast({ title: "Não foi possível atualizar o resultado", description: error.message, variant: "destructive" });
      return;
    }
    setEdicao({ ...edicao, resultado });
    qc.invalidateQueries({ queryKey: ["lic-prazos-recursos"] });
  }

  function exportarExcel() {
    const dados = linhas.map((demanda) => ({
      Modalidade: modalidades[demanda.modalidade], Processo: demanda.processo, "Órgão / cidade": demanda.orgao ?? "",
      Objeto: demanda.objeto ?? "", Prazo: demanda.prazo ? new Date(`${demanda.prazo}T00:00:00`) : "",
      "De (responsável)": nomeResponsavel(demanda.responsavel_id, usuarios), Para: OTNIEL, Status: textoStatus[demanda.status],
      "Resultado do processo": textoResultado(demanda.resultado),
      "Protocolado em": demanda.protocolo_em ? new Date(`${demanda.protocolo_em}T00:00:00`) : "", Observações: demanda.observacoes ?? "",
    }));
    const planilha = XLSX.utils.json_to_sheet(dados);
    planilha["!cols"] = [18, 22, 26, 50, 14, 26, 26, 18, 24, 18, 50].map((wch) => ({ wch }));
    for (const celula of Object.keys(planilha)) {
      if ((celula.startsWith("E") || celula.startsWith("J")) && celula !== "E1" && celula !== "J1") planilha[celula].z = "dd/mm/yyyy";
    }
    const arquivo = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(arquivo, planilha, "Prazos e resultados");
    XLSX.writeFile(arquivo, `prazos-e-resultados-${hoje()}.xlsx`);
  }

  return <div className="space-y-6">
    <PageHeader title="Controle de Prazos e Resultados" subtitle="Recursos, impugnações e demais demandas jurídicas da Licitação." breadcrumb={["Prazos e recursos"]} actions={<>
      <Button variant="outline" onClick={exportarExcel}><Download className="mr-2 h-4 w-4" />Exportar Excel</Button>
      <Button onClick={() => abrir()}><Plus className="mr-2 h-4 w-4" />Nova demanda</Button>
    </>} />

    <div className="flex flex-wrap gap-2">
      <Button variant={filtro === "todos" ? "default" : "outline"} size="sm" onClick={() => setFiltro("todos")}>Todas</Button>
      {Object.entries(modalidades).map(([codigo, nome]) => <Button key={codigo} variant={filtro === codigo ? "default" : "outline"} size="sm" onClick={() => setFiltro(codigo as Modalidade)}>{nome}</Button>)}
    </div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi icon={<ClipboardList />} titulo="Processos totais" valor={total} cor="text-blue-600" />
      <Kpi icon={<CalendarClock />} titulo="Em aberto a vencer" valor={abertos} cor="text-amber-600" />
      <Kpi icon={<Trophy />} titulo="Êxitos" valor={exitos} cor="text-emerald-600" />
      <Kpi icon={<AlertTriangle />} titulo="Não êxito" valor={naoExitos} cor="text-rose-600" />
    </div>

    <Card><CardContent className="p-0"><Table>
      <TableHeader><TableRow><TableHead>Modalidade</TableHead><TableHead>Processo / órgão</TableHead><TableHead>Prazo</TableHead><TableHead>Responsável</TableHead><TableHead>Status</TableHead><TableHead>Resultado do processo</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader>
      <TableBody>
        {linhas.map((demanda) => {
          const dias = diasAte(demanda.prazo);
          return <TableRow key={demanda.id} className="cursor-pointer" onClick={() => abrir(demanda)}>
            <TableCell className="text-xs">{modalidades[demanda.modalidade]}</TableCell>
            <TableCell><p className="font-medium">{demanda.processo}</p><p className="max-w-[330px] truncate text-xs text-muted-foreground">{demanda.orgao || demanda.objeto || "—"}</p></TableCell>
            <TableCell className={dias !== null && dias < 0 && demanda.status !== "concluido" ? "font-medium text-destructive" : ""}>{demanda.prazo ? new Date(`${demanda.prazo}T00:00:00`).toLocaleDateString("pt-BR") : "—"}<p className="text-xs text-muted-foreground">{dias !== null && demanda.status !== "concluido" ? `${dias < 0 ? "Vencido há" : "Faltam"} ${Math.abs(dias)} dia(s)` : ""}</p></TableCell>
            <TableCell><p>{nomeResponsavel(demanda.responsavel_id, usuarios)}</p><p className="text-xs text-muted-foreground">De: {nomeResponsavel(demanda.responsavel_id, usuarios)} → Para: {OTNIEL}</p></TableCell>
            <TableCell>{textoStatus[demanda.status]}</TableCell>
            <TableCell>{demanda.status === "concluido" ? textoResultado(demanda.resultado) : "—"}</TableCell>
            <TableCell className="text-right"><div className="flex justify-end gap-2">
              {demanda.status !== "concluido" && podeMarcarPronto && <Button size="sm" variant="outline" onClick={(evento) => { evento.stopPropagation(); concluir.mutate(demanda); }}><CheckCircle2 className="mr-1 h-3.5 w-3.5" />Pronto</Button>}
              {podeExcluir && <Button size="icon" variant="outline" className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground" aria-label={`Excluir demanda ${demanda.processo}`} onClick={(evento) => { evento.stopPropagation(); setExcluirAlvo(demanda); }}><Trash2 className="h-4 w-4" /></Button>}
            </div></TableCell>
          </TableRow>;
        })}
        {!linhas.length && <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Nenhuma demanda encontrada.</TableCell></TableRow>}
      </TableBody>
    </Table></CardContent></Card>

    <Dialog open={modal} onOpenChange={setModal}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{edicao ? "Editar demanda" : "Nova demanda"}</DialogTitle></DialogHeader>
      <div className="grid gap-3 py-2 sm:grid-cols-2">
        <Campo label="Modalidade"><Select value={form.modalidade} onValueChange={(valor) => setForm({ ...form, modalidade: valor as Modalidade })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(modalidades).map(([codigo, nome]) => <SelectItem key={codigo} value={codigo}>{nome}</SelectItem>)}</SelectContent></Select></Campo>
        <Campo label="Prazo"><Input type="date" value={form.prazo} onChange={(evento) => setForm({ ...form, prazo: evento.target.value })} /></Campo>
        <Campo label="Processo / pregão"><Input value={form.processo} onChange={(evento) => setForm({ ...form, processo: evento.target.value })} /></Campo>
        <Campo label="Órgão / cidade"><Input value={form.orgao} onChange={(evento) => setForm({ ...form, orgao: evento.target.value })} /></Campo>
        <Campo label="Responsável"><Select value={form.responsavel_id || "nenhum"} onValueChange={(valor) => setForm({ ...form, responsavel_id: valor === "nenhum" ? "" : valor })}><SelectTrigger><SelectValue placeholder="Não atribuído" /></SelectTrigger><SelectContent><SelectItem value="nenhum">Não atribuído</SelectItem>{usuarios.map((usuario) => <SelectItem key={usuario.id} value={usuario.id}>{usuario.display_name || usuario.email}</SelectItem>)}</SelectContent></Select></Campo>
        {edicao?.status === "concluido" && <Campo label="Resultado do processo"><Select value={edicao.resultado ?? undefined} onValueChange={(valor) => atualizarResultado(valor as Resultado)}><SelectTrigger><SelectValue placeholder="Selecione o resultado" /></SelectTrigger><SelectContent><SelectItem value="favoravel">Deferido</SelectItem><SelectItem value="desfavoravel">Indeferido</SelectItem></SelectContent></Select></Campo>}
        <div className="sm:col-span-2"><Campo label="Objeto / descrição"><Textarea value={form.objeto} onChange={(evento) => setForm({ ...form, objeto: evento.target.value })} /></Campo></div>
        <div className="sm:col-span-2"><Campo label="Observações"><Textarea value={form.observacoes} onChange={(evento) => setForm({ ...form, observacoes: evento.target.value })} /></Campo></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setModal(false)}>Cancelar</Button><Button disabled={!form.processo || salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? "Salvando..." : "Salvar demanda"}</Button></DialogFooter>
    </DialogContent></Dialog>

    <AlertDialog open={!!excluirAlvo} onOpenChange={(aberto) => !aberto && setExcluirAlvo(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Excluir demanda?</AlertDialogTitle><AlertDialogDescription>A demanda <strong>{excluirAlvo?.processo}</strong> será removida. A ação ficará registrada na auditoria e não poderá ser desfeita.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={excluir.isPending} onClick={() => excluirAlvo && excluir.mutate(excluirAlvo)}>Excluir demanda</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function Kpi({ icon, titulo, valor, cor }: { icon: React.ReactNode; titulo: string; valor: number; cor: string }) {
  return <Card><CardContent className="flex items-center justify-between p-5"><div><p className="text-sm text-muted-foreground">{titulo}</p><p className={`mt-1 text-3xl font-bold ${cor}`}>{valor}</p></div><div className={`${cor} rounded-full bg-muted p-3`}>{icon}</div></CardContent></Card>;
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}
