import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AcessoGate } from "@/components/auth/AcessoGate";
import {
  JobExtratorBeneficios,
  TomadorBeneficio,
  useBaixarResultadoExtrator,
  useJobsExtratorBeneficios,
  useUploadJobExtrator,
} from "@/hooks/useExtratorBeneficios";

// SIS-2026-0427: migração do "Extrator/Gerador de Planilha VA e VT" (app
// Python desktop da Ana) pro ERP — mesmos 4 tomadores da tela original
// (UFRGS/SAMU/SMS/TJ; "Jardinagem" é o mesmo contexto/contrato da UFRGS,
// não é tomador separado). Upload sobe pro Storage, o worker/ processa
// (leitura de PDF/Excel, decodificação da fonte da TRI sem OCR) e grava o
// resultado no job — esta tela só sobe arquivo e baixa o resultado.

const MENU_CODIGO = "financeiro-extrator-beneficios";

const TOMADOR_LABEL: Record<TomadorBeneficio, string> = {
  ufrgs: "UFRGS",
  samu: "SAMU",
  sms: "PREF POA SMS",
  tj: "Tribunal de Justiça (TJ)",
};

const STATUS_LABEL: Record<JobExtratorBeneficios["status"], string> = {
  pendente: "Na fila",
  processando: "Processando",
  concluido: "Concluído",
  erro: "Erro",
};

const STATUS_BADGE: Record<JobExtratorBeneficios["status"], string> = {
  pendente: "bg-muted text-muted-foreground",
  processando: "bg-amber-500",
  concluido: "bg-emerald-500",
  erro: "bg-destructive",
};

