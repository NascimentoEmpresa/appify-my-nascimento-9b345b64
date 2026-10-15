import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eye, FileText, FilterX, Hourglass, Trash2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { useClassificacoesOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useContratosAtivos, useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { useClassificacoesQueDecido, useTodasExcecoes } from "@/hooks/useMaloteExcecao";
import { DecidirExcecaoDialog, type AlvoDecisaoExcecao } from "./excecao/DecidirExcecaoDialog";
import { ExcecaoDetalhe, NomeUsuario } from "./excecao/ExcecaoDetalhe";
import { ExcluirExcecaoDialog } from "./excecao/ExcluirExcecaoDialog";
import {
  FILTRO_EXCECOES_VAZIO, filtrarExcecoes, percentualDoTotal, podeExcluirExcecao, resumirExcecoes, STATUS_EXCECAO_BADGE, STATUS_EXCECAO_LABEL, statusExibidoExcecao,
  type ExcecaoSolicitacao, type FiltroExcecoes, type StatusExcecaoExibido,
} from "./excecao/regras";

const brl = (n: number) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dia = (iso: string) => iso.split("T")[0].split("-").reverse().join("/");
const POR_PAGINA = 10;
const TODOS = "__todos__";

function Kpi({ icone, rotulo, valor, sub, tom }: { icone: React.ReactNode; rotulo: string; valor: number; sub: string; tom: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${tom}`}>{icone}</div>
        <div>
          <p className="text-sm font-medium">{rotulo}</p>
          <p className="text-2xl font-bold leading-tight">{valor}</p>
          <p className="text-xs text-muted-foreground">{sub}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// SIS-2026-0668 (fase 2): visão geral das solicitações de exceção, para quem tem a tela
// (malote_excecao_autorizacoes). Aprovar/Reprovar só aparecem para o aprovador das exceções (Malote › Configurações).
export default function ExcecaoAutorizacoes() {
  const { user } = useAuth();
  const { data: todas = [], isLoading } = useTodasExcecoes();
  const { data: decido } = useClassificacoesQueDecido();
  const { data: classificacoes = [] } = useClassificacoesOrcamento();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();

  const [filtro, setFiltro] = useState<FiltroExcecoes>(FILTRO_EXCECOES_VAZIO);
  // Quem é o aprovador das exceções abre já na fila de pendentes (uma vez; depois o filtro é dela/dele).
  const filtroInicialAplicado = useRef(false);
  useEffect(() => {
    if (filtroInicialAplicado.current || !decido) return;
    filtroInicialAplicado.current = true;
    if (decido.size > 0) setFiltro((f) => ({ ...f, status: "em_analise" }));
  }, [decido]);
  const [pagina, setPagina] = useState(1);
  const [alvo, setAlvo] = useState<AlvoDecisaoExcecao | null>(null);
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

  const filtradas = useMemo(() => filtrarExcecoes(todas, filtro), [todas, filtro]);
  const resumo = useMemo(() => resumirExcecoes(filtradas), [filtradas]);
  const solicitantes = useMemo(() => Array.from(new Set(todas.map((s) => s.solicitante_id))), [todas]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const visiveis = filtradas.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA);

  function mudar(parcial: Partial<FiltroExcecoes>) {
    setFiltro((f) => ({ ...f, ...parcial }));
    setPagina(1);
  }
  const podeDecidirEsta = (s: ExcecaoSolicitacao) => s.status === "em_analise" && !!decido?.has(s.classificacao_id);
  const podeExcluirEsta = (s: ExcecaoSolicitacao) => podeExcluirExcecao(s, user?.id, !!decido?.has(s.classificacao_id));

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Autorizações de Exceção"
        subtitle="Consulte as solicitações, aprove ou reprove as pendentes e visualize as senhas das solicitações aprovadas."
        module="Malote"
        breadcrumb={["Autorizações de Exceção"]}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icone={<FileText className="h-6 w-6 text-blue-600" />} tom="bg-blue-50 dark:bg-blue-950/30" rotulo="Total de Solicitações" valor={resumo.total} sub="No filtro atual" />
        <Kpi icone={<Hourglass className="h-6 w-6 text-sky-600" />} tom="bg-sky-50 dark:bg-sky-950/30" rotulo="Em Análise" valor={resumo.emAnalise} sub={`${percentualDoTotal(resumo.emAnalise, resumo.total)}% do total`} />
        <Kpi icone={<CheckCircle2 className="h-6 w-6 text-emerald-600" />} tom="bg-emerald-50 dark:bg-emerald-950/30" rotulo="Aprovadas" valor={resumo.aprovadas} sub={`${percentualDoTotal(resumo.aprovadas, resumo.total)}% do total`} />
        <Kpi icone={<XCircle className="h-6 w-6 text-red-600" />} tom="bg-red-50 dark:bg-red-950/30" rotulo="Reprovadas" valor={resumo.reprovadas} sub={`${percentualDoTotal(resumo.reprovadas, resumo.total)}% do total`} />
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label className="text-xs">Período</Label>
              <DateRangeFilter de={filtro.de} ate={filtro.ate} onChange={(de, ate) => mudar({ de, ate })} />
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={filtro.status || TODOS} onValueChange={(v) => mudar({ status: v === TODOS ? "" : (v as StatusExcecaoExibido) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os status</SelectItem>
                  {(Object.keys(STATUS_EXCECAO_LABEL) as StatusExcecaoExibido[]).map((k) => (
                    <SelectItem key={k} value={k}>{STATUS_EXCECAO_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={filtro.empresaId || TODOS} onValueChange={(v) => mudar({ empresaId: v === TODOS ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todas as empresas</SelectItem>
                  {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Contrato</Label>
              <Select value={filtro.contratoId || TODOS} onValueChange={(v) => mudar({ contratoId: v === TODOS ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os contratos</SelectItem>
                  {contratos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_minmax(0,1fr)_auto]">
            <div>
              <Label className="text-xs">Solicitante</Label>
              <Select value={filtro.solicitanteId || TODOS} onValueChange={(v) => mudar({ solicitanteId: v === TODOS ? "" : v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os solicitantes</SelectItem>
                  {solicitantes.map((id) => <SelectItem key={id} value={id}><NomeUsuario id={id} /></SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Buscar</Label>
              <Input value={filtro.busca} onChange={(e) => mudar({ busca: e.target.value })} placeholder="Buscar por código, descrição ou justificativa…" />
            </div>
            <div className="flex items-end">
              <Button variant="outline" className="gap-2" onClick={() => { setFiltro(FILTRO_EXCECOES_VAZIO); setPagina(1); }}>
                <FilterX className="h-4 w-4" />Limpar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="font-semibold">Lista de Solicitações</p>
              <p className="text-xs text-muted-foreground">Mostrando {visiveis.length === 0 ? 0 : (paginaSegura - 1) * POR_PAGINA + 1} a {(paginaSegura - 1) * POR_PAGINA + visiveis.length} de {filtradas.length} registros</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={paginaSegura <= 1} onClick={() => setPagina(paginaSegura - 1)}>Anterior</Button>
              <span className="text-xs text-muted-foreground">{paginaSegura} / {totalPaginas}</span>
              <Button variant="outline" size="sm" disabled={paginaSegura >= totalPaginas} onClick={() => setPagina(paginaSegura + 1)}>Próxima</Button>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Solicitante</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Contrato</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Senha</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">Carregando…</TableCell></TableRow>}
              {!isLoading && visiveis.length === 0 && <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground">Nenhuma solicitação encontrada.</TableCell></TableRow>}
              {visiveis.map((s) => {
                const st = statusExibidoExcecao(s);
                return (
                  <TableRow key={s.id} className="cursor-pointer" onClick={() => setDetalhe(s)}>
                    <TableCell className="font-mono text-xs font-semibold">{s.numero}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{dia(s.created_at)}</TableCell>
                    <TableCell className="text-xs"><NomeUsuario id={s.solicitante_id} /></TableCell>
                    <TableCell className="text-xs">{nomes.empresa.get(s.empresa_id) ?? "—"}</TableCell>
                    <TableCell className="text-xs">{s.contrato_id ? nomes.contrato.get(s.contrato_id) ?? "—" : "—"}</TableCell>
                    <TableCell className="max-w-64 truncate text-xs" title={s.descricao}>{s.descricao}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{brl(s.valor)}</TableCell>
                    <TableCell><Badge className={STATUS_EXCECAO_BADGE[st]} variant="secondary">{STATUS_EXCECAO_LABEL[st]}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{s.status === "aprovada" && st !== "expirada" ? s.senha : s.status === "utilizada" ? "Utilizada" : "—"}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1.5">
                        {podeDecidirEsta(s) ? (
                          <>
                            <Button size="sm" className="h-7 bg-emerald-600 px-2 hover:bg-emerald-700" onClick={() => setAlvo({ s, aprovar: true })}>Aprovar</Button>
                            <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => setAlvo({ s, aprovar: false })}>Reprovar</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => setDetalhe(s)}><Eye className="h-3.5 w-3.5" />Ver</Button>
                        )}
                        {podeExcluirEsta(s) && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setAExcluir(s)} title="Excluir solicitação"><Trash2 className="h-3.5 w-3.5" /></Button>
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

      <Card>
        <CardContent className="grid gap-4 p-4 text-sm md:grid-cols-3">
          <p><span className="font-semibold">Senha única.</span> <span className="text-muted-foreground">Gerada apenas quando a solicitação é aprovada pela diretoria financeira.</span></p>
          <p><span className="font-semibold">Vinculada à solicitação.</span> <span className="text-muted-foreground">Vale 24 horas, só para quem pediu, para a data e a classificação pedidas e até o valor pedido.</span></p>
          <p><span className="font-semibold">Uso único.</span> <span className="text-muted-foreground">Após usar na criação da despesa, a senha é invalidada automaticamente.</span></p>
        </CardContent>
      </Card>

      <DecidirExcecaoDialog alvo={alvo} onClose={() => setAlvo(null)} />
      <ExcluirExcecaoDialog alvo={aExcluir} onClose={() => setAExcluir(null)} />
      <ExcecaoDetalhe
        solicitacao={detalhe}
        onClose={() => setDetalhe(null)}
        nomes={nomes}
        podeDecidir={!!detalhe && podeDecidirEsta(detalhe)}
        onDecidir={(aprovar) => { if (detalhe) { setAlvo({ s: detalhe, aprovar }); setDetalhe(null); } }}
      />
    </div>
  );
}
