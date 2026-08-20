import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ArrowLeft, ShoppingCart, Paperclip, X, Trash2, Check, ClipboardList, ExternalLink, Building2, Trophy, CalendarClock, Info, Wallet, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  useDespesa,
  useSalvarDespesa,
  useCancelarDespesa,
  useEmpresasGrupo,
  useContratosAtivos,
  useAprovarSolicitacaoInicial,
  useReprovarSolicitacaoInicial,
  useAprovarCotacao,
  useReprovarCotacao,
  souAprovadorSolicitacao,
  uploadAnexoMalote,
  registrarEventoDespesa,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  STATUS_FASE_SOLICITACAO,
  TipoSolicitacao,
} from "@/hooks/useMaloteDespesa";
import { useOrcadoClassificacao } from "@/hooks/useOrcadoClassificacao";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { anoMesAtual } from "@/hooks/usePlanilhaCusto";
import { AnexosField } from "./AnexosField";
import { ComprasPassadas } from "@/components/malote/ComprasPassadas";

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const TIPO_LABEL: Record<TipoSolicitacao, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

async function abrirAnexo(path: string) {
  const { data, error } = await supabase.storage.from("malote-anexos").createSignedUrl(path, 60);
  if (error || !data) {
    toast.error("Não foi possível abrir o anexo.");
    return;
  }
  window.open(data.signedUrl, "_blank");
}

