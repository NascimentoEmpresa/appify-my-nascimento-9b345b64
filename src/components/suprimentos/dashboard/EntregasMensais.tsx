import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AcessoGate } from '@/components/auth/AcessoGate';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { mesAnterior, csvEntregasMensais, type EntregasMensaisDados } from '@/lib/suprimentos/entregasMensais';
import { formatarMoeda } from '@/lib/suprimentos/dashboardComprasEstoque';

export function EntregasMensais({ empresaId, contratoId, categoria }: { empresaId: string | null; contratoId: string | null; categoria: string | null }) {
  const [mes, setMes] = useState(mesAnterior);
  const consulta = useQuery({
    queryKey: ['sup_entregas_mensais', mes, empresaId, contratoId, categoria],
    enabled: /^\d{4}-\d{2}$/.test(mes),
    staleTime: 120000,
    queryFn: async () => {
      const cliente = supabase as unknown as { rpc: (nome: string, args: Record<string, unknown>) => Promise<{data: unknown; error: {message: string} | null}> };
      const { data, error } = await cliente.rpc('sup_dashboard_entregas_mensais', { p_mes: `${mes}-01`, p_empresa_id: empresaId, p_contrato_id: contratoId, p_categoria: categoria });
      if (error) throw new Error(error.message);
      return data as EntregasMensaisDados;
    },
  });
  const dados = consulta.data;
  const exportar = () => {
    if (!dados) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csvEntregasMensais(dados.contratos)], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = `entregas-${mes}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const valores = (l: EntregasMensaisDados['resumo']) => [l.recebidos, l.admissoes, l.reposicoes, l.motivo_nao_informado, l.despachados, l.correios, l.supervisores, l.modalidade_nao_informada, l.correios_sem_cotacao, formatarMoeda(l.frete_estimado)];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <div><label htmlFor="mes-entregas" className="block text-sm font-medium">Mês das entregas</label><Input id="mes-entregas" type="month" value={mes} onChange={e => setMes(e.target.value)} /></div>
      <Button variant="outline" onClick={() => setMes(mesAnterior())}>Mês anterior</Button>
      <Button variant="outline" disabled={consulta.isFetching || !mes} onClick={() => consulta.refetch()}>Atualizar entregas</Button>
      <AcessoGate menu="sup_dashboard_compras_estoque" acao="exportar"><Button disabled={!dados?.contratos.length} onClick={exportar}>Exportar CSV</Button></AcessoGate>
    </div>
    <p className="text-sm text-muted-foreground">Esta aba usa o mês acima e os filtros de empresa, contrato e categoria. Recebidos incluem cancelados e usam a data da solicitação. Despachados usam a data do despacho em Brasília, inclusive pedidos recebidos em outros meses. Cada pedido conta uma vez; não representa quantidade de volumes. Admissão e reposição seguem o campo “É admissão” do cadastro; sem informação fica separado.</p>
    <Alert><AlertTitle>Frete estimado para apoio à conferência</AlertTitle><AlertDescription>A última declaração do pedido fornece a cotação, que pode diferir da fatura dos Correios. “Correios sem cotação” indica cobertura incompleta. O sistema ainda não registra aqui o valor efetivamente faturado por contrato.</AlertDescription></Alert>
    {consulta.isLoading && <p role="status">Carregando entregas…</p>}
    {consulta.error && <Alert variant="destructive"><AlertTitle>Não foi possível carregar as entregas</AlertTitle><AlertDescription>{consulta.error.message}</AlertDescription></Alert>}
    {dados && <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        ['Pedidos recebidos', dados.resumo.recebidos],
        ['Despachos pelos Correios', dados.resumo.correios],
        ['Despachos por supervisores', dados.resumo.supervisores],
        ['Frete estimado', formatarMoeda(dados.resumo.frete_estimado)],
      ].map(([titulo, valor]) => <div key={titulo} className="rounded-xl border bg-white p-4 shadow-sm"><dt className="text-sm text-muted-foreground">{titulo}</dt><dd className="mt-2 text-2xl font-bold text-blue-950">{valor}</dd></div>)}
    </dl>}
    {dados && <div className="overflow-x-auto rounded-lg border bg-white"><Table>
      <TableHeader><TableRow>{['Contrato', 'Recebidos', 'Admissão', 'Reposição', 'Motivo não informado', 'Despachados', 'Correios', 'Supervisores', 'Modalidade não informada', 'Correios sem cotação', 'Frete estimado'].map(t => <TableHead key={t}>{t}</TableHead>)}</TableRow></TableHeader>
      <TableBody>
        <TableRow className="font-bold"><TableCell>Total do mês</TableCell>{valores(dados.resumo).map((v,i) => <TableCell key={i}>{v}</TableCell>)}</TableRow>
        {dados.contratos.map((l,i) => <TableRow key={`${l.contrato_id}-${i}`}><TableCell>{l.contrato}</TableCell>{valores(l).map((v,j) => <TableCell key={j}>{v}</TableCell>)}</TableRow>)}
        {!dados.contratos.length && <TableRow><TableCell colSpan={11}>Nenhum pedido recebido ou despachado neste recorte.</TableCell></TableRow>}
      </TableBody>
    </Table></div>}
  </div>;
}
