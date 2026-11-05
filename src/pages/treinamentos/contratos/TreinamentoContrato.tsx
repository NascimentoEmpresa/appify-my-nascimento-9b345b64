import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Camera, ClipboardCheck, FileText, Loader2, Pencil, Plus, Printer, Search, Star, Trash2, Upload, UserPlus, Users,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  urlArquivo, useArquivosMutacoes, useColaboradoresContrato, useDadosTreinamentos, useExcluirTreinamento,
  useParticipantesMutacoes, useRespostasMutacoes, useTreinamentoContrato, useUrlsArquivos,
  type ArquivoContrato, type TreinamentoContrato,
} from "@/hooks/useTreinamentosContrato";
import {
  NOTA_MINIMA_PADRAO, calcularIndicadores, casarParticipante, fmtDataBr, fmtHora, fmtNota, fmtPct, formatarCpf,
  lerNota, mediasPorPergunta, normalizarCpf, siglaEmpresa, type AvaliacaoLida, type SatisfacaoLida,
} from "@/lib/treinamentos/contratoTreinamento";
import { ImportarPlanilhaDialog, Kpi, MENU_TRN_CONTRATOS, TreinamentoFormDialog } from "./componentes";

// =====================================================================
// Um treinamento do contrato (mig 20261104006000): Dados · Participantes e
// presença · Fotos · Lista de presença · Avaliações · Satisfação, e o
// relatório consolidado. Lançar (incluir OU alterar) é uma permissão só,
// a mesma que a RLS cobra (trn_ct_pode_lancar).
// =====================================================================

