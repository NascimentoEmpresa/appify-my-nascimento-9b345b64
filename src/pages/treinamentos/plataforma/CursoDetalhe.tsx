import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, MoreVertical, Pencil, Plus, Star, Trash2, Users } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  urlMidia, useTrnCurso, useTrnCursos, useTrnDuplicarCurso, useTrnDuplicarModulo, useTrnExcluirAula, useTrnExcluirCurso,
  useTrnExcluirModulo, useTrnReordenar, useTrnSalvarCurso, useTrnSalvarModulo,
} from "@/hooks/useTreinamentosPlataforma";
import { MENU, ROTULO_TIPO_CONTEUDO, type Modulo } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero } from "./ui";
import CursoPublico from "./CursoPublico";

// =====================================================================
// TREINAMENTOS — Cursos › Visualização do curso.
//
// A tela central do membox: capa, descrição, nº de alunos, avaliação, os
// três toggles (publicado / em breve / comentários) e a árvore de módulos
// com as aulas. Cada módulo: editar, excluir, duplicar (para este ou outro
// curso), mover. Cada aula: editar, excluir, mover. Botões "Adicionar
// aula +" por módulo e "Adicionar módulo +" no fim.
// =====================================================================

export default function CursoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading } = useTrnCurso(id);
  const { data: cursos = [] } = useTrnCursos();
  const salvarCurso = useTrnSalvarCurso();
  const excluirCurso = useTrnExcluirCurso();
  const duplicarCurso = useTrnDuplicarCurso();
  const salvarModulo = useTrnSalvarModulo();
  const excluirModulo = useTrnExcluirModulo();
  const duplicarModulo = useTrnDuplicarModulo();
  const excluirAula = useTrnExcluirAula();
  const reordenar = useTrnReordenar();

  const [modAberto, setModAberto] = useState(false);
  const [modEditando, setModEditando] = useState<Modulo | null>(null);
  const [modNome, setModNome] = useState("");
  const [modLiberar, setModLiberar] = useState("");
  const [dupModulo, setDupModulo] = useState<Modulo | null>(null);
  const [dupDestino, setDupDestino] = useState("");

  const resumo = cursos.find((c) => c.id === id);
  const curso = data?.curso;
  const modulos = data?.modulos ?? [];

  const toggle = async (campo: "publicado" | "em_breve" | "comentarios_habilitados", v: boolean) => {
    if (!curso) return;
    try { await salvarCurso.mutateAsync({ id: curso.id, nome: curso.nome, [campo]: v }); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };

  const abrirModulo = (m?: Modulo) => { setModEditando(m ?? null); setModNome(m?.nome ?? ""); setModLiberar(m?.liberar_dias == null ? "" : String(m.liberar_dias)); setModAberto(true); };
  const gravarModulo = async () => {
    if (!modNome.trim()) return toast.error("Informe o nome do módulo.");
    try {
      await salvarModulo.mutateAsync({
        id: modEditando?.id, curso_id: id!, nome: modNome.trim(),
        posicao: modEditando?.posicao ?? modulos.length + 1,
        liberar_dias: modLiberar.trim() ? Number(modLiberar) : null,
      });
      toast.success(modEditando ? "Módulo atualizado." : "Módulo criado."); setModAberto(false);
    } catch (e: any) { toast.error(e?.message ?? "Não deu para salvar."); }
  };
  const apagarModulo = async (m: Modulo & { aulas: unknown[] }) => {
    if (!window.confirm(`Excluir o módulo "${m.nome}" e suas ${m.aulas.length} aula(s)?`)) return;
    try { await excluirModulo.mutateAsync(m.id); toast.success("Módulo excluído."); } catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };
  const moverModulo = (i: number, dir: -1 | 1) => {
    const ids = modulos.map((m) => m.id);
    const j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reordenar.mutate({ tabela: "TRN_MODULO", ids });
  };
  const moverAula = (m: Modulo & { aulas: { id: string }[] }, i: number, dir: -1 | 1) => {
    const ids = m.aulas.map((a) => a.id);
    const j = i + dir; if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    reordenar.mutate({ tabela: "TRN_AULA", ids });
  };
  const confirmarDup = async () => {
    if (!dupModulo || !dupDestino) return;
    try { await duplicarModulo.mutateAsync({ moduloId: dupModulo.id, cursoDestino: dupDestino }); toast.success("Módulo duplicado no fim do curso de destino."); setDupModulo(null); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };
  const apagarCurso = async () => {
    if (!curso || !window.confirm(`Excluir o curso "${curso.nome}"? Módulos, aulas, matrículas e progresso vão junto.`)) return;
    try { await excluirCurso.mutateAsync(curso.id); toast.success("Curso excluído."); navigate("/app/treinamentos/cursos"); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };
  const duplicar = async () => {
    if (!curso) return;
    try { const novo = await duplicarCurso.mutateAsync(curso.id); toast.success("Curso duplicado (como rascunho)."); navigate(`/app/treinamentos/cursos/${novo}`); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };

  const capa = urlMidia(curso?.capa_path);

  return (
    <div className="trn mx-auto max-w-6xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.cursos} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para ver os cursos.</Card>}>
        <TrnHero eyebrow="Treinamentos › Cursos" titulo="Visualização do curso" texto={curso?.nome}
                 acoes={<>
                   <Link to="/app/treinamentos/cursos" className="sec">← Todos os cursos</Link>
                   <AcessoGate menu={MENU.cursos} acao="excluir"><button className="sec" onClick={apagarCurso}><Trash2 className="h-4 w-4" /> Excluir</button></AcessoGate>
                   <AcessoGate menu={MENU.cursos} acao="incluir"><button className="sec" onClick={duplicar}><Copy className="h-4 w-4" /> Duplicar</button></AcessoGate>
                   <AcessoGate menu={MENU.cursos} acao="alterar"><Link to={`/app/treinamentos/cursos/${id}/editar`}><Pencil className="h-4 w-4" /> Editar curso</Link></AcessoGate>
                 </>} />

        {isLoading || !curso ? <TrnCarregando /> : (
          <div className="trn-card">
            <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#0f3171] to-[#2563eb]" style={{ aspectRatio: "16/6" }}>
              {capa ? <img src={capa} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-2xl font-black text-white">{curso.nome}</div>}
            </div>
            <h2 className="mt-4 text-xl font-black text-slate-900">{curso.nome}</h2>
            <p className="mt-1 text-sm text-slate-600">{curso.descricao}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
              <Link to={`/app/treinamentos/alunos?curso=${curso.id}`} className="flex items-center gap-1 font-semibold text-primary"><Users className="h-4 w-4" /> {resumo?.alunos ?? 0} alunos</Link>
              <span className="flex items-center gap-1"><Star className="h-4 w-4 text-amber-500" /> {resumo?.avaliacao != null ? `${Number(resumo.avaliacao).toFixed(1)} (${resumo.avaliacoes})` : "sem avaliações"}</span>
              {curso.modulos_como_cursos && <span className="trn-badge info">Módulos exibidos na vitrine</span>}
              {curso.carga_horaria_min != null && <span className="trn-badge off">{Math.round(curso.carga_horaria_min / 60 * 10) / 10}h de carga horária</span>}
            </div>
            <AcessoGate menu={MENU.cursos} acao="alterar" fallback={
              <div className="mt-3 flex flex-wrap gap-2">
                <span className={`trn-badge ${curso.publicado ? "ok" : "off"}`}>{curso.publicado ? "Curso publicado" : "Rascunho"}</span>
                {curso.em_breve && <span className="trn-badge warn">Em breve</span>}
                <span className={`trn-badge ${curso.comentarios_habilitados ? "ok" : "off"}`}>Comentários {curso.comentarios_habilitados ? "habilitados" : "desabilitados"}</span>
              </div>
            }>
              <div className="mt-3 flex flex-wrap gap-5 text-sm">
                <label className="flex items-center gap-2"><Switch checked={curso.publicado} onCheckedChange={(v) => toggle("publicado", v)} /> Curso publicado</label>
                <label className="flex items-center gap-2"><Switch checked={curso.em_breve} onCheckedChange={(v) => toggle("em_breve", v)} /> Em breve</label>
                <label className="flex items-center gap-2"><Switch checked={curso.comentarios_habilitados} onCheckedChange={(v) => toggle("comentarios_habilitados", v)} /> Comentários habilitados</label>
              </div>
            </AcessoGate>

            {/* Publicar não libera para todos (24/09/2026): quem vê é definido aqui. */}
            <CursoPublico cursoId={curso.id} publicado={curso.publicado} />

            <div className="mt-6 space-y-4">
              {modulos.length === 0 && <div className="trn-vazio">Este curso ainda não tem módulos. Adicione o primeiro.</div>}
              {modulos.map((m, i) => (
                <div key={m.id} className="rounded-2xl border bg-slate-50/60 p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-sm font-black text-slate-700 shadow-sm">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Módulo{m.liberar_dias != null ? ` · libera em ${m.liberar_dias} dia(s)` : ""}</div>
                      <div className="truncate font-bold text-slate-900">{m.nome}</div>
                    </div>
                    <AcessoGate menu={MENU.cursos} acao="alterar">
                      <Button variant="outline" size="sm" onClick={() => moverModulo(i, -1)} disabled={i === 0} title="Subir"><ArrowUp className="h-4 w-4" /></Button>
                      <Button variant="outline" size="sm" onClick={() => moverModulo(i, 1)} disabled={i === modulos.length - 1} title="Descer"><ArrowDown className="h-4 w-4" /></Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => abrirModulo(m)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => { setDupModulo(m); setDupDestino(curso.id); }}>Duplicar</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-rose-600" onSelect={() => apagarModulo(m)}>Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </AcessoGate>
                  </div>

                  <div className="mt-3 space-y-2">
                    {m.aulas.map((a, j) => (
                      <div key={a.id} className="flex items-center gap-3 rounded-xl border bg-white px-3 py-2">
                        <span className="text-xs font-bold text-slate-400">{j + 1}</span>
                        <Link to={`/app/treinamentos/cursos/${id}/aulas/${a.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900 hover:underline">{a.nome}</Link>
                        <span className="hidden text-[11px] text-slate-400 sm:inline">{ROTULO_TIPO_CONTEUDO[a.tipo_conteudo]}{a.carga_horaria_min ? ` · ${a.carga_horaria_min} min` : ""}</span>
                        {a.gratuita && <span className="trn-badge ok">Aula gratuita</span>}
                        {a.quiz && a.quiz.length > 0 && <span className="trn-badge info">Quiz</span>}
                        <span className={`trn-badge ${a.publicada ? "ok" : "off"}`}>{a.publicada ? "Publicada" : "Rascunho"}</span>
                        <AcessoGate menu={MENU.cursos} acao="alterar">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moverAula(m, j, -1)} disabled={j === 0}><ArrowUp className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moverAula(m, j, 1)} disabled={j === m.aulas.length - 1}><ArrowDown className="h-3.5 w-3.5" /></Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => navigate(`/app/treinamentos/cursos/${id}/aulas/${a.id}`)}>Editar</DropdownMenuItem>
                              <DropdownMenuItem className="text-rose-600" onSelect={async () => { if (window.confirm(`Excluir a aula "${a.nome}"?`)) { try { await excluirAula.mutateAsync(a.id); toast.success("Aula excluída."); } catch (e: any) { toast.error(e?.message ?? "Não deu."); } } }}>Excluir</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </AcessoGate>
                      </div>
                    ))}
                    <AcessoGate menu={MENU.cursos} acao="alterar">
                      <div className="flex justify-center pt-1">
                        <Button asChild variant="outline" size="sm" className="border-orange-300 text-orange-700"><Link to={`/app/treinamentos/cursos/${id}/aulas/nova?modulo=${m.id}`}><Plus className="mr-1 h-4 w-4" /> Adicionar aula</Link></Button>
                      </div>
                    </AcessoGate>
                  </div>
                </div>
              ))}
              <AcessoGate menu={MENU.cursos} acao="alterar">
                <div className="flex justify-center"><Button onClick={() => abrirModulo()}><Plus className="mr-1 h-4 w-4" /> Adicionar módulo</Button></div>
              </AcessoGate>
            </div>
          </div>
        )}

        <Dialog open={modAberto} onOpenChange={setModAberto}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>{modEditando ? "Editar módulo" : "Adicionar módulo"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">Nome do módulo *</Label><Input value={modNome} onChange={(e) => setModNome(e.target.value)} onKeyDown={(e) => e.key === "Enter" && gravarModulo()} /></div>
              <div><Label className="text-xs">Liberação programada (dias após a matrícula, opcional)</Label><Input inputMode="numeric" value={modLiberar} onChange={(e) => setModLiberar(e.target.value)} placeholder="imediato" />
                <p className="mt-1 text-[11px] text-muted-foreground">A liberação a nível de módulo substitui a configuração de cada aula.</p></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setModAberto(false)}>Cancelar</Button><Button disabled={salvarModulo.isPending} onClick={gravarModulo}>Salvar</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!dupModulo} onOpenChange={(o) => !o && setDupModulo(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Duplicar módulo</DialogTitle></DialogHeader>
            <div className="rounded-lg bg-orange-50 px-3 py-2 text-sm font-semibold">{dupModulo?.nome}</div>
            <p className="text-xs text-muted-foreground">O módulo duplicado será adicionado na última posição do curso de destino.</p>
            <Label className="text-xs">Selecione o curso de destino</Label>
            <Select value={dupDestino} onValueChange={setDupDestino}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{cursos.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
            </Select>
            <DialogFooter><Button variant="outline" onClick={() => setDupModulo(null)}>Cancelar</Button><Button disabled={duplicarModulo.isPending} onClick={confirmarDup}>Duplicar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </AcessoGate>
    </div>
  );
}
