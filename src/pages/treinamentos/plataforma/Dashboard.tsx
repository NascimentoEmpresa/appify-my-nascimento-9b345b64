import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Award, BookOpen, CheckCircle2, MessageSquare, Star, Users, UserPlus, Upload, Bell,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useTrnCursos, useTrnDashboard } from "@/hooks/useTreinamentosPlataforma";
import { MENU } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero, TrnKpi } from "./ui";

// =====================================================================
// TREINAMENTOS — Dashboard (a "Home" do membox).
//
// Os mesmos quatro números do topo de lá — alunos, aulas concluídas,
// avaliação das aulas, comentários — filtráveis por curso e período; a
// evolução de novos alunos por mês; e o bloco "progresso entre alunos
// ativos", que compara quem concluiu aula com quem teve interação real.
// Tudo vem de UMA RPC (`trn_dashboard`) para a tela não fazer oito idas ao
// banco a cada troca de filtro.
// =====================================================================

const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function TreinamentosDashboard() {
  const [curso, setCurso] = useState<string>("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const { data: cursos = [] } = useTrnCursos();
  const { data: d, isLoading } = useTrnDashboard(curso || null, de || null, ate || null);

  const serie = useMemo(() => (d?.novos_por_mes ?? []).map((n, i) => ({ mes: MESES[i], n })), [d]);
  const engaj = d && d.interacao_real > 0 ? Math.round((d.concluidos / d.interacao_real) * 100) : 0;
  const semConcluir = d ? Math.max(0, d.interacao_real - d.concluidos) : 0;
  const blocos = 10;
  const blocosOk = d && d.interacao_real > 0 ? Math.round((d.concluidos / d.interacao_real) * blocos) : 0;

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.dashboard} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para o Dashboard de Treinamentos.</Card>}>
        <TrnHero
          titulo="Dashboard de Treinamentos"
          texto="Alunos, cursos, conclusões e engajamento da plataforma de treinamentos do Grupo — o que o membox mostrava na Home, agora dentro do ERP."
          pilulas={d ? [`${d.cursos_publicados} curso(s) publicado(s)`, `${d.alunos_ativos} aluno(s) ativo(s)`, `${d.certificados} certificado(s)`] : undefined}
          acoes={<>
            <Link to="/app/treinamentos/alunos/novo"><UserPlus className="h-4 w-4" /> Gerenciar alunos</Link>
            <Link to="/app/treinamentos/alunos/importar" className="sec"><Upload className="h-4 w-4" /> Importar</Link>
            <Link to="/app/treinamentos/comunicacao/notificacoes" className="sec"><Bell className="h-4 w-4" /> Notificar</Link>
          </>}
        />

        {/* Filtros: período + curso, como no membox */}
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
            <div className="trn-kpis">
              <TrnKpi rotulo="Número de alunos" valor={d.alunos} sub={`${d.alunos_ativos} ativos · ${d.alunos_pendentes} pendentes · ${d.alunos_bloqueados} bloqueados`} icone={<Users className="h-5 w-5" />} />
              <TrnKpi rotulo="Aulas concluídas" valor={d.aulas_concluidas} sub="no período filtrado" icone={<CheckCircle2 className="h-5 w-5" />} />
              <TrnKpi rotulo="Avaliação das aulas" valor={d.avaliacao_media != null ? d.avaliacao_media.toFixed(1) : "—"} sub={`${d.avaliacoes} avaliação(ões)`} icone={<Star className="h-5 w-5" />} />
              <TrnKpi rotulo="Comentários nas aulas" valor={d.comentarios} sub={d.comentarios_pendentes > 0 ? <Link to="/app/treinamentos/cursos/comentarios" className="font-semibold text-amber-700">{d.comentarios_pendentes} aguardando moderação</Link> : "nenhum pendente"} icone={<MessageSquare className="h-5 w-5" />} />
              <TrnKpi rotulo="Cursos" valor={d.cursos_publicados} sub={`${d.cursos_total} no total`} icone={<BookOpen className="h-5 w-5" />} />
              <TrnKpi rotulo="Certificados emitidos" valor={d.certificados} icone={<Award className="h-5 w-5" />} />
            </div>

            <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
              <div className="trn-card">
                <h3>Evolução do número de alunos <span className="normal-case tracking-normal text-slate-400">em {d.ano}</span></h3>
                <div className="sub">Novos alunos por mês no ano corrente.</div>
                <div style={{ height: 240 }}>
                  <ResponsiveContainer>
                    <BarChart data={serie} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                      <XAxis dataKey="mes" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip formatter={(v: number) => [v, "Novos alunos"]} />
                      <Bar dataKey="n" radius={[6, 6, 0, 0]}>
                        {serie.map((s, i) => <Cell key={i} fill={s.n > 0 ? "#f26522" : "#e2e8f0"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="trn-card">
                <h3>Progresso entre alunos ativos em aulas</h3>
                <div className="sub">Compara quem concluiu aula com quem teve interação real no período filtrado.</div>
                <div className="mb-3 text-3xl font-black text-slate-900">{d.concluidos}</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Base de alunos</div>
                    <div className="mt-1 flex justify-between"><span>Interação real</span><b>{d.interacao_real}</b></div>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Taxa</div>
                    <div className="mt-1 flex justify-between"><span>Engajamento</span><b>{engaj}%</b></div>
                    <div className="flex justify-between"><span>Concluídos</span><b>{d.concluidos}</b></div>
                    <div className="flex justify-between"><span>Sem concluir</span><b>{semConcluir}</b></div>
                  </div>
                </div>
                <div className="mt-3 flex gap-1">
                  {Array.from({ length: blocos }).map((_, i) => (
                    <span key={i} className="h-3 flex-1 rounded" style={{ background: i < blocosOk ? "#f26522" : "#e2e8f0" }} />
                  ))}
                </div>
                <div className="mt-1 text-[11px] text-slate-400">
                  {d.interacao_real > 0 ? `Cada bloco representa cerca de ${Math.max(1, Math.round(d.interacao_real / blocos))} alunos.` : "Sem alunos no escopo filtrado para montar a proporção de engajamento."}
                </div>
              </div>
            </div>

            {d.top_cursos.length > 0 && (
              <div className="trn-card mt-4">
                <h3>Cursos com mais alunos matriculados</h3>
                <div className="sub">Matrículas por curso (sem contar quem tem acesso completo).</div>
                <div style={{ height: 40 + d.top_cursos.length * 30 }}>
                  <ResponsiveContainer>
                    <BarChart data={d.top_cursos} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" dataKey="nome" width={220} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v: number) => [v, "Alunos"]} />
                      <Bar dataKey="alunos" fill="#1d4ed8" radius={[0, 6, 6, 0]} label={{ position: "right", fontSize: 11 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </>
        )}
      </AcessoGate>
    </div>
  );
}