export default function TreinamentoContratoPagina() {
  const nav = useNavigate();
  const id = Number(useParams().id);
  const trein = useTreinamentoContrato(id);
  const dados = useDadosTreinamentos([id]);
  const podeIncluir = useScreenAccess(MENU_TRN_CONTRATOS, "incluir").data === true;
  const podeAlterar = useScreenAccess(MENU_TRN_CONTRATOS, "alterar").data === true;
  const podeLancar = podeIncluir || podeAlterar;
  const excluir = useExcluirTreinamento();
  const [editando, setEditando] = useState(false);
  const [aba, setAba] = useState("participantes");

  const t = trein.data;
  const d = dados.data ?? { participantes: [], arquivos: [], avaliacoes: [], satisfacao: [] };
  const ind = calcularIndicadores(d);

  if (trein.isLoading) return <div className="flex items-center justify-center p-16 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando…</div>;
  if (!t) return <div className="p-10 text-center text-muted-foreground">Treinamento não encontrado (ou sem acesso). <Link className="underline" to="/app/treinamentos/contratos">Voltar</Link></div>;

  const apagar = async () => {
    if (!window.confirm(`Excluir o treinamento "${t.nome}" com participantes, fotos, listas e respostas? Não dá para desfazer.`)) return;
    try { await excluir.mutateAsync(t.id); toast.success("Treinamento excluído."); nav(`/app/treinamentos/contratos/${t.empresa}/${t.filial}`); }
    catch (e: any) { toast.error(e?.message ?? "Não foi possível excluir."); }
  };

  const fotos = d.arquivos.filter((a) => a.tipo === "foto");
  const listas = d.arquivos.filter((a) => a.tipo === "lista_presenca");

  return (
    <div className="space-y-4">
      <PageHeader title={t.nome} module="Treinamentos"
        breadcrumb={["Treinamentos por Contrato", siglaEmpresa(t.empresa), t.contrato_nome, t.nome]}
        subtitle={`${siglaEmpresa(t.empresa)} · ${t.contrato_nome} · ${fmtDataBr(t.data)}${t.horario_inicio ? ` · ${fmtHora(t.horario_inicio)}${t.horario_fim ? `–${fmtHora(t.horario_fim)}` : ""}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild><Link to={`/app/treinamentos/contratos/${t.empresa}/${t.filial}`}><ArrowLeft className="mr-2 h-4 w-4" />Contrato</Link></Button>
            <Button variant="outline" asChild><Link to={`/app/treinamentos/contratos/treinamento/${t.id}/relatorio`}><Printer className="mr-2 h-4 w-4" />Relatório</Link></Button>
            {podeAlterar && <Button variant="outline" onClick={() => setEditando(true)}><Pencil className="mr-2 h-4 w-4" />Editar</Button>}
            <AcessoGate menu={MENU_TRN_CONTRATOS} acao="excluir">
              <Button variant="outline" className="text-destructive" onClick={apagar}><Trash2 className="mr-2 h-4 w-4" />Excluir</Button>
            </AcessoGate>
          </div>
        } />

      <div className="grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Info r="Tema" v={t.tema} />
        <Info r="Carga horária" v={t.carga_horaria != null ? `${String(t.carga_horaria).replace(".", ",")} h` : null} />
        <Info r="Responsável" v={t.responsavel} />
        <Info r="Local" v={t.local} />
        {t.observacoes && <div className="sm:col-span-2 lg:col-span-4"><Info r="Observações" v={t.observacoes} /></div>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icone={Users} rotulo="Presentes" valor={`${ind.presentes}/${ind.participantes}`} dica={fmtPct(ind.taxaPresenca)} cor="bg-emerald-50 text-emerald-600" />
        <Kpi icone={ClipboardCheck} rotulo="Nota média" valor={fmtNota(ind.notaMedia)} dica={`aprovação ${fmtPct(ind.taxaAprovacao)}`} cor="bg-amber-50 text-amber-600" />
        <Kpi icone={Star} rotulo="Satisfação (0–10)" valor={fmtNota(ind.satisfacaoMedia)} dica={`${ind.respostasSatisfacao} resposta(s)`} cor="bg-pink-50 text-pink-600" />
        <Kpi icone={Camera} rotulo="Fotos / listas" valor={`${fotos.length} / ${listas.length}`} cor="bg-indigo-50 text-indigo-600" />
      </div>

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="participantes">Participantes e presença ({d.participantes.length})</TabsTrigger>
          <TabsTrigger value="fotos">Fotos ({fotos.length})</TabsTrigger>
          <TabsTrigger value="lista">Lista de presença ({listas.length})</TabsTrigger>
          <TabsTrigger value="avaliacoes">Avaliações ({d.avaliacoes.length})</TabsTrigger>
          <TabsTrigger value="satisfacao">Pesquisa de satisfação ({d.satisfacao.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="participantes"><AbaParticipantes t={t} d={d} podeLancar={podeLancar} /></TabsContent>
        <TabsContent value="fotos"><AbaArquivos t={t} tipo="foto" arquivos={fotos} podeLancar={podeLancar} /></TabsContent>
        <TabsContent value="lista"><AbaArquivos t={t} tipo="lista_presenca" arquivos={listas} podeLancar={podeLancar} /></TabsContent>
        <TabsContent value="avaliacoes"><AbaAvaliacoes t={t} d={d} podeLancar={podeLancar} /></TabsContent>
        <TabsContent value="satisfacao"><AbaSatisfacao t={t} d={d} podeLancar={podeLancar} /></TabsContent>
      </Tabs>

      <TreinamentoFormDialog aberto={editando} onFechar={() => setEditando(false)} editando={t}
        contrato={{ empresa: t.empresa, filial: t.filial, nome: t.contrato_nome }} />
    </div>
  );
}

function Info({ r, v }: { r: string; v: string | null | undefined }) {
  return <div><p className="text-xs text-muted-foreground">{r}</p><p className="whitespace-pre-wrap">{v || "—"}</p></div>;
}

type Dados = NonNullable<ReturnType<typeof useDadosTreinamentos>["data"]>;

// ── Participantes e presença ─────────────────────────────────────────────
function AbaParticipantes({ t, d, podeLancar }: { t: TreinamentoContrato; d: Dados; podeLancar: boolean }) {
  const { adicionar, marcarPresenca, remover } = useParticipantesMutacoes();
  const [aberto, setAberto] = useState(false);
  const todosPresentes = d.participantes.length > 0 && d.participantes.every((p) => p.presente);

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Marque quem esteve presente. Os colaboradores vêm do cadastro (EMPREGADOS); quem não estiver lá entra por nome e CPF.</p>
        {podeLancar && (
          <div className="flex gap-2">
            {d.participantes.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => marcarPresenca.mutate({ ids: d.participantes.map((p) => p.id), presente: !todosPresentes })}>
                {todosPresentes ? "Marcar todos ausentes" : "Marcar todos presentes"}
              </Button>
            )}
            <Button size="sm" onClick={() => setAberto(true)}><UserPlus className="mr-2 h-4 w-4" />Adicionar participantes</Button>
          </div>
        )}
      </div>
      <Table>
        <TableHeader><TableRow><TableHead className="w-20">Presente</TableHead><TableHead>Nome</TableHead><TableHead>CPF</TableHead><TableHead>Cargo</TableHead><TableHead className="text-right">Nota</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
        <TableBody>
          {d.participantes.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum participante lançado.</TableCell></TableRow>}
          {d.participantes.map((p) => {
            const a = casarParticipante(p, d.avaliacoes.map((x) => ({ ...x, presente: true })));
            return (
              <TableRow key={p.id}>
                <TableCell><Checkbox checked={p.presente} disabled={!podeLancar} onCheckedChange={(v) => marcarPresenca.mutate({ ids: [p.id], presente: v === true })} /></TableCell>
                <TableCell className="font-medium">{p.nome}{!p.empregado_id && <Badge variant="outline" className="ml-2 text-[10px]">fora do cadastro</Badge>}</TableCell>
                <TableCell>{p.cpf ? formatarCpf(p.cpf) : "—"}</TableCell>
                <TableCell>{p.cargo ?? "—"}</TableCell>
                <TableCell className="text-right">{fmtNota((a as any)?.nota)}</TableCell>
                <TableCell>{podeLancar && <Button size="icon" variant="ghost" onClick={() => window.confirm(`Tirar ${p.nome} da lista?`) && remover.mutate(p.id)}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <AdicionarParticipantes aberto={aberto} onFechar={() => setAberto(false)} t={t} jaTem={d.participantes}
        onAdicionar={async (linhas) => { await adicionar.mutateAsync(linhas); }} />
    </div>
  );
}

function AdicionarParticipantes({ aberto, onFechar, t, jaTem, onAdicionar }: {
  aberto: boolean; onFechar: () => void; t: TreinamentoContrato; jaTem: Dados["participantes"];
  onAdicionar: (l: { treinamento_id: number; empregado_id: number | null; nome: string; cpf: string | null; cargo: string | null; presente: boolean }[]) => Promise<void>;
}) {
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [manualNome, setManualNome] = useState("");
  const [manualCpf, setManualCpf] = useState("");
  const [salvando, setSalvando] = useState(false);
  const cols = useColaboradoresContrato(t.empresa, t.filial, buscaAplicada, aberto);
  const jaIds = new Set(jaTem.map((p) => p.empregado_id).filter(Boolean));
  const jaCpfs = new Set(jaTem.map((p) => normalizarCpf(p.cpf)).filter(Boolean));
  const opcoes = (cols.data ?? []).filter((c) => !jaIds.has(c.id) && !jaCpfs.has(normalizarCpf(c.cpf)));

  const alternar = (id: number) => setMarcados((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const salvar = async () => {
    const linhas: Parameters<typeof onAdicionar>[0] = opcoes.filter((c) => marcados.has(c.id)).map((c) => ({
      treinamento_id: t.id, empregado_id: c.id, nome: c.nome, cpf: normalizarCpf(c.cpf), cargo: c.cargo, presente: true,
    }));
    if (manualNome.trim()) {
      const cpf = normalizarCpf(manualCpf);
      if (manualCpf.trim() && !cpf) return toast.error("CPF inválido.");
      if (cpf && jaCpfs.has(cpf)) return toast.error("Esse CPF já está na lista.");
      linhas.push({ treinamento_id: t.id, empregado_id: null, nome: manualNome.trim(), cpf, cargo: null, presente: true });
    }
    if (!linhas.length) return toast.error("Marque alguém ou digite um nome.");
    setSalvando(true);
    try { await onAdicionar(linhas); toast.success(`${linhas.length} participante(s) adicionado(s).`); setMarcados(new Set()); setManualNome(""); setManualCpf(""); onFechar(); }
    catch (e: any) { toast.error(e?.message ?? "Falha ao adicionar."); }
    finally { setSalvando(false); }
  };

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar participantes</DialogTitle>
          <DialogDescription>Sem busca, aparecem os colaboradores do contrato. Busque pelo nome ou CPF para achar gente de outro posto.</DialogDescription>
        </DialogHeader>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setBuscaAplicada(busca); }}>
          <Input placeholder="Nome ou CPF (vazio = colaboradores do contrato)" value={busca} onChange={(e) => setBusca(e.target.value)} />
          <Button type="submit" variant="outline"><Search className="h-4 w-4" /></Button>
        </form>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{cols.isLoading ? "Buscando…" : `${opcoes.length} disponível(is) · ${marcados.size} marcado(s)`}</span>
          {opcoes.length > 0 && (
            <Button variant="link" size="sm" onClick={() => setMarcados(marcados.size === opcoes.length ? new Set() : new Set(opcoes.map((o) => o.id)))}>
              {marcados.size === opcoes.length ? "Desmarcar todos" : "Marcar todos"}
            </Button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {opcoes.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/40">
              <Checkbox checked={marcados.has(c.id)} onCheckedChange={() => alternar(c.id)} />
              <div className="min-w-0">
                <p className="font-medium">{c.nome}</p>
                <p className="truncate text-xs text-muted-foreground">{[c.cpf ? formatarCpf(c.cpf) : null, c.cargo, buscaAplicada ? c.contrato : null, c.situacao !== "Trabalhando" ? c.situacao : null].filter(Boolean).join(" · ")}</p>
              </div>
            </label>
          ))}
          {!cols.isLoading && opcoes.length === 0 && <p className="p-4 text-center text-sm text-muted-foreground">Ninguém para adicionar.</p>}
        </div>
        <div className="rounded-md border p-3">
          <p className="mb-2 text-sm font-medium">Quem não está no cadastro</p>
          <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
            <Input placeholder="Nome completo" value={manualNome} onChange={(e) => setManualNome(e.target.value)} />
            <Input placeholder="CPF (opcional)" value={manualCpf} onChange={(e) => setManualCpf(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={salvar} disabled={salvando}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Fotos e lista de presença ────────────────────────────────────────────
function AbaArquivos({ t, tipo, arquivos, podeLancar }: { t: TreinamentoContrato; tipo: ArquivoContrato["tipo"]; arquivos: ArquivoContrato[]; podeLancar: boolean }) {
  const { enviar, remover } = useArquivosMutacoes();
  const urls = useUrlsArquivos(arquivos);
  const [dataFoto, setDataFoto] = useState(t.data);
  const [legenda, setLegenda] = useState("");
  const foto = tipo === "foto";

  const subir = async (lista: FileList | null) => {
    const arqs = Array.from(lista ?? []);
    if (!arqs.length) return;
    const grandes = arqs.filter((f) => f.size > 25 * 1024 * 1024);
    if (grandes.length) return toast.error(`Arquivo acima de 25 MB: ${grandes.map((f) => f.name).join(", ")}`);
    if (foto && arqs.some((f) => !f.type.startsWith("image/"))) return toast.error("Em Fotos, só imagens.");
    try {
      await enviar.mutateAsync({ treinamento: t, tipo, arquivos: arqs, data_foto: dataFoto, legenda });
      toast.success(`${arqs.length} arquivo(s) enviado(s).`); setLegenda("");
    } catch (e: any) { toast.error(e?.message ?? "Falha no envio."); }
  };
  const abrir = async (a: ArquivoContrato) => {
    try { window.open(urls.data?.[a.storage_path] ?? await urlArquivo(a.storage_path), "_blank"); }
    catch (e: any) { toast.error(e?.message ?? "Não foi possível abrir."); }
  };

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      {podeLancar && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg bg-muted/40 p-3">
          {foto && <div><Label>Data das fotos</Label><Input type="date" value={dataFoto} onChange={(e) => setDataFoto(e.target.value)} /></div>}
          <div className="min-w-[220px] flex-1"><Label>{foto ? "Legenda (opcional)" : "Observação (opcional)"}</Label><Input value={legenda} onChange={(e) => setLegenda(e.target.value)} /></div>
          <label>
            <input type="file" multiple className="hidden" accept={foto ? "image/*" : "application/pdf,image/*"} onChange={(e) => { subir(e.target.files); e.target.value = ""; }} />
            <span className="inline-flex h-10 cursor-pointer items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              {enviar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {foto ? "Enviar fotos" : "Enviar lista assinada"}
            </span>
          </label>
        </div>
      )}
      {arquivos.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{foto ? "Nenhuma foto da equipe ainda." : "Nenhuma lista de presença anexada."}</p>}
      {foto ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {arquivos.map((a) => (
            <figure key={a.id} className="group relative overflow-hidden rounded-lg border">
              {urls.data?.[a.storage_path]
                ? <img src={urls.data[a.storage_path]} alt={a.legenda ?? ""} className="h-40 w-full cursor-pointer object-cover" onClick={() => abrir(a)} />
                : <div className="flex h-40 items-center justify-center bg-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>}
              <figcaption className="p-2 text-xs"><b>{fmtDataBr(a.data_foto)}</b>{a.legenda ? ` · ${a.legenda}` : ""}</figcaption>
              {podeLancar && (
                <Button size="icon" variant="secondary" className="absolute right-1 top-1 h-7 w-7 opacity-0 group-hover:opacity-100"
                  onClick={() => window.confirm("Apagar esta foto?") && remover.mutate(a)}><Trash2 className="h-3.5 w-3.5" /></Button>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <div className="divide-y rounded-md border">
          {arquivos.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-3 text-sm">
              <FileText className="h-5 w-5 text-indigo-600" />
              <button className="flex-1 text-left font-medium hover:underline" onClick={() => abrir(a)}>{a.nome_arquivo ?? "Lista de presença"}</button>
              <span className="text-xs text-muted-foreground">{a.legenda}</span>
              <span className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleDateString("pt-BR")}</span>
              {podeLancar && <Button size="icon" variant="ghost" onClick={() => window.confirm("Apagar este arquivo?") && remover.mutate(a)}><Trash2 className="h-4 w-4" /></Button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Avaliações (provinhas) ───────────────────────────────────────────────
function AbaAvaliacoes({ t, d, podeLancar }: { t: TreinamentoContrato; d: Dados; podeLancar: boolean }) {
  const { inserir, remover } = useRespostasMutacoes("TRN_CONTRATO_AVALIACAO");
  const [importar, setImportar] = useState(false);
  const [digitar, setDigitar] = useState(false);
  const [f, setF] = useState({ nome: "", cpf: "", nota: "", min: String(NOTA_MINIMA_PADRAO) });

  const salvarDigitada = async () => {
    const nota = lerNota(f.nota);
    if (!f.nome.trim()) return toast.error("Informe o nome.");
    if (nota.nota == null) return toast.error('Nota inválida. Use 0 a 10, "8 / 10" ou "80%".');
    try {
      await inserir.mutateAsync([{ treinamento_id: t.id, nome: f.nome.trim(), cpf: normalizarCpf(f.cpf), nota: nota.nota, acertos: nota.acertos, total: nota.total,
        aprovado: nota.nota >= Number(f.min || NOTA_MINIMA_PADRAO), origem: "digitacao" }]);
      toast.success("Avaliação lançada."); setF({ ...f, nome: "", cpf: "", nota: "" });
    } catch (e: any) { toast.error(e?.message ?? "Falha ao salvar."); }
  };
  const importarItens = async (itens: AvaliacaoLida[]) => {
    await inserir.mutateAsync(itens.map((i) => ({
      treinamento_id: t.id, nome: i.nome, cpf: i.cpf, nota: i.nota, acertos: i.acertos, total: i.total, aprovado: i.aprovado,
      respostas: i.respostas, respondido_em: i.respondido_em, origem: "planilha",
    })));
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <BarraRespostas podeLancar={podeLancar} onImportar={() => setImportar(true)} onDigitar={() => setDigitar((v) => !v)} total={d.avaliacoes.length}
        onLimpar={() => window.confirm(`Apagar as ${d.avaliacoes.length} avaliações deste treinamento?`) && remover.mutate(d.avaliacoes.map((a) => a.id))} />
      {digitar && podeLancar && (
        <div className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[1fr_160px_120px_120px_auto] sm:items-end">
          <div><Label>Nome</Label><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
          <div><Label>CPF</Label><Input value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} /></div>
          <div><Label>Nota</Label><Input placeholder="8 ou 8/10" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></div>
          <div><Label>Mínima</Label><Input type="number" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} /></div>
          <Button onClick={salvarDigitada} disabled={inserir.isPending}><Plus className="mr-1 h-4 w-4" />Lançar</Button>
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>CPF</TableHead><TableHead>Participante?</TableHead><TableHead className="text-right">Acertos</TableHead><TableHead className="text-right">Nota</TableHead><TableHead>Resultado</TableHead><TableHead>Origem</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
        <TableBody>
          {d.avaliacoes.length === 0 && <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">Nenhuma avaliação lançada.</TableCell></TableRow>}
          {d.avaliacoes.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium">{a.nome}</TableCell>
              <TableCell>{a.cpf ? formatarCpf(a.cpf) : "—"}</TableCell>
              <TableCell>{casarParticipante(a, d.participantes) ? <Badge variant="secondary">sim</Badge> : <Badge variant="outline">não achado</Badge>}</TableCell>
              <TableCell className="text-right">{a.acertos != null && a.total != null ? `${a.acertos}/${a.total}` : "—"}</TableCell>
              <TableCell className="text-right">{fmtNota(a.nota)}</TableCell>
              <TableCell>{a.aprovado == null ? "—" : a.aprovado ? <span className="text-emerald-600">Aprovado</span> : <span className="text-red-600">Reprovado</span>}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{a.origem === "planilha" ? "planilha" : "digitada"}</TableCell>
              <TableCell>{podeLancar && <Button size="icon" variant="ghost" onClick={() => remover.mutate([a.id])}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ImportarPlanilhaDialog<AvaliacaoLida> aberto={importar} onFechar={() => setImportar(false)} tipo="avaliacao" onConfirmar={importarItens} />
    </div>
  );
}

// ── Pesquisa de satisfação ───────────────────────────────────────────────
function AbaSatisfacao({ t, d, podeLancar }: { t: TreinamentoContrato; d: Dados; podeLancar: boolean }) {
  const { inserir, remover } = useRespostasMutacoes("TRN_CONTRATO_SATISFACAO");
  const [importar, setImportar] = useState(false);
  const [digitar, setDigitar] = useState(false);
  const [f, setF] = useState({ nome: "", nota: "", comentario: "" });
  const perguntas = useMemo(() => mediasPorPergunta(d.satisfacao.map((s) => s.respostas ?? {})), [d.satisfacao]);

  const salvarDigitada = async () => {
    const n = f.nota.trim() === "" ? null : Number(f.nota.replace(",", "."));
    if (n != null && (Number.isNaN(n) || n < 0 || n > 10)) return toast.error("Nota de 0 a 10.");
    if (n == null && !f.comentario.trim()) return toast.error("Informe a nota ou um comentário.");
    try {
      await inserir.mutateAsync([{ treinamento_id: t.id, nome: f.nome.trim() || null, nota: n, comentario: f.comentario.trim() || null, origem: "digitacao" }]);
      toast.success("Resposta lançada."); setF({ nome: "", nota: "", comentario: "" });
    } catch (e: any) { toast.error(e?.message ?? "Falha ao salvar."); }
  };
  const importarItens = async (itens: SatisfacaoLida[]) => {
    await inserir.mutateAsync(itens.map((i) => ({
      treinamento_id: t.id, nome: i.nome, nota: i.nota, respostas: i.respostas, comentario: i.comentario, respondido_em: i.respondido_em, origem: "planilha",
    })));
  };

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <BarraRespostas podeLancar={podeLancar} onImportar={() => setImportar(true)} onDigitar={() => setDigitar((v) => !v)} total={d.satisfacao.length}
        onLimpar={() => window.confirm(`Apagar as ${d.satisfacao.length} respostas deste treinamento?`) && remover.mutate(d.satisfacao.map((s) => s.id))} />
      {digitar && podeLancar && (
        <div className="grid gap-2 rounded-lg bg-muted/40 p-3 sm:grid-cols-[1fr_120px] sm:items-end">
          <div><Label>Nome (opcional — a pesquisa pode ser anônima)</Label><Input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
          <div><Label>Nota geral (0–10)</Label><Input value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></div>
          <div className="sm:col-span-2"><Label>Comentário</Label><Textarea rows={2} value={f.comentario} onChange={(e) => setF({ ...f, comentario: e.target.value })} /></div>
          <div className="sm:col-span-2"><Button onClick={salvarDigitada} disabled={inserir.isPending}><Plus className="mr-1 h-4 w-4" />Lançar resposta</Button></div>
        </div>
      )}
      {perguntas.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {perguntas.map((p) => (
            <div key={p.pergunta} className="rounded-lg border p-3">
              <p className="line-clamp-2 text-xs text-muted-foreground">{p.pergunta}</p>
              <p className="text-lg font-semibold">{fmtNota(p.media)} <span className="text-xs font-normal text-muted-foreground">({p.n})</span></p>
              <div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-pink-500" style={{ width: `${p.media * 10}%` }} /></div>
            </div>
          ))}
        </div>
      )}
      <Table>
        <TableHeader><TableRow><TableHead>Respondente</TableHead><TableHead className="text-right">Nota (0–10)</TableHead><TableHead>Comentário</TableHead><TableHead>Origem</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
        <TableBody>
          {d.satisfacao.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Nenhuma resposta lançada.</TableCell></TableRow>}
          {d.satisfacao.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.nome ?? <span className="text-muted-foreground">anônimo</span>}</TableCell>
              <TableCell className="text-right">{fmtNota(s.nota)}</TableCell>
              <TableCell className="max-w-md whitespace-pre-wrap text-sm">{s.comentario ?? "—"}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{s.origem === "planilha" ? "planilha" : "digitada"}</TableCell>
              <TableCell>{podeLancar && <Button size="icon" variant="ghost" onClick={() => remover.mutate([s.id])}><Trash2 className="h-4 w-4" /></Button>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <ImportarPlanilhaDialog<SatisfacaoLida> aberto={importar} onFechar={() => setImportar(false)} tipo="satisfacao" onConfirmar={importarItens} />
    </div>
  );
}

function BarraRespostas({ podeLancar, onImportar, onDigitar, onLimpar, total }: { podeLancar: boolean; onImportar: () => void; onDigitar: () => void; onLimpar: () => void; total: number }) {
  if (!podeLancar) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={onImportar}><Upload className="mr-2 h-4 w-4" />Importar planilha</Button>
      <Button size="sm" variant="outline" onClick={onDigitar}><Pencil className="mr-2 h-4 w-4" />Digitar</Button>
      {total > 0 && <Button size="sm" variant="ghost" className="text-destructive" onClick={onLimpar}><Trash2 className="mr-2 h-4 w-4" />Apagar todas</Button>}
    </div>
  );
}
