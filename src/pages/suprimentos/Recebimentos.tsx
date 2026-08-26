/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/PageHeader";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { CheckCircle2, AlertTriangle, ClipboardCheck, PackageCheck, Eye, Ban } from "lucide-react";
import { toast } from "sonner";

const sb = supabase as any;

const statusBadge = (status: string) => {
  const mapa: Record<string, { variante: "default" | "secondary" | "destructive" | "outline"; rotulo: string }> = {
    aguardando: { variante: "outline", rotulo: "Aguardando" },
    em_conferencia: { variante: "default", rotulo: "Em conferência" },
    recebido: { variante: "default", rotulo: "Recebido" },
    recebido_com_ocorrencia: { variante: "destructive", rotulo: "Com ocorrência" },
    cancelado: { variante: "secondary", rotulo: "Recusado/Cancelado" },
  };
  const item = mapa[status] ?? { variante: "outline" as const, rotulo: status };
  return <Badge variant={item.variante}>{item.rotulo}</Badge>;
};

const divergenciaBadge = (divergencia: string | null) => {
  const rotulos: Record<string, string> = {
    igual: "Quantidade correta", a_menos: "Recebido a menos",
    a_mais: "Recebido a mais", item_nao_pedido: "Item não estava no pedido",
  };
  if (!divergencia) return null;
  return <Badge variant={divergencia === "igual" ? "outline" : "destructive"}>{rotulos[divergencia] ?? divergencia}</Badge>;
};

const ocorrenciaStatusBadge = (status: string) => {
  const mapa: Record<string, { variante: "default" | "secondary" | "destructive" | "outline"; rotulo: string }> = {
    aberta: { variante: "destructive", rotulo: "Aberta" },
    em_tratativa: { variante: "default", rotulo: "Em tratativa" },
    resolvida: { variante: "outline", rotulo: "Resolvida" },
    cancelada: { variante: "secondary", rotulo: "Cancelada" },
  };
  const item = mapa[status] ?? { variante: "outline" as const, rotulo: status };
  return <Badge variant={item.variante}>{item.rotulo}</Badge>;
};

