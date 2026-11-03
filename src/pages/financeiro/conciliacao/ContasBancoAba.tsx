import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCartaoBancos } from "@/hooks/useMaloteCartaoCredito";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useContasBanco, useSalvarContaBanco } from "@/hooks/useContasBanco";
import type { ContaBanco } from "@/lib/contaBanco";

// SIS-2026-0777: aba "Contas" de Gerenciar Bancos e Bandeiras (Cartão de Crédito): cadastro das contas de cada banco (um banco pode ter N contas por empresa, ex.: Sicredi HAGG 119 e HAGG 155).
// Cadastrada a conta, o Fluxo de Caixa liga os lançamentos a ela (Alteração em massa → "Definir Conta do banco") e a Conciliação passa a
// poder ser feita conta por conta.
const VAZIO = { id: undefined as string | undefined, bancoId: "", empresaId: "", numero: "", apelido: "", ativo: true };

export function ContasBancoAba({ podeAlterar = true, bancoInicial }: { podeAlterar?: boolean; bancoInicial?: string }) {
  const { data: contas = [] } = useContasBanco();
  const { data: bancos = [] } = useCartaoBancos();
  const { data: empresas = [] } = useEmpresasGrupo();
  const salvar = useSalvarContaBanco();
  const [form, setForm] = useState({ ...VAZIO });
  const nomeBanco = (id: string) => bancos.find((b) => b.id === id)?.nome ?? "—";
  const nomeEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome ?? "—";

  function novo() {
    setForm({ ...VAZIO, bancoId: bancoInicial ?? "" });
  }
  function editar(c: ContaBanco) {
    setForm({ id: c.id, bancoId: c.banco_id, empresaId: c.empresa_id, numero: c.numero, apelido: c.apelido ?? "", ativo: c.ativo });
  }
  async function gravar() {
    if (!form.bancoId || !form.empresaId || !form.numero.trim()) {
      toast.error("Informe o banco, a empresa e o número da conta.");
      return;
    }
    try {
      await salvar.mutateAsync({ id: form.id, bancoId: form.bancoId, empresaId: form.empresaId, numero: form.numero, apelido: form.apelido || null, ativo: form.ativo });
      toast.success(form.id ? "Conta atualizada." : "Conta cadastrada.");
      setForm({ ...VAZIO, bancoId: form.bancoId });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar a conta.");
    }
  }

  const ordenadas = [...contas].sort((a, b) => nomeBanco(a.banco_id).localeCompare(nomeBanco(b.banco_id), "pt-BR") || nomeEmpresa(a.empresa_id).localeCompare(nomeEmpresa(b.empresa_id), "pt-BR") || a.numero.localeCompare(b.numero, "pt-BR"));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Um banco pode ter várias contas por empresa (ex.: Sicredi HAGG 119 e HAGG 155). Depois de cadastrar, ligue os lançamentos de cada conta no Fluxo de Caixa (Alteração em massa → Definir Conta do banco) para conciliar uma conta de cada vez.
      </p>

        <div className="max-h-56 overflow-y-auto rounded-md border text-sm">
          {ordenadas.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">Nenhuma conta cadastrada ainda.</p>
          ) : (
            <table className="w-full">
              <tbody>
                {ordenadas.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-3 py-1.5">{nomeBanco(c.banco_id)}</td>
                    <td className="px-3 py-1.5">{nomeEmpresa(c.empresa_id)}</td>
                    <td className="px-3 py-1.5 font-medium">{c.numero}{c.apelido ? <span className="font-normal text-muted-foreground"> — {c.apelido}</span> : null}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{c.ativo ? "" : "inativa"}</td>
                    <td className="px-2 py-1.5 text-right">
                      {podeAlterar && <Button size="icon" variant="ghost" className="h-7 w-7" title="Editar" onClick={() => editar(c)}><Pencil className="h-3.5 w-3.5" /></Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {podeAlterar && (<>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Banco *</Label>
            <Select value={form.bancoId || undefined} onValueChange={(v) => setForm((f) => ({ ...f, bancoId: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{bancos.filter((b) => b.ativo).map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Empresa *</Label>
            <Select value={form.empresaId || undefined} onValueChange={(v) => setForm((f) => ({ ...f, empresaId: v }))}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>{empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Número da conta * <span className="text-muted-foreground">(como aparece no extrato, ex.: 119)</span></Label>
            <Input className="h-9" value={form.numero} onChange={(e) => setForm((f) => ({ ...f, numero: e.target.value }))} />
          </div>
          <div>
            <Label className="text-xs">Apelido</Label>
            <Input className="h-9" placeholder="Ex.: Conta movimento, Poupança" value={form.apelido} onChange={(e) => setForm((f) => ({ ...f, apelido: e.target.value }))} />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-xs">
            <Checkbox checked={form.ativo} onCheckedChange={(v) => setForm((f) => ({ ...f, ativo: v === true }))} />
            Conta ativa (inativa some das listas de escolha, mas o histórico continua)
          </label>
        </div>
        <div className="flex justify-between">
          <Button variant="outline" size="sm" onClick={novo} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Nova conta</Button>
          <Button size="sm" onClick={() => void gravar()} disabled={salvar.isPending}>{form.id ? "Salvar alterações" : "Cadastrar conta"}</Button>
        </div>
        </>)}
    </div>
  );
}
