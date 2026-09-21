import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { FileUp, ImagePlus, Link2, Plus, Save, Trash2, Video } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uploadMidia, urlMidia, useTrnAula, useTrnCurso, useTrnExcluirAula, useTrnSalvarAula } from "@/hooks/useTreinamentosPlataforma";
import { MENU, ROTULO_TIPO_CONTEUDO, type Material, type PerguntaQuiz, type TipoConteudo } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero } from "./ui";

// =====================================================================
// TREINAMENTOS — Cursos › Aula (adicionar / editar).
//
// O editor de aula do membox, campo a campo: nome, tipo de conteúdo
// (texto, player de vídeo, ao vivo, áudio, link externo, embed), o vídeo
// por link/embed OU arquivo, thumbnail, descrição, posição, status
// (publicada/rascunho), aula gratuita + "encerra em", data e dias de
// liberação, quiz depois da aula, carga horária, materiais complementares
// e CTA abaixo do vídeo.
//
// O quiz é o mesmo formato de "TREINAMENTOS".prova (Treinamentos ERP):
// [{id, enunciado, opcoes, correta}] — o portal do aluno (fase 2) já sabe
// corrigir esse formato.
// =====================================================================

interface Form {
  nome: string; tipo_conteudo: TipoConteudo; video_url: string; video_path: string | null; thumb_path: string | null;
  descricao: string; posicao: string; publicada: boolean; gratuita: boolean; gratuita_ate: string;
  liberar_em: string; liberar_dias: string; carga_horaria: string; materiais: Material[]; cta_texto: string; cta_url: string;
  quiz: PerguntaQuiz[]; nota_minima: string; temQuiz: boolean; temMateriais: boolean; temCta: boolean; modoVideo: "link" | "arquivo";
}
const VAZIO: Form = {
  nome: "", tipo_conteudo: "video", video_url: "", video_path: null, thumb_path: null, descricao: "", posicao: "1",
  publicada: true, gratuita: false, gratuita_ate: "", liberar_em: "", liberar_dias: "", carga_horaria: "", materiais: [],
  cta_texto: "", cta_url: "", quiz: [], nota_minima: "70", temQuiz: false, temMateriais: false, temCta: false, modoVideo: "link",
};
const novaPergunta = (): PerguntaQuiz => ({ id: crypto.randomUUID(), enunciado: "", opcoes: ["", ""], correta: 0 });

/** Extrai a src de um <iframe> colado, ou devolve a URL como veio. */
const normalizaVideo = (v: string) => {
  const m = /src=["']([^"']+)["']/i.exec(v);
  return (m ? m[1] : v).trim();
};

