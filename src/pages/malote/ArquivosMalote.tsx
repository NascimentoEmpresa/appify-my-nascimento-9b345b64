import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
  FileArchive,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  FileDown,
  Paperclip,
  Image as ImageIcon,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useItensAprovacoesMalote,
  useEmpresasGrupo,
  useContratosAtivos,
  useEmpresaPrimeiraLinhaRateio,
  useClassificacaoPrimeiraLinhaRateio,
  MaloteDespesaRow,
  ItemLinhaMalote,
  OrigemDespesa,
} from "@/hooks/useMaloteDespesa";
import { useClassificacoesOrcamentoAdmin } from "@/hooks/usePlanejamentoOrcamentario";

// SIS-2026-0290 (Iury): "Criar um submódulo onde o usuário consegue buscar
// os arquivos do malote como o de pagamento e o comprovante". Item de
// "arquivo" aqui vem exatamente da mesma fonte de Pagamento Malote/
// Aprovações (useItensAprovacoesMalote — cada linha é uma despesa ou, se
// parcelada, cada parcela dela), só que sem restringir por status: o
// objetivo é achar um arquivo, não acompanhar um fluxo de aprovação.

const ORIGEM_LABEL: Record<OrigemDespesa, string> = {
  solicitacao: "Solicitação",
  despesa_unica: "Despesa",
  despesa_multi_classificacao: "Rateio de Classificação",
};

function tipoLabelDe(despesa: MaloteDespesaRow): string {
  return ORIGEM_LABEL[despesa.origem] ?? despesa.origem;
}

async function abrirAnexo(path: string) {
  const { data, error } = await supabase.storage.from("malote-anexos").createSignedUrl(path, 60);
  if (error || !data) {
    toast.error("Não foi possível abrir o arquivo.");
    return;
  }
  window.open(data.signedUrl, "_blank");
}

