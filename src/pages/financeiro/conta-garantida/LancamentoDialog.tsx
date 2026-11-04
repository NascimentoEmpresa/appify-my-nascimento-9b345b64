import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useLancarContaGarantida } from "@/hooks/useContaGarantida";
import { ROTULO_TIPO, simularLancamento, type MovimentoContaGarantida, type ResumoConta, type TipoMovimento } from "./regras";

// SIS-2026-0798: Novo Resgate / Nova Amortização / Lançar Juros (modelo do HTML do chamado). O resumo abaixo do formulário mostra o saldo antes e
// depois; o servidor refaz a conferência (saldo e limite) e é quem decide. O lançamento entra no Fluxo de Caixa na mesma hora.

const hoje = () => new Date().toISOString().slice(0, 10);
const paraNumero = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const TITULO: Record<TipoMovimento, string> = {
  resgate: "Novo Resgate / Utilização",
  amortizacao: "Nova Amortização",
  juros: "Lançar Juros / Encargos",
};
const CONFIRMAR: Record<TipoMovimento, string> = {
  resgate: "Confirmar Resgate",
  amortizacao: "Confirmar Amortização",
  juros: "Confirmar Juros",
};
const ROTULO_DATA: Record<TipoMovimento, string> = { resgate: "Data da Utilização", amortizacao: "Data da Amortização", juros: "Data do Pagamento" };
const ROTULO_VALOR: Record<TipoMovimento, string> = { resgate: "Valor", amortizacao: "Valor Amortizado", juros: "Valor dos Juros" };
const NO_FLUXO: Record<TipoMovimento, string> = {
  resgate: "Entra no Fluxo de Caixa como ENTRADA no banco da conta.",
  amortizacao: "Entra no Fluxo de Caixa como SAÍDA do banco da conta.",
  juros: "Entra no Fluxo de Caixa como SAÍDA do banco da conta. Não altera o saldo devedor.",
};

interface Props {
  /** Nulo = fechado. */
  tipo: TipoMovimento | null;
  onClose: () => void;
  /** Só contas ativas. */
  contas: ResumoConta[];
  movimentos: MovimentoContaGarantida[];
  nomeBanco: (bancoId: string) => string;
  nomeEmpresa: (empresaId: string) => string;
  /** Conta pré-selecionada (ex.: o filtro de conta da tela). */
  contaInicialId?: string;
}

