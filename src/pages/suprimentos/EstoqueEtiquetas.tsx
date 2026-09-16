import { useEffect, useMemo, useState } from "react";
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
import { normalizarNomeMaterial, separarTamanhoDoNome, destinoDoTamanho } from "@/lib/suprimentos/tamanhoDoItem";
import { useItens, useTamanhosDoItem, LABEL_TIPO_ITEM, type TipoItem } from "@/hooks/useSupCatalogo";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router-dom";
import {
  useAlmoxarifados, useEstoqueLista, useTagsDoItem, useEntradaPorQuantidade, useDevolverTags,
  useRemoverTag, useExcluirItemEstoque, useFornecedores, useHistoricoDoMaterial, useInventario,
  useHistoricoPreco, fmtBRL, useEditarItemEstoque, useAlteracoesDoMaterial,
  usePreEntradaPendentes, useDispensarPreEntrada,
  type LinhaEstoque, type RemessaEntrada, type Movimento, type ResultadoInventario,
  type EdicaoMaterial, type EdicaoLote, type AlteracaoEstoque, type TagEstoque,
  type PreEntrada,
} from "@/hooks/useSupEstoque";
import { motivoBloqueioEntrada } from "@/lib/suprimentos/entradaEstoque";
import {
  PackagePlus, Search, AlertTriangle, Boxes, Undo2, Trash2, ShieldAlert, Plus, X, Tag,
  ClipboardCheck, History, ArrowDownToLine, ArrowUpFromLine, RotateCcw, Check, Coins,
  PackageOpen, ClipboardList, Pencil, ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { caAtendeLaudo } from "@/lib/sst/laudo";
import { useAccessibleMenus } from "@/hooks/useAccessibleMenus";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useContagemRotativa } from "@/hooks/useSupSeparacao";

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
  // Mesma ação da lixeira do lote (sup_est_remover_tag): tirar o material
  // inteiro é só a versão de tirar todos os lotes de uma vez.
  const { data: acessoExcluir } = useAccessibleMenus("excluir");
  const podeExcluir = acessoExcluir?.codes.has("sup_estoque") ?? false;
  const [entradaAberta, setEntradaAberta] = useState(false);
  // Em qual aba o modal abre. "Consultar" e "Entrada" são o MESMO modal, e
  // sem isto o botão Consultar abriria em "Dar entrada" para quem tem
  // permissão — o oposto do que o botão promete.
  const [abaDaEntrada, setAbaDaEntrada] = useState<"consultar" | "entrada">("consultar");
  const [devolucaoAberta, setDevolucaoAberta] = useState(false);
  const [preEntradaAberta, setPreEntradaAberta] = useState(false);
  // Material escolhido na fila de Pré-Entrada: abre o modal de Entrada já
  // com ele selecionado. É a entrada de sempre — o que muda é a origem.
  const [materialDaFila, setMaterialDaFila] = useState<{ id: string; nome: string } | null>(null);
  const { data: preEntradas = [] } = usePreEntradaPendentes(empresaId ?? null);
  const [detalhe, setDetalhe] = useState<LinhaEstoque | null>(null);
  const [excluindo, setExcluindo] = useState<LinhaEstoque | null>(null);
  const [editando, setEditando] = useState<LinhaEstoque | null>(null);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return linhas.filter((l) => {
      if (tipo !== TODOS_OS_TIPOS && l.tipo_material !== tipo) return false;
      if (!t) return true;
      // O base entra na busca: "JAQUETA" ou o código antigo dela (0001001)
      // tem de achar todos os tamanhos, que agora são linhas próprias.
      return `${l.codigo_item ?? ""} ${l.material} ${l.almoxarifado} ${l.tamanhos.join(" ")} ${l.base?.codigo ?? ""}`
        .toLowerCase().includes(t);
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
    reservado: linhas.reduce((s, l) => s + l.reservado, 0),
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
        subtitle="Cada material — e cada tamanho dele — tem um código próprio, que não muda. A entrada é por quantidade; devolução e baixa continuam por bipagem."
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
            <Button variant="outline"
                    onClick={() => { setAbaDaEntrada("consultar"); setEntradaAberta(true); }}>
              <Search className="mr-2 h-4 w-4" /> Consultar
            </Button>
            {/* Pré-Entrada também é de todo mundo: é leitura de estoque, e
                saber o que o Catálogo aprovou e ainda não chegou interessa a
                quem só consulta. Dar entrada por ali continua pedindo
                `alterar`, como os outros dois botões. */}
            <Button variant="outline" onClick={() => setPreEntradaAberta(true)}>
              <ClipboardList className="mr-2 h-4 w-4" /> Pré-Entrada de Itens
              {preEntradas.length > 0 && (
                <Badge variant="secondary" className="ml-2">{preEntradas.length}</Badge>
              )}
            </Button>
            {podeAlterar && (
              <>
                <Button variant="outline" onClick={() => setDevolucaoAberta(true)}>
                  <Undo2 className="mr-2 h-4 w-4" /> Devolução
                </Button>
                <Button onClick={() => { setAbaDaEntrada("entrada"); setEntradaAberta(true); }}>
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
        <Kpi rotulo="Reservadas p/ separação" valor={kpis.reservado} icone={PackageOpen} />
        <Kpi rotulo="Entradas registradas" valor={kpis.etiquetas} icone={Tag} />
        <Kpi rotulo="Abaixo do mínimo" valor={kpis.abaixo} icone={AlertTriangle}
             destaque={kpis.abaixo > 0} />
        <Kpi rotulo="Valor total do estoque" valor={fmtBRL(kpis.valorTotal)} icone={Coins} />
      </div>

      <AcessoGate menu="sup_estoque_inventario" acao="visualizar">
        <PainelContagemRotativa />
      </AcessoGate>

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
            {busca ? "Tente outro termo." : "Comece dando entrada no material recebido."}
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
                  <TableHead>Tamanho</TableHead>
                  <TableHead className="text-right">Disponível</TableHead>
                  <TableHead className="text-right">Reservado</TableHead>
                  <TableHead className="text-right">Físico</TableHead>
                  <TableHead className="text-right">Consumido</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  {/* SIS-2026-0199: o custo já era gravado na entrada e nunca
                      voltava para a tela. É o último valor pago. */}
                  <TableHead className="text-right">Custo unit.</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                  {(podeAlterar || podeExcluir) && <TableHead className="w-20" />}
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
                      {/*
                        Disponível é LÍQUIDO de reserva desde 20260930000076 — é a
                        resposta ao "mas tem 10 no estoque, por que está comprando?".
                        Físico continua ao lado porque é ele que a contagem confere.
                      */}
                      <TableCell className={cn("text-right font-semibold", critico && "text-destructive")}>
                        {l.disponivel}
                        {critico && <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />}
                      </TableCell>
                      <TableCell className="text-right">
                        {l.reservado > 0 ? (
                          <span
                            className="text-violet-700 dark:text-violet-300"
                            title="Separado para um pedido, ainda na prateleira"
                          >
                            {l.reservado}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{l.fisico}</TableCell>
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
                      {(podeAlterar || podeExcluir) && (
                        <TableCell className="whitespace-nowrap p-1 text-right">
                          {/* stopPropagation: o clique na linha abre o detalhe. */}
                          {podeAlterar && (
                            <Button variant="ghost" size="icon" className="h-8 w-8"
                                    title="Editar material"
                                    onClick={(e) => { e.stopPropagation(); setEditando(l); }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {podeExcluir && (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                                    title="Excluir material do estoque"
                                    onClick={(e) => { e.stopPropagation(); setExcluindo(l); }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <DialogEntrada aberto={entradaAberta}
                     onFechar={() => { setEntradaAberta(false); setMaterialDaFila(null); }}
                     empresaId={empresaId ?? null} podeAlterar={podeAlterar}
                     materialInicial={materialDaFila} abaInicial={abaDaEntrada} />
      <DialogDevolucao aberto={devolucaoAberta} onFechar={() => setDevolucaoAberta(false)} />
      <DialogPreEntrada
        aberto={preEntradaAberta}
        onFechar={() => setPreEntradaAberta(false)}
        itens={preEntradas}
        podeAlterar={podeAlterar}
        onDarEntrada={(item) => {
          // Fecha a fila e abre a entrada de sempre, já com o material.
          setPreEntradaAberta(false);
          setMaterialDaFila({ id: item.sup_item_id, nome: item.nome });
          setAbaDaEntrada("entrada");
          setEntradaAberta(true);
        }}
      />
      <DialogDetalhe linha={detalhe} onFechar={() => setDetalhe(null)} />
      <DialogExcluirMaterial linha={excluindo} onFechar={() => setExcluindo(null)} />
      <DialogEditarMaterial linha={editando} empresaId={empresaId ?? null} onFechar={() => setEditando(null)} />
    </div>
  );
}

/** Estado editável de um lote. Vazio = campo não mexido. */
type LoteEditado = { tamanho?: string; ca_numero?: string; ca_validade?: string; quantidade?: string };

/** Nome do catálogo como o catálogo grava: sem espaço sobrando, em maiúsculas. */
const normalizarNome = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * Editar o material e os lotes livres dele, com motivo obrigatório.
 *
 * Cada campo que muda vira uma linha de histórico — antes, depois, quem,
 * quando e por quê — que aparece na aba Histórico do material. Quantidade só
 * se corrige em lote por quantidade, e vira movimento de "correção" na mesma
 * trilha: o inventário continua só registrando, e a correção é o passo humano
 * depois da apuração.
 */
function DialogEditarMaterial({ linha, empresaId, onFechar }: {
  linha: LinhaEstoque | null; empresaId: string | null; onFechar: () => void;
}) {
  return (
    <Dialog open={!!linha} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {/* key: trocar de material zera o formulário em vez de herdar o anterior. */}
        {linha && <FormEditarMaterial key={linha.item_estoque_id} linha={linha}
                                      empresaId={empresaId} onFechar={onFechar} />}
      </DialogContent>
    </Dialog>
  );
}

function FormEditarMaterial({ linha, empresaId, onFechar }: {
  linha: LinhaEstoque; empresaId: string | null; onFechar: () => void;
}) {
  const editar = useEditarItemEstoque();
  const { data: tags = [], isLoading } = useTagsDoItem(linha.item_estoque_id);
  const { data: fornecedores = [] } = useFornecedores(empresaId);
  // Nome e tipo são do catálogo, e o banco só deixa quem altera o catálogo
  // mexer neles (sup_est_editar_item, 20260930000161).
  const { data: acessoAlterar } = useAccessibleMenus("alterar");
  const podeRenomear = acessoAlterar?.codes.has("sup_catalogo") ?? false;

  // Linha de um tamanho ("JAQUETA M"): o nome editável é o do base. É o base
  // que o banco renomeia (sup_est_editar_item, 20260930000163), e o gatilho
  // leva o nome novo a todos os tamanhos.
  const nomeBase = linha.base?.nome ?? linha.material;
  const [nome, setNome] = useState(nomeBase);
  const [tipoItem, setTipoItem] = useState(linha.tipo_material);
  const [valor, setValor] = useState(linha.valor_unitario ? String(linha.valor_unitario) : "");
  const [precoValidoAte, setPrecoValidoAte] = useState(linha.preco_valido_ate ?? "");
  const [minimo, setMinimo] = useState(String(linha.estoque_minimo));
  const [fornecedor, setFornecedor] = useState(linha.fornecedor_id ?? "");
  const [observacoes, setObservacoes] = useState(linha.observacoes ?? "");
  const [lotes, setLotes] = useState<Record<string, LoteEditado>>({});
  const [motivo, setMotivo] = useState("");

  // Etiqueta usada pertence ao pedido que a levou — editar ali reescreveria o
  // que o pedido recebeu. Só o que está livre na prateleira entra.
  const livres = tags.filter((t) => !t.usado);
  const alterarLote = (id: string, patch: LoteEditado) =>
    setLotes((s) => ({ ...s, [id]: { ...s[id], ...patch } }));

  const edicao = useMemo((): EdicaoMaterial => {
    const e: EdicaoMaterial = {};
    if (podeRenomear && nome.trim() && normalizarNome(nome) !== normalizarNome(nomeBase)) {
      e.nome = normalizarNome(nome);
    }
    if (podeRenomear && tipoItem && tipoItem !== linha.tipo_material) e.tipo = tipoItem;
    const v = Number(valor || 0);
    if (v !== linha.valor_unitario) e.valor_unitario = v;
    if ((precoValidoAte || null) !== (linha.preco_valido_ate ?? null)) e.preco_valido_ate = precoValidoAte || null;
    const m = Math.max(Number(minimo || 0), 0);
    if (m !== linha.estoque_minimo) e.estoque_minimo = m;
    if ((fornecedor || null) !== (linha.fornecedor_id ?? null)) e.fornecedor_id = fornecedor || null;
    const obs = observacoes.trim() || null;
    if (obs !== (linha.observacoes ?? null)) e.observacoes = obs;

    const ls: EdicaoLote[] = [];
    for (const t of livres) {
      const ed = lotes[t.id];
      if (!ed) continue;
      const l: EdicaoLote = { id: t.id };
      if (ed.tamanho !== undefined && (ed.tamanho.trim() || null) !== (t.tamanho ?? null)) l.tamanho = ed.tamanho.trim() || null;
      if (ed.ca_numero !== undefined && (ed.ca_numero.trim() || null) !== (t.ca_numero ?? null)) l.ca_numero = ed.ca_numero.trim() || null;
      if (ed.ca_validade !== undefined && (ed.ca_validade || null) !== (t.ca_validade ?? null)) l.ca_validade = ed.ca_validade || null;
      if (t.tipo === "massa" && ed.quantidade !== undefined && ed.quantidade !== ""
          && Math.max(Number(ed.quantidade), 0) !== (t.quantidade_massa ?? 0)) {
        l.quantidade = Math.max(Math.trunc(Number(ed.quantidade)), 0);
      }
      if (Object.keys(l).length > 1) ls.push(l);
    }
    if (ls.length) e.lotes = ls;
    return e;
  }, [podeRenomear, nome, tipoItem, valor, precoValidoAte, minimo, fornecedor, observacoes, lotes, livres, linha]);

  const nadaMudou = Object.keys(edicao).length === 0;

  const salvar = async () => {
    if (nadaMudou || !motivo.trim()) return;
    await editar.mutateAsync({ itemEstoqueId: linha.item_estoque_id, edicao, motivo });
    onFechar();
  };

  return (
    <>
      <DialogHeader><DialogTitle>Editar {linha.material}</DialogTitle></DialogHeader>

      <div className="space-y-4 py-1">
        <div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label>Nome do material</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} disabled={!podeRenomear} />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={tipoItem} onValueChange={setTipoItem} disabled={!podeRenomear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPOS_MATERIAL.map((t) => (
                    <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {podeRenomear
              ? "Nome e tipo são do catálogo: mudam em todos os almoxarifados, pedidos e enxovais que usam este material."
              : "Renomear ou trocar o tipo exige permissão de alterar no Catálogo."}
          </p>
          {/* Nome e tipo de um tamanho são os do base (20260930000163): quem
              edita a JAQUETA M precisa saber que está mexendo em todas. */}
          {linha.base && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Este é o tamanho <strong className="text-foreground">{linha.tamanho_item}</strong> de{" "}
              <strong className="text-foreground">{linha.base.nome}</strong>. Nome e tipo valem para todos os
              tamanhos — este item se chama “{normalizarNome(nome || nomeBase)} {linha.tamanho_item}”.
            </p>
          )}
          {/* EPI é o único tipo com efeito de regra (tiposMaterial.ts). Trocar
              para dentro ou para fora dele muda o que o sistema deixa sair —
              quem troca precisa saber disso antes de salvar. */}
          {tipoItem !== linha.tipo_material && (tipoItem === "epi" || linha.tipo_material === "epi") && (
            <p className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
              {tipoItem === "epi"
                ? "Como EPI, o material entra no Controle de CA do SST, e lote com CA vencido, suspenso ou cancelado deixa de poder sair em pedido."
                : "Deixando de ser EPI, o material sai do Controle de CA do SST, e a trava de CA vencido deixa de valer para ele."}
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>Valor unitário</Label>
            <Input type="number" step="0.01" min="0" value={valor}
                   onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
          </div>
          <div>
            <Label>Preço válido até</Label>
            <Input type="date" value={precoValidoAte} onChange={(e) => setPrecoValidoAte(e.target.value)} />
          </div>
          <div>
            <Label>Estoque mínimo</Label>
            <Input type="number" min="0" value={minimo} onChange={(e) => setMinimo(e.target.value)} />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Fornecedor</Label>
            {/* O Select do Radix não aceita valor vazio num item — "__nenhum__" é o "sem fornecedor". */}
            <Select value={fornecedor || "__nenhum__"}
                    onValueChange={(v) => setFornecedor(v === "__nenhum__" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__nenhum__">Sem fornecedor</SelectItem>
                {fornecedores.map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.nome_fantasia || f.razao_social}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Observações</Label>
            <Input value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Lotes na prateleira ({livres.length})
          </p>
          {/* A regra combinada em 15/09/2026: o digitado à mão vale até a
              próxima lista do SST, que sobrescreve (trg_sst_ca_aplicar_no_estoque).
              Dito aqui para ninguém estranhar o CA "mudando sozinho". */}
          {livres.length > 0 && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              O CA pode ser digitado à mão em qualquer tipo de material. Quando o SST atualizar a
              lista oficial de CA, o lote cujo número estiver na lista recebe o número e a validade
              do Ministério no lugar do que foi digitado aqui.
            </p>
          )}
          {/* Cada tamanho é um item (20260930000163): corrigir o tamanho de um
              lote é dizer que ele é de OUTRO item, e é para lá que ele vai. */}
          {livres.length > 0 && (
            <p className="mb-2 text-[11px] text-muted-foreground">
              Trocar o tamanho de um lote leva o lote para o item daquele tamanho, com o código dele
              (o item é criado se ainda não existir). As duas linhas registram a passagem no histórico.
            </p>
          )}
          {isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Carregando…</p>
          ) : livres.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum lote livre para editar.</p>
          ) : (
            <div className="space-y-2">
              {livres.map((t) => {
                const ed = lotes[t.id] ?? {};
                return (
                  <div key={t.id} className="flex flex-wrap items-end gap-2 rounded-md border p-2">
                    <span className="w-8 shrink-0 pb-2 text-xs text-muted-foreground">#{t.sequencia}</span>
                    <div className="w-20">
                      <Label className="text-xs">Tamanho</Label>
                      <Input className="h-8" value={ed.tamanho ?? t.tamanho ?? ""}
                             onChange={(e) => alterarLote(t.id, { tamanho: e.target.value })} />
                    </div>
                    {/* Em qualquer tipo, não só EPI (15/09/2026): há material
                        com CA cadastrado em outro tipo, como o avental de napa
                        em Uniforme. O banco nunca restringiu por tipo. */}
                    <div className="w-28">
                      <Label className="text-xs">Nº do CA</Label>
                      <Input className="h-8" value={ed.ca_numero ?? t.ca_numero ?? ""}
                             onChange={(e) => alterarLote(t.id, { ca_numero: e.target.value })} />
                    </div>
                    <div className="w-36">
                      <Label className="text-xs">Validade do CA</Label>
                      <Input className="h-8" type="date" value={ed.ca_validade ?? t.ca_validade ?? ""}
                             onChange={(e) => alterarLote(t.id, { ca_validade: e.target.value })} />
                    </div>
                    {t.tipo === "massa" ? (
                      <div className="w-24">
                        <Label className="text-xs">Quantidade</Label>
                        <Input className="h-8" type="number" min="0"
                               value={ed.quantidade ?? String(t.quantidade_massa ?? 0)}
                               onChange={(e) => alterarLote(t.id, { quantidade: e.target.value })} />
                      </div>
                    ) : (
                      <span className="pb-2 text-xs text-muted-foreground">etiqueta antiga · 1 un</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <Label className="text-sm">Motivo *</Label>
          <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Ex.: contagem de 14/09 achou 7, não 10; nome digitado errado na entrada…"
                    className="mt-1" />
        </div>
      </div>

      <DialogFooter className="items-center">
        {nadaMudou && <span className="mr-auto text-xs text-muted-foreground">Nada alterado ainda.</span>}
        <Button variant="outline" onClick={onFechar}>Cancelar</Button>
        <Button disabled={nadaMudou || !motivo.trim() || editar.isPending} onClick={salvar}>
          {editar.isPending ? "Salvando…" : "Salvar alterações"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Excluir o material inteiro do estoque, com motivo obrigatório.
 *
 * Antes só dava para apagar lote por lote no modal de detalhe, e o material
 * zerado continuava na lista. O motivo vai para a trilha de cada lote
 * removido — é o que responde depois "quem tirou e por quê".
 */
function DialogExcluirMaterial({ linha, onFechar }: { linha: LinhaEstoque | null; onFechar: () => void }) {
  const excluir = useExcluirItemEstoque();
  const [motivo, setMotivo] = useState("");
  const fechar = () => { setMotivo(""); onFechar(); };
  // O banco barra do mesmo jeito; aqui é para não oferecer o que vai falhar.
  const reservado = (linha?.reservado ?? 0) > 0;

  return (
    <Dialog open={!!linha} onOpenChange={(o) => { if (!o) fechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Excluir {linha?.material} do estoque?</DialogTitle></DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {linha?.fisico
              ? <>Todas as <strong className="text-foreground">{linha.fisico}</strong> unidade(s) na prateleira
                  de <strong className="text-foreground">{linha.almoxarifado}</strong> saem do estoque.</>
              : <>O material não tem saldo e sai da lista de <strong className="text-foreground">{linha?.almoxarifado}</strong>.</>}
            {" "}Pedidos que ele já atendeu continuam registrados, e a exclusão fica no histórico do material.
          </p>
          {reservado && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive">
              {linha?.reservado} unidade(s) estão reservadas para separação de pedido.
              Conclua ou libere a separação antes de excluir.
            </p>
          )}
          <div>
            <Label className="text-sm">Motivo *</Label>
            <Textarea rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ex.: cadastrado no almoxarifado errado, lote descartado por CA vencido…"
                      className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button variant="destructive"
                  disabled={!motivo.trim() || reservado || excluir.isPending}
                  onClick={async () => {
                    await excluir.mutateAsync({ itemEstoqueId: linha!.item_estoque_id, motivo });
                    fechar();
                  }}>
            {excluir.isPending ? "Excluindo…" : "Excluir do estoque"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
                      : p.origem === "ajuste" ? "ajuste de cadastro" : "entrada",
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

/**
 * Em qual item aquele bloco vai cair — dito ANTES de gravar.
 *
 * Cada tamanho é um item com código próprio (20260930000163). Quem digita "M"
 * precisa ver que a entrada vai para "JAQUETA M", e se o código é o que já
 * está na prateleira ou um que nasce agora — é esse número que vira a etiqueta
 * de gôndola. "X", "U" e "ÚNICO" não são tamanho: ali a entrada fica no
 * próprio material, e a tela diz isso em vez de criar "JAQUETA X".
 */
function DestinoDoTamanho({ base, tamanho, existentes, materialNovo }: {
  base: { nome: string; codigo: string | null };
  tamanho: string;
  existentes: { tamanho: string; codigo: string | null }[];
  materialNovo: boolean;
}) {
  const destino = destinoDoTamanho(base, tamanho, existentes);
  const codigoNovo = materialNovo || destino.novo || !destino.codigo;
  return (
    <p className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>Entra em</span>
      <strong className="text-foreground">{destino.nome}</strong>
      {codigoNovo
        ? <Badge variant="outline" className="text-[10px]">código novo</Badge>
        : <span className="font-mono">{destino.codigo}</span>}
      {destino.semTamanho && !!tamanho.trim() && (
        <span>— “{tamanho.trim()}” é o “sem tamanho” antigo, não vira item próprio</span>
      )}
    </p>
  );
}

function DialogEntrada({ aberto, onFechar, empresaId, podeAlterar, materialInicial, abaInicial }: {
  aberto: boolean; onFechar: () => void; empresaId: string | null; podeAlterar: boolean;
  /** Material já escolhido — vem da fila de Pré-Entrada. */
  materialInicial?: { id: string; nome: string } | null;
  /** Aba em que o modal abre: o botão que foi clicado decide. */
  abaInicial?: "consultar" | "entrada";
}) {
  // Sem permissão de alterar só existe a consulta, então ela é a aba inicial.
  const [abaModal, setAbaModal] = useState("consultar");
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
  const [novoTipo, setNovoTipo] = useState("");
  // "Não é tamanho, é material próprio" — a resposta da pessoa à sugestão
  // "TESTE EDUARDO é o tamanho EDUARDO de TESTE". Vira p_forcar na RPC
  // (sup_est_criar_material, 20260930000164).
  const [forcarNovo, setForcarNovo] = useState(false);

  const matSelecionado = materiais.find((m) => m.id === material);
  const materialEhEpi = matSelecionado ? matSelecionado.tipo === "epi" : novoTipo === "epi";
  // Tamanhos que já viraram item, para a prévia de cada bloco mostrar o código.
  const { data: tamanhosExistentes = [] } = useTamanhosDoItem(aberto && material ? material : null);
  const nomeDigitado = normalizarNomeMaterial(buscaMat);
  const jaExiste = !!nomeDigitado && materiais.some((m) => normalizarNomeMaterial(m.nome) === nomeDigitado);
  // "JAQUETA M" com JAQUETA no catálogo é o tamanho M dela, não material novo.
  const tamanhoDeOutro = useMemo(
    () => (nomeDigitado && !jaExiste ? separarTamanhoDoNome(nomeDigitado, materiais) : null),
    [nomeDigitado, jaExiste, materiais]);

  // Pergunta aberta na tela: o nome digitado parece "BASE + TAMANHO" e a
  // pessoa ainda não disse qual dos dois é. Enquanto não disser, não há
  // material escolhido — mas o motivo do bloqueio é essa pergunta, não
  // "escolha um material".
  const decisaoDeTamanhoPendente = !material && !!tamanhoDeOutro && !forcarNovo;

  /**
   * Material novo é o que foi DIGITADO, sem precisar de clique nenhum.
   *
   * Antes isto era um state que só o clique no cartão tracejado preenchia, e
   * era a causa do relato de 16/09/2026: a pessoa preenchia o formulário
   * inteiro, o cartão passava despercebido, e o botão ficava cinza sem dizer
   * nada. Derivado do texto, o formulário passa a se comportar como parece:
   * escreveu um nome que não existe, é material novo.
   *
   * Clicar num item da lista continua tendo prioridade — `material` cheio
   * zera isto.
   */
  const novoMaterial = !material && nomeDigitado.length >= 2 && !jaExiste && !decisaoDeTamanhoPendente
    ? nomeDigitado
    : null;
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
    setNovoTipo(""); setForcarNovo(false);
  };

  /**
   * O que falta para gravar, em uma frase — ou null, e aí o botão habilita.
   * Uma fonte só para o texto do rodapé e para o `disabled`: duas acabariam
   * discordando, e o sintoma seria um botão cinza dizendo "tudo certo".
   */
  const bloqueio = motivoBloqueioEntrada({
    almoxarifado: almox,
    materialId: material,
    nomeNovo: novoMaterial,
    tipoNovo: novoTipo,
    decisaoDeTamanhoPendente,
    total,
    erroCa,
    laudoCarregando: laudoAtivo.isLoading,
    enviando: entrada.isPending,
  });

  // Material vindo da fila de Pré-Entrada, e a aba certa ao abrir.
  //
  // A aba precisa ser acertada aqui, e não no useState: este modal é montado
  // junto com a página, quando useAccessibleMenus ainda não respondeu e
  // `podeAlterar` é false. O valor inicial de um useState só vale na
  // montagem, então quem tinha permissão abria na aba errada — de forma
  // intermitente, porque depende de o cache estar quente.
  useEffect(() => {
    if (!aberto) return;
    setAbaModal(podeAlterar ? (abaInicial ?? "entrada") : "consultar");
    if (materialInicial) setMaterial(materialInicial.id);
  }, [aberto, podeAlterar, abaInicial, materialInicial]);

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
    if (bloqueio || remessas.length === 0) return;

    await entrada.mutateAsync({
      almoxarifado_id: almox, sup_item_id: material || null,
      novo_material: material ? null : { nome: novoMaterial!, tipo: novoTipo, forcar: forcarNovo },
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
                {matSelecionado.codigo && (
                  <span className="font-mono text-[11px] text-muted-foreground">{matSelecionado.codigo}</span>
                )}
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
                  {/* Mexeu no nome, a decisão "não é tamanho" morre junto:
                      ela valia para o texto anterior, e carregá-la adiante
                      cadastraria o próximo nome sem perguntar nada. */}
                  <Input value={buscaMat}
                         onChange={(e) => { setBuscaMat(e.target.value); setForcarNovo(false); }}
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
                {/* Digitou nome que não está no catálogo. Duas saídas, nesta
                    ordem: se o que ele digitou é um TAMANHO de um material que
                    já existe ("JAQUETA M"), usar o material certo — cadastrar
                    à parte criaria o item solto que o código por tamanho veio
                    acabar. Mas a regra do tamanho aceita QUALQUER palavra
                    ("ÁLCOOL GEL" vira tamanho GEL de "ÁLCOOL"), então a
                    segunda saída tem de existir junto: cadastrar como material
                    próprio, que é o que manda p_forcar para o banco. */}
                {decisaoDeTamanhoPendente && tamanhoDeOutro && (
                  <div className="mt-1 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMaterial(tamanhoDeOutro.base.id);
                        setBuscaMat("");
                        setBlocos((s) => s.map((b, j) => (
                          j === 0 && !b.tamanho.trim() ? { ...b, tamanho: tamanhoDeOutro.tamanho } : b)));
                      }}
                      className="flex w-full items-start gap-2 rounded-md border border-dashed px-3 py-2 text-left text-xs hover:bg-muted"
                    >
                      <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        “{nomeDigitado}” é o tamanho <strong>{tamanhoDeOutro.tamanho}</strong> de{" "}
                        <strong>{tamanhoDeOutro.base.nome}</strong>. Usar esse material com o tamanho{" "}
                        {tamanhoDeOutro.tamanho}.
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setForcarNovo(true);
                        setNovoTipo(tipoMat !== TODOS_OS_TIPOS ? tipoMat : "");
                      }}
                      className="flex w-full items-start gap-2 rounded-md border border-dashed px-3 py-2 text-left text-xs hover:bg-muted"
                    >
                      <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                      <span>
                        Não é tamanho — cadastrar “{nomeDigitado}” como material próprio.
                      </span>
                    </button>
                  </div>
                )}

                {/* Material novo: nasce do que foi digitado, sem clique. Falta
                    só o tipo — o banco exige (sup_est_criar_material) e ele
                    muda o que o sistema deixa sair depois: EPI pede CA na
                    entrada e trava saída com CA vencido. */}
                {novoMaterial && (
                  <div className="mt-1 space-y-2 rounded-md border border-dashed p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex-1 font-medium">{novoMaterial}</span>
                      <Badge variant="outline" className="text-[10px]">novo no catálogo</Badge>
                    </div>
                    <div className="sm:w-60">
                      <Label className="text-xs">Tipo do material *</Label>
                      <Select value={novoTipo} onValueChange={setNovoTipo}>
                        <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
                        <SelectContent>
                          {TIPOS_MATERIAL.map((t) => (
                            <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      O material entra no catálogo com código próprio ao dar entrada. Para o encarregado
                      poder pedir, ele ainda precisa entrar no enxoval de uma função, pelo Catálogo.
                    </p>
                  </div>
                )}
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
                {(matSelecionado || novoMaterial) && (
                  <DestinoDoTamanho
                    base={{ nome: matSelecionado?.nome ?? novoMaterial ?? "", codigo: matSelecionado?.codigo ?? null }}
                    tamanho={b.tamanho}
                    existentes={tamanhosExistentes}
                    materialNovo={!matSelecionado}
                  />
                )}
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
            <p className="text-[11px] text-muted-foreground">
              Cada tamanho é um item com código próprio, e é ele que aparece na lista do estoque.
              Valor, validade do preço e estoque mínimo acima valem para cada um deles.
            </p>
          </div>
        </div>

        <DialogFooter className="items-center">
          <div className="mr-auto">
            <span className="text-sm text-muted-foreground">
              Total: <strong>{total}</strong> unidade(s)
            </span>
            {/* O que falta, escrito. Um botão cinza sem motivo é pior que um
                botão que falha: falhando, pelo menos vem mensagem. */}
            {bloqueio && (
              <p className={cn("mt-1 max-w-sm text-xs font-medium",
                               erroCa ? "text-destructive" : "text-muted-foreground")}>
                {bloqueio}
              </p>
            )}
          </div>
          <Button variant="outline" onClick={() => { limpar(); onFechar(); }}>Cancelar</Button>
          <Button disabled={!!bloqueio} onClick={enviar}>
            Dar entrada
          </Button>
        </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ── Pré-Entrada ──────────────────────────────────────────────────────

/**
 * A fila do que o Catálogo aprovou e o almoxarifado ainda não tem.
 *
 * Antes desta tela, material aprovado no Catálogo era invisível para o
 * Estoque: existia em sup_item, com código e tudo, mas sem ficha em
 * sup_estoque_item — e é a ficha que a lista de estoque lê. Ninguém no
 * almoxarifado ficava sabendo que passou a existir um material que vão ter de
 * comprar e guardar; a primeira notícia era o encarregado pedindo e faltando.
 *
 * Entrar na fila é automático (sup_cat_decidir_lote, 20260930000165). Sair
 * também: dar entrada fecha a pendência por gatilho, não por esta tela — o
 * que vale para qualquer caminho de entrada, inclusive a NF de Entrada.
 * "Dispensar" é a saída para o que nunca vai para a prateleira.
 */
function DialogPreEntrada({ aberto, onFechar, itens, podeAlterar, onDarEntrada }: {
  aberto: boolean; onFechar: () => void; itens: PreEntrada[]; podeAlterar: boolean;
  onDarEntrada: (item: PreEntrada) => void;
}) {
  const [busca, setBusca] = useState("");
  const [dispensando, setDispensando] = useState<PreEntrada | null>(null);
  const [motivo, setMotivo] = useState("");
  const dispensar = useDispensarPreEntrada();

  const achados = useMemo(() => {
    const t = busca.trim().toLowerCase();
    if (!t) return itens;
    return itens.filter((i) => `${i.nome} ${i.codigo ?? ""}`.toLowerCase().includes(t));
  }, [itens, busca]);

  /** "Contrato · Posto · Função" — sem isto, a fila é uma lista de nomes soltos. */
  const origemDoItem = (i: PreEntrada) =>
    [i.contexto?.contrato, i.contexto?.posto, i.contexto?.funcao].filter(Boolean).join(" · ");

  return (
    <>
      <Dialog open={aberto} onOpenChange={(o) => { if (!o) { setBusca(""); onFechar(); } }}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Pré-Entrada de Itens</DialogTitle>
          </DialogHeader>

          <p className="text-sm text-muted-foreground">
            Materiais aprovados no Catálogo que ainda não existem no estoque. Dar entrada aqui é a
            entrada de sempre — o material passa a existir na prateleira, com o código dele, e sai
            desta lista sozinho.
          </p>

          {itens.length > 0 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)}
                     placeholder="Buscar material ou código…" className="pl-9" />
            </div>
          )}

          {itens.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center">
              <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Nada aguardando entrada.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Esta lista se enche sozinha quando um lote é aprovado em{" "}
                <Link to="/app/suprimentos/catalogo/aprovacoes" className="underline">
                  Aprovação de Catálogo
                </Link>{" "}
                com material que ainda não tem estoque.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24">Código</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Veio de</TableHead>
                    <TableHead className="w-44" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {achados.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {i.codigo ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{i.nome}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {LABEL_TIPO_ITEM[i.tipo as TipoItem] ?? i.tipo}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {origemDoItem(i) || "Catálogo"}
                      </TableCell>
                      <TableCell>
                        {podeAlterar && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" onClick={() => onDarEntrada(i)}>
                              <PackagePlus className="mr-1.5 h-3.5 w-3.5" /> Dar entrada
                            </Button>
                            <Button size="sm" variant="ghost" className="text-muted-foreground"
                                    onClick={() => { setDispensando(i); setMotivo(""); }}>
                              Dispensar
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {achados.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                        Nada encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setBusca(""); onFechar(); }}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispensar pede motivo: daqui a três meses alguém vai perguntar por que
          o material aprovado nunca entrou no estoque, e a resposta tem de estar
          gravada em algum lugar. */}
      <Dialog open={!!dispensando} onOpenChange={(o) => { if (!o) setDispensando(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tirar da pré-entrada</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <strong>{dispensando?.nome}</strong> sai da lista sem entrar no estoque. O material
            continua no Catálogo — só deixa de ser cobrado do almoxarifado.
          </p>
          <div>
            <Label>Por quê?</Label>
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ex.: entregue direto no contrato, não passa pelo almoxarifado." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispensando(null)}>Cancelar</Button>
            <Button
              disabled={!motivo.trim() || dispensar.isPending}
              onClick={async () => {
                await dispensar.mutateAsync({ id: dispensando!.id, motivo: motivo.trim() });
                setDispensando(null);
              }}
            >
              Tirar da lista
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
      .filter((l) => {
        // O código do base entra junto: ele continua colado em prateleira e em
        // caixa, e agora o saldo mora nos tamanhos (20260930000163). Sem isto,
        // bipar o código antigo da JAQUETA não acharia a JAQUETA M.
        if (`${l.codigo_item ?? ""} ${l.base?.codigo ?? ""} ${l.material} ${l.almoxarifado}`
              .toLowerCase().includes(t)) return true;
        // Código de lote/etiqueta antiga: o rótulo físico continua colado na
        // peça em 9.248 casos, e o estoquista vai bipar o que está na mão.
        // Sem isto ele bipa, não acha nada e conclui que o item sumiu.
        return l.codigos_lote.some((c) => c.toLowerCase() === t);
      })
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
          placeholder="Bipe ou digite o código, ou busque pelo nome do material…"
          className="pl-9"
        />
      </div>

      {isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Carregando…</p>}

      {!escolhido && !!busca.trim() && (
        <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border p-1">
          {achados.map((l) => (
            <button key={l.item_estoque_id} type="button" onClick={() => setEscolhido(l)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
              <span className="w-16 shrink-0 font-mono text-[11px] text-muted-foreground">{l.codigo_item ?? "—"}</span>
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
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{escolhido.codigo_item ?? "sem código"}</span>
              {" · "}{escolhido.almoxarifado}
            </p>
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
            <LinhaDoTempo supItemId={escolhido.sup_item_id} codigoItem={escolhido.codigo_item}
                          ocultarTamanho={!!escolhido.tamanho_item} />
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
  // O lote inteiro, não só o código: quem confirma a remoção lê "entrada de
  // 15/09, 3 un", que é como a entrada aparece na tela desde 20260930000163.
  const [removendo, setRemovendo] = useState<TagEstoque | null>(null);

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
    // Sem o código do lote: ele é interno e saiu da tela (20260930000163).
    // O que a pessoa tem na mão para procurar é o tamanho ou o CA.
    return t ? tags.filter((x) => `${x.tamanho ?? ""} ${x.ca_numero ?? ""}`.toLowerCase().includes(t)) : tags;
  }, [tags, filtro]);

  return (
    <>
      <Dialog open={!!linha} onOpenChange={(o) => !o && onFechar()}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {linha?.material}
              {/* O código do ITEM, que é o que se bipa e o que vai na etiqueta
                  de gôndola deste tamanho. */}
              {linha?.codigo_item && (
                <Badge variant="outline" className="font-mono text-[11px]">{linha.codigo_item}</Badge>
              )}
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
                <Tag className="h-3.5 w-3.5" /> Entradas
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
                       placeholder="Filtrar por tamanho ou CA…" className="flex-1" />
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
                      {/* A entrada se identifica pela DATA, não pelo código do
                          lote: ele é interno, ninguém imprime nem bipa, e ver
                          "L260915-3723…" na tela só confunde. O que identifica
                          o material é o código do item, no título. */}
                      <span className="flex-1 truncate text-xs text-muted-foreground">
                        Entrada de {new Date(t.created_at).toLocaleDateString("pt-BR")}
                        {t.ca_numero ? ` · CA ${t.ca_numero}` : ""}
                      </span>
                      {/* Numa linha que já É um tamanho, repetir "M" em toda
                          entrada é ruído. */}
                      {t.tamanho && !linha?.tamanho_item && (
                        <Badge variant="outline" className="text-[10px]">{t.tamanho}</Badge>
                      )}
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
                            onClick={() => setRemovendo(t)}>
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
              <LinhaDoTempo supItemId={linha?.sup_item_id ?? null} codigoItem={linha?.codigo_item}
                            ocultarTamanho={!!linha?.tamanho_item} />
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
        lote={removendo}
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
  // A reserva não tira a peça da prateleira, só do saldo disponível — por isso
  // ela aparece na trilha com peso visual menor que uma saída de verdade.
  reserva:   { rotulo: "Reservado",  Icone: PackageOpen,     cor: "text-violet-600 dark:text-violet-400" },
  liberacao: { rotulo: "Reserva liberada", Icone: Undo2,     cor: "text-muted-foreground" },
  correcao:  { rotulo: "Correção de quantidade", Icone: Pencil, cor: "text-amber-600 dark:text-amber-400" },
};

/**
 * A vida do material em ordem cronológica inversa.
 *
 * Mesma gramática visual do histórico de pedido em PedidosMateriais.tsx —
 * bolinha, fio vertical, autor e data — para as duas trilhas do módulo não
 * terem cara diferente.
 */
function LinhaDoTempo({ supItemId, codigoItem, ocultarTamanho }: {
  supItemId: string | null;
  /** Código do ITEM, que a trilha mostra em cada evento no lugar do código do lote. */
  codigoItem?: string | null;
  /** Numa linha que já É um tamanho, repetir o tamanho em cada evento é ruído. */
  ocultarTamanho?: boolean;
}) {
  const { data: eventos = [], isLoading } = useHistoricoDoMaterial(supItemId);
  const { data: alteracoes = [], isLoading: carregandoEdicoes } = useAlteracoesDoMaterial(supItemId);

  // Edições entram na mesma trilha das entradas e saídas. Os campos de um
  // mesmo "Salvar" (mesmo instante, mesma pessoa) viram UM evento — trocar
  // cinco campos não pode virar cinco bolinhas.
  const itens = useMemo(() => {
    const grupos = new Map<string, {
      created_at: string; usuario_nome: string | null; motivo: string | null;
      origem: AlteracaoEstoque["origem"]; campos: AlteracaoEstoque[];
    }>();
    for (const a of alteracoes) {
      // A origem entra na chave: o SST sobrescrevendo o CA e uma pessoa
      // editando nunca podem virar o mesmo evento.
      const k = `${a.created_at}|${a.usuario_nome ?? ""}|${a.origem}`;
      const g = grupos.get(k) ?? {
        created_at: a.created_at, usuario_nome: a.usuario_nome, motivo: a.motivo,
        origem: a.origem, campos: [],
      };
      g.campos.push(a);
      grupos.set(k, g);
    }
    return [
      ...eventos.map((e) => ({ tipo: "mov" as const, quando: e.created_at, e })),
      ...[...grupos.values()].map((g) => ({ tipo: "edicao" as const, quando: g.created_at, g })),
    ].sort((a, b) => new Date(b.quando).getTime() - new Date(a.quando).getTime());
  }, [eventos, alteracoes]);

  if (isLoading || carregandoEdicoes) return <p className="py-8 text-center text-sm text-muted-foreground">Carregando…</p>;

  if (itens.length === 0) {
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
      {itens.map((it, i) => {
        const fio = i < itens.length - 1 && <div className="absolute left-[13px] top-7 h-full w-px bg-border" />;
        if (it.tipo === "edicao") {
          const g = it.g;
          return (
            <div key={`ed-${g.created_at}-${g.usuario_nome ?? ""}-${g.origem}`} className="relative flex gap-3 pb-5 pl-1">
              {fio}
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background">
                {g.origem === "sst_catalogo"
                  ? <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  : <Pencil className="h-3.5 w-3.5 text-primary" />}
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {g.origem === "sst_catalogo" ? "CA atualizado pela lista oficial (SST)" : "Edição"}
                </p>
                <ul className="space-y-0.5">
                  {g.campos.map((c) => (
                    <li key={c.id} className="break-words">
                      {/* Sem "(lote L2609…)": o código do lote é interno e saiu
                          da tela (20260930000163). Qual lote mudou se lê pela
                          data e pelo tamanho na aba Entradas. */}
                      <span className="text-muted-foreground">{c.campo}:</span>{" "}
                      {c.valor_anterior ?? "—"} → <strong>{c.valor_novo ?? "—"}</strong>
                    </li>
                  ))}
                </ul>
                {g.motivo && <p className="text-muted-foreground">Motivo: {g.motivo}</p>}
                <p className="text-xs text-muted-foreground">
                  {g.usuario_nome ?? "—"} · {new Date(g.created_at).toLocaleString("pt-BR")}
                </p>
              </div>
            </div>
          );
        }
        const e = it.e;
        const { rotulo, Icone, cor } = ESTILO_MOV[e.tipo] ?? ESTILO_MOV.ajuste;
        return (
          <div key={e.id} className="relative flex gap-3 pb-5 pl-1">
            {fio}
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-background">
              <Icone className={cn("h-3.5 w-3.5", cor)} />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{rotulo}</span>
                <span className="text-muted-foreground">·</span>
                {/* Correção guarda a diferença com sinal: "+3" achou mais, "-3" faltou. */}
                <span>{e.tipo === "correcao" && e.quantidade > 0 ? "+" : ""}{e.quantidade} un</span>
                {/* O código do ITEM, não o do lote (20260930000163). O pedido
                    foi literal: "somente o histórico, que quantidade do item e
                    seu código próprio existe e foi adicionado ou removido". */}
                {codigoItem && (
                  <Badge variant="outline" className="font-mono text-[10px]">{codigoItem}</Badge>
                )}
                {e.tamanho && !ocultarTamanho && (
                  <Badge variant="secondary" className="text-[10px]">{e.tamanho}</Badge>
                )}
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
  /** O lote inteiro: a conferência se identifica por data e quantidade, não pelo código interno. */
  tagsLivres: TagEstoque[];
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
                    {/* Data e quantidade no lugar do código do lote: é o que a
                        pessoa consegue casar com a caixa na prateleira. */}
                    <span className="flex-1 truncate text-xs">
                      Entrada de {new Date(t.created_at).toLocaleDateString("pt-BR")}
                      {t.tipo === "massa" ? ` · ${t.quantidade_massa} un` : ""}
                    </span>
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
function DialogRemoverTag({ lote, onFechar, onConfirmar }: {
  lote: TagEstoque | null; onFechar: () => void; onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  // Data, quantidade e tamanho: é assim que a entrada aparece na tela desde
  // 20260930000163 — o código do lote é interno e ninguém o reconhece.
  const quantas = lote ? (lote.tipo === "massa" ? lote.quantidade_massa ?? 0 : 1) : 0;
  return (
    <Dialog open={!!lote} onOpenChange={(o) => { if (!o) { setMotivo(""); onFechar(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Remover a entrada de {lote ? new Date(lote.created_at).toLocaleDateString("pt-BR") : "—"}?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{quantas}</strong> unidade(s)
          {lote?.tamanho ? ` do tamanho ${lote.tamanho}` : ""} saem do estoque.
          O registro da remoção fica no histórico do material.
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

/**
 * Contagem rotativa — a lista que o gerente de Suprimentos pediu.
 *
 * Na conversa: "talvez seja até de geral, uma inconsistência de dizer para
 * ela: esse produto necessita uma contagem rotativa. Cria uma lista para ela.
 * E aí talvez até um relatório para nós dizer: olha só, no mês teve 30 itens
 * que teve necessidade de contagem rotativa, porque o estoque estava errado."
 *
 * Cada linha nasce de uma divergência na separação e se fecha sozinha quando
 * alguém faz o inventário daquele material — nada some, e o motivo escrito
 * por quem estava na doca fica registrado para a apuração depois.
 *
 * Some da tela quando não há nada aberto: painel vazio permanente vira
 * ruído e as pessoas param de olhar.
 */
function PainelContagemRotativa() {
  const { data: linhas = [], isLoading } = useContagemRotativa(true);
  if (isLoading || linhas.length === 0) return null;

  return (
    <Card className="border-amber-400/40 bg-amber-50/40 dark:bg-amber-950/10">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-amber-700 dark:text-amber-300" />
          <h2 className="font-semibold">Contagem rotativa pendente</h2>
          <Badge variant="outline">{linhas.length}</Badge>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          Materiais em que a separação não bateu com o sistema. O saldo NÃO foi
          corrigido — fazer o inventário do material encerra a pendência.
        </p>
        <div className="space-y-2">
          {linhas.map((l) => (
            <div key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border bg-background p-2.5 text-sm">
              <span className="font-medium">{l.material?.nome ?? "—"}</span>
              {l.tamanho && <span className="text-xs text-muted-foreground">({l.tamanho})</span>}
              {/* Sem o código do lote: é interno (20260930000163). O material e
                  o tamanho já dizem o que contar na prateleira. */}
              {l.quantidade_faltante != null && (
                <Badge variant="outline" className="text-[10px]">faltaram {l.quantidade_faltante}</Badge>
              )}
              {l.pedido?.pedido_id && (
                <Link
                  to={`/app/suprimentos/pedidos-materiais?busca=${encodeURIComponent(l.pedido.pedido_id)}`}
                  className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                >
                  {l.pedido.pedido_id}
                </Link>
              )}
              <span className="w-full text-xs text-muted-foreground">
                {l.motivo} — {l.aberta_por_nome ?? "—"},{" "}
                {new Date(l.aberta_em).toLocaleString("pt-BR")}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
