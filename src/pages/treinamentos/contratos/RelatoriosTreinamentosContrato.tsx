import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import * as XLSX from "xlsx";
import { ArrowLeft, ClipboardCheck, Download, GraduationCap, Loader2, Star, Users } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useContratosTreinamento, useDadosTreinamentos, useTreinamentosContrato, type TreinamentoContrato } from "@/hooks/useTreinamentosContrato";
import {
  EMPRESAS_TREINAMENTO, calcularIndicadores, casarParticipante, fmtDataBr, fmtNota, fmtPct, formatarCpf,
  mediasPorPergunta, normalizarCpf, normalizarTexto, siglaEmpresa, type Indicadores,
} from "@/lib/treinamentos/contratoTreinamento";
import { Kpi, MENU_TRN_CONTRATOS } from "./componentes";

// =====================================================================
// Relatórios de Treinamentos por Contrato (mig 20261104006000): por
// empresa, contrato, treinamento, período e colaborador — presença,
// resultado das avaliações e satisfação. Exportar (Excel) cobra a ação
// `exportar` do menu treinamentos_contratos.
// =====================================================================

const TODOS = "todos";
const inicioDoAno = () => `${new Date().getFullYear()}-01-01`;

export default function RelatoriosTreinamentosContrato() {
  const [empresa, setEmpresa] = useState<string>(TODOS);
  const [filial, setFilial] = useState<string>(TODOS);
  const [de, setDe] = useState(inicioDoAno());
  const [ate, setAte] = useState("");
  const [buscaTrein, setBuscaTrein] = useState("");
  const [buscaColab, setBuscaColab] = useState("");

  const emp = empresa === TODOS ? null : Number(empresa);
  const contratos = useContratosTreinamento(emp);
  const lista = useTreinamentosContrato({ empresa: emp, filial: filial === TODOS ? null : Number(filial), de: de || null, ate: ate || null });

  const treinos = useMemo(() => {
    const t = normalizarTexto(buscaTrein);
    return (lista.data ?? []).filter((x) => !t || normalizarTexto(`${x.nome} ${x.tema ?? ""}`).includes(t));
  }, [lista.data, buscaTrein]);
  const ids = useMemo(() => treinos.map((t) => t.id), [treinos]);
  const dados = useDadosTreinamentos(ids);
  const d = dados.data ?? { participantes: [], arquivos: [], avaliacoes: [], satisfacao: [] };

  const dosTreinos = (idsSet: Set<number>) => ({
    participantes: d.participantes.filter((p) => idsSet.has(p.treinamento_id)),
    avaliacoes: d.avaliacoes.filter((a) => idsSet.has(a.treinamento_id)),
    satisfacao: d.satisfacao.filter((s) => idsSet.has(s.treinamento_id)),
  });
  const geral = calcularIndicadores(d);

  const porTreino = useMemo(() => treinos.map((t) => ({ t, i: calcularIndicadores(dosTreinos(new Set([t.id]))) })), [treinos, d]); // eslint-disable-line react-hooks/exhaustive-deps

  const agrupar = (chave: (t: TreinamentoContrato) => string, rotulo: (t: TreinamentoContrato) => string) => {
    const m = new Map<string, { rotulo: string; treinos: TreinamentoContrato[]; horas: number }>();
    for (const t of treinos) {
      const k = chave(t);
      const g = m.get(k) ?? { rotulo: rotulo(t), treinos: [], horas: 0 };
      g.treinos.push(t); g.horas += t.carga_horaria ?? 0;
      m.set(k, g);
    }
    return Array.from(m.values()).map((g) => ({ ...g, i: calcularIndicadores(dosTreinos(new Set(g.treinos.map((t) => t.id)))) }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"));
  };
  const porEmpresa = useMemo(() => agrupar((t) => String(t.empresa), (t) => siglaEmpresa(t.empresa)), [treinos, d]); // eslint-disable-line react-hooks/exhaustive-deps
  const porContrato = useMemo(() => agrupar((t) => `${t.empresa}-${t.filial}`, (t) => `${siglaEmpresa(t.empresa)} · ${t.contrato_nome}`), [treinos, d]); // eslint-disable-line react-hooks/exhaustive-deps

  const porColaborador = useMemo(() => {
    const tMap = new Map(treinos.map((t) => [t.id, t]));
    const b = normalizarTexto(buscaColab); const bCpf = buscaColab.replace(/\D/g, "");
    return d.participantes
      .filter((p) => !b || normalizarTexto(p.nome).includes(b) || (bCpf.length >= 3 && (normalizarCpf(p.cpf) ?? "").includes(bCpf)))
      .map((p) => {
        const t = tMap.get(p.treinamento_id)!;
        const a = casarParticipante(p, d.avaliacoes.filter((x) => x.treinamento_id === p.treinamento_id).map((x) => ({ ...x, presente: true })));
        return { p, t, nota: (a as any)?.nota ?? null, aprovado: (a as any)?.aprovado ?? null };
      })
      .filter((r) => r.t)
      .sort((x, y) => x.p.nome.localeCompare(y.p.nome, "pt-BR") || y.t.data.localeCompare(x.t.data));
  }, [d, treinos, buscaColab]);

  const perguntas = useMemo(() => mediasPorPergunta(d.satisfacao.map((s) => s.respostas ?? {})), [d.satisfacao]);

  const exportar = () => {
    const ind = (i: Indicadores) => ({
      Participantes: i.participantes, Presentes: i.presentes, "Presença %": i.taxaPresenca, Avaliações: i.avaliacoes,
      "Nota média": i.notaMedia, Aprovados: i.aprovados, "Aprovação %": i.taxaAprovacao, "Respostas satisfação": i.respostasSatisfacao, "Satisfação (0-10)": i.satisfacaoMedia,
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porTreino.map(({ t, i }) => ({
      Empresa: siglaEmpresa(t.empresa), Contrato: t.contrato_nome, Data: fmtDataBr(t.data), Treinamento: t.nome, Tema: t.tema ?? "",
      "Carga horária": t.carga_horaria ?? "", Responsável: t.responsavel ?? "", Local: t.local ?? "", ...ind(i),
    }))), "Treinamentos");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porContrato.map((g) => ({ Contrato: g.rotulo, Treinamentos: g.treinos.length, "Horas": g.horas, ...ind(g.i) }))), "Por contrato");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porEmpresa.map((g) => ({ Empresa: g.rotulo, Treinamentos: g.treinos.length, "Horas": g.horas, ...ind(g.i) }))), "Por empresa");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porColaborador.map((r) => ({
      Colaborador: r.p.nome, CPF: r.p.cpf ? formatarCpf(r.p.cpf) : "", Cargo: r.p.cargo ?? "", Empresa: siglaEmpresa(r.t.empresa), Contrato: r.t.contrato_nome,
      Data: fmtDataBr(r.t.data), Treinamento: r.t.nome, "Carga horária": r.t.carga_horaria ?? "", Presença: r.p.presente ? "Presente" : "Ausente",
      Nota: r.nota ?? "", Resultado: r.aprovado == null ? "" : r.aprovado ? "Aprovado" : "Reprovado",
    }))), "Por colaborador");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(perguntas.map((p) => ({ Pergunta: p.pergunta, "Média (0-10)": p.media, Respostas: p.n }))), "Satisfação");
    XLSX.writeFile(wb, `treinamentos-por-contrato-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const carregando = lista.isLoading || (ids.length > 0 && dados.isLoading);
  const contratosEmpresa = (contratos.data ?? []).filter((c) => c.treinamentos > 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Relatórios de treinamentos" module="Treinamentos" breadcrumb={["Treinamentos por Contrato", "Relatórios"]}
        subtitle="Presença, avaliações e satisfação por empresa, contrato, treinamento, período e colaborador."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link to="/app/treinamentos/contratos"><ArrowLeft className="mr-2 h-4 w-4" />Contratos</Link></Button>
            <AcessoGate menu={MENU_TRN_CONTRATOS} acao="exportar">
              <Button onClick={exportar} disabled={carregando || !treinos.length}><Download className="mr-2 h-4 w-4" />Exportar Excel</Button>
            </AcessoGate>
          </div>
        } />

      <div className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6">
        <div>
          <Label>Empresa</Label>
          <Select value={empresa} onValueChange={(v) => { setEmpresa(v); setFilial(TODOS); }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas</SelectItem>
              {EMPRESAS_TREINAMENTO.map((e) => <SelectItem key={e.codigo} value={String(e.codigo)}>{e.sigla}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="lg:col-span-2">
          <Label>Contrato</Label>
          <Select value={filial} onValueChange={setFilial} disabled={emp == null}>
            <SelectTrigger><SelectValue placeholder={emp == null ? "Escolha a empresa" : "Todos"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos</SelectItem>
              {contratosEmpresa.map((c) => <SelectItem key={c.filial} value={String(c.filial)}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div><Label>De</Label><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div><Label>Até</Label><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        <div><Label>Treinamento</Label><Input placeholder="Nome ou tema" value={buscaTrein} onChange={(e) => setBuscaTrein(e.target.value)} /></div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icone={GraduationCap} rotulo="Treinamentos" valor={treinos.length} dica={`${treinos.reduce((a, t) => a + (t.carga_horaria ?? 0), 0).toLocaleString("pt-BR")} h no total`} cor="bg-indigo-50 text-indigo-600" />
        <Kpi icone={Users} rotulo="Presença" valor={fmtPct(geral.taxaPresenca)} dica={`${geral.presentes} de ${geral.participantes}`} cor="bg-emerald-50 text-emerald-600" />
        <Kpi icone={ClipboardCheck} rotulo="Nota média" valor={fmtNota(geral.notaMedia)} dica={`aprovação ${fmtPct(geral.taxaAprovacao)}`} cor="bg-amber-50 text-amber-600" />
        <Kpi icone={Star} rotulo="Satisfação (0–10)" valor={fmtNota(geral.satisfacaoMedia)} dica={`${geral.respostasSatisfacao} resposta(s)`} cor="bg-pink-50 text-pink-600" />
      </div>

      {carregando ? (
        <div className="flex items-center justify-center p-10 text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Calculando…</div>
      ) : (
        <Tabs defaultValue="treinamentos">
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="treinamentos">Por treinamento</TabsTrigger>
            <TabsTrigger value="contratos">Por contrato</TabsTrigger>
            <TabsTrigger value="empresas">Por empresa</TabsTrigger>
            <TabsTrigger value="colaboradores">Por colaborador</TabsTrigger>
            <TabsTrigger value="satisfacao">Satisfação</TabsTrigger>
          </TabsList>

          <TabsContent value="treinamentos" className="rounded-xl border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Treinamento</TableHead><TableHead>Contrato</TableHead><TableHead className="text-right">Presença</TableHead><TableHead className="text-right">Nota</TableHead><TableHead className="text-right">Aprovação</TableHead><TableHead className="text-right">Satisfação</TableHead></TableRow></TableHeader>
              <TableBody>
                {porTreino.length === 0 && <Vazio n={7} />}
                {porTreino.map(({ t, i }) => (
                  <TableRow key={t.id}>
                    <TableCell>{fmtDataBr(t.data)}</TableCell>
                    <TableCell className="font-medium"><Link className="hover:underline" to={`/app/treinamentos/contratos/treinamento/${t.id}`}>{t.nome}</Link></TableCell>
                    <TableCell>{siglaEmpresa(t.empresa)} · {t.contrato_nome}</TableCell>
                    <TableCell className="text-right">{i.presentes}/{i.participantes} <span className="text-xs text-muted-foreground">({fmtPct(i.taxaPresenca)})</span></TableCell>
                    <TableCell className="text-right">{fmtNota(i.notaMedia)}</TableCell>
                    <TableCell className="text-right">{fmtPct(i.taxaAprovacao)}</TableCell>
                    <TableCell className="text-right">{fmtNota(i.satisfacaoMedia)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>

          {([["contratos", porContrato, "Contrato"], ["empresas", porEmpresa, "Empresa"]] as const).map(([v, grupos, rot]) => (
            <TabsContent key={v} value={v} className="rounded-xl border bg-card">
              <Table>
                <TableHeader><TableRow><TableHead>{rot}</TableHead><TableHead className="text-right">Treinamentos</TableHead><TableHead className="text-right">Horas</TableHead><TableHead className="text-right">Presença</TableHead><TableHead className="text-right">Nota</TableHead><TableHead className="text-right">Aprovação</TableHead><TableHead className="text-right">Satisfação</TableHead></TableRow></TableHeader>
                <TableBody>
                  {grupos.length === 0 && <Vazio n={7} />}
                  {grupos.map((g) => (
                    <TableRow key={g.rotulo}>
                      <TableCell className="font-medium">{g.rotulo}</TableCell>
                      <TableCell className="text-right">{g.treinos.length}</TableCell>
                      <TableCell className="text-right">{g.horas.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right">{g.i.presentes}/{g.i.participantes} <span className="text-xs text-muted-foreground">({fmtPct(g.i.taxaPresenca)})</span></TableCell>
                      <TableCell className="text-right">{fmtNota(g.i.notaMedia)}</TableCell>
                      <TableCell className="text-right">{fmtPct(g.i.taxaAprovacao)}</TableCell>
                      <TableCell className="text-right">{fmtNota(g.i.satisfacaoMedia)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TabsContent>
          ))}

          <TabsContent value="colaboradores" className="space-y-3">
            <Input className="max-w-sm" placeholder="Filtrar colaborador por nome ou CPF" value={buscaColab} onChange={(e) => setBuscaColab(e.target.value)} />
            <div className="rounded-xl border bg-card">
              <Table>
                <TableHeader><TableRow><TableHead>Colaborador</TableHead><TableHead>CPF</TableHead><TableHead>Data</TableHead><TableHead>Treinamento</TableHead><TableHead>Contrato</TableHead><TableHead>Presença</TableHead><TableHead className="text-right">Nota</TableHead><TableHead>Resultado</TableHead></TableRow></TableHeader>
                <TableBody>
                  {porColaborador.length === 0 && <Vazio n={8} />}
                  {porColaborador.slice(0, 500).map(({ p, t, nota, aprovado }) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell>{p.cpf ? formatarCpf(p.cpf) : "—"}</TableCell>
                      <TableCell>{fmtDataBr(t.data)}</TableCell>
                      <TableCell>{t.nome}</TableCell>
                      <TableCell>{siglaEmpresa(t.empresa)} · {t.contrato_nome}</TableCell>
                      <TableCell>{p.presente ? <span className="text-emerald-600">Presente</span> : <span className="text-red-600">Ausente</span>}</TableCell>
                      <TableCell className="text-right">{fmtNota(nota)}</TableCell>
                      <TableCell>{aprovado == null ? "—" : aprovado ? "Aprovado" : "Reprovado"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {porColaborador.length > 500 && <p className="p-3 text-xs text-muted-foreground">Mostrando 500 de {porColaborador.length}. Filtre ou exporte para ver todos.</p>}
            </div>
          </TabsContent>

          <TabsContent value="satisfacao" className="rounded-xl border bg-card">
            <Table>
              <TableHeader><TableRow><TableHead>Pergunta</TableHead><TableHead className="text-right">Média (0–10)</TableHead><TableHead className="text-right">Respostas</TableHead></TableRow></TableHeader>
              <TableBody>
                {perguntas.length === 0 && <Vazio n={3} texto="Nenhuma pergunta de escala importada no período." />}
                {perguntas.map((p) => (
                  <TableRow key={p.pergunta}><TableCell>{p.pergunta}</TableCell><TableCell className="text-right">{fmtNota(p.media)}</TableCell><TableCell className="text-right">{p.n}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function Vazio({ n, texto = "Nenhum treinamento no filtro." }: { n: number; texto?: string }) {
  return <TableRow><TableCell colSpan={n} className="py-8 text-center text-muted-foreground">{texto}</TableCell></TableRow>;
}
