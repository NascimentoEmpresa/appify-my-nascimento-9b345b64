import { useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet } from "lucide-react";
import { useBuscarRelatorioDespesasMalote, LinhaRelatorioDespesaMalote, STATUS_LABEL } from "@/hooks/useMaloteDespesa";
import { ORIGEM_LABEL } from "./meusItensUtils";

// [SEM-CHAMADO] (Ruan, financeiro): relatório de TODAS as despesas do
// Malote pra exportar quando quiser, sem precisar abrir Meus Itens (que é
// recortado por criador/setor). Gatilho por botão, não carrega nada até o
// usuário clicar — pode ser um volume grande de linhas.

function formatarData(data: string | null | undefined): string {
  if (!data) return "";
  const [ano, mes, dia] = data.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : "";
}

function formatarDataHora(data: string | null | undefined): string {
  if (!data) return "";
  const valor = new Date(data);
  if (Number.isNaN(valor.getTime())) return "";
  const preencher = (numero: number) => String(numero).padStart(2, "0");
  return `${preencher(valor.getDate())}/${preencher(valor.getMonth() + 1)}/${valor.getFullYear()} ${preencher(valor.getHours())}:${preencher(valor.getMinutes())}`;
}

const CABECALHOS = [
  "Nº / ID",
  "Tipo",
  "Status",
  "Nome da despesa",
  "Empresa",
  "Classificação",
  "Contrato",
  "Linha do rateio",
  "Fornecedor (rateio)",
  "Integrante (rateio)",
  "Valor da linha (R$)",
  "Valor total (R$)",
  "Valor aprovado (R$)",
  "Forma de pagamento",
  "Banco",
  "Data de pagamento",
  "Competência",
  "Parcelado",
  "Nº parcelas",
  "Nível de aprovação atual",
  "Exceção",
  "Justificativa da exceção",
  "Motivo do ajuste",
  "Pago em",
  "Pago por",
  "Conferido em",
  "Conferido por",
  "Criado em",
  "Criado por",
  "Última atualização",
];

function montarLinhas(linhas: LinhaRelatorioDespesaMalote[]): Record<string, string | number>[] {
  return linhas.map((l) => ({
    "Nº / ID": l.numero ?? "",
    "Tipo": ORIGEM_LABEL[l.origem] ?? l.origem,
    "Status": STATUS_LABEL[l.status] ?? l.status,
    "Nome da despesa": l.nome ?? "",
    "Empresa": l.empresa ?? "",
    "Classificação": l.classificacao ?? "",
    "Contrato": l.contrato ?? "",
    "Linha do rateio": l.rateio_ordem != null ? l.rateio_ordem + 1 : "",
    "Fornecedor (rateio)": l.rateio_fornecedor ?? "",
    "Integrante (rateio)": l.rateio_integrante ?? "",
    "Valor da linha (R$)": l.rateio_valor != null ? Number(l.rateio_valor) : "",
    "Valor total (R$)": Number(l.valor_total) || 0,
    "Valor aprovado (R$)": l.valor_aprovado != null ? Number(l.valor_aprovado) : "",
    "Forma de pagamento": l.forma_pagamento ?? "",
    "Banco": l.banco ?? "",
    "Data de pagamento": formatarData(l.data_pagamento),
    "Competência": formatarData(l.competencia),
    "Parcelado": l.parcelado ? "Sim" : "Não",
    "Nº parcelas": l.numero_parcelas ?? "",
    "Nível de aprovação atual": l.nivel_aprovacao_atual ?? "",
    "Exceção": l.excecao ? "Sim" : "Não",
    "Justificativa da exceção": l.justificativa_excecao ?? "",
    "Motivo do ajuste": l.motivo_ajuste ?? "",
    "Pago em": formatarDataHora(l.pago_em),
    "Pago por": l.pago_por ?? "",
    "Conferido em": formatarDataHora(l.conferido_em),
    "Conferido por": l.conferido_por ?? "",
    "Criado em": formatarDataHora(l.created_at),
    "Criado por": l.criado_por ?? "",
    "Última atualização": formatarDataHora(l.updated_at),
  }));
}

function nomeArquivo(data = new Date()): string {
  const preencher = (numero: number) => String(numero).padStart(2, "0");
  return `relatorio-despesas-malote-${data.getFullYear()}-${preencher(data.getMonth() + 1)}-${preencher(data.getDate())}.xlsx`;
}

export function RelatorioDespesasMaloteTab() {
  const buscar = useBuscarRelatorioDespesasMalote();
  const [ultimaExportacao, setUltimaExportacao] = useState<{ total: number; em: Date } | null>(null);

  async function exportar() {
    try {
      const dados = await buscar.mutateAsync();
      const linhas = montarLinhas(dados);
      const ws = linhas.length > 0 ? XLSX.utils.json_to_sheet(linhas) : XLSX.utils.aoa_to_sheet([CABECALHOS]);
      if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Despesas Malote");
      XLSX.writeFile(wb, nomeArquivo());
      setUltimaExportacao({ total: dados.length, em: new Date() });
      toast.success(`Planilha exportada com ${dados.length} despesa(s).`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao exportar o relatório.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-2">
          <FileSpreadsheet className="h-4 w-4 mt-0.5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Relatório de Despesas do Malote</CardTitle>
            <CardDescription>
              Exporta todas as despesas já lançadas no Malote, de todas as empresas e setores, até o momento do
              download — não é recortado por quem está exportando (diferente de "Meus Itens").
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={exportar} disabled={buscar.isPending}>
          <Download className="h-4 w-4 mr-2" />
          {buscar.isPending ? "Gerando planilha..." : "Exportar todas as despesas"}
        </Button>
        {ultimaExportacao && (
          <p className="text-xs text-muted-foreground">
            Última exportação: {ultimaExportacao.total} despesa(s), às{" "}
            {ultimaExportacao.em.toLocaleTimeString("pt-BR")}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