export function LancamentoDialog({ tipo, onClose, contas, movimentos, nomeBanco, nomeEmpresa, contaInicialId }: Props) {
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const lancar = useLancarContaGarantida();

  const [contaId, setContaId] = useState("");
  const [data, setData] = useState(hoje());
  const [valor, setValor] = useState("");
  const [classificacaoId, setClassificacaoId] = useState("");
  const [observacao, setObservacao] = useState("");

  // Classificação sugerida pelo nome (o Financeiro troca se quiser): cheque especial para resgate/amortização, juros para juros.
  const sugerida = useMemo(() => {
    if (!tipo) return "";
    const termo = tipo === "juros" ? "juro" : "cheque especial";
    return classificacoes.find((c) => semAcento(c.nome).includes(termo))?.id ?? "";
  }, [tipo, classificacoes]);

  useEffect(() => {
    if (!tipo) return;
    setContaId(contaInicialId && contas.some((c) => c.conta.id === contaInicialId) ? contaInicialId : (contas[0]?.conta.id ?? ""));
    setData(hoje());
    setValor("");
    setObservacao("");
    setClassificacaoId(sugerida);
    // só reinicia quando o diálogo abre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  useEffect(() => {
    if (tipo && !classificacaoId && sugerida) setClassificacaoId(sugerida);
  }, [tipo, sugerida, classificacaoId]);

  const resumo = contas.find((c) => c.conta.id === contaId);
  const valorNum = paraNumero(valor || "0");
  const simulacao = useMemo(
    () => (tipo && resumo ? simularLancamento(resumo.conta.limite, movimentos.filter((m) => m.conta_garantida_id === resumo.conta.id), { tipo, data, valor: valorNum || 0 }) : null),
    [tipo, resumo, movimentos, data, valorNum],
  );

  async function handleConfirmar() {
    if (!tipo || !resumo) return;
    if (!(valorNum > 0)) {
      toast.error("Informe um valor válido.");
      return;
    }
    if (!data) {
      toast.error("Informe a data.");
      return;
    }
    if (!classificacaoId) {
      toast.error("Escolha a classificação do lançamento (ela aparece no Fluxo de Caixa).");
      return;
    }
    if (simulacao?.erro) {
      toast.error(simulacao.erro);
      return;
    }
    try {
      await lancar.mutateAsync({ contaId: resumo.conta.id, tipo, data, valor: valorNum, classificacaoId, observacao: observacao.trim() || null });
      toast.success(`${ROTULO_TIPO[tipo]} registrado e enviado ao Fluxo de Caixa.`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível registrar o lançamento.");
    }
  }

  return (
    <Dialog open={!!tipo} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tipo ? TITULO[tipo] : ""}</DialogTitle>
        </DialogHeader>
        {tipo && (
          <div className="space-y-4">
            {contas.length === 0 ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
                Não há conta garantida ativa. Cadastre uma conta antes de lançar.
              </p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Conta Garantida *</Label>
                    <Select value={contaId} onValueChange={setContaId}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                      <SelectContent>
                        {contas.map((r) => (
                          <SelectItem key={r.conta.id} value={r.conta.id}>
                            {r.conta.numero} · {nomeBanco(r.conta.banco_id)} · {r.conta.conta} · {nomeEmpresa(r.conta.empresa_id)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">{ROTULO_DATA[tipo]} *</Label>
                    <Input type="date" className="h-9" value={data} onChange={(e) => setData(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs">{ROTULO_VALOR[tipo]} (R$) *</Label>
                    <Input className="h-9" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Classificação no Fluxo de Caixa *</Label>
                    <Select value={classificacaoId} onValueChange={setClassificacaoId}>
                      <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                      <SelectContent>{classificacoes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
                    </Select>
                    {!sugerida && (
                      <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                        Não achei uma classificação com “{tipo === "juros" ? "juros" : "cheque especial"}” no nome: escolha a que o Financeiro usa para este lançamento.
                      </p>
                    )}
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="text-xs">Observação</Label>
                    <Textarea
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value.slice(0, 300))}
                      placeholder={tipo === "resgate" ? "Descrição da utilização…" : tipo === "amortizacao" ? "Descrição da amortização…" : "Ex.: juros de outubro"}
                    />
                  </div>
                </div>

                {resumo && simulacao && (
                  <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-xs">
                    <Linha rotulo="Limite contratado" valor={formatBRL(resumo.conta.limite)} />
                    <Linha rotulo="Saldo utilizado atual" valor={formatBRL(simulacao.saldoAtual)} />
                    <Linha rotulo={tipo === "resgate" ? "Nova utilização" : tipo === "amortizacao" ? "Valor da amortização" : "Juros pagos"} valor={formatBRL(valorNum || 0)} />
                    <div className="my-1 border-t" />
                    <Linha rotulo={tipo === "amortizacao" ? "Saldo devedor após amortização" : "Novo saldo devedor"} valor={formatBRL(simulacao.saldoDepois)} forte />
                    <Linha rotulo="Limite disponível após operação" valor={formatBRL(simulacao.disponivelDepois)} forte />
                    <p className="pt-1 text-[11px] text-muted-foreground">{NO_FLUXO[tipo]}</p>
                    {simulacao.erro && valorNum > 0 && <p className="pt-1 text-[11px] font-medium text-red-600 dark:text-red-400">{simulacao.erro}</p>}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleConfirmar} disabled={lancar.isPending || contas.length === 0 || !!simulacao?.erro}>
            {lancar.isPending ? "Registrando…" : tipo ? CONFIRMAR[tipo] : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{rotulo}</span>
      <span className={forte ? "font-semibold" : "font-medium"}>{valor}</span>
    </div>
  );
}
