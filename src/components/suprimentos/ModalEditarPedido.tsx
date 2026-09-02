import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ColaboradorCombobox, type Colaborador } from "@/components/encarregados/ColaboradorCombobox";
import { useItensEnxoval, useEditarPedido, type ItemEnxoval } from "@/hooks/useSupPedidos";
import { useTagsDoPedido } from "@/hooks/useSupEstoque";
import {
  edicaoReduzida, itensTravados, montarItensPayload, resumoAlteracoes, validarEdicao,
  type LinhaEditavel,
} from "@/lib/suprimentos/pedidoEdicao";
import { Lock, Plus, Trash2, AlertTriangle, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Editar um pedido de materiais já criado.
 *
 * Existe porque a única correção possível era APAGAR e refazer: o encarregado
 * pedia o tamanho errado ou esquecia um item, ligava para o Supply, e o
 * pedido inteiro sumia — junto com protocolo, data de solicitação e trilha.
 * Foi pedido pelo usuário final exatamente assim: "editar, mas com log de
 * quem mudou, o quê e quando".
 *
 * Quem grava é a RPC `sup_pedido_editar` (transação única); quem registra a
 * trilha são os triggers de auditoria em sup_pedido/sup_pedido_item. Esta
 * tela NÃO é a dona de nenhuma regra — tudo que ela impede, o banco também
 * impede. As travas aqui existem só para o operador não descobrir o "não
 * pode" depois de preencher a tela inteira.
 *
 * Três travas, todas espelhadas no banco:
 *   • contrato / posto / função são só leitura. Trocá-los mudaria o catálogo
 *     de itens válidos e a identidade do pedido — para isso, excluir e
 *     refazer continua sendo o caminho;
 *   • pedido DESPACHADO ou CANCELADO abre em modo reduzido, só observações;
 *   • item que já consumiu etiqueta aparece com cadeado: a peça saiu do
 *     estoque de verdade, e mexer nela quebraria a rastreabilidade (é a
 *     dívida §12.7 do legado, onde editar reordenava o array JSONB e
 *     desamarrava as TAGs em silêncio).
 */

interface ItemDoPedido {
  id: string; item_id: string | null; nome_item: string; tipo_item: string;
  tamanho: string | null; quantidade: number; litros: string | null; ordem: number;
}

export interface PedidoParaEdicao {
  id: string; pedido_id: string; status: string;
  contrato_nome: string; posto_nome: string; funcao_nome: string;
  funcao_id: string | null;
  contrato_id: string | null;
  nome_colaborador: string; matricula_colaborador: string | null;
  colaborador_empregado_id: number | null; colaborador_digitado: boolean;
  admissao: boolean; tipo_admissao: string | null; data_admissao: string | null;
  tipo_pedido: string;
  observacoes_solicitante: string | null; observacao: string | null;
  sup_pedido_item: ItemDoPedido[];
}

/** Linha em edição. `id` nulo = item entrando agora. */
type LinhaItem = LinhaEditavel;

const TIPOS_PEDIDO = [
  { valor: "uniforme", rotulo: "Uniforme" },
  { valor: "insumos", rotulo: "EPIs e Insumos" },
  { valor: "ambos", rotulo: "Uniforme + EPIs" },
];

export function ModalEditarPedido({
  pedido, onFechar,
}: { pedido: PedidoParaEdicao | null; onFechar: () => void }) {
  const editar = useEditarPedido();
  const { data: tags = [], isLoading: carregandoTags } = useTagsDoPedido(pedido?.id ?? null);

  const travado = edicaoReduzida(pedido?.status);
  // O catálogo da função alimenta o "adicionar item"; em modo reduzido não há
  // o que adicionar, então nem se busca.
  const { data: catalogo = [] } = useItensEnxoval(travado ? null : pedido?.funcao_id ?? null);

  const [idAtual, setIdAtual] = useState<string | null>(null);
  const [colaborador, setColaborador] = useState<Colaborador | null>(null);
  const [nomeColaborador, setNomeColaborador] = useState("");
  const [admissao, setAdmissao] = useState(false);
  const [tipoAdmissao, setTipoAdmissao] = useState("substituicao");
  const [dataAdmissao, setDataAdmissao] = useState("");
  const [tipoPedido, setTipoPedido] = useState("uniforme");
  const [obsSolicitante, setObsSolicitante] = useState("");
  const [obsCompras, setObsCompras] = useState("");
  const [linhas, setLinhas] = useState<LinhaItem[]>([]);
  const [aAdicionar, setAAdicionar] = useState("");

  // Semeia ao abrir/trocar de pedido. Espera as etiquetas carregarem: sem
  // elas a tela mostraria como editável um item que está travado, e o erro
  // só apareceria ao salvar.
  const chave = `${pedido?.id ?? ""}|${carregandoTags ? "…" : tags.length}`;
  if (pedido && chave !== idAtual && !carregandoTags) {
    setIdAtual(chave);
    setAdmissao(pedido.admissao);
    // `colaborador_digitado` só existe em pedido feito depois de 30/08/2026;
    // em admissão antiga ele vem falso mesmo com o nome digitado, e sem o
    // `|| admissao` o campo abriria vazio e a validação cobraria o nome.
    setNomeColaborador(
      pedido.colaborador_digitado || pedido.admissao ? pedido.nome_colaborador : "",
    );
    setColaborador(
      pedido.colaborador_empregado_id
        ? {
            // O pedido guarda o snapshot de nome e matrícula: é ele que vale
            // na tela, e não uma nova leitura de EMPREGADOS — a pessoa pode
            // ter sido desligada depois, e o pedido continua sendo o que foi.
            empregado_id: pedido.colaborador_empregado_id,
            nome: pedido.nome_colaborador,
            matricula: pedido.matricula_colaborador,
            contrato_nome: pedido.contrato_nome,
            do_meu_contrato: true,
          }
        : null,
    );
    setTipoAdmissao(pedido.tipo_admissao ?? "substituicao");
    setDataAdmissao(pedido.data_admissao ?? "");
    setTipoPedido(pedido.tipo_pedido);
    setObsSolicitante(pedido.observacoes_solicitante ?? "");
    setObsCompras(pedido.observacao ?? "");
    setLinhas(
      [...(pedido.sup_pedido_item ?? [])]
        .sort((a, b) => a.ordem - b.ordem)
        .map((i) => ({
          id: i.id,
          item_id: i.item_id,
          nome_item: i.nome_item,
          tamanho: i.tamanho ?? "",
          litros: i.litros ?? "",
          quantidade: String(i.quantidade),
        })),
    );
    setAAdicionar("");
  }

  const travadosPorTag = useMemo(() => itensTravados(tags), [tags]);

  const porCatalogo = useMemo(() => {
    const m = new Map<string, ItemEnxoval>();
    for (const i of catalogo) m.set(i.id, i);
    return m;
  }, [catalogo]);

  // Só oferece o que ainda não está no pedido — repetir o mesmo material na
  // mesma lista confunde na hora de bipar a etiqueta.
  const disponiveis = useMemo(() => {
    const jaTem = new Set(linhas.map((l) => l.item_id).filter(Boolean));
    return catalogo.filter((i) => !jaTem.has(i.id));
  }, [catalogo, linhas]);

  const alterarLinha = (idx: number, patch: Partial<LinhaItem>) =>
    setLinhas((s) => s.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  const adicionar = (itemId: string) => {
    const it = porCatalogo.get(itemId);
    if (!it) return;
    setLinhas((s) => [
      ...s,
      {
        id: null,
        item_id: it.id,
        nome_item: it.nome,
        tamanho: it.opcao_tamanho?.[0] ?? "",
        litros: it.opcao_litros?.[0] ?? "",
        quantidade: it.opcao_quantidade?.[0] ?? "1",
      },
    ]);
    setAAdicionar("");
  };

  const remover = (idx: number) => setLinhas((s) => s.filter((_, i) => i !== idx));

  const fechar = () => { setIdAtual(null); onFechar(); };

  const salvar = () => {
    if (!pedido) return;

    if (!travado) {
      const erro = validarEdicao({
        admissao,
        nomeColaborador,
        temColaborador: !!colaborador,
        nomeJaGravado: pedido.nome_colaborador,
        tipoPedido,
        linhas,
        exigeTamanho: (itemId) =>
          !!(itemId && porCatalogo.get(itemId)?.opcao_tamanho?.length),
      });
      if (erro) { toast.error(erro); return; }
    }

    editar.mutate(
      {
        pedido_id: pedido.id,
        ...(travado
          ? {}
          : {
              colaborador_empregado_id: admissao ? null : colaborador?.empregado_id ?? null,
              nome_colaborador: admissao ? nomeColaborador.trim() : null,
              admissao,
              tipo_admissao: admissao ? tipoAdmissao : null,
              data_admissao: admissao ? dataAdmissao || null : null,
              tipo_pedido: tipoPedido,
              itens: montarItensPayload(linhas),
            }),
        observacoes_solicitante: obsSolicitante,
        observacao: obsCompras,
      },
      {
        onSuccess: (r) => {
          const resumo = resumoAlteracoes(r);
          toast.success(`Pedido ${pedido.pedido_id} atualizado.`, {
            description: resumo || "As alterações estão no histórico.",
          });
          fechar();
        },
        onError: (e: any) =>
          toast.error(e?.message ?? "Não foi possível salvar.", {
            description: "Se o erro for de permissão, seu perfil precisa da ação 'alterar' em Pedidos de Materiais.",
          }),
      },
    );
  };

  return (
    <Dialog open={!!pedido} onOpenChange={(o) => { if (!o) fechar(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar {pedido?.pedido_id}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Cascata: só leitura, sempre. */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="grid gap-1 sm:grid-cols-3">
              <p className="truncate"><span className="text-muted-foreground">Contrato: </span>{pedido?.contrato_nome}</p>
              <p className="truncate"><span className="text-muted-foreground">Posto: </span>{pedido?.posto_nome}</p>
              <p className="truncate"><span className="text-muted-foreground">Função: </span>{pedido?.funcao_nome}</p>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Contrato, posto e função não mudam aqui — eles definem quais materiais o
              pedido pode ter. Se a cascata está errada, exclua e refaça o pedido.
            </p>
          </div>

          {travado && (
            <div className="flex items-start gap-2 rounded-md border border-amber-400/40 bg-amber-50/60 p-3 text-xs dark:bg-amber-950/20">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900 dark:text-amber-200">
                  Pedido {pedido?.status === "DESPACHADO" ? "já despachado" : "cancelado"}: só as observações podem mudar.
                </p>
                <p className="text-amber-800/80 dark:text-amber-200/70">
                  Colaborador e itens ficam como estão — a peça já saiu (ou o pedido foi
                  encerrado), e reescrever isso agora apagaria o que de fato aconteceu.
                </p>
              </div>
            </div>
          )}

          {!travado && (
            <>
              {/* Colaborador — mesma lógica da solicitação: a caixa decide o
                  modo de entrada, porque pessoa nova ainda não está na folha. */}
              <div className="rounded-md border p-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={admissao}
                    onCheckedChange={(v) => {
                      setAdmissao(!!v);
                      setColaborador(null);
                      setNomeColaborador("");
                    }}
                  />
                  <span className="text-sm font-medium">É admissão (colaborador novo)</span>
                </label>

                <div className="mt-3">
                  {admissao ? (
                    <>
                      <Label>Nome do novo colaborador *</Label>
                      <Input
                        className="mt-1"
                        value={nomeColaborador}
                        onChange={(e) => setNomeColaborador(e.target.value)}
                        placeholder="Nome completo, como vai no cadastro"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Sem matrícula: a pessoa ainda não está na folha.
                      </p>
                    </>
                  ) : (
                    <>
                      <Label>Colaborador {tipoPedido !== "insumos" && "*"}</Label>
                      <ColaboradorCombobox
                        valor={colaborador}
                        onEscolher={setColaborador}
                        contratoId={pedido?.contrato_id ?? null}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {colaborador
                          ? `Matrícula ${colaborador.matricula ?? "—"} — preenchida pelo cadastro.`
                          : pedido?.nome_colaborador
                            // Pedido antigo, feito antes do vínculo com a folha:
                            // tem nome e nenhum id. Fica como está se ninguém
                            // escolher — não é obrigatório mexer nisso agora.
                            ? `Gravado no pedido: ${pedido.nome_colaborador}. Escolha alguém da lista só se for trocar.`
                            : "Escolha da lista; a matrícula vem junto."}
                      </p>
                    </>
                  )}
                </div>

                {admissao && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Tipo</Label>
                      <Select value={tipoAdmissao} onValueChange={setTipoAdmissao}>
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="substituicao">Substituição</SelectItem>
                          <SelectItem value="aditivo">Aditivo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Data de admissão</Label>
                      <Input
                        className="mt-1" type="date"
                        value={dataAdmissao}
                        onChange={(e) => setDataAdmissao(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <Label>Tipo de pedido</Label>
                <Select value={tipoPedido} onValueChange={setTipoPedido}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIPOS_PEDIDO.map((t) => (
                      <SelectItem key={t.valor} value={t.valor}>{t.rotulo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Itens */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Itens do pedido</p>
                  <Badge variant="secondary" className="text-[11px]">{linhas.length}</Badge>
                </div>

                <div className="divide-y rounded-md border">
                  {linhas.length === 0 && (
                    <p className="p-4 text-center text-sm text-muted-foreground">
                      Nenhum item. Adicione ao menos um antes de salvar.
                    </p>
                  )}

                  {linhas.map((l, idx) => {
                    const cat = l.item_id ? porCatalogo.get(l.item_id) : undefined;
                    const bloqueado = !!l.id && travadosPorTag.has(l.id);
                    const codigos = tags.filter((t) => t.pedido_item_id === l.id).map((t) => t.codigo);

                    return (
                      <div key={l.id ?? `novo-${idx}`} className={cn("p-3", bloqueado && "bg-muted/40")}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="flex items-center gap-1.5 text-sm font-medium">
                              {bloqueado && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                              <span className="truncate">{l.nome_item}</span>
                              {!l.id && (
                                <Badge variant="secondary" className="shrink-0 text-[10px]">novo</Badge>
                              )}
                            </p>
                            {bloqueado && (
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                Já saiu do estoque com a(s) etiqueta(s) {codigos.join(", ")}. Para
                                mexer, faça a devolução em Estoque &amp; Etiquetas antes.
                              </p>
                            )}
                          </div>
                          <Button
                            type="button" size="icon" variant="ghost"
                            className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10"
                            disabled={bloqueado}
                            onClick={() => remover(idx)}
                            aria-label={`Remover ${l.nome_item}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="mt-2 grid gap-2 sm:grid-cols-3">
                          <CampoItem
                            rotulo="Tamanho"
                            valor={l.tamanho}
                            opcoes={cat?.opcao_tamanho ?? null}
                            disabled={bloqueado}
                            onMudar={(v) => alterarLinha(idx, { tamanho: v })}
                          />
                          <div>
                            <Label className="text-xs">Quantidade</Label>
                            <Input
                              className="mt-1 h-9"
                              type="number" min={1}
                              value={l.quantidade}
                              disabled={bloqueado}
                              onChange={(e) => alterarLinha(idx, { quantidade: e.target.value })}
                            />
                          </div>
                          <CampoItem
                            rotulo="Litros"
                            valor={l.litros}
                            opcoes={cat?.opcao_litros ?? null}
                            disabled={bloqueado}
                            onMudar={(v) => alterarLinha(idx, { litros: v })}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <Select value={aAdicionar} onValueChange={adicionar}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={
                        disponiveis.length ? "Adicionar item do catálogo…" : "Nada mais liberado para esta função"
                      } />
                    </SelectTrigger>
                    <SelectContent>
                      {disponiveis.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Só aparecem os materiais liberados para a função <strong>{pedido?.funcao_nome}</strong>.
                </p>
              </div>
            </>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Obs. do solicitante</Label>
              <Textarea
                className="mt-1" rows={3}
                value={obsSolicitante}
                onChange={(e) => setObsSolicitante(e.target.value)}
                placeholder="O que o encarregado escreveu ao pedir"
              />
            </div>
            <div>
              <Label>Obs. de Compras</Label>
              <Textarea
                className="mt-1" rows={3}
                value={obsCompras}
                onChange={(e) => setObsCompras(e.target.value)}
                placeholder="Comentário interno do Supply"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Tudo que mudar aqui vira uma linha no <strong>Histórico</strong> do pedido, com
            seu nome, a data e a hora.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={fechar} disabled={editar.isPending}>Cancelar</Button>
          <Button onClick={salvar} disabled={editar.isPending || carregandoTags}>
            {editar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Campo de opção do item: vira Select quando o catálogo define as opções e
 * Input livre quando não define — item antigo pode ter saído do catálogo da
 * função, e aí a lista viria vazia e travaria a edição do que já existe.
 */
function CampoItem({
  rotulo, valor, opcoes, disabled, onMudar,
}: {
  rotulo: string; valor: string; opcoes: string[] | null;
  disabled?: boolean; onMudar: (v: string) => void;
}) {
  if (opcoes?.length) {
    return (
      <div>
        <Label className="text-xs">{rotulo}</Label>
        <Select value={valor} onValueChange={onMudar} disabled={disabled}>
          <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <div>
      <Label className="text-xs">{rotulo}</Label>
      <Input
        className="mt-1 h-9"
        value={valor}
        disabled={disabled}
        onChange={(e) => onMudar(e.target.value)}
        placeholder="—"
      />
    </div>
  );
}
