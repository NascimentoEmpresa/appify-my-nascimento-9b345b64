import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FileEdit, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputMaiusculo } from "@/components/ui/InputMaiusculo";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmacaoMalote } from "@/components/malote/ConfirmacaoMalote";
import {
  buscarNumeroDespesa,
  gerarParcelas,
  NovaParcela,
  OrigemDespesa,
  RateioLinha,
  registrarEventoDespesa,
  SalvarDespesaInput,
  useConverterSolicitacaoEmDespesa,
  useSalvarDespesa,
  uploadAnexosMalote,
} from "@/hooks/useMaloteDespesa";
import { useMaloteConfig, usePrazoNormalInclusao, horaAtualPassouDe } from "@/hooks/useMaloteConfig";
import { useTiposFormaPagamento } from "@/hooks/useMaloteFormaPagamento";
import { TipoClassificacaoOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { cn } from "@/lib/utils";
import { vincularContaAoMalote, PARAM_ORIGEM } from "@/pages/juridico/patrimonio/vinculoMalote";
import {
  vincularReembolsoAoMalote, PARAM_ORIGEM_REEMBOLSO,
} from "@/lib/reembolso/vinculoMalote";
import { AnexosField } from "./AnexosField";
import { DiaPagamentoPicker } from "./DiaPagamentoPicker";
import { ExcecaoDiaBloqueadoField } from "./ExcecaoDiaBloqueadoField";
import { DimensoesRateio, RateioGrid } from "./RateioGrid";

// SIS-2026-0263 (Iury): "colocar a possibilidade de escolher de 1 a 30 para
// o dia de pagamento e poder escolher parcelar em até 420x" — dia do
// desconto sobe de 28 pra 30 (Select continua viável); quantidade de
// parcelas não é mais Select (420 opções seria inutilizável) — virou Input
// numérico com min/max validados em validar().
const DIAS_MES = Array.from({ length: 30 }, (_, i) => i + 1);
const QUANTIDADE_PARCELAS_MIN = 2;
const QUANTIDADE_PARCELAS_MAX = 420;

/** O que outra tela pode mandar pronto para a despesa do Malote. */
export interface PrefillDespesa {
  rubrica?: string;
  nome?: string;
  valor?: string;
  dataPagamento?: string;
  competencia?: string;
  formaPagamento?: string;
  informacoesPagamento?: string;
}

/** Payload já validado pelo mesmo formulário usado na criação normal. */
export type PayloadPainelDespesaMalote = Omit<
  SalvarDespesaInput,
  "id" | "status" | "arquivos" | "data_pagamento" | "competencia" |
  "forma_pagamento" | "informacoes_pagamento" | "rateio" | "parcelas"
> & {
  data_pagamento: string;
  competencia: string;
  forma_pagamento: string;
  informacoes_pagamento: string | null;
  rateio: RateioLinha[];
  parcelas: NovaParcela[];
  arquivosNovos: File[];
};

export const FORM_ID_PAINEL_DESPESA_DIARIA = "painel-despesa-malote-diaria";

export function Campo({ label, valor }: { label: string; valor: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p>{valor || "—"}</p>
    </div>
  );
}

export function PainelHeader({
  icon,
  titulo,
  subtitulo,
  ativo,
}: {
  icon: React.ReactNode;
  titulo: string;
  subtitulo: string;
  ativo: boolean;
}) {
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

// Painel compartilhado pela tela normal do Malote e pela aprovação de diária.
// A callback opcional mantém as regras/validações aqui, mas deixa a diária
// gravar tudo pela RPC transacional SECURITY DEFINER (SIS-2026-0287).
export function PainelDespesaMalote({
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
  aoSalvar,
  rotuloEnviar = "Enviar para aprovação",
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
  aoSalvar?: (payload: PayloadPainelDespesaMalote) => Promise<void>;
  rotuloEnviar?: string;
}) {
  const [paramsUrl] = useSearchParams();
  const obrigacaoPatrimonio = paramsUrl.get(PARAM_ORIGEM);
  // Mesmo mecanismo do Patrimônio, outra origem: a Central de Serviços manda
  // o reembolso aprovado para cá com tudo preenchido menos a classificação —
  // que é escolha por despesa, e é o que trouxe a pessoa até este formulário.
  const reembolsoOrigem = paramsUrl.get(PARAM_ORIGEM_REEMBOLSO);
  const [confirmacao, setConfirmacao] = useState<{ titulo: string; subtitulo: string; numero?: string | null } | null>(null);
  const salvar = useSalvarDespesa();
  const converter = useConverterSolicitacaoEmDespesa();
  const [nome, setNome] = useState(nomeInicial ?? inicial?.nome ?? "");
  const [totalMes, setTotalMes] = useState(valorInicial != null ? String(valorInicial) : (inicial?.valor ?? ""));
  const [dataPagamento, setDataPagamento] = useState(inicial?.dataPagamento ?? "");
  const [excecao, setExcecao] = useState(false);
  const [justificativaExcecao, setJustificativaExcecao] = useState("");
  const [competencia, setCompetencia] = useState(inicial?.competencia ?? "");
  const [formaPagamento, setFormaPagamento] = useState(inicial?.formaPagamento ?? "");
  const [informacoesPagamento, setInformacoesPagamento] = useState(inicial?.informacoesPagamento ?? "");
  // SIS-2026-0264: marcado significa que o próprio anexo é a informação de
  // pagamento. Nesse caso o texto fica opcional e o arquivo, obrigatório.
  const [pagamentoSoAnexo, setPagamentoSoAnexo] = useState(false);
  const [dimensoes, setDimensoes] = useState<DimensoesRateio>({ empresa: false, contrato: false, fornecedor: false, integrante: false });
  const [ratearPor, setRatearPor] = useState<"percentual" | "valor">("percentual");
  const [linhasRateio, setLinhasRateio] = useState<RateioLinha[]>([]);
  const [parcelado, setParcelado] = useState<"nao" | "sim">("nao");
  const [diaDesconto, setDiaDesconto] = useState("");
  const [quantidadeParcelas, setQuantidadeParcelas] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState<"rascunho" | "enviar" | null>(null);
  const { data: maloteConfig } = useMaloteConfig();
  const { data: tiposFormaPagamento = [] } = useTiposFormaPagamento();
  const tiposFormaPagamentoAtivos = useMemo(() => tiposFormaPagamento.filter((t) => t.ativo), [tiposFormaPagamento]);

  const totalRateado = useMemo(() => linhasRateio.reduce((s, l) => s + (Number(l.valor) || 0), 0), [linhasRateio]);
  const { data: prazoNormal } = usePrazoNormalInclusao();
  const exigeExcecao = !!dataPagamento && !!prazoNormal && dataPagamento < prazoNormal;
  const hoje = useMemo(() => new Date().toLocaleDateString("sv-SE"), []);

  function validar(paraEnviar: boolean): string | null {
    if (!nome.trim()) return "Informe o nome da despesa.";
    if (!totalMes || Number(totalMes) <= 0) return "Informe o total do mês.";
    if (!dataPagamento) return "Informe a data de pagamento.";
    if (paraEnviar && exigeExcecao && !excecao) {
      return `Data de pagamento fora do prazo normal de inclusão (regra 1.1 — hoje o prazo normal é ${prazoNormal}) — marque "Lançar como exceção" para continuar.`;
    }
    if (paraEnviar && excecao && dataPagamento === hoje && horaAtualPassouDe(maloteConfig?.excecao_limite_inclusao_horario)) {
      return `Já passou do horário limite (${maloteConfig?.excecao_limite_inclusao_horario}) para incluir exceção com pagamento hoje (regra 2.1).`;
    }
    if (excecao && (maloteConfig?.excecao_exigir_justificativa_solicitante ?? true) && !justificativaExcecao.trim()) {
      return "Informe a justificativa da exceção.";
    }
    if (!competencia) return "Informe a competência.";
    if (!formaPagamento) return "Selecione a forma de pagamento.";
    if (!pagamentoSoAnexo && !informacoesPagamento.trim()) return "Informe os dados de pagamento.";
    if (paraEnviar) {
      if (linhasRateio.length === 0) return "Adicione ao menos uma linha de rateio.";
      if (Math.abs(totalRateado - Number(totalMes)) > 0.01) return "O total do rateio deve ser igual ao Total do mês.";
      if (parcelado === "sim") {
        if (!diaDesconto || !quantidadeParcelas) return "Informe o dia do desconto e a quantidade de parcelas.";
        const n = Number(quantidadeParcelas);
        if (!Number.isInteger(n) || n < QUANTIDADE_PARCELAS_MIN || n > QUANTIDADE_PARCELAS_MAX) {
          return `Quantidade de parcelas deve ser entre ${QUANTIDADE_PARCELAS_MIN} e ${QUANTIDADE_PARCELAS_MAX}.`;
        }
      }
      if (pagamentoSoAnexo && arquivos.length === 0) return "Anexe ao menos um arquivo (Pagamento só por anexo está marcado).";
    }
    return null;
  }

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

      const payloadBase: PayloadPainelDespesaMalote = {
        empresa_id: empresaId,
        classificacao_id: classificacaoId,
        origem,
        nome: nome.trim(),
        valor_total: Number(totalMes),
        data_pagamento: dataPagamento,
        excecao,
        justificativa_excecao: excecao ? justificativaExcecao.trim() || null : null,
        competencia: competencia + "-01",
        forma_pagamento: formaPagamento,
        informacoes_pagamento: informacoesPagamento.trim() || null,
        parcelado: parcelado === "sim",
        numero_parcelas: parcelado === "sim" ? Number(quantidadeParcelas) : null,
        dia_desconto: parcelado === "sim" ? Number(diaDesconto) : null,
        rateio: linhasRateio,
        parcelas,
        arquivosNovos: arquivos,
      };

      if (paraEnviar && aoSalvar) {
        await aoSalvar(payloadBase);
        return;
      }

      let despesaId: string;
      const payloadComId = { ...payloadBase, id: despesaIdExistente };
      const { arquivosNovos: _arquivosNovos, ...payloadPersistido } = payloadComId;
      if (paraEnviar && despesaIdExistente) {
        despesaId = await converter.mutateAsync({ ...payloadPersistido, status: "pendente_aprovacao" });
      } else if (paraEnviar) {
        despesaId = await salvar.mutateAsync({ ...payloadPersistido, status: "pendente_aprovacao", nivel_aprovacao_atual: 1 });
      } else {
        despesaId = await salvar.mutateAsync({ ...payloadPersistido, status: despesaIdExistente ? "cotacao_aprovada" : "rascunho" });
      }

      if (arquivos.length > 0) {
        const paths = await uploadAnexosMalote(arquivos, despesaId, nome.trim());
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
        if (!vinculo.ok && vinculo.erro) {
          toast.warning("Despesa criada, mas a conta do Patrimônio não foi marcada como enviada: " + vinculo.erro);
        }
      }

      if (reembolsoOrigem) {
        const vinculo = await vincularReembolsoAoMalote(reembolsoOrigem, despesaId);
        // Avisa em vez de estourar: a despesa JÁ existe, e desfazê-la por
        // causa do carimbo seria trocar um problema pequeno (reembolso que
        // continua "Aprovado") por um grande (dinheiro que sumiu do Malote).
        if (!vinculo.ok && vinculo.erro) {
          toast.warning("Despesa criada, mas o reembolso não foi marcado como enviado: " + vinculo.erro);
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
        setInformacoesPagamento(""); setPagamentoSoAnexo(false); setLinhasRateio([]); setParcelado("nao"); setDiaDesconto("");
        setQuantidadeParcelas(""); setArquivos([]);
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar despesa.");
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

        <form
          id={aoSalvar ? FORM_ID_PAINEL_DESPESA_DIARIA : undefined}
          className={cn("space-y-4", !ativo && "opacity-40 pointer-events-none select-none")}
          onSubmit={(e) => {
            e.preventDefault();
            void handleSalvar("enviar");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
              e.preventDefault();
            }
          }}
        >
          <div>
            <Label>Nome da Despesa *</Label>
            <InputMaiusculo value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Compra de materiais de escritório" disabled={!ativo} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Total do mês *</Label>
              <Input type="number" step="0.01" value={totalMes} onChange={(e) => setTotalMes(e.target.value)} placeholder="Ex: R$ 5.000,00" disabled={!ativo || !!aoSalvar} />
            </div>
            <div>
              <Label>Data de pagamento *</Label>
              <DiaPagamentoPicker value={dataPagamento} onChange={setDataPagamento} disabled={!ativo} permitirDiasBloqueados={excecao} />
            </div>
          </div>
          <ExcecaoDiaBloqueadoField
            checked={excecao}
            onCheckedChange={setExcecao}
            justificativa={justificativaExcecao}
            onJustificativaChange={setJustificativaExcecao}
            disabled={!ativo}
            foraDoPrazoInclusao={exigeExcecao}
            prazoNormal={prazoNormal}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <Label>Competência *</Label>
              <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} disabled={!ativo} />
            </div>
            <div>
              <Label>Forma de pagamento *</Label>
              <Select value={formaPagamento} onValueChange={setFormaPagamento} disabled={!ativo}>
                <SelectTrigger><SelectValue placeholder="Selecione a forma" /></SelectTrigger>
                <SelectContent>
                  {tiposFormaPagamentoAtivos.map((t) => <SelectItem key={t.nome} value={t.nome}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Informações de pagamento {!pagamentoSoAnexo && "*"}</Label>
              <Input
                value={informacoesPagamento}
                onChange={(e) => setInformacoesPagamento(e.target.value)}
                placeholder={pagamentoSoAnexo ? "Não preencher — a informação é o anexo" : "Ex: Pix, copia e cola, dados bancários, etc."}
                disabled={!ativo || pagamentoSoAnexo}
              />
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={pagamentoSoAnexo} onChange={(e) => setPagamentoSoAnexo(e.target.checked)} disabled={!ativo} className="h-3.5 w-3.5" />
                Pagamento só por anexo (ex.: boleto) — dispensa este campo, mas exige arquivo
              </label>
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
                <label className="flex items-center gap-1.5 text-sm cursor-pointer"><RadioGroupItem value="nao" disabled={!ativo} /> Não</label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer"><RadioGroupItem value="sim" disabled={!ativo} /> Sim, parcelar</label>
              </RadioGroup>
            </div>
            {parcelado === "sim" && (
              <>
                <div>
                  <Label>Dia do desconto *</Label>
                  <Select value={diaDesconto} onValueChange={setDiaDesconto} disabled={!ativo}>
                    <SelectTrigger><SelectValue placeholder="Selecione o dia" /></SelectTrigger>
                    <SelectContent>{DIAS_MES.map((d) => <SelectItem key={d} value={String(d)}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantidade de parcelas *</Label>
                  <Input
                    type="number"
                    min={QUANTIDADE_PARCELAS_MIN}
                    max={QUANTIDADE_PARCELAS_MAX}
                    step={1}
                    placeholder={`De ${QUANTIDADE_PARCELAS_MIN} a ${QUANTIDADE_PARCELAS_MAX}`}
                    value={quantidadeParcelas}
                    onChange={(e) => setQuantidadeParcelas(e.target.value)}
                    disabled={!ativo}
                  />
                </div>
              </>
            )}
          </div>

          <div>
            <Label>Arquivos anexados {pagamentoSoAnexo && "*"}</Label>
            <AnexosField arquivos={arquivos} onChange={setArquivos} disabled={!ativo} />
          </div>

          {aoSalvar ? (
            <button type="submit" className="sr-only" disabled={!ativo || salvando !== null}>{rotuloEnviar}</button>
          ) : (
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => handleSalvar("rascunho")} disabled={!ativo || salvando !== null}>
                {salvando === "rascunho" ? "Salvando..." : "Salvar rascunho"}
              </Button>
              <Button type="submit" disabled={!ativo || salvando !== null}>
                {salvando === "enviar" ? "Enviando..." : rotuloEnviar}
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
