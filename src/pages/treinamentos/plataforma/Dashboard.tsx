import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity, Award, BookOpen, CheckCircle2, ClipboardCheck, LogIn, MessageSquare, Star, UserMinus,
  UserPlus, UserX, Users, Bell,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useTrnCursos, useTrnDashboard } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type Dashboard } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero, TrnKpi } from "./ui";

// =====================================================================
// TREINAMENTOS — Dashboard.
//
// Reescrito em 24/09/2026 (pedido do Pablo: "número de alunos tem que ser
// real, e o de ativos também"). Antes o card somava os 13,3 mil alunos —
// 10,8 mil demitidos — e "ativo" era quem estava Trabalhando na Senior, então
// todo mundo aparecia ativo sem ter entrado. Agora (mig 20260930000237):
//   · base = quem NÃO é demitido; demitido aparece à parte, como histórico;
//   · ativo = já acessou a área de treinamentos; inativo = ainda não entrou;
//   · por curso: alcance, quem começou, quem terminou, nota e comentários;
//   · por contrato: quanto do pessoal já entrou — é onde o RH cobra.
// Tudo vem de UMA RPC (`trn_dashboard`) para a tela não fazer dez idas ao
// banco a cada troca de filtro.
// =====================================================================

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// Paleta do módulo: laranja é "fez" (acessou, concluiu), azul é contexto.
const COR = {
  ativo: "#f26522", inativo: "#cbd5e1", bloqueado: "#ef4444",
  azul: "#1d4ed8", azulClaro: "#93c5fd", estrela: "#f59e0b",
};

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);
const num = (n: number | null | undefined) => (n ?? 0).toLocaleString("pt-BR");

/**
 * Enquanto a mig 237 não roda no banco, a RPC antiga devolve outro formato —
 * sem isto, os `.map` quebram a tela inteira em vez de mostrar zeros.
 */
function normaliza(d: Partial<Dashboard>): Dashboard {
  return {
    alunos: 0, alunos_ativos: 0, alunos_inativos: 0, alunos_bloqueados: 0, alunos_afastados: 0,
    alunos_demitidos: 0, acessaram_7d: 0, acessaram_30d: 0, primeiros_acessos_periodo: 0,
    aulas_concluidas: 0, avaliacao_media: null, avaliacoes: 0, comentarios: 0, comentarios_pendentes: 0,
    cursos_publicados: 0, cursos_total: 0, certificados: 0, provas_enviadas: 0, provas_aprovadas: 0,
    interacao_real: 0, concluidos: 0, ano: new Date().getFullYear(),
    ...d,
    avaliacoes_por_nota: d.avaliacoes_por_nota ?? [0, 0, 0, 0, 0],
    primeiros_acessos_por_mes: d.primeiros_acessos_por_mes ?? Array(12).fill(0),
    conclusoes_por_mes: d.conclusoes_por_mes ?? Array(12).fill(0),
    primeiros_acessos_30d: d.primeiros_acessos_30d ?? [],
    por_curso: d.por_curso ?? [],
    por_contrato: d.por_contrato ?? [],
    top_aulas: d.top_aulas ?? [],
  };
}

