import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Ban, CheckCircle2 } from "lucide-react";

// RPC nova, ainda fora do types.ts gerado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * EPIs travados por causa do status oficial do CA.
 *
 * Pedido do Cassio: além de avisar, **impedir** que o item siga para o pedido
 * de materiais. A trava real é um gatilho no banco — esta tela é onde a pessoa
 * descobre o que está travado e por quê, sem precisar tentar e tomar erro.
 *
 * O status vem do arquivo do próprio Ministério, já carregado em
 * `sst_ca_catalogo`, e não de uma consulta ao site (que recusa qualquer cliente
 * que não seja navegador).
 */

interface ItemBloqueado {
  tag_id: string;
  codigo: string;
  item: string;
  almoxarifado: string | null;
  ca_numero: string | null;
  situacao: string | null;
  motivo: string | null;
}

const COR: Record<string, string> = {
  VENCIDO: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  CANCELADO: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  SUSPENSO: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
};

export function PainelCaBloqueado() {
  const { data = [], isLoading } = useQuery({
    queryKey: ["sst_ca_itens_bloqueados"],
    queryFn: async (): Promise<ItemBloqueado[]> => {
      const { data, error } = await sb.rpc("sst_ca_itens_bloqueados");
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return null;

  if (data.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>Nenhum EPI bloqueado por status de CA.</span>
      </div>
    );
  }

  return (
    <Card className="border-red-300 dark:border-red-900">
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start gap-2">
          <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div>
            <h3 className="font-medium text-red-700 dark:text-red-300">
              {data.length} EPI(s) bloqueado(s) por status do CA
            </h3>
            <p className="text-sm text-muted-foreground">
              Estes itens <strong>não saem</strong> para pedido de materiais. A trava é no banco,
              não só na tela — quem tentar receberá o motivo.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Situação</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Etiqueta</TableHead>
                <TableHead>CA</TableHead>
                <TableHead>Almoxarifado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((l) => (
                <TableRow key={l.tag_id}>
                  <TableCell>
                    <Badge className={COR[l.situacao ?? ""] ?? ""} variant="secondary">
                      {l.situacao ?? "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{l.item}</TableCell>
                  <TableCell className="font-mono text-xs">{l.codigo}</TableCell>
                  <TableCell>{l.ca_numero || "—"}</TableCell>
                  <TableCell>{l.almoxarifado || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <p className="text-xs text-muted-foreground">
          Para liberar, o SST precisa tomar ciência e agir sobre o item — trocar o lote, atualizar
          o CA ou dar baixa. O bloqueio some sozinho quando o CA voltar a ficar regular na lista do
          Ministério.
        </p>
      </CardContent>
    </Card>
  );
}
