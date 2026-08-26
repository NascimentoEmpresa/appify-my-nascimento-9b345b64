import { useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import { PainelNotasSefaz } from "./PainelNotasSefaz";
import { useList } from "@/hooks/useGenericCrud";
import { Upload, FileText, CheckCircle2, XCircle, AlertTriangle, PackageCheck, Eye, Loader2, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { fmtBRL } from "@/components/crud/EntityCrudPage";

const fmtQtd = (n: any) => Number(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

const statusConfig: Record<string, { label: string; variant: any; icon: any }> = {
  importada: { label: "Importada", variant: "outline", icon: FileText },
  validada: { label: "Validada", variant: "default", icon: CheckCircle2 },
  lancada_estoque: { label: "Lançada", variant: "default", icon: PackageCheck },
  cancelada: { label: "Cancelada", variant: "secondary", icon: XCircle },
  rejeitada: { label: "Rejeitada", variant: "destructive", icon: XCircle },
};

const itemStatusConfig: Record<string, { label: string; variant: any }> = {
  ok: { label: "OK", variant: "outline" },
  pendente_revisao: { label: "Pendente revisão", variant: "default" },
  produto_novo: { label: "Produto novo", variant: "default" },
  divergencia: { label: "Divergência", variant: "destructive" },
};

export default function NFEntrada() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: almoxarifados = [] } = useList<any>("almoxarifado", { orderBy: "codigo", ascending: true });
  const { data: contratos = [] } = useList<any>("contrato", { orderBy: "numero" });
  const { data: ccs = [] } = useList<any>("centros_custo", { orderBy: "codigo", ascending: true });

  const { data: nfs = [], isLoading } = useQuery<any[]>({
    queryKey: ["nf_entrada", "list"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_entrada")
        .select("*")
        .order("data_emissao", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [openImport, setOpenImport] = useState(false);
  const [openManual, setOpenManual] = useState(false);
  const [openDetail, setOpenDetail] = useState(false);
  const [nfSelecionada, setNfSelecionada] = useState<any>(null);
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [busca, setBusca] = useState("");
  const [importForm, setImportForm] = useState<any>({ destino: "estoque" });
  const [xmlContent, setXmlContent] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [manualForm, setManualForm] = useState<any>({ serie: "1", data_emissao: new Date().toISOString().slice(0, 10) });
  const [vinculosItens, setVinculosItens] = useState<Record<string, string>>({});

  const { data: pcsAprovados = [] } = useQuery<any[]>({
    queryKey: ["sup_compra_pedido", "para-nf"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sup_compra_pedido")
        .select("id, numero, fornecedor_id, valor_total, status")
        .in("status", ["enviado", "aguardando_entrega", "entrega_parcial"])
        .order("numero", { ascending: false }).limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: fornecedores = [] } = useList<any>("fornecedor", { orderBy: "razao_social", ascending: true });
  const { data: itensCatalogo = [] } = useQuery<any[]>({
    queryKey: ["sup_item", "nf-vinculo"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sup_item")
        .select("id,nome,tipo,codigo_barras,empresa_id").eq("ativo", true).order("nome").limit(2000);
      if (error) throw error;
      return data ?? [];
    },
  });

  const lancarManual = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("sup_nf_criar_manual", {
        p_dados: manualForm,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (nf: any) => {
      toast.success(`NF manual criada: ${nf.numero}. Os itens do pedido foram carregados para conferência.`);
      qc.invalidateQueries({ queryKey: ["nf_entrada"] });
      setOpenManual(false);
      setManualForm({ serie: "1", data_emissao: new Date().toISOString().slice(0, 10) });
      setNfSelecionada(nf);
      setOpenDetail(true);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao lançar NF manual"),
  });

  const filtradas = useMemo(() => nfs.filter((n) => {
    if (filtroStatus !== "todos" && n.status !== filtroStatus) return false;
    if (busca) {
      const txt = `${n.numero} ${n.fornecedor_razao ?? ""} ${n.fornecedor_cnpj ?? ""} ${n.chave_acesso}`.toLowerCase();
      if (!txt.includes(busca.toLowerCase())) return false;
    }
    return true;
  }), [nfs, filtroStatus, busca]);

  const kpis = useMemo(() => ({
    total: nfs.length,
    importadas: nfs.filter((n) => n.status === "importada").length,
    validadas: nfs.filter((n) => n.status === "validada").length,
    lancadas: nfs.filter((n) => n.status === "lancada_estoque").length,
    valorTotal: nfs.filter((n) => n.status === "lancada_estoque").reduce((s, n) => s + Number(n.valor_total ?? 0), 0),
  }), [nfs]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    setXmlContent(text);
    toast.success(`XML carregado: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) await handleFile(file);
  };

  const importar = async () => {
    if (!xmlContent) {
      toast.error("Selecione um XML");
      return;
    }
    setImporting(true);
    try {
      const { data, error } = await (supabase.functions as any).invoke("nf-import-xml", {
        body: { xml: xmlContent, ...importForm },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.detail ? `: ${data.detail}` : ""));
      toast.success(
        `NF importada! ${data.itens} itens, ${data.produtos_criados_auto} produto(s) criado(s) automaticamente. ${data.itens_pendentes} pendente(s) de revisão.`,
        { duration: 6000 }
      );
      qc.invalidateQueries({ queryKey: ["nf_entrada"] });
      qc.invalidateQueries({ queryKey: ["produto"] });
      setOpenImport(false);
      setXmlContent("");
      setImportForm({ destino: "estoque" });
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao importar XML");
    } finally {
      setImporting(false);
    }
  };

  const validarMut = useMutation({
    mutationFn: async (nf_id: string) => {
      const { data, error } = await (supabase as any).rpc("sup_nf_validar", { p_nf_id: nf_id });
      if (error) throw error;
      return data;
    },
    onSuccess: (resultado: any) => {
      toast.success(`NF validada e lançada: ${resultado?.itens_lancados ?? 0} item(ns).`);
      qc.invalidateQueries({ queryKey: ["nf_entrada"] });
      qc.invalidateQueries({ queryKey: ["sup_estoque"] });
      setOpenDetail(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const lancarMut = useMutation({
    mutationFn: async (nf_id: string) => {
      const { data, error } = await (supabase as any).rpc("nf_lancar_estoque", { _nf_id: nf_id });
      if (error) throw error;
      return data;
    },
    onSuccess: (d: any) => {
      toast.success(`Lançada no estoque: ${d?.itens_lancados ?? 0} item(ns)`);
      qc.invalidateQueries({ queryKey: ["nf_entrada"] });
      qc.invalidateQueries({ queryKey: ["v_estoque_consolidado"] });
      qc.invalidateQueries({ queryKey: ["estoque_movimento"] });
      setOpenDetail(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const cancelarMut = useMutation({
    mutationFn: async (nf_id: string) => {
      const { error } = await (supabase as any).rpc("sup_nf_cancelar", { p_nf_id: nf_id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("NF cancelada"); qc.invalidateQueries({ queryKey: ["nf_entrada"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const vincularItemMut = useMutation({
    mutationFn: async (item_id: string) => {
      const sup_item_id = vinculosItens[item_id];
      if (!sup_item_id) throw new Error("Selecione o material correspondente.");
      const { error } = await (supabase as any).rpc("sup_nf_vincular_item", {
        p_nf_item_id: item_id,
        p_sup_item_id: sup_item_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item vinculado ao catálogo.");
      qc.invalidateQueries({ queryKey: ["nf_item", nfSelecionada?.id] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const { data: itens = [] } = useQuery<any[]>({
    queryKey: ["nf_item", nfSelecionada?.id],
    queryFn: async () => {
      if (!nfSelecionada?.id) return [];
      const { data, error } = await (supabase as any)
        .from("nf_entrada_item")
        .select("*")
        .eq("nf_id", nfSelecionada.id)
        .order("numero_item");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!nfSelecionada?.id,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="NF de Entrada"
        subtitle="Importação de XML de notas fiscais e lançamento no estoque."
        actions={
          <div className="flex gap-2">
            <Dialog open={openManual} onOpenChange={setOpenManual}>
              <DialogTrigger asChild>
                <Button variant="outline"><FilePlus2 className="mr-2 h-4 w-4" /> Lançar Manual</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Lançamento Manual de NF</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="rounded-md border bg-warning/10 p-3 text-xs">
                    ⚠️ <strong>NF manual exige PC aprovado.</strong> Selecione o Pedido de Compra que originou esta nota.
                  </div>
                  <div>
                    <Label>Pedido de Compra (obrigatório)</Label>
                    <Select value={manualForm.sup_compra_pedido_id ?? ""} onValueChange={(v) => {
                      const pc = pcsAprovados.find((p: any) => p.id === v);
                      setManualForm({ ...manualForm, sup_compra_pedido_id: v, fornecedor_id: pc?.fornecedor_id, valor_total: pc?.valor_total });
                    }}>
                      <SelectTrigger><SelectValue placeholder="Selecione um PC aprovado" /></SelectTrigger>
                      <SelectContent>
                        {pcsAprovados.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>PC {p.numero} — R$ {Number(p.valor_total ?? 0).toLocaleString("pt-BR")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div><Label>Número NF</Label><Input value={manualForm.numero ?? ""} onChange={(e) => setManualForm({ ...manualForm, numero: e.target.value })} /></div>
                    <div><Label>Série</Label><Input value={manualForm.serie} onChange={(e) => setManualForm({ ...manualForm, serie: e.target.value })} /></div>
                    <div><Label>Data emissão</Label><Input type="date" value={manualForm.data_emissao} onChange={(e) => setManualForm({ ...manualForm, data_emissao: e.target.value })} /></div>
                  </div>
                  <div>
                    <Label>Fornecedor</Label>
                    <Select value={manualForm.fornecedor_id ?? ""} onValueChange={(v) => setManualForm({ ...manualForm, fornecedor_id: v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {fornecedores.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.razao_social}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Label>Almoxarifado</Label>
                      <Select value={manualForm.almoxarifado_id ?? ""} onValueChange={(v) => setManualForm({ ...manualForm, almoxarifado_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Matriz (padrão)" /></SelectTrigger>
                        <SelectContent>
                          {almoxarifados.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.codigo} — {a.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Valor Total</Label><Input type="number" step="0.01" value={manualForm.valor_total ?? ""} onChange={(e) => setManualForm({ ...manualForm, valor_total: parseFloat(e.target.value) || 0 })} /></div>
                  </div>
                  <div><Label>Chave de Acesso (opcional)</Label><Input value={manualForm.chave_acesso ?? ""} placeholder="44 dígitos ou deixe vazio" onChange={(e) => setManualForm({ ...manualForm, chave_acesso: e.target.value })} /></div>
                  <div><Label>Observações</Label><Input value={manualForm.observacoes ?? ""} onChange={(e) => setManualForm({ ...manualForm, observacoes: e.target.value })} /></div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenManual(false)}>Cancelar</Button>
                  <Button onClick={() => lancarManual.mutate()}
                    disabled={!manualForm.sup_compra_pedido_id || !manualForm.numero || !manualForm.fornecedor_id || lancarManual.isPending}>
                    {lancarManual.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</> : "Criar NF Manual"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={openImport} onOpenChange={setOpenImport}>
              <DialogTrigger asChild>
                <Button><Upload className="mr-2 h-4 w-4" /> Importar XML</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Importar XML de NFe</DialogTitle></DialogHeader>
                <div className="space-y-4 py-2">
                  <div
                    onDrop={onDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed rounded-md p-8 text-center cursor-pointer hover:bg-muted/40 transition"
                  >
                    <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
                    <p className="font-medium">Arraste o XML aqui ou clique para selecionar</p>
                    <p className="text-xs text-muted-foreground mt-1">Apenas arquivos .xml de NFe modelo 55</p>
                    <input ref={fileRef} type="file" accept=".xml,application/xml,text/xml" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                    {xmlContent && (
                      <p className="mt-3 text-xs text-success">✓ XML carregado ({(xmlContent.length / 1024).toFixed(1)} KB)</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2">
                      <Label>Pedido de Compra</Label>
                      <Select value={importForm.sup_compra_pedido_id ?? ""} onValueChange={(v) => {
                        const pedido = pcsAprovados.find((p: any) => p.id === v);
                        setImportForm({ ...importForm, sup_compra_pedido_id: v, fornecedor_id: pedido?.fornecedor_id });
                      }}>
                        <SelectTrigger><SelectValue placeholder="Selecione o pedido que originou a NF" /></SelectTrigger>
                        <SelectContent>
                          {pcsAprovados.map((p: any) => (
                            <SelectItem key={p.id} value={p.id}>{p.numero} — {fmtBRL(p.valor_total)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Destino</Label>
                      <Select value={importForm.destino} onValueChange={(v) => setImportForm({ ...importForm, destino: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="estoque">Estoque (almoxarifado)</SelectItem>
                          <SelectItem value="contrato">Consumo direto contrato</SelectItem>
                          <SelectItem value="consumo_imediato">Consumo imediato (CC)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Almoxarifado</Label>
                      <Select value={importForm.almoxarifado_id ?? ""} onValueChange={(v) => setImportForm({ ...importForm, almoxarifado_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Matriz (padrão)" /></SelectTrigger>
                        <SelectContent>
                          {almoxarifados.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.codigo} — {a.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {importForm.destino !== "estoque" && (
                      <>
                        <div>
                          <Label>Contrato</Label>
                          <Select value={importForm.contrato_id ?? ""} onValueChange={(v) => setImportForm({ ...importForm, contrato_id: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              {contratos.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.numero}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Centro de Custo</Label>
                          <Select value={importForm.centro_custo_id ?? ""} onValueChange={(v) => setImportForm({ ...importForm, centro_custo_id: v })}>
                            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                            <SelectContent>
                              {ccs.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1">
                    <p className="flex items-center gap-2"><AlertTriangle className="h-3 w-3" /> <strong>Produtos novos</strong> serão cadastrados automaticamente e marcados como "pendente revisão".</p>
                    <p className="flex items-center gap-2"><AlertTriangle className="h-3 w-3" /> <strong>Fornecedor</strong> será criado automaticamente se o CNPJ não existir.</p>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenImport(false)}>Cancelar</Button>
                  <Button onClick={importar} disabled={!xmlContent || importing}>
                    {importing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importando…</> : "Importar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Duas origens, duas abas: o que alguém importou à mão e o que a Receita
          entregou sozinha. Separadas de propósito — misturar faria parecer que
          o resumo vindo da SEFAZ é uma NF incompleta no nosso sistema, quando
          é outra coisa: uma nota que existe e ainda não foi trazida por
          inteiro. */}
      <Tabs defaultValue="importadas">
        <TabsList>
          <TabsTrigger value="importadas">Importadas</TabsTrigger>
          <TabsTrigger value="sefaz">Recebidas da Receita</TabsTrigger>
        </TabsList>

        <TabsContent value="sefaz" className="pt-4">
          <PainelNotasSefaz />
        </TabsContent>

        <TabsContent value="importadas" className="space-y-6 pt-4">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Total NFs</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{kpis.total}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Importadas</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{kpis.importadas}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Validadas</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{kpis.validadas}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Lançadas</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-success">{kpis.lancadas}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Valor lançado</CardTitle></CardHeader><CardContent><p className="text-xl font-bold">{fmtBRL(kpis.valorTotal)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap">
          <CardTitle className="text-base">{filtradas.length} NF(s)</CardTitle>
          <div className="flex gap-2">
            <Input placeholder="Buscar nº, fornecedor, chave..." value={busca} onChange={(e) => setBusca(e.target.value)} className="w-64" />
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {Object.entries(statusConfig).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : filtradas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma NF importada. Clique em <Badge variant="outline">Importar XML</Badge>.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((n) => {
                  const s = statusConfig[n.status] ?? statusConfig.importada;
                  return (
                    <TableRow key={n.id}>
                      <TableCell className="font-medium">{n.numero}/{n.serie ?? "1"}</TableCell>
                      <TableCell className="text-xs">{new Date(n.data_emissao).toLocaleDateString("pt-BR")}</TableCell>
                      <TableCell><div className="font-medium text-sm">{n.fornecedor_razao ?? "—"}</div></TableCell>
                      <TableCell className="text-xs">{n.fornecedor_cnpj}</TableCell>
                      <TableCell className="text-right font-medium">{fmtBRL(n.valor_total)}</TableCell>
                      <TableCell><Badge variant={s.variant} className="text-[10px]">{s.label}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => { setNfSelecionada(n); setOpenDetail(true); }}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {/* Detalhe da NF */}
      <Dialog open={openDetail} onOpenChange={setOpenDetail}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              NF {nfSelecionada?.numero}/{nfSelecionada?.serie ?? "1"}
              {nfSelecionada && (
                <Badge variant={statusConfig[nfSelecionada.status]?.variant} className="text-[10px]">
                  {statusConfig[nfSelecionada.status]?.label}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {nfSelecionada && (
            <Tabs defaultValue="cabecalho">
              <TabsList>
                <TabsTrigger value="cabecalho">Cabeçalho</TabsTrigger>
                <TabsTrigger value="itens">Itens ({itens.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="cabecalho" className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><Label>Chave de acesso</Label><p className="font-mono text-xs break-all">{nfSelecionada.chave_acesso}</p></div>
                  <div><Label>Natureza</Label><p>{nfSelecionada.natureza_operacao ?? "—"}</p></div>
                  <div><Label>Fornecedor</Label><p>{nfSelecionada.fornecedor_razao}</p></div>
                  <div><Label>CNPJ</Label><p>{nfSelecionada.fornecedor_cnpj}</p></div>
                  <div><Label>Emissão</Label><p>{new Date(nfSelecionada.data_emissao).toLocaleDateString("pt-BR")}</p></div>
                  <div><Label>Entrada</Label><p>{nfSelecionada.data_entrada ? new Date(nfSelecionada.data_entrada).toLocaleDateString("pt-BR") : "—"}</p></div>
                  <div><Label>Valor produtos</Label><p>{fmtBRL(nfSelecionada.valor_produtos)}</p></div>
                  <div><Label>Frete</Label><p>{fmtBRL(nfSelecionada.valor_frete)}</p></div>
                  <div><Label>ICMS</Label><p>{fmtBRL(nfSelecionada.valor_icms)}</p></div>
                  <div><Label>IPI</Label><p>{fmtBRL(nfSelecionada.valor_ipi)}</p></div>
                  <div className="col-span-2"><Label>Valor total</Label><p className="text-xl font-bold">{fmtBRL(nfSelecionada.valor_total)}</p></div>
                </div>
              </TabsContent>

              <TabsContent value="itens" className="pt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Cód. forn.</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="text-right">Qtd.</TableHead>
                      <TableHead className="text-right">V. Un.</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itens.map((it) => {
                      const s = itemStatusConfig[it.status] ?? itemStatusConfig.ok;
                      return (
                        <TableRow key={it.id}>
                          <TableCell>{it.numero_item}</TableCell>
                          <TableCell className="text-xs">{it.codigo_fornecedor ?? "—"}</TableCell>
                          <TableCell>
                            <div className="text-sm">{it.descricao_original}</div>
                            {it.produto_criado_auto && <span className="text-[10px] text-warning">Produto criado automaticamente</span>}
                          </TableCell>
                          <TableCell className="text-right">{fmtQtd(it.quantidade)} {it.unidade}</TableCell>
                          <TableCell className="text-right">{fmtBRL(it.valor_unitario)}</TableCell>
                          <TableCell className="text-right font-medium">{fmtBRL(it.valor_total)}</TableCell>
                          <TableCell><Badge variant={s.variant} className="text-[10px]">{s.label}</Badge></TableCell>
                          <TableCell>
                            {["importada", "validada"].includes(nfSelecionada?.status) && (
                              <div className="flex min-w-64 gap-2">
                                <Select value={vinculosItens[it.id] ?? it.sup_item_id ?? ""}
                                  onValueChange={(valor) => setVinculosItens({ ...vinculosItens, [it.id]: valor })}>
                                <SelectTrigger><SelectValue placeholder="Vincular ao catálogo" /></SelectTrigger>
                                  <SelectContent>{itensCatalogo
                                    .filter((item) => item.empresa_id === nfSelecionada.empresa_id)
                                    .map((item) => (
                                      <SelectItem key={item.id} value={item.id}>{item.nome}</SelectItem>
                                    ))}</SelectContent>
                                </Select>
                                <Button size="sm" variant="outline" onClick={() => vincularItemMut.mutate(it.id)}
                                  disabled={!vinculosItens[it.id] || vincularItemMut.isPending}>
                                  {it.sup_item_id ? "Revincular" : "Vincular"}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          )}

          <DialogFooter className="gap-2 flex-wrap">
            {nfSelecionada?.status === "importada" && (
              <Button variant="outline" onClick={() => validarMut.mutate(nfSelecionada.id)} disabled={validarMut.isPending}>
                <CheckCircle2 className="mr-2 h-4 w-4" /> Validar e lançar no estoque
              </Button>
            )}
            {(nfSelecionada?.status === "importada" || nfSelecionada?.status === "validada") && (
              <Button onClick={() => lancarMut.mutate(nfSelecionada.id)} disabled={lancarMut.isPending}>
                <PackageCheck className="mr-2 h-4 w-4" /> Lançar no Estoque
              </Button>
            )}
            {nfSelecionada?.status !== "lancada_estoque" && nfSelecionada?.status !== "cancelada" && (
              <Button variant="destructive" onClick={() => { if (confirm("Cancelar esta NF?")) cancelarMut.mutate(nfSelecionada.id); }}>
                <XCircle className="mr-2 h-4 w-4" /> Cancelar
              </Button>
            )}
            <Button variant="outline" onClick={() => setOpenDetail(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
