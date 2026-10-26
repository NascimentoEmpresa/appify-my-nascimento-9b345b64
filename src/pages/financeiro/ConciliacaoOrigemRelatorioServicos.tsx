import { useMemo, useState } from "react";
import { FileDown, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNfsEmissao, type NfEmissaoRow } from "@/hooks/useNfEmissao";
import { formatBRL } from "@/hooks/usePlanilhaCusto";
import { foraDoRelatorio, naoContabilizaKpi, statusDaNota, type StatusNota } from "@/pages/financeiro/nf-emissao/shared";
import { BarraEquacao, KpisConciliacao, OrigemBadge, Paginacao, ResumoBaseCard, dia, mesAno } from "./conciliacao-origem/componentes";
import { FiltroData, FiltroSelect, opcoesUnicas } from "./conciliacao-origem/filtros";
import { conciliar, origemDaNf, type Leitura } from "./conciliacao-origem/regras";

// SIS-2026-0658: Conciliação da origem do Relatório de Serviços — total = NFs criadas no ERP (Sistema) + NFs que
// subiram da planilha Excel antiga. Só leitura: usa as mesmas NFs do Relatório de Serviços (concluídas, fora da lixeira).
const PAGE_SIZE = 50;

const ROTULO_STATUS: Record<StatusNota, string> = { pendente: "Pendente", pago: "Pago", substituida: "Substituída", cancelada: "Cancelada" };

const LEITURA: Leitura<NfEmissaoRow> = {
  origem: (n) => origemDaNf(n),
  valor: (n) => Number(n.vlr_liquido_total) || 0,
  data: (n) => n.data_emissao,
  // Cancelada/substituída aparece na lista mas não entra nos valores (mesma regra dos KPIs do Relatório de Serviços).
  contabiliza: (n) => !naoContabilizaKpi(n),
};