export default function ExtratorBeneficios() {
  const { data: jobs = [], isLoading } = useJobsExtratorBeneficios();
  const upload = useUploadJobExtrator();
  const baixar = useBaixarResultadoExtrator();

  const [tomador, setTomador] = useState<TomadorBeneficio>("tj");
  const [tipoBeneficio, setTipoBeneficio] = useState<"VA" | "VT">("VA");
  const [valorUnitario, setValorUnitario] = useState("25.42");
  const [periodo, setPeriodo] = useState("");
  const [arquivos, setArquivos] = useState<Record<string, File | null>>({});
  // <input type="file"> não é controlável via props do React — limpar
  // `arquivos` no state não limpa o nome do arquivo que o navegador continua
  // mostrando no input. Isso enganava o usuário: trocar de Tomador (ou
  // enviar com sucesso) parecia manter os arquivos escolhidos na tela, mas
  // o estado interno já tinha zerado, e o "Gerar Planilha" acusava campo
  // vazio mesmo com o nome do arquivo visível. Incrementar essa key força o
  // React a remontar os inputs de arquivo, que aí sim voltam a ficar vazios
  // de verdade.
  const [geracaoFormulario, setGeracaoFormulario] = useState(0);

  function setArquivo(chave: string, file: File | null) {
    setArquivos((prev) => ({ ...prev, [chave]: file }));
  }

  function limparFormulario() {
    setArquivos({});
    setPeriodo("");
    setGeracaoFormulario((g) => g + 1);
  }

  async function enviar() {
    try {
      const arquivosSelecionados: Record<string, File> = {};
      for (const [chave, file] of Object.entries(arquivos)) {
        if (file) arquivosSelecionados[chave] = file;
      }

      let parametros: Record<string, unknown> = {};
      if (tomador === "tj") {
        if (!arquivosSelecionados.base || !arquivosSelecionados.pdf) {
          return toast.warning("Selecione a Base de Funcionários e o PDF do Benefício.");
        }
        parametros = { tipoBeneficio, periodo, valorUnitario: parseFloat(valorUnitario) };
      } else if (tomador === "samu" || tomador === "sms") {
        if (!arquivosSelecionados.base || !arquivosSelecionados.ponto) {
          return toast.warning("Selecione a Base de Funcionários e o PDF do Ponto.");
        }
        parametros = { tipoBeneficio, valorUnitario24h: parseFloat(valorUnitario) };
      } else if (tomador === "ufrgs") {
        if (!arquivosSelecionados.base || !arquivosSelecionados.va || !arquivosSelecionados.vt) {
          return toast.warning("Selecione a Base de Funcionários e os PDFs de Alimentação e Transporte.");
        }
      }

      await upload.mutateAsync({ tomador, parametros, arquivos: arquivosSelecionados });
      toast.success("Enviado! A planilha aparece na lista abaixo quando terminar de processar.");
      limparFormulario();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao enviar.");
    }
  }

  async function baixarResultado(job: JobExtratorBeneficios) {
    if (!job.arquivo_saida_path) return;
    try {
      const url = await baixar.mutateAsync(job.arquivo_saida_path);
      window.open(url, "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao baixar planilha.");
    }
  }

  return (
    <AcessoGate menu={MENU_CODIGO} acao="visualizar" fallback={<div className="p-6 text-sm text-muted-foreground">Sem acesso a esta tela.</div>}>
      <PageHeader
        title="Extrator de Benefícios (VA/VT)"
        subtitle="Gera a planilha de Vale-Alimentação/Transporte a partir da base de funcionários e do PDF da operadora, por tomador."
        module="Financeiro"
        breadcrumb={["Gestão Financeira", "Extrator de Benefícios"]}
      />

      <AcessoGate menu={MENU_CODIGO} acao="incluir">
        <Card className="mb-6">
          <CardContent className="grid gap-4 p-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Tomador</Label>
                <Select value={tomador} onValueChange={(v) => { setTomador(v as TomadorBeneficio); limparFormulario(); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(TOMADOR_LABEL).map(([valor, label]) => (
                      <SelectItem key={valor} value={valor}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {tomador !== "ufrgs" && (
                <div>
                  <Label>Tipo de Benefício</Label>
                  <Select value={tipoBeneficio} onValueChange={(v) => setTipoBeneficio(v as "VA" | "VT")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VA">VA — Alimentação</SelectItem>
                      <SelectItem value="VT">VT — Transporte</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(tomador === "tj" || tomador === "samu" || tomador === "sms") && (
                <div>
                  <Label>Valor Unitário {tomador === "tj" ? "" : "(24h) "}R$</Label>
                  <Input value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)} />
                </div>
              )}
            </div>

            {tomador === "tj" && (
              <div>
                <Label>Período da Planilha (ex.: 01/11/2025 a 30/11/2025)</Label>
                <Input value={periodo} onChange={(e) => setPeriodo(e.target.value)} placeholder="dd/mm/aaaa a dd/mm/aaaa" />
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Base de Funcionários (Excel)</Label>
                <Input key={`base-${geracaoFormulario}`} type="file" accept=".xlsx,.xls" onChange={(e) => setArquivo("base", e.target.files?.[0] ?? null)} />
              </div>

              {tomador === "ufrgs" && (
                <>
                  <div>
                    <Label>PDF — Alimentação (VA)</Label>
                    <Input key={`va-${geracaoFormulario}`} type="file" accept=".pdf" onChange={(e) => setArquivo("va", e.target.files?.[0] ?? null)} />
                  </div>
                  <div>
                    <Label>PDF — Transporte (VT)</Label>
                    <Input key={`vt-${geracaoFormulario}`} type="file" accept=".pdf" onChange={(e) => setArquivo("vt", e.target.files?.[0] ?? null)} />
                  </div>
                </>
              )}

              {tomador === "tj" && (
                <div>
                  <Label>PDF do Benefício</Label>
                  <Input key={`pdf-${geracaoFormulario}`} type="file" accept=".pdf" onChange={(e) => setArquivo("pdf", e.target.files?.[0] ?? null)} />
                </div>
              )}

              {(tomador === "samu" || tomador === "sms") && (
                <div>
                  <Label>PDF do Ponto (Sênior)</Label>
                  <Input key={`ponto-${geracaoFormulario}`} type="file" accept=".pdf" onChange={(e) => setArquivo("ponto", e.target.files?.[0] ?? null)} />
                </div>
              )}
            </div>

            <div>
              <Button onClick={enviar} disabled={upload.isPending}>
                {upload.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
                Gerar Planilha
              </Button>
            </div>
          </CardContent>
        </Card>
      </AcessoGate>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tomador</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enviado em</TableHead>
                <TableHead>Erro</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
              )}
              {!isLoading && jobs.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum job ainda.</TableCell></TableRow>
              )}
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>{TOMADOR_LABEL[job.tomador]}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_BADGE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
                  </TableCell>
                  <TableCell>{new Date(job.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{job.mensagem_erro}</TableCell>
                  <TableCell className="text-right">
                    {job.status === "concluido" && job.arquivo_saida_path && (
                      <Button size="sm" variant="outline" onClick={() => baixarResultado(job)}>
                        <Download className="mr-2 h-4 w-4" /> Baixar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AcessoGate>
  );
}
