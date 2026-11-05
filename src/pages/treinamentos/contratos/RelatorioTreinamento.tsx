import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useDadosTreinamentos, useTreinamentoContrato, useUrlsArquivos } from "@/hooks/useTreinamentosContrato";
import { siglaEmpresa } from "@/lib/treinamentos/contratoTreinamento";
import { abrirHtml, htmlRelatorioTreinamento } from "./componentes";

// Relatório consolidado de UM treinamento: dados + participantes + presença +
// fotos + avaliação + satisfação num documento só. A prévia e a impressão
// usam o MESMO HTML (htmlRelatorioTreinamento); "Salvar em PDF" é o do
// próprio diálogo de impressão do navegador.
export default function RelatorioTreinamento() {
  const id = Number(useParams().id);
  const { user } = useAuth();
  const trein = useTreinamentoContrato(id);
  const dados = useDadosTreinamentos([id]);
  const fotos = useMemo(() => (dados.data?.arquivos ?? []).filter((a) => a.tipo === "foto"), [dados.data]);
  const urls = useUrlsArquivos(fotos);

  const pronto = trein.data && dados.data && (fotos.length === 0 || urls.data);
  const html = useMemo(() => (pronto ? htmlRelatorioTreinamento({
    t: trein.data!, ...dados.data!, urls: urls.data ?? {}, geradoPor: user?.email,
  }) : ""), [pronto, trein.data, dados.data, urls.data, user?.email]);

  if (trein.isLoading || dados.isLoading) return <div className="flex items-center justify-center p-16 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Montando o relatório…</div>;
  if (!trein.data) return <div className="p-10 text-center text-muted-foreground">Treinamento não encontrado.</div>;
  const t = trein.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Relatório do treinamento" module="Treinamentos"
        breadcrumb={["Treinamentos por Contrato", siglaEmpresa(t.empresa), t.contrato_nome, t.nome, "Relatório"]}
        subtitle={t.nome}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to={`/app/treinamentos/contratos/treinamento/${t.id}`}><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
            <Button onClick={() => abrirHtml(html)} disabled={!html}><Printer className="mr-2 h-4 w-4" />Imprimir / Salvar PDF</Button>
          </div>
        } />
      {html
        ? <iframe title="Relatório" srcDoc={html} className="h-[75vh] w-full rounded-xl border bg-white" />
        : <div className="flex items-center justify-center p-16 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando fotos…</div>}
    </div>
  );
}