export default function ConciliacaoOrigemRelatorioServicos() {
  const { data: todas = [], isLoading } = useNfsEmissao(null, { todasEmpresas: true });
  // Mesma base do Relatório de Serviços: rascunho/enviada ainda não validada fica de fora.
  const nfs = useMemo(() => todas.filter((n) => !foraDoRelatorio(n)), [todas]);

  const [emissaoDe, setEmissaoDe] = useState("");
  const [emissaoAte, setEmissaoAte] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [cliente, setCliente] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [origem, setOrigem] = useState("");
  const [situacao, setSituacao] = useState("");
  const [pagina, setPagina] = useState(1);

  const temFiltro = !!(emissaoDe || emissaoAte || empresaId || cliente || contratoId || competencia || origem || situacao);
  const limpar = () => { setEmissaoDe(""); setEmissaoAte(""); setEmpresaId(""); setCliente(""); setContratoId(""); setCompetencia(""); setOrigem(""); setSituacao(""); setPagina(1); };

  const filtradas = useMemo(
    () => nfs.filter((n) => {
      if (emissaoDe && (!n.data_emissao || n.data_emissao < emissaoDe)) return false;
      if (emissaoAte && (!n.data_emissao || n.data_emissao > emissaoAte)) return false;
      if (empresaId && n.empresa_id !== empresaId) return false;
      if (cliente && n.contrato?.cliente !== cliente) return false;
      if (contratoId && n.contrato_id !== contratoId) return false;
      if (competencia && n.competencia?.slice(0, 7) !== competencia) return false;
      if (origem && origemDaNf(n) !== origem) return false;
      if (situacao && statusDaNota(n) !== situacao) return false;
      return true;
    }),
    [nfs, emissaoDe, emissaoAte, empresaId, cliente, contratoId, competencia, origem, situacao],
  );

  const conc = useMemo(() => conciliar(filtradas, LEITURA), [filtradas]);
  const naoContabilizadas = useMemo(() => filtradas.filter((n) => naoContabilizaKpi(n)).length, [filtradas]);

  const empresas = useMemo(() => opcoesUnicas(nfs, (n) => n.empresa_id, (n) => n.empresa?.nome_fantasia ?? n.empresa?.razao_social), [nfs]);
  const contratos = useMemo(() => opcoesUnicas(nfs, (n) => n.contrato_id, (n) => n.contrato?.nome), [nfs]);
  const clientes = useMemo(
    () => Array.from(new Set(nfs.map((n) => n.contrato?.cliente).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "pt-BR")).map((c) => ({ value: c, label: c })),
    [nfs],
  );
  const competencias = useMemo(
    () => Array.from(new Set(nfs.map((n) => n.competencia?.slice(0, 7)).filter(Boolean) as string[])).sort().reverse().map((c) => ({ value: c, label: `${c.slice(5, 7)}/${c.slice(0, 4)}` })),
    [nfs],
  );

  const paginas = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  const atual = Math.min(pagina, paginas);
  const pageRows = filtradas.slice((atual - 1) * PAGE_SIZE, atual * PAGE_SIZE);

  function exportar() {
    if (filtradas.length === 0) { toast.error("Não há notas para exportar com esses filtros."); return; }
    const detalhe = filtradas.map((n) => ({
      "Origem/Base": origemDaNf(n) === "sistema" ? "Sistema" : "Excel antigo",
      "Nº NF": n.numero_nf ?? "",
      "Data emissão": dia(n.data_emissao),
      Situação: ROTULO_STATUS[statusDaNota(n)],
      Cliente: n.contrato?.cliente ?? "",
      Descrição: n.descricao ?? "",
      Competência: mesAno(n.competencia),
      Empresa: n.empresa?.nome_fantasia ?? n.empresa?.razao_social ?? "",
      Contrato: n.contrato?.nome ?? "",
      "Valor líquido": Number(n.vlr_liquido_total) || 0,
      "Entra nos valores": naoContabilizaKpi(n) ? "Não (cancelada/substituída)" : "Sim",
    }));
    const resumo: (string | number)[][] = [
      ["Conciliação da origem do Relatório de Serviços", ""],
      ["Gerado em", new Date().toLocaleString("pt-BR")],
      ["Filtros aplicados", temFiltro ? "Sim (ver a tela)" : "Nenhum"],
      ["", ""],
      ["Total do Relatório de Serviços", conc.total.valor],
      ["Origem Sistema", conc.sistema.valor],
      ["Origem Excel antigo", conc.excel.valor],
      ["Diferença a conciliar", conc.diferenca],
      ["", ""],
      ["Notas (total / sistema / excel)", `${conc.total.qtd} / ${conc.sistema.qtd} / ${conc.excel.qtd}`],
      ["Obs.: notas canceladas/substituídas aparecem na lista mas não entram nos valores.", ""],
    ];
    import("xlsx").then((XLSX) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalhe), "Notas");
      const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
      wsResumo["!cols"] = [{ wch: 44 }, { wch: 28 }];
      XLSX.utils.book_append_sheet(wb, wsResumo, "Conciliação");
      XLSX.writeFile(wb, `Conciliacao_Origem_Relatorio_de_Servicos_${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Conciliação da Origem do Relatório de Serviços"
        subtitle="Concilie a composição do valor total do Relatório de Serviços entre as notas do sistema e a base histórica importada do Excel, com rastreabilidade nota a nota."
        module="Financeiro"
        breadcrumb={["Financeiro", "Relatório de Serviços", "Conciliação da Origem"]}
        actions={
          <Button variant="outline" size="sm" className="gap-1.5" onClick={exportar} disabled={isLoading}>
            <FileDown className="h-3.5 w-3.5" /> Exportar Excel
          </Button>
        }
      />

      <KpisConciliacao rotuloTotal="Total do Relatório de Serviços" total={conc.total.valor} sistema={conc.sistema.valor} excel={conc.excel.valor} diferenca={conc.diferenca} />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Filtros</h3>
            {temFiltro && <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={limpar}><X className="h-3.5 w-3.5" />Limpar filtros</Button>}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <FiltroData rotulo="Emissão de" valor={emissaoDe} onChange={(v) => { setEmissaoDe(v); setPagina(1); }} />
            <FiltroData rotulo="Emissão até" valor={emissaoAte} onChange={(v) => { setEmissaoAte(v); setPagina(1); }} />
            <FiltroSelect rotulo="Empresa" valor={empresaId} onChange={(v) => { setEmpresaId(v); setPagina(1); }} opcoes={empresas} />
            <FiltroSelect rotulo="Cliente" valor={cliente} onChange={(v) => { setCliente(v); setPagina(1); }} opcoes={clientes} />
            <FiltroSelect rotulo="Contrato" valor={contratoId} onChange={(v) => { setContratoId(v); setPagina(1); }} opcoes={contratos} />
            <FiltroSelect rotulo="Competência" valor={competencia} onChange={(v) => { setCompetencia(v); setPagina(1); }} opcoes={competencias} />
            <FiltroSelect rotulo="Origem" valor={origem} onChange={(v) => { setOrigem(v); setPagina(1); }} opcoes={[{ value: "sistema", label: "Sistema" }, { value: "excel", label: "Excel antigo" }]} />
            <FiltroSelect rotulo="Situação da nota" valor={situacao} onChange={(v) => { setSituacao(v); setPagina(1); }} opcoes={(Object.keys(ROTULO_STATUS) as StatusNota[]).map((s) => ({ value: s, label: ROTULO_STATUS[s] }))} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <ResumoBaseCard titulo="Resumo da base do Sistema" origem="sistema" resumo={conc.sistema} quantidadeRotulo="Quantidade de notas" />
        <ResumoBaseCard titulo="Resumo da base do Excel antigo" origem="excel" resumo={conc.excel} quantidadeRotulo="Quantidade de notas" />
      </div>

      <BarraEquacao rotuloTotal="Total do Relatório de Serviços" total={conc.total.valor} sistema={conc.sistema.valor} excel={conc.excel.valor} diferenca={conc.diferenca} />
      {naoContabilizadas > 0 && (
        <p className="text-xs text-muted-foreground">
          {naoContabilizadas.toLocaleString("pt-BR")} nota(s) cancelada(s)/substituída(s) aparecem na lista e na quantidade, mas não entram nos valores (mesma regra do Relatório de Serviços).
        </p>
      )}

      <Card>
        <CardContent className="space-y-3 p-4">
          <div>
            <h3 className="text-sm font-semibold">Conciliação das notas</h3>
            <p className="text-xs text-muted-foreground">Cada nota do Relatório de Serviços com a sua origem (respeita os filtros acima).</p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origem/Base</TableHead>
                  <TableHead>Nº NF</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Competência</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Contrato</TableHead>
                  <TableHead className="text-right">Valor líquido (R$)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
                {!isLoading && pageRows.length === 0 && <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">Nenhuma nota.</TableCell></TableRow>}
                {pageRows.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell><OrigemBadge origem={origemDaNf(n)} /></TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{n.numero_nf ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{dia(n.data_emissao)}</TableCell>
                    <TableCell><Badge variant="outline">{ROTULO_STATUS[statusDaNota(n)]}</Badge></TableCell>
                    <TableCell className="max-w-[220px] truncate" title={n.contrato?.cliente ?? ""}>{n.contrato?.cliente ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate" title={n.descricao ?? ""}>{n.descricao ?? "—"}</TableCell>
                    <TableCell>{mesAno(n.competencia)}</TableCell>
                    <TableCell>{n.empresa?.nome_fantasia ?? n.empresa?.razao_social ?? "—"}</TableCell>
                    <TableCell>{n.contrato?.nome ?? "—"}</TableCell>
                    <TableCell className={`whitespace-nowrap text-right font-medium ${naoContabilizaKpi(n) ? "text-muted-foreground line-through" : ""}`}>{formatBRL(Number(n.vlr_liquido_total) || 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Paginacao pagina={pagina} total={filtradas.length} tamanho={PAGE_SIZE} onChange={setPagina} />
        </CardContent>
      </Card>
    </div>
  );
}
