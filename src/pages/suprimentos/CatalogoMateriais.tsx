import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/layout/PageHeader";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import {
  useContratosCatalogo, usePostos, useFuncoes, useFuncaoItens, useItens, useItemOpcoes,
  useRascunhos, useCatalogoMutations, OPCOES_PREDEFINIDAS, LABEL_TIPO_ITEM,
  type TipoItem, type Item,
} from "@/hooks/useSupCatalogo";
import { AutorAlteracao } from "@/components/suprimentos/HistoricoLote";
import {
  Plus, Pencil, Trash2, Settings2, Send, ChevronRight, Building2, MapPin,
  Briefcase, Shirt, Info, ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Catálogo de Materiais — cascata Contrato → Posto → Função → Enxoval.
 *
 * O contrato NÃO é criado aqui: ele nasce em Licitações (public.contratos).
 * Só depois de existir é que se cadastram os postos, as funções e o enxoval
 * de uniformes/EPIs/insumos que o encarregado vai poder pedir.
 *
 * Nada entra em vigor direto — cada alteração vira rascunho e só vale depois
 * de o lote ser aprovado em "Aprovação de Catálogo".
 */

type NivelItem = { id: string; nome: string; aprovado: boolean };

/** Um nível da cascata: lista selecionável + criar/renomear/excluir. */
function NivelCascata({
  titulo, icone: Icone, itens, selecionadoId, onSelecionar,
  onCriar, onRenomear, onExcluir, desabilitado, mensagemVazio, rotuloNovo,
}: {
  titulo: string;
  icone: any;
  itens: NivelItem[];
  selecionadoId: string | null;
  onSelecionar: (id: string) => void;
  onCriar?: (nome: string) => void;
  onRenomear?: (item: NivelItem, nome: string) => void;
  onExcluir?: (item: NivelItem) => void;
  desabilitado: boolean;
  mensagemVazio: string;
  rotuloNovo: string;
}) {
  const [criando, setCriando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [editando, setEditando] = useState<NivelItem | null>(null);
  const [editNome, setEditNome] = useState("");

  const confirmarCriacao = () => {
    if (!novoNome.trim() || !onCriar) return;
    onCriar(novoNome.trim());
    setNovoNome("");
    setCriando(false);
  };

  return (
    <Card className={cn("flex flex-col", desabilitado && "opacity-50")}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Icone className="h-4 w-4 text-muted-foreground" />
          {titulo}
          <Badge variant="secondary" className="ml-auto text-[11px]">{itens.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-1.5">
        {desabilitado ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{mensagemVazio}</p>
        ) : (
          <>
            {itens.length === 0 && !criando && (
              <p className="py-6 text-center text-xs text-muted-foreground">{mensagemVazio}</p>
            )}

            {itens.map((it) => (
              <div
                key={it.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md border px-2 py-1.5 text-sm transition-colors",
                  selecionadoId === it.id
                    ? "border-primary/50 bg-primary/10 font-medium"
                    : "border-transparent hover:bg-muted/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelecionar(it.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="truncate">{it.nome}</span>
                  {/* Só o que já foi aprovado é visível para o encarregado. */}
                  {!it.aprovado && (
                    <Badge variant="outline" className="shrink-0 border-amber-400/50 text-[10px] text-amber-600">
                      pendente
                    </Badge>
                  )}
                </button>
                {onRenomear && (
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => { setEditando(it); setEditNome(it.nome); }}
                    aria-label={`Renomear ${it.nome}`}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
                {onExcluir && (
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => {
                      if (confirm(`Excluir "${it.nome}"? A remoção só vale depois de aprovada.`)) onExcluir(it);
                    }}
                    aria-label={`Excluir ${it.nome}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}

            {criando ? (
              <div className="flex gap-1.5 pt-1">
                <Input
                  autoFocus
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmarCriacao();
                    if (e.key === "Escape") { setCriando(false); setNovoNome(""); }
                  }}
                  placeholder={rotuloNovo}
                  className="h-8 text-sm"
                />
                <Button size="sm" className="h-8" onClick={confirmarCriacao}>OK</Button>
              </div>
            ) : onCriar ? (
              <Button
                variant="ghost" size="sm"
                className="mt-1 h-8 w-full justify-start text-muted-foreground"
                onClick={() => setCriando(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" /> {rotuloNovo}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>

      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Renomear</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label>Novo nome</Label>
            <Input value={editNome} onChange={(e) => setEditNome(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (editando && editNome.trim() && onRenomear) onRenomear(editando, editNome.trim());
                setEditando(null);
              }}
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function CatalogoMateriais() {
  const { data: empresaId } = useEmpresaId();

  const [contratoId, setContratoId] = useState<string | null>(null);
  const [postoId, setPostoId] = useState<string | null>(null);
  const [funcaoId, setFuncaoId] = useState<string | null>(null);

  const { data: contratos = [] } = useContratosCatalogo(empresaId ?? null);
  const { data: postos = [] } = usePostos(contratoId);
  const { data: funcoes = [] } = useFuncoes(postoId);
  const { data: enxoval = [] } = useFuncaoItens(funcaoId);
  const { data: catalogo = [] } = useItens(empresaId ?? null);
  const { data: rascunhos = [] } = useRascunhos(empresaId ?? null);

  const m = useCatalogoMutations(empresaId ?? null);

  const contrato = useMemo(() => contratos.find((c) => c.id === contratoId) ?? null, [contratos, contratoId]);
  const posto = useMemo(() => postos.find((p) => p.id === postoId) ?? null, [postos, postoId]);
  const funcao = useMemo(() => funcoes.find((f) => f.id === funcaoId) ?? null, [funcoes, funcaoId]);

  // Contexto gravado junto de cada rascunho, pra tela de aprovação ler a
  // hierarquia sem precisar re-derivar nada.
  const ctx = useMemo(() => ({
    contrato: contrato?.nome ?? "",
    posto: posto?.nome ?? "",
    funcao: funcao?.nome ?? "",
  }), [contrato, posto, funcao]);

  const [addItemAberto, setAddItemAberto] = useState(false);
  const [opcoesItem, setOpcoesItem] = useState<Item | null>(null);

  const selecionarContrato = (id: string) => { setContratoId(id); setPostoId(null); setFuncaoId(null); };
  const selecionarPosto = (id: string) => { setPostoId(id); setFuncaoId(null); };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogo de Materiais"
        subtitle="Contrato → Posto → Função → enxoval de uniformes, EPIs e insumos. É este cadastro que o encarregado enxerga ao solicitar."
        module="Suprimentos"
        breadcrumb={["Catálogo de Materiais"]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/suprimentos/catalogo/aprovacoes">
                <ClipboardCheck className="mr-2 h-4 w-4" /> Aprovações
              </Link>
            </Button>
            <Button
              disabled={rascunhos.length === 0 || m.enviarLote.isPending}
              onClick={() => m.enviarLote.mutate()}
            >
              <Send className="mr-2 h-4 w-4" />
              Enviar para Aprovação ({rascunhos.length})
            </Button>
          </>
        }
      />

      {rascunhos.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/40 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {rascunhos.length} alteraç{rascunhos.length === 1 ? "ão" : "ões"} em rascunho
            </p>
            <p className="text-amber-800/80 dark:text-amber-200/70">
              Nada disso aparece para o encarregado ainda. Envie para aprovação para que passe a valer.
            </p>

            {/* Quem fez o quê antes de virar lote. O rascunho é compartilhado
                pela empresa: você pode acabar enviando alteração de outra
                pessoa para aprovação sem perceber. */}
            <ul className="mt-2 space-y-1 border-t border-amber-400/30 pt-2">
              {rascunhos.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                  <span className="text-amber-900 dark:text-amber-200">{r.descricao}</span>
                  <AutorAlteracao nome={r.criado_por_nome} quando={r.created_at} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Trilha da cascata */}
      {contrato && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4" />
          <span className="font-medium text-foreground">{contrato.nome}</span>
          {posto && (<><ChevronRight className="h-3.5 w-3.5" /><span className="font-medium text-foreground">{posto.nome}</span></>)}
          {funcao && (<><ChevronRight className="h-3.5 w-3.5" /><span className="font-medium text-foreground">{funcao.nome}</span></>)}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <NivelCascata
          titulo="Contrato"
          icone={Building2}
          itens={contratos.map((c) => ({ id: c.id, nome: c.nome, aprovado: true }))}
          selecionadoId={contratoId}
          onSelecionar={selecionarContrato}
          desabilitado={false}
          mensagemVazio="Nenhum contrato. Cadastre em Licitações → Contratos."
          rotuloNovo="—"
        />

        <NivelCascata
          titulo="Posto"
          icone={MapPin}
          itens={postos.map((p) => ({ id: p.id, nome: p.nome, aprovado: p.aprovado }))}
          selecionadoId={postoId}
          onSelecionar={selecionarPosto}
          onCriar={(nome) =>
            contrato && m.criarPosto.mutate({ contratoId: contrato.id, contratoNome: contrato.nome, nome })}
          onRenomear={(it, nome) =>
            m.renomearPosto.mutate({ id: it.id, nome, nomeAnterior: it.nome, contratoNome: ctx.contrato })}
          onExcluir={(it) =>
            m.excluirPosto.mutate({ id: it.id, nome: it.nome, contratoNome: ctx.contrato })}
          desabilitado={!contratoId}
          mensagemVazio={contratoId ? "Nenhum posto neste contrato." : "Selecione um contrato."}
          rotuloNovo="Novo posto"
        />

        <NivelCascata
          titulo="Função"
          icone={Briefcase}
          itens={funcoes.map((f) => ({ id: f.id, nome: f.nome, aprovado: f.aprovado }))}
          selecionadoId={funcaoId}
          onSelecionar={setFuncaoId}
          onCriar={(nome) => postoId && m.criarFuncao.mutate({ postoId, nome, ctx })}
          onRenomear={(it, nome) => m.renomearFuncao.mutate({ id: it.id, nome, nomeAnterior: it.nome, ctx })}
          onExcluir={(it) => m.excluirFuncao.mutate({ id: it.id, nome: it.nome, ctx })}
          desabilitado={!postoId}
          mensagemVazio={postoId ? "Nenhuma função neste posto." : "Selecione um posto."}
          rotuloNovo="Nova função"
        />

        {/* Enxoval — painel próprio: tem tipo de material e opções */}
        <Card className={cn("flex flex-col", !funcaoId && "opacity-50")}>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Shirt className="h-4 w-4 text-muted-foreground" />
              Enxoval da Função
              <Badge variant="secondary" className="ml-auto text-[11px]">{enxoval.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-1.5">
            {!funcaoId ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Selecione uma função.</p>
            ) : (
              <>
                {enxoval.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    Nenhum material nesta função.
                  </p>
                )}
                {enxoval.map((fi) => (
                  <div key={fi.id} className="group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-muted/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{fi.sup_item?.nome ?? "—"}</span>
                        {!fi.aprovado && (
                          <Badge variant="outline" className="shrink-0 border-amber-400/50 text-[10px] text-amber-600">
                            pendente
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {fi.sup_item ? LABEL_TIPO_ITEM[fi.sup_item.tipo] : ""}
                      </span>
                    </div>
                    <Button
                      variant="ghost" size="icon"
                      className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => fi.sup_item && setOpcoesItem(fi.sup_item)}
                      aria-label="Opções do material"
                      title="Tamanhos / quantidades / litros"
                    >
                      <Settings2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-6 w-6 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={() => {
                        const nome = fi.sup_item?.nome ?? "material";
                        if (confirm(`Remover "${nome}" do enxoval?`)) {
                          m.removerDoEnxoval.mutate({ id: fi.id, itemNome: nome, ctx });
                        }
                      }}
                      aria-label="Remover do enxoval"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost" size="sm"
                  className="mt-1 h-8 w-full justify-start text-muted-foreground"
                  onClick={() => setAddItemAberto(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Adicionar material
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <DialogAdicionarMaterial
        aberto={addItemAberto}
        onFechar={() => setAddItemAberto(false)}
        catalogo={catalogo}
        jaNoEnxoval={new Set(enxoval.map((e) => e.item_id))}
        onAdicionar={(itemId, itemNome) =>
          funcaoId && m.adicionarAoEnxoval.mutate({
            funcaoId, itemId, itemNome, ordem: enxoval.length + 1, ctx,
          })}
        onCriarMaterial={async (nome, tipo) => await m.criarItem.mutateAsync({ nome, tipo })}
      />

      <DialogOpcoes item={opcoesItem} onFechar={() => setOpcoesItem(null)} onSalvar={m.salvarOpcoes.mutate} />
    </div>
  );
}

/** Escolhe um material do catálogo mestre — ou cria um novo na hora. */
function DialogAdicionarMaterial({
  aberto, onFechar, catalogo, jaNoEnxoval, onAdicionar, onCriarMaterial,
}: {
  aberto: boolean;
  onFechar: () => void;
  catalogo: Item[];
  jaNoEnxoval: Set<string>;
  onAdicionar: (itemId: string, itemNome: string) => void;
  onCriarMaterial: (nome: string, tipo: TipoItem) => Promise<string>;
}) {
  const [busca, setBusca] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoTipo, setNovoTipo] = useState<TipoItem>("uniforme");

  const disponiveis = useMemo(
    () => catalogo
      .filter((i) => !jaNoEnxoval.has(i.id))
      .filter((i) => i.nome.toLowerCase().includes(busca.toLowerCase())),
    [catalogo, jaNoEnxoval, busca],
  );

  const criarEIncluir = async () => {
    if (!novoNome.trim()) return;
    const id = await onCriarMaterial(novoNome.trim(), novoTipo);
    if (id) onAdicionar(id, novoNome.trim().toUpperCase());
    setNovoNome("");
    onFechar();
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      {/* overflow-x-hidden + min-w-0 nos filhos: sem isso o nome longo de um
          material empurrava o conteúdo e o modal ganhava barra horizontal. */}
      <DialogContent className="max-h-[85vh] w-[calc(100vw-2rem)] max-w-3xl overflow-x-hidden overflow-y-auto">
        <DialogHeader><DialogTitle>Adicionar material ao enxoval</DialogTitle></DialogHeader>

        <div className="min-w-0 space-y-4 py-2">
          <div className="min-w-0">
            <Label>Buscar no catálogo</Label>
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: camiseta, botina, luva…" />
            <div className="mt-2 max-h-72 space-y-1 overflow-y-auto overflow-x-hidden rounded-md border p-1">
              {disponiveis.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  Nenhum material disponível. Crie um abaixo.
                </p>
              )}
              {disponiveis.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  onClick={() => { onAdicionar(i.id, i.nome); onFechar(); }}
                  className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="min-w-0 flex-1 truncate">{i.nome}</span>
                  <Badge variant="secondary" className="shrink-0 text-[10px]">{LABEL_TIPO_ITEM[i.tipo]}</Badge>
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0 rounded-md border border-dashed p-3">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Não está no catálogo? Crie
            </Label>
            {/* Grid que quebra no estreito, em vez de flex que estoura. */}
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_11rem_auto]">
              <Input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Nome do material"
                className="min-w-0"
              />
              <Select value={novoTipo} onValueChange={(v) => setNovoTipo(v as TipoItem)}>
                <SelectTrigger className="min-w-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(LABEL_TIPO_ITEM) as TipoItem[]).map((t) => (
                    <SelectItem key={t} value={t}>{LABEL_TIPO_ITEM[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={criarEIncluir} disabled={!novoNome.trim()}>Criar</Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              O tipo separa o que aparece em "Uniformes" do que aparece em "EPIs e Insumos" na tela do encarregado.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Opções do material (tamanho / quantidade / litros), por chips clicáveis.
 * Vinculadas ao ITEM, não ao nome dele: no legado eram globais por nome, e
 * renomear um item orfãozava as opções (ARQUITETURA-COMPLETA.md §14.6).
 */
function DialogOpcoes({
  item, onFechar, onSalvar,
}: {
  item: Item | null;
  onFechar: () => void;
  onSalvar: (v: {
    itemId: string; itemNome: string;
    opcoesPorTipo: Record<"tamanho" | "quantidade" | "litros", string[]>;
  }) => void;
}) {
  const { data: existentes = [], isLoading } = useItemOpcoes(item?.id ?? null);
  const [rascunho, setRascunho] = useState<Record<string, string[]> | null>(null);

  // Semeia a partir do banco na primeira abertura de cada item.
  const atual = rascunho ?? {
    tamanho: existentes.find((o) => o.tipo === "tamanho")?.opcoes ?? [],
    quantidade: existentes.find((o) => o.tipo === "quantidade")?.opcoes ?? [],
    litros: existentes.find((o) => o.tipo === "litros")?.opcoes ?? [],
  };

  const alternar = (tipo: string, valor: string) => {
    const lista = atual[tipo] ?? [];
    const nova = lista.includes(valor) ? lista.filter((v) => v !== valor) : [...lista, valor];
    setRascunho({ ...atual, [tipo]: nova });
  };

  const fechar = () => { setRascunho(null); onFechar(); };

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && fechar()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Opções de "{item?.nome}"</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            O encarregado só vê os selects que tiverem opção marcada aqui. Sem nenhuma marcada,
            o material é pedido sem escolha.
          </p>
          {/* Sem este guarda, clicar num chip antes da query voltar semeia o
              rascunho vazio e as opções já salvas somem sem aviso. */}
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Carregando opções…</p>
          ) : (
          (["tamanho", "quantidade", "litros"] as const).map((tipo) => (
            <div key={tipo}>
              <Label className="capitalize">{tipo}</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {OPCOES_PREDEFINIDAS[tipo].map((v) => {
                  const marcado = (atual[tipo] ?? []).includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => alternar(tipo, v)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        marcado
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted",
                      )}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
          )))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar}>Cancelar</Button>
          <Button
            disabled={isLoading}
            onClick={() => {
              if (!item) return;
              onSalvar({
                itemId: item.id,
                itemNome: item.nome,
                opcoesPorTipo: {
                  tamanho: atual.tamanho ?? [],
                  quantidade: atual.quantidade ?? [],
                  litros: atual.litros ?? [],
                },
              });
              fechar();
            }}
          >
            Salvar opções
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