// SIS-2026-0132 Fase 2: tela cheia (era modal) — o mockup do chamado mostra
// a Solicitação como página inteira igual à Despesa, não um dialog.
export default function SolicitacaoVisualizar() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading } = useDespesa(id);
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const salvar = useSalvarDespesa();
  const cancelar = useCancelarDespesa();
  const aprovarInicial = useAprovarSolicitacaoInicial();
  const reprovarInicial = useReprovarSolicitacaoInicial();
  const aprovarCotacaoMut = useAprovarCotacao();
  const reprovarCotacaoMut = useReprovarCotacao();
  const [comentarioAprovacao, setComentarioAprovacao] = useState("");
  const [acaoAprovacao, setAcaoAprovacao] = useState<"aprovar" | "reprovar" | null>(null);
  const [numeroSelecionado, setNumeroSelecionado] = useState<1 | 2 | 3 | null>(null);
  const [comentarioCotacao, setComentarioCotacao] = useState("");
  const [acaoCotacao, setAcaoCotacao] = useState<"aprovar" | "reprovar" | null>(null);

  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valorEstimado, setValorEstimado] = useState("");
  const [links, setLinks] = useState("");
  const [tipo, setTipo] = useState<TipoSolicitacao | "">("");
  const [empresaContratoId, setEmpresaContratoId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [arquivosExistentes, setArquivosExistentes] = useState<string[]>([]);
  const [arquivosNovos, setArquivosNovos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  const contratosDaEmpresa = contratos.filter((c) => !empresaContratoId || c.empresa_id === empresaContratoId);

  useEffect(() => {
    if (!data?.despesa) return;
    const d = data.despesa;
    setNome(d.nome);
    setMotivo(d.motivo ?? "");
    setDescricao(d.descricao ?? "");
    setValorEstimado(String(d.valor_total ?? ""));
    setLinks(d.links ?? "");
    setTipo(d.tipo ?? "");
    if (d.tipo === "contrato") {
      setEmpresaContratoId(d.empresa_id);
      setContratoId(d.contrato_id ?? "");
    }
    setArquivosExistentes(d.arquivos ?? []);
  }, [data?.despesa]);

  const despesa = data?.despesa;

  // Impacto no orçamento (SIS-2026-0192, confirmado com o Iury): solicitação
  // ainda não tem competência definida (só a despesa final tem), então usa
  // o mês atual como referência — o aprovador vê aqui a soma do que já está
  // em Aguardando Pagamento/Despesa Paga + o valor desta solicitação, antes
  // dela virar despesa de verdade.
  const anoMesRef = anoMesAtual();
  const { resolver: resolverOrcado } = useOrcadoClassificacao(despesa?.empresa_id, anoMesRef);
  const { data: utilizadoLinhas = [] } = useUtilizadoOrcamento();

  if (isLoading || !despesa) {
    return <div className="p-6 text-muted-foreground">Carregando...</div>;
  }

  const editavel = STATUS_FASE_SOLICITACAO.includes(despesa.status) && despesa.status !== "solicitacao_reprovada";
  const podeCancelar = editavel;

  // Aprovação Inicial — SIS-2026-0132 Fase 2. Gate é o Aprovador da
  // Solicitação (aprovador_solicitacao_user_id), diferente do
  // aprovador1/2/3 da Despesa — SIS-2026-0189 corrigiu isso, antes
  // checava souAprovadorConfigurado (despesa) por engano.
  const souAprovadorDaClassificacao = souAprovadorSolicitacao(despesa, user?.id);
  const aguardandoMinhaAprovacaoInicial = despesa.status === "aguardando_aprovacao_inicial" && souAprovadorDaClassificacao;
  const aguardandoCotacaoComoAprovador = despesa.status === "aguardando_cotacao" && souAprovadorDaClassificacao;
  const emAprovacaoInicial = aguardandoMinhaAprovacaoInicial || aguardandoCotacaoComoAprovador;

  // Enviar/digitar cotações é telas do Suprimentos (SIS-2026-0112,
  // /app/suprimentos/cotacoes-malote) — aqui só mostramos o resultado.
  const podeEscolherCotacao = despesa.status === "cotacao_realizada" && souAprovadorDaClassificacao;

  // Status em que o aprovador configurado veria os painéis de Resumo/
  // Orçamento/Impacto — usado só pra explicar pra quem não é esse aprovador
  // (solicitante, supervisor por cargo etc.) por que eles não aparecem aqui.
  const statusComPainelDeAprovador = ["aguardando_aprovacao_inicial", "aguardando_cotacao", "cotacao_realizada"].includes(despesa.status);
  const painelOcultoPorNaoSerAprovador = statusComPainelDeAprovador && !souAprovadorDaClassificacao;

  const cotacoes: { n: 1 | 2 | 3; fornecedor: string | null; valor: number | null; prazo: string | null; link: string | null }[] = (
    [1, 2, 3] as const
  )
    .map((n) => ({
      n,
      fornecedor: despesa[`cot${n}_fornecedor`],
      valor: despesa[`cot${n}_valor`],
      prazo: despesa[`cot${n}_prazo`],
      link: despesa[`cot${n}_link`],
    }))
    .filter((c) => c.fornecedor);

  // Orçamento da classificação + Impacto desta compra (SIS-2026-0192,
  // confirmado com o Iury): soma do que já está em Aguardando Pagamento/
  // Despesa Paga naquele mês + o valor que o aprovador está avaliando
  // agora — dá visibilidade do impacto ANTES da solicitação virar despesa.
  const orcadoClassificacao = resolverOrcado(despesa.classificacao_id, despesa.contrato_id);
  const utilizadoAtual = utilizadoLinhas
    .filter(
      (u) =>
        u.classificacao_id === despesa.classificacao_id &&
        (u.contrato_id ?? null) === (despesa.contrato_id ?? null) &&
        !!u.competencia &&
        u.competencia.slice(0, 7) === anoMesRef
    )
    .reduce((s, u) => s + (Number(u.valor) || 0), 0);
  const cotacaoSelecionada = cotacoes.find((c) => c.n === (numeroSelecionado ?? despesa.cotacao_vencedor_num));
  const valorImpacto = cotacaoSelecionada?.valor ?? despesa.valor_total;
  const utilizadoAposCompra = utilizadoAtual + (Number(valorImpacto) || 0);
  const saldoDisponivel = orcadoClassificacao != null ? orcadoClassificacao - utilizadoAtual : null;
  const saldoAposCompra = orcadoClassificacao != null ? orcadoClassificacao - utilizadoAposCompra : null;
  const pctAtual = orcadoClassificacao ? (utilizadoAtual / orcadoClassificacao) * 100 : null;
  const pctAposCompra = orcadoClassificacao ? (utilizadoAposCompra / orcadoClassificacao) * 100 : null;
  const corPct = (pct: number | null) => (pct == null ? "hsl(var(--muted-foreground)/0.25)" : pct > 100 ? "#ef4444" : pct >= 80 ? "#f59e0b" : "#10b981");

  async function handleAprovarInicial() {
    setAcaoAprovacao("aprovar");
    try {
      await aprovarInicial.mutateAsync(despesa!.id);
      toast.success("Solicitação aprovada — enviada pro Suprimentos cotar.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao aprovar solicitação.");
    } finally {
      setAcaoAprovacao(null);
    }
  }

  async function handleReprovarInicial() {
    if (!comentarioAprovacao.trim()) {
      toast.error("Descreva o motivo da reprovação no campo Comentário.");
      return;
    }
    setAcaoAprovacao("reprovar");
    try {
      await reprovarInicial.mutateAsync({ id: despesa!.id, motivo: comentarioAprovacao.trim() });
      toast.success("Solicitação reprovada.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao reprovar solicitação.");
    } finally {
      setAcaoAprovacao(null);
    }
  }

  async function handleAprovarCotacaoEscolhida() {
    if (!numeroSelecionado) {
      toast.error("Selecione uma cotação.");
      return;
    }
    const c = cotacoes.find((x) => x.n === numeroSelecionado);
    if (!c || c.valor == null) {
      toast.error("Cotação selecionada inválida.");
      return;
    }
    setAcaoCotacao("aprovar");
    try {
      await aprovarCotacaoMut.mutateAsync({ id: despesa!.id, numero: numeroSelecionado, valor: c.valor });
      toast.success("Cotação aprovada.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao aprovar cotação.");
    } finally {
      setAcaoCotacao(null);
    }
  }

  async function handleReprovarCotacao() {
    if (!comentarioCotacao.trim()) {
      toast.error("Descreva o motivo da reprovação no campo Comentário.");
      return;
    }
    setAcaoCotacao("reprovar");
    try {
      await reprovarCotacaoMut.mutateAsync({ id: despesa!.id, motivo: comentarioCotacao.trim() });
      toast.success("Solicitação reprovada.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao reprovar solicitação.");
    } finally {
      setAcaoCotacao(null);
    }
  }

  async function handleSalvar() {
    if (!nome.trim()) return toast.error("Informe o nome da solicitação.");
    if (!motivo.trim()) return toast.error("Informe o motivo.");
    if (!descricao.trim()) return toast.error("Informe a descrição.");
    if (!valorEstimado || Number(valorEstimado) <= 0) return toast.error("Informe o valor estimado.");
    if (!tipo) return toast.error("Selecione o tipo.");
    if (tipo === "contrato" && !empresaContratoId) return toast.error("Selecione a empresa do contrato.");
    if (tipo === "contrato" && !contratoId) return toast.error("Selecione o contrato.");

    setSalvando(true);
    try {
      const novosPaths = arquivosNovos.length > 0 ? await Promise.all(arquivosNovos.map((f) => uploadAnexoMalote(f, despesa!.id))) : [];
      await salvar.mutateAsync({
        id: despesa!.id,
        empresa_id: tipo === "contrato" ? empresaContratoId : despesa!.empresa_id,
        classificacao_id: despesa!.classificacao_id,
        origem: "solicitacao",
        status: despesa!.status,
        nome: nome.trim(),
        valor_total: Number(valorEstimado),
        motivo: motivo.trim(),
        descricao: descricao.trim(),
        links: links.trim() || null,
        tipo: tipo || null,
        contrato_id: tipo === "contrato" ? contratoId : null,
        arquivos: [...arquivosExistentes, ...novosPaths],
      });
      await registrarEventoDespesa(despesa!.id, "edicao", "Solicitação editada e salva.");
      toast.success("Solicitação salva.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar solicitação.");
    } finally {
      setSalvando(false);
    }
  }

  async function handleCancelar() {
    setCancelando(true);
    try {
      await cancelar.mutateAsync({ id: despesa!.id });
      toast.success("Solicitação cancelada.");
      navigate(-1);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao cancelar solicitação.");
    } finally {
      setCancelando(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={despesa.numero}
        subtitle="Solicitação de Despesa / Compra / Manutenção"
        module="Malote"
        breadcrumb={["Malote", "Solicitação", "Visualizar"]}
        actions={
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 flex items-center gap-3">
          <Badge className={STATUS_BADGE_CLASS[despesa.status]}>{STATUS_LABEL[despesa.status]}</Badge>
          {!editavel && <p className="text-xs text-muted-foreground">Dados bloqueados, não podem ser alterados.</p>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                  <ShoppingCart className="h-3.5 w-3.5" />
                </span>
                <p className="text-sm font-semibold">Solicitação de Despesa / Compra / Manutenção</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>
                    Nome da solicitação <span className="text-destructive">*</span>
                  </Label>
                  <Input value={nome} onChange={(e) => setNome(e.target.value)} disabled={!editavel} />
                </div>
                <div>
                  <Label>
                    Motivo <span className="text-destructive">*</span>
                  </Label>
                  <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={!editavel} />
                </div>
              </div>

              <div>
                <Label>
                  Descrição <span className="text-destructive">*</span>
                </Label>
                <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} disabled={!editavel} rows={3} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>
                    Valor estimado <span className="text-destructive">*</span>
                  </Label>
                  <Input type="number" step="0.01" value={valorEstimado} onChange={(e) => setValorEstimado(e.target.value)} disabled={!editavel} />
                </div>
                <div>
                  <Label>Link(s)</Label>
                  <Input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://..." disabled={!editavel} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>
                    Tipo <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={tipo}
                    onValueChange={(v) => {
                      setTipo(v as TipoSolicitacao);
                      if (v !== "contrato") {
                        setEmpresaContratoId("");
                        setContratoId("");
                      }
                    }}
                    disabled={!editavel}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(TIPO_LABEL) as [TipoSolicitacao, string][]).map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Classificação de despesa</Label>
                  <Input value={despesa.classificacao?.nome ?? "—"} disabled className="bg-muted" />
                </div>
              </div>

              {tipo === "contrato" && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>
                      Empresa <span className="text-destructive">*</span>
                    </Label>
                    <SearchableSelect
                      value={empresaContratoId}
                      onChange={(v) => {
                        setEmpresaContratoId(v);
                        setContratoId("");
                      }}
                      options={empresas.map((e) => ({ value: e.id, label: e.nome }))}
                      placeholder="Selecione a empresa..."
                      disabled={!editavel}
                    />
                  </div>
                  <div>
                    <Label>
                      Contrato <span className="text-destructive">*</span>
                    </Label>
                    <SearchableSelect
                      value={contratoId}
                      onChange={setContratoId}
                      options={contratosDaEmpresa.map((c) => ({ value: c.id, label: c.nome }))}
                      placeholder="Selecione o contrato..."
                      disabled={!editavel || !empresaContratoId}
                    />
                  </div>
                </div>
              )}

              <div>
                <Label>Arquivos anexados</Label>
                {arquivosExistentes.length > 0 && (
                  <ul className="space-y-1 mb-2">
                    {arquivosExistentes.map((path, i) => (
                      <li key={path} className="flex items-center justify-between rounded-md border border-border px-2 py-1 text-xs">
                        <button type="button" onClick={() => abrirAnexo(path)} className="flex items-center gap-1.5 truncate text-primary hover:underline">
                          <Paperclip className="h-3 w-3 shrink-0" /> {path.split("/").pop()}
                        </button>
                        {editavel && (
                          <button
                            type="button"
                            onClick={() => setArquivosExistentes((arr) => arr.filter((_, idx) => idx !== i))}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {editavel && <AnexosField arquivos={arquivosNovos} onChange={setArquivosNovos} />}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-6 h-full">
          {(emAprovacaoInicial || podeEscolherCotacao) && (
            <Card className="border-l-4 border-l-blue-400">
              <CardContent className="p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                    <Info className="h-3.5 w-3.5" />
                  </span>
                  <p className="text-sm font-semibold">Resumo</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Classificação: <span className="font-medium text-foreground">{despesa.classificacao?.nome ?? "—"}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Valor estimado:{" "}
                  <span className="font-medium text-foreground">
                    {Number(despesa.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Veja o orçamento e o impacto desta compra nos cards ao lado.
                </p>
              </CardContent>
            </Card>
          )}

          {(emAprovacaoInicial || podeEscolherCotacao) && (
            <Card className={cn("border-l-4 border-l-sky-400", !podeEscolherCotacao && "flex-1")}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400">
                      <Wallet className="h-3.5 w-3.5" />
                    </span>
                    <p className="text-sm font-semibold">Orçamento da classificação</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div
                    className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: `conic-gradient(${corPct(pctAtual)} ${Math.min(pctAtual ?? 0, 100) * 3.6}deg, hsl(var(--muted-foreground)/0.15) 0deg)`,
                    }}
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-[11px] font-semibold text-muted-foreground">
                      {pctAtual != null ? `${pctAtual.toFixed(0)}%` : "—"}
                    </div>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p>
                      Valor orçado: <span className="font-medium text-foreground">{fmtMoney(orcadoClassificacao)}</span>
                    </p>
                    <p>
                      Utilizado até o momento: <span className="font-medium text-foreground">{fmtMoney(utilizadoAtual)}</span>
                    </p>
                    <p>
                      Saldo disponível: <span className="font-medium text-foreground">{fmtMoney(saldoDisponivel)}</span>
                    </p>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  "Utilizado" soma despesas já em Aguardando Pagamento ou Despesa Paga no mês corrente ({anoMesRef}) —
                  ainda não conta o valor desta solicitação, veja o impacto dela no card abaixo.
                </p>
              </CardContent>
            </Card>
          )}

          {podeEscolherCotacao && (
            <Card className="flex-1 border-l-4 border-l-amber-400">
              <CardContent className="p-4 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                      <TrendingUp className="h-3.5 w-3.5" />
                    </span>
                    <p className="text-sm font-semibold">Impacto desta compra</p>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    Valor da cotação selecionada:{" "}
                    <span className="font-medium text-foreground">{fmtMoney(cotacaoSelecionada?.valor ?? null)}</span>
                  </p>
                  <p>
                    Utilizado atualmente: <span className="font-medium text-foreground">{fmtMoney(utilizadoAtual)}</span>
                  </p>
                  <p>
                    Utilizado após esta compra: <span className="font-medium text-foreground">{fmtMoney(utilizadoAposCompra)}</span>
                  </p>
                  <p>
                    Saldo após esta compra: <span className="font-medium text-foreground">{fmtMoney(saldoAposCompra)}</span>
                  </p>
                  <p>
                    % do orçamento após compra:{" "}
                    <span className="font-medium" style={{ color: corPct(pctAposCompra) }}>
                      {pctAposCompra != null ? `${pctAposCompra.toFixed(2)}%` : "—"}
                    </span>
                  </p>
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Enquanto nenhuma cotação está selecionada, usa o Valor estimado da solicitação como referência. A
                  compra só entra de fato no "Utilizado" após a aprovação e o lançamento da despesa.
                </p>
              </CardContent>
            </Card>
          )}

          {painelOcultoPorNaoSerAprovador && (
            <Card className="border-dashed">
              <CardContent className="p-4 flex items-start gap-2.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Info className="h-3.5 w-3.5" />
                </span>
                <p className="text-xs text-muted-foreground">
                  Os painéis de Resumo, Orçamento e Impacto aparecem só para quem está configurado como aprovador desta
                  Classificação — acesso amplo por cargo (supervisor/admin) não conta pra isso.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {(podeEscolherCotacao || cotacoes.length > 0 || despesa.status === "aguardando_aprovacao_inicial" || despesa.status === "aguardando_cotacao") && (
        <ComprasPassadas classificacaoId={despesa.classificacao_id} classificacaoNome={despesa.classificacao?.nome ?? null} ignorarId={despesa.id} />
      )}

      {(podeEscolherCotacao || cotacoes.length > 0 || despesa.status === "aguardando_aprovacao_inicial" || despesa.status === "aguardando_cotacao") && (
        <Card className="border-l-4 border-l-emerald-400">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
                <ClipboardList className="h-3.5 w-3.5" />
              </span>
              <p className="text-sm font-semibold">Cotações (até 3)</p>
              {cotacoes.length > 0 && <span className="text-xs text-muted-foreground">recebidas ({cotacoes.length})</span>}
            </div>

            {cotacoes.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                {despesa.status === "aguardando_aprovacao_inicial"
                  ? "Após a aprovação inicial, o Suprimentos poderá adicionar até 3 cotações."
                  : "Aguardando o Suprimentos cotar (tela em /app/suprimentos/cotacoes-malote)."}
              </p>
            ) : (
              <>
                {podeEscolherCotacao && (
                  <p className="text-xs text-muted-foreground">Clique em uma cotação abaixo pra selecionar a vencedora.</p>
                )}
                <div className="grid gap-3 md:grid-cols-3">
                  {(() => {
                    const menorValor = Math.min(...cotacoes.filter((c) => c.valor != null).map((c) => Number(c.valor)));
                    const CORES = [
                      { borda: "border-l-sky-400", icone: "bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400", anel: "hover:ring-sky-200" },
                      { borda: "border-l-violet-400", icone: "bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400", anel: "hover:ring-violet-200" },
                      { borda: "border-l-amber-400", icone: "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400", anel: "hover:ring-amber-200" },
                    ];
                    return cotacoes.map((c, idx) => {
                      const escolhida = despesa.cotacao_vencedor_num === c.n;
                      const selecionavel = podeEscolherCotacao;
                      const melhorPreco = c.valor != null && Number(c.valor) === menorValor;
                      const cor = CORES[idx % CORES.length];
                      return (
                        <div
                          key={c.n}
                          onClick={() => selecionavel && setNumeroSelecionado(c.n)}
                          className={cn(
                            "group relative flex flex-col rounded-xl border border-l-4 bg-card p-3.5 text-xs shadow-sm transition-all duration-200 ease-out",
                            cor.borda,
                            selecionavel && "cursor-pointer hover:-translate-y-1 hover:shadow-lg hover:ring-2",
                            selecionavel && cor.anel,
                            escolhida
                              ? "border-emerald-400 !border-l-emerald-400 bg-emerald-50/70 ring-1 ring-emerald-300 dark:bg-emerald-950/20"
                              : numeroSelecionado === c.n
                              ? "ring-2 ring-primary/40 shadow-md"
                              : "border-border"
                          )}
                        >
                          {escolhida && (
                            <span className="absolute -top-2.5 right-3 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow">
                              ESCOLHIDA
                            </span>
                          )}
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-transform duration-200", cor.icone, selecionavel && "group-hover:scale-110")}>
                                {c.n}
                              </span>
                              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", cor.icone)}>
                                <Building2 className="h-4 w-4" />
                              </span>
                            </div>
                            {selecionavel && (
                              <input
                                type="radio"
                                name="cotacao-escolhida"
                                className="h-4 w-4 shrink-0 accent-primary"
                                checked={numeroSelecionado === c.n}
                                onChange={() => setNumeroSelecionado(c.n)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            )}
                          </div>

                          <p className="mt-2 font-semibold truncate" title={c.fornecedor}>
                            {c.fornecedor}
                          </p>
                          {melhorPreco && !escolhida && (
                            <Badge variant="outline" className="mt-1 w-fit gap-1 border-amber-300 bg-amber-50 text-amber-700 text-[10px] dark:bg-amber-950/30 dark:text-amber-400">
                              <Trophy className="h-3 w-3" /> Menor preço
                            </Badge>
                          )}
                          <p className="mt-1.5 text-lg font-bold text-foreground">
                            {c.valor != null ? Number(c.valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—"}
                          </p>
                          <div className="mt-2 flex flex-col gap-1 text-muted-foreground border-t border-border/70 pt-2">
                            {c.prazo && (
                              <span className="inline-flex items-center gap-1">
                                <CalendarClock className="h-3 w-3" />
                                Entrega até {new Date(c.prazo + "T00:00:00").toLocaleDateString("pt-BR")}
                              </span>
                            )}
                            {c.link && (
                              <a
                                href={c.link}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" /> Ver link
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </>
            )}

            {podeEscolherCotacao && (
              <div className="rounded-lg border border-dashed border-border/70 bg-muted/30 p-3 space-y-2">
                <textarea
                  value={comentarioCotacao}
                  onChange={(e) => setComentarioCotacao(e.target.value.slice(0, 500))}
                  placeholder="Motivo da reprovação (obrigatório só se for reprovar)..."
                  className="w-full min-h-10 rounded-md border border-input bg-background p-2 text-xs"
                  maxLength={500}
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">{comentarioCotacao.length}/500</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5"
                      onClick={handleReprovarCotacao}
                      disabled={acaoCotacao !== null}
                    >
                      <X className="h-3.5 w-3.5" /> {acaoCotacao === "reprovar" ? "Reprovando..." : "Reprovar solicitação"}
                    </Button>
                    <Button size="sm" className="gap-1.5" onClick={handleAprovarCotacaoEscolhida} disabled={acaoCotacao !== null || !numeroSelecionado}>
                      <Check className="h-3.5 w-3.5" /> {acaoCotacao === "aprovar" ? "Aprovando..." : "Aprovar cotação selecionada"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {emAprovacaoInicial && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold">Aprovação Inicial</p>
              <p className="text-xs text-muted-foreground">
                {aguardandoMinhaAprovacaoInicial
                  ? "Você está como aprovador desta classificação — analise e decida pela aprovação ou reprovação."
                  : "Aguardando o Suprimentos cotar — só é possível reprovar por enquanto."}
              </p>
            </div>
            <div>
              <Label>Comentário</Label>
              <textarea
                value={comentarioAprovacao}
                onChange={(e) => setComentarioAprovacao(e.target.value.slice(0, 500))}
                placeholder="Motivo da reprovação..."
                className="w-full min-h-16 rounded-md border border-input bg-background p-2 text-sm"
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">{comentarioAprovacao.length}/500</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5"
                onClick={handleReprovarInicial}
                disabled={acaoAprovacao !== null}
              >
                <X className="h-4 w-4" /> {acaoAprovacao === "reprovar" ? "Reprovando..." : "Reprovar solicitação"}
              </Button>
              {aguardandoMinhaAprovacaoInicial && (
                <Button className="gap-1.5" onClick={handleAprovarInicial} disabled={acaoAprovacao !== null}>
                  <Check className="h-4 w-4" /> {acaoAprovacao === "aprovar" ? "Aprovando..." : "Aprovar solicitação"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!emAprovacaoInicial && !podeEscolherCotacao && (podeCancelar || editavel) && (
        <div className="flex justify-end gap-2">
          {podeCancelar && (
            <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5" onClick={handleCancelar} disabled={cancelando}>
              <Trash2 className="h-4 w-4" /> {cancelando ? "Cancelando..." : "Cancelar solicitação"}
            </Button>
          )}
          {editavel && (
            <Button onClick={handleSalvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
