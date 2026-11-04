import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { useContasBanco } from "@/hooks/useContasBanco";
import { useSalvarContaGarantida } from "@/hooks/useContaGarantida";
import { rotuloConta } from "@/lib/contaBanco";
import type { ContaGarantida, StatusConta } from "./regras";

// SIS-2026-0798: cadastro da linha de crédito (modelo do HTML do chamado: empresa, banco, conta/contrato, limite, taxa, vencimento, observações).
// Empresa, banco e conta corrente ficam travados depois do primeiro lançamento: o Fluxo de Caixa deriva empresa e banco daqui, e mudar mexeria
// no histórico já lançado.

const NENHUMA = "_";
const paraNumero = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const paraTexto = (n: number) => String(n).replace(".", ",");

interface Props {
  open: boolean;
  onClose: () => void;
  /** Nulo = conta nova. */
  conta: ContaGarantida | null;
  saldo: number;
  temMovimentos: boolean;
}

export function ContaDialog({ open, onClose, conta, saldo, temMovimentos }: Props) {
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: contasBanco = [] } = useContasBanco();
  const salvar = useSalvarContaGarantida();

  const [empresaId, setEmpresaId] = useState("");
  const [bancoId, setBancoId] = useState("");
  const [contaBancoId, setContaBancoId] = useState(NENHUMA);
  const [numeroConta, setNumeroConta] = useState("");
  const [limite, setLimite] = useState("");
  const [taxa, setTaxa] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [status, setStatus] = useState<StatusConta>("ativa");
  const [observacao, setObservacao] = useState("");

  useEffect(() => {
    if (!open) return;
    setEmpresaId(conta?.empresa_id ?? "");
    setBancoId(conta?.banco_id ?? "");
    setContaBancoId(conta?.conta_banco_id ?? NENHUMA);
    setNumeroConta(conta?.conta ?? "");
    setLimite(conta ? paraTexto(conta.limite) : "");
    setTaxa(conta?.taxa ?? "");
    setVencimento(conta?.vencimento ?? "");
    setStatus(conta?.status ?? "ativa");
    setObservacao(conta?.observacao ?? "");
  }, [open, conta]);

  const contasDoBanco = useMemo(
    () => contasBanco.filter((c) => c.banco_id === bancoId && c.empresa_id === empresaId && (c.ativo || c.id === conta?.conta_banco_id)),
    [contasBanco, bancoId, empresaId, conta?.conta_banco_id],
  );
  const travado = !!conta && temMovimentos;

  async function handleSalvar() {
    const limiteNum = paraNumero(limite);
    if (!empresaId || !bancoId || !numeroConta.trim()) {
      toast.error("Informe a empresa, o banco e o número da conta / contrato.");
      return;
    }
    if (!(limiteNum > 0)) {
      toast.error("Informe o limite contratado.");
      return;
    }
    if (conta && limiteNum < saldo) {
      toast.error(`O limite não pode ficar abaixo do saldo utilizado (${formatBRL(saldo)}).`);
      return;
    }
    if (conta && status === "encerrada" && saldo > 0) {
      toast.error(`A conta tem saldo devedor de ${formatBRL(saldo)}: lance a amortização antes de encerrar.`);
      return;
    }
    try {
      await salvar.mutateAsync({
        id: conta?.id,
        empresaId,
        bancoId,
        contaBancoId: contaBancoId === NENHUMA ? null : contaBancoId,
        conta: numeroConta,
        limite: limiteNum,
        taxa,
        vencimento: vencimento || null,
        status,
        observacao,
      });
      toast.success(conta ? "Conta garantida atualizada." : "Conta garantida cadastrada.");
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Não foi possível salvar a conta.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{conta ? `Editar Conta Garantida ${conta.numero}` : "Nova Conta Garantida"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Empresa *</Label>
            <Select value={empresaId} onValueChange={(v) => { setEmpresaId(v); setContaBancoId(NENHUMA); }} disabled={travado}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Banco / Instituição *</Label>
            <Select value={bancoId} onValueChange={(v) => { setBancoId(v); setContaBancoId(NENHUMA); }} disabled={travado}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{bancos.filter((b) => b.ativo || b.id === conta?.banco_id).map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Número da Conta / Contrato *</Label>
            <Input className="h-9" value={numeroConta} onChange={(e) => setNumeroConta(e.target.value)} placeholder="Ex.: 12345-6" />
          </div>
          <div>
            <Label className="text-xs">Limite Contratado (R$) *</Label>
            <Input className="h-9" value={limite} onChange={(e) => setLimite(e.target.value)} placeholder="0,00" />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-xs">Conta corrente do banco (onde o dinheiro cai)</Label>
            <Select value={contaBancoId} onValueChange={setContaBancoId} disabled={travado || !empresaId || !bancoId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NENHUMA}>— (sem conta definida)</SelectItem>
                {contasDoBanco.map((c) => <SelectItem key={c.id} value={c.id}>{rotuloConta(c)}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Opcional. Com a conta corrente informada, cada resgate e amortização já nasce ligado a ela no Fluxo de Caixa e na Conciliação (as contas se
              cadastram em Cartão de Crédito → Gerenciar Bancos e Bandeiras → Contas).
            </p>
          </div>
          <div>
            <Label className="text-xs">Taxa / Indexador</Label>
            <Input className="h-9" value={taxa} onChange={(e) => setTaxa(e.target.value)} placeholder="Ex.: CDI + 1,20% a.m." />
          </div>
          <div>
            <Label className="text-xs">Vencimento</Label>
            <Input type="date" className="h-9" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
          </div>
          {conta && (
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as StatusConta)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ativa">Ativa</SelectItem>
                  <SelectItem value="encerrada">Encerrada</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="sm:col-span-2">
            <Label className="text-xs">Observações</Label>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Informações adicionais da linha de crédito…" />
          </div>
          {travado && (
            <p className="text-[11px] text-muted-foreground sm:col-span-2">
              Empresa, banco e conta corrente não mudam depois do primeiro lançamento (o Fluxo de Caixa usa esses dados nos lançamentos já feitos).
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvar.isPending}>{salvar.isPending ? "Salvando…" : "Salvar Conta"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
