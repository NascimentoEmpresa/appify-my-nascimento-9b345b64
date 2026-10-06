import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useCtrlExcluirVinculo, useCtrlSalvarVinculo, useCtrlVinculos } from "@/hooks/useReunioesEncarregados";
import { MENU_REUNIOES } from "./comum";

// Reuniões com Encarregados › Equipe e contratos (mig 20261006000005):
// o "nome na transcrição" → encarregado + contrato, usado em toda importação.
// Mudar aqui não reescreve registros já importados.

export default function Vinculos() {
  const { data: vinculos = [], isLoading } = useCtrlVinculos();
  const salvar = useCtrlSalvarVinculo();
  const excluir = useCtrlExcluirVinculo();
  const [novo, setNovo] = useState({ encarregado: "", contrato: "", nome_transcricao: "" });

  const adicionar = async () => {
    if (!novo.encarregado.trim()) return toast.error("Informe o encarregado.");
    try {
      await salvar.mutateAsync({ encarregado: novo.encarregado.trim(), contrato: novo.contrato.trim() || null, nome_transcricao: (novo.nome_transcricao || novo.encarregado).trim() });
      setNovo({ encarregado: "", contrato: "", nome_transcricao: "" });
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div className="space-y-3">
      <Card className="p-4 text-xs text-muted-foreground">
        Como cada encarregado aparece nas transcrições e de qual contrato ele é. Na importação, a fala de quem tem vínculo já sai com o encarregado e o contrato preenchidos. Mudar aqui vale para as próximas importações — registros já importados ficam como estão.
      </Card>
      <AcessoGate menu={MENU_REUNIOES} acao="alterar">
        <Card className="grid gap-2 p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Input placeholder="Encarregado" value={novo.encarregado} onChange={(e) => setNovo({ ...novo, encarregado: e.target.value })} />
          <Input placeholder="Contrato" value={novo.contrato} onChange={(e) => setNovo({ ...novo, contrato: e.target.value })} />
          <Input placeholder="Nome na transcrição (se diferente)" value={novo.nome_transcricao} onChange={(e) => setNovo({ ...novo, nome_transcricao: e.target.value })} />
          <Button onClick={adicionar} disabled={salvar.isPending}><Plus className="mr-1 h-4 w-4" /> Adicionar</Button>
        </Card>
      </AcessoGate>
      {isLoading ? <Card className="p-6 text-sm text-muted-foreground">Carregando…</Card> : vinculos.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhum vínculo ainda. Eles também são criados pela caixa de vínculos da importação.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr><th className="px-4 py-2 font-medium">Encarregado</th><th className="px-3 py-2 font-medium">Contrato</th><th className="px-3 py-2 font-medium">Nome na transcrição</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {vinculos.map((v) => (
                <tr key={v.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{v.encarregado}</td>
                  <td className="px-3 py-2 text-xs">{v.contrato ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{v.nome_transcricao}</td>
                  <td className="px-3 py-2 text-right">
                    <AcessoGate menu={MENU_REUNIOES} acao="excluir">
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={async () => { try { await excluir.mutateAsync(v.id); } catch (e) { toast.error((e as Error).message); } }}><Trash2 className="h-4 w-4" /></Button>
                    </AcessoGate>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
