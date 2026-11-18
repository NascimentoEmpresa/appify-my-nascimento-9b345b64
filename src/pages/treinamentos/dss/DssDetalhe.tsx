import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, ClipboardCheck, Download, Eye, FileUp, Loader2, Search, ShieldCheck, Square, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import { useDss, useEncerrarDss, useFolhasDss, usePessoasDss } from "@/hooks/useDss";
import {
  MENU_DSS, ROTULO_STATUS_PESSOA, agregarPorContrato, assinou, calcularIndicadoresDss, filtrarPessoas, fmtPctDss,
  hojeIso, rotuloSemana, statusPessoa, vigenteEm, type LinhaContratoDss, type PessoaDss, type StatusPessoaDss,
} from "@/lib/treinamentos/dss";
import { fmtDataBr, siglaEmpresa } from "@/lib/treinamentos/contratoTreinamento";
import { Kpi } from "@/pages/treinamentos/contratos/componentes";
import { BarraPct, LancarPapelDialog, LinkAnexo, SeloContrato, SeloPessoa, SeloSituacao, exportarXlsx, fmtDataHoraBr } from "./componentes";

// =====================================================================
// TREINAMENTOS › DSS › um DSS (SIS-2026-0891). O conteúdo publicado (fixo),
// a situação de cada contrato e de cada pessoa, e o lançamento da folha
// assinada em papel para quem fez o DSS com o encarregado.
// =====================================================================

const TODOS = "todos";

/** As pessoas já trazem tudo: a linha por contrato sai delas (mesma conta do painel). */
function linhasDePessoas(dssId: string, pessoas: PessoaDss[]): LinhaContratoDss[] {
  const m = new Map<string, LinhaContratoDss>();
  for (const p of pessoas) {
    const k = `${p.empresa}/${p.filial}`;
    const l = m.get(k) ?? { dss_id: dssId, empresa: p.empresa, filial: p.filial, contrato_nome: p.contrato_nome, destinatarios: 0, acessaram: 0, assinaram: 0, assinaram_papel: 0 };
    const s = statusPessoa(p);
    l.destinatarios += 1;
    if (s !== "nao_acessado") l.acessaram += 1;
    if (assinou(s)) l.assinaram += 1;
    if (s === "assinado_papel") l.assinaram_papel += 1;
    m.set(k, l);
  }
  return [...m.values()];
}

