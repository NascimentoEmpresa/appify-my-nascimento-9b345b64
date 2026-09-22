import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Award, BarChart3, ChevronDown, History, Save, Trash2, UserCog } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import {
  useTrnAluno, useTrnCertificadosAluno, useTrnCursos, useTrnEmitirCertificado, useTrnExcluirAluno,
  useTrnHistorico, useTrnProgressoAluno, useTrnSalvarAluno, type AlunoInput,
} from "@/hooks/useTreinamentosPlataforma";
import { MENU, ROTULO_STATUS_ALUNO, type StatusAluno } from "./tipos";
import { StatusAlunoBadge, TagPicker, TrnCarregando, TrnEstilo, TrnHero, fmtData, fmtDataHora, hojeISO } from "./ui";

// =====================================================================
// TREINAMENTOS — Alunos › Adicionar novo / Editar (com Métricas, Histórico
// e Certificados nas abas, como os quatro botões do topo do membox).
//
// Os campos são os do membox, um a um: nome, telefone, e-mail (não muda
// depois de criado — é a identidade do aluno), documento, observação,
// idioma, tags, bloqueio, tipo de acesso (completo × personalizado com a
// lista de cursos e data de inscrição), bloquear gamificação e, em
// "Configurações adicionais", o prazo de acesso. "Alterar senha" não
// existe aqui: o login do aluno é a fase 2 (área do aluno).
// =====================================================================

const IDIOMAS = [
  { v: "padrao", r: "Usar idioma padrão das comunicações" },
  { v: "pt-BR", r: "Português (Brasil)" }, { v: "es-ES", r: "Español (España)" },
  { v: "en-US", r: "English (United States)" }, { v: "it-IT", r: "Italiano (Italia)" },
];

interface Form {
  nome: string; email: string; telefone: string; documento: string; observacoes: string; idioma: string;
  status: StatusAluno; acesso_completo: boolean; bloquear_gamificacao: boolean; prazo: string; empregado_id: number | null;
  tagIds: string[]; matriculas: Record<string, string>;
}
const VAZIO: Form = {
  nome: "", email: "", telefone: "", documento: "", observacoes: "", idioma: "padrao", status: "pendente",
  acesso_completo: false, bloquear_gamificacao: false, prazo: "", empregado_id: null, tagIds: [], matriculas: {},
};

