import { useState } from "react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NfEmissaoRow, useItensNfEmissao } from "@/hooks/useNfEmissao";
import { useSalvarPisCofinsNfse } from "@/hooks/useNfseIntegracao";
import { fmtMoney } from "../nf-emissao/shared";
import { baseItensPisCofins, lerPercentualNfse, preverPisCofins } from "./pisCofinsNfse";

export function PisCofinsNfseEditor({ nf, bloqueado, aoAlterar }: { nf: NfEmissaoRow; bloqueado: boolean; aoAlterar: (pendente: boolean) => void }) {
  const { data: itens = [], isLoading, isError } = useItensNfEmissao(nf.id);
  const salvar = useSalvarPisCofinsNfse(nf.id);
  const [editando, setEditando] = useState(false);
  const [pis, setPis] = useState("");
  const [cofins, setCofins] = useState("");
  const pisPct = lerPercentualNfse(pis), cofinsPct = lerPercentualNfse(cofins);
  let previa: ReturnType<typeof preverPisCofins> | null = null, erro = "";
  if (editando) {
    if (pisPct === null || cofinsPct === null) erro = "Informe percentuais entre 0 e 100, com até duas casas decimais. Use 0 para não reter.";
    else try { previa = preverPisCofins(nf, itens, pisPct, cofinsPct); } catch (e) { erro = (e as Error).message; }
  }
  async function gravar() {
    if (!previa || pisPct === null || cofinsPct === null || bloqueado || salvar.isPending) return;
    try {
      await salvar.mutateAsync({ pisPct, cofinsPct, versao: nf.updated_at ?? "", base: baseItensPisCofins(itens) });
      setEditando(false); aoAlterar(false);
      toast.success("PIS/COFINS e líquido salvos na preparação. Revise os dados fiscais antes de solicitar a emissão.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível salvar os percentuais."); }
  }
  return <AcessoGate menu="financeiro-nfse" acao="alterar"><AcessoGate menu="nf-emissao" acao="incluir">
    <div className="rounded-md border p-3 space-y-3">
      <p className="text-sm">PIS salvo: <strong>{fmtMoney(nf.pis_total)}</strong> · COFINS salvo: <strong>{fmtMoney(nf.cofins_total)}</strong></p>
      {!editando ? <Button type="button" variant="outline" disabled={bloqueado || isLoading || isError} onClick={() => {
        const percentualAtual = (percentual: number, total: number) => String(Math.round((Number(percentual) || (Number(nf.vlr_bruto_total) > 0 ? Number(total) / Number(nf.vlr_bruto_total) : 0)) * 10000) / 100).replace(".", ",");
        setPis(percentualAtual(nf.pis_pct, nf.pis_total));
        setCofins(percentualAtual(nf.cofins_pct, nf.cofins_total));
        setEditando(true); aoAlterar(true);
      }}>Ajustar percentuais de PIS/COFINS</Button> : <>
        <p className="text-sm text-muted-foreground">Os percentuais serão aplicados sobre o bruto de todos os itens desta nota, substituindo percentuais próprios de PIS/COFINS. Os valores são arredondados por item. Salve para usar os novos valores na emissão.</p>
        <div className="grid gap-3 md:grid-cols-2">
          <Label className="grid gap-2">PIS (%)<Input inputMode="decimal" value={pis} disabled={salvar.isPending} onChange={e => { setPis(e.target.value); aoAlterar(true); }} /></Label>
          <Label className="grid gap-2">COFINS (%)<Input inputMode="decimal" value={cofins} disabled={salvar.isPending} onChange={e => { setCofins(e.target.value); aoAlterar(true); }} /></Label>
        </div>
        {previa && <p role="status" className="text-sm">Prévia: PIS {fmtMoney(previa.pis)} · COFINS {fmtMoney(previa.cofins)} · líquido {fmtMoney(previa.liquido)}</p>}
        {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
        <div className="flex gap-2"><Button type="button" disabled={!previa || bloqueado || salvar.isPending} onClick={() => void gravar()}>{salvar.isPending ? "Salvando percentuais..." : "Salvar percentuais e recalcular"}</Button>
          <Button type="button" variant="outline" disabled={salvar.isPending} onClick={() => { setEditando(false); aoAlterar(false); }}>Manter valores salvos</Button></div>
      </>}
      {isError && <p role="alert" className="text-sm text-destructive">Não foi possível carregar os itens. Reabra a nota para tentar novamente.</p>}
    </div>
  </AcessoGate></AcessoGate>;
}
