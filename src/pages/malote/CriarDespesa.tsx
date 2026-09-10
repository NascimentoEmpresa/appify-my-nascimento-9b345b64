import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { LayoutGrid, Package, Lock, ShoppingCart, ArrowLeft, Paperclip, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useClassificacoesOrcamento, TipoClassificacaoOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useOrcadoClassificacao } from "@/hooks/useOrcadoClassificacao";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import {
  useSalvarDespesa,
  useDespesa,
  useEmpresasGrupo,
  useContratosAtivos,
  uploadAnexosMalote,
  buscarNumeroDespesa,
  TipoSolicitacao,
  STATUS_LABEL,
  ItemSolicitacao,
} from "@/hooks/useMaloteDespesa";
import { abrirAnexoMalote } from "@/hooks/useMaloteCotacao";
import { ItensSolicitacao } from "@/components/malote/ItensSolicitacao";
import { AnexosField } from "./AnexosField";
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

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ============================================================================
// Fluxo normal: escolher classificação e preencher Solicitação OU Despesa
// ============================================================================
function CriarDespesaNova({ inicial }: { inicial?: PrefillDespesa }) {
  const navigate = useNavigate();
  const { data: empresaId } = useEmpresaId();
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const [classificacaoId, setClassificacaoId] = useState("");

  // DM-2026-0354/SIS-2026-0354 (Iury): antes o campo aqui era "Rubrica" (um
  // item granular da Planilha de Custo ou do Orçamento Administrativo, que
  // resolvia a Classificação Malote por trás — ver useRubricasMalote.ts,
  // decisão original do SIS-2026-0132). Trocado pra escolher a Classificação
  // Malote direto: o Orçado/Utilizado já é calculado agregado por
  // Classificação (useOrcadoClassificacao/v_malote_utilizado_orcamento), não
  // por rubrica — então nada se perde no consumo do orçamento ao pular esse
  // passo intermediário. Casa o nome pedido (?rubrica=, mantido por
  // compatibilidade com os chamadores — Patrimonios.tsx/vinculoMalote.ts, que
  // já documentavam a intenção de comparar contra NOME DE CLASSIFICAÇÃO, não
  // de rubrica) com a lista assim que ela carrega. Se não bater com nenhuma,
  // o campo fica vazio de propósito: escolher a errada é pior que pedir para
  // a pessoa escolher.
  const classificacaoPedida = inicial?.rubrica ?? "";
  useEffect(() => {
    if (!classificacaoPedida || classificacaoId || classificacoes.length === 0) return;
    const alvo = semAcento(classificacaoPedida);
    const achou = classificacoes.find((c) => semAcento(c.nome) === alvo)
      ?? classificacoes.find((c) => semAcento(c.nome).includes(alvo));
    if (achou) setClassificacaoId(achou.id);
  }, [classificacaoPedida, classificacoes, classificacaoId]);

  const classificacao = classificacoes.find((c) => c.id === classificacaoId) ?? null;

  // SIS-2026-0334 (Iury): "Criar um check que se marcado ele deixa a
  // classificação sem necessidade de solicitação, pulando direto para a
  // criação de despesa" — bypass só desta despesa, a Classificação
  // continua exigindo solicitação por padrão pra todo mundo. Reseta ao
  // trocar de classificação, senão o check de uma vaza pra próxima
  // selecionada.
  const [pularSolicitacao, setPularSolicitacao] = useState(false);
  useEffect(() => setPularSolicitacao(false), [classificacaoId]);

  const classificacaoExigeSolicitacao = !!classificacao?.requer_solicitacao;
  const modo: "solicitacao" | "despesa" | null = !classificacao
    ? null
    : classificacaoExigeSolicitacao && !pularSolicitacao
      ? "solicitacao"
      : "despesa";

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
                Classificação Malote <span className="text-destructive">*</span>
              </Label>
              <SearchableSelect
                value={classificacaoId}
                onChange={setClassificacaoId}
                options={classificacoes.map((c) => ({ value: c.id, label: c.nome }))}
                placeholder="Selecione a Classificação Malote"
                searchPlaceholder="Buscar Classificação..."
              />
            </div>
            <div className="shrink-0">
              <Label className="invisible hidden sm:block">Ação</Label>
              <Button variant="outline" onClick={() => navigate("/app/malote/ratear-classificacao")} className="gap-2 w-full sm:w-auto">
                <LayoutGrid className="h-4 w-4" /> Ratear classificação
              </Button>
            </div>
          </div>
          {classificacaoExigeSolicitacao && (
            <div className="flex items-center gap-2 pt-1">
              <Checkbox id="pular-solicitacao" checked={pularSolicitacao} onCheckedChange={(v) => setPularSolicitacao(!!v)} />
              <Label htmlFor="pular-solicitacao" className="text-sm font-normal cursor-pointer">
                Não necessita solicitação (Compras)
              </Label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            A Classificação Malote escolhida define os aprovadores e as regras de orçamento da despesa. Configure
            aprovadores em{" "}
            <Link to="/app/malote/classificacoes-malote" className="underline">
              Classificações do Malote
            </Link>
            .
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PainelSolicitacao
          classificacaoId={classificacao?.id ?? ""}
          classificacaoTipo={classificacao?.tipo ?? null}
          empresaId={empresaId ?? null}
          ativo={modo === "solicitacao"}
        />
        <PainelDespesaMalote
          classificacaoId={classificacao?.id ?? ""}
          classificacaoTipo={classificacao?.tipo ?? null}
          empresaId={empresaId ?? null}
          ativo={modo === "despesa"}
          inicial={inicial}
          solicitacaoDispensadaManualmente={modo === "despesa" && classificacaoExigeSolicitacao}
        />
      </div>

      {!modo && (
        <p className="text-xs text-muted-foreground text-center">
          Selecione uma Classificação Malote para habilitar os tipos de despesa e preencher os formulários acima.
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
                <div>
                  <p className="text-xs text-muted-foreground">Link(s)</p>
                  {solicitacao.links ? (
                    <div className="space-y-0.5">
                      {solicitacao.links.split(/[\s,;]+/).filter(Boolean).map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-start gap-1 text-xs text-primary hover:underline break-all"
                        >
                          <ExternalLink className="h-3 w-3 shrink-0 mt-0.5" />
                          <span className="break-all">{url}</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p>—</p>
                  )}
                </div>
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
                  <div className="space-y-0.5">
                    {solicitacao.arquivos.map((path) => (
                      <button
                        key={path}
                        type="button"
                        onClick={() => abrirAnexoMalote(path)}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[280px]">{path.split("/").pop()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Cotação do Suprimentos: link + anexo de cada cotação recebida
                  (pedido da galera — antes o criador não conseguia abrir). */}
              {([1, 2, 3] as const)
                .map((n) => ({
                  n,
                  fornecedor: solicitacao[`cot${n}_fornecedor`],
                  link: solicitacao[`cot${n}_link`],
                  anexoPath: solicitacao[`cot${n}_anexo_path`],
                  anexoNome: solicitacao[`cot${n}_anexo_nome`],
                }))
                .filter((c) => c.fornecedor && (c.link || c.anexoPath)).length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Cotações (Suprimentos)</p>
                  <div className="space-y-1">
                    {([1, 2, 3] as const)
                      .map((n) => ({
                        n,
                        fornecedor: solicitacao[`cot${n}_fornecedor`],
                        link: solicitacao[`cot${n}_link`],
                        anexoPath: solicitacao[`cot${n}_anexo_path`],
                        anexoNome: solicitacao[`cot${n}_anexo_nome`],
                      }))
                      .filter((c) => c.fornecedor && (c.link || c.anexoPath))
                      .map((c) => (
                        <div key={c.n} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                          <span className={cn("font-medium", solicitacao.cotacao_vencedor_num === c.n && "text-emerald-600 dark:text-emerald-400")}>
                            {c.fornecedor}
                          </span>
                          {c.link && (
                            <a href={c.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                              <ExternalLink className="h-3 w-3" /> Ver link
                            </a>
                          )}
                          {c.anexoPath && (
                            <button type="button" onClick={() => abrirAnexoMalote(c.anexoPath!)} className="inline-flex items-center gap-1 text-primary hover:underline">
                              <Paperclip className="h-3 w-3" /> {c.anexoNome || "Abrir anexo"}
                            </button>
                          )}
                        </div>
                      ))}
                  </div>
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
  classificacaoId,
  classificacaoTipo,
  empresaId,
  ativo,
}: {
  classificacaoId: string;
  classificacaoTipo: TipoClassificacaoOrcamento | null;
  empresaId: string | null;
  ativo: boolean;
}) {
  const salvar = useSalvarDespesa();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valorEstimado, setValorEstimado] = useState("");
  const [links, setLinks] = useState("");
  // Itens do que está sendo pedido (SIS-2026-0207). Opcional: solicitação de
  // serviço ou despesa avulsa continua valendo só com a descrição.
  const [itens, setItens] = useState<ItemSolicitacao[]>([]);
  const [tipo, setTipo] = useState<TipoSolicitacao | "">("");
  const [empresaContratoId, setEmpresaContratoId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState<"rascunho" | "enviar" | null>(null);

  // A Classificação Malote já define se a despesa é de Contrato ou
  // Administrativo — o Tipo aqui só reflete isso e trava, evitando pedir a
  // mesma informação duas vezes. "Dispensa de cotação" só fica selecionável
  // quando a classificação não tem tipo definido (legado).
  const tipoTravado: TipoSolicitacao | null = classificacaoTipo;

  // SIS-2026-0354 (Iury): antes o Valor estimado vinha AUTO-preenchido a
  // partir da rubrica granular escolhida (uma linha específica da Planilha
  // de Custo ou do Orçamento Administrativo). Com a Classificação Malote
  // escolhida direto, isso ficaria ambíguo — pode haver vários itens
  // somados na mesma Classificação (ex.: R$7.000,00 de "DESPESA TREINAMENTO"
  // é a soma de vários itens administrativos). Decisão confirmada com o
  // usuário: não preencher nada automaticamente — só mostrar o Orçado/
  // Restante da Classificação no mês atual como dica, ao lado do campo, pra
  // conferir antes de digitar o valor (mesmo mecanismo de
  // useOrcadoClassificacao/useUtilizadoOrcamento já usados em
  // DespesaVisualizar.tsx/RateioGrid.tsx — Orçado/Utilizado já são
  // agregados por Classificação, nunca por rubrica).
  const anoMesAtual = useMemo(() => new Date().toISOString().slice(0, 7), []);
  const { resolver: resolverOrcado } = useOrcadoClassificacao(empresaId, anoMesAtual);
  const { data: utilizadoLinhas = [] } = useUtilizadoOrcamento();
  const orcadoDoMes = classificacaoId ? resolverOrcado(classificacaoId, tipo === "contrato" ? contratoId || null : null) : null;
  const utilizadoDoMes = useMemo(() => {
    if (!classificacaoId) return 0;
    return utilizadoLinhas.reduce((soma, u) => {
      if (u.classificacao_id !== classificacaoId) return soma;
      if (!u.competencia || u.competencia.slice(0, 7) !== anoMesAtual) return soma;
      if (tipo === "contrato" && (u.contrato_id ?? null) !== (contratoId || null)) return soma;
      return soma + (Number(u.valor) || 0);
    }, 0);
  }, [utilizadoLinhas, classificacaoId, anoMesAtual, tipo, contratoId]);
  const restanteDoMes = orcadoDoMes != null ? orcadoDoMes - utilizadoDoMes : null;

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
        try {
          const paths = await uploadAnexosMalote(arquivos, despesaId, nome.trim());
          await salvar.mutateAsync({ id: despesaId, empresa_id: empresaFinal, classificacao_id: classificacaoId, origem: "solicitacao", status, nome: nome.trim(), valor_total: Number(valorEstimado), arquivos: paths });
        } catch (erroUpload) {
          // DM-2026-0446: solicitação JÁ criada — não desfaz. O anexo pode
          // ser reenviado pela tela da despesa depois (SIS-2026-0339), sem
          // recriar. Aviso claro em vez do "Failed to fetch" cru.
          const num = await buscarNumeroDespesa(despesaId).catch(() => null);
          toast.warning(
            `Solicitação ${num ?? ""} criada, mas o anexo não subiu (provável falha de rede). ` +
              `Abra a solicitação em Meus Itens e reenvie o anexo — não crie de novo.`,
          );
        }
      }
      toast.success(status === "rascunho" ? "Rascunho salvo." : "Solicitação enviada para aprovação inicial.");
      setNome(""); setMotivo(""); setDescricao(""); setValorEstimado(""); setLinks(""); setArquivos([]); setItens([]);
      setEmpresaContratoId(""); setContratoId("");
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
              <p className="text-xs text-muted-foreground mt-1">Definido pela Classificação Malote selecionada.</p>
            )}
          </div>

          {tipo === "contrato" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Contrato *</Label>
                <SearchableSelect
                  value={contratoId}
                  onChange={handleContratoChange}
                  options={contratos.map((c) => ({ value: c.id, label: c.nome, muted: c.status === "encerrado" }))}
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
                onChange={(e) => setValorEstimado(e.target.value)}
                placeholder="Ex: R$ 1.500,00"
                disabled={!ativo}
              />
              {classificacaoId && orcadoDoMes != null && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Orçado do mês: {fmtMoney(orcadoDoMes)} · Restante: {fmtMoney(restanteDoMes)}
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
