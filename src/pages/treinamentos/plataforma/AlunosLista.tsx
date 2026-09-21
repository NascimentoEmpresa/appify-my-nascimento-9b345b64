import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, Filter, MoreVertical, Search, Sliders, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { rpcTodasAsLinhas, useTrnAcaoMassa, useTrnAlunos, useTrnCursos, useTrnExcluirAluno, useTrnTags } from "@/hooks/useTreinamentosPlataforma";
import { MENU, ROTULO_STATUS_ALUNO, type AlunoLista, type StatusAluno } from "./tipos";
import { Paginacao, StatusAlunoBadge, TagChips, TrnCarregando, TrnEstilo, TrnHero, TrnVazio, fmtData, fmtDataHora, usePaginacao } from "./ui";

// =====================================================================
// TREINAMENTOS — Alunos › Visualizar (a lista "Todos os alunos" do membox).
//
// Busca, filtros (tag, curso, status, expiração), colunas opcionais,
// exportação da lista em .xlsx, ações em massa por recorte (tag ou os
// selecionados) e o menu de linha (editar, métricas, histórico,
// certificados, bloquear, excluir). A regra de quem pode o quê está na RLS
// e na RPC `trn_acao_massa`; aqui só se monta a chamada.
// =====================================================================

type ColunaOpcional = "telefone" | "documento" | "tags" | "cursos" | "concluidas" | "cadastro" | "ultimo_acesso";
const COLUNAS: { k: ColunaOpcional; rotulo: string; padrao: boolean }[] = [
  { k: "telefone", rotulo: "Telefone", padrao: true },
  { k: "documento", rotulo: "Documento", padrao: true },
  { k: "tags", rotulo: "Tags", padrao: true },
  { k: "cursos", rotulo: "Cursos", padrao: false },
  { k: "concluidas", rotulo: "Aulas concluídas", padrao: false },
  { k: "cadastro", rotulo: "Cadastro", padrao: false },
  { k: "ultimo_acesso", rotulo: "Último acesso", padrao: false },
];

const ACOES_MASSA: { v: string; rotulo: string; param?: "curso" | "tag" | "texto" | "data" | "dias"; perigo?: boolean }[] = [
  { v: "adicionar_curso", rotulo: "Adicionar alunos em curso", param: "curso" },
  { v: "remover_curso", rotulo: "Remover alunos de curso", param: "curso" },
  { v: "adicionar_tag", rotulo: "Adicionar nova tag aos alunos", param: "tag" },
  { v: "remover_tag", rotulo: "Remover tag", param: "tag" },
  { v: "observacao", rotulo: "Aplicar observação nos alunos", param: "texto" },
  { v: "ativar", rotulo: "Ativar alunos pendentes" },
  { v: "bloquear", rotulo: "Bloquear alunos" },
  { v: "desbloquear", rotulo: "Desbloquear alunos" },
  { v: "data_matricula", rotulo: "Alterar data de matrícula", param: "data" },
  { v: "prazo_acesso", rotulo: "Adicionar prazo de acesso à plataforma", param: "dias" },
  { v: "remover_prazo", rotulo: "Remover prazo de acesso à plataforma" },
  { v: "excluir", rotulo: "Excluir alunos da plataforma", perigo: true },
];