export default function AlunoForm() {
  const { id } = useParams<{ id: string }>();
  const editando = !!id && id !== "novo";
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const aba = params.get("aba") ?? "editar";

  const { data, isLoading } = useTrnAluno(editando ? id : null);
  const { data: cursos = [] } = useTrnCursos();
  const salvar = useTrnSalvarAluno();
  const excluir = useTrnExcluirAluno();
  const [f, setF] = useState<Form>(VAZIO);
  // Veio do cadastro (origem integracao, vinculado a EMPREGADOS)?
  const daSenior = !!data && data.aluno.origem === "integracao" && data.aluno.empregado_id != null;
  const [config, setConfig] = useState(false);
  const [buscaCurso, setBuscaCurso] = useState("");

  useEffect(() => {
    if (!data) return;
    const a = data.aluno;
    setF({
      nome: a.nome, email: a.email, telefone: a.telefone ?? "", documento: a.documento ?? "", observacoes: a.observacoes ?? "",
      idioma: a.idioma, status: a.status, acesso_completo: a.acesso_completo, bloquear_gamificacao: a.bloquear_gamificacao,
      prazo: a.prazo_acesso_dias == null ? "" : String(a.prazo_acesso_dias), empregado_id: a.empregado_id,
      tagIds: data.tagIds,
      matriculas: Object.fromEntries(data.matriculas.map((m) => [m.curso_id, m.inscrito_em])),
    });
    if (a.prazo_acesso_dias != null) setConfig(true);
  }, [data]);

  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));
  const cursosFiltrados = useMemo(() => {
    const b = buscaCurso.trim().toLowerCase();
    return cursos.filter((c) => !b || c.nome.toLowerCase().includes(b));
  }, [cursos, buscaCurso]);

  const gravar = async () => {
    if (!f.nome.trim()) return toast.error("Informe o nome do aluno.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return toast.error("Informe um e-mail válido.");
    const prazo = f.prazo.trim() ? Number(f.prazo) : null;
    if (prazo !== null && (!Number.isInteger(prazo) || prazo <= 0)) return toast.error("Prazo de acesso inválido.");
    const input: AlunoInput = {
      id: editando ? id : undefined,
      nome: f.nome.trim(), email: f.email.trim().toLowerCase(), telefone: f.telefone.trim() || null,
      documento: f.documento.trim() || null, observacoes: f.observacoes.trim() || null, idioma: f.idioma,
      status: f.status, acesso_completo: f.acesso_completo, bloquear_gamificacao: f.bloquear_gamificacao,
      prazo_acesso_dias: prazo, empregado_id: f.empregado_id, tagIds: f.tagIds, matriculas: f.matriculas,
    };
    try {
      const novoId = await salvar.mutateAsync(input);
      toast.success(editando ? "Alterações salvas." : "Aluno criado.");
      if (!editando) navigate(`/app/treinamentos/alunos/${novoId}`, { replace: true });
    } catch (e: any) {
      toast.error(/uq_trn_aluno_email|duplicate/i.test(e?.message ?? "") ? "Já existe aluno com este e-mail." : (e?.message ?? "Não deu para salvar."));
    }
  };

  const apagar = async () => {
    if (!editando || !window.confirm("Excluir este aluno? Matrículas, progresso e certificados vão junto.")) return;
    try { await excluir.mutateAsync(id!); toast.success("Aluno excluído."); navigate("/app/treinamentos/alunos"); }
    catch (e: any) { toast.error(e?.message ?? "Não deu para excluir."); }
  };

  const menuTela = editando ? MENU.alunos : MENU.alunosNovo;
  const acaoTela = editando ? "alterar" : "incluir";

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={menuTela} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        <TrnHero
          eyebrow="Treinamentos › Alunos"
          titulo={editando ? (data?.aluno.nome ?? "Editar aluno") : "Adicionar aluno"}
          texto={editando ? `${data?.aluno.email ?? ""} · cadastro em ${fmtData(data?.aluno.created_at)}` : "O aluno é identificado pelo e-mail. Depois de criado, o e-mail não muda."}
          acoes={<>
            <Link to="/app/treinamentos/alunos" className="sec">← Todos os alunos</Link>
            {editando && (
              <AcessoGate menu={MENU.alunos} acao="excluir">
                <button className="sec" onClick={apagar}><Trash2 className="h-4 w-4" /> Excluir aluno</button>
              </AcessoGate>
            )}
          </>}
        />

        {editando && isLoading ? <TrnCarregando /> : (
          <Tabs value={editando ? aba : "editar"} onValueChange={(v) => setParams(v === "editar" ? {} : { aba: v })}>
            {editando && (
              <TabsList className="mb-4">
                <TabsTrigger value="editar"><UserCog className="mr-1 h-4 w-4" /> Editar</TabsTrigger>
                <TabsTrigger value="metricas"><BarChart3 className="mr-1 h-4 w-4" /> Métricas</TabsTrigger>
                <TabsTrigger value="historico"><History className="mr-1 h-4 w-4" /> Histórico</TabsTrigger>
                <TabsTrigger value="certificados"><Award className="mr-1 h-4 w-4" /> Certificados</TabsTrigger>
              </TabsList>
            )}

            <TabsContent value="editar">
              <div className="trn-lateral">
                <div className="trn-form">
                  <div className="grupo">
                    <h4>{editando ? "Editar informações" : "Adicionar informações"}</h4>
                    {/* Aluno que veio do cadastro (21/09/2026): nome, telefone, e-mail
                        e CPF são da Senior/EMPREGADOS e a sincronização sobrescreveria
                        o que fosse editado aqui — ficam travados, e o "Vincular"
                        some (já está vinculado). */}
                    {daSenior && (
                      <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                        Colaborador do cadastro da Senior (nº {f.empregado_id}). Nome, telefone, e-mail e CPF vêm de lá e acompanham o cadastro — não se editam aqui.
                      </div>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="campo sm:col-span-2"><label>Nome do aluno *</label><Input value={f.nome} disabled={daSenior} onChange={(e) => set({ nome: e.target.value })} /></div>
                      <div className="campo"><label>Telefone do aluno</label><Input placeholder="+55 (54) 9 9999-9999" value={f.telefone} disabled={daSenior} onChange={(e) => set({ telefone: e.target.value })} /></div>
                      <div className="campo">
                        <label>E-mail do aluno *</label>
                        <Input type="email" value={f.email} disabled={editando} onChange={(e) => set({ email: e.target.value })} />
                        <div className="ajuda">{daSenior ? "Vem do cadastro da Senior (EMPREGADOS)." : editando ? "O e-mail do aluno não pode ser alterado." : "O aluno usa este e-mail para acessar a plataforma."}</div>
                      </div>
                      <div className="campo"><label>Documento do aluno</label><Input placeholder="CPF" value={f.documento} disabled={daSenior} onChange={(e) => set({ documento: e.target.value })} /></div>
                      <div className="campo">
                        <label>Preferência de idioma (opcional)</label>
                        <Select value={f.idioma} onValueChange={(v) => set({ idioma: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{IDIOMAS.map((i) => <SelectItem key={i.v} value={i.v}>{i.r}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="campo sm:col-span-2"><label>Alguma observação sobre o aluno? (opcional)</label><Textarea rows={2} value={f.observacoes} onChange={(e) => set({ observacoes: e.target.value })} /></div>
                      <div className="campo sm:col-span-2">
                        <label>Vincule tags a este aluno (opcional)</label>
                        <TagPicker value={f.tagIds} onChange={(ids) => set({ tagIds: ids })} />
                        <div className="ajuda">Tags segmentam avisos, notificações e ações em massa — no membox são os postos/contratos.</div>
                      </div>
                      {!daSenior && (
                        <VinculoEmpregado empregadoId={f.empregado_id} onChange={(emp) => set({ empregado_id: emp?.id ?? null, ...(emp && !f.nome ? { nome: emp.nome } : {}), ...(emp && !f.documento ? { documento: emp.cpf } : {}), ...(emp && !f.email && emp.email ? { email: emp.email } : {}) })} />
                      )}
                    </div>
                  </div>

                  {editando && (
                    <div className="grupo">
                      <h4>Status do aluno</h4>
                      <div className="flex flex-wrap items-center gap-4">
                        <Select value={f.status} onValueChange={(v) => set({ status: v as StatusAluno })}>
                          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                          <SelectContent>{(Object.keys(ROTULO_STATUS_ALUNO) as StatusAluno[]).map((s) => <SelectItem key={s} value={s}>{ROTULO_STATUS_ALUNO[s]}</SelectItem>)}</SelectContent>
                        </Select>
                        <label className="flex items-center gap-2 text-sm">
                          <Switch checked={f.status === "bloqueado"} onCheckedChange={(v) => set({ status: v ? "bloqueado" : "ativo" })} /> Bloquear aluno
                        </label>
                      </div>
                      <div className="ajuda mt-2 text-xs text-muted-foreground">Enquanto o aluno estiver bloqueado, ele não consegue acessar a plataforma. Pendente = ainda não confirmou o cadastro.</div>
                    </div>
                  )}

                  <div className="grupo">
                    <h4>Tipo de acesso aos cursos da plataforma *</h4>
                    <p className="mb-3 text-xs text-muted-foreground">Escolha se este aluno terá acesso completo à plataforma ou apenas aos cursos que você selecionar.</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className={`trn-opcao ${!f.acesso_completo ? "on" : ""}`} onClick={() => set({ acesso_completo: false })}>
                        <input type="radio" readOnly checked={!f.acesso_completo} className="mt-1" />
                        <div><b>Acesso personalizado</b><span>Libera somente os cursos que você selecionar abaixo.</span></div>
                      </div>
                      <div className={`trn-opcao ${f.acesso_completo ? "on" : ""}`} onClick={() => set({ acesso_completo: true })}>
                        <input type="radio" readOnly checked={f.acesso_completo} className="mt-1" />
                        <div><b>Acesso completo</b><span>Libera todos os cursos publicados atuais e futuros da plataforma.</span></div>
                      </div>
                    </div>

                    {!f.acesso_completo && (
                      <div className="mt-4">
                        <Label className="text-xs">Selecione o(s) curso(s) que o aluno está inscrito</Label>
                        <Input className="my-2" placeholder="Buscar curso…" value={buscaCurso} onChange={(e) => setBuscaCurso(e.target.value)} />
                        <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border p-2">
                          {cursosFiltrados.length === 0 && <p className="p-2 text-xs text-muted-foreground">Nenhum curso cadastrado ainda.</p>}
                          {cursosFiltrados.map((c) => {
                            const on = c.id in f.matriculas;
                            const origem = data?.matriculas.find((m) => m.curso_id === c.id)?.origem;
                            return (
                              <div key={c.id} className="rounded-lg px-2 py-1.5 hover:bg-muted/50">
                                <label className="flex items-center gap-3 text-sm">
                                  <Switch checked={on} onCheckedChange={(v) => {
                                    const m = { ...f.matriculas };
                                    if (v) m[c.id] = m[c.id] || hojeISO(); else delete m[c.id];
                                    set({ matriculas: m });
                                  }} />
                                  <span className="flex-1">{c.nome}{!c.publicado && <span className="ml-2 text-[10px] text-amber-700">rascunho</span>}{origem && <span className="ml-2 text-[10px] text-slate-400">(via {origem})</span>}</span>
                                </label>
                                {on && (
                                  <div className="ml-12 mt-1 flex items-center gap-2 text-xs text-slate-500">
                                    Data de inscrição no curso:
                                    <Input type="date" className="h-7 w-40 text-xs" value={f.matriculas[c.id]} onChange={(e) => set({ matriculas: { ...f.matriculas, [c.id]: e.target.value } })} />
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="ajuda mt-1 text-xs text-muted-foreground">Para cursos com acesso personalizado, você pode alterar a data de inscrição no curso.</div>
                      </div>
                    )}
                  </div>

                  <div className="grupo">
                    <h4>Bloquear pontuação de gamificação</h4>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={f.bloquear_gamificacao} onCheckedChange={(v) => set({ bloquear_gamificacao: v })} /> Bloquear pontuação de gamificação</label>
                    <div className="ajuda mt-1 text-xs text-muted-foreground">Quando habilitado, este aluno não receberá pontos de gamificação.</div>
                  </div>

                  <button type="button" className="flex items-center gap-1 text-sm font-bold text-orange-600" onClick={() => setConfig((v) => !v)}>
                    Configurações adicionais <ChevronDown className={`h-4 w-4 transition-transform ${config ? "rotate-180" : ""}`} />
                  </button>
                  {config && (
                    <div className="grupo">
                      <div className="campo">
                        <label>Prazo de acesso direto no aluno (opcional)</label>
                        <Select value={f.prazo || "__"} onValueChange={(v) => set({ prazo: v === "__" ? "" : v })}>
                          <SelectTrigger className="w-64"><SelectValue placeholder="----" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__">Vitalício</SelectItem>
                            {[730, 365, 180, 90, 60, 30, 14, 7].map((d) => <SelectItem key={d} value={String(d)}>{d} dias</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <div className="ajuda">Aplica o prazo direto no aluno e não é ideal para alunos com cursos de prazos diferentes.{data?.aluno.expira_em ? ` Expira em ${fmtData(data.aluno.expira_em)}.` : ""}</div>
                      </div>
                    </div>
                  )}

                  <AcessoGate menu={menuTela} acao={acaoTela} fallback={<p className="text-xs text-muted-foreground">Você pode ver, mas não tem a ação de {editando ? "alterar" : "incluir"} aluno.</p>}>
                    <div><Button disabled={salvar.isPending} onClick={gravar}><Save className="mr-2 h-4 w-4" /> {editando ? "Salvar alterações" : "Criar aluno"}</Button></div>
                  </AcessoGate>
                </div>

                <div className="space-y-4">
                  {editando && data && (
                    <div className="trn-ajuda">
                      <h4>{data.aluno.nome}</h4>
                      <StatusAlunoBadge status={data.aluno.status} />
                      <h5>Data de cadastro</h5>{fmtData(data.aluno.created_at)}
                      <h5>Origem</h5>{data.aluno.origem}
                      {data.aluno.ultimo_acesso_em && <><h5>Último acesso</h5>{fmtDataHora(data.aluno.ultimo_acesso_em)}</>}
                    </div>
                  )}
                  <div className="trn-ajuda">
                    <h4>{editando ? "Editando alunos" : "Inserindo novos alunos"}</h4>
                    {editando
                      ? <>Todas as informações do aluno podem ser alteradas, exceto o e-mail de acesso. Se o e-mail foi cadastrado errado, exclua o aluno e cadastre de novo com o e-mail correto.<h5>Observação</h5>Aluno com acesso expirado: desbloqueie para renovar a data de matrícula e restabelecer o acesso.</>
                      : <>Esta área permite adicionar alunos um a um. Para muitos de uma vez, use <Link to="/app/treinamentos/alunos/importar" className="font-semibold text-primary">Importar alunos</Link>.<h5>Observação</h5>Acesso completo libera todos os cursos publicados, atuais e futuros — bom para quem precisa de toda a trilha de NRs.</>}
                  </div>
                </div>
              </div>
            </TabsContent>

            {editando && <TabsContent value="metricas"><Metricas alunoId={id!} /></TabsContent>}
            {editando && <TabsContent value="historico"><HistoricoAluno alunoId={id!} /></TabsContent>}
            {editando && <TabsContent value="certificados"><CertificadosAluno alunoId={id!} acessoCompleto={!!data?.aluno.acesso_completo} /></TabsContent>}
          </Tabs>
        )}
      </AcessoGate>
    </div>
  );
}

/** Vínculo opcional com EMPREGADOS — puxa nome/CPF/e-mail do cadastro da Senior. */
function VinculoEmpregado({ empregadoId, onChange }: { empregadoId: number | null; onChange: (e: { id: number; nome: string; cpf: string; email: string } | null) => void }) {
  const [busca, setBusca] = useState("");
  const { resultados, buscar, carregando } = useBuscaEmpregado();
  return (
    <div className="campo sm:col-span-2">
      <label>Vincular ao cadastro de colaborador (opcional)</label>
      <div className="flex gap-2">
        <Input placeholder="Buscar por nome ou CPF no cadastro da Senior" value={busca} onChange={(e) => setBusca(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(busca); } }} />
        <Button type="button" variant="outline" onClick={() => buscar(busca)} disabled={carregando}>Buscar</Button>
        {empregadoId && <Button type="button" variant="ghost" onClick={() => onChange(null)}>Desvincular</Button>}
      </div>
      {empregadoId && <div className="ajuda">Vinculado ao colaborador #{empregadoId}.</div>}
      {resultados.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border">
          {resultados.map((r) => (
            <button key={r.id} type="button" className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted" onClick={() => onChange(r)}>
              <span>{r.nome}</span><span className="text-xs text-muted-foreground">{r.cpf} · {r.setor}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function useBuscaEmpregado() {
  const [resultados, setResultados] = useState<{ id: number; nome: string; cpf: string; email: string; setor: string }[]>([]);
  const [carregando, setCarregando] = useState(false);
  const buscar = async (termo: string) => {
    const t = termo.trim();
    if (t.length < 3) { toast.info("Digite pelo menos 3 caracteres."); return; }
    setCarregando(true);
    try {
      const { data } = await (supabase as any).from("EMPREGADOS")
        .select('"ID","Nome","CPF","email","Setor_ERP"')
        .or(`"Nome".ilike.%${t}%,"CPF".ilike.%${t}%`).limit(20);
      setResultados((data ?? []).map((r: any) => ({ id: r.ID, nome: r.Nome ?? "", cpf: r.CPF ?? "", email: r.email ?? "", setor: r.Setor_ERP ?? "" })));
    } finally { setCarregando(false); }
  };
  return { resultados, buscar, carregando };
}

// ── Métricas do aluno ────────────────────────────────────────────────
function Metricas({ alunoId }: { alunoId: string }) {
  const { data: linhas = [], isLoading } = useTrnProgressoAluno(alunoId);
  const { data: hist = [] } = useTrnHistorico(alunoId);
  const cursos = useMemo(() => {
    const m = new Map<string, { nome: string; modulos: Map<string, { nome: string; posicao: number; aulas: typeof linhas }> }>();
    linhas.forEach((l) => {
      if (!m.has(l.curso_id)) m.set(l.curso_id, { nome: l.curso, modulos: new Map() });
      const c = m.get(l.curso_id)!;
      if (!c.modulos.has(l.modulo_id)) c.modulos.set(l.modulo_id, { nome: l.modulo, posicao: l.modulo_posicao, aulas: [] });
      c.modulos.get(l.modulo_id)!.aulas.push(l);
    });
    return [...m.entries()];
  }, [linhas]);
  const concluidas = linhas.filter((l) => l.concluida).length;
  const avaliadas = linhas.filter((l) => l.avaliacao != null);
  const media = avaliadas.length ? (avaliadas.reduce((s, l) => s + (l.avaliacao ?? 0), 0) / avaliadas.length).toFixed(1) : null;
  const pct = (aulas: typeof linhas) => aulas.length ? Math.round((aulas.filter((a) => a.concluida).length / aulas.length) * 100) : 0;
  const dur = (aulas: typeof linhas) => { const s = aulas.reduce((x, a) => x + a.tempo_seg, 0); return s ? `${Math.floor(s / 60)} min` : "—"; };
  const logins = hist.filter((h) => h.acao === "Login").length;

  if (isLoading) return <TrnCarregando />;
  return (
    <div className="space-y-4">
      <div className="trn-kpis">
        <div className="trn-kpi"><div><div className="rot">Aulas concluídas</div><div className="val">{concluidas}</div><div className="sub">de {linhas.length} disponíveis</div></div></div>
        <div className="trn-kpi"><div><div className="rot">Avaliação das aulas</div><div className="val">{media ?? "—"}</div><div className="sub">{avaliadas.length ? `${avaliadas.length} avaliação(ões)` : "Ainda não há avaliações"}</div></div></div>
        <div className="trn-kpi"><div><div className="rot">Logins registrados</div><div className="val">{logins}</div></div></div>
        <div className="trn-kpi"><div><div className="rot">Quizzes respondidos</div><div className="val">{linhas.filter((l) => l.nota_quiz != null).length}</div></div></div>
      </div>
      <div className="trn-card p-0">
        <table className="trn-tab">
          <thead><tr><th>Cursos</th><th style={{ width: 160 }}>Andamento</th><th>Avaliação</th><th>Duração</th></tr></thead>
          <tbody>
            {cursos.length === 0 && <tr><td colSpan={4} className="trn-vazio">Este aluno não está em nenhum curso.</td></tr>}
            {cursos.map(([cid, c]) => {
              const todas = [...c.modulos.values()].flatMap((m) => m.aulas);
              const av = todas.filter((a) => a.avaliacao != null);
              return [
                <tr key={cid} className="bg-slate-50"><td className="font-bold">{c.nome}</td><td><Barra pct={pct(todas)} /></td><td>{av.length ? (av.reduce((s, a) => s + (a.avaliacao ?? 0), 0) / av.length).toFixed(1) : "—"}</td><td>{dur(todas)}</td></tr>,
                ...[...c.modulos.values()].sort((a, b) => a.posicao - b.posicao).flatMap((m) => [
                  <tr key={`${cid}-${m.nome}`}><td className="pl-6 text-slate-600"><span className="text-[10px] uppercase text-slate-400">Módulo</span> {m.nome}</td><td><Barra pct={pct(m.aulas)} /></td><td>—</td><td>{dur(m.aulas)}</td></tr>,
                  ...m.aulas.sort((a, b) => a.aula_posicao - b.aula_posicao).map((a) => (
                    <tr key={a.aula_id}><td className="pl-10 text-slate-500"><span className="text-[10px] uppercase text-slate-400">Aula</span> {a.aula}</td><td>{a.concluida ? <span className="trn-badge ok">Concluída {a.concluida_em ? fmtData(a.concluida_em) : ""}</span> : <span className="trn-badge off">0%</span>}</td><td>{a.avaliacao ?? "—"}{a.nota_quiz != null && <span className="ml-2 text-xs text-slate-400">quiz {a.nota_quiz}%</span>}</td><td>{a.tempo_seg ? `${Math.floor(a.tempo_seg / 60)} min` : "—"}</td></tr>
                  )),
                ]),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Barra({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded bg-slate-200"><div className="h-full rounded bg-orange-500" style={{ width: `${pct}%` }} /></div>
      <span className="w-10 text-right text-xs font-semibold">{pct}%</span>
    </div>
  );
}

// ── Histórico ────────────────────────────────────────────────────────
function HistoricoAluno({ alunoId }: { alunoId: string }) {
  const { data: hist = [], isLoading } = useTrnHistorico(alunoId);
  const [fAutor, setFAutor] = useState("");
  const [fAcao, setFAcao] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const autores = useMemo(() => [...new Set(hist.map((h) => h.autor_nome ?? "Sistema"))].sort(), [hist]);
  const acoes = useMemo(() => [...new Set(hist.map((h) => h.acao))].sort(), [hist]);
  const lista = hist.filter((h) =>
    (!fAutor || (h.autor_nome ?? "Sistema") === fAutor) && (!fAcao || h.acao === fAcao) &&
    (!de || h.created_at.slice(0, 10) >= de) && (!ate || h.created_at.slice(0, 10) <= ate));
  if (isLoading) return <TrnCarregando />;
  return (
    <div className="space-y-3">
      <div className="trn-card flex flex-wrap items-end gap-3">
        <div><Label className="text-xs">Usuário</Label>
          <Select value={fAutor || "__"} onValueChange={(v) => setFAutor(v === "__" ? "" : v)}><SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__">Todos</SelectItem>{autores.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Evento</Label>
          <Select value={fAcao || "__"} onValueChange={(v) => setFAcao(v === "__" ? "" : v)}><SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="__">Todos</SelectItem>{acoes.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent></Select></div>
        <div><Label className="text-xs">Data inicial</Label><Input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div><Label className="text-xs">Data final</Label><Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        <Button variant="ghost" size="sm" onClick={() => { setFAutor(""); setFAcao(""); setDe(""); setAte(""); }}>Limpar filtros</Button>
        <span className="ml-auto text-xs text-muted-foreground">Total de registros: {lista.length}</span>
      </div>
      <div className="trn-card p-0">
        <table className="trn-tab">
          <thead><tr><th>Data/hora</th><th>Ação</th><th>Realizado por</th><th>Origem</th><th>Detalhes</th></tr></thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={5} className="trn-vazio">Nenhum registro.</td></tr>}
            {lista.map((h) => (
              <tr key={h.id}><td className="whitespace-nowrap">{fmtDataHora(h.created_at)}</td><td className="font-semibold">{h.acao}</td><td>{h.autor_nome ?? "Sistema"}</td><td>{h.origem === "gestao" ? "Área de gestão" : h.origem === "plataforma" ? "Plataforma do aluno" : "Sistema"}</td><td className="text-slate-600">{h.detalhes ?? "-"}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Certificados ─────────────────────────────────────────────────────
function CertificadosAluno({ alunoId, acessoCompleto }: { alunoId: string; acessoCompleto: boolean }) {
  const { data: prog = [] } = useTrnProgressoAluno(alunoId);
  const { data: certs = [], isLoading } = useTrnCertificadosAluno(alunoId);
  const { data: cursos = [] } = useTrnCursos();
  const emitir = useTrnEmitirCertificado();
  const porCurso = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; ok: number }>();
    prog.forEach((l) => { const c = m.get(l.curso_id) ?? { nome: l.curso, total: 0, ok: 0 }; c.total++; if (l.concluida) c.ok++; m.set(l.curso_id, c); });
    return [...m.entries()];
  }, [prog]);
  if (isLoading) return <TrnCarregando />;
  return (
    <div className="trn-card p-0">
      <table className="trn-tab">
        <thead><tr><th>Curso</th><th>Status do curso</th><th>Certificado</th><th>Data de emissão</th><th>Código</th><th /></tr></thead>
        <tbody>
          {porCurso.length === 0 && <tr><td colSpan={6} className="trn-vazio">{acessoCompleto ? "Nenhum curso publicado com aulas ainda." : "Este aluno não está em nenhum curso."}</td></tr>}
          {porCurso.map(([cid, c]) => {
            const cert = certs.find((x) => x.curso_id === cid);
            const concluido = c.total > 0 && c.ok === c.total;
            const curso = cursos.find((x) => x.id === cid);
            return (
              <tr key={cid}>
                <td className="font-semibold">{c.nome}</td>
                <td>{concluido ? <span className="trn-badge ok">Concluído</span> : c.ok > 0 ? <span className="trn-badge warn">Em andamento ({c.ok}/{c.total})</span> : <span className="trn-badge off">Não iniciado</span>}</td>
                <td>{cert ? <span className="trn-badge ok">Emitido</span> : <span className="trn-badge off">Não emitido</span>}</td>
                <td>{cert ? fmtDataHora(cert.emitido_em) : "-"}</td>
                <td className="font-mono text-xs">{cert?.codigo_validacao ?? "-"}</td>
                <td>
                  {cert ? (
                    <Button asChild size="sm" variant="outline"><Link to={`/app/treinamentos/alunos/certificado/${cert.id}`} target="_blank">Visualizar</Link></Button>
                  ) : (
                    <AcessoGate menu={MENU.alunos} acao="alterar">
                      <Button size="sm" variant="outline" disabled={emitir.isPending} title={concluido ? "" : "O aluno ainda não concluiu todas as aulas — emissão manual."}
                              onClick={async () => { try { await emitir.mutateAsync({ alunoId, cursoId: cid }); toast.success("Certificado emitido."); } catch (e: any) { toast.error(e?.message ?? "Não deu."); } }}>
                        Emitir{!concluido && " (manual)"}
                      </Button>
                    </AcessoGate>
                  )}
                  {curso && <span className="ml-2 text-[10px] text-slate-400">{curso.aulas} aula(s)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
