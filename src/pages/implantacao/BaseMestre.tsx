// BASE MESTRE — INÍCIO DE CONTRATO (SIS-2026-0599), mockup
// "Base mestrre cadastro de contrato resumo.png".
//
// É a ÚNICA das seis telas que escreve. As quatro setoriais e o hub só leem
// o que é cadastrado aqui. Tela nova, separada do checklist de Implantação
// de propósito: o SIS-2026-0618 está mexendo naquele arquivo agora.
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Database, Upload, Plus, FileSpreadsheet, CheckCircle2, Clock3, AlertCircle, FileText, RefreshCw, Eye, Trash2,
} from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SemAcesso } from "@/components/layout/SemAcesso";
import { PageHeader } from "@/components/layout/PageHeader";
import { CartaoIndicador, CabecalhoTabela, EstadoVazio } from "@/components/suprimentos/dashboard/PainelBase";
import { BotaoExportar } from "@/components/implantacao/SetorShell";
import {
  useBasesCadastradas, useContratosDaBase, useAtualizarDaBase, useImportarPlanilha, brl, num,
} from "@/hooks/useImplantacaoBase";
import { lerPlanilhaOperacional, lerPlanilhaFinanceira } from "@/lib/implantacao/importarPlanilha";
import { exportarCsv } from "@/lib/implantacao/exportarBase";
import { toast } from "@/hooks/use-toast";

export default function BaseMestre() {
  return (
    <AcessoGate menu="implantacao.base" acao="visualizar" fallback={<SemAcesso />}>
      <Conteudo />
    </AcessoGate>
  );
}