export default function AlunosLista() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: alunos = [], isLoading } = useTrnAlunos();
  const { data: tags = [] } = useTrnTags();
  const { data: cursos = [] } = useTrnCursos();
  const excluir = useTrnExcluirAluno();
  const massa = useTrnAcaoMassa();

  const [busca, setBusca] = useState("");
  // `?tag=<id>` vem do cartão em Alunos › Tags: abre já filtrada.
  const [mostrarFiltros, setMostrarFiltros] = useState(!!params.get("tag"));
  const [fTag, setFTag] = useState(params.get("tag") ?? "");
  const [fCurso, setFCurso] = useState("");
  const [fStatus, setFStatus] = useState<"" | StatusAluno>("");
  const [fExpira, setFExpira] = useState<"" | "vitalicio" | "expira" | "expirado">("");
  const [colunas, setColunas] = useState<Set<ColunaOpcional>>(new Set(COLUNAS.filter((c) => c.padrao).map((c) => c.k)));
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  // Matrículas por aluno só entram no filtro por curso — carrega sob demanda.
  const [alunosDoCurso, setAlunosDoCurso] = useState<Set<string> | null>(null);
  const filtrarCurso = async (cursoId: string) => {
    setFCurso(cursoId);
    if (!cursoId) { setAlunosDoCurso(null); return; }
    const { data } = await (supabase as any).from("TRN_MATRICULA").select("aluno_id").eq("curso_id", cursoId);
    const cursoPublicado = cursos.find((c) => c.id === cursoId)?.publicado;
    const ids = new Set<string>((data ?? []).map((m: any) => m.aluno_id));
    if (cursoPublicado) alunos.filter((a) => a.acesso_completo).forEach((a) => ids.add(a.id));
    setAlunosDoCurso(ids);
  };

  const hoje = new Date().toISOString().slice(0, 10);
  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return alunos.filter((a) => {
      if (b && !`${a.nome} ${a.email} ${a.telefone ?? ""} ${a.documento ?? ""}`.toLowerCase().includes(b)) return false;
      if (fTag && !a.tag_ids.includes(fTag)) return false;
      if (fStatus && a.status !== fStatus) return false;
      if (fExpira === "vitalicio" && a.expira_em) return false;
      if (fExpira === "expira" && (!a.expira_em || a.expira_em < hoje)) return false;
      if (fExpira === "expirado" && (!a.expira_em || a.expira_em >= hoje)) return false;
      if (alunosDoCurso && !alunosDoCurso.has(a.id)) return false;
      return true;
    });
  }, [alunos, busca, fTag, fStatus, fExpira, alunosDoCurso, hoje]);

  const pag = usePaginacao(filtrados, 20);
  const todosDaPagina = pag.itens.length > 0 && pag.itens.every((a) => selecionados.has(a.id));
  const alternarPagina = () => {
    const n = new Set(selecionados);
    if (todosDaPagina) pag.itens.forEach((a) => n.delete(a.id)); else pag.itens.forEach((a) => n.add(a.id));
    setSelecionados(n);
  };
  const alternar = (id: string) => { const n = new Set(selecionados); if (n.has(id)) n.delete(id); else n.add(id); setSelecionados(n); };

  const exportar = () => {
    const linhas = filtrados.map((a) => ({
      Nome: a.nome, "E-mail": a.email, Telefone: a.telefone ?? "", Documento: a.documento ?? "",
      Status: ROTULO_STATUS_ALUNO[a.status], "Expira em": a.expira_em ? fmtData(a.expira_em) : "Vitalício",
      Tags: a.tags.join("; "), Cursos: a.cursos, "Aulas concluídas": a.aulas_concluidas,
      Cadastro: fmtData(a.created_at), "Último acesso": a.ultimo_acesso_em ? fmtDataHora(a.ultimo_acesso_em) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(linhas);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Alunos");
    XLSX.writeFile(wb, `alunos-${hoje}.xlsx`);
  };

  // ── Ações em massa ────────────────────────────────────────────────
  // Recortes (21/09/2026): além de tag / selecionados / todos, dá pra pegar
  // um CONTRATO inteiro (um ou vários, só quem está Trabalhando ou todo
  // mundo) e por status de aluno — "cadastrar um contrato inteiro em alguns
  // cursos". E as ações de curso aceitam VÁRIOS cursos de uma vez (a RPC
  // roda uma vez por curso). O contrato/status de cada aluno vem da
  // trn_alunos_gerenciar (espelho do cadastro), lida só quando o modal abre.
  const [massaAberta, setMassaAberta] = useState(false);
  const [mFiltro, setMFiltro] = useState<"tag" | "selecionados" | "todos" | "contrato" | "status">("tag");
  const [mTag, setMTag] = useState("");
  const [mContratos, setMContratos] = useState<string[]>([]);
  const [mSoAtivos, setMSoAtivos] = useState(true);
  const [mStatus, setMStatus] = useState<"ativo" | "inativo" | "bloqueado" | "pendente">("ativo");
  const [mAcao, setMAcao] = useState("");
  const [mParam, setMParam] = useState("");
  const [mCursos, setMCursos] = useState<string[]>([]);
  const [mBuscaContrato, setMBuscaContrato] = useState("");
  const acaoDef = ACOES_MASSA.find((a) => a.v === mAcao);

  const { data: cadastro = [] } = useQuery({
    queryKey: ["trn-alunos-gerenciar"],
    enabled: massaAberta,
    queryFn: () => rpcTodasAsLinhas<{ id: string; contrato: string | null; status: string; situacao: string | null }>("trn_alunos_gerenciar"),
  });
  const contratosDoCadastro = useMemo(() => {
    const m = new Map<string, { total: number; ativos: number }>();
    for (const a of cadastro) {
      if (!a.contrato) continue;
      const x = m.get(a.contrato) ?? { total: 0, ativos: 0 };
      x.total++; if (a.status === "ativo") x.ativos++;
      m.set(a.contrato, x);
    }
    return [...m.entries()].map(([nome, n]) => ({ nome, ...n })).sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));
  }, [cadastro]);
  /** Os alunos que o recorte alcança — mostrado antes de aplicar. */
  const alvoRecorte = useMemo<string[] | null>(() => {
    if (mFiltro === "selecionados") return [...selecionados];
    if (mFiltro === "contrato") return cadastro.filter((a) => a.contrato && mContratos.includes(a.contrato) && (!mSoAtivos || a.status === "ativo")).map((a) => a.id);
    if (mFiltro === "status") return cadastro.filter((a) => a.status === mStatus).map((a) => a.id);
    return null; // tag e todos: a RPC resolve
  }, [mFiltro, selecionados, cadastro, mContratos, mSoAtivos, mStatus]);
  const acaoDeCurso = acaoDef?.param === "curso";

  const aplicarMassa = async () => {
    if (!mAcao) return toast.error("Escolha a ação.");
    if (mFiltro === "tag" && !mTag) return toast.error("Escolha a tag.");
    if (mFiltro === "selecionados" && selecionados.size === 0) return toast.error("Selecione alunos na lista.");
    if (mFiltro === "contrato" && mContratos.length === 0) return toast.error("Escolha pelo menos um contrato.");
    if (alvoRecorte && alvoRecorte.length === 0) return toast.error("Nenhum aluno nesse recorte.");
    if (acaoDeCurso && mCursos.length === 0) return toast.error("Escolha pelo menos um curso.");
    if (acaoDef?.param && !acaoDeCurso && !mParam.trim()) return toast.error("Preencha o parâmetro da ação.");
    const param: Record<string, unknown> = {};
    if (acaoDef?.param === "tag") param.tag_id = mParam;
    if (acaoDef?.param === "texto") param.texto = mParam;
    if (acaoDef?.param === "data") param.data = mParam;
    if (acaoDef?.param === "dias") param.dias = Number(mParam);
    if (acaoDef?.perigo && !window.confirm("Excluir DE VEZ os alunos do recorte? Não dá para desfazer.")) return;
    try {
      const base = { acao: mAcao, alunos: alvoRecorte ?? undefined, tag: mFiltro === "tag" ? mTag : null };
      let afetados = 0, alvo = 0;
      if (acaoDeCurso) {
        for (const cursoId of mCursos) {
          const r = await massa.mutateAsync({ ...base, param: { curso_id: cursoId } });
          afetados += Number(r.afetados ?? 0); alvo = Number(r.alvo ?? alvo);
        }
      } else {
        const r = await massa.mutateAsync({ ...base, param });
        afetados = Number(r.afetados ?? 0); alvo = Number(r.alvo ?? 0);
      }
      toast.success(`${acaoDef?.rotulo}: ${afetados} registro(s) alterado(s) em ${alvo} aluno(s)${acaoDeCurso && mCursos.length > 1 ? ` · ${mCursos.length} cursos` : ""}.`);
      setMassaAberta(false); setSelecionados(new Set()); setMAcao(""); setMParam(""); setMCursos([]);
    } catch (e: any) { toast.error(e?.message ?? "Não deu para aplicar a ação."); }
  };

  const excluirUm = async (a: AlunoLista) => {
    if (!window.confirm(`Excluir ${a.nome} da plataforma? Matrículas, progresso e certificados vão junto.`)) return;
    try { await excluir.mutateAsync(a.id); toast.success("Aluno excluído."); }
    catch (e: any) { toast.error(e?.message ?? "Não deu para excluir."); }
  };
  const bloquear = async (a: AlunoLista, bloquear: boolean) => {
    try {
      await massa.mutateAsync({ acao: bloquear ? "bloquear" : "desbloquear", alunos: [a.id] });
      toast.success(bloquear ? "Aluno bloqueado." : "Aluno desbloqueado.");
    } catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.alunos} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para ver os alunos.</Card>}>
        <TrnHero
          titulo="Todos os alunos"
          texto={`${alunos.length} aluno(s) na plataforma. Busque, filtre por tag/curso/status e aplique ações em massa.`}
          acoes={<>
            <button className="sec" onClick={exportar}><Download className="h-4 w-4" /> Exportar lista</button>
            <AcessoGate menu={MENU.alunos} acao="alterar">
              <button className="sec" onClick={() => setMassaAberta(true)}><Users className="h-4 w-4" /> Ações em massa{selecionados.size > 0 ? ` (${selecionados.size})` : ""}</button>
            </AcessoGate>
            <AcessoGate menu={MENU.alunosNovo} acao="visualizar">
              <Link to="/app/treinamentos/alunos/novo"><UserPlus className="h-4 w-4" /> Gerenciar alunos</Link>
            </AcessoGate>
          </>}
        />

        <div className="trn-card mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Pesquisar por nome, e-mail, telefone ou documento" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <Button variant={mostrarFiltros ? "default" : "outline"} size="sm" onClick={() => setMostrarFiltros((v) => !v)}><Filter className="mr-1 h-4 w-4" /> Filtros</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Sliders className="mr-1 h-4 w-4" /> Colunas</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {COLUNAS.map((c) => (
                  <DropdownMenuItem key={c.k} onSelect={(e) => { e.preventDefault(); const n = new Set(colunas); if (n.has(c.k)) n.delete(c.k); else n.add(c.k); setColunas(n); }}>
                    <Checkbox checked={colunas.has(c.k)} className="mr-2" /> {c.rotulo}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {mostrarFiltros && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select value={fTag || "__"} onValueChange={(v) => setFTag(v === "__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Tags" /></SelectTrigger>
                <SelectContent><SelectItem value="__">Todas as tags</SelectItem>{tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={fCurso || "__"} onValueChange={(v) => filtrarCurso(v === "__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Todos os cursos" /></SelectTrigger>
                <SelectContent><SelectItem value="__">Todos os cursos</SelectItem>{cursos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}{c.publicado ? "" : " (rascunho)"}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={fStatus || "__"} onValueChange={(v) => setFStatus(v === "__" ? "" : (v as StatusAluno))}>
                <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                <SelectContent><SelectItem value="__">Todos os status</SelectItem>{(Object.keys(ROTULO_STATUS_ALUNO) as StatusAluno[]).map((s) => <SelectItem key={s} value={s}>{ROTULO_STATUS_ALUNO[s]}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={fExpira || "__"} onValueChange={(v) => setFExpira(v === "__" ? "" : (v as typeof fExpira))}>
                <SelectTrigger><SelectValue placeholder="Expiração" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__">Qualquer expiração</SelectItem>
                  <SelectItem value="vitalicio">Vitalício</SelectItem>
                  <SelectItem value="expira">Com prazo (no prazo)</SelectItem>
                  <SelectItem value="expirado">Expirado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {isLoading ? <TrnCarregando texto="Carregando alunos…" /> : alunos.length === 0 ? (
          <TrnVazio titulo="Nenhum aluno ainda" texto="Os alunos são os colaboradores do cadastro — sincronize em Gerenciar alunos, ou importe a planilha do membox."
                    acao={<div className="flex gap-2"><Button asChild><Link to="/app/treinamentos/alunos/novo">Gerenciar alunos</Link></Button><Button asChild variant="outline"><Link to="/app/treinamentos/alunos/importar">Importar alunos</Link></Button></div>} />
        ) : (
          <div className="trn-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="trn-tab">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><Checkbox checked={todosDaPagina} onCheckedChange={alternarPagina} /></th>
                    <th>Nome</th>
                    <th>E-mail</th>
                    {colunas.has("telefone") && <th>Telefone</th>}
                    {colunas.has("documento") && <th>Documento</th>}
                    {colunas.has("tags") && <th>Tags</th>}
                    {colunas.has("cursos") && <th>Cursos</th>}
                    {colunas.has("concluidas") && <th>Aulas concl.</th>}
                    <th>Status</th>
                    <th>Expira em</th>
                    {colunas.has("cadastro") && <th>Cadastro</th>}
                    {colunas.has("ultimo_acesso") && <th>Último acesso</th>}
                    <th style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {pag.itens.map((a) => (
                    <tr key={a.id}>
                      <td><Checkbox checked={selecionados.has(a.id)} onCheckedChange={() => alternar(a.id)} /></td>
                      <td><Link className="nome" to={`/app/treinamentos/alunos/${a.id}`}>{a.nome}</Link></td>
                      <td className="text-slate-600">{a.email}</td>
                      {colunas.has("telefone") && <td className="whitespace-nowrap">{a.telefone ?? "—"}</td>}
                      {colunas.has("documento") && <td>{a.documento ?? "—"}</td>}
                      {colunas.has("tags") && <td><TagChips nomes={a.tags} /></td>}
                      {colunas.has("cursos") && <td>{a.acesso_completo ? <span className="trn-badge info">Acesso completo</span> : a.cursos}</td>}
                      {colunas.has("concluidas") && <td>{a.aulas_concluidas}</td>}
                      <td><StatusAlunoBadge status={a.status} /></td>
                      <td className="whitespace-nowrap">{a.expira_em ? <span className={a.expira_em < hoje ? "font-semibold text-rose-600" : ""}>{fmtData(a.expira_em)}</span> : "Vitalício"}</td>
                      {colunas.has("cadastro") && <td className="whitespace-nowrap">{fmtData(a.created_at)}</td>}
                      {colunas.has("ultimo_acesso") && <td className="whitespace-nowrap">{a.ultimo_acesso_em ? fmtDataHora(a.ultimo_acesso_em) : "—"}</td>}
                      <td>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => navigate(`/app/treinamentos/alunos/${a.id}`)}>Editar</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => navigate(`/app/treinamentos/alunos/${a.id}?aba=metricas`)}>Métricas</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => navigate(`/app/treinamentos/alunos/${a.id}?aba=historico`)}>Histórico</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => navigate(`/app/treinamentos/alunos/${a.id}?aba=certificados`)}>Certificados</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {a.status === "bloqueado"
                              ? <DropdownMenuItem onSelect={() => bloquear(a, false)}>Desbloquear</DropdownMenuItem>
                              : <DropdownMenuItem onSelect={() => bloquear(a, true)}>Bloquear</DropdownMenuItem>}
                            <DropdownMenuItem className="text-rose-600" onSelect={() => excluirUm(a)}>Excluir</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                  {pag.itens.length === 0 && <tr><td colSpan={14} className="trn-vazio">Nenhum aluno bate com o filtro.</td></tr>}
                </tbody>
              </table>
            </div>
            <Paginacao {...pag} quantidade={filtrados.length} rotulo="alunos" />
          </div>
        )}

        <Dialog open={massaAberta} onOpenChange={setMassaAberta}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Deseja aplicar uma ação em massa?</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Ao clicar em "Aplicar" a ação será executada em todos os alunos que corresponderem ao recorte selecionado.</p>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Filtrar alunos por</Label>
                <Select value={mFiltro} onValueChange={(v) => setMFiltro(v as typeof mFiltro)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contrato">Contrato (todo o pessoal do contrato)</SelectItem>
                    <SelectItem value="status">Status do aluno (ativos, inativos…)</SelectItem>
                    <SelectItem value="tag">Tag do aluno</SelectItem>
                    <SelectItem value="selecionados">Alunos selecionados na lista ({selecionados.size})</SelectItem>
                    <SelectItem value="todos">Todos os alunos da plataforma</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {mFiltro === "contrato" && (
                <div>
                  <Label className="text-xs">Contratos (marque um ou vários)</Label>
                  <Input className="mt-1" placeholder="Buscar contrato…" value={mBuscaContrato} onChange={(e) => setMBuscaContrato(e.target.value)} />
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-md border p-1">
                    {contratosDoCadastro.length === 0 && <div className="p-2 text-xs text-muted-foreground">Carregando contratos…</div>}
                    {contratosDoCadastro.filter((c) => !mBuscaContrato.trim() || c.nome.toLowerCase().includes(mBuscaContrato.trim().toLowerCase())).map((c) => {
                      const on = mContratos.includes(c.nome);
                      return (
                        <label key={c.nome} className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs ${on ? "bg-primary/10" : "hover:bg-muted"}`}>
                          <Checkbox checked={on} onCheckedChange={() => setMContratos((l) => on ? l.filter((x) => x !== c.nome) : [...l, c.nome])} />
                          <span className="flex-1">{c.nome}</span>
                          <span className="text-muted-foreground">{c.ativos} ativos · {c.total} total</span>
                        </label>
                      );
                    })}
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <Checkbox checked={mSoAtivos} onCheckedChange={(v) => setMSoAtivos(v === true)} /> Só quem está Trabalhando (ativos)
                  </label>
                </div>
              )}
              {mFiltro === "status" && (
                <Select value={mStatus} onValueChange={(v) => setMStatus(v as typeof mStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativos (Trabalhando)</SelectItem>
                    <SelectItem value="inativo">Inativos (afastados e demitidos)</SelectItem>
                    <SelectItem value="bloqueado">Bloqueados</SelectItem>
                    <SelectItem value="pendente">Pendentes</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {alvoRecorte && (
                <p className="text-xs text-muted-foreground">Recorte: <b>{alvoRecorte.length}</b> aluno(s).</p>
              )}
              {mFiltro === "tag" && (
                <div>
                  <Label className="text-xs">Selecione a tag que deseja filtrar os alunos</Label>
                  <Select value={mTag || "__"} onValueChange={(v) => setMTag(v === "__" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="---" /></SelectTrigger>
                    <SelectContent><SelectItem value="__">---</SelectItem>{tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome} ({t.alunos ?? 0})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label className="text-xs">Selecione uma ação para aplicar nos alunos do recorte</Label>
                <Select value={mAcao || "__"} onValueChange={(v) => { setMAcao(v === "__" ? "" : v); setMParam(""); }}>
                  <SelectTrigger><SelectValue placeholder="---" /></SelectTrigger>
                  <SelectContent><SelectItem value="__">---</SelectItem>{ACOES_MASSA.map((a) => <SelectItem key={a.v} value={a.v} className={a.perigo ? "text-rose-600" : ""}>{a.rotulo}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {acaoDeCurso && (
                <div>
                  <Label className="text-xs">Cursos (marque um ou vários)</Label>
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-md border p-1">
                    {cursos.length === 0 && <div className="p-2 text-xs text-muted-foreground">Nenhum curso cadastrado.</div>}
                    {cursos.map((c) => {
                      const on = mCursos.includes(c.id);
                      return (
                        <label key={c.id} className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs ${on ? "bg-primary/10" : "hover:bg-muted"}`}>
                          <Checkbox checked={on} onCheckedChange={() => setMCursos((l) => on ? l.filter((x) => x !== c.id) : [...l, c.id])} />
                          <span className="flex-1">{c.nome}{c.publicado ? "" : " (rascunho)"}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {acaoDef?.param === "tag" && (
                <Select value={mParam || "__"} onValueChange={(v) => setMParam(v === "__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Tag" /></SelectTrigger>
                  <SelectContent><SelectItem value="__">Escolha a tag</SelectItem>{tags.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {acaoDef?.param === "texto" && <Textarea rows={3} placeholder="Observação a gravar em cada aluno" value={mParam} onChange={(e) => setMParam(e.target.value)} />}
              {acaoDef?.param === "data" && <Input type="date" value={mParam} onChange={(e) => setMParam(e.target.value)} />}
              {acaoDef?.param === "dias" && <Input type="number" min={1} placeholder="Dias de acesso a partir de hoje" value={mParam} onChange={(e) => setMParam(e.target.value)} />}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMassaAberta(false)}>Fechar</Button>
              <Button disabled={massa.isPending} onClick={aplicarMassa} variant={acaoDef?.perigo ? "destructive" : "default"}>Aplicar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AcessoGate>
    </div>
  );
}
