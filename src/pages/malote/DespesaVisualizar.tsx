import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Paperclip, Trash2, RotateCcw, FileText, Package, DollarSign, Tag, Image as ImageIcon, FileSpreadsheet, File as FileIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  useDespesa,
  useDespesaEventos,
  useNomeUsuario,
  useCancelarDespesa,
  useMandarParaAprovacaoNovamente,
  useContratosAtivos,
  STATUS_LABEL,
  STATUS_BADGE_CLASS,
  STATUS_TERMINAIS,
  RateioLinha,
  TipoSolicitacao,
} from "@/hooks/useMaloteDespesa";
import { RateioGrid, DimensoesRateio } from "./RateioGrid";
import { FluxoAprovacaoVisual } from "./FluxoAprovacaoVisual";

const TIPO_SOLICITACAO_LABEL: Record<TipoSolicitacao, string> = {
  administrativo: "Administrativo",
  contrato: "Contrato",
  dispensa_cotacao: "Dispensa de cotação",
};

const FORMA_PAGAMENTO_LABEL: Record<string, string> = {
  pix: "Pix",
  ted: "TED",
  boleto: "Boleto",
  cartao: "Cartão",
  dinheiro: "Dinheiro",
};

const EVENTO_LABEL: Record<string, string> = {
  criacao: "Criada",
  edicao: "Editada",
  aguardando_cotacao: "Aguardando cotação",
  cotacao_realizada: "Cotação realizada",
  cotacao_aprovada: "Cotação aprovada",
  solicitacao_aprovada: "Solicitação aprovada",
  solicitacao_reprovada: "Solicitação reprovada",
  despesa_criada: "Despesa criada",
  aprovacao_nivel: "Aprovado",
  necessidade_de_ajuste: "Necessidade de ajuste",
  reenvio_aprovacao: "Reenviada para aprovação",
  aguardando_pagamento: "Aguardando pagamento",
  despesa_paga: "Despesa paga",
  despesa_reprovada: "Despesa reprovada",
  cancelamento: "Cancelada",
};

async function abrirAnexo(path: string) {
  const { data, error } = await supabase.storage.from("malote-anexos").createSignedUrl(path, 60);
  if (error || !data) {
    toast.error("Não foi possível abrir o anexo.");
    return;
  }
  window.open(data.signedUrl, "_blank");
}

function IconeArquivo({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return <ImageIcon className="h-4 w-4" />;
  if (["xls", "xlsx", "csv"].includes(ext)) return <FileSpreadsheet className="h-4 w-4" />;
  if (["pdf", "doc", "docx", "txt"].includes(ext)) return <FileText className="h-4 w-4" />;
  return <FileIcon className="h-4 w-4" />;
}

// Mesma técnica visual do KpiCard em PainelExecutivo.tsx: ícone grande com
// máscara em gradiente (opaco perto da borda, sumindo pro centro) — mais
// vivo que um simples opacity-5 e não corta o ícone no canto.
const TILE_COR = {
  emerald: "text-emerald-300 dark:text-emerald-800",
  violet: "text-violet-300 dark:text-violet-800",
} as const;

function TileDestaque({ label, valor, icon, cor }: { label: string; valor: string; icon: React.ReactNode; cor: keyof typeof TILE_COR }) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border p-3">
      <div
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1"
        style={{
          WebkitMaskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
          maskImage: "linear-gradient(to left, black 0%, black 30%, rgba(0,0,0,0.6) 60%, transparent 100%)",
        }}
      >
        <span className={cn("[&>svg]:h-14 [&>svg]:w-14", TILE_COR[cor])}>{icon}</span>
      </div>
      <p className="relative z-10 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="relative z-10 text-base font-semibold mt-0.5 truncate max-w-[85%]">{valor}</p>
    </div>
  );
}