function Conteudo() {
  const navegar = useNavigate();
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("todas");
  const [importando, setImportando] = useState(false);

  const { data: bases = [], isLoading } = useBasesCadastradas();
  const { data: contratos = [] } = useContratosDaBase();
  const atualizar = useAtualizarDaBase();

  const filtradas = useMemo(
    () =>
      bases.filter(
        (b) =>
          (situacao === "todas" || b.situacao === situacao) &&
          (!busca || `${b.contratos?.nome ?? ""} ${b.contratos?.cliente ?? ""}`.toLowerCase().includes(busca.toLowerCase())),
      ),
    [bases, busca, situacao],
  );

  const prontos = bases.filter((b) => b.situacao === "pronto").length;
  const rascunhos = bases.filter((b) => b.situacao === "rascunho").length;
  const semSincronia = bases.filter((b) => !b.sincronizado_em).length;
  const semValor = bases.filter((b) => !b.valor_mensal).length;

  return (
    <div className="mx-auto w-full max-w-[1600px] p-4 lg:p-6">
      <PageHeader
        title="Base Mestre - Início de Contrato"
        subtitle="Cadastro e controle das informações necessárias para o início de contrato."
        breadcrumb={["Cadastros", "Base Mestre - Início de Contrato"]}
        module="Licitações"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportando(true)}>
              <Upload className="mr-1.5 h-4 w-4" /> Importar Planilha
            </Button>
            <BotaoExportar
              onClick={() =>
                exportarCsv(
                  "base-mestre-inicio-contrato",
                  filtradas.map((b) => ({
                    contrato: b.contratos?.nome ?? "",
                    cliente: b.contratos?.cliente ?? "",
                    postos: b.qt_postos,
                    colaboradores: b.qt_colaboradores,
                    valor_mensal: b.valor_mensal ?? 0,
                    situacao: b.situacao,
                  })),
                )
              }
            />
            <Button size="sm" className="bg-slate-900 text-white hover:bg-slate-800" onClick={() => setImportando(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Novo Registro
            </Button>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <CartaoIndicador titulo="Contratos cadastrados" valor={num(bases.length)} icone={<Database className="h-5 w-5" />} tom="blue" />
        <CartaoIndicador titulo="Prontos para início" valor={num(prontos)} detalhe={bases.length ? `${((100 * prontos) / bases.length).toFixed(1)}% do total` : undefined} icone={<CheckCircle2 className="h-5 w-5" />} tom="green" />
        <CartaoIndicador titulo="Em andamento" valor={num(rascunhos)} icone={<Clock3 className="h-5 w-5" />} tom="amber" />
        <CartaoIndicador titulo="Pendências críticas" valor={num(semValor)} detalhe="Sem valor mensal na base" icone={<AlertCircle className="h-5 w-5" />} tom="red" />
        <CartaoIndicador titulo="Aguardando sincronização" valor={num(semSincronia)} detalhe="Nunca atualizadas da base" icone={<FileText className="h-5 w-5" />} tom="slate" />
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Select value={situacao} onValueChange={setSituacao}>
                <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todos os Contratos</SelectItem>
                  <SelectItem value="rascunho">Em andamento</SelectItem>
                  <SelectItem value="pronto">Prontos para início</SelectItem>
                  <SelectItem value="encerrado">Encerrados</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por contrato, cliente, unidade..." className="h-9 w-full sm:w-80" />
          </div>

          {isLoading ? (
            <Skeleton className="h-48" />
          ) : !filtradas.length ? (
            <EstadoVazio texto="Nenhuma base cadastrada ainda. Use Importar Planilha para começar por um contrato." altura={180} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <CabecalhoTabela>#</CabecalhoTabela>
                    <CabecalhoTabela>Cliente</CabecalhoTabela>
                    <CabecalhoTabela>Contrato</CabecalhoTabela>
                    <CabecalhoTabela>Data Início</CabecalhoTabela>
                    <CabecalhoTabela alinhar="center">Status</CabecalhoTabela>
                    <CabecalhoTabela alinhar="right">Postos Orçados</CabecalhoTabela>
                    <CabecalhoTabela alinhar="right">Postos Confirmados</CabecalhoTabela>
                    <CabecalhoTabela alinhar="right">Custo Mensal (R$)</CabecalhoTabela>
                    <CabecalhoTabela alinhar="center">Ações</CabecalhoTabela>
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map((b, i) => (
                    <tr key={b.id} className="border-b last:border-0 hover:bg-slate-50/60">
                      <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                      <td className="px-3 py-2">{b.contratos?.cliente ?? "—"}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{b.contratos?.nome ?? "—"}</td>
                      <td className="px-3 py-2">{b.contratos?.data_inicio ? new Date(b.contratos.data_inicio).toLocaleDateString("pt-BR") : "—"}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge variant="outline" className={b.situacao === "pronto" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}>
                          {b.situacao === "pronto" ? "Pronto" : b.situacao === "encerrado" ? "Encerrado" : "Em andamento"}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(b.contratos?.quant_func_estipulado ?? 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(b.qt_postos)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{brl(b.valor_mensal)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver resumo no hub" onClick={() => navegar(`/app/licitacoes/implantacao/base/hub?contrato=${b.contrato_id}`)}>
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7" title="Atualizar da base"
                            disabled={atualizar.isPending}
                            onClick={() => atualizar.mutate(b.contrato_id)}
                          >
                            <RefreshCw className={`h-4 w-4 ${atualizar.isPending ? "animate-spin" : ""}`} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <DialogImportar aberto={importando} aoFechar={() => setImportando(false)} contratos={contratos} />
    </div>
  );
}

function DialogImportar({
  aberto, aoFechar, contratos,
}: {
  aberto: boolean;
  aoFechar: () => void;
  contratos: { id: string; nome: string }[];
}) {
  const [contratoId, setContratoId] = useState("");
  const [previa, setPrevia] = useState<{ postos: number; locais: number; itens: number; avisos: string[] } | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown[]> | null>(null);
  const importar = useImportarPlanilha();
  const atualizar = useAtualizarDaBase();

  async function aoEscolherArquivo(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    try {
      const acumulado: { postos: unknown[]; locais: unknown[]; itens: unknown[] } = { postos: [], locais: [], itens: [] };
      const avisos: string[] = [];

      for (const arquivo of Array.from(arquivos)) {
        const bytes = new Uint8Array(await arquivo.arrayBuffer());
        const op = lerPlanilhaOperacional(bytes);
        // Planilha do Financeiro: não tem as abas da operacional, só o resumo.
        if (!op.postos.length && !op.locais.length && !op.itens.length) {
          const fin = lerPlanilhaFinanceira(bytes);
          avisos.push(...fin.avisos);
          acumulado.postos.push(
            ...fin.postos.map((p) => ({ tipo_servico: p.posto, valor_posto: p.valor_posto, qt_postos: p.qt_postos, qt_funcionarios: p.qt_postos })),
          );
          continue;
        }
        acumulado.postos.push(...op.postos);
        acumulado.locais.push(...op.locais);
        acumulado.itens.push(...op.itens);
        avisos.push(...op.avisos);
      }

      setPayload(acumulado);
      setPrevia({ postos: acumulado.postos.length, locais: acumulado.locais.length, itens: acumulado.itens.length, avisos });
    } catch (e) {
      toast({ title: "Não deu para ler a planilha", description: (e as Error).message, variant: "destructive" });
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar planilha de início de contrato</DialogTitle>
          <DialogDescription>
            Aceita as duas planilhas do chamado de uma vez: a de RH/Operacional/Compras e a do Financeiro. Nada é
            gravado antes de você conferir a prévia.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Contrato</label>
            <Select value={contratoId} onValueChange={setContratoId}>
              <SelectTrigger><SelectValue placeholder="Selecione o contrato" /></SelectTrigger>
              <SelectContent>
                {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-600">Planilhas (.xlsx)</label>
            <Input type="file" accept=".xlsx,.xls" multiple onChange={(e) => aoEscolherArquivo(e.target.files)} />
          </div>

          {previa && (
            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <p className="mb-1 flex items-center gap-2 font-semibold text-slate-800">
                <FileSpreadsheet className="h-4 w-4" /> Prévia do que será importado
              </p>
              <ul className="ml-6 list-disc text-slate-600">
                <li>{previa.postos} posto(s)</li>
                <li>{previa.locais} local(is) de trabalho</li>
                <li>{previa.itens} item(ns) de uniforme, EPI e material</li>
              </ul>
              {previa.avisos.length > 0 && (
                <p className="mt-2 text-xs text-amber-700">{previa.avisos.join(" · ")}</p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Item que não existir no catálogo é criado aguardando aprovação do Suprimentos — nada entra aprovado por fora.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={aoFechar}>Cancelar</Button>
            <Button
              variant="outline"
              disabled={!contratoId || atualizar.isPending}
              onClick={() => atualizar.mutate(contratoId)}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" /> Só puxar do ERP
            </Button>
            <Button
              className="bg-slate-900 text-white hover:bg-slate-800"
              disabled={!contratoId || !payload || importar.isPending}
              onClick={() =>
                payload &&
                importar.mutate({ contratoId, payload }, { onSuccess: () => { setPrevia(null); setPayload(null); aoFechar(); } })
              }
            >
              <Upload className="mr-1.5 h-4 w-4" /> Importar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
