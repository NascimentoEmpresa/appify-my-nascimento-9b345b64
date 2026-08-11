import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/layout/PageHeader";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useModoExterno } from "@/hooks/useModoExterno";
import { useContratosCatalogo } from "@/hooks/useSupCatalogo";
import { ColaboradorCombobox, type Colaborador } from "@/components/encarregados/ColaboradorCombobox";
import {
  useSessaoExterna, usePostosPedido, useFuncoesPedido, useItensEnxoval,
  useCriarPedido, enviarFotoCracha, hojeISO, fmtDataBR, useContratosExternos,
  type ItemEnxoval,
} from "@/hooks/useSupPedidos";
import {
  ChevronLeft, ChevronRight, CheckCircle2, Shirt, HardHat, Upload, Truck, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Solicitar Materiais — wizard do encarregado (4 passos), espelhando a jornada
 * do site externo legado (ARQUITETURA-COMPLETA.md §8.1).
 *
 * Serve os dois públicos com um caminho só:
 *   • externo  → contrato travado no que ele escolheu ao entrar;
 *   • interno  → escolhe o contrato entre os da empresa dele.
 *
 * A cascata e a gravação passam pelas RPCs sup_ext_*, que reconferem no banco
 * que posto/função/item pertencem mesmo àquele contrato.
 */

type Selecao = { tamanho: string; quantidade: string; litros: string };

const PASSOS = ["Dados", "Posto e Função", "Materiais", "Confirmação"];

export default function SolicitarMateriais() {
  const externo = useModoExterno();
  const { data: empresaId } = useEmpresaId();
  const { data: sessao } = useSessaoExterna(externo);
  const { data: contratosInternos = [] } = useContratosCatalogo(externo ? null : empresaId ?? null);

  const [passo, setPasso] = useState(0);
  const [contratoId, setContratoId] = useState<string | null>(null);
  const [postoId, setPostoId] = useState<string | null>(null);
  const [funcaoId, setFuncaoId] = useState<string | null>(null);

  // Fora de admissão o colaborador é ESCOLHIDO da lista; `nomeColaborador` só
  // é usado quando a pessoa ainda não existe na folha (admissão).
  const [colaborador, setColaborador] = useState<Colaborador | null>(null);
  const [nomeColaborador, setNomeColaborador] = useState("");
  const [admissao, setAdmissao] = useState(false);
  const [tipoAdmissao, setTipoAdmissao] = useState("substituicao");
  const [dataAdmissao, setDataAdmissao] = useState("");
  const [cracha, setCracha] = useState<File | null>(null);
  const [observacoes, setObservacoes] = useState("");
  const [selecionados, setSelecionados] = useState<Record<string, Selecao>>({});
  const [protocolo, setProtocolo] = useState<string | null>(null);

  const contratoEfetivo = externo ? sessao?.contrato_id ?? null : contratoId;
  // O externo não pode ler public.contratos (nem deve — ela traz valores e
  // CNPJ do cliente); o nome do contrato dele sai da mesma RPC do login.
  const { data: contratosExternos = [] } = useContratosExternos(externo);
  const nomeContratoExterno = useMemo(
    () => contratosExternos.find((c) => c.id === contratoEfetivo)?.nome ?? null,
    [contratosExternos, contratoEfetivo],
  );
  const { data: postos = [] } = usePostosPedido(contratoEfetivo);
  const { data: funcoes = [] } = useFuncoesPedido(postoId);
  const { data: itens = [] } = useItensEnxoval(funcaoId);
  const criar = useCriarPedido();

  const uniformes = useMemo(() => itens.filter((i) => i.tipo === "uniforme"), [itens]);
  const insumos = useMemo(() => itens.filter((i) => i.tipo !== "uniforme"), [itens]);

  const marcados = useMemo(
    () => itens.filter((i) => !!selecionados[i.id]),
    [itens, selecionados],
  );

  /** tipo_pedido derivado do que foi marcado — o legado pedia isso explícito. */
  const tipoPedido: "uniforme" | "insumos" | "ambos" = useMemo(() => {
    const temUniforme = marcados.some((i) => i.tipo === "uniforme");
    const temInsumo = marcados.some((i) => i.tipo !== "uniforme");
    if (temUniforme && temInsumo) return "ambos";
    return temInsumo ? "insumos" : "uniforme";
  }, [marcados]);

  const alternarItem = (item: ItemEnxoval) => {
    setSelecionados((s) => {
      const novo = { ...s };
      if (novo[item.id]) delete novo[item.id];
      else novo[item.id] = { tamanho: "", quantidade: "", litros: "" };
      return novo;
    });
  };

  const definir = (itemId: string, campo: keyof Selecao, valor: string) =>
    setSelecionados((s) => ({ ...s, [itemId]: { ...s[itemId], [campo]: valor } }));

  // Um item só está completo quando TODOS os selects que ele oferece foram
  // preenchidos — mesma regra do "Avançar" do legado.
  const itemCompleto = (i: ItemEnxoval) => {
    const sel = selecionados[i.id];
    if (!sel) return true;
    if (i.opcao_tamanho?.length && !sel.tamanho) return false;
    if (i.opcao_quantidade?.length && !sel.quantidade) return false;
    if (i.opcao_litros?.length && !sel.litros) return false;
    return true;
  };

  // Duas portas, uma de cada vez: escolheu da lista, ou é admissão e digitou.
  const colaboradorDefinido = admissao ? !!nomeColaborador.trim() : !!colaborador;

  const podeAvancar = (() => {
    if (passo === 0) {
      if (!contratoEfetivo) return false;
      // Colaborador só é exigido quando não é pedido exclusivo de insumos —
      // e nesse passo ainda não sabemos, então exigimos e liberamos no passo 3.
      return true;
    }
    if (passo === 1) return !!postoId && !!funcaoId;
    if (passo === 2) {
      if (marcados.length === 0) return false;
      if (!marcados.every(itemCompleto)) return false;
      if (tipoPedido !== "insumos" && !colaboradorDefinido) return false;
      return true;
    }
    return true;
  })();

  const enviar = async () => {
    if (!contratoEfetivo || !postoId || !funcaoId) return;

    // Falha no upload não derruba o pedido, mas o usuário FICA SABENDO — no
    // legado o erro só ia para o console e a pessoa achava que tinha anexado.
    let crachaPath: string | null = null;
    if (cracha && admissao) {
      try {
        crachaPath = await enviarFotoCracha(cracha);
      } catch {
        toast.warning("Não foi possível enviar a foto do crachá. O pedido segue sem ela.");
      }
    }

    const resultado = await criar.mutateAsync({
      contrato_id: contratoEfetivo,
      posto_id: postoId,
      funcao_id: funcaoId,
      // Escolhido da lista: só o id vai: nome e matrícula a RPC resolve no
      // servidor, e ignora o que vier destes campos. Admissão é o único caso
      // em que o nome digitado vale.
      colaborador_empregado_id: colaborador?.empregado_id ?? null,
      nome_colaborador: admissao ? nomeColaborador.trim() : null,
      admissao,
      tipo_admissao: admissao ? tipoAdmissao : null,
      data_admissao: admissao && dataAdmissao ? dataAdmissao : null,
      imagem_cracha_path: crachaPath,
      tipo_pedido: tipoPedido,
      observacoes_solicitante: observacoes.trim() || null,
      solicitante_nome: sessao?.login_informado ?? null,
      itens: marcados.map((i) => ({
        item_id: i.id,
        nome_item: i.nome,
        tamanho: selecionados[i.id]?.tamanho || null,
        quantidade: Number(selecionados[i.id]?.quantidade || 1),
        litros: selecionados[i.id]?.litros || null,
      })),
    });

    if (resultado?.pedido_id) setProtocolo(resultado.pedido_id);
  };

  // ── Tela de sucesso ──
  if (protocolo) {
    return (
      <div className="mx-auto max-w-lg space-y-6 py-12 text-center">
        <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500" />
        <div>
          <h1 className="font-display text-2xl font-bold">Pedido enviado</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Guarde o número abaixo para acompanhar.
          </p>
        </div>
        <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 py-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Protocolo</p>
          <p className="font-mono text-2xl font-bold">{protocolo}</p>
        </div>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => {
            setProtocolo(null); setPasso(0); setPostoId(null); setFuncaoId(null);
            setSelecionados({}); setNomeColaborador(""); setColaborador(null);
            setAdmissao(false); setDataAdmissao(""); setCracha(null); setObservacoes("");
          }}>
            Fazer outro pedido
          </Button>
          <Button asChild>
            <Link to="/app/encarregados/meus-pedidos">
              <Truck className="mr-2 h-4 w-4" /> Ver meus pedidos
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Solicitar Materiais"
        subtitle="Uniformes, EPIs e insumos para um colaborador do seu posto."
        module="Encarregados"
        breadcrumb={["Solicitar Materiais"]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/encarregados/meus-pedidos">
              <Truck className="mr-2 h-4 w-4" /> Meus pedidos
            </Link>
          </Button>
        }
      />

      {/* Stepper */}
      <div className="flex items-center gap-1">
        {PASSOS.map((p, i) => (
          <div key={p} className="flex flex-1 items-center gap-1">
            <div className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
              i < passo ? "bg-emerald-500 text-white"
                : i === passo ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}>
              {i < passo ? "✓" : i + 1}
            </div>
            <span className={cn(
              "hidden truncate text-xs sm:inline",
              i === passo ? "font-semibold text-foreground" : "text-muted-foreground",
            )}>
              {p}
            </span>
            {i < PASSOS.length - 1 && <div className="h-px flex-1 bg-border" />}
          </div>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{PASSOS[passo]}</CardTitle></CardHeader>
        <CardContent className="space-y-5">

          {/* ── Passo 1: dados ── */}
          {passo === 0 && (
            <>
              <div>
                <Label>Contrato *</Label>
                {externo ? (
                  <div className="mt-1 flex h-10 items-center rounded-md border bg-muted/50 px-3 text-sm">
                    {nomeContratoExterno
                      ? <span className="font-medium">{nomeContratoExterno}</span>
                      : <span className="text-muted-foreground">Carregando…</span>}
                  </div>
                ) : (
                  <Select value={contratoId ?? ""} onValueChange={(v) => { setContratoId(v); setPostoId(null); setFuncaoId(null); }}>
                    <SelectTrigger><SelectValue placeholder="Selecione o contrato" /></SelectTrigger>
                    <SelectContent>
                      {contratosInternos.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {/* A caixa vem ANTES do nome porque é ela que decide o modo de
                  entrada: pessoa que já existe se escolhe da lista; pessoa nova
                  ainda não está na folha, então só resta digitar. */}
              <div className="rounded-md border p-3">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={admissao}
                    onCheckedChange={(v) => {
                      setAdmissao(!!v);
                      // Trocar de modo limpa o outro lado, senão sobra dado do
                      // modo anterior e vai junto no pedido.
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
                        contratoId={contratoEfetivo}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        {colaborador
                          ? `Matrícula ${colaborador.matricula ?? "—"} — preenchida pelo cadastro.`
                          : "Escolha da lista; a matrícula vem junto."}
                      </p>
                    </>
                  )}
                </div>

                {admissao && (
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <div>
                      <Label>Tipo</Label>
                      <Select value={tipoAdmissao} onValueChange={setTipoAdmissao}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="substituicao">Substituição</SelectItem>
                          <SelectItem value="aditivo">Aditivo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Data de admissão</Label>
                      <Input type="date" value={dataAdmissao} onChange={(e) => setDataAdmissao(e.target.value)} />
                    </div>
                    <div>
                      <Label>Foto para crachá</Label>
                      <label className="mt-1 flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted">
                        <Upload className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-muted-foreground">
                          {cracha ? cracha.name : "Escolher imagem"}
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => setCracha(e.target.files?.[0] ?? null)}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                Data da solicitação: <strong>{fmtDataBR(hojeISO())}</strong>
              </div>
            </>
          )}

          {/* ── Passo 2: posto e função ── */}
          {passo === 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Posto *</Label>
                <Select value={postoId ?? ""} onValueChange={(v) => { setPostoId(v); setFuncaoId(null); setSelecionados({}); }}>
                  <SelectTrigger><SelectValue placeholder="Selecione o posto" /></SelectTrigger>
                  <SelectContent>
                    {postos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                {postos.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Nenhum posto liberado neste contrato.</p>
                )}
              </div>
              <div>
                <Label>Função *</Label>
                <Select value={funcaoId ?? ""} onValueChange={(v) => { setFuncaoId(v); setSelecionados({}); }} disabled={!postoId}>
                  <SelectTrigger><SelectValue placeholder={postoId ? "Selecione a função" : "Escolha o posto primeiro"} /></SelectTrigger>
                  <SelectContent>
                    {funcoes.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                {postoId && funcoes.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">Nenhuma função liberada neste posto.</p>
                )}
              </div>
            </div>
          )}

          {/* ── Passo 3: materiais ── */}
          {passo === 2 && (
            <>
              {itens.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Esta função ainda não tem materiais cadastrados. Fale com o time de Compras.
                </p>
              )}
              {uniformes.length > 0 && (
                <ListaItens
                  titulo="Uniformes" icone={Shirt} itens={uniformes}
                  selecionados={selecionados} onAlternar={alternarItem} onDefinir={definir}
                />
              )}
              {insumos.length > 0 && (
                <ListaItens
                  titulo="EPIs e Insumos" icone={HardHat} itens={insumos}
                  selecionados={selecionados} onAlternar={alternarItem} onDefinir={definir}
                />
              )}

              <div>
                <Label>Observação (opcional)</Label>
                <Textarea
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value.slice(0, 500))}
                  rows={3}
                  placeholder="Ex.: colaborador é canhoto; entregar na portaria."
                />
                <p className="mt-1 text-right text-[11px] text-muted-foreground">{observacoes.length}/500</p>
              </div>

              {marcados.length > 0 && tipoPedido !== "insumos" && !colaboradorDefinido && (
                <p className="text-sm text-destructive">
                  Pedido com uniforme exige o colaborador — volte ao passo 1 e escolha da lista,
                  ou marque "É admissão" se a pessoa é nova.
                </p>
              )}
            </>
          )}

          {/* ── Passo 4: confirmação ── */}
          {passo === 3 && (
            <div className="space-y-4 text-sm">
              <Resumo rotulo="Posto" valor={postos.find((p) => p.id === postoId)?.nome ?? "—"} />
              <Resumo rotulo="Função" valor={funcoes.find((f) => f.id === funcaoId)?.nome ?? "—"} />
              <Resumo rotulo="Colaborador" valor={colaborador?.nome || nomeColaborador || "—"} />
              <Resumo rotulo="Matrícula" valor={colaborador?.matricula || (admissao ? "— (admissão)" : "—")} />
              <Resumo rotulo="Admissão" valor={admissao ? `Sim · ${tipoAdmissao} · ${fmtDataBR(dataAdmissao)}` : "Não"} />
              <Resumo rotulo="Data da solicitação" valor={fmtDataBR(hojeISO())} />
              {observacoes && <Resumo rotulo="Observação" valor={observacoes} />}

              <div>
                <p className="mb-2 font-semibold">Materiais ({marcados.length})</p>
                <div className="divide-y rounded-md border">
                  {marcados.map((i) => {
                    const s = selecionados[i.id];
                    const detalhes = [
                      s?.tamanho && `Tam. ${s.tamanho}`,
                      s?.quantidade && `Qtd. ${s.quantidade}`,
                      s?.litros && `${s.litros} L`,
                    ].filter(Boolean).join(" · ");
                    return (
                      <div key={i.id} className="flex items-center justify-between px-3 py-2">
                        <span>{i.nome}</span>
                        <span className="text-xs text-muted-foreground">{detalhes || "—"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={passo === 0} onClick={() => setPasso((p) => p - 1)}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Voltar
        </Button>
        {passo < PASSOS.length - 1 ? (
          <Button disabled={!podeAvancar} onClick={() => setPasso((p) => p + 1)}>
            Avançar <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button disabled={criar.isPending} onClick={enviar}>
            {criar.isPending
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>
              : <><CheckCircle2 className="mr-2 h-4 w-4" /> Enviar pedido</>}
          </Button>
        )}
      </div>
    </div>
  );
}

function Resumo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-40 shrink-0 text-muted-foreground">{rotulo}</span>
      <span className="font-medium">{valor}</span>
    </div>
  );
}

/** Lista de itens de um tipo, com os selects que cada item oferece. */
function ListaItens({
  titulo, icone: Icone, itens, selecionados, onAlternar, onDefinir,
}: {
  titulo: string;
  icone: any;
  itens: ItemEnxoval[];
  selecionados: Record<string, Selecao>;
  onAlternar: (i: ItemEnxoval) => void;
  onDefinir: (itemId: string, campo: keyof Selecao, valor: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Icone className="h-4 w-4 text-muted-foreground" /> {titulo}
        <Badge variant="secondary" className="text-[11px]">{itens.length}</Badge>
      </p>
      <div className="divide-y rounded-md border">
        {itens.map((i) => {
          const sel = selecionados[i.id];
          return (
            <div key={i.id} className="p-3">
              <label className="flex cursor-pointer items-center gap-2">
                <Checkbox checked={!!sel} onCheckedChange={() => onAlternar(i)} />
                <span className="text-sm font-medium">{i.nome}</span>
              </label>

              {sel && (
                <div className="mt-2 grid gap-2 pl-6 sm:grid-cols-3">
                  {!!i.opcao_tamanho?.length && (
                    <CampoOpcao
                      rotulo="Tamanho" valor={sel.tamanho} opcoes={i.opcao_tamanho}
                      onMudar={(v) => onDefinir(i.id, "tamanho", v)}
                    />
                  )}
                  {!!i.opcao_quantidade?.length && (
                    <CampoOpcao
                      rotulo="Quantidade" valor={sel.quantidade} opcoes={i.opcao_quantidade}
                      onMudar={(v) => onDefinir(i.id, "quantidade", v)}
                    />
                  )}
                  {!!i.opcao_litros?.length && (
                    <CampoOpcao
                      rotulo="Litros" valor={sel.litros} opcoes={i.opcao_litros}
                      onMudar={(v) => onDefinir(i.id, "litros", v)}
                    />
                  )}
                  {!i.opcao_tamanho?.length && !i.opcao_quantidade?.length && !i.opcao_litros?.length && (
                    <p className="text-xs text-muted-foreground sm:col-span-3">Sem opções a escolher.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CampoOpcao({
  rotulo, valor, opcoes, onMudar,
}: { rotulo: string; valor: string; opcoes: string[]; onMudar: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{rotulo} *</Label>
      <Select value={valor} onValueChange={onMudar}>
        <SelectTrigger className="h-9"><SelectValue placeholder="Selecione" /></SelectTrigger>
        <SelectContent>
          {opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