export default function TreinamentosDashboard() {
  const [curso, setCurso] = useState<string>("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const { data: cursos = [] } = useTrnCursos();
  const { data: bruto, isLoading } = useTrnDashboard(curso || null, de || null, ate || null);
  const d = useMemo(() => (bruto ? normaliza(bruto) : null), [bruto]);
  const temPeriodo = !!(de || ate);

  const evolucao = useMemo(
    () => (d ? MESES.map((mes, i) => ({ mes, acessos: d.primeiros_acessos_por_mes[i] ?? 0, conclusoes: d.conclusoes_por_mes[i] ?? 0 })) : []),
    [d],
  );
  const ultimos30 = useMemo(
    () => (d?.primeiros_acessos_30d ?? []).map((x) => ({ dia: x.dia.slice(8, 10) + "/" + x.dia.slice(5, 7), n: x.n })),
    [d],
  );
  const pizza = useMemo(() => (d ? [
    { nome: "Já acessaram", v: d.alunos_ativos, cor: COR.ativo },
    { nome: "Nunca acessaram", v: d.alunos_inativos, cor: COR.inativo },
    { nome: "Bloqueados", v: d.alunos_bloqueados, cor: COR.bloqueado },
  ].filter((x) => x.v > 0) : []), [d]);
  const estrelas = useMemo(
    () => (d ? [5, 4, 3, 2, 1].map((n) => ({ nota: `${n} ★`, q: d.avaliacoes_por_nota[n - 1] ?? 0 })) : []),
    [d],
  );
  const contratos = useMemo(
    () => (d?.por_contrato ?? []).map((c) => ({
      ...c, inativos: c.alunos - c.ativos,
      // O % vai no rótulo do eixo: é o número que o RH procura primeiro.
      rotulo: `${c.nome.length > 28 ? c.nome.slice(0, 27) + "…" : c.nome} · ${pct(c.ativos, c.alunos)}%`,
    })),
    [d],
  );

  const taxaAcesso = d ? pct(d.alunos_ativos, d.alunos) : 0;
  const taxaProva = d ? pct(d.provas_aprovadas, d.provas_enviadas) : 0;

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.dashboard} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para o Dashboard de Treinamentos.</Card>}>
        <TrnHero
          titulo="Dashboard de Treinamentos"
          texto="Quem já entrou na plataforma, quem ainda não entrou, e como cada curso está andando. Ativo é quem já acessou os treinamentos; demitidos ficam fora da conta."
          pilulas={d ? [
            `${num(d.alunos)} aluno(s)`,
            `${num(d.alunos_ativos)} já acessaram (${taxaAcesso}%)`,
            `${d.cursos_publicados} curso(s) publicado(s)`,
          ] : undefined}
          acoes={<>
            <Link to="/app/treinamentos/alunos/novo"><UserPlus className="h-4 w-4" /> Gerenciar alunos</Link>
            <Link to="/app/treinamentos/comunicacao/notificacoes" className="sec"><Bell className="h-4 w-4" /> Notificar</Link>
          </>}
        />

        {/* Filtros: período + curso */}
        <div className="trn-card mb-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[170px]">
            <label className="mb-1 block text-xs font-semibold text-slate-600">De</label>
            <Input type="date" value={de} onChange={(e) => setDe(e.target.value)} />
          </div>
          <div className="min-w-[170px]">
            <label className="mb-1 block text-xs font-semibold text-slate-600">Até</label>
            <Input type="date" value={ate} onChange={(e) => setAte(e.target.value)} />
          </div>
          <div className="min-w-[240px] flex-1">
            <label className="mb-1 block text-xs font-semibold text-slate-600">Curso</label>
            <Select value={curso || "__todos"} onValueChange={(v) => setCurso(v === "__todos" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos os cursos</SelectItem>
                {cursos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(de || ate || curso) && (
            <button className="text-xs font-semibold text-primary" onClick={() => { setDe(""); setAte(""); setCurso(""); }}>Limpar filtros</button>
          )}
        </div>

        {isLoading || !d ? <TrnCarregando /> : (
          <>
            {/* ── Alunos ─────────────────────────────────────────────── */}
            <div className="trn-kpis">
              <TrnKpi
                rotulo={curso ? "Alunos do curso" : "Número de alunos"}
                valor={num(d.alunos)}
                sub={`colaboradores que podem acessar · ${num(d.alunos_afastados)} afastado(s)`}
                icone={<Users className="h-5 w-5" />}
              />
              <TrnKpi
                rotulo="Já acessaram (ativos)"
                valor={num(d.alunos_ativos)}
                sub={<><b className="text-orange-600">{taxaAcesso}%</b> da base{temPeriodo ? ` · ${num(d.primeiros_acessos_periodo)} no período` : ""}</>}
                icone={<LogIn className="h-5 w-5" />}
              />
              <TrnKpi
                rotulo="Nunca acessaram (inativos)"
                valor={num(d.alunos_inativos)}
                sub={d.alunos_bloqueados > 0 ? `${num(d.alunos_bloqueados)} bloqueado(s) à parte` : "ainda não entraram"}
                icone={<UserX className="h-5 w-5" />}
              />
              <TrnKpi
                rotulo="Acessaram recentemente"
                valor={num(d.acessaram_7d)}
                sub={`últimos 7 dias · ${num(d.acessaram_30d)} em 30 dias`}
                icone={<Activity className="h-5 w-5" />}
              />
              <TrnKpi
                rotulo="Demitidos"
                valor={num(d.alunos_demitidos)}
                sub="histórico — fora da conta"
                icone={<UserMinus className="h-5 w-5" />}
              />
            </div>

            {/* ── Atividade ──────────────────────────────────────────── */}
            <div className="trn-kpis">
              <TrnKpi rotulo="Aulas concluídas" valor={num(d.aulas_concluidas)} sub={`${num(d.concluidos)} aluno(s) concluíram${temPeriodo ? " no período" : ""}`} icone={<CheckCircle2 className="h-5 w-5" />} />
              <TrnKpi rotulo="Avaliação das aulas" valor={d.avaliacao_media != null ? Number(d.avaliacao_media).toFixed(1) : "—"} sub={`${num(d.avaliacoes)} avaliação(ões)`} icone={<Star className="h-5 w-5" />} />
              <TrnKpi rotulo="Provas" valor={d.provas_enviadas > 0 ? `${taxaProva}%` : "—"} sub={`${num(d.provas_aprovadas)} aprovada(s) de ${num(d.provas_enviadas)} enviada(s)`} icone={<ClipboardCheck className="h-5 w-5" />} />
              <TrnKpi rotulo="Comentários nas aulas" valor={num(d.comentarios)} sub={d.comentarios_pendentes > 0 ? <Link to="/app/treinamentos/cursos/comentarios" className="font-semibold text-amber-700">{d.comentarios_pendentes} aguardando moderação</Link> : "nenhum pendente"} icone={<MessageSquare className="h-5 w-5" />} />
              <TrnKpi rotulo="Certificados emitidos" valor={num(d.certificados)} sub={`${d.cursos_publicados} de ${d.cursos_total} curso(s) publicado(s)`} icone={<Award className="h-5 w-5" />} />
            </div>

            {/* ── Situação + evolução ───────────────────────────────── */}
            <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
              <div className="trn-card">
                <h3>Situação dos alunos</h3>
                <div className="sub">Quem já entrou na plataforma, entre os {num(d.alunos)} que podem acessar.</div>
                {d.alunos === 0 ? <div className="trn-vazio">Sem alunos neste recorte.</div> : (
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="relative" style={{ width: 190, height: 190 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={pizza} dataKey="v" nameKey="nome" innerRadius={60} outerRadius={88} paddingAngle={pizza.length > 1 ? 2 : 0} stroke="none">
                            {pizza.map((p) => <Cell key={p.nome} fill={p.cor} />)}
                          </Pie>
                          <Tooltip formatter={(v: number, n: string) => [num(v), n]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                        <div>
                          <div className="text-2xl font-black text-slate-900">{taxaAcesso}%</div>
                          <div className="text-[11px] font-semibold text-slate-500">já acessaram</div>
                        </div>
                      </div>
                    </div>
                    <div className="flex-1 space-y-2 text-sm">
                      {[
                        { nome: "Já acessaram", v: d.alunos_ativos, cor: COR.ativo },
                        { nome: "Nunca acessaram", v: d.alunos_inativos, cor: COR.inativo },
                        { nome: "Bloqueados", v: d.alunos_bloqueados, cor: COR.bloqueado },
                      ].map((x) => (
                        <div key={x.nome} className="flex items-center gap-2">
                          <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: x.cor }} />
                          <span className="flex-1 text-slate-600">{x.nome}</span>
                          <b>{num(x.v)}</b>
                          <span className="w-10 text-right text-xs text-slate-400">{pct(x.v, d.alunos)}%</span>
                        </div>
                      ))}
                      <div className="border-t pt-2 text-xs text-slate-400">
                        + {num(d.alunos_demitidos)} demitido(s) no histórico, fora da conta.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="trn-card">
                <h3>Evolução em {d.ano}</h3>
                <div className="sub">Primeiros acessos (alunos que entraram pela primeira vez) e aulas concluídas, mês a mês.</div>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={evolucao} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="acessos" name="Primeiros acessos" fill={COR.ativo} radius={[6, 6, 0, 0]} />
                      <Line dataKey="conclusoes" name="Aulas concluídas" stroke={COR.azul} strokeWidth={2} dot={{ r: 3 }} type="monotone" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* ── Últimos 30 dias + notas ───────────────────────────── */}
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
              <div className="trn-card">
                <h3>Primeiros acessos — últimos 30 dias</h3>
                <div className="sub">Quantos alunos entraram na plataforma pela primeira vez, por dia.</div>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <AreaChart data={ultimos30} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="trnAcessos" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={COR.ativo} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={COR.ativo} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="dia" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} interval={4} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip formatter={(v: number) => [num(v), "Primeiros acessos"]} />
                      <Area dataKey="n" stroke={COR.ativo} strokeWidth={2} fill="url(#trnAcessos)" type="monotone" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="trn-card">
                <h3>Notas das aulas</h3>
                <div className="sub">
                  {d.avaliacoes > 0
                    ? `${num(d.avaliacoes)} avaliação(ões) · média ${Number(d.avaliacao_media ?? 0).toFixed(1)}`
                    : "Nenhuma avaliação no recorte."}
                </div>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer>
                    <BarChart data={estrelas} layout="vertical" margin={{ top: 0, right: 30, left: 0, bottom: 0 }}>
                      <XAxis type="number" hide allowDecimals={false} />
                      <YAxis type="category" dataKey="nota" width={40} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => [num(v), "Avaliações"]} />
                      <Bar dataKey="q" fill={COR.estrela} radius={[0, 6, 6, 0]} label={{ position: "right", fontSize: 11 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* ── Por curso ─────────────────────────────────────────── */}
            <div className="trn-card mt-4">
              <h3>Desempenho por curso</h3>
              <div className="sub">
                Alcance = quem pode ver o curso (sem demitidos). Começaram, avaliações e comentários
                {temPeriodo ? " contam só o período filtrado" : " contam desde o início"}; concluíram = fechou todas as aulas publicadas.
              </div>
              {d.por_curso.length === 0 ? <div className="trn-vazio">Nenhum curso cadastrado.</div> : (
                <div className="overflow-x-auto">
                  <table className="trn-tab">
                    <thead>
                      <tr>
                        <th>Curso</th>
                        <th className="text-right">Alcance</th>
                        <th>Começaram</th>
                        <th>Concluíram</th>
                        <th>Avaliação</th>
                        <th className="text-right">Comentários</th>
                        <th className="text-right">Certificados</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.por_curso.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <Link to={`/app/treinamentos/cursos/${c.id}`} className="font-bold text-slate-800 hover:underline">{c.nome}</Link>
                            <div className="text-[11px] text-slate-400">
                              {c.aulas} aula(s){c.publicado ? "" : " · rascunho"}
                            </div>
                          </td>
                          <td className="text-right font-semibold">{num(c.alcance)}</td>
                          <td><Progresso valor={c.iniciaram} total={c.alcance} cor={COR.azul} /></td>
                          <td><Progresso valor={c.concluiram} total={c.alcance} cor={COR.ativo} /></td>
                          <td>
                            {c.avaliacoes > 0 ? (
                              <span className="whitespace-nowrap">
                                <b className="text-amber-600">★ {Number(c.avaliacao_media ?? 0).toFixed(1)}</b>
                                <span className="text-xs text-slate-400"> · {num(c.avaliacoes)}</span>
                              </span>
                            ) : <span className="text-xs text-slate-400">sem notas</span>}
                          </td>
                          <td className="text-right">{num(c.comentarios)}</td>
                          <td className="text-right">{num(c.certificados)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* ── Contratos + aulas ─────────────────────────────────── */}
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="trn-card">
                <h3>Acesso por contrato</h3>
                <div className="sub">Os {contratos.length} contratos com mais alunos: quantos já entraram na plataforma.</div>
                {contratos.length === 0 ? <div className="trn-vazio">Sem contratos neste recorte.</div> : (
                  <div style={{ height: 40 + contratos.length * 32 }}>
                    <ResponsiveContainer>
                      <BarChart data={contratos} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                        <XAxis type="number" hide allowDecimals={false} />
                        <YAxis type="category" dataKey="rotulo" width={240} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip formatter={(v: number, n: string) => [num(v), n]} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="ativos" name="Já acessaram" stackId="c" fill={COR.ativo} />
                        <Bar dataKey="inativos" name="Ainda não" stackId="c" fill={COR.inativo} radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              <div className="trn-card">
                <h3>Aulas mais concluídas</h3>
                <div className="sub">{temPeriodo ? "No período filtrado." : "Desde o início."}</div>
                {d.top_aulas.length === 0 ? <div className="trn-vazio">Nenhuma aula concluída ainda.</div> : (
                  <ol className="space-y-2">
                    {d.top_aulas.map((a, i) => (
                      <li key={`${a.curso}-${a.nome}`} className="flex items-center gap-3">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-orange-50 text-xs font-black text-orange-600">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-slate-800">{a.nome}</div>
                          <div className="truncate text-[11px] text-slate-400"><BookOpen className="mr-1 inline h-3 w-3" />{a.curso}</div>
                        </div>
                        <b className="text-sm">{num(a.n)}</b>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          </>
        )}
      </AcessoGate>
    </div>
  );
}

/** Barra fina com número e % — cabe numa célula de tabela. */
function Progresso({ valor, total, cor }: { valor: number; total: number; cor: string }) {
  const p = pct(valor, total);
  return (
    <div className="min-w-[120px]">
      <div className="flex items-baseline justify-between text-xs">
        <b>{num(valor)}</b><span className="text-slate-400">{p}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, background: cor }} />
      </div>
    </div>
  );
}
