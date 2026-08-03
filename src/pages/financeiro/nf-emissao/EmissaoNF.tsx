import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Plus, Trash2, FileText, Building2, Calculator, ChevronRight, Search, Settings, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import {
  NfEmissaoRow,
  useNfsEmissao,
  useSalvarNfEmissao,
  useAtualizarNfEmissao,
  useEnviarNfEmissao,
  useExcluirNfEmissao,
  useItensNfEmissao,
  useAnexosNfEmissao,
  baixarAnexoNfEmissao,
  TIPOS_NOTA,
  TipoNota,
} from "@/hooks/useNfEmissao";
import { useContratosERP, ContratoERP } from "@/hooks/useContratosERP";
import { usePlanilhaCustos, resolverPostosVigentes, PostoVigente } from "@/hooks/usePlanilhaCusto";
import { useModelosNf, buscarItensModeloNf, NfEmissaoModeloRow } from "@/hooks/useNfEmissaoModelo";
import { calcularItem, calcularTotaisNf, ItemInput, ItemCalculado, INSS_CATEGORIAS, PercentuaisFiscais } from "./calculos";
import { fmtMoney, fmtPct, fmtDate, STATUS_LABEL, STATUS_CLASS, Linha, itemVazio } from "./shared";
import { ItensNfEditor } from "./ItensNfEditor";
import { ModeloNfDialog } from "./ModeloNfDialog";
import { registrarLogNf } from "./registrarLogNf";
import { HistoricoNfPainel } from "./HistoricoNfPainel";

interface NovaNfSeed {
  modeloId: string;
  variacao: string;
  itens: (ItemInput & { identificacao: string })[];
  unitarios: (number | null)[];
  pctFiscais: PercentuaisFiscais | null;
}

function pctFiscaisDoContrato(c: Pick<ContratoERP, "issqn_pct" | "ir_pct" | "cofins_pct" | "pis_pct" | "csll_pct">): PercentuaisFiscais | null {
  const configurado = c.issqn_pct !== 0 || c.ir_pct !== 0 || c.cofins_pct !== 0 || c.pis_pct !== 0 || c.csll_pct !== 0;
  return configurado
    ? { issqn_pct: c.issqn_pct, ir_pct: c.ir_pct, cofins_pct: c.cofins_pct, pis_pct: c.pis_pct, csll_pct: c.csll_pct }
    : null;
}