export default function DssDetalhe() {
  const { id } = useParams<{ id: string }>();
  const dss = useDss(id);
  const pessoasQ = usePessoasDss(id);
  const folhas = useFolhasDss(id);
  const encerrar = useEncerrarDss();
  const podeExportar = useScreenAccess(MENU_DSS, "exportar").data === true;
  const [contrato, setContrato] = useState(TODOS);
  const [status, setStatus] = useState<StatusPessoaDss | "pendentes" | "todos">("todos");
  const [busca, setBusca] = useState("");
  const [papelAberto, setPapelAberto] = useState(false);

  const pessoas = useMemo(() => pessoasQ.data ?? [], [pessoasQ.data]);
  const linhas = useMemo(() => (id ? linhasDePessoas(id, pessoas) : []), [id, pessoas]);
  const contratos = agregarPorContrato(linhas);
  const linhasFiltradas = contrato === TODOS ? linhas : linhas.filter((l) => `${l.empresa}/${l.filial}` === contrato);
  const ind = calcularIndicadoresDss(linhasFiltradas);
  const contratoSel = contratos.find((c) => c.chave === contrato) ?? null;
  const lista = filtrarPessoas(contrato === TODOS ? pessoas : pessoas.filter((p) => `${p.empresa}/${p.filial}` === contrato), { status, busca });

  if (dss.isLoading) return <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando…</div>;
  if (dss.isError || !dss.data) return (
    <div className="space-y-3">
      <Button variant="ghost" asChild><Link to="/app/treinamentos/dss"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
      <p className="text-sm text-muted-foreground">{dss.error ? (dss.error as Error).message : "DSS não encontrado."}</p>
    </div>
  );
  const d = dss.data;
  const vigente = vigenteEm(d, hojeIso());

  const exportar = () => exportarXlsx(`dss-${d.semana_ref}-${d.tema.slice(0, 30).replace(/[^\w-]+/g, "_")}.xlsx`, [
    { nome: "Colaboradores", linhas: pessoas.map((p) => ({
      Colaborador: p.nome, Matrícula: p.matricula ?? "", Cargo: p.cargo ?? "", Empresa: siglaEmpresa(p.empresa), Contrato: p.contrato_nome,
      Tema: d.tema, "Disponibilizado em": fmtDataBr(d.disponivel_de), Status: ROTULO_STATUS_PESSOA[statusPessoa(p)],
      Acesso: fmtDataHoraBr(p.acessado_em), Assinatura: fmtDataHoraBr(p.assinado_em), Origem: p.origem ?? "", Comprovação: p.assinatura_hash ?? "",
    })) },
    { nome: "Por contrato", linhas: contratos.map((c) => ({
      Empresa: siglaEmpresa(c.empresa), Contrato: c.contrato_nome, Colaboradores: c.destinatarios, Acessaram: c.acessaram,
      Assinaram: c.assinaram, "Em papel": c.assinaram_papel, Pendentes: c.destinatarios - c.assinaram, "% conclusão": c.pct,
    })) },
  ]);

  return (
    <div className="space-y-4">
      <PageHeader title={d.tema} module="Treinamentos" breadcrumb={["DSS", d.tema]}
        subtitle={`${rotuloSemana(d.semana_ref)} · disponível de ${fmtDataBr(d.disponivel_de)} ${d.disponivel_ate ? `a ${fmtDataBr(d.disponivel_ate)}` : "até encerrar"}`}
        actions={<div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild><Link to="/app/treinamentos/dss"><ArrowLeft className="mr-2 h-4 w-4" />Voltar</Link></Button>
          {podeExportar && <Button variant="outline" onClick={exportar}><Download className="mr-2 h-4 w-4" />Exportar</Button>}
          {d.situacao === "publicado" && (
            <AcessoGate menu={MENU_DSS} acao="alterar">
              <Button variant="outline" disabled={encerrar.isPending} onClick={() => {
                if (!window.confirm("Encerrar este DSS? Quem ainda não assinou não vai mais conseguir assinar pelo portal. Folhas em papel continuam podendo ser lançadas.")) return;
                encerrar.mutate(d.id, { onSuccess: () => toast.success("DSS encerrado."), onError: (e) => toast.error((e as Error).message) });
              }}><Square className="mr-2 h-4 w-4" />Encerrar</Button>
            </AcessoGate>
          )}
        </div>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 rounded-xl border bg-card p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-2">
            <SeloSituacao situacao={d.situacao} vigente={vigente} />
            <span className="text-xs text-muted-foreground">
              {d.todos_contratos ? "Todos os contratos" : `${d.contratos.length} contrato(s)`} · publicado em {fmtDataHoraBr(d.publicado_em)}
              {d.encerrado_em ? ` · encerrado em ${fmtDataHoraBr(d.encerrado_em)}` : ""}
            </span>
          </div>
          {d.conteudo.trim() && <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{d.conteudo}</div>}
          {d.arquivo_path && <LinkAnexo path={d.arquivo_path} nome={d.arquivo_nome} />}
          {d.conteudo_hash && <p className="break-all text-[11px] text-muted-foreground">Código do conteúdo publicado (SHA-256): {d.conteudo_hash}</p>}
        </div>
        <div className="space-y-2 rounded-xl border bg-card p-4">
          <p className="text-sm font-semibold">Folhas em papel</p>
          {(folhas.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nenhuma folha lançada. Escolha um contrato abaixo para lançar a folha que voltou assinada.</p>}
          {(folhas.data ?? []).map((f) => (
            <div key={f.id} className="text-xs">
              <LinkAnexo path={f.storage_path} nome={f.arquivo_nome} />
              <p className="text-muted-foreground">{f.contrato_nome} · {fmtDataHoraBr(f.anexado_em)}</p>
            </div>
          ))}
        </div>
      </div>

      {pessoasQ.isLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando colaboradores…</div> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Kpi icone={Users} rotulo="Colaboradores" valor={ind.destinatarios} cor="bg-slate-100 text-slate-700" />
            <Kpi icone={Eye} rotulo="Acessaram" valor={ind.acessaram} dica={`${ind.naoAcessaram} não acessaram`} cor="bg-sky-100 text-sky-700" />
            <Kpi icone={ClipboardCheck} rotulo="Assinaram" valor={ind.assinaram} dica={`${ind.assinaramPapel} em papel`} cor="bg-emerald-100 text-emerald-700" />
            <Kpi icone={UserX} rotulo="Pendentes" valor={ind.pendentes} dica={`${ind.aguardando} leram e não assinaram`} cor="bg-amber-100 text-amber-700" />
            <Kpi icone={ShieldCheck} rotulo="% de conclusão" valor={fmtPctDss(ind.pctConclusao)} cor="bg-primary/10 text-primary" />
            <Kpi icone={CheckCircle2} rotulo="Contratos concluídos" valor={`${ind.contratosConcluidos}/${ind.contratos}`} cor="bg-emerald-100 text-emerald-700" />
          </div>

          {contrato === TODOS && (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Contrato</TableHead><TableHead className="text-right">Colaboradores</TableHead>
                  <TableHead className="text-right">Assinaram</TableHead><TableHead className="text-right">Pendentes</TableHead>
                  <TableHead>Conclusão</TableHead><TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {contratos.map((c) => (
                    <TableRow key={c.chave} className="cursor-pointer" onClick={() => setContrato(c.chave)}>
                      <TableCell className="font-medium">{c.contrato_nome} <span className="text-xs text-muted-foreground">· {siglaEmpresa(c.empresa)}</span></TableCell>
                      <TableCell className="text-right tabular-nums">{c.destinatarios}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.assinaram}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.destinatarios - c.assinaram}</TableCell>
                      <TableCell><BarraPct valor={c.pct} /></TableCell>
                      <TableCell><SeloContrato status={c.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full sm:w-80">
              <Select value={contrato} onValueChange={setContrato}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={TODOS}>Todos os contratos</SelectItem>
                  {contratos.map((c) => <SelectItem key={c.chave} value={c.chave}>{c.contrato_nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:w-60">
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos os status</SelectItem>
                  <SelectItem value="pendentes">Pendentes (não assinaram)</SelectItem>
                  <SelectItem value="nao_acessado">{ROTULO_STATUS_PESSOA.nao_acessado}</SelectItem>
                  <SelectItem value="aguardando">{ROTULO_STATUS_PESSOA.aguardando}</SelectItem>
                  <SelectItem value="assinado">{ROTULO_STATUS_PESSOA.assinado}</SelectItem>
                  <SelectItem value="assinado_papel">{ROTULO_STATUS_PESSOA.assinado_papel}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Nome, matrícula ou CPF" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            {contratoSel && (
              <AcessoGate menu={MENU_DSS} acao="alterar">
                <Button variant="outline" onClick={() => setPapelAberto(true)}><FileUp className="mr-2 h-4 w-4" />Lançar folha em papel</Button>
              </AcessoGate>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Colaborador</TableHead><TableHead>Contrato</TableHead><TableHead>Status</TableHead>
                <TableHead>Acesso</TableHead><TableHead>Assinatura</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {lista.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Ninguém com esse filtro.</TableCell></TableRow>}
                {lista.map((p) => (
                  <TableRow key={p.empregado_id}>
                    <TableCell><p className="font-medium">{p.nome}</p><p className="text-xs text-muted-foreground">{p.matricula ? `Mat. ${p.matricula}` : ""}{p.cargo ? ` · ${p.cargo}` : ""}</p></TableCell>
                    <TableCell className="text-xs">{p.contrato_nome}</TableCell>
                    <TableCell><SeloPessoa status={statusPessoa(p)} /></TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{fmtDataHoraBr(p.acessado_em)}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs" title={p.assinatura_hash ?? undefined}>{fmtDataHoraBr(p.assinado_em)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <LancarPapelDialog aberto={papelAberto} onFechar={() => setPapelAberto(false)} dssId={d.id} pessoas={pessoas}
        contrato={contratoSel ? { empresa: contratoSel.empresa, filial: contratoSel.filial, nome: contratoSel.contrato_nome } : null} />
    </div>
  );
}
