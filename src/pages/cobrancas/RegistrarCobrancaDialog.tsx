import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { clienteCobranca } from "./clienteCobranca";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROTULO_SETOR, type SetorCobranca } from "./cobrancaNotas";

// SIS-2026-0878: registra que o Jurídico ou o Financeiro cobrou as notas (a data aparece na lista, por setor, como no sistema antigo).
// A cobrança em si acontece fora daqui (o e-mail da Prévia não é enviado pela tela); aqui só fica o registro de quem cobrou e quando.
const hoje = () => new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

export function RegistrarCobrancaDialog({
  notaIds, contrato, setores, onClose,
}: {
  /** null = fechado */
  notaIds: string[] | null;
  contrato: string;
  /** Setores que o usuário pode registrar (o primeiro vem marcado). */
  setores: SetorCobranca[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [setor, setSetor] = useState<SetorCobranca>(setores[0] ?? "juridico");
  const [data, setData] = useState(hoje());
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (notaIds) { setSetor(setores[0] ?? "juridico"); setData(hoje()); setObs(""); }
  }, [notaIds, setores]);

  if (!notaIds) return null;

  async function confirmar() {
    if (!notaIds) return;
    setSalvando(true);
    try {
      const { data: n, error } = await clienteCobranca.rpc("cobranca_registrar", { _nf_ids: notaIds, _setor: setor, _data: data || null, _observacao: obs.trim() || null });
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["cobranca-registros"] });
      toast.success(Number(n) === notaIds.length ? `Cobrança do ${ROTULO_SETOR[setor]} registrada em ${notaIds.length} nota(s).` : `Cobrança registrada em ${n} nota(s) (as demais já tinham o registro deste setor nesta data).`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message ?? "Não foi possível registrar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar cobrança</DialogTitle>
          <DialogDescription>{notaIds.length} nota(s) de {contrato}. A data aparece na lista, separada por setor.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Setor que cobrou</Label>
            <Select value={setor} onValueChange={(v) => setSetor(v as SetorCobranca)} disabled={setores.length <= 1}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{setores.map((s) => <SelectItem key={s} value={s}>{ROTULO_SETOR[s]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Data da cobrança</Label>
            <Input type="date" value={data} max={hoje()} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Observação (opcional)</Label>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} placeholder="Ex.: e-mail enviado ao fiscal do contrato, ligação, notificação..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button onClick={() => void confirmar()} disabled={salvando || !data || setores.length === 0}>{salvando ? "Salvando…" : "Registrar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
