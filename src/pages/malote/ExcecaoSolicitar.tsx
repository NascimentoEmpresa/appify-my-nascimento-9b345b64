import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ClipboardCopy, FilePlus2, KeyRound, Send } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { useAuth } from "@/hooks/useAuth";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { uploadAnexoMalote, useContratosAtivos, useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { novoUuid } from "@/lib/utils";
import { AnexosField } from "./AnexosField";
import { useCancelarExcecao, useMinhasExcecoes, useSolicitarExcecao } from "@/hooks/useMaloteExcecao";
import {
  podeCriarDespesaDaExcecao, restanteDaSenha, STATUS_EXCECAO_BADGE, STATUS_EXCECAO_LABEL, statusExibidoExcecao, TIPO_EXCECAO_LABEL, urlCriarDespesaDaExcecao, type ExcecaoSolicitacao,
} from "./excecao/regras";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.split("T")[0].split("-").reverse().join("/");

// SIS-2026-0668 (fase 1): pedido de exceção. A despesa NÃO é criada aqui — o aprovador das exceções (diretoria financeira) aprova,
// o banco gera a senha (24 h) e ela é digitada em Criar Despesa.
export default function ExcecaoSolicitar() {
  const { user } = useAuth();
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: minhas = [] } = useMinhasExcecoes(user?.id);
  const solicitar = useSolicitarExcecao();
  const cancelar = useCancelarExcecao();
  const navigate = useNavigate();

  const [classificacaoId, setClassificacaoId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [valor, setValor] = useState("");
  const [dataPagamento, setDataPagamento] = useState("");
  const [descricao, setDescricao] = useState("");
  const [justificativa, setJustificativa] = useState("");
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviandoAnexos, setEnviandoAnexos] = useState(false);

  const hoje = useMemo(() => new Date().toLocaleDateString("sv-SE"), []);
  const classificacao = classificacoes.find((c) => c.id === classificacaoId);
  // Tipo vem da classificação (como na Criar Despesa): "contrato" pede o contrato, "administrativo" não.
  const tipo = classificacao?.tipo ?? null;
  const contratosDaEmpresa = useMemo(() => (empresaId ? contratos.filter((c) => c.empresa_id === empresaId) : contratos), [contratos, empresaId]);
  const nomeClassificacao = (id: string) => classificacoes.find((c) => c.id === id)?.nome ?? "—";

  function erroDoFormulario(): string | null {
    if (!classificacaoId) return "Selecione a classificação.";
    if (!empresaId) return "Selecione a empresa.";
    if (tipo === "contrato" && !contratoId) return "Esta classificação é de contrato: selecione o contrato.";
    if (!valor || Number(valor) <= 0) return "Informe o valor da despesa.";
    if (!dataPagamento) return "Informe a data prevista do pagamento.";
    if (dataPagamento < hoje) return "A data prevista do pagamento é anterior a hoje — não é permitido, nem como exceção.";
    if (!descricao.trim()) return "Informe o nome ou a descrição da despesa.";
    if (!justificativa.trim()) return "Explique o motivo e a necessidade da exceção.";
    return null;
  }

  async function enviar() {
    const erro = erroDoFormulario();
    if (erro) {
      toast.error(erro);
      return;
    }
    try {
      // Anexos primeiro (pasta própria da solicitação, no mesmo bucket do Malote); só então o pedido leva os caminhos.
      let caminhos: string[] = [];
      if (arquivos.length > 0) {
        setEnviandoAnexos(true);
        const pasta = `excecao/${novoUuid()}`;
        caminhos = await Promise.all(arquivos.map((f) => uploadAnexoMalote(f, pasta)));
      }
      await solicitar.mutateAsync({
        arquivos: caminhos,
        tipo: tipo ?? "administrativo",
        classificacao_id: classificacaoId,
        contrato_id: contratoId || null,
        empresa_id: empresaId,
        valor: Number(valor),
        data_pagamento: dataPagamento,
        descricao: descricao.trim(),
        justificativa: justificativa.trim(),
      });
      toast.success("Solicitação enviada ao aprovador das exceções.");
      setClassificacaoId(""); setContratoId(""); setEmpresaId(""); setValor(""); setDataPagamento(""); setDescricao(""); setJustificativa(""); setArquivos([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a solicitação.");
    } finally {
      setEnviandoAnexos(false);
    }
  }

  async function copiar(txt: string) {
    try {
      await navigator.clipboard.writeText(txt);
      toast.success("Senha copiada.");
    } catch {
      toast.error("Não foi possível copiar.");
    }
  }

  async function cancelarSolicitacao(s: ExcecaoSolicitacao) {
    try {
      await cancelar.mutateAsync(s.id);
      toast.success(`Solicitação ${s.numero} cancelada.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível cancelar.");
    }
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Solicitar Autorização de Exceção"
        subtitle="Peça a exceção antes de lançar a despesa. Após a aprovação, será gerada uma senha única para a criação da despesa."
        module="Malote"
        breadcrumb={["Autorização de Exceção", "Nova Solicitação"]}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Dados da Solicitação</CardTitle>
            <CardDescription>Informe os dados da despesa que necessita de exceção de alçada.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <Label>Classificação *</Label>
                <SearchableSelect
                  value={classificacaoId}
                  onChange={setClassificacaoId}
                  options={classificacoes.map((c) => ({ value: c.id, label: c.nome }))}
                  placeholder="Selecione a classificação"
                />
              </div>
              <div>
                <Label>Tipo da Despesa</Label>
                <Input value={tipo ? TIPO_EXCECAO_LABEL[tipo] ?? tipo : ""} placeholder="Definido pela classificação" disabled />
              </div>
              <div>
                <Label>Contrato {tipo === "contrato" ? "*" : "(se aplicável)"}</Label>
                <SearchableSelect
                  value={contratoId}
                  onChange={setContratoId}
                  options={contratosDaEmpresa.map((c) => ({ value: c.id, label: c.nome, muted: c.status !== "ativo" }))}
                  placeholder="Selecione o contrato"
                />
              </div>
              <div>
                <Label>Empresa *</Label>
                <SearchableSelect
                  value={empresaId}
                  onChange={(v) => { setEmpresaId(v); setContratoId(""); }}
                  options={empresas.map((e) => ({ value: e.id, label: e.nome }))}
                  placeholder="Selecione a empresa"
                />
              </div>
              <div>
                <Label>Valor da Despesa *</Label>
                <Input type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label>Data Prevista do Pagamento *</Label>
                <Input type="date" min={hoje} value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Descrição da Despesa *</Label>
              <Input value={descricao} onChange={(e) => setDescricao(e.target.value.slice(0, 255))} placeholder="Informe o nome ou descrição da despesa..." />
              <p className="mt-1 text-right text-xs text-muted-foreground">{descricao.length}/255</p>
            </div>
            <div>
              <Label>Justificativa para a Exceção *</Label>
              <textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value.slice(0, 1000))}
                placeholder="Explique o motivo da solicitação e a necessidade da exceção de alçada..."
                className="min-h-24 w-full rounded-md border border-input bg-background p-2 text-sm"
              />
            </div>
            <div>
              <Label>Anexos (opcional)</Label>
              <p className="mb-1 text-xs text-muted-foreground">Anexe documentos que comprovem a necessidade da despesa (orçamentos, cotações etc.).</p>
              <AnexosField arquivos={arquivos} onChange={setArquivos} disabled={solicitar.isPending || enviandoAnexos} />
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-amber-800/80 dark:text-amber-300/80">
                A exceção deve ser utilizada apenas quando realmente necessário, respeitando as regras de orçamento e aprovação. A senha vale 24 horas a partir da
                aprovação, só uma vez, só para esta data e classificação e até o valor pedido.
              </p>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void enviar()} disabled={solicitar.isPending || enviandoAnexos} className="gap-2">
                <Send className="h-4 w-4" />{solicitar.isPending || enviandoAnexos ? "Enviando…" : "Enviar Solicitação"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" />Como funciona?</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p><span className="font-semibold">1. Você solicita</span><br /><span className="text-muted-foreground">Preencha os dados da despesa que necessita de exceção.</span></p>
              <p><span className="font-semibold">2. O aprovador analisa</span><br /><span className="text-muted-foreground">Quem responde pelo caixa (e, quando liberado, o N2 da classificação) analisa e, se aprovada, é gerada uma senha única.</span></p>
              <p><span className="font-semibold">3. Use a senha</span><br /><span className="text-muted-foreground">Informe-a em Criar Despesa. Depois de usada, é desconsiderada para as próximas inclusões.</span></p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Minhas Solicitações</CardTitle>
                <Link to="/app/malote/excecao/minhas" className="text-xs text-primary hover:underline">Ver todas</Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {minhas.length === 0 && <p className="text-sm text-muted-foreground">Você ainda não fez nenhuma solicitação.</p>}
              {minhas.slice(0, 8).map((s) => {
                const st = statusExibidoExcecao(s);
                return (
                  <div key={s.id} className="space-y-1.5 rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">{s.numero}</span>
                      <Badge className={STATUS_EXCECAO_BADGE[st]} variant="secondary">{STATUS_EXCECAO_LABEL[st]}</Badge>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{brl(s.valor)}</span>
                      <span className="text-xs text-muted-foreground">pagamento em {dia(s.data_pagamento)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground" title={s.descricao}>{nomeClassificacao(s.classificacao_id)} · {s.descricao}</p>
                    {s.status === "aprovada" && s.senha && st !== "expirada" && (
                      <div className="flex items-center justify-between gap-2 rounded-md bg-emerald-50 px-2 py-1.5 dark:bg-emerald-950/30">
                        <div>
                          <p className="font-mono text-sm font-bold tracking-wide">{s.senha}</p>
                          <p className="text-[11px] text-muted-foreground">vale por mais {restanteDaSenha(s.senha_expira_em)}</p>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void copiar(s.senha!)} title="Copiar senha">
                          <ClipboardCopy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                    {podeCriarDespesaDaExcecao(s) && (
                      <Button type="button" size="sm" className="h-7 gap-1 text-xs" onClick={() => navigate(urlCriarDespesaDaExcecao(s, nomeClassificacao(s.classificacao_id)))}>
                        <FilePlus2 className="h-3.5 w-3.5" />Criar despesa
                      </Button>
                    )}
                    {s.status === "reprovada" && s.motivo_decisao && <p className="text-xs text-destructive">Motivo: {s.motivo_decisao}</p>}
                    {(s.status === "em_analise" || (s.status === "aprovada" && st !== "expirada")) && (
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => void cancelarSolicitacao(s)} disabled={cancelar.isPending}>
                        Cancelar solicitação
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
