// =====================================================================
// RH › RATEIO DE DESPESAS (/app/rh/rateio-despesas) — mig 20261016000010
// Chamado SIS-2026-0673.
//
// Lança a despesa (tipo, competência, valor, anexo), calcula o rateio por
// contrato, deixa conferir/ajustar e exporta o Excel:
//   · Jus Brasil → faturamento do contrato (planilha do RH, importável);
//   · Senior → colaboradores TRABALHANDO por contrato (EMPREGADOS);
//   · FGTS, Bullla, Seguro, BSF, Gratificação PCD, Mensalidade SEEAC → PDF
//     da despesa: linha com CPF → colaborador → contrato; sem CPF, linha
//     com o nome do contrato. O que não casar fica para escolher na tela.
// Regras de conta em src/lib/rh/rateioDespesas.ts (testadas).
// =====================================================================
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CurrencyInput } from "@/components/ui/CurrencyInput";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, FileText, History, Loader2,
  Lock, Paperclip, Plus, RotateCcw, Save, Search, Send, Sparkles, Trash2, Upload, Users,
} from "lucide-react";
import { EnviarRateioMalote } from "./EnviarRateioMalote";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  carregarDespesaRateio, carregarUltimoDoTipo, casarCpfs, lerRateioComIa, linkAnexoRateio, subirAnexoRateio,
  useContratosRateio, useDespesasRateio, useExcluirRateio, useMaloteDosRateios, useSalvarRateio,
  type ContratoRateio, type DespesaRateio, type LeituraIaRateio, type LinhaDetalhePdf,
} from "@/hooks/useRateioDespesas";
import {
  TIPOS_RATEIO, ROTULO_CRITERIO, SEM_CONTRATO, acharContrato, calcularRateio, competenciaParaData,
  competenciaRotulo, criterioPadrao, extrairLinhasPorContrato, fmtMoeda, fmtPct,
  extrairLinhasDoPdf, identificarLayoutPdf, linhasDoLayout, totalDoPdf,
  lerPlanilhaJusBrasil, resumirRateio, rotuloTipo, somarPorContrato, tipoUsaPdf,
  type ContratoRef, type CriterioRateio, type ItemRateio, type LinhaPlanilhaJus, type TipoRateio,
} from "@/lib/rh/rateioDespesas";
import { lerLinhasPdf } from "@/lib/rh/rateioPdf";

const MENU = "rh_rateio_despesas";
const SEM = "__sem__";
const chave = (id: string | null) => id ?? SEM;
const LIMITE_LINHAS_TELA = 300;

interface Base {
  contrato_id: string | null;
  contrato_nome: string;
  base: number;
  qtd: number | null;
}

const mesAtual = () => new Date().toISOString().slice(0, 7);
const mascaraCpf = (d: string | null) =>
  d && d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : "—";

// ── Página ──────────────────────────────────────────────────────────────
export default function RateioDespesas() {
  const [aberto, setAberto] = useState<string | "novo" | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Rateio de Despesas"
        subtitle="Divide a despesa entre os contratos: Jus Brasil pelo faturamento, Senior pelos colaboradores trabalhando e FGTS, Bullla, Seguro, BSF, Gratificação PCD e SEEAC pelo PDF da despesa."
        module="Recursos Humanos"
        breadcrumb={["Recursos Humanos", "Rateio de Despesas"]}
      />
      {aberto ? (
        <Editor key={aberto} id={aberto === "novo" ? null : aberto} onFechar={() => setAberto(null)} onSalvo={(id) => setAberto(id)} />
      ) : (
        <Lista onAbrir={setAberto} />
      )}
    </div>
  );
}

