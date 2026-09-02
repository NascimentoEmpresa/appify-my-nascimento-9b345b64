import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { LayoutGrid, Package, Lock, ShoppingCart, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { usePlanejamentosOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useRubricasVinculadas, RubricaVinculada } from "@/hooks/useRubricasMalote";
import { usePlanilhaCustos, resolverValorPorCampos } from "@/hooks/usePlanilhaCusto";
import {
  useSalvarDespesa,
  useDespesa,
  useEmpresasGrupo,
  useContratosAtivos,
  uploadAnexosMalote,
  TipoSolicitacao,
  STATUS_LABEL,
  ItemSolicitacao,
} from "@/hooks/useMaloteDespesa";
import { ItensSolicitacao } from "@/components/malote/ItensSolicitacao";
import { AnexosField } from "./AnexosField";
import { getStatusVigencia } from "./orcamentoUtils";
import { Campo, PainelDespesaMalote, PainelHeader, PrefillDespesa } from "./PainelDespesaMalote";

export default function CriarDespesa() {
  const [searchParams] = useSearchParams();
  const solicitacaoId = searchParams.get("solicitacaoId");

  if (solicitacaoId) {
    return <ConverterSolicitacaoEmDespesa solicitacaoId={solicitacaoId} />;
  }

  // Prefill por querystring: outra tela manda a despesa já montada (hoje é o
  // "Pagar" do Patrimônio) e o usuário confere aqui em vez de redigitar. É a
  // MESMA tela do Malote — clonar o formulário faria as regras de aprovação,
  // rateio e parcelamento existirem em dois lugares.
  const inicial: PrefillDespesa = {
    rubrica: searchParams.get("rubrica") ?? "",
    nome: searchParams.get("nome") ?? "",
    valor: searchParams.get("valor") ?? "",
    dataPagamento: searchParams.get("pagamento") ?? "",
    competencia: searchParams.get("competencia") ?? "",
    formaPagamento: searchParams.get("forma") ?? "",
    informacoesPagamento: searchParams.get("info") ?? "",
  };

  return <CriarDespesaNova inicial={inicial} />;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// ============================================================================
// Fluxo normal: escolher classificação e preencher Solicitação OU Despesa
// ============================================================================
function CriarDespesaNova({ inicial }: { inicial?: PrefillDespesa }) {
  const navigate = useNavigate();
  const { data: empresaId } = useEmpresaId();
  const { data: rubricas = [] } = useRubricasVinculadas();
  const [rubricaId, setRubricaId] = useState("");

  // Casa a rubrica pedida com a lista assim que ela carrega. Se o nome não
  // bater com nenhuma, o campo fica vazio de propósito: escolher a rubrica
  // errada é pior do que pedir para a pessoa escolher.
  const rubricaPedida = inicial?.rubrica ?? "";
  useEffect(() => {
    if (!rubricaPedida || rubricaId || rubricas.length === 0) return;
    const alvo = semAcento(rubricaPedida);
    const achou = rubricas.find((r) => semAcento(r.label) === alvo)
      ?? rubricas.find((r) => semAcento(r.label).includes(alvo));
    if (achou) setRubricaId(achou.id);
  }, [rubricaPedida, rubricas, rubricaId]);

  const rubrica = rubricas.find((r) => r.id === rubricaId) ?? null;
  const classificacao = rubrica?.classificacaoMalote ?? null;
  const modo: "solicitacao" | "despesa" | null = !classificacao ? null : classificacao.requer_solicitacao ? "solicitacao" : "despesa";

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Criar Despesa"
        subtitle="Selecione a classificação para habilitar os tipos de despesa disponíveis e criar o registro."
        module="Malote"
        breadcrumb={["Malote", "Criar Despesa"]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/malote/meus-itens">
              <Package className="h-4 w-4 mr-2" /> Meus Itens
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-6 space-y-1">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4">
            <div className="flex-1 w-full">
              <Label>
                Rubrica <span className="text-destructive">*</span>
              </Label>
              <SearchableSelect
                value={rubricaId}
                onChange={setRubricaId}
                options={rubricas.map((r) => ({
                  value: r.id,
                  label: r.label,
                  hint: r.origem === "administrativo" ? "Administrativo" : "Contrato",
                }))}
                placeholder="Selecione a rubrica da despesa"
                searchPlaceholder="Buscar rubrica..."
              />
            </div>
            <div className="shrink-0">
              <Label className="invisible hidden sm:block">Ação</Label>
              <Button variant="outline" onClick={() => navigate("/app/malote/ratear-classificacao")} className="gap-2 w-full sm:w-auto">
                <LayoutGrid className="h-4 w-4" /> Ratear classificação
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A rubrica escolhida define a Classificação Malote (aprovadores e regras) e sugere o valor a partir do orçamento. Só aparecem rubricas já vinculadas a uma Classificação — configure em{" "}
            <Link to="/app/malote/configuracoes" className="underline">
              Ligação de Classificações
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PainelSolicitacao rubrica={rubrica} empresaId={empresaId ?? null} ativo={modo === "solicitacao"} />
        <PainelDespesaMalote classificacaoId={classificacao?.id ?? ""} classificacaoTipo={classificacao?.tipo ?? null} empresaId={empresaId ?? null} ativo={modo === "despesa"} inicial={inicial} />
      </div>

      {!modo && (
        <p className="text-xs text-muted-foreground text-center">
          Selecione uma rubrica para habilitar os tipos de despesa e preencher os formulários acima.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// Fluxo de conversão: solicitação já cotada e aprovada pelo Suprimentos
// (status='cotacao_aprovada') virando uma Despesa de verdade. Chega aqui a
// partir de um clique em Meus Itens — ver abrirItem em MeusItens.tsx.
// ============================================================================
function ConverterSolicitacaoEmDespesa({ solicitacaoId }: { solicitacaoId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useDespesa(solicitacaoId);
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const solicitacao = data?.despesa;

  if (isLoading) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }
  if (!solicitacao) {
    return <div className="p-6 text-muted-foreground">Solicitação não encontrada.</div>;
  }
  if (solicitacao.status !== "cotacao_aprovada") {
    return (
      <div className="p-6 space-y-4">
        <p className="text-muted-foreground">
          Esta solicitação está com status "{STATUS_LABEL[solicitacao.status]}" — só é possível converter em despesa quando o status é "Cotação aprovada".
        </p>
        <Button variant="outline" onClick={() => navigate("/app/malote/meus-itens")}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Voltar pra Meus Itens
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Criar Despesa"
        subtitle="Solicitação já cotada e aprovada — complete os dados de pagamento e rateio para lançar a despesa no malote."
        module="Malote"
        breadcrumb={["Malote", "Criar Despesa"]}
        actions={
          <Button variant="outline" asChild>
            <Link to="/app/malote/meus-itens">
              <Package className="h-4 w-4 mr-2" /> Meus Itens
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6 space-y-4">
            <PainelHeader
              icon={<ShoppingCart className="h-4 w-4 mt-0.5 text-muted-foreground" />}
              titulo="Solicitação de Despesa / Compra / Manutenção"
              subtitulo="Preencha os dados para solicitar uma despesa, compra ou manutenção."
              ativo
            />
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <Campo label="Nome da solicitação" valor={solicitacao.nome} />
                <Campo label="Motivo" valor={solicitacao.motivo} />
              </div>
              <Campo label="Descrição" valor={solicitacao.descricao} />
              <div className="grid grid-cols-2 gap-4">
                <Campo label="Valor estimado" valor={Number(solicitacao.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} />
                <Campo label="Link(s)" valor={solicitacao.links} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Campo label="Tipo" valor={solicitacao.tipo ? TIPO_SOLICITACAO_LABEL[solicitacao.tipo] : null} />
                <Campo label="Classificação de despesa" valor={solicitacao.classificacao?.nome} />
              </div>
              {solicitacao.tipo === "contrato" && (
                <div className="grid grid-cols-2 gap-4">
                  <Campo label="Empresa" valor={empresas.find((e) => e.id === solicitacao.empresa_id)?.nome} />
                  <Campo label="Contrato" valor={contratos.find((c) => c.id === solicitacao.contrato_id)?.nome} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Status da solicitação</p>
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-xs font-medium mt-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Solicitação aprovada
                  </span>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status da cotação</p>
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 text-xs font-medium mt-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Cotação realizada
                  </span>
                </div>
              </div>
              {solicitacao.valor_aprovado_cotacao != null && (
                <Campo
                  label="Valor aprovado na cotação"
                  valor={Number(solicitacao.valor_aprovado_cotacao).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                />
              )}
              {solicitacao.arquivos.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Arquivos anexados</p>
                  <p className="text-xs">{solicitacao.arquivos.length} arquivo(s)</p>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground border-t border-border pt-2">
              Dados preenchidos pela solicitação e pela cotação (Suprimentos) — bloqueados, não podem ser alterados aqui.
            </p>
          </CardContent>
        </Card>

        <PainelDespesaMalote
          classificacaoId={solicitacao.classificacao_id ?? ""}
          classificacaoTipo={solicitacao.tipo === "administrativo" || solicitacao.tipo === "contrato" ? solicitacao.tipo : null}
          empresaId={solicitacao.empresa_id}
          ativo
          despesaIdExistente={solicitacao.id}
          origem="solicitacao"
          nomeInicial={solicitacao.nome}
          valorInicial={solicitacao.valor_aprovado_cotacao ?? solicitacao.valor_total}
          onConvertida={() => navigate("/app/malote/meus-itens")}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Painel: Solicitação de Despesa / Compra / Manutenção
// ============================================================================
const TIPO_SOLICITACAO_LABEL: Record<TipoSolicitacao, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

function PainelSolicitacao({
  rubrica,
  empresaId,
  ativo,
}: {
  rubrica: RubricaVinculada | null;
  empresaId: string | null;
  ativo: boolean;
}) {
  const classificacaoId = rubrica?.classificacaoMalote.id ?? "";
  const classificacaoTipo = rubrica?.classificacaoMalote.tipo ?? null;

  const salvar = useSalvarDespesa();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: planilhaCustos = [], isLoading: carregandoPlanilha } = usePlanilhaCustos();
  const { data: planejamentosAdmin = [], isLoading: carregandoPlanejamento } = usePlanejamentosOrcamento(empresaId);
  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valorEstimado, setValorEstimado] = useState("");
  const [valorSugerido, setValorSugerido] = useState(false);
  const [links, setLinks] = useState("");
  // Itens do que está sendo pedido (SIS-2026-0207). Opcional: solicitação de
  // serviço ou despesa avulsa continua valendo só com a descrição.
  const [itens, setItens] = useState<ItemSolicitacao[]>([]);
  const [tipo, setTipo] = useState<TipoSolicitacao | "">("");
  const [empresaContratoId, setEmpresaContratoId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState<"rascunho" | "enviar" | null>(null);
  const chaveAutoPreenchidaRef = useRef<string | null>(null);

  // A Classificação Malote já define se a despesa é de Contrato ou
  // Administrativo — o Tipo aqui só reflete isso e trava, evitando pedir a
  // mesma informação duas vezes. "Dispensa de cotação" só fica selecionável
  // quando a classificação não tem tipo definido (legado).
  const tipoTravado: TipoSolicitacao | null = classificacaoTipo;

  // Sugere o Valor estimado a partir da rubrica escolhida: pra rubrica de
  // Contrato, soma da planilha de custo vigente daquele contrato; pra
  // rubrica Administrativa, o valor vigente do Orçamento Administrativo da
  // empresa. Só recalcula quando rubrica/contrato mudam de verdade (não a
  // cada refetch em background) pra não brigar com edição manual do valor.
  useEffect(() => {
    if (!rubrica) return;
    if (rubrica.origem === "contrato" && (!contratoId || carregandoPlanilha)) return;
    if (rubrica.origem === "administrativo" && carregandoPlanejamento) return;

    const chave = `${rubrica.id}|${rubrica.origem === "contrato" ? contratoId : ""}`;
    if (chaveAutoPreenchidaRef.current === chave) return;
    chaveAutoPreenchidaRef.current = chave;

    if (rubrica.origem === "contrato") {
      const valor = resolverValorPorCampos(planilhaCustos, contratoId, [rubrica.campoOuId]);
      setValorEstimado(valor > 0 ? String(valor) : "");
      setValorSugerido(valor > 0);
    } else {
      const linha = planejamentosAdmin.find(
        (p) => p.classificacao_id === rubrica.campoOuId && getStatusVigencia(p.inicio_vigencia, p.fim_vigencia) === "na_vigencia"
      );
      setValorEstimado(linha ? String(linha.valor) : "");
      setValorSugerido(!!linha);
    }
  }, [rubrica, contratoId, carregandoPlanilha, carregandoPlanejamento, planilhaCustos, planejamentosAdmin]);

  useEffect(() => {
    if (tipoTravado) {
      setTipo(tipoTravado);
    } else {
      setTipo("");
      setEmpresaContratoId("");
      setContratoId("");
    }
  }, [tipoTravado, classificacaoId]);

  function handleContratoChange(id: string) {
    setContratoId(id);
    const c = contratos.find((ct) => ct.id === id);
    setEmpresaContratoId(c?.empresa_id ?? "");
  }

  function validar(paraEnviar: boolean): string | null {
    if (!nome.trim()) return "Informe o nome da solicitação.";
    if (!motivo.trim()) return "Informe o motivo.";
    if (!descricao.trim()) return "Informe a descrição.";
    if (!valorEstimado || Number(valorEstimado) <= 0) return "Informe o valor estimado.";
    if (!tipo) return "Selecione o tipo.";
    if (tipo === "contrato" && !empresaContratoId) return "Selecione a empresa do contrato.";
    if (tipo === "contrato" && !contratoId) return "Selecione o contrato.";
    const itemQuantidadeInvalida = itens.find(
      (item) => item.nome_item.trim() !== "" && Number(item.quantidade) <= 0,
    );
    if (itemQuantidadeInvalida) {
      return `Informe uma quantidade maior que zero para o item "${itemQuantidadeInvalida.nome_item}".`;
    }
    if (paraEnviar && arquivos.length === 0) return "Anexe ao menos um arquivo.";
    return null;
  }

  // Enviar aqui manda a solicitação pra Aprovação Inicial do Malote (SIS-
  // 2026-0132 Fase 2) — só depois de aprovada é que vai pra fila de cotação
  // do Suprimentos. NÃO entra direto no fluxo de aprovação N1/N2/N3 da
  // Despesa. Ela só vira uma Despesa de verdade depois que o Suprimentos
  // cotar, o aprovador escolher a cotação e o usuário converter em Criar
  // Despesa (ver bloco de conversão mais abaixo neste arquivo).
  async function handleSalvar(status: "rascunho" | "aguardando_aprovacao_inicial") {
    const erro = validar(status === "aguardando_aprovacao_inicial");
    if (erro) {
      toast.error(erro);
      return;
    }
    if (!empresaId) {
      toast.error("Empresa não identificada.");
      return;
    }
    setSalvando(status === "rascunho" ? "rascunho" : "enviar");
    try {
      const empresaFinal = tipo === "contrato" ? empresaContratoId : empresaId;
      const despesaId = await salvar.mutateAsync({
        empresa_id: empresaFinal,
        classificacao_id: classificacaoId,
        origem: "solicitacao",
        status,
        nome: nome.trim(),
        valor_total: Number(valorEstimado),
        motivo: motivo.trim(),
        descricao: descricao.trim(),
        links: links.trim() || null,
        tipo: tipo || null,
        contrato_id: tipo === "contrato" ? contratoId : null,
        // Linha sem material descrito não vai: o usuário pode ter clicado em
        // "adicionar item" e desistido.
        itens: itens.filter((i) => i.nome_item.trim() !== ""),
      });
      if (arquivos.length > 0) {
        const paths = await uploadAnexosMalote(arquivos, despesaId, nome.trim());
        await salvar.mutateAsync({ id: despesaId, empresa_id: empresaFinal, classificacao_id: classificacaoId, origem: "solicitacao", status, nome: nome.trim(), valor_total: Number(valorEstimado), arquivos: paths });
      }
      toast.success(status === "rascunho" ? "Rascunho salvo." : "Solicitação enviada para aprovação inicial.");
      setNome(""); setMotivo(""); setDescricao(""); setValorEstimado(""); setValorSugerido(false); setLinks(""); setArquivos([]); setItens([]);
      setEmpresaContratoId(""); setContratoId("");
      chaveAutoPreenchidaRef.current = null;
      if (!tipoTravado) setTipo("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar solicitação.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <PainelHeader icon={<ShoppingCart className="h-4 w-4 mt-0.5 text-muted-foreground" />} titulo="Solicitação de Despesa / Compra / Manutenção" subtitulo="Preencha os dados para solicitar uma despesa, compra ou manutenção." ativo={ativo} />

        <div className={cn("space-y-4", !ativo && "opacity-40 pointer-events-none select-none")}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Nome da solicitação *</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Despesa de notebooks" disabled={!ativo} />
            </div>
            <div>
              <Label>Motivo *</Label>
              <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex: Necessidade operacional da equipe" disabled={!ativo} />
            </div>
          </div>

          <div>
            <Label>Descrição *</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Detalhes, especificações..." disabled={!ativo} />
          </div>

          {/* Itens do pedido (SIS-2026-0207). Antes o comprador cotava lendo a
              descrição em texto corrido; agora recebe a lista, puxando do
              catálogo — e o que for pedido segue até o recebimento. */}
          <div className={cn(!ativo && "opacity-40 pointer-events-none select-none")}>
            <Label>Itens a comprar</Label>
            <p className="mb-2 text-xs text-muted-foreground">
              Opcional, mas é o que o Suprimentos usa para cotar. Materiais do
              catálogo entram pela busca; o que não estiver lá pode ser descrito
              à mão.
            </p>
            <ItensSolicitacao itens={itens} onChange={setItens} editavel={ativo} />
          </div>

          <div>
            <Label>Tipo *</Label>
            {tipoTravado ? (
              <div className="flex items-center gap-1.5 h-10 px-3 rounded-md border border-input bg-muted text-sm text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> {TIPO_SOLICITACAO_LABEL[tipoTravado]}
              </div>
            ) : (
              <Select
                value={tipo}
                onValueChange={(v) => setTipo(v as TipoSolicitacao)}
                disabled={!ativo}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TIPO_SOLICITACAO_LABEL) as [TipoSolicitacao, string][]).map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {tipoTravado && (
              <p className="text-xs text-muted-foreground mt-1">Definido pela rubrica selecionada.</p>
            )}
          </div>

          {tipo === "contrato" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Contrato *</Label>
                <SearchableSelect
                  value={contratoId}
                  onChange={handleContratoChange}
                  options={contratos.map((c) => ({ value: c.id, label: c.nome }))}
                  placeholder="Selecione o contrato..."
                  disabled={!ativo}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Empresa</Label>
                <p className="h-10 flex items-center text-sm text-muted-foreground">
                  {empresas.find((e) => e.id === empresaContratoId)?.nome ?? "Derivada do contrato selecionado"}
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Valor estimado *</Label>
              <Input
                type="number"
                step="0.01"
                value={valorEstimado}
                onChange={(e) => {
                  setValorEstimado(e.target.value);
                  setValorSugerido(false);
                }}
                placeholder="Ex: R$ 1.500,00"
                disabled={!ativo}
              />
              {valorSugerido && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Valor sugerido {rubrica?.origem === "contrato" ? "do orçamento do contrato" : "do orçamento administrativo"} — confira antes de enviar.
                </p>
              )}
            </div>
            <div>
              <Label>Link(s)</Label>
              <Input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://..." disabled={!ativo} />
            </div>
          </div>

          <div>
            <Label>Arquivos anexados *</Label>
            <AnexosField arquivos={arquivos} onChange={setArquivos} disabled={!ativo} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleSalvar("rascunho")} disabled={!ativo || salvando !== null}>
              {salvando === "rascunho" ? "Salvando..." : "Salvar rascunho"}
            </Button>
            <Button onClick={() => handleSalvar("aguardando_aprovacao_inicial")} disabled={!ativo || salvando !== null}>
              {salvando === "enviar" ? "Enviando..." : "Enviar solicitação"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
