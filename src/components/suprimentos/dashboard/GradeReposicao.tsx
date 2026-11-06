import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EstadoVazio, PainelGrafico } from "./PainelBase";
import type { ItemEstoqueSaudavel, PremissasEstoque } from "@/lib/suprimentos/estoqueSaudavel";

import { csvDaGradeReposicao, LINHAS_REPOSICAO, montarGradeReposicao } from "@/lib/suprimentos/gradeReposicao";
const numero = (valor: number | undefined) => valor == null ? "—" : valor.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const data = (valor: string) => new Date(`${valor}T12:00:00`).toLocaleDateString("pt-BR");

export function GradeReposicao({ itens, premissas, almoxarifadoSelecionado }: {
  itens: ItemEstoqueSaudavel[];
  premissas: PremissasEstoque;
  almoxarifadoSelecionado: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [soPendencias, setSoPendencias] = useState(true);
  const [pagina, setPagina] = useState(0);
  const grade = useMemo(() => montarGradeReposicao(itens, busca, soPendencias), [itens, busca, soPendencias]);
  const ultimaPagina = Math.max(0, Math.ceil(grade.familias.length / 10) - 1);
  const paginaAtual = Math.min(pagina, ultimaPagina);
  const familias = grade.familias.slice(paginaAtual * 10, (paginaAtual + 1) * 10);

  const exportar = () => {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csvDaGradeReposicao(grade)], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `previsao-reposicao-${premissas.janela_fim}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PainelGrafico titulo="Previsão de abastecimento por item e tamanho"
      subtitulo={`Giro dos últimos ${premissas.janela_meses} meses (${data(premissas.janela_inicio)} a ${data(premissas.janela_fim)}), incluindo o mês atual até hoje. Prazo padrão de ${premissas.lead_time_dias} dias + ${premissas.ciclo_revisao_dias} dias entre compras, com segurança para a oscilação da demanda.`}>
      <p className="mb-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-950">
        <b>Comprar para repor = alvo saudável − disponível − aguardando entrega</b>, com mínimo de zero e arredondamento para cima.
        {" "}O que já foi comprado não é pedido novamente. Solicitações do Malote aguardando compra ainda precisam ser concluídas e não são entrega confirmada; compare-as com a necessidade de reposição antes de abrir outra solicitação.
        {" "}Prazos por item e alvos aprovados manualmente continuam valendo. O giro usa a demanda dos pedidos de contratos ativos, inclusive o que faltou atender.
      </p>
      {almoxarifadoSelecionado && <p className="mb-3 text-xs text-amber-800">Disponível apenas do almoxarifado selecionado. Aguardando entrega e aguardando compra abrangem a empresa, pois esses pedidos não têm almoxarifado de destino definido.</p>}
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="busca-grade-reposicao" className="text-xs">Buscar item na previsão</Label>
          <Input id="busca-grade-reposicao" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} placeholder="Ex.: camisa, calça, moletom" className="h-8 sm:w-64" />
        </div>
        <label className="flex items-center gap-2 py-2 text-xs text-slate-700">
          <input type="checkbox" checked={soPendencias} onChange={(e) => { setSoPendencias(e.target.checked); setPagina(0); }} />
          Só com reposição, entrega ou compra pendente
        </label>
        <AcessoGate menu="sup_estoque_saudavel" acao="exportar">
          <Button variant="outline" size="sm" className="ml-auto gap-1" disabled={!grade.familias.length} onClick={exportar}><Download className="h-4 w-4" /> Exportar grade</Button>
        </AcessoGate>
      </div>
      {familias.length ? <>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" aria-label="Previsão de abastecimento por tamanho">
            <thead><tr>
              <th scope="col" className="min-w-48 border-b bg-slate-50 p-2 text-left">Descrição</th>
              <th scope="col" className="min-w-44 border-b bg-slate-50 p-2 text-left">Indicador</th>
              {grade.tamanhos.map((t) => <th scope="col" key={t ?? "unico"} className="min-w-16 border-b bg-slate-50 p-2 text-right">{t ?? "Único"}</th>)}
            </tr></thead>
            {familias.map((familia) => <tbody key={familia.id} className="border-b-2 border-slate-200">
              {LINHAS_REPOSICAO.map((linha, indice) => <tr key={linha.campo} className={linha.cor}>
                {indice === 0 && <th scope="rowgroup" rowSpan={LINHAS_REPOSICAO.length} className="max-w-64 p-2 text-left align-top font-semibold text-slate-800">{familia.nome}</th>}
                <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-medium">{linha.nome}</th>
                {grade.tamanhos.map((tamanho) => <td key={tamanho ?? "unico"} className="px-2 py-1.5 text-right tabular-nums">{numero(familia.itens.get(tamanho)?.[linha.campo])}</td>)}
              </tr>)}
            </tbody>)}
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>{grade.familias.length} itens · página {paginaAtual + 1} de {ultimaPagina + 1} · — indica tamanho sem linha no plano</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={paginaAtual === ultimaPagina} onClick={() => setPagina(paginaAtual + 1)}>Próxima</Button>
          </div>
        </div>
      </> : <EstadoVazio altura={120} texto="Nenhum item corresponde aos filtros da previsão." />}
    </PainelGrafico>
  );
}
