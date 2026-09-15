import { useMemo, useState } from "react";
import { Link2, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useChamadosDisponiveisHoraExtra } from "@/hooks/useHoraExtra";
import type { ChamadoDisponivel } from "./types";

export default function SeletorChamadoDialog({
  aberto,
  aoFechar,
  colaboradorId,
  podeAprovar,
  concluidosDesde,
  ignorar = [],
  aoSelecionar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  colaboradorId: string;
  podeAprovar: boolean;
  concluidosDesde?: string | null;
  ignorar?: string[];
  aoSelecionar: (chamado: ChamadoDisponivel) => void;
}) {
  const [busca, setBusca] = useState("");
  const { data = [], isLoading } = useChamadosDisponiveisHoraExtra(colaboradorId, concluidosDesde);
  const itens = useMemo(
    () =>
      data.filter(
        (item) =>
          !ignorar.includes(item.id) && `${item.numero} ${item.assunto}`.toLowerCase().includes(busca.toLowerCase()),
      ),
    [data, busca, ignorar],
  );
  const escolher = (item: ChamadoDisponivel) => {
    if (!item.responsavel_id) {
      toast.error(
        `O chamado ${item.numero} ainda não foi designado. Designe pelo Painel de Distribuição antes de incluir na HE.`,
      );
      return;
    }
    if (item.responsavel_id !== colaboradorId) {
      const responsavel = item.responsavel_nome || "Usuário não identificado";
      toast.error(`O chamado ${item.numero} já foi designado a outro usuário: ${responsavel}`);
      return;
    }
    aoSelecionar(item);
    aoFechar();
    setBusca("");
  };
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Adicionar chamado</DialogTitle>
          <DialogDescription>Selecione um chamado em aberto já designado ao colaborador.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por número ou assunto..."
            className="pl-9"
          />
        </div>
        <div className="max-h-[55vh] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">Título</th>
                {podeAprovar && <th className="p-3">Responsável</th>}
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center">
                    Carregando...
                  </td>
                </tr>
              ) : (
                itens.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-3 font-semibold text-blue-700">
                      <span className="flex items-center gap-1">
                        <Link2 className="h-3.5 w-3.5" />
                        {item.numero}
                      </span>
                    </td>
                    <td className="p-3">
                      <div>{item.assunto}</div>
                      <div className="text-xs text-slate-500">{item.setor}</div>
                    </td>
                    {podeAprovar && (
                      <td className="p-3">
                        {item.responsavel_nome || <span className="text-amber-600">Não designado</span>}
                      </td>
                    )}
                    <td className="p-3 text-right">
                      <Button size="sm" variant="outline" onClick={() => escolher(item)}>
                        Selecionar
                      </Button>
                    </td>
                  </tr>
                ))
              )}
              {!isLoading && !itens.length && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-500">
                    Nenhum chamado encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