function IconeArquivo({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return <ImageIcon className="h-3.5 w-3.5" />;
  if (["xls", "xlsx", "csv"].includes(ext)) return <FileSpreadsheet className="h-3.5 w-3.5" />;
  if (["pdf", "doc", "docx", "txt"].includes(ext)) return <FileText className="h-3.5 w-3.5" />;
  return <FileIcon className="h-3.5 w-3.5" />;
}

// Botão "Abrir" (abre o 1º/único arquivo direto) + seta de dropdown quando
// há mais de um arquivo na mesma célula (ex. vários anexos na mesma
// despesa) — mockup do Iury já trazia esse combo pronto.
function ArquivoCell({ paths }: { paths: string[] }) {
  const validos = paths.filter(Boolean);
  if (validos.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="inline-flex items-center rounded-md border border-border overflow-hidden">
      <button
        type="button"
        onClick={() => abrirAnexo(validos[0])}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-primary hover:bg-primary/5"
      >
        <Paperclip className="h-3 w-3" /> Abrir
      </button>
      {validos.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger className="border-l border-border px-1 py-1 text-muted-foreground hover:bg-muted">
            <ChevronDown className="h-3 w-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {validos.map((p) => (
              <DropdownMenuItem key={p} onClick={() => abrirAnexo(p)} className="gap-2 text-xs">
                <IconeArquivo path={p} />
                <span className="truncate max-w-[220px]">{p.split("/").pop()}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

const PAGE_SIZE = 10;

export default function ArquivosMalote() {
  const { data: todosItens = [], isLoading } = useItensAprovacoesMalote();
  const { data: empresas = [] } = useEmpresasGrupo();
  const { data: contratos = [] } = useContratosAtivos();
  const { data: classificacoesTodas = [] } = useClassificacoesOrcamentoAdmin();

  const empresasMap = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);
  const contratosMap = useMemo(() => new Map(contratos.map((c) => [c.id, c.nome])), [contratos]);
  const setorPorClassificacaoId = useMemo(
    () => new Map(classificacoesTodas.map((c) => [c.id, c.setor_responsavel])),
    [classificacoesTodas],
  );

  // Mesma convenção já usada em Pagamento Malote/Aprovações: despesa de
  // rateio multi-empresa/classificação usa a PRIMEIRA linha do rateio pra
  // Empresa/Setor, não o campo "de contexto" da despesa.
  const despesaIds = useMemo(() => Array.from(new Set(todosItens.map((i) => i.despesa.id))), [todosItens]);
  const { data: empresaPrimeiraLinhaPorDespesa } = useEmpresaPrimeiraLinhaRateio(despesaIds);
  const { data: classificacaoPrimeiraLinhaPorDespesa } = useClassificacaoPrimeiraLinhaRateio(despesaIds);
  function empresaIdResolvida(despesa: MaloteDespesaRow): string | null {
    return empresaPrimeiraLinhaPorDespesa?.get(despesa.id) ?? despesa.empresa_id ?? null;
  }
  function setorResolvido(despesa: MaloteDespesaRow): string | null {
    if (despesa.classificacao?.setor_responsavel) return despesa.classificacao.setor_responsavel;
    const classificacaoIdRateio = classificacaoPrimeiraLinhaPorDespesa?.get(despesa.id);
    return classificacaoIdRateio ? setorPorClassificacaoId.get(classificacaoIdRateio) ?? null : null;
  }

  // Só interessam aqui itens que têm pelo menos 1 arquivo pra achar
  // (anexo da despesa ou comprovante de pagamento) — uma solicitação ainda
  // em cotação, sem nada anexado, não tem o que buscar nesta tela.
  const itens = useMemo(
    () => todosItens.filter((i) => (i.despesa.arquivos?.length ?? 0) > 0 || !!i.despesa.comprovante_pagamento_path || !!i.parcela?.comprovante_pagamento_path),
    [todosItens],
  );

  const [dataDe, setDataDe] = useState("");
  const [dataAte, setDataAte] = useState("");
  const [setor, setSetor] = useState("");
  const [classificacao, setClassificacao] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [contratoId, setContratoId] = useState("");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);

  const classificacoesDisponiveis = useMemo(() => {
    const nomes = new Set<string>();
    itens.forEach((i) => i.despesa.classificacao?.nome && nomes.add(i.despesa.classificacao.nome));
    return Array.from(nomes).sort();
  }, [itens]);

  const empresasDisponiveis = useMemo(() => {
    const ids = new Set<string>();
    itens.forEach((i) => { const id = empresaIdResolvida(i.despesa); if (id) ids.add(id); });
    return Array.from(ids).map((id) => ({ id, nome: empresasMap.get(id) ?? id })).sort((a, b) => a.nome.localeCompare(b.nome));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, empresaPrimeiraLinhaPorDespesa, empresasMap]);

  const setoresDisponiveis = useMemo(() => {
    const nomes = new Set<string>();
    itens.forEach((i) => { const s = setorResolvido(i.despesa); if (s) nomes.add(s); });
    return Array.from(nomes).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, classificacaoPrimeiraLinhaPorDespesa, setorPorClassificacaoId]);

  const contratosDaEmpresa = useMemo(
    () => (empresaId ? contratos.filter((c) => c.empresa_id === empresaId) : contratos),
    [contratos, empresaId],
  );

  function limparFiltros() {
    setDataDe(""); setDataAte(""); setSetor(""); setClassificacao("");
    setEmpresaId(""); setContratoId(""); setBusca(""); setPagina(1);
  }

  const filtrados = useMemo(() => {
    return itens.filter((item) => {
      const d = item.despesa;
      if (classificacao && d.classificacao?.nome !== classificacao) return false;
      if (empresaId && empresaIdResolvida(d) !== empresaId) return false;
      if (setor && setorResolvido(d) !== setor) return false;
      if (contratoId && d.contrato_id !== contratoId) return false;
      if (dataDe || dataAte) {
        const dp = item.parcela ? item.parcela.data_pagamento_real ?? item.parcela.data_vencimento : d.data_pagamento;
        if (dataDe && (!dp || dp < dataDe)) return false;
        if (dataAte && (!dp || dp > dataAte)) return false;
      }
      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        if (!d.numero.toLowerCase().includes(q) && !d.nome.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, classificacao, empresaId, empresaPrimeiraLinhaPorDespesa, setor, classificacaoPrimeiraLinhaPorDespesa, setorPorClassificacaoId, contratoId, dataDe, dataAte, busca]);

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaAtual - 1) * PAGE_SIZE, paginaAtual * PAGE_SIZE);

  // "Exportar Excel" do mockup — CSV (abre direto no Excel), mesmo padrão
  // leve já usado em Financeiro (AnalisePeriodoTab), sem trazer lib nova só
  // pra isso. Lista os arquivos como link do Storage (é o que tem valor
  // fora da tela — clicar "Abrir" só existe aqui dentro).
  function exportarExcel() {
    const linkAssinado = (path: string | null | undefined) => (path ? path : "");
    const head = "Tipo;Nº do Malote;Parcela;Nome;Classificação;Empresa;Contrato;Valor;Data de Pagamento;Anexos;Comprovante\n";
    const body = filtrados
      .map((item) => {
        const d = item.despesa;
        const valor = item.parcela ? item.parcela.valor : d.valor_total;
        const dataPagamento = item.parcela ? item.parcela.data_pagamento_real ?? item.parcela.data_vencimento : d.data_pagamento;
        const comprovante = item.parcela ? item.parcela.comprovante_pagamento_path : d.comprovante_pagamento_path;
        return [
          tipoLabelDe(d),
          d.numero,
          item.parcela ? `${item.parcela.numero_parcela}/${d.numero_parcelas}` : "",
          d.nome.replace(/;/g, ","),
          d.classificacao?.nome ?? "",
          empresasMap.get(empresaIdResolvida(d) ?? "") ?? "",
          d.contrato_id ? contratosMap.get(d.contrato_id) ?? "" : "",
          Number(valor).toFixed(2).replace(".", ","),
          dataPagamento ?? "",
          (d.arquivos ?? []).map(linkAssinado).join(" | "),
          linkAssinado(comprovante),
        ].join(";");
      })
      .join("\n");
    const blob = new Blob([head + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "arquivos-do-malote.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Arquivos do Malote"
        subtitle="Consulte e gerencie os arquivos de pagamentos e comprovantes dos itens do malote."
        module="Malote"
        breadcrumb={["Malote", "Arquivos do Malote"]}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Filtros</p>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={limparFiltros}>
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <DateRangeFilter
              label="Data de pagamento"
              de={dataDe}
              ate={dataAte}
              onChange={(de, ate) => { setDataDe(de); setDataAte(ate); setPagina(1); }}
            />
            <div>
              <Label className="text-xs">Setor</Label>
              <Select value={setor || "todos"} onValueChange={(v) => { setSetor(v === "todos" ? "" : v); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {setoresDisponiveis.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Classificação</Label>
              <Select value={classificacao || "todas"} onValueChange={(v) => { setClassificacao(v === "todas" ? "" : v); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {classificacoesDisponiveis.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Empresa</Label>
              <Select value={empresaId || "todas"} onValueChange={(v) => { setEmpresaId(v === "todas" ? "" : v); setContratoId(""); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  {empresasDisponiveis.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Contrato</Label>
              <Select value={contratoId || "todos"} onValueChange={(v) => { setContratoId(v === "todos" ? "" : v); setPagina(1); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  {contratosDaEmpresa.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Buscar por nº do malote ou nome</Label>
              <Input className="h-8 text-xs" placeholder="Nº ou nome" value={busca} onChange={(e) => { setBusca(e.target.value); setPagina(1); }} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <p className="text-sm font-semibold">Arquivos do Malote</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportarExcel}>
              <FileDown className="h-3.5 w-3.5" /> Exportar Excel
            </Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Nº do Malote</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Nome / Motivo</TableHead>
                  <TableHead>Classificação</TableHead>
                  <TableHead>Empresa / Contrato</TableHead>
                  <TableHead className="text-right">Valor (R$)</TableHead>
                  <TableHead>Data de Pagamento</TableHead>
                  <TableHead>Arquivo de Pagamento</TableHead>
                  <TableHead>Arquivo Comprovante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">Carregando...</TableCell>
                  </TableRow>
                )}
                {!isLoading && visiveis.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                      <div className="flex flex-col items-center gap-2">
                        <FileArchive className="h-8 w-8 text-muted-foreground/50" />
                        Nenhum arquivo encontrado com os filtros atuais.
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {visiveis.map((item) => (
                  <LinhaArquivo
                    key={`${item.despesa.id}-${item.parcela?.id ?? "unica"}`}
                    item={item}
                    empresaNome={empresasMap.get(empresaIdResolvida(item.despesa) ?? "")}
                    nomeContrato={item.despesa.contrato_id ? contratosMap.get(item.despesa.contrato_id) : undefined}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {filtrados.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
              <span>Mostrando {(paginaAtual - 1) * PAGE_SIZE + 1} a {Math.min(paginaAtual * PAGE_SIZE, filtrados.length)} de {filtrados.length} registros</span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={paginaAtual <= 1} onClick={() => setPagina((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="font-medium">Página {paginaAtual} de {totalPaginas}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={paginaAtual >= totalPaginas} onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LinhaArquivo({ item, empresaNome, nomeContrato }: { item: ItemLinhaMalote; empresaNome?: string; nomeContrato?: string }) {
  const { despesa, parcela } = item;
  const valor = parcela ? parcela.valor : despesa.valor_total;
  const dataPagamento = parcela ? parcela.data_pagamento_real ?? parcela.data_vencimento : despesa.data_pagamento;
  const comprovante = parcela ? parcela.comprovante_pagamento_path : despesa.comprovante_pagamento_path;
  return (
    <TableRow>
      <TableCell className="text-sm">{tipoLabelDe(despesa)}</TableCell>
      <TableCell className="font-mono text-xs">{despesa.numero}</TableCell>
      <TableCell className="text-sm">
        {parcela ? `${parcela.numero_parcela}/${despesa.numero_parcelas}` : <span className="text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="text-sm">
        <p>{despesa.nome}</p>
        {despesa.motivo && <p className="text-xs text-muted-foreground">{despesa.motivo}</p>}
      </TableCell>
      <TableCell className="text-sm">{despesa.classificacao?.nome ?? "—"}</TableCell>
      <TableCell className="text-sm">
        <p>{empresaNome ?? "—"}</p>
        {nomeContrato && <p className="text-xs text-muted-foreground">{nomeContrato}</p>}
      </TableCell>
      <TableCell className="text-right text-sm">{Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</TableCell>
      <TableCell className="text-sm">{dataPagamento ? new Date(dataPagamento + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
      <TableCell><ArquivoCell paths={despesa.arquivos ?? []} /></TableCell>
      <TableCell><ArquivoCell paths={comprovante ? [comprovante] : []} /></TableCell>
    </TableRow>
  );
}
