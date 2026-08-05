import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/layout/PageHeader";
import { CampoBipagem } from "@/components/suprimentos/CampoBipagem";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useItens, LABEL_TIPO_ITEM, type TipoItem } from "@/hooks/useSupCatalogo";
import {
  useAlmoxarifados, useEstoqueLista, useTagsDoItem, useEntradaEstoque, useDevolverTags,
  useRemoverTag, useFornecedores, type LinhaEstoque, type TipoTag, type UnidadeEntrada,
} from "@/hooks/useSupEstoque";
import {
  PackagePlus, Search, AlertTriangle, Boxes, Undo2, Trash2, ShieldAlert, Plus, X, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Estoque & Etiquetas — o almoxarifado.
 *
 * O saldo NUNCA é uma coluna guardada: vem da view sup_estoque_saldo, com uma
 * fórmula só. No legado havia um trigger e uma query calculando isso de formas
 * diferentes, e ninguém sabia qual valia (§12.8).
 *
 * Entrada e devolução são por bipagem — a pistola manda o código e um Enter.
 */
export default function EstoqueEtiquetas() {
  const { data: empresaId } = useEmpresaId();
  const { data: linhas = [], isLoading, error } = useEstoqueLista(empresaId ?? null);
  const [busca, setBusca] = useState("");
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [devolucaoAberta, setDevolucaoAberta] = useState(false);
  const [detalhe, setDetalhe] = useState<LinhaEstoque | null>(null);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return linhas;
    return linhas.filter((l) =>
      `${l.material} ${l.almoxarifado} ${l.tamanhos.join(" ")}`.toLowerCase().includes(t));
  }, [linhas, busca]);

  const kpis = useMemo(() => ({
    materiais: linhas.length,
    disponivel: linhas.reduce((s, l) => s + l.disponivel, 0),
    abaixo: linhas.filter((l) => l.estoque_minimo > 0 && l.disponivel < l.estoque_minimo).length,
    etiquetas: linhas.reduce((s, l) => s + l.etiquetas, 0),
  }), [linhas]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque & Etiquetas"
        subtitle="Cada peça é rastreada por uma etiqueta física. Entrada, devolução e baixa são por bipagem."
        module="Suprimentos"
        breadcrumb={["Estoque & Etiquetas"]}
        actions={
          <>
            <Button variant="outline" onClick={() => setDevolucaoAberta(true)}>
              <Undo2 className="mr-2 h-4 w-4" /> Devolução
            </Button>
            <Button onClick={() => setEntradaAberta(true)}>
              <PackagePlus className="mr-2 h-4 w-4" /> Entrada
            </Button>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rotulo="Materiais" valor={kpis.materiais} icone={Boxes} />
        <Kpi rotulo="Unidades disponíveis" valor={kpis.disponivel} icone={Tag} />
        <Kpi rotulo="Etiquetas cadastradas" valor={kpis.etiquetas} icone={Tag} />
        <Kpi rotulo="Abaixo do mínimo" valor={kpis.abaixo} icone={AlertTriangle}
             destaque={kpis.abaixo > 0} />
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)}
               placeholder="Buscar material, almoxarifado, tamanho…" className="pl-9" />
      </div>

      {error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <p className="font-medium">Não foi possível carregar o estoque.</p>
          <p className="max-w-md text-sm text-muted-foreground">{(error as Error).message}</p>
        </div>
      ) : isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : filtradas.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Boxes className="h-10 w-10 text-muted-foreground/50" />
          <p className="font-medium">
            {busca ? `Nenhum resultado para "${busca}"` : "Estoque vazio."}
          </p>
          <p className="text-sm text-muted-foreground">
            {busca ? "Tente outro termo." : "Comece dando entrada nas etiquetas recebidas."}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Almoxarifado</TableHead>
                  <TableHead>Tamanhos livres</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-right">Consumido</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((l) => {
                  const critico = l.estoque_minimo > 0 && l.disponivel < l.estoque_minimo;
                  return (
                    <TableRow key={l.item_estoque_id} className="cursor-pointer"
                              onClick={() => setDetalhe(l)}>
                      <TableCell className="font-medium">
                        {l.material}
                        <Badge variant="secondary" className="ml-2 text-[10px]">
                          {LABEL_TIPO_ITEM[l.tipo_material as TipoItem] ?? l.tipo_material}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.almoxarifado}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {l.tamanhos.length === 0
                            ? <span className="text-xs text-muted-foreground">—</span>
                            : l.tamanhos.map((t) => (
                                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>))}
                        </div>
                      </TableCell>
                      <TableCell className={cn("text-right font-semibold", critico && "text-destructive")}>
                        {l.disponivel}
                        {critico && <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.consumido}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.estoque_minimo || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <DialogEntrada aberto={entradaAberta} onFechar={() => setEntradaAberta(false)} empresaId={empresaId ?? null} />
      <DialogDevolucao aberto={devolucaoAberta} onFechar={() => setDevolucaoAberta(false)} />
      <DialogDetalhe linha={detalhe} onFechar={() => setDetalhe(null)} />
    </div>
  );
}