export default function Recebimentos() {
  const qc = useQueryClient();
  const { data: podeVerEsperada = false } = useScreenAccess("recebimentos", "aprovar");
  const [tab, setTab] = useState("recebimentos");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [recebimentoSelecionado, setRecebimentoSelecionado] = useState<any>(null);
  const [aberto, setAberto] = useState(false);
  const [contagens, setContagens] = useState<Record<string, string>>({});
  const [condicoes, setCondicoes] = useState<Record<string, string>>({});
  const [ocorrenciaSelecionada, setOcorrenciaSelecionada] = useState<any>(null);
  const [tratativa, setTratativa] = useState("");

  const { data: recebimentos = [], isLoading } = useQuery<any[]>({
    queryKey: ["recebimento_nf"],
    queryFn: async () => {
      const { data, error } = await sb.from("recebimento_nf").select(`
        *, nf_entrada(numero,serie,fornecedor_razao,valor_total,origem),
        pedido:sup_compra_pedido_id(numero,status)
      `).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: ocorrencias = [] } = useQuery<any[]>({
    queryKey: ["recebimento_ocorrencia"],
    queryFn: async () => {
      const { data, error } = await sb.from("recebimento_ocorrencia")
        .select("*").order("aberta_em", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: itens = [], error: erroItens, isLoading: carregandoItens } = useQuery<any[]>({
    queryKey: ["recebimento_nf_item", recebimentoSelecionado?.id],
    enabled: !!recebimentoSelecionado?.id,
    queryFn: async () => {
      const { data, error } = await sb.rpc("sup_receb_itens", {
        p_recebimento_id: recebimentoSelecionado.id,
      });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtrados = useMemo(() => recebimentos.filter((r) =>
    filtroStatus === "todos" || r.status === filtroStatus
  ), [recebimentos, filtroStatus]);

  const kpis = useMemo(() => ({
    total: recebimentos.length,
    aguardando: recebimentos.filter((r) => r.status === "aguardando").length,
    conferencia: recebimentos.filter((r) => r.status === "em_conferencia").length,
    ocorrencias: recebimentos.filter((r) => r.status === "recebido_com_ocorrencia").length,
    abertas: ocorrencias.filter((o) => o.status === "aberta").length,
  }), [recebimentos, ocorrencias]);

  const iniciar = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await sb.rpc("sup_receb_iniciar", { p_recebimento_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: (recebimento: any) => {
      setRecebimentoSelecionado((atual: any) => ({ ...atual, ...recebimento }));
      qc.invalidateQueries({ queryKey: ["recebimento_nf"] });
      toast.success("Conferência cega iniciada.");
    },
    onError: (erro: any) => toast.error(erro.message),
  });

  const conferir = useMutation({
    mutationFn: async () => {
      const payload = itens.map((item) => ({
        id: item.id,
        quantidade_conferida: contagens[item.id] ?? "",
        condicao: condicoes[item.id] ?? "ok",
      }));
      const { data, error } = await sb.rpc("sup_receb_conferir", {
        p_recebimento_id: recebimentoSelecionado.id, p_itens: payload,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (resultado: any) => {
      setRecebimentoSelecionado((atual: any) => ({ ...atual, status: resultado.status_recebimento }));
      qc.invalidateQueries({ queryKey: ["recebimento_nf"] });
      qc.invalidateQueries({ queryKey: ["recebimento_nf_item", recebimentoSelecionado?.id] });
      qc.invalidateQueries({ queryKey: ["recebimento_ocorrencia"] });
      toast.success(resultado.tem_divergencia ? "Conferência gravada com divergências." : "Conferência concluída sem divergências.");
    },
    onError: (erro: any) => toast.error(erro.message),
  });

  const recusar = useMutation({
    mutationFn: async () => {
      const motivo = window.prompt("Informe o motivo da recusa da mercadoria:");
      if (!motivo?.trim()) throw new Error("A recusa exige um motivo.");
      const { data, error } = await sb.rpc("sup_receb_recusar", {
        p_recebimento_id: recebimentoSelecionado.id, p_motivo: motivo.trim(),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (recebimento: any) => {
      setRecebimentoSelecionado((atual: any) => ({ ...atual, ...recebimento }));
      qc.invalidateQueries({ queryKey: ["recebimento_nf"] });
      qc.invalidateQueries({ queryKey: ["recebimento_ocorrencia"] });
      toast.success("Mercadoria recusada e ocorrência aberta.");
    },
    onError: (erro: any) => toast.error(erro.message),
  });

  const tratar = useMutation({
    mutationFn: async (status: "em_tratativa" | "resolvida" | "cancelada") => {
      const { error } = await sb.rpc("sup_receb_tratar_ocorrencia", {
        p_ocorrencia_id: ocorrenciaSelecionada.id, p_status: status, p_tratativa: tratativa,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recebimento_ocorrencia"] });
      setOcorrenciaSelecionada(null);
      setTratativa("");
      toast.success("Ocorrência atualizada.");
    },
    onError: (erro: any) => toast.error(erro.message),
  });

  const abrirConferencia = (recebimento: any) => {
    setRecebimentoSelecionado(recebimento);
    setContagens({});
    setCondicoes({});
    setAberto(true);
  };

  const finalizado = ["recebido", "recebido_com_ocorrencia", "cancelado"].includes(recebimentoSelecionado?.status);
  const mostrarEsperada = podeVerEsperada || finalizado;
  const todasPreenchidas = itens.length > 0 && itens.every((item) => contagens[item.id] !== undefined && contagens[item.id] !== "");

  return (
    <div className="space-y-6">
      <PageHeader title="Recebimento de Mercadorias" subtitle="Conferência física cega antes da entrada no estoque." />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {[["Total", kpis.total], ["Aguardando", kpis.aguardando], ["Em conferência", kpis.conferencia],
          ["Com ocorrência", kpis.ocorrencias], ["Ocorrências abertas", kpis.abertas]].map(([rotulo, valor]) => (
          <Card key={String(rotulo)}><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">{rotulo}</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{valor}</p></CardContent></Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="recebimentos"><ClipboardCheck className="mr-2 h-4 w-4" />Recebimentos</TabsTrigger>
          <TabsTrigger value="ocorrencias"><AlertTriangle className="mr-2 h-4 w-4" />Ocorrências ({kpis.abertas})</TabsTrigger>
        </TabsList>

        <TabsContent value="recebimentos" className="space-y-3">
          <Select value={filtroStatus} onValueChange={setFiltroStatus}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem><SelectItem value="aguardando">Aguardando</SelectItem>
              <SelectItem value="em_conferencia">Em conferência</SelectItem><SelectItem value="recebido">Recebido</SelectItem>
              <SelectItem value="recebido_com_ocorrencia">Com ocorrência</SelectItem><SelectItem value="cancelado">Recusado/Cancelado</SelectItem>
            </SelectContent>
          </Select>
          <Card><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>NF</TableHead><TableHead>Pedido</TableHead><TableHead>Fornecedor</TableHead><TableHead>Status</TableHead><TableHead>Criado</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={6} className="text-center">Carregando…</TableCell></TableRow>}
              {!isLoading && filtrados.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum recebimento.</TableCell></TableRow>}
              {filtrados.map((r) => <TableRow key={r.id}>
                <TableCell className="font-medium">{r.nf_entrada?.numero ?? "—"}/{r.nf_entrada?.serie ?? "1"}</TableCell>
                <TableCell>{r.pedido?.numero ?? "Legado/sem pedido"}</TableCell><TableCell>{r.nf_entrada?.fornecedor_razao ?? "—"}</TableCell>
                <TableCell>{statusBadge(r.status)}</TableCell><TableCell className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell><Button size="sm" variant="outline" onClick={() => abrirConferencia(r)}><Eye className="mr-1 h-4 w-4" />Conferir</Button></TableCell>
              </TableRow>)}
            </TableBody>
          </Table></CardContent></Card>
        </TabsContent>

        <TabsContent value="ocorrencias">
          <Card><CardContent className="p-0"><Table>
            <TableHeader><TableRow><TableHead>Tipo</TableHead><TableHead>Descrição</TableHead><TableHead>Status</TableHead><TableHead>Aberta em</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>{ocorrencias.map((o) => <TableRow key={o.id}>
              <TableCell><Badge variant="outline">{o.tipo}</Badge></TableCell><TableCell>{o.descricao}</TableCell><TableCell>{ocorrenciaStatusBadge(o.status)}</TableCell>
              <TableCell className="text-xs">{new Date(o.aberta_em).toLocaleString("pt-BR")}</TableCell>
              <TableCell>{!["resolvida", "cancelada"].includes(o.status) && <Button size="sm" variant="outline" onClick={() => { setOcorrenciaSelecionada(o); setTratativa(o.tratativa ?? ""); }}>Tratar</Button>}</TableCell>
            </TableRow>)}</TableBody>
          </Table></CardContent></Card>
        </TabsContent>
      </Tabs>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader><DialogTitle>Conferência — NF {recebimentoSelecionado?.nf_entrada?.numero}</DialogTitle></DialogHeader>
          {recebimentoSelecionado && <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">{statusBadge(recebimentoSelecionado.status)}<span className="text-sm text-muted-foreground">{recebimentoSelecionado.nf_entrada?.fornecedor_razao}</span></div>
            {!finalizado && !podeVerEsperada && <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">Conferência cega: conte fisicamente cada item. As quantidades esperadas só aparecem depois de gravar.</div>}
            {recebimentoSelecionado.status === "aguardando" && <Button onClick={() => iniciar.mutate(recebimentoSelecionado.id)} disabled={iniciar.isPending}>Iniciar conferência</Button>}

            {erroItens && (
              <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <p className="font-medium">Não foi possível carregar os itens desta conferência.</p>
                <p className="mt-1">{erroItens.message}</p>
              </div>
            )}
            {carregandoItens && (
              <p className="py-6 text-center text-sm text-muted-foreground">Carregando itens da conferência…</p>
            )}
            {!erroItens && !carregandoItens && <Table><TableHeader><TableRow><TableHead>Descrição</TableHead><TableHead>Unidade</TableHead>{mostrarEsperada && <TableHead className="text-right">Qtd. pedida</TableHead>}<TableHead className="w-40 text-right">Quantidade contada</TableHead><TableHead>Condição</TableHead>{finalizado && <TableHead>Confronto</TableHead>}</TableRow></TableHeader>
              <TableBody>{itens.map((item) => <TableRow key={item.id}>
                <TableCell><div className="font-medium">{item.descricao}</div></TableCell>
                <TableCell>{item.unidade ?? "—"}</TableCell>
                {mostrarEsperada && <TableCell className="text-right">{item.quantidade_esperada ?? "—"}</TableCell>}
                <TableCell><Input type="number" min="0" step="0.001" className="text-right"
                  disabled={recebimentoSelecionado.status !== "em_conferencia"}
                  value={finalizado ? item.quantidade_conferida ?? "" : contagens[item.id] ?? ""}
                  onChange={(e) => setContagens({ ...contagens, [item.id]: e.target.value })} /></TableCell>
                <TableCell><Select disabled={recebimentoSelecionado.status !== "em_conferencia"}
                  value={finalizado ? item.condicao : condicoes[item.id] ?? "ok"}
                  onValueChange={(valor) => setCondicoes({ ...condicoes, [item.id]: valor })}>
                  <SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                    <SelectItem value="ok">OK</SelectItem><SelectItem value="avariado">Avariado</SelectItem>
                    <SelectItem value="trocado">Trocado</SelectItem><SelectItem value="faltante">Faltante</SelectItem><SelectItem value="excedente">Excedente</SelectItem>
                  </SelectContent></Select></TableCell>
                {finalizado && <TableCell>{divergenciaBadge(item.divergencia)}</TableCell>}
              </TableRow>)}</TableBody>
            </Table>}
          </div>}
          <DialogFooter className="flex-wrap gap-2">
            {recebimentoSelecionado && ["aguardando", "em_conferencia"].includes(recebimentoSelecionado.status) && <Button variant="destructive" onClick={() => recusar.mutate()} disabled={recusar.isPending}><Ban className="mr-2 h-4 w-4" />Recusar mercadoria</Button>}
            {recebimentoSelecionado?.status === "em_conferencia" && <Button onClick={() => conferir.mutate()} disabled={!!erroItens || !todasPreenchidas || conferir.isPending}><PackageCheck className="mr-2 h-4 w-4" />Gravar conferência</Button>}
            <Button variant="outline" onClick={() => setAberto(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ocorrenciaSelecionada} onOpenChange={(valor) => !valor && setOcorrenciaSelecionada(null)}>
        <DialogContent><DialogHeader><DialogTitle>Tratar ocorrência</DialogTitle></DialogHeader>
          <div className="space-y-3"><p className="text-sm">{ocorrenciaSelecionada?.descricao}</p><div><Label>Tratativa</Label><Textarea value={tratativa} onChange={(e) => setTratativa(e.target.value)} rows={4} /></div></div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => tratar.mutate("em_tratativa")}>Em tratativa</Button><Button variant="destructive" onClick={() => tratar.mutate("cancelada")}>Cancelar</Button><Button onClick={() => tratar.mutate("resolvida")}><CheckCircle2 className="mr-2 h-4 w-4" />Resolver</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
