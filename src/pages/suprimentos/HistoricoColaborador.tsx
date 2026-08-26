import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { History, Loader2, Search } from "lucide-react";

interface HistoricoMaterial {
  material: string;
  tamanho: string | null;
  quantidade: number;
  codigo: string | null;
  entregue_em: string;
  devolvido: boolean;
  contrato: string;
}

const sb = supabase as any;

export default function HistoricoColaborador() {
  const [matricula, setMatricula] = useState("");
  const [matriculaConsultada, setMatriculaConsultada] = useState("");
  const [itens, setItens] = useState<HistoricoMaterial[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const buscar = async () => {
    const valor = matricula.trim();
    if (!valor) {
      setErro("Informe a matrícula do colaborador.");
      return;
    }
    setErro(null);
    setCarregando(true);
    const { data, error } = await sb.rpc("sup_adm_historico_colaborador", {
      p_matricula: valor,
    });
    setCarregando(false);
    if (error) {
      setErro(error.message || "Não foi possível consultar o histórico.");
      return;
    }
    setMatriculaConsultada(valor);
    setItens(data ?? []);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Histórico do Colaborador"
        subtitle="Consulte todos os materiais entregues pela matrícula do crachá."
        module="Suprimentos"
        breadcrumb={["Materiais & Catálogo", "Histórico do Colaborador"]}
      />

      <Card>
        <CardContent className="p-4 sm:p-5">
          <label htmlFor="matricula-colaborador" className="text-xs font-medium text-muted-foreground">
            Matrícula
          </label>
          <div className="mt-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="matricula-colaborador"
                autoFocus
                className="pl-9"
                value={matricula}
                onChange={(e) => setMatricula(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") buscar(); }}
                placeholder="Digite ou bipe a matrícula e pressione Enter"
              />
            </div>
            <Button onClick={buscar} disabled={carregando}>
              {carregando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Buscar
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Leitores de código de barras funcionam diretamente: a busca é feita ao receber Enter.
          </p>
          {erro && <p className="mt-3 text-sm text-destructive">{erro}</p>}
        </CardContent>
      </Card>

      {matriculaConsultada && !carregando && itens.length === 0 && (
        <div className="rounded-lg border border-dashed py-14 text-center text-muted-foreground">
          <History className="mx-auto mb-3 h-8 w-8 opacity-50" />
          <p className="text-sm">Nenhum material encontrado para a matrícula {matriculaConsultada}.</p>
        </div>
      )}

      {itens.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b bg-muted/30 px-4 py-3 text-sm font-semibold">
            {itens.length} entrega{itens.length === 1 ? "" : "s"} para a matrícula {matriculaConsultada}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Material</th>
                  <th className="px-4 py-3">Tamanho</th>
                  <th className="px-4 py-3">Qtd.</th>
                  <th className="px-4 py-3">Etiqueta</th>
                  <th className="px-4 py-3">Entrega</th>
                  <th className="px-4 py-3">Contrato</th>
                  <th className="px-4 py-3">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {itens.map((item, indice) => (
                  <tr key={`${item.codigo ?? "sem-etiqueta"}-${item.entregue_em}-${indice}`}>
                    <td className="px-4 py-3 font-medium">{item.material}</td>
                    <td className="px-4 py-3">{item.tamanho || "—"}</td>
                    <td className="px-4 py-3">{item.quantidade}</td>
                    <td className="px-4 py-3 font-mono text-xs">{item.codigo || "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3">{formatarDataHora(item.entregue_em)}</td>
                    <td className="px-4 py-3">{item.contrato || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={item.devolvido ? "secondary" : "default"}>
                        {item.devolvido ? "Devolvido" : "Com o colaborador"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function formatarDataHora(valor: string) {
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? "—"
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(data);
}