function Kpi({ rotulo, valor, icone: Icone, destaque }: {
  rotulo: string; valor: number; icone: any; destaque?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg border p-3",
      destaque && "border-destructive/40 bg-destructive/5")}>
      <Icone className={cn("h-5 w-5 shrink-0 text-muted-foreground", destaque && "text-destructive")} />
      <div className="min-w-0">
        <p className={cn("text-2xl font-bold leading-none", destaque && "text-destructive")}>{valor}</p>
        <p className="truncate text-xs text-muted-foreground">{rotulo}</p>
      </div>
    </div>
  );
}

// ── Entrada ──────────────────────────────────────────────────────────

interface BlocoUnidade { tamanho: string; tipo: TipoTag; codigos: string[]; quantidade: string }
const BLOCO_VAZIO: BlocoUnidade = { tamanho: "", tipo: "unico", codigos: [], quantidade: "1" };

function DialogEntrada({ aberto, onFechar, empresaId }: {
  aberto: boolean; onFechar: () => void; empresaId: string | null;
}) {
  const { data: almoxarifados = [] } = useAlmoxarifados(empresaId);
  const { data: materiais = [] } = useItens(empresaId);
  const { data: fornecedores = [] } = useFornecedores(empresaId);
  const entrada = useEntradaEstoque();

  const [almox, setAlmox] = useState("");
  const [material, setMaterial] = useState("");
  const [buscaMat, setBuscaMat] = useState("");
  const [valor, setValor] = useState("");
  const [minimo, setMinimo] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [blocos, setBlocos] = useState<BlocoUnidade[]>([{ ...BLOCO_VAZIO }]);

  const matSelecionado = materiais.find((m) => m.id === material);
  const filtrados = useMemo(() => {
    const t = buscaMat.trim().toLowerCase();
    return t ? materiais.filter((m) => m.nome.toLowerCase().includes(t)).slice(0, 40) : materiais.slice(0, 40);
  }, [materiais, buscaMat]);

  const total = blocos.reduce((s, b) =>
    s + (b.tipo === "massa" ? (b.codigos.length ? Number(b.quantidade || 0) : 0) : b.codigos.length), 0);

  const alterar = (i: number, patch: Partial<BlocoUnidade>) =>
    setBlocos((s) => s.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const limpar = () => {
    setAlmox(""); setMaterial(""); setBuscaMat(""); setValor(""); setMinimo("");
    setFornecedor(""); setBlocos([{ ...BLOCO_VAZIO }]);
  };

  const enviar = async () => {
    const unidades: UnidadeEntrada[] = blocos
      .filter((b) => b.codigos.length > 0)
      .map((b) => b.tipo === "massa"
        ? { tamanho: b.tamanho, tipo: "massa", codigo: b.codigos[0], quantidade: Math.max(Number(b.quantidade || 1), 1) }
        : { tamanho: b.tamanho, tipo: "unico", codigos: b.codigos });
    if (!almox || !material || unidades.length === 0) return;

    await entrada.mutateAsync({
      almoxarifado_id: almox, sup_item_id: material,
      valor_unitario: Number(valor || 0), estoque_minimo: Number(minimo || 0),
      fornecedor_id: fornecedor || null, unidades,
    });
    limpar();
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) { limpar(); onFechar(); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Entrada no estoque</DialogTitle></DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Almoxarifado *</Label>
              <Select value={almox} onValueChange={setAlmox}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {almoxarifados.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Fornecedor</Label>
              <Select value={fornecedor} onValueChange={setFornecedor}>
                <SelectTrigger>
                  <SelectValue placeholder={fornecedores.length ? "Selecione (opcional)" : "Nenhum cadastrado"} />
                </SelectTrigger>
                <SelectContent>
                  {fornecedores.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.nome_fantasia || f.razao_social}
                      {f.cnpj_cpf ? ` · ${f.cnpj_cpf}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fornecedores.length === 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Cadastre em Suprimentos → Fornecedores.
                </p>
              )}
            </div>
          </div>

          <div>
            <Label>Material *</Label>
            {matSelecionado ? (
              <div className="mt-1 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="flex-1 font-medium">{matSelecionado.nome}</span>
                <Badge variant="secondary" className="text-[10px]">{LABEL_TIPO_ITEM[matSelecionado.tipo]}</Badge>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setMaterial("")}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <Input value={buscaMat} onChange={(e) => setBuscaMat(e.target.value)}
                       placeholder="Buscar no catálogo…" />
                <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-md border p-1">
                  {filtrados.map((m) => (
                    <button key={m.id} type="button" onClick={() => setMaterial(m.id)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                      <span className="flex-1 truncate">{m.nome}</span>
                      <Badge variant="secondary" className="text-[10px]">{LABEL_TIPO_ITEM[m.tipo]}</Badge>
                    </button>
                  ))}
                  {filtrados.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">Nada encontrado.</p>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Valor unitário</Label>
              <Input type="number" step="0.01" min="0" value={valor}
                     onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              <Label>Estoque mínimo</Label>
              <Input type="number" min="0" value={minimo}
                     onChange={(e) => setMinimo(e.target.value)} placeholder="0" />
            </div>
          </div>

          {/* Um bloco por tamanho recebido. */}
          <div className="space-y-3">
            {blocos.map((b, i) => (
              <div key={i} className="rounded-lg border p-3">
                <div className="mb-2 flex items-end gap-2">
                  <div className="w-28">
                    <Label className="text-xs">Tamanho</Label>
                    <Input value={b.tamanho} onChange={(e) => alterar(i, { tamanho: e.target.value })}
                           placeholder="M, 42…" className="h-9" />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">Tipo de etiqueta</Label>
                    <Select value={b.tipo} onValueChange={(v) => alterar(i, { tipo: v as TipoTag, codigos: [] })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unico">🔵 Única — 1 etiqueta por peça</SelectItem>
                        <SelectItem value="massa">🟠 Em massa — 1 etiqueta, N unidades</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {b.tipo === "massa" && (
                    <div className="w-28">
                      <Label className="text-xs">Unidades</Label>
                      <Input type="number" min="1" value={b.quantidade}
                             onChange={(e) => alterar(i, { quantidade: e.target.value })} className="h-9" />
                    </div>
                  )}
                  {blocos.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive"
                            onClick={() => setBlocos((s) => s.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <CampoBipagem
                  codigos={b.codigos}
                  onChange={(c) => alterar(i, { codigos: c })}
                  max={b.tipo === "massa" ? 1 : undefined}
                  autoFoco={i === 0}
                  placeholder={b.tipo === "massa" ? "Bipe a etiqueta do lote…" : "Bipe cada peça…"}
                />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setBlocos((s) => [...s, { ...BLOCO_VAZIO }])}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Outro tamanho
            </Button>
          </div>
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-sm text-muted-foreground">
            Total: <strong>{total}</strong> unidade(s)
          </span>
          <Button variant="outline" onClick={() => { limpar(); onFechar(); }}>Cancelar</Button>
          <Button disabled={!almox || !material || total === 0 || entrada.isPending} onClick={enviar}>
            Dar entrada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Devolução ────────────────────────────────────────────────────────

function DialogDevolucao({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const devolver = useDevolverTags();
  const [codigos, setCodigos] = useState<string[]>([]);
  const [estado, setEstado] = useState("higienizado");
  const [obs, setObs] = useState("");

  const enviar = async () => {
    if (codigos.length === 0) return;
    await devolver.mutateAsync({ codigos, estado, observacao: obs || null });
    setCodigos([]); setObs("");
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) { setCodigos([]); onFechar(); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Devolução ao estoque</DialogTitle></DialogHeader>
        <div className="space-y-4 py-1">
          <p className="text-sm text-muted-foreground">
            Bipe as peças que voltaram. Elas retornam ao saldo e ficam disponíveis de novo.
            A trilha de quem as usou fica registrada no histórico.
          </p>
          <CampoBipagem codigos={codigos} onChange={setCodigos} placeholder="Bipe a peça devolvida…" />
          <div>
            <Label>Estado da peça</Label>
            <Select value={estado} onValueChange={setEstado}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="higienizado">Higienizada</SelectItem>
                <SelectItem value="novo">Nova / sem uso</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Observação</Label>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2}
                      placeholder="Ex.: colaborador desligado." />
          </div>
          <p className="text-xs text-muted-foreground">
            Só etiqueta única tem devolução. Material de consumo (etiqueta em massa) não volta —
            para corrigir saldo, use ajuste de estoque.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setCodigos([]); onFechar(); }}>Cancelar</Button>
          <Button disabled={codigos.length === 0 || devolver.isPending} onClick={enviar}>
            Devolver {codigos.length > 0 && `(${codigos.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Detalhe ──────────────────────────────────────────────────────────

function DialogDetalhe({ linha, onFechar }: { linha: LinhaEstoque | null; onFechar: () => void }) {
  const { data: tags = [], isLoading } = useTagsDoItem(linha?.item_estoque_id ?? null);
  const remover = useRemoverTag();
  const [filtro, setFiltro] = useState("");

  const visiveis = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return t ? tags.filter((x) => `${x.codigo} ${x.tamanho ?? ""}`.toLowerCase().includes(t)) : tags;
  }, [tags, filtro]);

  return (
    <Dialog open={!!linha} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {linha?.material}
            <Badge variant="outline">{linha?.disponivel} disponível(is)</Badge>
            {(linha?.consumido ?? 0) > 0 && (
              <Badge variant="secondary">{linha?.consumido} já usada(s)</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <Input value={filtro} onChange={(e) => setFiltro(e.target.value)}
               placeholder="Filtrar por código ou tamanho…" className="mb-2" />

        {isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <div className="space-y-1">
            {visiveis.map((t) => (
              <div key={t.id}
                className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                  t.usado && "bg-muted/50 text-muted-foreground")}>
                <span className="w-8 shrink-0 text-xs text-muted-foreground">#{t.sequencia}</span>
                <span className="flex-1 truncate font-mono text-xs">{t.codigo}</span>
                {t.tamanho && <Badge variant="outline" className="text-[10px]">{t.tamanho}</Badge>}
                <Badge variant="secondary" className="text-[10px]">
                  {t.tipo === "massa" ? `massa · ${t.quantidade_massa}/${t.quantidade_original_massa}` : "única"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">{t.estado}</Badge>
                {t.usado
                  ? <span className="text-[11px]">usada{t.usado_por_nome ? ` · ${t.usado_por_nome}` : ""}</span>
                  : (
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                      onClick={() => {
                        if (confirm(`Remover a etiqueta ${t.codigo} do estoque?`)) remover.mutate(t.codigo);
                      }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
              </div>
            ))}
            {visiveis.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma etiqueta.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
