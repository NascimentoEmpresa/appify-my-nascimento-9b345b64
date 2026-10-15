import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ClipboardCopy, Eye, FilePlus2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useContratosAtivos, useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useCancelarExcecao, useMinhasExcecoes } from "@/hooks/useMaloteExcecao";
import { ExcecaoDetalhe } from "./excecao/ExcecaoDetalhe";
import { ExcluirExcecaoDialog } from "./excecao/ExcluirExcecaoDialog";
import {
  FILTRO_EXCECOES_VAZIO, filtrarExcecoes, podeCriarDespesaDaExcecao, podeExcluirExcecao, restanteDaSenha, urlCriarDespesaDaExcecao, STATUS_EXCECAO_BADGE, STATUS_EXCECAO_LABEL, statusExibidoExcecao,
  type ExcecaoSolicitacao, type StatusExcecaoExibido,
} from "./excecao/regras";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.split("T")[0].split("-").reverse().join("/");
const TODOS = "__todos__";

// SIS-2026-0668 (fase 2): só as solicitações da própria pessoa, com a senha à mão quando aprovadas.
export default function ExcecaoMinhas() {
  const { user } = useAuth();
  const { data: minhas = [], isLoading } = useMinhasExcecoes(user?.id);
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const cancelar = useCancelarExcecao();
  const navigate = useNavigate();

  const [status, setStatus] = useState<"" | StatusExcecaoExibido>("");
  const [busca, setBusca] = useState("");
  const [detalhe, setDetalhe] = useState<ExcecaoSolicitacao | null>(null);
  const [aExcluir, setAExcluir] = useState<ExcecaoSolicitacao | null>(null);

  const nomes = useMemo(
    () => ({
      classificacao: new Map(classificacoes.map((c) => [c.id, c.nome])),
      empresa: new Map(empresas.map((e) => [e.id, e.nome])),
      contrato: new Map(contratos.map((c) => [c.id, c.nome])),
    }),
    [classificacoes, empresas, contratos],
  );
  const lista = useMemo(() => filtrarExcecoes(minhas, { ...FILTRO_EXCECOES_VAZIO, status, busca }), [minhas, status, busca]);

  const criarDespesa = (s: ExcecaoSolicitacao) => navigate(urlCriarDespesaDaExcecao(s, nomes.classificacao.get(s.classificacao_id) ?? null));

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
        title="Minhas Solicitações de Exceção"
        subtitle="Acompanhe os pedidos que você fez, copie a senha das aprovadas e veja o motivo das reprovadas."
        module="Malote"
        breadcrumb={["Minhas Solicitações"]}
        actions={<Button asChild><Link to="/app/malote/excecao/solicitar">Nova solicitação</Link></Button>}
      />

      <Card>
        <CardContent className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[240px_minmax(0,1fr)]">
          <Select value={status || TODOS} onValueChange={(v) => setStatus(v === TODOS ? "" : (v as StatusExcecaoExibido))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os status</SelectItem>
              {(Object.keys(STATUS_EXCECAO_LABEL) as StatusExcecaoExibido[]).map((k) => <SelectItem key={k} value={k}>{STATUS_EXCECAO_LABEL[k]}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por código, descrição ou justificativa…" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Classificação</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Senha</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
              {!isLoading && lista.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Nenhuma solicitação encontrada.</TableCell></TableRow>}
              {lista.map((s) => {
                const st = statusExibidoExcecao(s);
                const senhaAtiva = s.status === "aprovada" && !!s.senha && st !== "expirada";
                return (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs font-semibold">{s.numero}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{dia(s.created_at)}</TableCell>
                    <TableCell className="text-xs">{nomes.classificacao.get(s.classificacao_id) ?? "—"}</TableCell>
                    <TableCell className="max-w-64 truncate text-xs" title={s.descricao}>{s.descricao}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{brl(s.valor)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{dia(s.data_pagamento)}</TableCell>
                    <TableCell><Badge className={STATUS_EXCECAO_BADGE[st]} variant="secondary">{STATUS_EXCECAO_LABEL[st]}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {senhaAtiva ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono font-bold">{s.senha}</span>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void copiar(s.senha!)} title="Copiar senha"><ClipboardCopy className="h-3 w-3" /></Button>
                          <span className="text-muted-foreground">({restanteDaSenha(s.senha_expira_em)})</span>
                        </span>
                      ) : s.status === "utilizada" ? "Utilizada" : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {podeCriarDespesaDaExcecao(s) && (
                          <Button size="sm" className="h-7 gap-1 px-2" onClick={() => criarDespesa(s)} title="Abre o Criar Despesa já preenchido e com a senha validada">
                            <FilePlus2 className="h-3.5 w-3.5" />Criar despesa
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => setDetalhe(s)}><Eye className="h-3.5 w-3.5" />Ver</Button>
                        {podeExcluirExcecao(s, user?.id, false) && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setAExcluir(s)} title="Excluir solicitação"><Trash2 className="h-3.5 w-3.5" /></Button>
                        )}
                        {(s.status === "em_analise" || senhaAtiva) && (
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => void cancelarSolicitacao(s)} disabled={cancelar.isPending}>Cancelar</Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ExcluirExcecaoDialog alvo={aExcluir} onClose={() => setAExcluir(null)} />
      <ExcecaoDetalhe
        solicitacao={detalhe}
        onClose={() => setDetalhe(null)}
        nomes={nomes}
        onCriarDespesa={detalhe && podeCriarDespesaDaExcecao(detalhe) ? () => criarDespesa(detalhe) : undefined}
      />
    </div>
  );
}
