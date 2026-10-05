import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import {
  DebitoAutomaticoLinha,
  TipoOrigemDebito,
  useCriarDebito,
  useCriarMovimentacao,
  useCriarNota,
  useCriarDebitoParcelado,
  useEditarDebito,
  enviarAnexosDebito,
} from "@/hooks/useDebitoAutomatico";
import { useEmpresasGrupo, useContratosAtivos } from "@/hooks/useMaloteDespesa";
import { useTiposFormaPagamento } from "@/hooks/useMaloteFormaPagamento";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useCartaoBancos, urlLogoCartao } from "@/hooks/useMaloteCartaoCredito";
import { BancoBadge } from "@/components/financeiro/BancoBadge";
import { AnexosDebito } from "./AnexosDebito";
import { ParcelaCalculada, gerarParcelasAutomaticas, somaParcelas, validarParcelas } from "./parcelas";

// SIS-2026-0256: um modal só cobre os 3 tipos de lançamento (Débito
// Automático, Movimentação Financeira, Nota Recebida) — os campos variam
// por `tipoOrigem`, seguindo os 3 mockups do chamado. `registroEditar`
// presente = modo edição (reaproveita os mesmos campos via
// debito_automatico_editar; Movimentação Financeira replica os campos
// comuns pras 2 linhas, Empresa/Tipo não são editáveis depois de criado —
// mexeriam no pareamento das 2 linhas).
export function DebitoAutomaticoModal({
  open,
  onClose,
  tipoOrigem,
  registroEditar,
  registroParEditar,
}: {
  open: boolean;
  onClose: () => void;
  tipoOrigem: TipoOrigemDebito;
  registroEditar?: DebitoAutomaticoLinha | null;
  // Movimentação Financeira: a outra linha da mesma transferência (pra
  // aplicar os campos comuns nas 2 ao editar).
  registroParEditar?: DebitoAutomaticoLinha | null;
}) {
  const editando = !!registroEditar;

  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: tiposFormaPagamento = [] } = useTiposFormaPagamento();
  const tiposFormaPagamentoAtivos = tiposFormaPagamento.filter((t) => t.ativo);
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: bancos = [] } = useCartaoBancos();
  const bancosAtivos = bancos.filter((b) => b.ativo);

  const criarDebito = useCriarDebito();
  const criarMovimentacao = useCriarMovimentacao();
  const criarNota = useCriarNota();
  const criarParcelado = useCriarDebitoParcelado();
  const editar = useEditarDebito();
  const [enviandoAnexos, setEnviandoAnexos] = useState(false);
  const salvando =
    criarDebito.isPending || criarMovimentacao.isPending || criarNota.isPending || criarParcelado.isPending || editar.isPending || enviandoAnexos;

  const [dataPagamento, setDataPagamento] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [tipo, setTipo] = useState<"saida" | "entrada">("saida");
  const [empresaId, setEmpresaId] = useState("");
  const [empresaSaidaId, setEmpresaSaidaId] = useState("");
  const [empresaEntradaId, setEmpresaEntradaId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [classificacaoId, setClassificacaoId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [valor, setValor] = useState("");
  const [status, setStatus] = useState<"pendente" | "pago">("pendente");
  const [bancoId, setBancoId] = useState("");
  const [bancoSaidaId, setBancoSaidaId] = useState("");
  const [bancoEntradaId, setBancoEntradaId] = useState("");
  // SIS-2026-0570: vencimento (editável), parcelamento e anexos na criação.
  const [dataVencimento, setDataVencimento] = useState("");
  const [parcelar, setParcelar] = useState(false);
  const [qtdParcelas, setQtdParcelas] = useState("2");
  const [modoParcelas, setModoParcelas] = useState<"auto" | "manual">("auto");
  const [parcelas, setParcelas] = useState<ParcelaCalculada[]>([]);
  const [arquivosNovos, setArquivosNovos] = useState<File[]>([]);
  const arquivosRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setParcelar(false);
    setQtdParcelas("2");
    setModoParcelas("auto");
    setParcelas([]);
    setArquivosNovos([]);
    if (registroEditar) {
      setDataPagamento(registroEditar.data_pagamento);
      setDataVencimento(registroEditar.data_vencimento ?? registroEditar.data_pagamento);
      setCompetencia(registroEditar.competencia.slice(0, 7));
      setTipo(registroEditar.tipo);
      setEmpresaId(registroEditar.empresa_id);
      setEmpresaSaidaId(registroEditar.tipo === "saida" ? registroEditar.empresa_id : registroParEditar?.empresa_id ?? "");
      setEmpresaEntradaId(registroEditar.tipo === "entrada" ? registroEditar.empresa_id : registroParEditar?.empresa_id ?? "");
      setContratoId(registroEditar.contrato_id ?? "");
      setClassificacaoId(registroEditar.classificacao_id);
      setDescricao(registroEditar.descricao);
      setFormaPagamento(registroEditar.forma_pagamento);
      setValor(String(registroEditar.valor));
      setStatus(registroEditar.status);
      setBancoId(registroEditar.banco_id);
      setBancoSaidaId(registroEditar.tipo === "saida" ? registroEditar.banco_id : registroParEditar?.banco_id ?? "");
      setBancoEntradaId(registroEditar.tipo === "entrada" ? registroEditar.banco_id : registroParEditar?.banco_id ?? "");
    } else {
      setDataPagamento("");
      setDataVencimento("");
      setCompetencia("");
      setTipo("saida");
      setEmpresaId("");
      setEmpresaSaidaId("");
      setEmpresaEntradaId("");
      setContratoId("");
      setClassificacaoId(tipoOrigem === "nota_recebida" ? (classificacoes.find((c) => c.nome.toUpperCase() === "RECEBIMENTO DE NOTA")?.id ?? "") : "");
      setDescricao("");
      setFormaPagamento(tipoOrigem === "movimentacao_financeira" ? "Transferência Bancária" : "");
      setValor("");
      setStatus("pendente");
      setBancoId("");
      setBancoSaidaId("");
      setBancoEntradaId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, registroEditar?.id]);

  // SIS-2026-0440: o reset acima roda em [open, registroEditar?.id], sem
  // depender de `classificacoes` (de propósito, pra não resetar a escolha
  // do usuário a cada refetch). Só que pra "Nota Recebida" isso criava uma
  // corrida real: se a query de classificações ainda não tivesse resolvido
  // no instante em que o modal abre, o auto-preenchimento de
  // "RECEBIMENTO DE NOTA" achava lista vazia, travava `classificacaoId`
  // em "" pra sempre — e como o campo é um <Input disabled> (não um
  // Select), o usuário não tinha nenhum jeito de corrigir manualmente.
  // Este efeito reconcilia assim que a lista chega, só se ainda estiver
  // vazio (não sobrescreve edição nem escolha já feita).
  useEffect(() => {
    if (!open || registroEditar || tipoOrigem !== "nota_recebida" || classificacaoId) return;
    const rec = classificacoes.find((c) => c.nome.toUpperCase() === "RECEBIMENTO DE NOTA");
    if (rec) setClassificacaoId(rec.id);
  }, [open, registroEditar, tipoOrigem, classificacaoId, classificacoes]);

  const valorNumero = Number(valor.replace(",", ".")) || 0;
  const permiteParcelar = !editando && tipoOrigem === "debito_automatico";
  const parcelando = permiteParcelar && parcelar;

  // Modo automático: divisão igual + um vencimento por mês a partir do 1º
  // vencimento (o campo de data). No manual a grade parte da mesma sugestão
  // e depois é editada à mão — só é refeita se o nº de parcelas mudar, pra
  // não perder o que a pessoa já ajustou.
  useEffect(() => {
    if (!parcelando) return;
    const base = gerarParcelasAutomaticas(valorNumero, Number(qtdParcelas) || 0, dataPagamento);
    if (modoParcelas === "auto") setParcelas(base);
    else setParcelas((atual) => (atual.length !== base.length && base.length > 0 ? base : atual));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelando, modoParcelas, valor, qtdParcelas, dataPagamento]);

  function editarParcela(i: number, patch: Partial<ParcelaCalculada>) {
    setModoParcelas("manual");
    setParcelas((ps) => ps.map((p, k) => (k === i ? { ...p, ...patch } : p)));
  }

  const titulo =
    tipoOrigem === "debito_automatico" ? "Débito Automático" : tipoOrigem === "movimentacao_financeira" ? "Movimentação Financeira" : "Nota Recebida";

  function validar(): string | null {
    if (!dataPagamento) return parcelando ? "Informe o 1º vencimento." : "Informe a Data de Pagamento.";
    if (!parcelando && !competencia) return "Informe a Competência.";
    if (!descricao.trim()) return "Informe a Descrição.";
    const valorNum = Number(valor.replace(",", "."));
    if (!valorNum || valorNum <= 0) return "Informe um Valor válido.";
    if (parcelando) {
      const erroParcelas = validarParcelas(parcelas, valorNum);
      if (erroParcelas) return erroParcelas;
    }
    if (tipoOrigem === "movimentacao_financeira") {
      if (!empresaSaidaId) return "Informe a Empresa de Saída.";
      if (!empresaEntradaId) return "Informe a Empresa de Entrada.";
      if (!classificacaoId) return "Informe a Classificação.";
      if (!bancoSaidaId) return "Informe o Banco de Saída.";
      if (!bancoEntradaId) return "Informe o Banco de Entrada.";
      // SIS-2026-0426: mesma empresa nos dois lados é normal (transferência
      // entre bancos da própria empresa) — só é inválido se banco também
      // for o mesmo, porque nesse caso seria a mesma conta se pagando.
      if (empresaSaidaId === empresaEntradaId && bancoSaidaId === bancoEntradaId) {
        return "Empresa e Banco de Saída não podem ser iguais aos de Entrada (seria a mesma conta).";
      }
    } else {
      if (!empresaId) return "Informe a Empresa.";
      if (!classificacaoId) {
        // SIS-2026-0440: pra Nota Recebida o campo é preenchido sozinho
        // (não dá pra "informar" nada, é <Input disabled>) — se ainda
        // assim está vazio, a classificação "RECEBIMENTO DE NOTA" não
        // existe no cadastro, não é o usuário que esqueceu de preencher.
        if (tipoOrigem === "nota_recebida") {
          return "Classificação \"RECEBIMENTO DE NOTA\" não encontrada. Peça pra alguém criá-la em Configurações → Classificações.";
        }
        return "Informe a Classificação.";
      }
      if (!formaPagamento) return "Informe a Forma de Pagamento.";
      if (!bancoId) return "Informe o Banco.";
    }
    return null;
  }

  // O lançamento já foi criado quando chega aqui — se o upload falhar, avisa
  // mas não desfaz (o arquivo pode ser anexado de novo pela edição).
  async function anexarNovos(ids: string[]) {
    if (arquivosNovos.length === 0) return;
    setEnviandoAnexos(true);
    try {
      for (const id of ids) await enviarAnexosDebito(id, "lancamento", arquivosNovos);
    } catch (e: any) {
      toast.error(`Lançamento criado, mas houve erro ao anexar: ${e.message ?? "tente de novo pela edição."}`);
    } finally {
      setEnviandoAnexos(false);
    }
  }

  async function handleSalvar() {
    const erro = validar();
    if (erro) {
      toast.error(erro);
      return;
    }
    const valorNum = Number(valor.replace(",", "."));
    const competenciaDate = `${competencia}-01`;

    try {
      if (editando && registroEditar) {
        const campos: Record<string, unknown> = {
          data_pagamento: dataPagamento,
          competencia: competenciaDate,
          descricao: descricao.trim(),
          valor: valorNum,
          status,
        };
        // SIS-2026-0570: vencimento editável. Enquanto pendente a data única
        // do formulário É o vencimento (a data de pagamento só passa a
        // importar quando pagar), então as duas andam juntas.
        if (status === "pendente") {
          campos.data_vencimento = dataPagamento;
        } else if (dataVencimento) {
          campos.data_vencimento = dataVencimento;
        }
        if (tipoOrigem !== "movimentacao_financeira") {
          campos.empresa_id = empresaId;
          campos.contrato_id = contratoId || null;
          campos.classificacao_id = classificacaoId;
          campos.forma_pagamento = formaPagamento;
          campos.banco_id = bancoId;
          await editar.mutateAsync({ id: registroEditar.id, campos });
        } else {
          campos.classificacao_id = classificacaoId;
          // Cada linha (saída/entrada) tem seu próprio banco — não dá pra
          // aplicar o mesmo campos.banco_id nas 2, precisa por linha.
          const bancoDoRegistro = registroEditar.tipo === "saida" ? bancoSaidaId : bancoEntradaId;
          await editar.mutateAsync({ id: registroEditar.id, campos: { ...campos, banco_id: bancoDoRegistro } });
          if (registroParEditar) {
            const bancoDoPar = registroParEditar.tipo === "saida" ? bancoSaidaId : bancoEntradaId;
            await editar.mutateAsync({ id: registroParEditar.id, campos: { ...campos, banco_id: bancoDoPar } });
          }
        }
        toast.success("Lançamento atualizado.");
      } else if (parcelando) {
        const ids = await criarParcelado.mutateAsync({
          tipo,
          empresa_id: empresaId,
          contrato_id: contratoId || null,
          classificacao_id: classificacaoId,
          descricao: descricao.trim(),
          forma_pagamento: formaPagamento,
          banco_id: bancoId,
          parcelas,
        });
        await anexarNovos(ids);
        toast.success(`Débito Automático parcelado em ${parcelas.length}x incluído.`);
      } else if (tipoOrigem === "debito_automatico") {
        const novoId = await criarDebito.mutateAsync({
          data_pagamento: dataPagamento,
          competencia: competenciaDate,
          tipo,
          empresa_id: empresaId,
          contrato_id: contratoId || null,
          classificacao_id: classificacaoId,
          descricao: descricao.trim(),
          forma_pagamento: formaPagamento,
          valor: valorNum,
          banco_id: bancoId,
        });
        await anexarNovos([novoId]);
        toast.success("Débito Automático incluído.");
      } else if (tipoOrigem === "movimentacao_financeira") {
        const novoId = await criarMovimentacao.mutateAsync({
          data_pagamento: dataPagamento,
          competencia: competenciaDate,
          empresa_saida_id: empresaSaidaId,
          empresa_entrada_id: empresaEntradaId,
          classificacao_id: classificacaoId,
          descricao: descricao.trim(),
          valor: valorNum,
          status,
          banco_saida_id: bancoSaidaId,
          banco_entrada_id: bancoEntradaId,
        });
        await anexarNovos([novoId]);
        toast.success("Movimentação Financeira incluída.");
      } else {
        const novoId = await criarNota.mutateAsync({
          data_pagamento: dataPagamento,
          competencia: competenciaDate,
          empresa_id: empresaId,
          contrato_id: contratoId || null,
          descricao: descricao.trim(),
          forma_pagamento: formaPagamento,
          valor: valorNum,
          status,
          banco_id: bancoId,
        });
        await anexarNovos([novoId]);
        toast.success("Nota Recebida incluída.");
      }
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar lançamento.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editando ? `Editar ${titulo}` : `Incluir ${titulo}`}</DialogTitle>
          {editando && (
            <DialogDescription>{registroEditar?.numero} — toda alteração fica registrada no histórico do lançamento.</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">
                {parcelando ? "1º Vencimento *" : editando && status === "pendente" ? "Vencimento *" : "Data de Pagamento *"}
              </Label>
              <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
            </div>
            {parcelando ? (
              <div>
                <Label className="text-xs">Competência</Label>
                <Input value="Mês de cada vencimento" disabled />
              </div>
            ) : (
              <div>
                <Label className="text-xs">Competência *</Label>
                <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
              </div>
            )}
          </div>
          {editando && status === "pago" && (
            <div>
              <Label className="text-xs">Vencimento original</Label>
              <Input type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} />
            </div>
          )}

          {tipoOrigem === "movimentacao_financeira" && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>A empresa de saída gera a linha de saída e a empresa de entrada gera a linha de entrada.</span>
            </div>
          )}

          {tipoOrigem === "debito_automatico" && (
            <div>
              <Label className="text-xs">Tipo *</Label>
              <Select value={tipo} onValueChange={(v: "saida" | "entrada") => setTipo(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="saida">Saída</SelectItem>
                  <SelectItem value="entrada">Entrada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {tipoOrigem === "nota_recebida" && (
            <div>
              <Label className="text-xs">Tipo</Label>
              <Input value="Entrada" disabled />
            </div>
          )}

          {tipoOrigem === "movimentacao_financeira" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Empresa de Saída *</Label>
                  <Select value={empresaSaidaId} onValueChange={setEmpresaSaidaId} disabled={editando}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Empresa de Entrada *</Label>
                  <Select value={empresaEntradaId} onValueChange={setEmpresaEntradaId} disabled={editando}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Banco de Saída *</Label>
                  <Select value={bancoSaidaId} onValueChange={setBancoSaidaId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {bancosAtivos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Banco de Entrada *</Label>
                  <Select value={bancoEntradaId} onValueChange={setBancoEntradaId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {bancosAtivos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Empresa *</Label>
                <Select value={empresaId} onValueChange={setEmpresaId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Contrato</Label>
                <Select value={contratoId || "nenhum"} onValueChange={(v) => setContratoId(v === "nenhum" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhum">Nenhum</SelectItem>
                    {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Classificação *</Label>
              {tipoOrigem === "nota_recebida" ? (
                <Input value="Recebimento de Nota" disabled />
              ) : (
                <Select value={classificacaoId} onValueChange={setClassificacaoId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {classificacoes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div>
              <Label className="text-xs">Forma de Pagamento {tipoOrigem !== "movimentacao_financeira" && "*"}</Label>
              {tipoOrigem === "movimentacao_financeira" ? (
                <Input value="Transferência Bancária" disabled />
              ) : (
                <Select value={formaPagamento} onValueChange={setFormaPagamento}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {tiposFormaPagamentoAtivos.map((t) => <SelectItem key={t.nome} value={t.nome}>{t.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {tipoOrigem !== "movimentacao_financeira" && (
            <div>
              <Label className="text-xs">Banco *</Label>
              <Select value={bancoId} onValueChange={setBancoId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {bancosAtivos.map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {bancoId && (() => {
                const b = bancos.find((x) => x.id === bancoId);
                return b ? <BancoBadge nome={b.nome} logoUrl={urlLogoCartao(b.logo_path)} className="mt-1.5" /> : null;
              })()}
            </div>
          )}

          <div>
            <Label className="text-xs">Descrição *</Label>
            <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={`Descreva ${tipoOrigem === "nota_recebida" ? "a nota recebida" : tipoOrigem === "movimentacao_financeira" ? "a movimentação financeira" : "o débito automático"}`} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Valor (R$) *</Label>
              <Input type="number" step="0.01" min="0" value={valor} onChange={(e) => setValor(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Status *</Label>
              <Select value={status} onValueChange={(v: "pendente" | "pago") => setStatus(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="pago">Pago</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {permiteParcelar && (
            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={parcelar} onChange={(e) => setParcelar(e.target.checked)} />
                Parcelar este débito
              </label>
              {parcelar && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Cada parcela vira um lançamento pendente, com seu vencimento e comprovante. Só entra no Fluxo de Caixa quando for paga.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Nº de parcelas</Label>
                      <Input type="number" min="2" max="120" value={qtdParcelas} onChange={(e) => { setModoParcelas("auto"); setQtdParcelas(e.target.value); }} />
                    </div>
                    <div>
                      <Label className="text-xs">Valores e datas</Label>
                      <Select value={modoParcelas} onValueChange={(v: "auto" | "manual") => setModoParcelas(v)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Automático (divisão igual, mês a mês)</SelectItem>
                          <SelectItem value="manual">Manual (edito cada parcela)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {parcelas.length === 0 && (
                    <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                      Preencha o <strong>1º vencimento</strong> (campo de data no topo) e o <strong>valor total</strong> para as parcelas aparecerem aqui.
                    </p>
                  )}
                  {parcelas.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-[2.5rem_1fr_1fr] gap-2 text-[11px] font-medium text-muted-foreground">
                        <span>#</span><span>Vencimento</span><span>Valor (R$)</span>
                      </div>
                      <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                        {parcelas.map((p, i) => (
                          <div key={i} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-2">
                            <span className="text-xs text-muted-foreground">{i + 1}/{parcelas.length}</span>
                            <Input type="date" className="h-8" value={p.data_vencimento} onChange={(e) => editarParcela(i, { data_vencimento: e.target.value })} />
                            <Input type="number" step="0.01" min="0" className="h-8" value={p.valor} onChange={(e) => editarParcela(i, { valor: Number(e.target.value) })} />
                          </div>
                        ))}
                      </div>
                      <p className={`text-xs ${somaParcelas(parcelas) === Math.round(valorNumero * 100) / 100 ? "text-muted-foreground" : "text-destructive font-medium"}`}>
                        Soma das parcelas: {somaParcelas(parcelas).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} de{" "}
                        {valorNumero.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {!editando ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" /> Anexos (nota, boleto…)</span>
                <input
                  ref={arquivosRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    setArquivosNovos((a) => [...a, ...Array.from(e.target.files ?? [])]);
                    if (arquivosRef.current) arquivosRef.current.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => arquivosRef.current?.click()}>
                  Anexar
                </Button>
              </div>
              {arquivosNovos.length > 0 && (
                <ul className="space-y-1">
                  {arquivosNovos.map((f, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1 text-xs">
                      <span className="truncate">{f.name}</span>
                      <button type="button" onClick={() => setArquivosNovos((a) => a.filter((_, k) => k !== i))}><X className="h-3.5 w-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
              {parcelando && arquivosNovos.length > 0 && (
                <p className="text-[11px] text-muted-foreground">O mesmo arquivo é anexado a todas as parcelas; o comprovante de cada uma é enviado na hora de pagar.</p>
              )}
            </div>
          ) : (
            registroEditar && <AnexosDebito debitoId={registroEditar.id} tipo="lancamento" titulo="Anexos (nota, boleto…)" />
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
