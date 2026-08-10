import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { LayoutGrid, Package, Lock, ShoppingCart, FileEdit } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmpresaId } from "@/hooks/useEmpresaId";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useSalvarDespesa, uploadAnexoMalote, gerarParcelas, RateioLinha } from "@/hooks/useMaloteDespesa";
import { RateioGrid, DimensoesRateio } from "./RateioGrid";
import { AnexosField } from "./AnexosField";

const DIAS_MES = Array.from({ length: 28 }, (_, i) => i + 1);
const QUANTIDADE_PARCELAS = Array.from({ length: 24 }, (_, i) => i + 2);

export default function CriarDespesa() {
  const navigate = useNavigate();
  const { data: empresaId } = useEmpresaId();
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const [classificacaoId, setClassificacaoId] = useState("");

  const classificacao = classificacoes.find((c) => c.id === classificacaoId);
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
                Classificação <span className="text-destructive">*</span>
              </Label>
              <Select value={classificacaoId} onValueChange={setClassificacaoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a classificação da despesa" />
                </SelectTrigger>
                <SelectContent>
                  {classificacoes.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="shrink-0">
              <Label className="invisible hidden sm:block">Ação</Label>
              <Button variant="outline" onClick={() => navigate("/app/malote/ratear-classificacao")} className="gap-2 w-full sm:w-auto">
                <LayoutGrid className="h-4 w-4" /> Ratear classificação
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A classificação define quais tipos de despesas estarão disponíveis para esta solicitação.
          </p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PainelSolicitacao classificacaoId={classificacaoId} empresaId={empresaId ?? null} ativo={modo === "solicitacao"} />
        <PainelDespesaMalote classificacaoId={classificacaoId} empresaId={empresaId ?? null} ativo={modo === "despesa"} />
      </div>

      {!modo && (
        <p className="text-xs text-muted-foreground text-center">
          Selecione uma classificação para habilitar os tipos de despesa e preencher os formulários acima.
        </p>
      )}
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
function PainelSolicitacao({ classificacaoId, empresaId, ativo }: { classificacaoId: string; empresaId: string | null; ativo: boolean }) {
  const salvar = useSalvarDespesa();
  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [valorEstimado, setValorEstimado] = useState("");
  const [links, setLinks] = useState("");
  const [tipo, setTipo] = useState<"entrada" | "saida">("saida");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [salvando, setSalvando] = useState<"rascunho" | "enviar" | null>(null);

  function validar(paraEnviar: boolean): string | null {
    if (!nome.trim()) return "Informe o nome da solicitação.";
    if (!motivo.trim()) return "Informe o motivo.";
    if (!descricao.trim()) return "Informe a descrição.";
    if (!valorEstimado || Number(valorEstimado) <= 0) return "Informe o valor estimado.";
    if (paraEnviar && arquivos.length === 0) return "Anexe ao menos um arquivo.";
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
      const despesaId = await salvar.mutateAsync({
        empresa_id: empresaId,
        classificacao_id: classificacaoId,
        origem: "solicitacao",
        status,
        nome: nome.trim(),
        valor_total: Number(valorEstimado),
        motivo: motivo.trim(),
        descricao: descricao.trim(),
        links: links.trim() || null,
        tipo_movimento: tipo,
      });
      if (arquivos.length > 0) {
        const paths = await Promise.all(arquivos.map((f) => uploadAnexoMalote(f, despesaId)));
        await salvar.mutateAsync({ id: despesaId, empresa_id: empresaId, classificacao_id: classificacaoId, origem: "solicitacao", status, nome: nome.trim(), valor_total: Number(valorEstimado), arquivos: paths });
      }
      toast.success(status === "rascunho" ? "Rascunho salvo." : "Solicitação enviada para aprovação.");
      setNome(""); setMotivo(""); setDescricao(""); setValorEstimado(""); setLinks(""); setArquivos([]);
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label>Valor estimado *</Label>
              <Input type="number" step="0.01" value={valorEstimado} onChange={(e) => setValorEstimado(e.target.value)} placeholder="Ex: R$ 1.500,00" disabled={!ativo} />
            </div>
            <div>
              <Label>Link(s)</Label>
              <Input value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://..." disabled={!ativo} />
            </div>
          </div>

          <div>
            <Label>Tipo *</Label>
            <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as "entrada" | "saida")} className="flex gap-6 mt-1">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <RadioGroupItem value="saida" disabled={!ativo} /> Saída
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <RadioGroupItem value="entrada" disabled={!ativo} /> Entrada
              </label>
            </RadioGroup>
          </div>

          <div>
            <Label>Arquivos anexados *</Label>
            <AnexosField arquivos={arquivos} onChange={setArquivos} disabled={!ativo} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => handleSalvar("rascunho")} disabled={!ativo || salvando !== null}>
              {salvando === "rascunho" ? "Salvando..." : "Salvar rascunho"}
            </Button>
            <Button onClick={() => handleSalvar("pendente_aprovacao")} disabled={!ativo || salvando !== null}>
              {salvando === "enviar" ? "Enviando..." : "Enviar para aprovação"}
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
function PainelDespesaMalote({ classificacaoId, empresaId, ativo }: { classificacaoId: string; empresaId: string | null; ativo: boolean }) {
  const salvar = useSalvarDespesa();
  const [nome, setNome] = useState("");
  const [totalMes, setTotalMes] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [informacoesPagamento, setInformacoesPagamento] = useState("");
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
        parcelado === "sim" && diaDesconto && quantidadeParcelas
          ? gerarParcelas(Number(totalMes), Number(quantidadeParcelas), dataPagamento, Number(diaDesconto))
          : [];

      const despesaId = await salvar.mutateAsync({
        empresa_id: empresaId,
        classificacao_id: classificacaoId,
        origem: "despesa_unica",
        status,
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
      });

      if (arquivos.length > 0) {
        const paths = await Promise.all(arquivos.map((f) => uploadAnexoMalote(f, despesaId)));
        await salvar.mutateAsync({
          id: despesaId,
          empresa_id: empresaId,
          classificacao_id: classificacaoId,
          origem: "despesa_unica",
          status,
          nome: nome.trim(),
          valor_total: Number(totalMes),
          arquivos: paths,
        });
      }

      toast.success(status === "rascunho" ? "Rascunho salvo." : "Despesa enviada para aprovação.");
      setNome(""); setTotalMes(""); setDataPagamento(""); setCompetencia(""); setFormaPagamento("");
      setInformacoesPagamento(""); setLinhasRateio([]); setParcelado("nao"); setDiaDesconto("");
      setQuantidadeParcelas(""); setArquivos([]);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar despesa.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-4">
        <PainelHeader icon={<FileEdit className="h-4 w-4 mt-0.5 text-muted-foreground" />} titulo="Criar Despesa Malote" subtitulo="Preencha os dados para incluir a despesa diretamente no malote." ativo={ativo} />

        <div className={cn("space-y-4", !ativo && "opacity-40 pointer-events-none select-none")}>
          <div>
            <Label>Nome da Despesa *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Compra de materiais de escritório" disabled={!ativo} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <Label>Total do mês *</Label>
              <Input type="number" step="0.01" value={totalMes} onChange={(e) => setTotalMes(e.target.value)} placeholder="Ex: R$ 5.000,00" disabled={!ativo} />
            </div>
            <div>
              <Label>Data de pagamento *</Label>
              <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} disabled={!ativo} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Total já lançado</Label>
              <p className="h-10 flex items-center text-sm">
                {totalRateado.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (
                {totalMes ? ((totalRateado / Number(totalMes)) * 100).toFixed(0) : 0}%)
              </p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Restante para ratear</Label>
              <p className="h-10 flex items-center text-sm">
                {restante.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} (
                {totalMes ? ((restante / Number(totalMes)) * 100).toFixed(0) : 100}%)
              </p>
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
            <Button onClick={() => handleSalvar("pendente_aprovacao")} disabled={!ativo || salvando !== null}>
              {salvando === "enviar" ? "Enviando..." : "Enviar para aprovação"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