// ── Lista ───────────────────────────────────────────────────────────────
function Lista({ onAbrir }: { onAbrir: (id: string | "novo") => void }) {
  const q = useDespesasRateio();
  const { data: podeIncluir } = useScreenAccess(MENU, "incluir");
  const [tipo, setTipo] = useState<string>("todos");
  const [mes, setMes] = useState("");
  const [busca, setBusca] = useState("");
  const linhas = useMemo(
    () =>
      (q.data ?? []).filter(
        (d) =>
          (tipo === "todos" || d.tipo === tipo) &&
          (!mes || d.competencia.startsWith(mes)) &&
          (!busca || `${rotuloTipo(d.tipo)} ${d.descricao ?? ""}`.toLowerCase().includes(busca.toLowerCase())),
      ),
    [q.data, tipo, mes, busca],
  );
  const malote = useMaloteDosRateios((q.data ?? []).filter((d) => d.malote_despesa_id).map((d) => d.id)).data;

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={tipo} onValueChange={setTipo}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {TIPOS_RATEIO.map((t) => <SelectItem key={t.tipo} value={t.tipo}>{t.rotulo}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Competência</Label>
          <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-44" />
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar na descrição…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        {podeIncluir && (
          <Button className="gap-1.5" onClick={() => onAbrir("novo")}>
            <Plus className="h-4 w-4" /> Nova despesa
          </Button>
        )}
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : q.error ? (
        <div className="py-6 text-center text-destructive text-sm">{(q.error as Error).message}</div>
      ) : linhas.length === 0 ? (
        <div className="py-10 text-center text-muted-foreground text-sm">Nenhuma despesa lançada{tipo !== "todos" || mes || busca ? " com esse filtro" : ""}.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left py-2 px-2">Competência</th>
                <th className="text-left px-2">Tipo</th>
                <th className="text-left px-2">Descrição</th>
                <th className="text-right px-2">Valor</th>
                <th className="text-left px-2">Critério</th>
                <th className="text-left px-2">Status</th>
                <th className="text-left px-2">Lançado por</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((d) => (
                <tr key={d.id} className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => onAbrir(d.id)}>
                  <td className="py-2 px-2 font-medium">{competenciaRotulo(d.competencia)}</td>
                  <td className="px-2">{rotuloTipo(d.tipo)}</td>
                  <td className="px-2 text-muted-foreground truncate max-w-[280px]">
                    {d.anexo_nome && <Paperclip className="inline h-3 w-3 mr-1" />}
                    {d.descricao ?? ""}
                  </td>
                  <td className="px-2 text-right tabular-nums">{fmtMoeda(d.valor)}</td>
                  <td className="px-2 text-xs">{ROTULO_CRITERIO[d.criterio]}</td>
                  <td className="px-2">
                    {d.status === "conferido"
                      ? <Badge className="bg-success/15 text-success border-success/30" variant="outline">Conferido</Badge>
                      : <Badge variant="outline">Rascunho</Badge>}
                    {malote?.get(d.id)?.ativo && (
                      <Badge variant="outline" className="ml-1 gap-1"><Send className="h-3 w-3" /> {malote.get(d.id)?.numero}</Badge>
                    )}
                  </td>
                  <td className="px-2 text-xs text-muted-foreground">{d.alterado_por_nome ?? d.criado_por_nome ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────
function Editor({ id, onFechar, onSalvo }: { id: string | null; onFechar: () => void; onSalvo: (id: string) => void }) {
  const contratosQ = useContratosRateio();
  const salvar = useSalvarRateio();
  const excluir = useExcluirRateio();
  const { data: podeIncluir } = useScreenAccess(MENU, "incluir");
  const { data: podeAlterar } = useScreenAccess(MENU, "alterar");
  const { data: podeExcluir } = useScreenAccess(MENU, "excluir");
  const { data: podeExportar } = useScreenAccess(MENU, "exportar");
  const { data: podeEnviarMalote } = useScreenAccess(MENU, "enviar_malote");
  // Enviado ao Malote (mig 20261016000020): enquanto a despesa de lá existir,
  // o rateio fica travado (o banco também recusa salvar/excluir).
  const maloteQ = useMaloteDosRateios(id ? [id] : []);
  const noMalote = id ? maloteQ.data?.get(id) ?? null : null;
  const travadoMalote = !!noMalote?.ativo;
  const [enviandoMalote, setEnviandoMalote] = useState(false);
  const podeGravar = (id ? !!podeAlterar : !!podeIncluir) && !travadoMalote;

  const [carregando, setCarregando] = useState(!!id);
  const [tipo, setTipo] = useState<TipoRateio>("jusbrasil");
  const [criterio, setCriterio] = useState<CriterioRateio>("faturamento");
  const [mes, setMes] = useState(mesAtual());
  const [valorTxt, setValorTxt] = useState("");
  const [descricao, setDescricao] = useState("");
  const [status, setStatus] = useState<"rascunho" | "conferido">("rascunho");
  const [anexoPath, setAnexoPath] = useState<string | null>(null);
  const [anexoNome, setAnexoNome] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [bases, setBases] = useState<Base[]>([]);
  const [ajustes, setAjustes] = useState<Record<string, number>>({});
  const [linhasPdf, setLinhasPdf] = useState<LinhaDetalhePdf[]>([]);
  const [planilha, setPlanilha] = useState<(LinhaPlanilhaJus & { contrato: ContratoRef | null })[] | null>(null);
  const [lendo, setLendo] = useState(false);
  const [avisoPdf, setAvisoPdf] = useState<string | null>(null);
  // Do PDF lido agora (não é gravado): total que ele declara e qual layout foi reconhecido.
  const [pdfInfo, setPdfInfo] = useState<{ total: number | null; rotulo: string } | null>(null);
  // Texto do PDF lido agora (para a I.A reler sem pedir o arquivo de novo) e o que ela respondeu.
  const [linhasBrutas, setLinhasBrutas] = useState<string[] | null>(null);
  const [lendoIa, setLendoIa] = useState(false);
  const [leituraIa, setLeituraIa] = useState<LeituraIaRateio | null>(null);
  const [soPendentes, setSoPendentes] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [soComBase, setSoComBase] = useState(false);
  const inputPdf = useRef<HTMLInputElement>(null);
  const inputXlsx = useRef<HTMLInputElement>(null);

  const contratos: ContratoRateio[] = useMemo(() => (contratosQ.data ?? []).filter((c) => c.contrato_id), [contratosQ.data]);
  const refs: ContratoRef[] = useMemo(
    () => contratos.map((c) => ({ id: c.contrato_id as string, nome: c.nome ?? "", status: c.status })),
    [contratos],
  );
  const nomeContrato = (cid: string | null) => (cid ? contratos.find((c) => c.contrato_id === cid)?.nome ?? "(contrato removido)" : SEM_CONTRATO);
  const opcoesContrato = useMemo(
    () => [
      { value: SEM, label: SEM_CONTRATO },
      ...contratos.map((c) => ({ value: c.contrato_id as string, label: c.nome ?? "", muted: c.status === "encerrado", hint: c.status === "encerrado" ? "encerrado" : undefined })),
    ],
    [contratos],
  );

  // Carregar despesa existente
  useEffect(() => {
    if (!id) return;
    let vivo = true;
    carregarDespesaRateio(id)
      .then(({ despesa, itens }) => {
        if (!vivo) return;
        setTipo(despesa.tipo);
        setCriterio(despesa.criterio);
        setMes(despesa.competencia.slice(0, 7));
        setValorTxt(String(despesa.valor));
        setDescricao(despesa.descricao ?? "");
        setStatus(despesa.status);
        setAnexoPath(despesa.anexo_path);
        setAnexoNome(despesa.anexo_nome);
        setLinhasPdf(Array.isArray(despesa.detalhe) ? despesa.detalhe : []);
        setBases(itens.map((i) => ({ contrato_id: i.contrato_id, contrato_nome: i.contrato_nome, base: i.base, qtd: i.qtd })));
        const aj: Record<string, number> = {};
        itens.filter((i) => i.ajustado).forEach((i) => (aj[chave(i.contrato_id)] = i.valor));
        setAjustes(aj);
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [id]);

  const valor = Number(valorTxt) || 0;
  const usaPdf = tipoUsaPdf(tipo);

  // Base efetiva: PDF com linhas → soma por contrato; senão a tabela de bases.
  const basesEfetivas: Base[] = useMemo(() => {
    if (usaPdf && linhasPdf.length) {
      return somarPorContrato(
        linhasPdf.map((l) => ({ contrato_id: l.contrato_id, contrato_nome: nomeContrato(l.contrato_id), valor: l.valor })),
      ).map((s) => ({ contrato_id: s.contrato_id, contrato_nome: s.contrato_nome, base: s.base, qtd: s.qtd }));
    }
    return bases;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usaPdf, linhasPdf, bases, contratos]);

  const itens: ItemRateio[] = useMemo(
    () =>
      calcularRateio(
        valor,
        basesEfetivas.map((b) => {
          const aj = ajustes[chave(b.contrato_id)];
          return {
            contrato_id: b.contrato_id, contrato_nome: b.contrato_nome, base: b.base, percentual: 0,
            valor: aj ?? 0, ajustado: aj != null,
          };
        }),
      ),
    [valor, basesEfetivas, ajustes],
  );
  const resumo = resumirRateio(valor, itens);
  const totalBase = basesEfetivas.reduce((a, b) => a + (b.base || 0), 0);
  const totalPdf = Math.round(linhasPdf.reduce((a, l) => a + l.valor, 0) * 100) / 100;
  const qtdPorChave = useMemo(() => new Map(basesEfetivas.map((b) => [chave(b.contrato_id), b.qtd])), [basesEfetivas]);

  // ── trocar tipo ───────────────────────────────────────────────────────
  const trocarTipo = (t: TipoRateio) => {
    setTipo(t);
    setCriterio(criterioPadrao(t));
    setBases([]);
    setAjustes({});
    setLinhasPdf([]);
    setPlanilha(null);
    setAvisoPdf(null);
  };

  // ── Senior: contar colaboradores ──────────────────────────────────────
  const contarColaboradores = async () => {
    const r = await contratosQ.refetch();
    const lista = (r.data ?? []).filter((c) => c.colaboradores > 0);
    setBases(
      lista
        .map((c) => ({ contrato_id: c.contrato_id, contrato_nome: c.contrato_id ? c.nome ?? "" : SEM_CONTRATO, base: c.colaboradores, qtd: c.colaboradores }))
        .sort((a, b) => b.base - a.base),
    );
    setAjustes({});
    toast.success(`${lista.reduce((a, c) => a + c.colaboradores, 0)} colaboradores trabalhando em ${lista.length} contrato(s).`);
  };
  useEffect(() => {
    if (!id && tipo === "senior" && !bases.length && contratosQ.data) void contarColaboradores();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tipo, contratosQ.data]);

  // ── Jus Brasil: bases por contrato ────────────────────────────────────
  const aplicarPlanilha = (p: typeof planilha, crit: CriterioRateio) => {
    if (!p) return;
    const m = new Map<string, Base>();
    for (const l of p) {
      const k = chave(l.contrato?.id ?? null);
      const v = crit === "consultas" ? l.consultas : l.faturamento;
      const cur = m.get(k) ?? { contrato_id: l.contrato?.id ?? null, contrato_nome: l.contrato ? l.contrato.nome : SEM_CONTRATO, base: 0, qtd: null };
      cur.base = Math.round((cur.base + v) * 100) / 100;
      m.set(k, cur);
    }
    setBases([...m.values()]);
    setAjustes({});
  };
  const importarPlanilha = async (f: File) => {
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const linhas = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null });
      const lidas = lerPlanilhaJusBrasil(linhas).map((l) => ({ ...l, contrato: acharContrato(l.nome, refs) }));
      setPlanilha(lidas);
      aplicarPlanilha(lidas, criterio);
      const sem = lidas.filter((l) => !l.contrato && (l.faturamento || l.consultas));
      toast.success(`${lidas.length} linhas lidas da planilha.` + (sem.length ? ` ${sem.length} com valor sem contrato encontrado — conferir abaixo.` : ""));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const repetirUltimo = async () => {
    try {
      const u = await carregarUltimoDoTipo(tipo, id);
      if (!u) return toast.info(`Nenhum ${rotuloTipo(tipo)} anterior para repetir.`);
      setCriterio(u.despesa.criterio);
      setBases(u.itens.map((i) => ({ contrato_id: i.contrato_id, contrato_nome: i.contrato_nome, base: i.base, qtd: i.qtd })));
      setAjustes({});
      toast.success(`Base copiada de ${rotuloTipo(tipo)} ${competenciaRotulo(u.despesa.competencia)}.`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const mudarBase = (cid: string | null, nome: string, v: number) =>
    setBases((bs) => {
      const i = bs.findIndex((b) => chave(b.contrato_id) === chave(cid));
      if (i < 0) return [...bs, { contrato_id: cid, contrato_nome: nome, base: v, qtd: null }];
      const out = [...bs];
      out[i] = { ...out[i], base: v };
      return out;
    });

  // ── PDF ───────────────────────────────────────────────────────────────
  const lerPdf = async (f: File) => {
    setArquivo(f);
    setAnexoNome(f.name);
    setAvisoPdf(null);
    setPdfInfo(null);
    setLinhasBrutas(null);
    setLeituraIa(null);
    setLendo(true);
    try {
      const linhas = await lerLinhasPdf(f);
      setLinhasBrutas(linhas);
      const layout = identificarLayoutPdf(linhas);
      const declarado = totalDoPdf(linhas, layout.layout);
      setPdfInfo({ total: declarado, rotulo: layout.rotulo });
      let lido = 0;
      const comCpf = extrairLinhasDoPdf(linhas, layout.layout);
      if (comCpf.length) {
        const casados = await casarCpfs([...new Set(comCpf.map((l) => l.cpf as string))]);
        const porCpf = new Map(casados.map((c) => [c.cpf, c]));
        const det: LinhaDetalhePdf[] = comCpf.map((l) => {
          const c = porCpf.get(l.cpf as string);
          return { n: l.n, texto: l.texto, cpf: l.cpf, nome: c?.nome ?? null, situacao: c?.situacao ?? null, valor: l.valor, contrato_id: c?.contrato_id ?? null };
        });
        setLinhasPdf(det);
        lido = det.reduce((a, d) => a + d.valor, 0);
        const semCad = det.filter((d) => !d.nome).length;
        const semCt = det.filter((d) => d.nome && !d.contrato_id).length;
        setSoPendentes(det.length > 200 && semCad + semCt > 0);
        if (semCad || semCt) setAvisoPdf(`${semCad ? `${semCad} CPF(s) não estão na EMPREGADOS` : ""}${semCad && semCt ? " e " : ""}${semCt ? `${semCt} colaborador(es) sem contrato` : ""} — escolha o contrato na lista abaixo.`);
      } else {
        const porContrato = extrairLinhasPorContrato(linhasDoLayout(linhas, layout.layout), refs);
        if (porContrato.length) {
          setLinhasPdf(porContrato.map((l) => ({ n: l.n, texto: l.texto, cpf: null, nome: null, situacao: null, valor: l.valor, contrato_id: l.contrato?.id ?? null })));
          lido = porContrato.reduce((a, l) => a + l.valor, 0);
        } else {
          setLinhasPdf([]);
          setAvisoPdf("Não achei neste PDF linhas com CPF e valor, nem com nome de contrato e valor. Preencha a base por contrato abaixo e mande este PDF ao TI para ajustarmos a leitura deste formato.");
        }
      }
      setAjustes({});
      // Preenche o valor da despesa sozinho (o total que o PDF declara; sem
      // linha de TOTAL, a soma lida) — só se ainda estiver em branco.
      const sugerido = declarado ?? (lido > 0 ? Math.round(lido * 100) / 100 : null);
      if (sugerido && !(Number(valorTxt) > 0)) setValorTxt(sugerido.toFixed(2));
    } catch (e) {
      setAvisoPdf((e as Error).message);
    } finally {
      setLendo(false);
    }
  };

  // A I.A relê o MESMO texto e devolve só valores que estão escritos nas
  // linhas que ela cita (conferido na Edge rh-rateio-ia). Substitui as linhas
  // lidas por regra; com CPF, o contrato continua vindo do cadastro.
  const lerComIa = async () => {
    if (!linhasBrutas) return;
    setLendoIa(true);
    try {
      const r = await lerRateioComIa(linhasBrutas, tipo);
      if (!r.linhas.length) {
        setLeituraIa(r);
        toast.error("A IA não achou uma base de rateio neste PDF — veja a explicação.");
        return;
      }
      const cpfs = [...new Set(r.linhas.map((l) => l.cpf).filter((c): c is string => !!c))];
      const porCpf = new Map((await casarCpfs(cpfs)).map((c) => [c.cpf, c]));
      setLinhasPdf(r.linhas.map((l) => {
        const c = l.cpf ? porCpf.get(l.cpf) : undefined;
        return {
          n: l.n, texto: l.texto, cpf: l.cpf, nome: c?.nome ?? null, situacao: c?.situacao ?? null,
          valor: l.valor, contrato_id: c?.contrato_id ?? l.contrato_id,
        };
      }));
      setAjustes({});
      setAvisoPdf(null);
      setSoPendentes(false);
      // O valor da despesa só muda se estava vazio ou era o total que a leitura automática sugeriu.
      if (r.total_despesa != null && (!(valor > 0) || (pdfInfo?.total != null && Math.abs(valor - pdfInfo.total) < 0.005))) {
        setValorTxt(r.total_despesa.toFixed(2));
      }
      setPdfInfo({ total: r.total_despesa, rotulo: `Leitura da I.A${r.origem_total ? ` — ${r.origem_total}` : ""}` });
      setLeituraIa(r);
      const semCt = r.linhas.filter((l) => !l.contrato_id && !l.cpf).length;
      toast.success(`IA leu ${r.linhas.length} linha(s)${semCt ? `, ${semCt} sem contrato — escolha abaixo` : ""}. Confira antes de salvar.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLendoIa(false);
    }
  };
  const mudarContratoLinha = (idx: number, cid: string) =>
    setLinhasPdf((ls) => ls.map((l, i) => (i === idx ? { ...l, contrato_id: cid === SEM ? null : cid } : l)));
  const removerLinha = (idx: number) => setLinhasPdf((ls) => ls.filter((_, i) => i !== idx));

  // ── ajuste manual de valor ────────────────────────────────────────────
  const ajustar = (cid: string | null, v: number | null) =>
    setAjustes((a) => {
      const out = { ...a };
      if (v == null) delete out[chave(cid)];
      else out[chave(cid)] = v;
      return out;
    });

  // ── gravar ────────────────────────────────────────────────────────────
  const gravar = async (novoStatus: "rascunho" | "conferido") => {
    if (!valor) return toast.error("Informe o valor da despesa.");
    if (!itens.length) return toast.error("O rateio está vazio.");
    if (novoStatus === "conferido" && !resumo.fecha) return toast.error(`A soma do rateio não bate com o valor (diferença ${fmtMoeda(resumo.diferenca)}).`);
    try {
      let path = anexoPath;
      if (arquivo) path = await subirAnexoRateio(arquivo);
      const novoId = await salvar.mutateAsync({
        id,
        tipo,
        competencia: competenciaParaData(mes),
        valor,
        descricao: descricao || null,
        criterio,
        status: novoStatus,
        anexo_path: path,
        anexo_nome: path ? anexoNome : null,
        detalhe: usaPdf && linhasPdf.length ? linhasPdf : null,
        itens: itens.map((i) => ({ ...i, qtd: qtdPorChave.get(chave(i.contrato_id)) ?? null })),
      });
      setArquivo(null);
      setAnexoPath(path);
      setStatus(novoStatus);
      toast.success(novoStatus === "conferido" ? "Rateio conferido e salvo." : "Rascunho salvo.");
      if (!id) onSalvo(novoId);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Enviar ao Malote parte do que está GRAVADO (a RPC confere o valor com o
  // banco): quem pode gravar salva como conferido antes de abrir o envio.
  const abrirEnvioMalote = async () => {
    if (podeGravar && (await gravar("conferido")) !== true) return;
    setEnviandoMalote(true);
  };

  const exportar = () => {
    const wb = XLSX.utils.book_new();
    const cab = [
      ["Rateio de Despesas — " + rotuloTipo(tipo)],
      ["Competência", competenciaRotulo(competenciaParaData(mes))],
      ["Valor da despesa", valor],
      ["Critério", ROTULO_CRITERIO[criterio]],
      ["Descrição", descricao],
      ["Status", status === "conferido" ? "Conferido" : "Rascunho"],
      [],
      ["Contrato", "Base", "Qtd", "%", "Valor rateado", "Ajustado à mão"],
    ];
    const corpo = itens.map((i) => [
      i.contrato_nome, i.base, qtdPorChave.get(chave(i.contrato_id)) ?? "", Math.round(i.percentual * 1e6) / 1e6, i.valor, i.ajustado ? "Sim" : "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([...cab, ...corpo, [], ["TOTAL", totalBase, "", 1, resumo.totalItens, ""]]);
    ws["!cols"] = [{ wch: 52 }, { wch: 16 }, { wch: 8 }, { wch: 10 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, "Rateio");
    if (usaPdf && linhasPdf.length) {
      const det = XLSX.utils.aoa_to_sheet([
        ["Linha do PDF", "CPF", "Colaborador", "Situação", "Contrato", "Valor", "Texto lido"],
        ...linhasPdf.map((l) => [l.n, l.cpf ?? "", l.nome ?? "", l.situacao ?? "", nomeContrato(l.contrato_id), l.valor, l.texto]),
      ]);
      det["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 36 }, { wch: 14 }, { wch: 44 }, { wch: 12 }, { wch: 80 }];
      XLSX.utils.book_append_sheet(wb, det, "Linhas do PDF");
    }
    XLSX.writeFile(wb, `rateio_${tipo}_${mes}.xlsx`);
  };

  // Linhas da tabela de base (Jus Brasil / manual): todos os contratos ativos
  // + os que já têm base (encerrados inclusive) + "sem contrato" se houver.
  const linhasBase = useMemo(() => {
    const porChave = new Map(bases.map((b) => [chave(b.contrato_id), b]));
    const lista: Base[] = contratos
      .filter((c) => c.status !== "encerrado" || porChave.has(chave(c.contrato_id)))
      .map((c) => porChave.get(chave(c.contrato_id)) ?? { contrato_id: c.contrato_id, contrato_nome: c.nome ?? "", base: 0, qtd: null });
    const semCt = porChave.get(SEM);
    if (semCt) lista.push(semCt);
    return soComBase ? lista.filter((b) => b.base > 0) : lista;
  }, [bases, contratos, soComBase]);

  if (carregando || contratosQ.isLoading) {
    return <div className="flex items-center gap-2 py-10 justify-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>;
  }
  if (contratosQ.error) {
    return <Card className="p-6 text-destructive text-sm">{(contratosQ.error as Error).message}</Card>;
  }

  const somenteLeitura = !podeGravar;
  const ehMoeda = criterio === "faturamento" || criterio === "pdf";
  const planilhaSemContrato = (planilha ?? []).filter((l) => !l.contrato && (l.faturamento || l.consultas));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" className="gap-1.5" onClick={onFechar}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
        <div className="flex-1" />
        {travadoMalote && (
          <Badge variant="outline" className="gap-1 h-9 px-3">
            <Lock className="h-3.5 w-3.5" /> No Malote: {noMalote?.numero} — travado para edição
          </Badge>
        )}
        {id && podeExcluir && !travadoMalote && (
          <Button variant="outline" className="gap-1.5 text-destructive" onClick={() => setConfirmarExclusao(true)}>
            <Trash2 className="h-4 w-4" /> Excluir
          </Button>
        )}
        {podeExportar && (
          <Button variant="outline" className="gap-1.5" onClick={exportar} disabled={!itens.length}>
            <Download className="h-4 w-4" /> Exportar Excel
          </Button>
        )}
        {!somenteLeitura && (
          <>
            <Button variant="outline" className="gap-1.5" disabled={salvar.isPending} onClick={() => gravar("rascunho")}>
              {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar rascunho
            </Button>
            <Button className="gap-1.5" disabled={salvar.isPending || !resumo.fecha || !itens.length} onClick={() => gravar("conferido")}>
              <CheckCircle2 className="h-4 w-4" /> Salvar como conferido
            </Button>
          </>
        )}
        {id && podeEnviarMalote && !travadoMalote && (status === "conferido" || podeGravar) && (
          <Button className="gap-1.5" disabled={salvar.isPending || !resumo.fecha || !itens.length || maloteQ.isLoading} onClick={abrirEnvioMalote}>
            <Send className="h-4 w-4" /> Enviar ao Malote
          </Button>
        )}
      </div>

      {/* Dados da despesa */}
      <Card className="p-4 grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Tipo de despesa</Label>
          <Select value={tipo} onValueChange={(v) => trocarTipo(v as TipoRateio)} disabled={somenteLeitura || !!id}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{TIPOS_RATEIO.map((t) => <SelectItem key={t.tipo} value={t.tipo}>{t.rotulo}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Competência</Label>
          <Input type="month" value={mes} onChange={(e) => setMes(e.target.value)} disabled={somenteLeitura} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Valor da despesa (R$)</Label>
          <CurrencyInput value={valorTxt} onChange={setValorTxt} disabled={somenteLeitura} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <div className="h-10 flex items-center">
            {status === "conferido"
              ? <Badge className="bg-success/15 text-success border-success/30" variant="outline">Conferido</Badge>
              : <Badge variant="outline">Rascunho</Badge>}
          </div>
        </div>
        <div className="space-y-1 md:col-span-3">
          <Label className="text-xs">Descrição</Label>
          <Textarea rows={1} value={descricao} onChange={(e) => setDescricao(e.target.value)} disabled={somenteLeitura} placeholder="Ex.: fatura 09/2026, NF 1234…" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Anexo</Label>
          <div className="flex items-center gap-2 min-h-10">
            {anexoNome ? (
              anexoPath && !arquivo ? (
                <Button variant="link" className="px-0 h-auto truncate max-w-full" onClick={async () => {
                  try { window.open(await linkAnexoRateio(anexoPath), "_blank"); } catch (e) { toast.error((e as Error).message); }
                }}>
                  <Paperclip className="h-3.5 w-3.5 mr-1" /> {anexoNome}
                </Button>
              ) : (
                <span className="text-xs truncate"><Paperclip className="inline h-3.5 w-3.5 mr-1" />{anexoNome} <span className="text-muted-foreground">(sobe ao salvar)</span></span>
              )
            ) : <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </div>
      </Card>

      {/* Base do rateio */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Base do rateio</h3>
          {tipo === "jusbrasil" ? (
            <Select value={criterio} onValueChange={(v) => { setCriterio(v as CriterioRateio); aplicarPlanilha(planilha, v as CriterioRateio); }} disabled={somenteLeitura}>
              <SelectTrigger className="w-60 h-8"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="faturamento">{ROTULO_CRITERIO.faturamento}</SelectItem>
                <SelectItem value="consultas">{ROTULO_CRITERIO.consultas}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Badge variant="secondary">{ROTULO_CRITERIO[criterio]}</Badge>
          )}
          <div className="flex-1" />
          {!somenteLeitura && tipo === "jusbrasil" && (
            <>
              <input ref={inputXlsx} type="file" accept=".xlsx,.xls" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importarPlanilha(f); e.target.value = ""; }} />
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => inputXlsx.current?.click()}>
                <FileSpreadsheet className="h-4 w-4" /> Importar planilha
              </Button>
            </>
          )}
          {!somenteLeitura && tipo !== "senior" && !usaPdf && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={repetirUltimo}>
              <History className="h-4 w-4" /> Repetir base do último
            </Button>
          )}
          {!somenteLeitura && tipo === "senior" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={contarColaboradores} disabled={contratosQ.isFetching}>
              {contratosQ.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />} Contar colaboradores agora
            </Button>
          )}
          {!somenteLeitura && usaPdf && (
            <>
              <input ref={inputPdf} type="file" accept="application/pdf,.pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void lerPdf(f); e.target.value = ""; }} />
              <Button size="sm" className="gap-1.5" onClick={() => inputPdf.current?.click()} disabled={lendo}>
                {lendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {linhasPdf.length || anexoNome ? "Ler outro PDF" : "Anexar e ler PDF"}
              </Button>
              {linhasBrutas && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void lerComIa()} disabled={lendo || lendoIa}>
                  {lendoIa ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {leituraIa ? "Ler de novo com I.A" : "Ler com I.A"}
                </Button>
              )}
            </>
          )}
        </div>

        {tipo === "jusbrasil" && (
          <p className="text-xs text-muted-foreground">
            Como na planilha do RH: cada contrato paga <b>valor × faturamento do contrato ÷ faturamento total</b>. Importe a planilha
            (colunas CONTRATOS / FATURAMENTO / Consultas) ou digite o faturamento abaixo. Diferente da planilha, o total soma
            <b> todos</b> os contratos — lá as linhas 90 a 96 ficavam fora da soma e o rateio passava de 100%.
          </p>
        )}
        {tipo === "senior" && (
          <p className="text-xs text-muted-foreground">
            Colaboradores com situação <b>Trabalhando</b> na EMPREGADOS, por contrato (o mesmo de RH › Ativos/Contratos). A contagem é a de
            hoje — ao abrir um rateio salvo, vale a contagem gravada; clique em "Contar colaboradores agora" para atualizar.
          </p>
        )}
        {usaPdf && (
          <p className="text-xs text-muted-foreground">
            O PDF é lido no navegador: cada linha com <b>CPF</b> e valor vira um colaborador, e o contrato vem do cadastro dele
            (EMPREGADOS, inclusive demitidos). Sem CPF no PDF, vale a linha com o <b>nome do contrato</b>. Confira e corrija antes de salvar.
          </p>
        )}

        {avisoPdf && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-warning shrink-0" /> {avisoPdf}
          </div>
        )}
        {leituraIa && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium"><Sparkles className="h-4 w-4 text-primary" /> Leitura da I.A</div>
            {leituraIa.explicacao && <p>{leituraIa.explicacao}</p>}
            {leituraIa.total_despesa != null && (
              <p className="text-xs text-muted-foreground">
                Valor da despesa: <b>{fmtMoeda(leituraIa.total_despesa)}</b>{leituraIa.origem_total ? ` — ${leituraIa.origem_total}` : ""}.
                Base: {leituraIa.base || "—"}, {leituraIa.linhas.length} linha(s), soma {fmtMoeda(leituraIa.soma)}.
              </p>
            )}
            {leituraIa.ignorado.length > 0 && (
              <p className="text-xs text-muted-foreground">Ignorado: {leituraIa.ignorado.join(" · ")}</p>
            )}
            {leituraIa.alertas.map((a, i) => (
              <p key={i} className="flex items-start gap-1.5 text-xs text-warning"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {a}</p>
            ))}
            <p className="text-[11px] text-muted-foreground">Cada valor acima foi conferido contra a linha do PDF. A IA lê; quem confere e salva é você.</p>
          </div>
        )}
        {planilhaSemContrato.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 text-warning shrink-0" />
            <span>Linhas da planilha sem contrato no ERP (o valor foi para "{SEM_CONTRATO}"; digite no contrato certo e zere lá):{" "}
              {planilhaSemContrato.map((l) => `${l.nome} (${fmtMoeda(l.faturamento)})`).join("; ")}</span>
          </div>
        )}

        {/* PDF: linhas lidas */}
        {usaPdf && linhasPdf.length > 0 && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span><FileText className="inline h-4 w-4 mr-1" />{linhasPdf.length} linha(s) lida(s) — soma das linhas <b>{fmtMoeda(totalPdf)}</b></span>
              {pdfInfo?.total != null && (Math.abs(pdfInfo.total - totalPdf) < 0.005 ? (
                <Badge variant="outline" className="bg-success/15 text-success border-success/30 gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Bate com o TOTAL do PDF</Badge>
              ) : (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> TOTAL do PDF {fmtMoeda(pdfInfo.total)} — diferença {fmtMoeda(Math.round((pdfInfo.total - totalPdf) * 100) / 100)}
                </Badge>
              ))}
              {pdfInfo?.total != null && Math.abs(pdfInfo.total - totalPdf) >= 0.005 && linhasBrutas && !leituraIa && !somenteLeitura && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void lerComIa()} disabled={lendoIa}>
                  {lendoIa ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Não bate — pedir para a I.A ler
                </Button>
              )}
              {pdfInfo && <span className="text-xs text-muted-foreground">{pdfInfo.rotulo}</span>}
              {Math.abs(totalPdf - valor) >= 0.005 && !somenteLeitura && (
                <Button size="sm" variant="outline" onClick={() => setValorTxt(totalPdf.toFixed(2))}>Usar o total do PDF como valor da despesa</Button>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
              Mostrar só as linhas sem contrato ({linhasPdf.filter((l) => !l.contrato_id).length})
            </label>
            <div className="max-h-[360px] overflow-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b text-muted-foreground">
                  <tr>
                    <th className="text-left p-1.5">Lin.</th>
                    <th className="text-left p-1.5">Colaborador / texto</th>
                    <th className="text-left p-1.5">CPF</th>
                    <th className="text-right p-1.5">Valor</th>
                    <th className="text-left p-1.5 w-[320px]">Contrato</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {/* O PDF do seguro tem ~2.100 segurados: desenha no máximo 300 linhas
                      (cada uma tem um seletor de contrato); o filtro acha as pendentes. */}
                  {linhasPdf.map((l, i) => ({ l, i })).filter(({ l }) => !soPendentes || !l.contrato_id).slice(0, LIMITE_LINHAS_TELA).map(({ l, i }) => (
                    <tr key={`${l.n}-${i}`} className={`border-b ${l.contrato_id ? "" : "bg-warning/10"}`}>
                      <td className="p-1.5 text-muted-foreground">{l.n}</td>
                      <td className="p-1.5">
                        {l.nome ? <span className="font-medium">{l.nome}</span> : l.cpf ? <span className="text-destructive">CPF fora da EMPREGADOS</span> : null}
                        {l.situacao && l.situacao !== "Trabalhando" && <Badge variant="outline" className="ml-1 text-[10px]">{l.situacao}</Badge>}
                        <div className="text-muted-foreground truncate max-w-[420px]" title={l.texto}>{l.texto}</div>
                      </td>
                      <td className="p-1.5 tabular-nums">{mascaraCpf(l.cpf)}</td>
                      <td className="p-1.5 text-right tabular-nums">{fmtMoeda(l.valor)}</td>
                      <td className="p-1.5">
                        <SearchableSelect value={chave(l.contrato_id)} onChange={(v) => mudarContratoLinha(i, v)} options={opcoesContrato}
                          disabled={somenteLeitura} triggerClassName="h-7 text-xs" />
                      </td>
                      <td className="p-1.5">
                        {!somenteLeitura && (
                          <Button size="icon" variant="ghost" className="h-6 w-6" title="Tirar esta linha do rateio" onClick={() => removerLinha(i)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {linhasPdf.filter((l) => !soPendentes || !l.contrato_id).length > LIMITE_LINHAS_TELA && (
              <p className="text-xs text-muted-foreground">
                Mostrando {LIMITE_LINHAS_TELA} de {linhasPdf.filter((l) => !soPendentes || !l.contrato_id).length} linhas — todas entram no rateio; o Excel traz a lista completa.
              </p>
            )}
          </div>
        )}

        {/* Base manual: Jus Brasil, ou PDF sem linhas legíveis */}
        {(tipo === "jusbrasil" || (usaPdf && !linhasPdf.length && (avisoPdf || bases.length > 0))) && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={soComBase} onChange={(e) => setSoComBase(e.target.checked)} /> Mostrar só contratos com base
            </label>
            <div className="max-h-[360px] overflow-auto border rounded-md">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background border-b text-muted-foreground">
                  <tr><th className="text-left p-1.5">Contrato</th><th className="text-right p-1.5 w-48">{ROTULO_CRITERIO[criterio]}</th></tr>
                </thead>
                <tbody>
                  {linhasBase.map((b) => (
                    <tr key={chave(b.contrato_id)} className="border-b">
                      <td className="p-1.5">{b.contrato_nome}</td>
                      <td className="p-1.5">
                        {ehMoeda ? (
                          <CurrencyInput className="h-7 text-xs text-right" value={b.base ? String(b.base) : ""} disabled={somenteLeitura}
                            onChange={(v) => mudarBase(b.contrato_id, b.contrato_nome, Number(v) || 0)} />
                        ) : (
                          <Input type="number" min={0} className="h-7 text-xs text-right" value={b.base || ""} disabled={somenteLeitura}
                            onChange={(e) => mudarBase(b.contrato_id, b.contrato_nome, Number(e.target.value) || 0)} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Resultado */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold">Rateio por contrato</h3>
          <span className="text-sm text-muted-foreground">{itens.filter((i) => i.valor > 0).length} contrato(s)</span>
          <div className="flex-1" />
          {itens.length > 0 && (resumo.fecha ? (
            <Badge variant="outline" className="bg-success/15 text-success border-success/30 gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Fecha com o valor da despesa</Badge>
          ) : (
            <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 gap-1">
              <AlertTriangle className="h-3.5 w-3.5" /> Diferença de {fmtMoeda(resumo.diferenca)}
            </Badge>
          ))}
        </div>
        {!itens.length ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {tipo === "senior" ? "Clique em \"Contar colaboradores agora\"." : usaPdf ? "Anexe o PDF da despesa para montar o rateio." : "Importe a planilha ou digite o faturamento dos contratos."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2 px-2">Contrato</th>
                  <th className="text-right px-2">{ROTULO_CRITERIO[criterio]}</th>
                  {(criterio === "colaboradores" || criterio === "pdf") && <th className="text-right px-2">{criterio === "pdf" ? "Linhas" : "Pessoas"}</th>}
                  <th className="text-right px-2">%</th>
                  <th className="text-right px-2 w-44">Valor rateado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itens.filter((i) => i.base > 0 || i.valor > 0 || i.ajustado).map((i) => (
                  <tr key={chave(i.contrato_id)} className={`border-b ${i.contrato_id ? "" : "bg-warning/10"}`}>
                    <td className="py-1.5 px-2">{i.contrato_nome}</td>
                    <td className="px-2 text-right tabular-nums">{ehMoeda ? fmtMoeda(i.base) : i.base.toLocaleString("pt-BR")}</td>
                    {(criterio === "colaboradores" || criterio === "pdf") && <td className="px-2 text-right tabular-nums">{qtdPorChave.get(chave(i.contrato_id)) ?? ""}</td>}
                    <td className="px-2 text-right tabular-nums">{fmtPct(i.percentual)}</td>
                    <td className="px-2">
                      <CurrencyInput className={`h-8 text-right ${i.ajustado ? "border-primary font-semibold" : ""}`} value={i.valor ? i.valor.toFixed(2) : ""}
                        disabled={somenteLeitura} onChange={(v) => ajustar(i.contrato_id, Number(v) || 0)} />
                    </td>
                    <td className="px-1">
                      {i.ajustado && !somenteLeitura && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Voltar ao valor calculado" onClick={() => ajustar(i.contrato_id, null)}>
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td className="py-2 px-2">Total</td>
                  <td className="px-2 text-right tabular-nums">{ehMoeda ? fmtMoeda(totalBase) : totalBase.toLocaleString("pt-BR")}</td>
                  {(criterio === "colaboradores" || criterio === "pdf") && <td />}
                  <td className="px-2 text-right tabular-nums">{fmtPct(valor ? resumo.totalItens / valor : 0)}</td>
                  <td className="px-2 text-right tabular-nums">{fmtMoeda(resumo.totalItens)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <p className="mt-2 text-xs text-muted-foreground">
              Digitar um valor fixa aquele contrato (borda azul) e o resto da despesa é redividido entre os demais pela base.
            </p>
          </div>
        )}
      </Card>

      <AlertDialog open={confirmarExclusao} onOpenChange={setConfirmarExclusao}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir este rateio?</AlertDialogTitle>
            <AlertDialogDescription>
              {rotuloTipo(tipo)} {competenciaRotulo(competenciaParaData(mes))} — {fmtMoeda(valor)}. O rateio e o anexo serão apagados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => id && excluir.mutate({ id, anexo_path: anexoPath } as Pick<DespesaRateio, "id" | "anexo_path">, {
                onSuccess: () => { toast.success("Rateio excluído."); onFechar(); },
                onError: (e) => toast.error((e as Error).message),
              })}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {id && enviandoMalote && (
        <EnviarRateioMalote
          aberto
          rateio={{ id, tipo, competencia: competenciaParaData(mes), valor, anexo_path: anexoPath, anexo_nome: anexoNome }}
          itens={itens}
          onFechar={() => setEnviandoMalote(false)}
          onEnviado={() => setEnviandoMalote(false)}
        />
      )}
    </div>
  );
}
