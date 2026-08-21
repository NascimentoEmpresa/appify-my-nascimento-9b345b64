import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { LayoutGrid, Package, Lock, ShoppingCart, FileEdit, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { vincularContaAoMalote, PARAM_ORIGEM } from "@/pages/juridico/patrimonio/vinculoMalote";
import { ConfirmacaoMalote } from "@/components/malote/ConfirmacaoMalote";
import { TipoClassificacaoOrcamento, usePlanejamentosOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useRubricasVinculadas, RubricaVinculada } from "@/hooks/useRubricasMalote";
import { usePlanilhaCustos, resolverValorPorCampos } from "@/hooks/usePlanilhaCusto";
import {
  useSalvarDespesa,
  useConverterSolicitacaoEmDespesa,
  buscarNumeroDespesa,
  useDespesa,
  useEmpresasGrupo,
  useContratosAtivos,
  uploadAnexoMalote,
  registrarEventoDespesa,
  gerarParcelas,
  RateioLinha,
  OrigemDespesa,
  TipoSolicitacao,
  STATUS_LABEL,
} from "@/hooks/useMaloteDespesa";
import { RateioGrid, DimensoesRateio } from "./RateioGrid";
import { AnexosField } from "./AnexosField";
import { getStatusVigencia } from "./orcamentoUtils";

const DIAS_MES = Array.from({ length: 28 }, (_, i) => i + 1);
const QUANTIDADE_PARCELAS = Array.from({ length: 24 }, (_, i) => i + 2);

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

/** O que outra tela pode mandar pronto para a despesa do Malote. */
export interface PrefillDespesa {
  rubrica?: string; nome?: string; valor?: string; dataPagamento?: string;
  competencia?: string; formaPagamento?: string; informacoesPagamento?: string;
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

function Campo({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{valor || "—"}</p>
    </div>
  );
}

function PainelHeader({ icon, titulo, subtitulo, ativo }: { icon: React.ReactNode; titulo: string; subtitulo: string; ativo: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-2">
        {icon}
        <div>
          <h3 className="text-sm font-semibold">{titulo}</h3>
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
      </div>
      {!ativo && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 whitespace-nowrap">
          <Lock className="h-3 w-3" /> Selecione uma classificação acima
        </span>
      )}
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
      });
      if (arquivos.length > 0) {
        const paths = await Promise.all(arquivos.map((f) => uploadAnexoMalote(f, despesaId)));
        await salvar.mutateAsync({ id: despesaId, empresa_id: empresaFinal, classificacao_id: classificacaoId, origem: "solicitacao", status, nome: nome.trim(), valor_total: Number(valorEstimado), arquivos: paths });
      }
      toast.success(status === "rascunho" ? "Rascunho salvo." : "Solicitação enviada para aprovação inicial.");
      setNome(""); setMotivo(""); setDescricao(""); setValorEstimado(""); setValorSugerido(false); setLinks(""); setArquivos([]);
      setEmpresaContratoId(""); setContratoId("");
      chaveAutoPreenchidaRef.current = null;
      if (!tipoTravado) setTipo("");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar solicitação.");
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

// ============================================================================
// Painel: Criar Despesa Malote (lançamento direto, sem solicitação)
// ============================================================================
// `origem_obrigacao` na URL = a despesa veio de uma conta do Patrimônio
// ("Pagar" lá manda para cá). Gravar o vínculo é o que tira aquela conta de
// "Pendente" e depois deixa ela saber que foi paga — ver
// src/pages/juridico/patrimonio/vinculoMalote.ts.
function PainelDespesaMalote({
  classificacaoId,
  classificacaoTipo,
  empresaId,
  ativo,
  despesaIdExistente,
  origem = "despesa_unica",
  nomeInicial,
  valorInicial,
  inicial,
  onConvertida,
}: {
  classificacaoId: string;
  classificacaoTipo?: TipoClassificacaoOrcamento | null;
  empresaId: string | null;
  ativo: boolean;
  despesaIdExistente?: string;
  origem?: OrigemDespesa;
  nomeInicial?: string;
  valorInicial?: number;
  inicial?: PrefillDespesa;
  onConvertida?: () => void;
}) {
  const [paramsUrl] = useSearchParams();
  const obrigacaoPatrimonio = paramsUrl.get(PARAM_ORIGEM);
  // Confirmação no centro da tela quando a despesa vai para aprovação. O
  // toast de canto some antes de a pessoa registrar, e aqui dar certo importa:
  // a despesa saiu da mão dela e entrou na fila de outra pessoa.
  const [confirmacao, setConfirmacao] = useState<{ titulo: string; subtitulo: string; numero?: string | null } | null>(null);
  const salvar = useSalvarDespesa();
  const converter = useConverterSolicitacaoEmDespesa();
  const [nome, setNome] = useState(nomeInicial ?? inicial?.nome ?? "");
  const [totalMes, setTotalMes] = useState(valorInicial != null ? String(valorInicial) : (inicial?.valor ?? ""));
  const [dataPagamento, setDataPagamento] = useState(inicial?.dataPagamento ?? "");
  const [competencia, setCompetencia] = useState(inicial?.competencia ?? "");
  const [formaPagamento, setFormaPagamento] = useState(inicial?.formaPagamento ?? "");
  const [informacoesPagamento, setInformacoesPagamento] = useState(inicial?.informacoesPagamento ?? "");
  const [dimensoes, setDimensoes] = useState<DimensoesRateio>({ empresa: false, contrato: false, fornecedor: false, integrante: false });
  const [ratearPor, setRatearPor] = useState<"percentual" | "valor">("percentual");
  const [linhasRateio, setLinhasRateio] = useState<RateioLinha[]>([]);
  const [parcelado, setParcelado] = useState<"nao" | "sim">("nao");
  const [diaDesconto, setDiaDesconto] = useState("");
  const [quantidadeParcelas, setQuantidadeParcelas] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState<"rascunho" | "enviar" | null>(null);

  const totalRateado = useMemo(() => linhasRateio.reduce((s, l) => s + (Number(l.valor) || 0), 0), [linhasRateio]);
  const restante = Math.max(0, (Number(totalMes) || 0) - totalRateado);

  function validar(paraEnviar: boolean): string | null {
    if (!nome.trim()) return "Informe o nome da despesa.";
    if (!totalMes || Number(totalMes) <= 0) return "Informe o total do mês.";
    if (!dataPagamento) return "Informe a data de pagamento.";
    if (!competencia) return "Informe a competência.";
    if (!formaPagamento) return "Selecione a forma de pagamento.";
    if (!informacoesPagamento.trim()) return "Informe os dados de pagamento.";
    if (paraEnviar) {
      if (linhasRateio.length === 0) return "Adicione ao menos uma linha de rateio.";
      if (Math.abs(totalRateado - Number(totalMes)) > 0.01) return "O total do rateio deve ser igual ao Total do mês.";
      if (parcelado === "sim" && (!diaDesconto || !quantidadeParcelas)) return "Informe o dia do desconto e a quantidade de parcelas.";
      if (arquivos.length === 0) return "Anexe ao menos um arquivo.";
    }
    return null;
  }

  // Convertendo uma solicitação já aprovada (despesaIdExistente): "rascunho"
  // aqui só atualiza os campos e mantém status='cotacao_aprovada' (a linha
  // já existe, origem continua 'solicitacao'); "enviar" chama o conversor
  // dedicado, que muda o status pra pendente_aprovacao N1 e registra o
  // evento "despesa_criada" — SIS-2026-0104.
  async function handleSalvar(acao: "rascunho" | "enviar") {
    const paraEnviar = acao === "enviar";
    const erro = validar(paraEnviar);
    if (erro) {
      toast.error(erro);
      return;
    }
    if (!empresaId) {
      toast.error("Empresa não identificada.");
      return;
    }
    setSalvando(acao);
    try {
      const parcelas =
        parcelado === "sim" && diaDesconto && quantidadeParcelas
          ? gerarParcelas(Number(totalMes), Number(quantidadeParcelas), dataPagamento, Number(diaDesconto))
          : [];

      const payloadBase = {
        id: despesaIdExistente,
        empresa_id: empresaId,
        classificacao_id: classificacaoId,
        origem,
        nome: nome.trim(),
        valor_total: Number(totalMes),
        data_pagamento: dataPagamento,
        competencia: competencia + "-01",
        forma_pagamento: formaPagamento,
        informacoes_pagamento: informacoesPagamento.trim(),
        parcelado: parcelado === "sim",
        numero_parcelas: parcelado === "sim" ? Number(quantidadeParcelas) : null,
        dia_desconto: parcelado === "sim" ? Number(diaDesconto) : null,
        rateio: linhasRateio,
        parcelas,
      };

      let despesaId: string;
      if (paraEnviar && despesaIdExistente) {
        despesaId = await converter.mutateAsync({ ...payloadBase, status: "pendente_aprovacao" });
      } else if (paraEnviar) {
        // Despesa nova indo direto pra pendente_aprovacao (sem passar pela
        // conversão de solicitação, que já seta nivel_aprovacao_atual=1
        // sozinha) — sem isso, nenhum aprovador configurado via
        // Classificação era reconhecido como "aprovador do nível atual" e
        // só o botão Reprovar aparecia.
        despesaId = await salvar.mutateAsync({ ...payloadBase, status: "pendente_aprovacao", nivel_aprovacao_atual: 1 });
      } else {
        despesaId = await salvar.mutateAsync({ ...payloadBase, status: despesaIdExistente ? "cotacao_aprovada" : "rascunho" });
      }

      if (arquivos.length > 0) {
        const paths = await Promise.all(arquivos.map((f) => uploadAnexoMalote(f, despesaId)));
        await salvar.mutateAsync({
          id: despesaId,
          empresa_id: empresaId,
          classificacao_id: classificacaoId,
          origem,
          status: paraEnviar ? "pendente_aprovacao" : despesaIdExistente ? "cotacao_aprovada" : "rascunho",
          nome: nome.trim(),
          valor_total: Number(totalMes),
          arquivos: paths,
        });
      }

      if (obrigacaoPatrimonio) {
        const vinculo = await vincularContaAoMalote(obrigacaoPatrimonio, despesaId);
        // Falhar aqui não desfaz a despesa, que já existe e é o que importa:
        // avisa para alguém religar o vínculo, em vez de engolir o erro.
        if (!vinculo.ok && vinculo.erro) {
          toast.warning("Despesa criada, mas a conta do Patrimônio não foi marcada como enviada: " + vinculo.erro);
        }
      }

      if (paraEnviar && despesaIdExistente) {
        setConfirmacao({
          titulo: "Despesa enviada ao Malote",
          subtitulo: "Criada a partir da solicitação e já na fila de aprovação.",
          numero: await buscarNumeroDespesa(despesaId),
        });
        onConvertida?.();
        return;
      }

      if (!paraEnviar && despesaIdExistente) {
        await registrarEventoDespesa(despesaId, "edicao", "Dados da despesa atualizados antes do envio para aprovação.");
      }

      // Rascunho não é conquista: continua no toast discreto. O que ganha a
      // tela é o envio para aprovação.
      if (acao === "rascunho") {
        toast.success("Rascunho salvo.");
      } else {
        setConfirmacao({
          titulo: "Despesa enviada ao Malote",
          subtitulo: obrigacaoPatrimonio
            ? "A conta do Patrimônio já aparece como enviada, e a despesa entrou na fila de aprovação."
            : "Ela entrou na fila de aprovação. Você acompanha o andamento em Meus Itens.",
          numero: await buscarNumeroDespesa(despesaId),
        });
      }
      if (!despesaIdExistente) {
        setNome(""); setTotalMes(""); setDataPagamento(""); setCompetencia(""); setFormaPagamento("");
        setInformacoesPagamento(""); setLinhasRateio([]); setParcelado("nao"); setDiaDesconto("");
        setQuantidadeParcelas(""); setArquivos([]);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar despesa.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Card>
      <ConfirmacaoMalote
        aberto={!!confirmacao}
        titulo={confirmacao?.titulo}
        subtitulo={confirmacao?.subtitulo}
        numero={confirmacao?.numero}
        onFechar={() => setConfirmacao(null)}
      />
      <CardContent className="p-6 space-y-4">
        <PainelHeader icon={<FileEdit className="h-4 w-4 mt-0.5 text-muted-foreground" />} titulo="Criar Despesa Malote" subtitulo="Preencha os dados para incluir a despesa diretamente no malote." ativo={ativo} />

        <div className={cn("space-y-4", !ativo && "opacity-40 pointer-events-none select-none")}>
          <div>
            <Label>Nome da Despesa *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Compra de materiais de escritório" disabled={!ativo} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Total do mês *</Label>
              <Input type="number" step="0.01" value={totalMes} onChange={(e) => setTotalMes(e.target.value)} placeholder="Ex: R$ 5.000,00" disabled={!ativo} />
            </div>
            <div>
              <Label>Data de pagamento *</Label>
              <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} disabled={!ativo} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Competência *</Label>
              <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={!ativo} />
            </div>
            <div>
              <Label>Forma de pagamento *</Label>
              <Select value={formaPagamento} onValueChange={setFormaPagamento} disabled={!ativo}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a forma" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="ted">TED</SelectItem>
                  <SelectItem value="boleto">Boleto</SelectItem>
                  <SelectItem value="cartao">Cartão</SelectItem>
                  <SelectItem value="dinheiro">Dinheiro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Informações de pagamento *</Label>
              <Input
                value={informacoesPagamento}
                onChange={(e) => setInformacoesPagamento(e.target.value)}
                placeholder="Ex: Pix, copia e cola, dados bancários, etc."
                disabled={!ativo}
              />
            </div>
          </div>

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium mb-2">Rateio</p>
            <RateioGrid
              linhas={linhasRateio}
              onChange={setLinhasRateio}
              dimensoes={dimensoes}
              onDimensoesChange={setDimensoes}
              ratearPor={ratearPor}
              onRatearPorChange={setRatearPor}
              valorTotal={Number(totalMes) || 0}
              disabled={!ativo}
              contratoPorClassificacao
              classificacaoTipoUnica={classificacaoTipo ?? null}
              mostrarResumoValorTotal
            />
          </div>

          <div className="border-t border-border pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Opções de parcelamento (opcional)</Label>
              <p className="text-xs text-muted-foreground mb-1">Deseja parcelar esta despesa?</p>
              <RadioGroup value={parcelado} onValueChange={(v) => setParcelado(v as "nao" | "sim")} className="flex gap-4">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <RadioGroupItem value="nao" disabled={!ativo} /> Não
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <RadioGroupItem value="sim" disabled={!ativo} /> Sim, parcelar
                </label>
              </RadioGroup>
            </div>
            {parcelado === "sim" && (
              <>
                <div>
                  <Label>Dia do desconto *</Label>
                  <Select value={diaDesconto} onValueChange={setDiaDesconto} disabled={!ativo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o dia" />
                    </SelectTrigger>
                    <SelectContent>
                      {DIAS_MES.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantidade de parcelas *</Label>
                  <Select value={quantidadeParcelas} onValueChange={setQuantidadeParcelas} disabled={!ativo}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a quantidade" />
                    </SelectTrigger>
                    <SelectContent>
                      {QUANTIDADE_PARCELAS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}x
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          <div>
            <Label>Arquivos anexados *</Label>
            <AnexosField arquivos={arquivos} onChange={setArquivos} disabled={!ativo} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleSalvar("rascunho")} disabled={!ativo || salvando !== null}>
              {salvando === "rascunho" ? "Salvando..." : "Salvar rascunho"}
            </Button>
            <Button onClick={() => handleSalvar("enviar")} disabled={!ativo || salvando !== null}>
              {salvando === "enviar" ? "Enviando..." : "Enviar para aprovação"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