export default function AulaForm() {
  const { id: cursoId, aulaId } = useParams<{ id: string; aulaId: string }>();
  const [params] = useSearchParams();
  const editando = !!aulaId && aulaId !== "nova";
  const navigate = useNavigate();
  const { data: cursoData } = useTrnCurso(cursoId);
  const { data: aula, isLoading } = useTrnAula(editando ? aulaId : null);
  const salvar = useTrnSalvarAula();
  const excluir = useTrnExcluirAula();
  const [f, setF] = useState<Form>(VAZIO);
  const [moduloId, setModuloId] = useState(params.get("modulo") ?? "");
  const [subindo, setSubindo] = useState<string | null>(null);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  const modulos = cursoData?.modulos ?? [];
  const modulo = modulos.find((m) => m.id === moduloId);

  useEffect(() => {
    if (!aula) return;
    setModuloId(aula.modulo_id);
    setF({
      nome: aula.nome, tipo_conteudo: aula.tipo_conteudo, video_url: aula.video_url ?? "", video_path: aula.video_path, thumb_path: aula.thumb_path,
      descricao: aula.descricao ?? "", posicao: String(aula.posicao), publicada: aula.publicada, gratuita: aula.gratuita, gratuita_ate: aula.gratuita_ate ?? "",
      liberar_em: aula.liberar_em ?? "", liberar_dias: aula.liberar_dias == null ? "" : String(aula.liberar_dias),
      carga_horaria: aula.carga_horaria_min == null ? "" : String(aula.carga_horaria_min), materiais: aula.materiais ?? [],
      cta_texto: aula.cta_texto ?? "", cta_url: aula.cta_url ?? "", quiz: aula.quiz ?? [], nota_minima: String(aula.nota_minima ?? 70),
      temQuiz: !!aula.quiz?.length, temMateriais: !!aula.materiais?.length, temCta: !!aula.cta_texto, modoVideo: aula.video_path ? "arquivo" : "link",
    });
  }, [aula]);
  useEffect(() => {
    if (!editando && modulo) set({ posicao: String(modulo.aulas.length + 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando, moduloId, modulos.length]);

  const subir = async (file: File | null, campo: "video_path" | "thumb_path" | "material", aceita: RegExp, pasta: string) => {
    if (!file) return;
    if (!aceita.test(file.type)) return toast.error("Tipo de arquivo não permitido.");
    setSubindo(campo);
    try {
      const path = await uploadMidia(file, pasta);
      if (campo === "material") set({ materiais: [...f.materiais, { nome: file.name, path }] });
      else set({ [campo]: path } as Partial<Form>);
      toast.success("Arquivo enviado.");
    } catch (e: any) { toast.error(e?.message ?? "Não deu para enviar."); }
    finally { setSubindo(null); }
  };

  const gravar = async () => {
    if (!moduloId) return toast.error("Escolha o módulo.");
    if (!f.nome.trim()) return toast.error("Informe o nome da aula.");
    const precisaVideo = ["video", "audio", "link", "embed", "ao_vivo"].includes(f.tipo_conteudo);
    if (precisaVideo && !f.video_url.trim() && !f.video_path) return toast.error(`Informe o ${f.tipo_conteudo === "link" ? "link" : f.tipo_conteudo === "audio" ? "áudio" : "vídeo/embed"} da aula.`);
    if (f.temQuiz) {
      for (const [i, p] of f.quiz.entries()) {
        if (!p.enunciado.trim()) return toast.error(`Pergunta ${i + 1} sem enunciado.`);
        if (p.opcoes.filter((o) => o.trim()).length < 2) return toast.error(`Pergunta ${i + 1} precisa de 2 opções ou mais.`);
        if (!p.opcoes[p.correta]?.trim()) return toast.error(`Pergunta ${i + 1}: marque a opção correta.`);
      }
    }
    try {
      await salvar.mutateAsync({
        id: editando ? aulaId : undefined, modulo_id: moduloId, nome: f.nome.trim(), tipo_conteudo: f.tipo_conteudo,
        video_url: f.modoVideo === "link" || f.tipo_conteudo !== "video" ? normalizaVideo(f.video_url) || null : null,
        video_path: f.modoVideo === "arquivo" && f.tipo_conteudo === "video" ? f.video_path : null,
        thumb_path: f.thumb_path, descricao: f.descricao.trim() || null, posicao: Math.max(1, Number(f.posicao) || 1),
        publicada: f.publicada, gratuita: f.gratuita, gratuita_ate: f.gratuita && f.gratuita_ate ? f.gratuita_ate : null,
        liberar_em: f.liberar_em || null, liberar_dias: f.liberar_dias.trim() ? Number(f.liberar_dias) : null,
        carga_horaria_min: f.carga_horaria.trim() ? Number(f.carga_horaria) : null,
        materiais: f.temMateriais ? f.materiais : [], cta_texto: f.temCta ? f.cta_texto.trim() || null : null, cta_url: f.temCta ? f.cta_url.trim() || null : null,
        quiz: f.temQuiz && f.quiz.length ? f.quiz.map((p) => ({ ...p, opcoes: p.opcoes.map((o) => o.trim()) })) : null,
        nota_minima: Math.min(100, Math.max(0, Number(f.nota_minima) || 70)),
      });
      toast.success(editando ? "Aula atualizada." : "Aula criada.");
      navigate(`/app/treinamentos/cursos/${cursoId}`);
    } catch (e: any) { toast.error(e?.message ?? "Não deu para salvar."); }
  };

  const apagar = async () => {
    if (!editando || !window.confirm("Excluir esta aula?")) return;
    try { await excluir.mutateAsync(aulaId!); toast.success("Aula excluída."); navigate(`/app/treinamentos/cursos/${cursoId}`); }
    catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };

  const atualizarPergunta = (i: number, patch: Partial<PerguntaQuiz>) => set({ quiz: f.quiz.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  const thumb = urlMidia(f.thumb_path);

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.cursos} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        <TrnHero eyebrow={`Treinamentos › Cursos › ${cursoData?.curso.nome ?? ""}`} titulo={editando ? "Editar aula" : "Adicionar aula"}
                 texto={modulo ? `Módulo ${modulo.posicao}: ${modulo.nome}` : undefined}
                 acoes={<>
                   <Link to={`/app/treinamentos/cursos/${cursoId}`} className="sec">← Voltar ao curso</Link>
                   {editando && <AcessoGate menu={MENU.cursos} acao="excluir"><button className="sec" onClick={apagar}><Trash2 className="h-4 w-4" /> Excluir aula</button></AcessoGate>}
                 </>} />

        {editando && isLoading ? <TrnCarregando /> : (
          <div className="trn-lateral">
            <div className="trn-form">
              <div className="grupo">
                <h4>{editando ? "Editar informações" : "Adicionar informações"}</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="campo sm:col-span-2"><label>Nome da aula *</label><Input value={f.nome} onChange={(e) => set({ nome: e.target.value })} /></div>
                  <div className="campo">
                    <label>Módulo *</label>
                    <Select value={moduloId || "__"} onValueChange={(v) => setModuloId(v === "__" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="Escolha o módulo" /></SelectTrigger>
                      <SelectContent><SelectItem value="__">Escolha o módulo</SelectItem>{modulos.map((m) => <SelectItem key={m.id} value={m.id}>{m.posicao}. {m.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="campo">
                    <label>Tipo de conteúdo</label>
                    <Select value={f.tipo_conteudo} onValueChange={(v) => set({ tipo_conteudo: v as TipoConteudo })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{(Object.keys(ROTULO_TIPO_CONTEUDO) as TipoConteudo[]).map((t) => <SelectItem key={t} value={t}>{ROTULO_TIPO_CONTEUDO[t]}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>

                  {f.tipo_conteudo === "video" && (
                    <div className="campo sm:col-span-2">
                      <label>Tipo de player de vídeo</label>
                      <div className="mb-2 flex gap-2">
                        <button type="button" onClick={() => set({ modoVideo: "link" })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${f.modoVideo === "link" ? "border-orange-500 bg-orange-50 text-orange-700" : ""}`}>Vídeo incorporado (YouTube/Vimeo/embed)</button>
                        <button type="button" onClick={() => set({ modoVideo: "arquivo" })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${f.modoVideo === "arquivo" ? "border-orange-500 bg-orange-50 text-orange-700" : ""}`}>Enviar arquivo de vídeo</button>
                      </div>
                      {f.modoVideo === "link" ? (
                        <>
                          <Input placeholder="Cole o link do YouTube/Vimeo ou o código <iframe> embed" value={f.video_url} onChange={(e) => set({ video_url: e.target.value })} />
                          <div className="ajuda">Todos os tipos de embed são suportados — cole o código e a gente extrai o endereço.</div>
                        </>
                      ) : (
                        <div className="flex items-center gap-3">
                          <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted">
                            <Video className="mr-1 inline h-4 w-4" /> {subindo === "video_path" ? "Enviando…" : "Selecionar vídeo"}
                            <input type="file" accept="video/*" className="hidden" onChange={(e) => subir(e.target.files?.[0] ?? null, "video_path", /^video\//, "cursos/videos")} />
                          </label>
                          {f.video_path ? <span className="text-xs text-emerald-700">✓ {f.video_path.split("/").pop()}</span> : <span className="text-xs text-muted-foreground">MP4, WMV, MOV, AVI… até 500 MB.</span>}
                        </div>
                      )}
                    </div>
                  )}
                  {f.tipo_conteudo !== "video" && f.tipo_conteudo !== "texto" && (
                    <div className="campo sm:col-span-2">
                      <label>{f.tipo_conteudo === "audio" ? "URL do áudio" : f.tipo_conteudo === "link" ? "Link externo" : f.tipo_conteudo === "ao_vivo" ? "Link da transmissão ao vivo" : "Código / URL do conteúdo incorporado"} *</label>
                      <Input value={f.video_url} onChange={(e) => set({ video_url: e.target.value })} />
                    </div>
                  )}

                  <div className="campo sm:col-span-2">
                    <label>Thumbnail (capa) do vídeo</label>
                    <div className="flex items-center gap-3">
                      <div className="grid h-14 w-24 place-items-center overflow-hidden rounded-lg border bg-slate-100 text-[10px] text-slate-400">{thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : "sem capa"}</div>
                      <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted">
                        <ImagePlus className="mr-1 inline h-4 w-4" /> {subindo === "thumb_path" ? "Enviando…" : "Selecionar imagem"}
                        <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => subir(e.target.files?.[0] ?? null, "thumb_path", /^image\/(png|jpe?g)$/, "cursos/thumbs")} />
                      </label>
                      {f.thumb_path && <button type="button" className="text-xs text-rose-600" onClick={() => set({ thumb_path: null })}>remover</button>}
                    </div>
                    <div className="ajuda">PNG ou JPG, recomendado 1920 × 1080.</div>
                  </div>

                  <div className="campo sm:col-span-2">
                    <label>Descrição</label>
                    <Textarea rows={8} value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} placeholder="O texto da aula. Parágrafos separados por linha em branco." />
                  </div>

                  <div className="campo">
                    <label>Posição da aula *</label>
                    <Input inputMode="numeric" value={f.posicao} onChange={(e) => set({ posicao: e.target.value })} />
                    <div className="ajuda">Ordem em que a aula aparece dentro do módulo.</div>
                  </div>
                  <div className="campo">
                    <label>Status da aula *</label>
                    <Select value={f.publicada ? "pub" : "rasc"} onValueChange={(v) => set({ publicada: v === "pub" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="pub">Publicado</SelectItem><SelectItem value="rasc">Rascunho</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="campo">
                    <label>Aula gratuita (amostra)</label>
                    <label className="flex items-center gap-2 text-sm"><Switch checked={f.gratuita} onCheckedChange={(v) => set({ gratuita: v })} /> {f.gratuita ? "Sim" : "Não"}</label>
                    <div className="ajuda">Se ativado, qualquer aluno vê esta aula sem estar matriculado no curso.</div>
                  </div>
                  {f.gratuita && (
                    <div className="campo">
                      <label>Encerra em (opcional)</label>
                      <Input type="date" value={f.gratuita_ate} onChange={(e) => set({ gratuita_ate: e.target.value })} />
                      <div className="ajuda">Após essa data a aula gratuita deixa de aparecer.</div>
                    </div>
                  )}
                  <div className="campo">
                    <label>Data de liberação (opcional)</label>
                    <Input type="date" value={f.liberar_em} onChange={(e) => set({ liberar_em: e.target.value })} />
                    <div className="ajuda">Se definida, é a primeira trava antes da liberação por dias.</div>
                  </div>
                  <div className="campo">
                    <label>Liberação da aula (em dias)</label>
                    <Input inputMode="numeric" value={f.liberar_dias} onChange={(e) => set({ liberar_dias: e.target.value })} placeholder="imediato" />
                    <div className="ajuda">A liberação programada do módulo substitui esta.</div>
                  </div>
                  <div className="campo">
                    <label>Carga horária da aula (em minutos, opcional)</label>
                    <Input inputMode="numeric" value={f.carga_horaria} onChange={(e) => set({ carga_horaria: e.target.value })} />
                    <div className="ajuda">Aparece no verso do certificado.</div>
                  </div>
                </div>
              </div>

              <div className="grupo">
                <h4>Exibir quiz após a aula</h4>
                <label className="flex items-center gap-2 text-sm"><Switch checked={f.temQuiz} onCheckedChange={(v) => set({ temQuiz: v, quiz: v && !f.quiz.length ? [novaPergunta()] : f.quiz })} /> {f.temQuiz ? "Exibir quiz" : "Não exibir"}</label>
                {f.temQuiz && (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm"><span>Nota mínima para aprovar:</span><Input className="w-20" inputMode="numeric" value={f.nota_minima} onChange={(e) => set({ nota_minima: e.target.value })} /><span>%</span></div>
                    {f.quiz.map((p, i) => (
                      <div key={p.id} className="rounded-xl border p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-500">Pergunta {i + 1}</span>
                          <Button variant="ghost" size="sm" className="ml-auto text-rose-600" onClick={() => set({ quiz: f.quiz.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                        <Input placeholder="Enunciado" value={p.enunciado} onChange={(e) => atualizarPergunta(i, { enunciado: e.target.value })} />
                        <div className="mt-2 space-y-1.5">
                          {p.opcoes.map((o, k) => (
                            <div key={k} className="flex items-center gap-2">
                              <input type="radio" name={`correta-${p.id}`} checked={p.correta === k} onChange={() => atualizarPergunta(i, { correta: k })} title="Correta" />
                              <Input placeholder={`Opção ${k + 1}`} value={o} onChange={(e) => atualizarPergunta(i, { opcoes: p.opcoes.map((x, j) => (j === k ? e.target.value : x)) })} />
                              {p.opcoes.length > 2 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => atualizarPergunta(i, { opcoes: p.opcoes.filter((_, j) => j !== k), correta: Math.min(p.correta, p.opcoes.length - 2) })}><Trash2 className="h-3.5 w-3.5" /></Button>}
                            </div>
                          ))}
                          <Button variant="outline" size="sm" onClick={() => atualizarPergunta(i, { opcoes: [...p.opcoes, ""] })}><Plus className="mr-1 h-3.5 w-3.5" /> Opção</Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => set({ quiz: [...f.quiz, novaPergunta()] })}><Plus className="mr-1 h-4 w-4" /> Nova pergunta</Button>
                  </div>
                )}
              </div>

              <div className="grupo">
                <h4>Deseja adicionar materiais complementares à aula?</h4>
                <label className="flex items-center gap-2 text-sm"><Switch checked={f.temMateriais} onCheckedChange={(v) => set({ temMateriais: v })} /> {f.temMateriais ? "Sim" : "Não"}</label>
                {f.temMateriais && (
                  <div className="mt-3 space-y-2">
                    {f.materiais.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                        {m.path ? <FileUp className="h-4 w-4 text-slate-400" /> : <Link2 className="h-4 w-4 text-slate-400" />}
                        <Input className="h-8 flex-1" value={m.nome} onChange={(e) => set({ materiais: f.materiais.map((x, k) => (k === i ? { ...x, nome: e.target.value } : x)) })} />
                        {m.url && <span className="truncate text-xs text-slate-400">{m.url}</span>}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-rose-600" onClick={() => set({ materiais: f.materiais.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted">
                        <FileUp className="mr-1 inline h-4 w-4" /> {subindo === "material" ? "Enviando…" : "Enviar arquivo"}
                        <input type="file" className="hidden" onChange={(e) => subir(e.target.files?.[0] ?? null, "material", /./, "cursos/materiais")} />
                      </label>
                      <Button variant="outline" size="sm" onClick={() => { const url = window.prompt("URL do material:"); if (url) set({ materiais: [...f.materiais, { nome: url, url }] }); }}><Link2 className="mr-1 h-4 w-4" /> Adicionar link</Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grupo">
                <h4>Deseja adicionar um botão (CTA) abaixo do vídeo da aula?</h4>
                <label className="flex items-center gap-2 text-sm"><Switch checked={f.temCta} onCheckedChange={(v) => set({ temCta: v })} /> {f.temCta ? "Sim" : "Não"}</label>
                {f.temCta && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Input placeholder="Texto do botão" value={f.cta_texto} onChange={(e) => set({ cta_texto: e.target.value })} />
                    <Input placeholder="https://…" value={f.cta_url} onChange={(e) => set({ cta_url: e.target.value })} />
                  </div>
                )}
              </div>

              <AcessoGate menu={MENU.cursos} acao="alterar" fallback={<p className="text-xs text-muted-foreground">Você pode ver, mas não tem a ação de alterar cursos.</p>}>
                <div><Button disabled={salvar.isPending || !!subindo} onClick={gravar}><Save className="mr-2 h-4 w-4" /> {editando ? "Salvar alterações" : "Criar aula"}</Button></div>
              </AcessoGate>
            </div>

            <div className="trn-ajuda">
              <h4>{editando ? "Editando uma aula" : "Criando uma aula"}</h4>
              <h5>Vídeo da aula</h5>
              Cole o link do YouTube/Vimeo ou o código embed da plataforma externa. Vídeo que não pode sair da empresa vai por arquivo.
              <h5>Descrição</h5>
              O texto que acompanha o vídeo (ou é a aula inteira, no tipo "Somente texto").
              <h5>Posição</h5>
              Organiza as aulas dentro do módulo. Dá pra reordenar também na visualização do curso.
              <h5>Quiz</h5>
              Aparece logo depois da aula. Marque a opção correta com o botão de rádio.
            </div>
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
