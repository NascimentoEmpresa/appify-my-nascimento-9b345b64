import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
import { TIPOS_MATERIAL, TODOS_OS_TIPOS } from "@/lib/suprimentos/tiposMaterial";
import { useItens, LABEL_TIPO_ITEM, type TipoItem } from "@/hooks/useSupCatalogo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router-dom";
import {
  useAlmoxarifados, useEstoqueLista, useTagsDoItem, useEntradaPorQuantidade, useDevolverTags,
  useRemoverTag, useFornecedores, useHistoricoDoMaterial, useInventario,
  useHistoricoPreco, fmtBRL,
  type LinhaEstoque, type RemessaEntrada, type Movimento, type ResultadoInventario,
} from "@/hooks/useSupEstoque";
import {
  PackagePlus, Search, AlertTriangle, Boxes, Undo2, Trash2, ShieldAlert, Plus, X, Tag,
  ClipboardCheck, History, ArrowDownToLine, ArrowUpFromLine, RotateCcw, Check, Coins,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { caAtendeLaudo } from "@/lib/sst/laudo";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";

// A tabela de laudos é nova e ainda não existe em types.ts (regra R8).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

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
  const [tipo, setTipo] = useState<string>(TODOS_OS_TIPOS);

  // "alterar" e a acao que movimenta estoque. Quem tem so "visualizar" ve
  // tudo e nao mexe em nada — e o modo consulta que o Cassio pediu.
  const { data: acessoAlterar } = useAccessibleMenus("alterar");
  const podeAlterar = acessoAlterar?.codes.has("sup_estoque") ?? false;
  const [entradaAberta, setEntradaAberta] = useState(false);
  const [devolucaoAberta, setDevolucaoAberta] = useState(false);
  const [detalhe, setDetalhe] = useState<LinhaEstoque | null>(null);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (tipo !== TODOS_OS_TIPOS && l.tipo_material !== tipo) return false;
      if (!t) return true;
      return `${l.codigo_item ?? ""} ${l.material} ${l.almoxarifado} ${l.tamanhos.join(" ")}`.toLowerCase().includes(t);
    });
  }, [linhas, busca, tipo]);

  /** Quantos materiais há de cada tipo, para o filtro dizer o que vai achar. */
  const porTipo = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of linhas) c[l.tipo_material] = (c[l.tipo_material] ?? 0) + 1;
    return c;
  }, [linhas]);

  const kpis = useMemo(() => ({
    materiais: linhas.length,
    disponivel: linhas.reduce((s, l) => s + l.disponivel, 0),
    abaixo: linhas.filter((l) => l.estoque_minimo > 0 && l.disponivel < l.estoque_minimo).length,
    etiquetas: linhas.reduce((s, l) => s + l.etiquetas, 0),
    // Quanto vale o que está parado no almoxarifado — pedido explícito do
    // chamado, junto com o custo por item (SIS-2026-0199).
    valorTotal: linhas.reduce((s, l) => s + l.valor_total, 0),
    semCusto: linhas.filter((l) => l.disponivel > 0 && l.custo_unitario === 0).length,
  }), [linhas]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Estoque & Etiquetas"
        subtitle="Cada peça é rastreada por uma etiqueta física. Entrada, devolução e baixa são por bipagem."
        module="Suprimentos"
        breadcrumb={["Estoque & Etiquetas"]}
        actions={
          // Entrada e Devolução MOVIMENTAM estoque; consultar não.
          //
          // Até aqui não havia gate nenhum: quem enxergasse o menu podia dar
          // entrada. Pela divisão que o Cassio definiu, o estoquista só
          // consulta e apenas o supervisor movimenta — então Consultar fica
          // para todos e as outras duas pedem `alterar`.
          //
          // Esconder na tela não é a trava: `sup_est_entrada` já exige
          // `can_access(..., 'alterar')` no banco. Aqui é só para não oferecer
          // o que seria negado — falhar depois do clique é pior, porque a
          // pessoa não sabe se errou ou se o sistema quebrou.
          <>
            {/* Consultar é de todo mundo. É o botão que o estoquista usa. */}
            <Button variant="outline" onClick={() => setEntradaAberta(true)}>
              <Search className="mr-2 h-4 w-4" /> Consultar
            </Button>
            {podeAlterar && (
              <>
                <Button variant="outline" onClick={() => setDevolucaoAberta(true)}>
                  <Undo2 className="mr-2 h-4 w-4" /> Devolução
                </Button>
                <Button onClick={() => setEntradaAberta(true)}>
                  <PackagePlus className="mr-2 h-4 w-4" /> Entrada
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi rotulo="Materiais" valor={kpis.materiais} icone={Boxes} />
        <Kpi rotulo="Unidades disponíveis" valor={kpis.disponivel} icone={Tag} />
        <Kpi rotulo="Etiquetas cadastradas" valor={kpis.etiquetas} icone={Tag} />
        <Kpi rotulo="Abaixo do mínimo" valor={kpis.abaixo} icone={AlertTriangle}
             destaque={kpis.abaixo > 0} />
        <Kpi rotulo="Valor total do estoque" valor={fmtBRL(kpis.valorTotal)} icone={Coins} />
      </div>

      {/* O total só é confiável se todo material tiver custo. Sem este aviso o
          número pareceria completo estando pela metade. */}
      {kpis.semCusto > 0 && (
        <p className="text-xs text-muted-foreground">
          {kpis.semCusto} {kpis.semCusto === 1 ? "material com estoque não tem" : "materiais com estoque não têm"} custo
          informado — o valor total acima não considera {kpis.semCusto === 1 ? "ele" : "eles"}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)}
                 placeholder="Buscar material, almoxarifado, tamanho…" className="pl-9" />
        </div>

        {/* O contador em cada opção evita o filtro que zera a tela sem
            explicação — quem escolhe já sabe se vai achar algo. */}
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS_OS_TIPOS}>Todos os tipos ({linhas.length})</SelectItem>
            {TIPOS_MATERIAL.map((t) => (
              <SelectItem key={t.valor} value={t.valor} disabled={!porTipo[t.valor]}>
                {t.rotulo} ({porTipo[t.valor] ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            {busca || tipo !== TODOS_OS_TIPOS
              ? "Nenhum material com esses filtros."
              : "Estoque vazio."}
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
                  <TableHead className="w-28">Código</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead>Almoxarifado</TableHead>
                  <TableHead>Tamanhos livres</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-right">Consumido</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  {/* SIS-2026-0199: o custo já era gravado na entrada e nunca
                      voltava para a tela. É o último valor pago. */}
                  <TableHead className="text-right">Custo unit.</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((l) => {
                  const critico = l.estoque_minimo > 0 && l.disponivel < l.estoque_minimo;
                  return (
                    <TableRow key={l.item_estoque_id} className="cursor-pointer"
                              onClick={() => setDetalhe(l)}>
                      {/* O código do produto vem antes do nome: é por ele que
                          se procura e se bipa, e ele nunca muda (ajuste 7). */}
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {l.codigo_item ?? "—"}
                      </TableCell>
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
                      <TableCell className="text-right">
                        {l.custo_unitario > 0 ? (
                          <span className={cn(l.preco_vencido && "text-amber-600")}>
                            {fmtBRL(l.custo_unitario)}
                            {/* Preço fora da validade negociada: ainda serve de
                                referência, mas não para fechar cotação. */}
                            {l.preco_vencido && <AlertTriangle className="ml-1 inline h-3 w-3" />}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {l.valor_total > 0 ? fmtBRL(l.valor_total) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <DialogEntrada aberto={entradaAberta} onFechar={() => setEntradaAberta(false)}
                     empresaId={empresaId ?? null} podeAlterar={podeAlterar} />
      <DialogDevolucao aberto={devolucaoAberta} onFechar={() => setDevolucaoAberta(false)} />
      <DialogDetalhe linha={detalhe} onFechar={() => setDetalhe(null)} />
    </div>
  );
}

/**
 * O que já se pagou por este material (SIS-2026-0199).
 *
 * Existe porque o valor era sobrescrito a cada entrada e o preço anterior se
 * perdia — então não dava para responder "quanto custava isso antes?", que é a
 * pergunta de quem vai negociar. A seta ao lado mostra se subiu ou desceu em
 * relação ao valor que estava lá.
 */
function HistoricoDePrecos({ linha }: { linha: LinhaEstoque | null }) {
  const { data: precos = [], isLoading } = useHistoricoPreco(linha?.sup_item_id ?? null);

  if (isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>;
  if (precos.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nenhum preço registrado ainda. O histórico começa na próxima entrada com valor informado.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border bg-muted/40 p-3">
        <div>
          <p className="text-xs text-muted-foreground">Último valor pago</p>
          <p className="text-xl font-bold">{fmtBRL(precos[0].valor_unitario)}</p>
        </div>
        {linha?.preco_valido_ate && (
          <div>
            <p className="text-xs text-muted-foreground">Preço válido até</p>
            <p className={cn("text-sm font-medium", linha.preco_vencido && "text-amber-600")}>
              {fmtDataLocal(linha.preco_valido_ate)}
              {linha.preco_vencido && " — vencido"}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {precos.map((p, i) => {
          const subiu = p.valor_anterior != null && p.valor_unitario > p.valor_anterior;
          const desceu = p.valor_anterior != null && p.valor_unitario < p.valor_anterior;
          return (
            <div key={i} className="flex items-start justify-between gap-3 rounded-md border p-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {fmtBRL(p.valor_unitario)}
                  {p.valor_anterior != null && (
                    <span className={cn("ml-2 text-xs font-normal",
                      subiu && "text-destructive", desceu && "text-emerald-600")}>
                      {subiu ? "▲" : desceu ? "▼" : "="} antes {fmtBRL(p.valor_anterior)}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    p.fornecedor_nome,
                    p.almoxarifado,
                    p.origem === "nf" ? "por nota fiscal"
                      : p.origem === "ajuste" ? "cadastro anterior" : "entrada",
                    p.registrado_por_nome,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right text-xs text-muted-foreground">
                <p>{new Date(p.registrado_em).toLocaleDateString("pt-BR")}</p>
                {p.valido_ate && <p>vale até {fmtDataLocal(p.valido_ate)}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 'YYYY-MM-DD' → 'DD/MM/AAAA' sem passar por Date (evita o "andou um dia"). */
function fmtDataLocal(v?: string | null): string {
  if (!v) return "—";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}

function Kpi({ rotulo, valor, icone: Icone, destaque }: {
  // string aceita porque o valor total do estoque vem formatado em R$.
  rotulo: string; valor: number | string; icone: LucideIcon; destaque?: boolean;
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

/**
 * Uma remessa recebida: um tamanho e uma quantidade.
 *
 * AJUSTE 7 DO CASSIO — o que sumiu daqui foi `tipo` (única/massa) e
 * `codigos` (a bipagem etiqueta por etiqueta). "Cada item, ao invés de ter
 * uma tag, ter um código interno do produto, onde somente é adicionado
 * quantidades dele, mais nada."
 *
 * O motivo, na fala dele: "tu tem duas canecas iguais... esse aqui é o tag 02,
 * só que eu dou baixa no 01. Já está errado o meu estoque." Etiqueta por peça
 * obriga quem separa a distinguir duas peças idênticas, e não existe resposta
 * certa. Com código do produto + quantidade, a pergunta some.
 */
interface BlocoUnidade {
  tamanho: string;
  quantidade: string;
  ca_numero: string;
  ca_validade: string;
}
const BLOCO_VAZIO: BlocoUnidade = {
  tamanho: "", quantidade: "1", ca_numero: "", ca_validade: "",
};

function DialogEntrada({ aberto, onFechar, empresaId, podeAlterar }: {
  aberto: boolean; onFechar: () => void; empresaId: string | null; podeAlterar: boolean;
}) {
  // Sem permissão de alterar só existe a consulta, então ela é a aba inicial.
  const [abaModal, setAbaModal] = useState(podeAlterar ? "entrada" : "consultar");
  const { data: almoxarifados = [] } = useAlmoxarifados(empresaId);
  const { data: materiais = [] } = useItens(empresaId);
  const { data: fornecedores = [] } = useFornecedores(empresaId);
  const entrada = useEntradaPorQuantidade();

  const [almox, setAlmox] = useState("");
  const [material, setMaterial] = useState("");
  const [buscaMat, setBuscaMat] = useState("");
  const [tipoMat, setTipoMat] = useState<string>(TODOS_OS_TIPOS);
  const [valor, setValor] = useState("");
  const [precoValidoAte, setPrecoValidoAte] = useState("");
  const [minimo, setMinimo] = useState("");
  const [fornecedor, setFornecedor] = useState("");
  const [blocos, setBlocos] = useState<BlocoUnidade[]>([{ ...BLOCO_VAZIO }]);

  const matSelecionado = materiais.find((m) => m.id === material);
  const materialEhEpi = matSelecionado?.tipo === "epi";
  const laudoAtivo = useQuery({
    queryKey: ["sst_laudo_ativo", material],
    enabled: aberto && !!material && materialEhEpi,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await sb
        .from("sst_laudo_epi")
        .select("validade_minima_meses")
        .eq("sup_item_id", material)
        .eq("ativo", true)
        .maybeSingle();
      if (error) throw error;
      return data?.validade_minima_meses ?? null;
    },
  });
  const filtrados = useMemo(() => {
    const t = buscaMat.trim().toLowerCase();
    return materiais
      .filter((m) => {
        if (tipoMat !== TODOS_OS_TIPOS && m.tipo !== tipoMat) return false;
        return !t || m.nome.toLowerCase().includes(t);
      })
      // O corte em 40 é da versão original: a lista é um seletor, não um
      // relatório, e o catálogo tem mais de mil itens.
      .slice(0, 40);
  }, [materiais, buscaMat, tipoMat]);

  const total = blocos.reduce((s, b) => s + Math.max(Number(b.quantidade || 0), 0), 0);

  const hoje = new Date();
  const hojeCivil = [
    hoje.getFullYear(),
    String(hoje.getMonth() + 1).padStart(2, "0"),
    String(hoje.getDate()).padStart(2, "0"),
  ].join("-");
  const erroCa = useMemo(() => {
    if (!materialEhEpi) return null;
    if (laudoAtivo.error) return "Não foi possível consultar o laudo do SST. Tente novamente antes de dar entrada.";
    if (laudoAtivo.data === null || laudoAtivo.data === undefined) return null;
    const blocosPreenchidos = blocos.filter((bloco) => Number(bloco.quantidade || 0) > 0);
    if (blocosPreenchidos.some((bloco) => !bloco.ca_validade)) {
      return "Informe a validade do CA em todos os blocos de unidades.";
    }
    if (blocosPreenchidos.some((bloco) =>
      !caAtendeLaudo(bloco.ca_validade, laudoAtivo.data, hojeCivil))) {
      return `A validade informada não atende aos ${laudoAtivo.data} meses mínimos exigidos pelo laudo do SST.`;
    }
    return null;
  }, [blocos, hojeCivil, laudoAtivo.data, laudoAtivo.error, materialEhEpi]);

  const alterar = (i: number, patch: Partial<BlocoUnidade>) =>
    setBlocos((s) => s.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  const limpar = () => {
    setAlmox(""); setMaterial(""); setBuscaMat(""); setValor(""); setMinimo("");
    setPrecoValidoAte(""); setFornecedor(""); setBlocos([{ ...BLOCO_VAZIO }]);
  };

  const enviar = async () => {
    const remessas: RemessaEntrada[] = blocos
      .filter((b) => Number(b.quantidade || 0) > 0)
      .map((b) => ({
        tamanho: b.tamanho,
        quantidade: Math.max(Number(b.quantidade), 1),
        // CA pertence à remessa física, não ao cadastro do material: duas
        // caixas do mesmo EPI podem ter certificados diferentes.
        ...(materialEhEpi
          ? { ca_numero: b.ca_numero.trim() || null, ca_validade: b.ca_validade || null }
          : {}),
      }));
    if (!almox || !material || remessas.length === 0 || erroCa) return;

    await entrada.mutateAsync({
      almoxarifado_id: almox, sup_item_id: material,
      valor_unitario: Number(valor || 0), estoque_minimo: Number(minimo || 0),
      preco_valido_ate: precoValidoAte || null,
      fornecedor_id: fornecedor || null, remessas,
    });
    limpar();
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) { limpar(); onFechar(); } }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{podeAlterar ? "Estoque" : "Consultar estoque"}</DialogTitle>
        </DialogHeader>

        {/* Um modal, duas abas. Estoquista tem só "Consultar"; supervisor tem
            as duas — decisão do Cassio, e é ele quem distribui em Acesso por
            Usuário. Quando a pessoa não pode dar entrada, a aba nem aparece:
            mostrar desabilitada só convida a perguntar por que não funciona. */}
        <Tabs value={abaModal} onValueChange={setAbaModal}>
          <TabsList>
            <TabsTrigger value="consultar">Consultar</TabsTrigger>
            {podeAlterar && <TabsTrigger value="entrada">Dar entrada</TabsTrigger>}
          </TabsList>

          <TabsContent value="consultar" className="pt-4">
            <ConsultaEstoque empresaId={empresaId} />
          </TabsContent>

          <TabsContent value="entrada" className="pt-2">
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
                {/* Filtrar por tipo antes de procurar pelo nome: o catálogo
                    passa de mil itens, e quem dá entrada normalmente sabe se
                    está mexendo com EPI, uniforme ou material de limpeza. */}
                <div className="flex gap-2">
                  <Input value={buscaMat} onChange={(e) => setBuscaMat(e.target.value)}
                         placeholder="Buscar no catálogo…" className="flex-1" />
                  <Select value={tipoMat} onValueChange={setTipoMat}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={TODOS_OS_TIPOS}>Todos os tipos</SelectItem>
                      {TIPOS_MATERIAL.map((t) => (
                        <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label>Valor unitário</Label>
              <Input type="number" step="0.01" min="0" value={valor}
                     onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
            </div>
            <div>
              {/* "Quanto tempo tu consegue segurar essa cotação para mim?"
                  O comprador negocia isso e registra aqui (SIS-2026-0199). */}
              <Label>Preço válido até</Label>
              <Input type="date" value={precoValidoAte}
                     onChange={(e) => setPrecoValidoAte(e.target.value)} />
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
                  <div className="w-32">
                    <Label className="text-xs">Quantidade</Label>
                    <Input type="number" min="1" value={b.quantidade} autoFocus={i === 0}
                           onChange={(e) => alterar(i, { quantidade: e.target.value })} className="h-9" />
                  </div>
                  <div className="flex-1" />
                  {blocos.length > 1 && (
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive"
                            onClick={() => setBlocos((s) => s.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                {materialEhEpi && (
                  <div className="mb-3 space-y-2">
                    {laudoAtivo.data !== null && laudoAtivo.data !== undefined && (
                      <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                        O laudo do SST exige CA válido por pelo menos {laudoAtivo.data} mês{laudoAtivo.data === 1 ? "" : "es"}.
                      </p>
                    )}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">Número do CA</Label>
                        <Input
                          value={b.ca_numero}
                          onChange={(e) => alterar(i, { ca_numero: e.target.value })}
                          placeholder="Ex.: 12345"
                          className="h-9"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Validade do CA</Label>
                        <Input
                          type="date"
                          value={b.ca_validade}
                          onChange={(e) => alterar(i, { ca_validade: e.target.value })}
                          className="h-9"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setBlocos((s) => [...s, { ...BLOCO_VAZIO }])}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Outro tamanho
            </Button>
          </div>
        </div>

        <DialogFooter className="items-center">
          <div className="mr-auto">
            <span className="text-sm text-muted-foreground">
              Total: <strong>{total}</strong> unidade(s)
            </span>
            {erroCa && <p className="mt-1 max-w-sm text-xs font-medium text-destructive">{erroCa}</p>}
          </div>
          <Button variant="outline" onClick={() => { limpar(); onFechar(); }}>Cancelar</Button>
          <Button disabled={!almox || !material || total === 0 || !!erroCa || laudoAtivo.isLoading || entrada.isPending} onClick={enviar}>
            Dar entrada
          </Button>
        </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Aba de consulta: o que o estoquista precisa saber sem poder mexer.
 *
 * Responde a pergunta do balcão — "tem botina 42?" — e mostra quem mexeu por
 * último. Ver o log aqui não é curiosidade: quando falta peça, a primeira
 * pergunta é sempre "quem deu baixa e quando".
 */
function ConsultaEstoque({ empresaId }: { empresaId: string | null | undefined }) {
  const { data: linhas = [], isLoading } = useEstoqueLista(empresaId ?? null);
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState<LinhaEstoque | null>(null);

  const achados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return [];
    return linhas
      .filter((l) => `${l.material} ${l.almoxarifado}`.toLowerCase().includes(t))
      .slice(0, 25);
  }, [linhas, busca]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={busca}
          onChange={(e) => { setBusca(e.target.value); setEscolhido(null); }}
          placeholder="Digite o material que você quer consultar…"
          className="pl-9"
        />
      </div>

      {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}

      {!escolhido && !!busca.trim() && (
        <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-1">
          {achados.map((l) => (
            <button key={l.item_estoque_id} type="button" onClick={() => setEscolhido(l)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
              <span className="flex-1 truncate">{l.material}</span>
              <span className="text-xs text-muted-foreground">{l.almoxarifado}</span>
              <Badge variant={l.disponivel > 0 ? "secondary" : "outline"} className="text-[10px]">
                {l.disponivel} disp.
              </Badge>
            </button>
          ))}
          {achados.length === 0 && (
            <p className="py-6 text-center text-xs text-muted-foreground">Nada encontrado.</p>
          )}
        </div>
      )}

      {escolhido && (
        <div className="space-y-3">
          <div className="rounded-md border p-3">
            <p className="font-medium">{escolhido.material}</p>
            <p className="text-xs text-muted-foreground">{escolhido.almoxarifado}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <span><strong>{escolhido.disponivel}</strong> disponível</span>
              <span className="text-muted-foreground">{escolhido.consumido} consumido</span>
              {escolhido.estoque_minimo > 0 && (
                <span className={cn(escolhido.disponivel < escolhido.estoque_minimo && "text-destructive")}>
                  mínimo {escolhido.estoque_minimo}
                </span>
              )}
            </div>
            {escolhido.tamanhos.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Tamanhos: {escolhido.tamanhos.join(", ")}
              </p>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Últimas movimentações</p>
            <LinhaDoTempo supItemId={escolhido.sup_item_id} />
          </div>

          <Button variant="ghost" size="sm" onClick={() => setEscolhido(null)}>
            ← Consultar outro material
          </Button>
        </div>
      )}
    </div>
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
  // Remover etiqueta é destrutivo, e a RPC exige "excluir". Sem este gate a
  // lixeira aparecia para quem só consulta, e só falhava depois do clique.
  const { data: acessoExcluir } = useAccessibleMenus("excluir");
  const podeExcluir = acessoExcluir?.codes.has("sup_estoque") ?? false;
  const [filtro, setFiltro] = useState("");
  const [inventariando, setInventariando] = useState(false);
  const [removendo, setRemovendo] = useState<{ codigo: string } | null>(null);

  // Inventário virou capacidade separada de "mexer no estoque": conferir a
  // prateleira não deveria exigir poder alterar saldo (ver
  // 20260910000003_capacidades_separadas_suprimentos.sql).
  //
  // `|| !configurado` mantém o botão aberto enquanto ninguém tiver configurado
  // a flag — se a migration ainda não rodou, o comportamento é o de antes, em
  // vez de o botão sumir pra todo mundo.
  const { data: acesso } = useAccessibleMenus("visualizar");
  const podeInventariar = (acesso?.codes.has("sup_estoque_inventario") ?? false)
    || !(acesso?.configuredCodes.has("sup_estoque_inventario") ?? false);

  const visiveis = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    return t ? tags.filter((x) => `${x.codigo} ${x.tamanho ?? ""}`.toLowerCase().includes(t)) : tags;
  }, [tags, filtro]);

  return (
    <>
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

          {/* Abas em vez de uma rolagem só: item com 90 etiquetas e 200 eventos
              vira um modal quilômetro, e ninguém acha o histórico no fim. */}
          <Tabs defaultValue="etiquetas">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="etiquetas" className="gap-1.5">
                <Tag className="h-3.5 w-3.5" /> Etiquetas
              </TabsTrigger>
              <TabsTrigger value="historico" className="gap-1.5">
                <History className="h-3.5 w-3.5" /> Histórico
              </TabsTrigger>
              {/* "Histórico de valores das cotações": o que já se pagou por
                  este material, para o comprador cotar sabendo do que fala. */}
              <TabsTrigger value="precos" className="gap-1.5">
                <Coins className="h-3.5 w-3.5" /> Preços
              </TabsTrigger>
            </TabsList>

            <TabsContent value="etiquetas" className="mt-3">
              <div className="mb-2 flex gap-2">
                <Input value={filtro} onChange={(e) => setFiltro(e.target.value)}
                       placeholder="Filtrar por código ou tamanho…" className="flex-1" />
                {podeInventariar && (
                  <Button variant="outline" className="gap-1.5 whitespace-nowrap"
                          onClick={() => setInventariando(true)}>
                    <ClipboardCheck className="h-4 w-4" /> Inventário
                  </Button>
                )}
              </div>

              {isLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>
              ) : (
                <div className="space-y-1">
                  {visiveis.map((t) => (
                    <div key={t.id}
                      className={cn("flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                        t.usado && "bg-muted/50 text-muted-foreground")}>
                      <span className="w-8 shrink-0 text-xs text-muted-foreground">#{t.sequencia}</span>
                      <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">{t.codigo}</span>
                      {t.tamanho && <Badge variant="outline" className="text-[10px]">{t.tamanho}</Badge>}
                      <Badge variant="secondary" className="text-[10px]">
                        {t.tipo === "massa"
                          ? `${t.quantidade_massa} de ${t.quantidade_original_massa} un`
                          : "etiqueta antiga · 1 un"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">{t.estado}</Badge>
                      {t.usado
                        ? <span className="text-[11px]">usada{t.usado_por_nome ? ` · ${t.usado_por_nome}` : ""}</span>
                        : podeExcluir && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                            onClick={() => setRemovendo({ codigo: t.codigo })}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                    </div>
                  ))}
                  {visiveis.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma entrada registrada.</p>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="historico" className="mt-3">
              <LinhaDoTempo supItemId={linha?.sup_item_id ?? null} />
            </TabsContent>

            <TabsContent value="precos" className="mt-3">
              <HistoricoDePrecos linha={linha} />
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <DialogInventario
        linha={inventariando ? linha : null}
        tagsLivres={tags.filter((t) => !t.usado)}
        onFechar={() => setInventariando(false)}
      />

      <DialogRemoverTag
        codigo={removendo?.codigo ?? null}
        onFechar={() => setRemovendo(null)}
        onConfirmar={(motivo) => {
          remover.mutate({ codigo: removendo!.codigo, motivo });
          setRemovendo(null);
        }}
      />
    </>
  );
}

/** Rótulo, ícone e cor de cada tipo de movimento. */
const ESTILO_MOV: Record<Movimento["tipo"], { rotulo: string; Icone: typeof Tag; cor: string }> = {
  entrada:   { rotulo: "Entrada",    Icone: ArrowDownToLine, cor: "text-emerald-600 dark:text-emerald-400" },
  saida:     { rotulo: "Saída",      Icone: ArrowUpFromLine, cor: "text-sky-600 dark:text-sky-400" },
  devolucao: { rotulo: "Devolução",  Icone: RotateCcw,       cor: "text-amber-600 dark:text-amber-400" },
  ajuste:    { rotulo: "Inventário", Icone: ClipboardCheck,  cor: "text-violet-600 dark:text-violet-400" },
  remocao:   { rotulo: "Remoção",    Icone: Trash2,          cor: "text-destructive" },
};

/**
 * A vida do material em ordem cronológica inversa.
 *
 * Mesma gramática visual do histórico de pedido em PedidosMateriais.tsx —
 * bolinha, fio vertical, autor e data — para as duas trilhas do módulo não
 * terem cara diferente.
 */
function LinhaDoTempo({ supItemId }: { supItemId: string | null }) {
  const { data: eventos = [], isLoading } = useHistoricoDoMaterial(supItemId);

  if (isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>;

  if (eventos.length === 0) {
    return (
      <div className="rounded-md border border-dashed px-4 py-8 text-center">
        <History className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Nenhuma movimentação registrada.</p>
        {/* Vazio mudo parece defeito. O que veio do sistema antigo entrou direto
            nas tabelas, sem passar pelas RPCs, então não tem evento nenhum. */}
        <p className="mt-1 text-xs text-muted-foreground">
          O histórico passa a ser registrado a partir de agora — o que veio do sistema antigo não trouxe eventos.
        </p>
      </div>
    );
  }

  return (
    <div className="max-h-[55vh] overflow-y-auto pr-1">
      {eventos.map((e, i) => {
        const { rotulo, Icone, cor } = ESTILO_MOV[e.tipo] ?? ESTILO_MOV.ajuste;
        return (
          <div key={e.id} className="relative flex gap-3 pb-5 pl-1">
            {i < eventos.length - 1 && <div className="absolute left-[13px] top-7 h-full w-px bg-border" />}
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background">
              <Icone className={cn("h-3.5 w-3.5", cor)} />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{rotulo}</span>
                <span className="text-muted-foreground">·</span>
                <span>{e.quantidade} un</span>
                {e.codigo && (
                  <Badge variant="outline" className="font-mono text-[10px]">{e.codigo}</Badge>
                )}
                {e.tamanho && <Badge variant="secondary" className="text-[10px]">{e.tamanho}</Badge>}
                {e.pedido_protocolo && (
                  <Link
                    to={`/app/suprimentos/pedidos-materiais?busca=${encodeURIComponent(e.pedido_protocolo)}`}
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {e.pedido_protocolo}
                  </Link>
                )}
              </p>
              {e.observacao && <p className="text-muted-foreground">{e.observacao}</p>}
              <p className="text-xs text-muted-foreground">
                {e.usuario_nome ?? "—"} · {new Date(e.created_at).toLocaleString("pt-BR")}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Inventário — confere o físico contra o sistema e REGISTRA a divergência.
 *
 * Não corrige nada de propósito (regra do chamado): baixar etiqueta sozinho
 * apagaria a prova que o time precisa para apurar depois — ver câmera, ver
 * quem deu baixa, achar a etiqueta que sumiu sem baixa nenhuma.
 */
function DialogInventario({ linha, tagsLivres, onFechar }: {
  linha: LinhaEstoque | null;
  tagsLivres: { id: string; codigo: string; tamanho: string | null }[];
  onFechar: () => void;
}) {
  const inventariar = useInventario();
  const [bipadas, setBipadas] = useState<string[]>([]);
  const [observacao, setObservacao] = useState("");
  const [resultado, setResultado] = useState<ResultadoInventario | null>(null);

  const fechar = () => { setBipadas([]); setObservacao(""); setResultado(null); onFechar(); };

  const esperadas = tagsLivres.map((t) => t.codigo);
  const marcadas = new Set(bipadas);
  const alternar = (cod: string) =>
    setBipadas((b) => (b.includes(cod) ? b.filter((x) => x !== cod) : [...b, cod]));

  return (
    <Dialog open={!!linha} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
            Inventário · {linha?.material}
          </DialogTitle>
        </DialogHeader>

        {resultado ? (
          <div className="space-y-3">
            <div className={cn("rounded-md border p-3",
              resultado.divergencia === 0
                ? "border-emerald-400/50 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-destructive/40 bg-destructive/5")}>
              <p className="text-sm font-semibold">
                {resultado.encontradas} de {resultado.esperadas} etiquetas conferidas
              </p>
              <p className="text-sm">
                Divergência: <strong>{resultado.divergencia}</strong>
                {resultado.divergencia === 0 ? " — estoque bate com o sistema." : ""}
              </p>
            </div>

            {resultado.faltantes.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Não encontradas na prateleira ({resultado.faltantes.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {resultado.faltantes.map((c) => (
                    <Badge key={c} variant="outline" className="border-destructive/50 font-mono text-[11px] text-destructive">{c}</Badge>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Continuam livres no sistema — o inventário registra, não baixa. Apure antes de dar baixa.
                </p>
              </div>
            )}

            {resultado.estranhas.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Bipadas mas não pertencem a este material ({resultado.estranhas.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {resultado.estranhas.map((c) => (
                    <Badge key={c} variant="outline" className="border-amber-400/60 font-mono text-[11px] text-amber-700 dark:text-amber-300">{c}</Badge>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button onClick={fechar}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Bipe ou marque as etiquetas que você encontrou de fato na prateleira.
              O sistema tem <strong>{esperadas.length}</strong> livre(s) deste material.
            </p>

            <CampoBipagem codigos={bipadas} onChange={setBipadas}
                          placeholder="Bipe a etiqueta encontrada…" />

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Etiquetas do sistema ({esperadas.length})
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
                {tagsLivres.map((t) => (
                  <button
                    key={t.id} type="button" onClick={() => alternar(t.codigo)}
                    className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60",
                      marcadas.has(t.codigo) && "bg-emerald-50 dark:bg-emerald-950/30")}
                  >
                    <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      marcadas.has(t.codigo) && "border-emerald-500 bg-emerald-500 text-white")}>
                      {marcadas.has(t.codigo) && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex-1 truncate font-mono text-xs">{t.codigo}</span>
                    {t.tamanho && <Badge variant="outline" className="text-[10px]">{t.tamanho}</Badge>}
                  </button>
                ))}
                {tagsLivres.length === 0 && (
                  <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma etiqueta livre.</p>
                )}
              </div>
            </div>

            <div>
              <Label className="text-sm">Observação</Label>
              <Textarea rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)}
                        placeholder="Ex.: contagem mensal, conferência após mudança de prateleira…"
                        className="mt-1" />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={fechar}>Cancelar</Button>
              <Button
                disabled={inventariar.isPending}
                onClick={async () => {
                  const r = await inventariar.mutateAsync({
                    itemEstoqueId: linha!.item_estoque_id, codigos: bipadas, observacao,
                  });
                  setResultado(r);
                }}
              >
                {inventariar.isPending ? "Registrando…" : `Registrar inventário (${bipadas.length})`}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Remoção com justificativa — o motivo vai para a trilha. */
function DialogRemoverTag({ codigo, onFechar, onConfirmar }: {
  codigo: string | null; onFechar: () => void; onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <Dialog open={!!codigo} onOpenChange={(o) => { if (!o) { setMotivo(""); onFechar(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Remover a etiqueta {codigo}?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          A etiqueta sai do estoque. O registro da remoção fica no histórico do material.
        </p>
        <div>
          <Label className="text-sm">Motivo</Label>
          <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ex.: avariada no transporte, extraviada, erro de cadastro…"
                    className="mt-1" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setMotivo(""); onFechar(); }}>Cancelar</Button>
          <Button variant="destructive" onClick={() => { onConfirmar(motivo); setMotivo(""); }}>
            Remover
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
