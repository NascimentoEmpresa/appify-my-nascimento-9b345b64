import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/PageHeader";
import { useList } from "@/hooks/useGenericCrud";
import { useContratosSelecao } from "@/hooks/useContratosERP";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { Plus, AlertTriangle, Package, Boxes, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { fmtBRL } from "@/components/crud/EntityCrudPage";

const fmtQtd = (n: any) => Number(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 4 });

export default function Estoque() {
  const qc = useQueryClient();
  const { data: empresaId } = useEmpresaId();
  const { data: almoxarifados = [] } = useList<any>("almoxarifado", { orderBy: "codigo", ascending: true });
  const { data: produtos = [] } = useList<any>("produto", { orderBy: "codigo", ascending: true });
  const { data: contratos = [] } = useContratosSelecao();
  const { data: ccs = [] } = useList<any>("centros_custo", { orderBy: "codigo", ascending: true });

  const { data: saldos = [], isLoading } = useQuery<any[]>({
    queryKey: ["v_estoque_consolidado"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("v_estoque_consolidado").select("*");
      if (error) throw error;
      return data ?? [];
    },
  });

  const [filtroAlmox, setFiltroAlmox] = useState<string>("todos");
  const [filtroBusca, setFiltroBusca] = useState("");
  const [openMov, setOpenMov] = useState(false);
  const [mov, setMov] = useState<any>({ tipo: "entrada", quantidade: 0, custo_unitario: 0 });

  const filtrados = useMemo(() => saldos.filter((s) => {
    if (filtroAlmox !== "todos" && s.almoxarifado_id !== filtroAlmox) return false;
    if (filtroBusca && !`${s.produto_codigo} ${s.produto_descricao}`.toLowerCase().includes(filtroBusca.toLowerCase())) return false;
    return true;
  }), [saldos, filtroAlmox, filtroBusca]);

  const kpis = useMemo(() => ({
    skus: filtrados.length,
    valor: filtrados.reduce((s, r) => s + Number(r.valor_total_estoque ?? 0), 0),
    abaixoMin: filtrados.filter((r) => r.abaixo_minimo).length,
    reservado: filtrados.reduce((s, r) => s + Number(r.quantidade_reservada_total ?? 0), 0),
  }), [filtrados]);

  const criarMov = useMutation({
    mutationFn: async (payload: any) => {
      const insert = {
        ...payload,
        empresa_id: empresaId,
        origem: "ajuste_manual" as const,
        data_movimento: new Date().toISOString(),
      };
      const { error } = await (supabase as any).from("estoque_movimento").insert(insert);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["v_estoque_consolidado"] });
      qc.invalidateQueries({ queryKey: ["estoque_movimento"] });
      qc.invalidateQueries({ queryKey: ["produto"] });
      toast.success("Movimentação registrada");
      setOpenMov(false);
      setMov({ tipo: "entrada", quantidade: 0, custo_unitario: 0 });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao registrar"),
  });

  const submitMov = () => {
    if (!mov.almoxarifado_id || !mov.produto_id || !mov.quantidade) {
      toast.error("Preencha almoxarifado, produto e quantidade");
      return;
    }
    if (mov.tipo === "transferencia" && !mov.almoxarifado_destino_id) {
      toast.error("Transferência exige almoxarifado de destino");
      return;
    }
    criarMov.mutate(mov);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque"
        subtitle="Saldos consolidados, alertas de mínimo e movimentações manuais."
        actions={
          <Dialog open={openMov} onOpenChange={setOpenMov}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> Nova movimentação</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Registrar movimentação manual</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-2">
                <div>
                  <Label>Tipo *</Label>
                  <Select value={mov.tipo} onValueChange={(v) => setMov({ ...mov, tipo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entrada">Entrada</SelectItem>
                      <SelectItem value="saida">Saída</SelectItem>
                      <SelectItem value="consumo">Consumo (contrato)</SelectItem>
                      <SelectItem value="transferencia">Transferência</SelectItem>
                      <SelectItem value="ajuste">Ajuste de inventário</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Almoxarifado origem *</Label>
                  <Select value={mov.almoxarifado_id ?? ""} onValueChange={(v) => setMov({ ...mov, almoxarifado_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {almoxarifados.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.codigo} — {a.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {mov.tipo === "transferencia" && (
                  <div>
                    <Label>Almoxarifado destino *</Label>
                    <Select value={mov.almoxarifado_destino_id ?? ""} onValueChange={(v) => setMov({ ...mov, almoxarifado_destino_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {almoxarifados.filter((a: any) => a.id !== mov.almoxarifado_id).map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>{a.codigo} — {a.nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="col-span-2">
                  <Label>Produto *</Label>
                  <Select value={mov.produto_id ?? ""} onValueChange={(v) => setMov({ ...mov, produto_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {produtos.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.codigo} — {p.descricao}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantidade *</Label>
                  <Input type="number" step="0.01" value={mov.quantidade ?? 0} onChange={(e) => setMov({ ...mov, quantidade: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Custo unitário</Label>
                  <Input type="number" step="0.0001" value={mov.custo_unitario ?? 0} onChange={(e) => setMov({ ...mov, custo_unitario: Number(e.target.value) })} />
                </div>
                {mov.tipo === "consumo" && (
                  <>
                    <div>
                      <Label>Contrato</Label>
                      <Select value={mov.contrato_id ?? ""} onValueChange={(v) => setMov({ ...mov, contrato_id: v })}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Centro de custo</Label>
                      <Select value={mov.centro_custo_id ?? ""} onValueChange={(v) => setMov({ ...mov, centro_custo_id: v })}>
                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          {ccs.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.codigo} — {c.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
                <div className="col-span-2">
                  <Label>Documento</Label>
                  <Input value={mov.documento ?? ""} onChange={(e) => setMov({ ...mov, documento: e.target.value })} placeholder="NF nº, OS, etc." />
                </div>
                <div className="col-span-2">
                  <Label>Observações</Label>
                  <Textarea value={mov.observacoes ?? ""} onChange={(e) => setMov({ ...mov, observacoes: e.target.value })} />
                </div>
                {(mov.tipo === "saida" || mov.tipo === "consumo") && (
                  <div className="col-span-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs">
                    <div className="flex items-center gap-2 mb-2 font-medium">
                      <AlertTriangle className="h-4 w-4" /> Forçar saldo negativo
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={!!mov.permitiu_negativo} onChange={(e) => setMov({ ...mov, permitiu_negativo: e.target.checked })} />
                      <span>Permitir mesmo sem saldo (apenas admin/almoxarife)</span>
                    </div>
                    {mov.permitiu_negativo && (
                      <Textarea className="mt-2" placeholder="Justificativa obrigatória"
                        value={mov.justificativa_negativo ?? ""} onChange={(e) => setMov({ ...mov, justificativa_negativo: e.target.value })} />
                    )}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenMov(false)}>Cancelar</Button>
                <Button onClick={submitMov} disabled={criarMov.isPending}>{criarMov.isPending ? "Salvando..." : "Registrar"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><Boxes className="h-4 w-4" /> SKUs em estoque</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{kpis.skus}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><Package className="h-4 w-4" /> Valor total</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{fmtBRL(kpis.valor)}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><TrendingDown className="h-4 w-4" /> Abaixo do mínimo</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-destructive">{kpis.abaixoMin}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> Reservado</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">{fmtQtd(kpis.reservado)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-base">{filtrados.length} item(ns)</CardTitle>
          <div className="flex gap-2">
            <Input placeholder="Buscar produto..." value={filtroBusca} onChange={(e) => setFiltroBusca(e.target.value)} className="w-56" />
            <Select value={filtroAlmox} onValueChange={setFiltroAlmox}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os almoxarifados</SelectItem>
                {almoxarifados.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.codigo} — {a.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : filtrados.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum item em estoque. Registre uma <Badge variant="outline">entrada</Badge> para começar.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Almox.</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Qtd. total</TableHead>
                  <TableHead className="text-right">Reservada</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-right">Custo médio</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((s) => (
                  <TableRow key={`${s.almoxarifado_id}-${s.produto_id}`}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {s.is_matriz && <Badge variant="outline" className="text-[10px]">M</Badge>}
                        <span className="text-sm">{s.almoxarifado_nome}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{s.produto_codigo}</div>
                      <div className="text-xs text-muted-foreground">{s.produto_descricao}</div>
                    </TableCell>
                    <TableCell className="text-right">{fmtQtd(s.quantidade_total)} {s.unidade}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmtQtd(s.quantidade_reservada_total)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtQtd(s.quantidade_disponivel)}</TableCell>
                    <TableCell className="text-right">{fmtBRL(s.custo_unitario_medio)}</TableCell>
                    <TableCell className="text-right">{fmtBRL(s.valor_total_estoque)}</TableCell>
                    <TableCell>
                      {s.abaixo_minimo
                        ? <Badge variant="destructive" className="text-[10px]">Abaixo mín.</Badge>
                        : <Badge variant="outline" className="text-[10px]">OK</Badge>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
