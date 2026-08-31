import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ArrowLeft, LayoutGrid, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useSalvarDespesa, uploadAnexoMalote, gerarParcelas, RateioLinha } from "@/hooks/useMaloteDespesa";
import { useMaloteConfig, usePrazoNormalInclusao, horaAtualPassouDe } from "@/hooks/useMaloteConfig";
import { useTiposFormaPagamento } from "@/hooks/useMaloteFormaPagamento";
import { RateioGrid, DimensoesRateio } from "./RateioGrid";
import { AnexosField } from "./AnexosField";
import { DiaPagamentoPicker } from "./DiaPagamentoPicker";
import { ExcecaoDiaBloqueadoField } from "./ExcecaoDiaBloqueadoField";

// SIS-2026-0263 (Iury): mesmo ajuste de CriarDespesa.tsx — dia do desconto
// 1 a 30, quantidade de parcelas até 420 (Input numérico, não Select).
const DIAS_MES = Array.from({ length: 30 }, (_, i) => i + 1);
const QUANTIDADE_PARCELAS_MIN = 2;
const QUANTIDADE_PARCELAS_MAX = 420;

export default function RatearClassificacao() {
  const navigate = useNavigate();
  const onVoltar = () => navigate("/app/malote/criar-despesa");
  const { data: empresaId } = useEmpresaId();
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const salvar = useSalvarDespesa();

  // Regra confirmada: só classificações que NÃO exigem solicitação podem
  // entrar num rateio entre classificações.
  const classificacoesRateaveis = useMemo(() => classificacoes.filter((c) => !c.requer_solicitacao), [classificacoes]);

  const [nome, setNome] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [dadosPagamento, setDadosPagamento] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [excecao, setExcecao] = useState(false);
  const [justificativaExcecao, setJustificativaExcecao] = useState("");
  const [dataCompetencia, setDataCompetencia] = useState("");
  const [dimensoes, setDimensoes] = useState<DimensoesRateio>({ empresa: false, contrato: false, fornecedor: false, integrante: false });
  const [ratearPor, setRatearPor] = useState<"percentual" | "valor">("percentual");
  const [linhasRateio, setLinhasRateio] = useState<RateioLinha[]>([]);
  const [distribuirIgualmente, setDistribuirIgualmente] = useState(false);
  const [parcelado, setParcelado] = useState(false);
  const [diaDesconto, setDiaDesconto] = useState("");
  const [quantidadeParcelas, setQuantidadeParcelas] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState<"rascunho" | "enviar" | null>(null);
  const { data: maloteConfig } = useMaloteConfig();
  // SIS-2026-0221: "Forma de pagamento" vem do catálogo cadastrável em
  // Configurações do Malote → Formas de Pagamento, não mais de um enum fixo.
  const { data: tiposFormaPagamento = [] } = useTiposFormaPagamento();
  const tiposFormaPagamentoAtivos = useMemo(() => tiposFormaPagamento.filter((t) => t.ativo), [tiposFormaPagamento]);

  const totalRateado = useMemo(() => linhasRateio.reduce((s, l) => s + (Number(l.valor) || 0), 0), [linhasRateio]);
  const faltaLancar = Math.max(0, (Number(valorTotal) || 0) - totalRateado);
  // SIS-2026-0250: regra 1.1 — mesma lógica de CriarDespesa.tsx (ver
  // comentário lá): data mais cedo que o prazo normal calculado exige
  // exceção; exceção pra hoje depois do horário 2.1 bloqueia.
  const { data: prazoNormal } = usePrazoNormalInclusao();
  const exigeExcecao = !!dataPagamento && !!prazoNormal && dataPagamento < prazoNormal;
  const hoje = useMemo(() => new Date().toLocaleDateString("sv-SE"), []);

  function validar(paraEnviar: boolean): string | null {
    if (!nome.trim()) return "Informe o nome da despesa.";
    if (!valorTotal || Number(valorTotal) <= 0) return "Informe o valor total da despesa.";
    if (!formaPagamento) return "Selecione a forma de pagamento.";
    if (!dadosPagamento.trim()) return "Informe os dados de pagamento.";
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
    if (!dataCompetencia) return "Informe a data de competência.";
    if (paraEnviar) {
      if (linhasRateio.length === 0) return "Adicione ao menos uma linha de rateio.";
      if (linhasRateio.some((l) => !l.classificacao_id)) return "Selecione a classificação em todas as linhas.";
      if (Math.abs(totalRateado - Number(valorTotal)) > 0.01) return "O total do rateio deve ser igual ao valor total da despesa.";
      if (parcelado) {
        if (!diaDesconto || !quantidadeParcelas) return "Informe o dia do desconto e a quantidade de parcelas.";
        const n = Number(quantidadeParcelas);
        if (!Number.isInteger(n) || n < QUANTIDADE_PARCELAS_MIN || n > QUANTIDADE_PARCELAS_MAX) {
          return `Quantidade de parcelas deve ser entre ${QUANTIDADE_PARCELAS_MIN} e ${QUANTIDADE_PARCELAS_MAX}.`;
        }
      }
      if (arquivos.length === 0) return "Anexe ao menos um arquivo.";
    }
    return null;
  }

  async function handleSalvar(status: "rascunho" | "pendente_aprovacao") {
    const erro = validar(status === "pendente_aprovacao");
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
      const parcelas =
        parcelado && diaDesconto && quantidadeParcelas
          ? gerarParcelas(Number(valorTotal), Number(quantidadeParcelas), dataPagamento, Number(diaDesconto))
          : [];

      const despesaId = await salvar.mutateAsync({
        empresa_id: empresaId,
        classificacao_id: null,
        origem: "despesa_multi_classificacao",
        status,
        // Sem isso, uma despesa indo direto pra pendente_aprovacao ficava
        // sem "nível atual" e nenhum aprovador configurado via
        // Classificação era reconhecido — só o botão Reprovar aparecia.
        nivel_aprovacao_atual: status === "pendente_aprovacao" ? 1 : null,
        nome: nome.trim(),
        valor_total: Number(valorTotal),
        data_pagamento: dataPagamento,
        excecao,
        justificativa_excecao: excecao ? justificativaExcecao.trim() || null : null,
        competencia: dataCompetencia + "-01",
        forma_pagamento: formaPagamento,
        informacoes_pagamento: dadosPagamento.trim(),
        parcelado,
        numero_parcelas: parcelado ? Number(quantidadeParcelas) : null,
        dia_desconto: parcelado ? Number(diaDesconto) : null,
        rateio: linhasRateio,
        parcelas,
      });

      if (arquivos.length > 0) {
        const paths = await Promise.all(arquivos.map((f) => uploadAnexoMalote(f, despesaId)));
        await salvar.mutateAsync({
          id: despesaId,
          empresa_id: empresaId,
          classificacao_id: null,
          origem: "despesa_multi_classificacao",
          status,
          nome: nome.trim(),
          valor_total: Number(valorTotal),
          arquivos: paths,
        });
      }

      toast.success(status === "rascunho" ? "Rascunho salvo." : "Despesa enviada para aprovação.");
      onVoltar();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar despesa.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <Button variant="ghost" size="sm" onClick={onVoltar} className="gap-1.5 -ml-2">
        <ArrowLeft className="h-4 w-4" /> Voltar para criar despesa
      </Button>

      <div className="flex items-start gap-2">
        <LayoutGrid className="h-5 w-5 mt-0.5 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-bold">Ratear Classificação</h1>
          <p className="text-sm text-muted-foreground">Distribua o valor estimado entre classificações</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3">
        <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-800/90 dark:text-amber-300/90">
          Nenhuma das classificações rateadas pode ter a exigência de solicitação em seu cadastro.
        </p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-4 gap-4">
            <div>
              <Label>Nome da Despesa *</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Compra de materiais de escritório" />
            </div>
            <div>
              <Label>Valor Total da Despesa (R$) *</Label>
              <Input type="number" step="0.01" value={valorTotal} onChange={(e) => setValorTotal(e.target.value)} placeholder="Ex: R$ 1.500,00" />
            </div>
            <div>
              <Label>Forma de Pagamento *</Label>
              <Select value={formaPagamento} onValueChange={setFormaPagamento}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a forma" />
                </SelectTrigger>
                <SelectContent>
                  {tiposFormaPagamentoAtivos.map((t) => (
                    <SelectItem key={t.nome} value={t.nome}>
                      {t.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Dados de Pagamento *</Label>
              <Input value={dadosPagamento} onChange={(e) => setDadosPagamento(e.target.value)} placeholder="Pix, copia e cola, dados bancários, etc." />
            </div>
            <div>
              <Label>Data de Pagamento *</Label>
              <DiaPagamentoPicker value={dataPagamento} onChange={setDataPagamento} permitirDiasBloqueados={excecao} />
            </div>
            <div>
              <Label>Data Competência *</Label>
              <Input type="month" value={dataCompetencia} onChange={(e) => setDataCompetencia(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Total já lançado (R$)</Label>
              <p className="h-10 flex items-center text-sm">{totalRateado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Quanto falta lançar (R$)</Label>
              <p className="h-10 flex items-center text-sm">{faltaLancar.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
            </div>
          </div>

          <ExcecaoDiaBloqueadoField
            checked={excecao}
            onCheckedChange={setExcecao}
            justificativa={justificativaExcecao}
            onJustificativaChange={setJustificativaExcecao}
            foraDoPrazoInclusao={exigeExcecao}
            prazoNormal={prazoNormal}
          />

          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium mb-2">Rateio por Classificação, Empresa e Contrato</p>
            <RateioGrid
              linhas={linhasRateio}
              onChange={setLinhasRateio}
              dimensoes={dimensoes}
              onDimensoesChange={setDimensoes}
              ratearPor={ratearPor}
              onRatearPorChange={setRatearPor}
              valorTotal={Number(valorTotal) || 0}
              mostrarClassificacao
              classificacoesRateaveis={classificacoesRateaveis}
              distribuirIgualmente={distribuirIgualmente}
              onDistribuirIgualmenteChange={setDistribuirIgualmente}
              contratoPorClassificacao
            />
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={parcelado} onChange={(e) => setParcelado(e.target.checked)} className="h-4 w-4" />
              Compra parcelada? Marque esta opção se a despesa for paga em mais de uma parcela.
            </label>
            {parcelado && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                <div>
                  <Label>Número de parcelas *</Label>
                  <Input
                    type="number"
                    min={QUANTIDADE_PARCELAS_MIN}
                    max={QUANTIDADE_PARCELAS_MAX}
                    step={1}
                    placeholder={`De ${QUANTIDADE_PARCELAS_MIN} a ${QUANTIDADE_PARCELAS_MAX}`}
                    value={quantidadeParcelas}
                    onChange={(e) => setQuantidadeParcelas(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Dia do mês para desconto *</Label>
                  <Select value={diaDesconto} onValueChange={setDiaDesconto}>
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
                  <p className="text-xs text-muted-foreground mt-1">
                    A despesa será lançada mensalmente no dia escolhido, pelo valor de cada parcela.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label>Arquivos anexados *</Label>
            <AnexosField arquivos={arquivos} onChange={setArquivos} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleSalvar("rascunho")} disabled={salvando !== null}>
              {salvando === "rascunho" ? "Salvando..." : "Salvar rascunho"}
            </Button>
            <Button onClick={() => handleSalvar("pendente_aprovacao")} disabled={salvando !== null}>
              {salvando === "enviar" ? "Enviando..." : "Enviar para aprovação"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
