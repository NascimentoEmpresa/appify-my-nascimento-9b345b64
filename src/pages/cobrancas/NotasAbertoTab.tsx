import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePermissoes } from "@/context/PermissoesContext";
import { FAIXA_COR } from "@/lib/faixaCobranca";
import { Mail, MessageSquare, Wrench } from "lucide-react";

const fmtMoney = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
const fmtData = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("pt-BR");

interface NotaAberta {
  id: string;
  empresa_codigo: string;
  cliente_contrato: string;
  nota: string;
  competencia: string | null;
  data_referencia: string;
  valor: number;
  dias_atraso: number;
  faixa: string;
  contrato_id: string | null;
}

export default function NotasAbertoTab() {
  const { roles } = usePermissoes();
  const [busca, setBusca] = useState("");
  const [empresaFiltro, setEmpresaFiltro] = useState("TODAS");
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

  const { data: notas = [], isLoading } = useQuery<NotaAberta[]>({
    queryKey: ["cobranca-relatorio-nota"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cobranca_relatorio_nota")
        .select("id, empresa_codigo, cliente_contrato, nota, competencia, data_referencia, valor, dias_atraso, faixa, contrato_id");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Mesma regra de visibilidade por setor do sistema antigo: Jurídico só vê a partir
  // da Laranja (atraso real > 30 dias), setor comercial/licitação só a partir da
  // Vermelha (> 60 dias). Financeiro/Controladoria/Admin veem tudo.
  const isJuridico = roles.includes("juridico") && !roles.includes("admin") && !roles.includes("financeiro");
  const isComercial = roles.includes("comercial") && !roles.includes("admin") && !roles.includes("financeiro");

  const empresas = useMemo(() => Array.from(new Set(notas.map((n) => n.empresa_codigo))).sort(), [notas]);

  const notasVisiveis = useMemo(() => {
    const termo = busca.trim().toUpperCase();
    return notas
      .filter((n) => {
        const diasAtrasoReal = n.dias_atraso - 30;
        if (isJuridico && diasAtrasoReal <= 30) return false;
        if (isComercial && diasAtrasoReal <= 60) return false;
        return true;
      })
      .filter((n) => empresaFiltro === "TODAS" || n.empresa_codigo === empresaFiltro)
      .filter((n) => !termo || n.cliente_contrato.toUpperCase().includes(termo) || n.nota.includes(termo) || n.faixa.toUpperCase().includes(termo))
      .sort((a, b) => a.cliente_contrato.localeCompare(b.cliente_contrato) || b.dias_atraso - a.dias_atraso);
  }, [notas, busca, empresaFiltro, isJuridico, isComercial]);

  const totalPorCliente = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const n of notasVisiveis) mapa.set(n.cliente_contrato, (mapa.get(n.cliente_contrato) ?? 0) + Number(n.valor));
    return mapa;
  }, [notasVisiveis]);

  const totalGeral = notasVisiveis.reduce((acc, n) => acc + Number(n.valor), 0);
  const totalAtraso = notasVisiveis.filter((n) => n.dias_atraso >= 30).reduce((acc, n) => acc + Number(n.valor), 0);

  const clienteSelecionado = selecionadas.size > 0 ? notasVisiveis.find((n) => selecionadas.has(n.id))?.cliente_contrato : null;

  const toggleSelecao = (nota: NotaAberta) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(nota.id)) {
        next.delete(nota.id);
        return next;
      }
      // Só permite selecionar notas do mesmo cliente ao mesmo tempo (mesma regra do sistema antigo)
      if (clienteSelecionado && clienteSelecionado !== nota.cliente_contrato) {
        return new Set([nota.id]);
      }
      next.add(nota.id);
      return next;
    });
  };

  let clienteAnterior = "";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Cliente, nota ou faixa"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="max-w-xs"
        />
        <Select value={empresaFiltro} onValueChange={setEmpresaFiltro}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="TODAS">Todas as empresas</SelectItem>
            {empresas.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="font-semibold">Total Geral: {fmtMoney(totalGeral)}</span>
          <span className="font-semibold text-red-600 dark:text-red-400">Total Atraso (30+): {fmtMoney(totalAtraso)}</span>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="px-2 py-2 w-8"></th>
                  <th className="px-2 py-2 text-left">Emissão</th>
                  <th className="px-2 py-2 text-left">Nº Nota</th>
                  <th className="px-2 py-2 text-left">Cliente/Contrato</th>
                  <th className="px-2 py-2 text-left">Empresa</th>
                  <th className="px-2 py-2 text-right">Valor</th>
                  <th className="px-2 py-2 text-right">Total Contrato</th>
                  <th className="px-2 py-2 text-right">Dias</th>
                  <th className="px-2 py-2 text-left">Faixa</th>
                  <th className="px-2 py-2 text-left">Último E-mail</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={10} className="px-2 py-6 text-center text-muted-foreground">Carregando...</td></tr>
                )}
                {!isLoading && notasVisiveis.length === 0 && (
                  <tr><td colSpan={10} className="px-2 py-6 text-center text-muted-foreground">Nenhuma nota em aberto.</td></tr>
                )}
                {notasVisiveis.map((n) => {
                  const mostrarSubtotal = n.cliente_contrato !== clienteAnterior;
                  clienteAnterior = n.cliente_contrato;
                  const bloqueada = clienteSelecionado !== null && clienteSelecionado !== undefined && clienteSelecionado !== n.cliente_contrato;
                  return (
                    <tr key={n.id} className={`border-t ${bloqueada ? "opacity-40" : ""}`}>
                      <td className="px-2 py-1">
                        <Checkbox checked={selecionadas.has(n.id)} disabled={bloqueada} onCheckedChange={() => toggleSelecao(n)} />
                      </td>
                      <td className="px-2 py-1">{fmtData(n.data_referencia)}</td>
                      <td className="px-2 py-1">{n.nota}</td>
                      <td className="px-2 py-1 max-w-[220px] truncate" title={n.cliente_contrato}>
                        {n.cliente_contrato}
                        {!n.contrato_id && <Badge variant="outline" className="ml-1 text-[10px] text-amber-700">sem contrato</Badge>}
                      </td>
                      <td className="px-2 py-1">{n.empresa_codigo}</td>
                      <td className="px-2 py-1 text-right">{fmtMoney(Number(n.valor))}</td>
                      <td className="px-2 py-1 text-right font-semibold">{mostrarSubtotal ? fmtMoney(totalPorCliente.get(n.cliente_contrato) ?? 0) : ""}</td>
                      <td className="px-2 py-1 text-right">{n.dias_atraso}</td>
                      <td className="px-2 py-1">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${FAIXA_COR[n.faixa] ?? ""}`}>{n.faixa}</span>
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">-</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3">
        <div className="text-sm text-muted-foreground">
          {selecionadas.size === 0 ? "Selecione uma ou mais notas do mesmo cliente." : `${selecionadas.size} nota(s) selecionada(s) de ${clienteSelecionado}.`}
        </div>
        <div className="flex gap-2">
          <Button disabled={selecionadas.size === 0} title="Ainda não implementado — próxima etapa">
            <Mail className="mr-2 h-4 w-4" /> Gerar E-mail
          </Button>
          <Button variant="secondary" disabled={selecionadas.size === 0} title="Ainda não implementado">
            <MessageSquare className="mr-2 h-4 w-4" /> Alerta WhatsApp
          </Button>
          <Button variant="outline" disabled title="Ainda não implementado">
            <Wrench className="mr-2 h-4 w-4" /> Registrar Envio Manual
          </Button>
        </div>
      </div>
    </div>
  );
}