export default function DespesaVisualizar() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useDespesa(id);
  const { data: eventos = [] } = useDespesaEventos(id);
  const { data: solicitanteNome } = useNomeUsuario(data?.despesa?.created_by);
  const { data: contratos = [] } = useContratosAtivos();
  const cancelar = useCancelarDespesa();
  const reenviar = useMandarParaAprovacaoNovamente();

  const [valorAprovado, setValorAprovado] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [informacoesPagamento, setInformacoesPagamento] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [dimensoes, setDimensoes] = useState<DimensoesRateio>({ empresa: false, contrato: false, fornecedor: false, integrante: false });
  const [ratearPor, setRatearPor] = useState<"percentual" | "valor">("percentual");
  const [linhasRateio, setLinhasRateio] = useState<RateioLinha[]>([]);
  const [enviando, setEnviando] = useState<"cancelar" | "reenviar" | null>(null);

  const despesa = data?.despesa;

  useEffect(() => {
    if (!despesa) return;
    setValorAprovado(despesa.valor_aprovado != null ? String(despesa.valor_aprovado) : String(despesa.valor_total));
    setJustificativa(despesa.justificativa_aprovacao ?? "");
    setFormaPagamento(despesa.forma_pagamento ?? "");
    setInformacoesPagamento(despesa.informacoes_pagamento ?? "");
    setDataPagamento(despesa.data_pagamento ?? "");
    setCompetencia(despesa.competencia ? despesa.competencia.slice(0, 7) : "");
  }, [despesa?.id]);

  useEffect(() => {
    if (!data?.rateio) return;
    setLinhasRateio(data.rateio);
    setDimensoes({
      empresa: data.rateio.some((l) => l.empresa_id != null),
      contrato: data.rateio.some((l) => l.contrato_id != null),
      fornecedor: data.rateio.some((l) => l.fornecedor_id != null),
      integrante: data.rateio.some((l) => l.integrante_empregado_id != null),
    });
  }, [data?.rateio, despesa?.id]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Carregando...</div>;
  if (!despesa) return <div className="p-6 text-muted-foreground">Despesa não encontrada.</div>;

  const bloqueado = STATUS_TERMINAIS.includes(despesa.status);
  const podeAgir = !bloqueado;

  async function handleCancelar() {
    setEnviando("cancelar");
    try {
      await cancelar.mutateAsync({ id: despesa!.id });
      toast.success("Despesa cancelada.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao cancelar despesa.");
    } finally {
      setEnviando(null);
    }
  }

  async function handleReenviar() {
    setEnviando("reenviar");
    try {
      await reenviar.mutateAsync({
        id: despesa!.id,
        empresa_id: despesa!.empresa_id,
        classificacao_id: despesa!.classificacao_id,
        origem: despesa!.origem,
        status: despesa!.status,
        nome: despesa!.nome,
        valor_total: despesa!.valor_total,
        valor_aprovado: valorAprovado ? Number(valorAprovado) : null,
        justificativa_aprovacao: justificativa || null,
        forma_pagamento: formaPagamento || null,
        informacoes_pagamento: informacoesPagamento || null,
        data_pagamento: dataPagamento || null,
        competencia: competencia ? competencia + "-01" : null,
        rateio: linhasRateio,
      });
      toast.success("Enviado para aprovação novamente (reiniciado em N1).");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao reenviar para aprovação.");
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={`Despesa ${despesa.numero}`}
        subtitle="Visualize os detalhes da despesa e acompanhe o fluxo de aprovação."
        module="Malote"
        breadcrumb={["Malote", "Despesa", "Visualizar"]}
        actions={
          <Button variant="outline" onClick={() => navigate("/app/malote/meus-itens")}>
            <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
          </Button>
        }
      />

      {/* Bloco 1: cabeçalho */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Nº da Despesa</p>
            <p className="font-mono font-medium">{despesa.numero}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Solicitante</p>
            <p className="font-medium">{solicitanteNome ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Data da solicitação</p>
            <p>{new Date(despesa.created_at).toLocaleString("pt-BR")}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Data de pagamento</p>
            <p>{despesa.data_pagamento ? new Date(despesa.data_pagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Última atualização</p>
            <p>{new Date(despesa.updated_at).toLocaleString("pt-BR")}</p>
          </div>
          <div className="ml-auto">
            <Badge className={STATUS_BADGE_CLASS[despesa.status]}>
              {STATUS_LABEL[despesa.status]}
              {despesa.status === "pendente_aprovacao" && despesa.nivel_aprovacao_atual ? ` N${despesa.nivel_aprovacao_atual}` : ""}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {despesa.status === "necessidade_de_ajuste" && despesa.motivo_ajuste && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">Necessidade de ajuste</p>
            <p className="text-amber-700 dark:text-amber-400 mt-1">{despesa.motivo_ajuste}</p>
          </CardContent>
        </Card>
      )}

      {/* Bloco 2: Dados da Solicitação/Despesa (lado esquerdo) + Fluxo de Aprovação (lado direito) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        <Card className="flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    {despesa.origem === "solicitacao" ? <FileText className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                  </div>
                  <p className="text-sm font-semibold">{despesa.origem === "solicitacao" ? "Dados da Solicitação" : "Dados da Despesa"}</p>
                </div>
                <span className="text-[11px] text-muted-foreground">🔒 bloqueado</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <TileDestaque label="Valor" valor={Number(despesa.valor_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} icon={<DollarSign />} cor="emerald" />
                <TileDestaque label="Classificação" valor={despesa.classificacao?.nome ?? "—"} icon={<Tag />} cor="violet" />
              </div>

              <div className="text-sm space-y-2">
                <p>
                  <span className="text-muted-foreground">Nome:</span> {despesa.nome}
                </p>
                {despesa.motivo && (
                  <p>
                    <span className="text-muted-foreground">Motivo:</span> {despesa.motivo}
                  </p>
                )}
                {despesa.descricao && (
                  <p>
                    <span className="text-muted-foreground">Descrição:</span> {despesa.descricao}
                  </p>
                )}
                {despesa.tipo && (
                  <p>
                    <span className="text-muted-foreground">Tipo:</span> {TIPO_SOLICITACAO_LABEL[despesa.tipo]}
                  </p>
                )}
                {despesa.tipo === "contrato" && (
                  <p>
                    <span className="text-muted-foreground">Contrato:</span> {contratos.find((c) => c.id === despesa.contrato_id)?.nome ?? "—"}
                  </p>
                )}
              </div>

              {despesa.arquivos.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Arquivos anexados</p>
                  <div className="grid grid-cols-2 gap-2">
                    {despesa.arquivos.map((path) => (
                      <button
                        key={path}
                        type="button"
                        onClick={() => abrirAnexo(path)}
                        className="flex items-center gap-2 rounded-lg border border-border p-2 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                      >
                        <div className="h-7 w-7 rounded-md bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                          <IconeArquivo path={path} />
                        </div>
                        <span className="text-xs truncate">{path.split("/").pop()}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1" />

            <p className="text-xs text-muted-foreground border-t border-border pt-3 mt-4">
              Os dados da solicitação estão bloqueados e não podem ser alterados.
            </p>
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardContent className="p-4 flex flex-col flex-1 space-y-4">
            <div>
              <p className="text-sm font-semibold mb-1">Fluxo de Aprovação</p>
              <FluxoAprovacaoVisual despesa={despesa} />
            </div>

            <div className="border-t border-border pt-3 flex-1 flex flex-col">
              <p className="text-xs font-medium text-muted-foreground mb-3">Histórico detalhado</p>
              <div className="flex-1 max-h-72 overflow-y-auto pr-1 space-y-3">
                {eventos.map((ev) => (
                  <div key={ev.id} className="flex items-start gap-3 text-sm">
                    <div className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                    <div>
                      <p className="font-medium">
                        {EVENTO_LABEL[ev.tipo_evento] ?? ev.tipo_evento}
                        {ev.nivel ? ` (Nível ${ev.nivel})` : ""}
                      </p>
                      {ev.descricao && <p className="text-muted-foreground text-xs">{ev.descricao}</p>}
                      <p className="text-xs text-muted-foreground">{new Date(ev.created_at).toLocaleString("pt-BR")}</p>
                    </div>
                  </div>
                ))}
                {eventos.length === 0 && <p className="text-sm text-muted-foreground">Sem eventos registrados ainda.</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bloco 3: Dados da Aprovação e Pagamento */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Dados da Aprovação e Pagamento</p>
          <div className={cn("grid grid-cols-1 sm:grid-cols-3 gap-4", bloqueado && "opacity-60")}>
            <div>
              <Label>Valor aprovado</Label>
              <Input type="number" step="0.01" value={valorAprovado} onChange={(e) => setValorAprovado(e.target.value)} disabled={bloqueado} />
            </div>
            <div>
              <Label>Justificativa da aprovação</Label>
              <Input value={justificativa} onChange={(e) => setJustificativa(e.target.value)} disabled={bloqueado} />
            </div>
            <div>
              <Label>Forma de pagamento</Label>
              <Select value={formaPagamento} onValueChange={setFormaPagamento} disabled={bloqueado}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FORMA_PAGAMENTO_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dados de pagamento</Label>
              <Input value={informacoesPagamento} onChange={(e) => setInformacoesPagamento(e.target.value)} disabled={bloqueado} />
            </div>
            <div>
              <Label>Data do pagamento</Label>
              <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} disabled={bloqueado} />
            </div>
            <div>
              <Label>Competência</Label>
              <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={bloqueado} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Bloco 4: Rateio da Despesa */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <p className="text-sm font-semibold">Rateio da Despesa</p>
          <RateioGrid
            linhas={linhasRateio}
            onChange={setLinhasRateio}
            dimensoes={dimensoes}
            onDimensoesChange={setDimensoes}
            ratearPor={ratearPor}
            onRatearPorChange={setRatearPor}
            valorTotal={Number(valorAprovado) || despesa.valor_total}
            disabled={bloqueado}
          />
        </CardContent>
      </Card>

      {podeAgir && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 gap-1.5" onClick={handleCancelar} disabled={enviando !== null}>
            <Trash2 className="h-4 w-4" /> {enviando === "cancelar" ? "Cancelando..." : "Cancelar despesa"}
          </Button>
          <Button variant="outline" className="text-amber-700 border-amber-400 hover:bg-amber-50 gap-1.5" onClick={handleReenviar} disabled={enviando !== null}>
            <RotateCcw className="h-4 w-4" /> {enviando === "reenviar" ? "Enviando..." : "Mandar para aprovação novamente"}
          </Button>
        </div>
      )}
    </div>
  );
}