export default function EmissaoNF() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;
  const { data: nfs = [], isLoading } = useNfsEmissao(empresaId);
  const { data: contratosTodos = [] } = useContratosERP();
  // Esconde contratos encerrados/suspensos do fluxo operacional — a não ser
  // que já tenham NF emitida aqui, pra não sumir com histórico existente.
  const contratos = useMemo(() => {
    const idsComNf = new Set(nfs.map((n) => n.contrato_id));
    return contratosTodos.filter((c) => c.status === "ativo" || idsComNf.has(c.id));
  }, [contratosTodos, nfs]);

  const [busca, setBusca] = useState("");
  const [contratoSel, setContratoSel] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [novaNfContratoId, setNovaNfContratoId] = useState<string | null>(null);
  const [nfSelecionada, setNfSelecionada] = useState<NfEmissaoRow | null>(null);
  const [nfEmEdicao, setNfEmEdicao] = useState<NfEmissaoRow | null>(null);
  const [modeloConfigOpen, setModeloConfigOpen] = useState(false);
  const [seedNovaNf, setSeedNovaNf] = useState<NovaNfSeed | null>(null);

  const { data: planilha = [] } = usePlanilhaCustos();
  const { data: modelosContratoSel = [] } = useModelosNf(contratoSel);
  const modelosAtivos = useMemo(() => modelosContratoSel.filter((m) => m.ativo), [modelosContratoSel]);

  const contratosFiltrados = useMemo(() => {
    return contratos
      .filter(
        (c) => c.nome.toLowerCase().includes(busca.toLowerCase()) || c.cliente.toLowerCase().includes(busca.toLowerCase())
      )
      .sort((a, b) => a.nome.localeCompare(b.nome));
  }, [contratos, busca]);

  const contratoAtual = contratos.find((c) => c.id === contratoSel) ?? null;
  const nfsDoContrato = useMemo(() => nfs.filter((n) => n.contrato_id === contratoSel), [nfs, contratoSel]);
  const postosVigentesContratoSel: PostoVigente[] = useMemo(
    () => (contratoSel ? resolverPostosVigentes(planilha, contratoSel) : []),
    [planilha, contratoSel]
  );

  function ultimaCompetenciaVariacao(variacao: string | null) {
    const nf = nfsDoContrato
      .filter((n) => (n.variacao ?? "") === (variacao ?? ""))
      .sort((a, b) => b.competencia.localeCompare(a.competencia))[0];
    return nf ? nf.competencia.slice(0, 7) : null;
  }

  async function abrirVariacaoModelo(modelo: NfEmissaoModeloRow) {
    const itensModelo = await buscarItensModeloNf(modelo.id);
    if (itensModelo.length === 0) {
      toast.error('Este modelo não tem itens cadastrados. Configure em "Modelo de NFs".');
      return;
    }
    const faltantes: string[] = [];
    const itens: (ItemInput & { identificacao: string })[] = [];
    const unitarios: (number | null)[] = [];
    itensModelo.forEach((mi, idx) => {
      const pct = mi.percentual / 100;
      const p = mi.posto ? postosVigentesContratoSel.find((pv) => pv.posto === mi.posto) : undefined;
      if (mi.posto && !p) faltantes.push(mi.posto);
      const rotulo =
        mi.identificacao_padrao || (mi.posto ? (mi.percentual !== 100 ? `${mi.posto} (${mi.percentual}%)` : mi.posto) : `Item ${idx + 1}`);
      if (p) {
        itens.push({
          ...itemVazio(idx + 1),
          identificacao: rotulo,
          valor_contrato_exec: Math.round(p.valorTotal * pct * 100) / 100,
          qtd_colaboradores: Math.round(p.qtdColaboradores * pct),
          inss_categoria: mi.inss_categoria,
        });
        unitarios.push(p.valorUnitario * pct);
      } else {
        itens.push({
          ...itemVazio(idx + 1),
          identificacao: rotulo,
          valor_contrato_exec: mi.ultimo_valor_unitario ?? 0,
          inss_categoria: mi.inss_categoria,
        });
        unitarios.push(null);
      }
    });
    if (faltantes.length > 0) {
      toast.error(`Posto(s) não encontrado(s) na planilha vigente: ${faltantes.join(", ")}. Preencha manualmente.`);
    }
    const pctFiscaisContrato = contratoAtual ? pctFiscaisDoContrato(contratoAtual) : null;
    const pctFiscais: PercentuaisFiscais | null = pctFiscaisContrato
      ? {
          issqn_pct: modelo.issqn_pct ?? pctFiscaisContrato.issqn_pct,
          ir_pct: modelo.ir_pct ?? pctFiscaisContrato.ir_pct,
          cofins_pct: modelo.cofins_pct ?? pctFiscaisContrato.cofins_pct,
          pis_pct: modelo.pis_pct ?? pctFiscaisContrato.pis_pct,
          csll_pct: modelo.csll_pct ?? pctFiscaisContrato.csll_pct,
        }
      : null;
    setSeedNovaNf({ modeloId: modelo.id, variacao: modelo.variacao ?? "", itens, unitarios, pctFiscais });
    setNovaNfContratoId(contratoSel);
    setModalOpen(true);
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Emissão de NF"
        subtitle="Cadastro de notas fiscais por contrato, com cálculo automático de retenções."
        module="Financeiro"
        breadcrumb={["Controle de Notas", "Emissão de NF"]}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to="/app/licitacoes/contratos">
                <Building2 className="h-4 w-4 mr-2" />
                Dados Fiscais do Contrato
              </Link>
            </Button>
            {!contratoSel && (
              <Button
                onClick={() => {
                  setNovaNfContratoId(null);
                  setModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Nova NF
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-5 gap-4 h-[calc(100vh-220px)] min-h-[480px]">
        {/* Lista de contratos */}
        <div className="col-span-2 card-elevated flex flex-col overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar contrato…"
                className="h-8 w-full rounded border border-border bg-background pl-9 pr-3 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>
          <div className="overflow-y-auto flex-1">
            {contratosFiltrados.length === 0 && (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nenhum contrato encontrado.</p>
            )}
            {contratosFiltrados.map((c) => {
              const qtd = nfs.filter((n) => n.contrato_id === c.id).length;
              const ativo = contratoSel === c.id;
              const encerrado = c.status === "encerrado";
              return (
                <button
                  key={c.id}
                  onClick={() => setContratoSel(c.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/30",
                    ativo && "bg-primary/5 border-l-2 border-l-primary",
                    encerrado && !ativo && "bg-muted/40 opacity-70"
                  )}
                >
                  <div className="min-w-0">
                    <p className={cn("text-xs font-semibold truncate", encerrado && "text-muted-foreground")}>{c.nome}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{c.cliente}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {encerrado && (
                      <span className="inline-flex rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                        Encerrado
                      </span>
                    )}
                    {qtd > 0 && (
                      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        {qtd}
                      </span>
                    )}
                    <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${ativo ? "rotate-90 text-primary" : ""}`} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* NFs do contrato selecionado */}
        <div className="col-span-3 card-elevated flex flex-col overflow-hidden">
          {!contratoAtual ? (
            <div className="flex h-full items-center justify-center py-20">
              <div className="text-center">
                <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">Selecione um contrato</p>
              </div>
            </div>
          ) : (
            <ContratoNfsPanel
              contrato={contratoAtual}
              nfs={nfsDoContrato}
              isLoading={isLoading}
              modelosAtivos={modelosAtivos}
              onNovaNf={() => {
                setSeedNovaNf(null);
                setNovaNfContratoId(contratoAtual.id);
                setModalOpen(true);
              }}
              onNovaVariacao={abrirVariacaoModelo}
              ultimaCompetenciaVariacao={ultimaCompetenciaVariacao}
              onConfigurarModelo={() => setModeloConfigOpen(true)}
              onSelecionar={setNfSelecionada}
            />
          )}
        </div>
      </div>

      <NovaNfDialog
        open={modalOpen || !!nfEmEdicao}
        onOpenChange={(v) => {
          if (!v) {
            setModalOpen(false);
            setNfEmEdicao(null);
            setNovaNfContratoId(null);
            setSeedNovaNf(null);
          }
        }}
        empresaId={empresaId}
        contratos={contratos}
        nfParaEditar={nfEmEdicao}
        contratoIdInicial={novaNfContratoId}
        seed={seedNovaNf}
      />

      {contratoAtual && (
        <ModeloNfDialog
          open={modeloConfigOpen}
          onClose={() => setModeloConfigOpen(false)}
          contrato={contratoAtual}
          postosVigentes={postosVigentesContratoSel}
        />
      )}

      <DetalhesNfDialog
        nf={nfSelecionada}
        onClose={() => setNfSelecionada(null)}
        onEditar={(nf) => {
          setNfSelecionada(null);
          setNfEmEdicao(nf);
        }}
      />
    </div>
  );
}

function ContratoNfsPanel({
  contrato,
  nfs,
  isLoading,
  modelosAtivos,
  onNovaNf,
  onNovaVariacao,
  ultimaCompetenciaVariacao,
  onConfigurarModelo,
  onSelecionar,
}: {
  contrato: ContratoERP;
  nfs: NfEmissaoRow[];
  isLoading: boolean;
  modelosAtivos: NfEmissaoModeloRow[];
  onNovaNf: () => void;
  onNovaVariacao: (modelo: NfEmissaoModeloRow) => void;
  ultimaCompetenciaVariacao: (variacao: string | null) => string | null;
  onConfigurarModelo: () => void;
  onSelecionar: (nf: NfEmissaoRow) => void;
}) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [buscaNf, setBuscaNf] = useState("");
  const [filtroCompetencia, setFiltroCompetencia] = useState("TODAS");

  const competencias = useMemo(
    () => ["TODAS", ...new Set(nfs.map((n) => n.competencia.slice(0, 7)))].sort().reverse(),
    [nfs]
  );

  const nfsFiltradas = useMemo(() => {
    const termo = buscaNf.trim().toLowerCase();
    return nfs
      .filter((n) => filtroCompetencia === "TODAS" || n.competencia.slice(0, 7) === filtroCompetencia)
      .filter((n) => !termo || (n.variacao ?? "").toLowerCase().includes(termo) || (n.numero_nf ?? "").toLowerCase().includes(termo));
  }, [nfs, buscaNf, filtroCompetencia]);

  return (
    <>
      <div className="border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{contrato.nome}</p>
            <p className="text-xs text-muted-foreground">{contrato.cliente}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={onConfigurarModelo}>
              <Settings className="h-4 w-4 mr-1" /> Modelo de NFs
            </Button>
            {modelosAtivos.length > 0 ? (
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Nova NF <ChevronDown className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 p-0">
                  <Command
                    filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
                  >
                    <CommandInput placeholder="Buscar variação..." />
                    <CommandList>
                      <CommandEmpty>Nenhuma variação encontrada.</CommandEmpty>
                      <CommandGroup heading={`${modelosAtivos.length} variação(ões) do modelo`}>
                        {modelosAtivos.map((m) => {
                          const ultima = ultimaCompetenciaVariacao(m.variacao);
                          return (
                            <CommandItem
                              key={m.id}
                              value={m.variacao || "(sem nome)"}
                              onSelect={() => {
                                setPopoverOpen(false);
                                onNovaVariacao(m);
                              }}
                            >
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate font-medium">{m.variacao || "(sem nome)"}</span>
                                {ultima && (
                                  <span className="truncate text-[11px] text-muted-foreground">Última competência: {ultima}</span>
                                )}
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem
                          value="Nota avulsa (sem modelo)"
                          onSelect={() => {
                            setPopoverOpen(false);
                            onNovaNf();
                          }}
                        >
                          <span className="text-muted-foreground">Nota avulsa (sem modelo)</span>
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <Button size="sm" onClick={onNovaNf}>
                <Plus className="h-4 w-4 mr-1" /> Nova NF
              </Button>
            )}
          </div>
        </div>

        {nfs.length > 8 && (
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={buscaNf}
                onChange={(e) => setBuscaNf(e.target.value)}
                placeholder="Buscar por variação ou nº da nota…"
                className="h-8 w-full rounded border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary"
              />
            </div>
            <Select value={filtroCompetencia} onValueChange={setFiltroCompetencia}>
              <SelectTrigger className="h-8 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {competencias.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c === "TODAS" ? "Toda competência" : c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="overflow-auto flex-1">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variação</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead>Data Emissão</TableHead>
              <TableHead>Nº NF</TableHead>
              <TableHead>Valor Bruto</TableHead>
              <TableHead>Valor Líquido</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && nfsFiltradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  {nfs.length === 0 ? "Nenhuma NF cadastrada para este contrato." : "Nenhuma NF encontrada com esse filtro."}
                </TableCell>
              </TableRow>
            )}
            {nfsFiltradas.map((nf) => (
              <TableRow key={nf.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onSelecionar(nf)}>
                <TableCell>{nf.variacao ?? "-"}</TableCell>
                <TableCell>
                  {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                </TableCell>
                <TableCell>{fmtDate(nf.data_emissao)}</TableCell>
                <TableCell>{nf.numero_nf ?? "-"}</TableCell>
                <TableCell>{fmtMoney(nf.vlr_bruto_total)}</TableCell>
                <TableCell>{fmtMoney(nf.vlr_liquido_total)}</TableCell>
                <TableCell>
                  <Badge className={STATUS_CLASS[nf.status]}>{STATUS_LABEL[nf.status]}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

interface NovaNfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string | null;
  contratos: ContratoERP[];
  nfParaEditar?: NfEmissaoRow | null;
  contratoIdInicial?: string | null;
  seed?: NovaNfSeed | null;
}

function NovaNfDialog({ open, onOpenChange, empresaId, contratos, nfParaEditar, contratoIdInicial, seed }: NovaNfDialogProps) {
  const editando = !!nfParaEditar;
  const contratoTravado = editando || !!contratoIdInicial;
  const salvar = useSalvarNfEmissao();
  const atualizar = useAtualizarNfEmissao();
  const enviar = useEnviarNfEmissao();
  const { data: planilha = [] } = usePlanilhaCustos();
  const { data: itensExistentes = [] } = useItensNfEmissao(editando ? nfParaEditar?.id : undefined);
  const { data: anexosExistentes = [] } = useAnexosNfEmissao(editando ? nfParaEditar?.id : undefined);

  const [contratoId, setContratoId] = useState("");
  const [variacao, setVariacao] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [dataEmissao, setDataEmissao] = useState("");
  const [tipoNota, setTipoNota] = useState<TipoNota>("N");
  const [descricao, setDescricao] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [itens, setItens] = useState<(ItemInput & { identificacao: string })[]>([itemVazio(1)]);
  const [anexos, setAnexos] = useState<File[]>([]);
  const [anexosParaRemover, setAnexosParaRemover] = useState<Set<string>>(new Set());
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set([0]));
  const [unitariosPorItem, setUnitariosPorItem] = useState<(number | null)[]>([null]);
  const [modeloIdOrigem, setModeloIdOrigem] = useState<string | null>(null);
  const [pctFiscais, setPctFiscais] = useState<PercentuaisFiscais | null>(null);

  useEffect(() => {
    if (!open) return;
    if (nfParaEditar) {
      setContratoId(nfParaEditar.contrato_id);
      setVariacao(nfParaEditar.variacao ?? "");
      setCompetencia(nfParaEditar.competencia);
      setDataEmissao(nfParaEditar.data_emissao ?? "");
      setTipoNota(nfParaEditar.tipo_nota);
      setDescricao(nfParaEditar.descricao ?? "");
      setObservacoes(nfParaEditar.observacoes ?? "");
      setAnexosParaRemover(new Set());
      setPctFiscais({
        issqn_pct: nfParaEditar.issqn_pct,
        ir_pct: nfParaEditar.ir_pct,
        cofins_pct: nfParaEditar.cofins_pct,
        pis_pct: nfParaEditar.pis_pct,
        csll_pct: nfParaEditar.csll_pct,
      });
    } else if (seed) {
      setContratoId(contratoIdInicial ?? "");
      setVariacao(seed.variacao);
      setItens(seed.itens);
      setUnitariosPorItem(seed.unitarios);
      setExpandidos(new Set());
      setModeloIdOrigem(seed.modeloId);
      setPctFiscais(seed.pctFiscais);
    } else if (contratoIdInicial) {
      setContratoId(contratoIdInicial);
      const c = contratos.find((x) => x.id === contratoIdInicial);
      setPctFiscais(c ? pctFiscaisDoContrato(c) : null);
    }
  }, [open, nfParaEditar?.id, contratoIdInicial, seed]);

  useEffect(() => {
    if (!open || !nfParaEditar || itensExistentes.length === 0) return;
    setItens(
      itensExistentes.map((r) => ({
        identificacao: r.identificacao ?? "",
        valor_contrato_exec: r.valor_contrato_exec,
        vlr_va: r.vlr_va,
        vlr_vt: r.vlr_vt,
        vlr_materiais: r.vlr_materiais,
        faltas: r.faltas,
        posto_nao_implementado: r.posto_nao_implementado,
        multas: r.multas,
        glosas: r.glosas,
        outros_descontos: r.outros_descontos,
        multas_pos_emissao: r.multas_pos_emissao,
        glosas_pos_emissao: r.glosas_pos_emissao,
        outros_descontos_pos_emissao: r.outros_descontos_pos_emissao,
        qtd_colaboradores: r.qtd_colaboradores,
        inss_categoria: r.inss_categoria,
      }))
    );
    setExpandidos(new Set());
    setUnitariosPorItem(itensExistentes.map(() => null));
  }, [open, nfParaEditar?.id, itensExistentes]);

  const contratoSelecionado = contratos.find((c) => c.id === contratoId) ?? null;

  const postosVigentes = useMemo(
    () => (contratoId ? resolverPostosVigentes(planilha, contratoId) : []),
    [planilha, contratoId]
  );

  const itensCalculados: ItemCalculado[] = useMemo(() => {
    if (!pctFiscais) return [];
    return itens.map((it) => calcularItem(it, pctFiscais));
  }, [itens, pctFiscais]);

  const totais = useMemo(() => calcularTotaisNf(itensCalculados), [itensCalculados]);

  function updateItem(i: number, patch: Partial<ItemInput & { identificacao: string }>) {
    setItens((arr) => arr.map((it, k) => (k === i ? { ...it, ...patch } : it)));
    if ("valor_contrato_exec" in patch && !("qtd_colaboradores" in patch)) {
      setUnitariosPorItem((arr) => arr.map((u, k) => (k === i ? null : u)));
    }
  }
  function addItem() {
    setItens((arr) => {
      setExpandidos((exp) => new Set(exp).add(arr.length));
      return [...arr, itemVazio(arr.length + 1)];
    });
    setUnitariosPorItem((arr) => [...arr, null]);
  }
  function removeItem(i: number) {
    setItens((arr) => (arr.length > 1 ? arr.filter((_, k) => k !== i) : arr));
    setUnitariosPorItem((arr) => (arr.length > 1 ? arr.filter((_, k) => k !== i) : arr));
  }
  function toggleExpandido(i: number) {
    setExpandidos((exp) => {
      const n = new Set(exp);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  }
  function selecionarPosto(i: number, posto: string) {
    const p = postosVigentes.find((pv) => pv.posto === posto);
    if (!p) return;
    updateItem(i, { identificacao: p.posto, valor_contrato_exec: p.valorTotal, qtd_colaboradores: p.qtdColaboradores });
    setUnitariosPorItem((arr) => arr.map((u, k) => (k === i ? p.valorUnitario : u)));
  }
  function qtdColaboradoresChange(i: number, novaQtd: number) {
    const unit = unitariosPorItem[i];
    if (unit != null) {
      updateItem(i, { qtd_colaboradores: novaQtd, valor_contrato_exec: Math.round(unit * novaQtd * 100) / 100 });
    } else {
      updateItem(i, { qtd_colaboradores: novaQtd });
    }
  }

  function reset() {
    setContratoId("");
    setVariacao("");
    setCompetencia("");
    setDataEmissao("");
    setTipoNota("N");
    setDescricao("");
    setObservacoes("");
    setItens([itemVazio(1)]);
    setAnexos([]);
    setAnexosParaRemover(new Set());
    setExpandidos(new Set([0]));
    setUnitariosPorItem([null]);
    setModeloIdOrigem(null);
    setPctFiscais(null);
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  function validar(): string | null {
    if (!empresaId) return "Empresa não identificada.";
    if (!contratoId) return "Selecione o Contrato.";
    if (!pctFiscais) return "Este contrato ainda não tem Dados Fiscais cadastrados — cadastre antes de emitir a NF.";
    if (!competencia) return "Informe a Competência.";
    if (itensCalculados.length === 0) return "Adicione ao menos um item.";
    return null;
  }

  async function handleSalvar(status: "rascunho" | "enviada") {
    const erro = validar();
    if (erro) {
      toast.error(erro);
      return;
    }
    const pctFiscaisParaSalvar: PercentuaisFiscais = pctFiscais!;
    try {
      if (editando && nfParaEditar) {
        await atualizar.mutateAsync({
          id: nfParaEditar.id,
          empresa_id: empresaId!,
          contrato_id: contratoId,
          variacao: variacao || null,
          competencia,
          data_emissao: dataEmissao || null,
          tipo_nota: tipoNota,
          descricao: descricao || null,
          observacoes: observacoes || null,
          itens: itensCalculados,
          totais,
          pctFiscais: pctFiscaisParaSalvar,
          anexosNovos: anexos.map((file) => ({ file })),
          anexosParaRemover: anexosExistentes
            .filter((a: any) => anexosParaRemover.has(a.id))
            .map((a: any) => ({ id: a.id, storage_path: a.storage_path })),
          status,
        });
        await registrarLogNf(nfParaEditar.id, "nf_editada", "Analista editou a NF");
        toast.success(status === "enviada" ? "NF atualizada e enviada para o Financeiro." : "Alterações salvas.");
      } else {
        const nfId = await salvar.mutateAsync({
          empresa_id: empresaId!,
          contrato_id: contratoId,
          variacao: variacao || null,
          competencia,
          data_emissao: dataEmissao || null,
          numero_nf: null,
          tipo_nota: tipoNota,
          descricao: descricao || null,
          observacoes: observacoes || null,
          itens: itensCalculados,
          totais,
          pctFiscais: pctFiscaisParaSalvar,
          anexos: anexos.map((file) => ({ file })),
          status: "rascunho",
          nf_emissao_modelo_id: modeloIdOrigem,
        });
        if (status === "enviada") {
          await enviar.mutateAsync(nfId);
          await registrarLogNf(nfId, "nf_criada", "NF criada e enviada para o Financeiro");
        } else {
          await registrarLogNf(nfId, "nf_criada", "NF criada como rascunho");
        }
        toast.success(status === "enviada" ? "NF enviada para o Financeiro." : "NF salva como rascunho.");
      }
      handleClose(false);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar NF.");
    }
  }

  const salvando = salvar.isPending || atualizar.isPending || enviar.isPending;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-screen h-screen max-w-none max-h-screen overflow-y-auto overflow-x-hidden rounded-none sm:rounded-none">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar NF" : "Nova NF"}</DialogTitle>
          <DialogDescription>
            {editando
              ? "Corrija os dados desta NF ainda em rascunho."
              : "Preencha os dados da nota e os itens/postos do contrato."}
          </DialogDescription>
        </DialogHeader>

        <section className="rounded-xl border bg-card p-3 space-y-3">
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2">
              <Label>
                Contrato <span className="text-destructive">*</span>
              </Label>
              {contratoTravado ? (
                <div className="flex h-10 items-center rounded-md border border-input bg-muted px-3 text-sm">
                  {contratoSelecionado?.nome ?? nfParaEditar?.contrato?.nome ?? "-"}
                </div>
              ) : (
                <Select
                  value={contratoId}
                  onValueChange={(v) => {
                    setContratoId(v);
                    const c = contratos.find((x) => x.id === v);
                    setPctFiscais(c ? pctFiscaisDoContrato(c) : null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o contrato" />
                  </SelectTrigger>
                  <SelectContent>
                    {contratos.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {contratoId && !pctFiscais && (
                <p className="mt-1 text-xs text-destructive">
                  Contrato sem Dados Fiscais cadastrados — por isso Vlr Bruto/Líquido não aparecem abaixo.{" "}
                  <Link to="/app/licitacoes/contratos" className="underline">
                    Cadastrar agora
                  </Link>
                  .
                </p>
              )}
            </div>
            <div>
              <Label>Variação</Label>
              <Input placeholder="Ex: Prédio I" value={variacao} onChange={(e) => setVariacao(e.target.value)} />
            </div>
            <div>
              <Label>
                Competência <span className="text-destructive">*</span>
              </Label>
              <Input type="month" value={competencia ? competencia.slice(0, 7) : ""} onChange={(e) => setCompetencia(e.target.value ? `${e.target.value}-01` : "")} />
            </div>
            <div>
              <Label>Data de Emissão</Label>
              <Input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} />
            </div>
            <div>
              <Label>Tipo de Nota</Label>
              <Select value={tipoNota} onValueChange={(v) => setTipoNota(v as TipoNota)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPOS_NOTA).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Descrição</Label>
              <Textarea rows={1} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
          </div>

          {pctFiscais && (
            <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
              <Label className="text-xs">
                Retenção fiscal desta nota{" "}
                <span className="font-normal text-muted-foreground">(pré-preenchida pelo contrato/modelo — pode ajustar)</span>
              </Label>
              <div className="grid grid-cols-5 gap-2">
                {(
                  [
                    ["issqn_pct", "ISSQN (%)"],
                    ["ir_pct", "IR (%)"],
                    ["cofins_pct", "COFINS (%)"],
                    ["pis_pct", "PIS (%)"],
                    ["csll_pct", "CSLL (%)"],
                  ] as const
                ).map(([campo, label]) => (
                  <div key={campo}>
                    <Label className="text-[10px] text-muted-foreground">{label}</Label>
                    <Input
                      className="h-8 text-xs"
                      type="number"
                      step="0.01"
                      value={pctFiscais[campo] ? pctFiscais[campo] * 100 : ""}
                      onChange={(e) =>
                        setPctFiscais((p) => (p ? { ...p, [campo]: e.target.value.trim() ? Number(e.target.value) / 100 : 0 } : p))
                      }
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <ItensNfEditor
          itens={itens}
          itensCalculados={itensCalculados}
          totais={totais}
          pctFiscais={pctFiscais}
          postosVigentes={postosVigentes}
          contratoId={contratoId}
          expandidos={expandidos}
          onUpdateItem={updateItem}
          onAddItem={addItem}
          onRemoveItem={removeItem}
          onToggleExpandido={toggleExpandido}
          onSelecionarPosto={selecionarPosto}
          onQtdColaboradoresChange={qtdColaboradoresChange}
        />

        <section className="rounded-xl border bg-card p-3 space-y-2">
          <Label>Observações</Label>
          <Textarea
            rows={2}
            placeholder="Anotações internas, não entra na nota."
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
          />
        </section>

        <section className="rounded-xl border bg-card p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Anexos (PDF/XML da nota)</div>
            <label className="cursor-pointer">
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) setAnexos((a) => [...a, ...Array.from(e.target.files!)]);
                  e.target.value = "";
                }}
              />
              <span className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                <Plus className="h-4 w-4" /> Adicionar arquivo
              </span>
            </label>
          </div>
          {editando && anexosExistentes.filter((a: any) => !anexosParaRemover.has(a.id)).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Já enviados:</p>
              <ul className="space-y-2">
                {anexosExistentes
                  .filter((a: any) => !anexosParaRemover.has(a.id))
                  .map((a: any) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{a.file_name}</div>
                        <div className="text-xs text-muted-foreground">{((a.size_bytes ?? 0) / 1024).toFixed(1)} KB</div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setAnexosParaRemover((s) => new Set(s).add(a.id))}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          {anexos.length === 0 ? (
            <div className="rounded-lg border border-dashed py-4 text-center text-sm text-muted-foreground">
              Nenhum arquivo novo anexado.
            </div>
          ) : (
            <ul className="space-y-2">
              {anexos.map((f, i) => (
                <li key={i} className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{f.name}</div>
                    <div className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setAnexos((arr) => arr.filter((_, k) => k !== i))}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancelar
          </Button>
          <Button variant="secondary" onClick={() => handleSalvar("rascunho")} disabled={salvando}>
            {editando ? "Salvar alterações" : "Salvar como rascunho"}
          </Button>
          <Button onClick={() => handleSalvar("enviada")} disabled={salvando}>
            {salvando ? "Enviando..." : "Enviar para o Financeiro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetalhesNfDialog({
  nf,
  onClose,
  onEditar,
}: {
  nf: NfEmissaoRow | null;
  onClose: () => void;
  onEditar: (nf: NfEmissaoRow) => void;
}) {
  const { data: itens = [] } = useItensNfEmissao(nf?.id);
  const { data: anexos = [] } = useAnexosNfEmissao(nf?.id);
  const enviar = useEnviarNfEmissao();
  const excluir = useExcluirNfEmissao();
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  async function handleBaixar(storagePath: string) {
    try {
      const url = await baixarAnexoNfEmissao(storagePath);
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao baixar anexo.");
    }
  }

  async function handleEnviar() {
    if (!nf) return;
    try {
      await enviar.mutateAsync(nf.id);
      await registrarLogNf(nf.id, "nf_enviada", "Enviada para o Financeiro");
      toast.success("NF enviada para o Financeiro.");
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao enviar NF.");
    }
  }

  async function handleExcluir() {
    if (!nf) return;
    try {
      await excluir.mutateAsync({ id: nf.id, anexos: anexos.map((a: any) => ({ storage_path: a.storage_path })) });
      toast.success("NF excluída.");
      setConfirmandoExclusao(false);
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao excluir NF.");
    }
  }

  return (
    <Dialog open={!!nf} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="w-screen h-screen max-w-none max-h-screen overflow-y-auto overflow-x-hidden rounded-none sm:rounded-none">
        <DialogHeader>
          <DialogTitle>Detalhes da NF</DialogTitle>
          <DialogDescription>
            {nf?.status === "rascunho"
              ? "Rascunho — pode ser editado antes de enviar para o Financeiro."
              : "Visualização somente leitura."}
          </DialogDescription>
        </DialogHeader>

        {nf && (
          <>
            <section className="rounded-xl border bg-card p-3 space-y-3">
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Contrato</p>
                  <p className="font-medium">{nf.contrato?.nome ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Variação</p>
                  <p className="font-medium">{nf.variacao ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <Badge className={STATUS_CLASS[nf.status]}>{STATUS_LABEL[nf.status]}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Competência</p>
                  <p className="font-medium">
                    {new Date(nf.competencia + "T00:00:00").toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" })}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Data de Emissão</p>
                  <p className="font-medium">{fmtDate(nf.data_emissao)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Nº NF</p>
                  <p className="font-medium">{nf.numero_nf ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tipo de Nota</p>
                  <p className="font-medium">{TIPOS_NOTA[nf.tipo_nota]}</p>
                </div>
                {nf.descricao && (
                  <div className="col-span-4">
                    <p className="text-xs text-muted-foreground">Descrição</p>
                    <p>{nf.descricao}</p>
                  </div>
                )}
                {nf.observacoes && (
                  <div className="col-span-4">
                    <p className="text-xs text-muted-foreground">Observações</p>
                    <p>{nf.observacoes}</p>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-xl border bg-card p-3 space-y-3">
              <div className="text-sm font-semibold">Itens / Postos</div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px] px-2">Posto / Identificação</TableHead>
                      <TableHead className="min-w-[110px] px-2">Contrato Exec.</TableHead>
                      <TableHead className="min-w-[110px] px-2">Vlr Bruto</TableHead>
                      <TableHead className="min-w-[110px] px-2">Vlr Líquido</TableHead>
                      <TableHead className="w-8 px-1" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {itens.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell className="px-2 py-1 text-sm font-medium">{it.identificacao}</TableCell>
                        <TableCell className="px-2 py-1 text-sm">{fmtMoney(it.valor_contrato_exec)}</TableCell>
                        <TableCell className="px-2 py-1 text-sm">{fmtMoney(it.vlr_bruto)}</TableCell>
                        <TableCell className="px-2 py-1 text-sm font-medium">{fmtMoney(it.vlr_liquido)}</TableCell>
                        <TableCell className="px-1 py-1">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" title="Ver cálculo">
                                <Calculator className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80 text-sm space-y-1.5">
                              <p className="font-semibold mb-1">Detalhamento — {it.identificacao}</p>
                              <Linha label="Vlr Contrato Exec." valor={it.valor_contrato_exec} />
                              <Linha label="Total Descontos" valor={-it.total_descontos} />
                              <Linha label="Vlr Bruto" valor={it.vlr_bruto} destaque />
                              <Linha label="Vlr Mão de Obra" valor={it.vlr_mao_obra} />
                              <div className="border-t pt-1.5 space-y-1">
                                <Linha label={`ISSQN (${fmtPct(nf.issqn_pct)} s/ bruto)`} valor={-it.issqn} />
                                <Linha
                                  label={`INSS (${INSS_CATEGORIAS[it.inss_categoria].label}, ${fmtPct(INSS_CATEGORIAS[it.inss_categoria].pct)} s/ mão de obra)`}
                                  valor={-it.inss}
                                />
                                <Linha label={`IR (${fmtPct(nf.ir_pct)} s/ bruto)`} valor={-it.ir} />
                                <Linha label={`COFINS (${fmtPct(nf.cofins_pct)} s/ bruto)`} valor={-it.cofins} />
                                <Linha label={`PIS (${fmtPct(nf.pis_pct)} s/ bruto)`} valor={-it.pis} />
                                <Linha label={`CSLL (${fmtPct(nf.csll_pct)} s/ bruto)`} valor={-it.csll} />
                              </div>
                              <Linha label="Vlr Líquido" valor={it.vlr_liquido} destaque />
                            </PopoverContent>
                          </Popover>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span>
                  <span className="text-muted-foreground">Bruto total: </span>
                  <span className="font-medium">{fmtMoney(nf.vlr_bruto_total)}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">ISSQN ({fmtPct(nf.issqn_pct)}): </span>
                  {fmtMoney(nf.issqn_total)}
                </span>
                <span>
                  <span className="text-muted-foreground">INSS: </span>
                  {fmtMoney(nf.inss_total)}
                </span>
                <span>
                  <span className="text-muted-foreground">IR ({fmtPct(nf.ir_pct)}): </span>
                  {fmtMoney(nf.ir_total)}
                </span>
                <span>
                  <span className="text-muted-foreground">COFINS ({fmtPct(nf.cofins_pct)}): </span>
                  {fmtMoney(nf.cofins_total)}
                </span>
                <span>
                  <span className="text-muted-foreground">PIS ({fmtPct(nf.pis_pct)}): </span>
                  {fmtMoney(nf.pis_total)}
                </span>
                <span>
                  <span className="text-muted-foreground">CSLL ({fmtPct(nf.csll_pct)}): </span>
                  {fmtMoney(nf.csll_total)}
                </span>
                <span>
                  <span className="text-muted-foreground">Líquido total: </span>
                  <span className="font-semibold">{fmtMoney(nf.vlr_liquido_total)}</span>
                </span>
              </div>
            </section>

            <section className="rounded-xl border bg-card p-3 space-y-3">
              <div className="text-sm font-semibold">Anexos (PDF/XML da nota)</div>
              {anexos.length === 0 ? (
                <div className="rounded-lg border border-dashed py-4 text-center text-sm text-muted-foreground">
                  Nenhum arquivo anexado.
                </div>
              ) : (
                <ul className="space-y-2">
                  {anexos.map((a: any) => (
                    <li key={a.id} className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
                      <FileText className="h-4 w-4 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{a.file_name}</div>
                        <div className="text-xs text-muted-foreground">{((a.size_bytes ?? 0) / 1024).toFixed(1)} KB</div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => handleBaixar(a.storage_path)}>
                        Baixar
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border bg-card p-3 space-y-3">
              <div className="text-sm font-semibold">Histórico</div>
              <HistoricoNfPainel nfEmissaoId={nf.id} />
            </section>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          {nf?.status === "rascunho" && (
            <>
              <Button variant="destructive" onClick={() => setConfirmandoExclusao(true)}>
                Excluir
              </Button>
              <Button variant="secondary" onClick={() => onEditar(nf)}>
                Editar
              </Button>
              <Button onClick={handleEnviar} disabled={enviar.isPending}>
                {enviar.isPending ? "Enviando..." : "Enviar para o Financeiro"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>

      <AlertDialog open={confirmandoExclusao} onOpenChange={setConfirmandoExclusao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta NF?</AlertDialogTitle>
            <AlertDialogDescription>
              Os anexos enviados também serão removidos. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleExcluir}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
