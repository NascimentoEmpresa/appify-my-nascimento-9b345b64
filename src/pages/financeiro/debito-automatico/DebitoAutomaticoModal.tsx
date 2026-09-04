import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  DebitoAutomaticoLinha,
  TipoOrigemDebito,
  useCriarDebito,
  useCriarMovimentacao,
  useCriarNota,
  useEditarDebito,
} from "@/hooks/useDebitoAutomatico";
import { useEmpresasGrupo, useContratosAtivos } from "@/hooks/useMaloteDespesa";
import { useTiposFormaPagamento } from "@/hooks/useMaloteFormaPagamento";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useCartaoBancos, urlLogoCartao } from "@/hooks/useMaloteCartaoCredito";
import { BancoBadge } from "@/components/financeiro/BancoBadge";

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
  const editar = useEditarDebito();
  const salvando = criarDebito.isPending || criarMovimentacao.isPending || criarNota.isPending || editar.isPending;

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

  useEffect(() => {
    if (!open) return;
    if (registroEditar) {
      setDataPagamento(registroEditar.data_pagamento);
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

  const titulo =
    tipoOrigem === "debito_automatico" ? "Débito Automático" : tipoOrigem === "movimentacao_financeira" ? "Movimentação Financeira" : "Nota Recebida";

  function validar(): string | null {
    if (!dataPagamento) return "Informe a Data de Pagamento.";
    if (!competencia) return "Informe a Competência.";
    if (!descricao.trim()) return "Informe a Descrição.";
    const valorNum = Number(valor.replace(",", "."));
    if (!valorNum || valorNum <= 0) return "Informe um Valor válido.";
    if (tipoOrigem === "movimentacao_financeira") {
      if (!empresaSaidaId) return "Informe a Empresa de Saída.";
      if (!empresaEntradaId) return "Informe a Empresa de Entrada.";
      if (empresaSaidaId === empresaEntradaId) return "Empresa de Saída e de Entrada não podem ser a mesma.";
      if (!classificacaoId) return "Informe a Classificação.";
      if (!bancoSaidaId) return "Informe o Banco de Saída.";
      if (!bancoEntradaId) return "Informe o Banco de Entrada.";
    } else {
      if (!empresaId) return "Informe a Empresa.";
      if (!classificacaoId) return "Informe a Classificação.";
      if (!formaPagamento) return "Informe a Forma de Pagamento.";
      if (!bancoId) return "Informe o Banco.";
    }
    return null;
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
      } else if (tipoOrigem === "debito_automatico") {
        await criarDebito.mutateAsync({
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
        toast.success("Débito Automático incluído.");
      } else if (tipoOrigem === "movimentacao_financeira") {
        await criarMovimentacao.mutateAsync({
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
        toast.success("Movimentação Financeira incluída.");
      } else {
        await criarNota.mutateAsync({
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
              <Label className="text-xs">Data de Pagamento *</Label>
              <Input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Competência *</Label>
              <Input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)} />
            </div>
          </div>

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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
