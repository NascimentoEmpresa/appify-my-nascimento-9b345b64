import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ImagePlus, Save } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { uploadMidia, urlMidia, useTrnCategorias, useTrnCurso, useTrnModelosCertificado, useTrnSalvarCurso } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type CapaFormato } from "./tipos";
import { TrnCarregando, TrnEstilo, TrnHero } from "./ui";

// =====================================================================
// TREINAMENTOS — Cursos › Adicionar novo / Editar curso.
//
// Os campos do "Editar curso" do membox: nome, descrição, formato e imagem
// da capa, categoria, slug, certificado, ordem na vitrine, carga horária,
// URL de vendas, data e dias de liberação, "exibir módulos como cursos",
// prazo de acesso, e os três toggles do topo da visualização (publicado,
// em breve, comentários). Módulos e aulas ficam na visualização do curso.
// =====================================================================

const PRAZOS = [730, 365, 180, 90, 60, 30, 14, 7];

interface Form {
  nome: string; descricao: string; slug: string; capa_path: string | null; capa_formato: CapaFormato;
  categoria_id: string; certificado_modelo_id: string; ordem_vitrine: string; carga_horaria: string; url_vendas: string;
  liberar_em: string; liberar_dias: string; prazo: string; prazoOutro: string; modulos_como_cursos: boolean;
  publicado: boolean; em_breve: boolean; comentarios_habilitados: boolean;
}
const VAZIO: Form = {
  nome: "", descricao: "", slug: "", capa_path: null, capa_formato: "paisagem", categoria_id: "", certificado_modelo_id: "",
  ordem_vitrine: "", carga_horaria: "", url_vendas: "", liberar_em: "", liberar_dias: "0", prazo: "", prazoOutro: "",
  modulos_como_cursos: false, publicado: false, em_breve: false, comentarios_habilitados: true,
};

export default function CursoForm() {
  const { id } = useParams<{ id: string }>();
  const editando = !!id && id !== "novo";
  const navigate = useNavigate();
  const { data, isLoading } = useTrnCurso(editando ? id : null);
  const { data: categorias = [] } = useTrnCategorias();
  const { data: modelos = [] } = useTrnModelosCertificado();
  const salvar = useTrnSalvarCurso();
  const [f, setF] = useState<Form>(VAZIO);
  const [subindo, setSubindo] = useState(false);
  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    if (!data) return;
    const c = data.curso;
    const prazoConhecido = c.prazo_acesso_dias != null && PRAZOS.includes(c.prazo_acesso_dias);
    setF({
      nome: c.nome, descricao: c.descricao ?? "", slug: c.slug, capa_path: c.capa_path, capa_formato: c.capa_formato,
      categoria_id: c.categoria_id ?? "", certificado_modelo_id: c.certificado_modelo_id ?? "",
      ordem_vitrine: c.ordem_vitrine == null ? "" : String(c.ordem_vitrine),
      carga_horaria: c.carga_horaria_min == null ? "" : String(Math.round(c.carga_horaria_min / 60 * 100) / 100),
      url_vendas: c.url_vendas ?? "", liberar_em: c.liberar_em ?? "", liberar_dias: String(c.liberar_dias ?? 0),
      prazo: c.prazo_acesso_dias == null ? "" : prazoConhecido ? String(c.prazo_acesso_dias) : "outros",
      prazoOutro: c.prazo_acesso_dias != null && !prazoConhecido ? String(c.prazo_acesso_dias) : "",
      modulos_como_cursos: c.modulos_como_cursos, publicado: c.publicado, em_breve: c.em_breve, comentarios_habilitados: c.comentarios_habilitados,
    });
  }, [data]);

  const subirCapa = async (file: File | null) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return toast.error("A capa tem que ser JPG ou PNG.");
    setSubindo(true);
    try { set({ capa_path: await uploadMidia(file, "cursos/capas") }); toast.success("Capa enviada."); }
    catch (e: any) { toast.error(e?.message ?? "Não deu para enviar a capa."); }
    finally { setSubindo(false); }
  };

  const gravar = async () => {
    if (!f.nome.trim()) return toast.error("Informe o nome do curso.");
    if (!f.descricao.trim()) return toast.error("Informe a descrição.");
    const prazo = f.prazo === "outros" ? Number(f.prazoOutro) : f.prazo ? Number(f.prazo) : null;
    if (prazo !== null && (!Number.isInteger(prazo) || prazo <= 0)) return toast.error("Prazo de acesso inválido.");
    const carga = f.carga_horaria.trim() ? Math.round(Number(f.carga_horaria.replace(",", ".")) * 60) : null;
    if (carga !== null && (!Number.isFinite(carga) || carga < 0)) return toast.error("Carga horária inválida.");
    try {
      const novoId = await salvar.mutateAsync({
        id: editando ? id : undefined,
        nome: f.nome.trim(), descricao: f.descricao.trim(), slug: f.slug.trim(), capa_path: f.capa_path, capa_formato: f.capa_formato,
        categoria_id: f.modulos_como_cursos ? null : (f.categoria_id || null),
        certificado_modelo_id: f.certificado_modelo_id || null,
        ordem_vitrine: f.ordem_vitrine.trim() ? Number(f.ordem_vitrine) : null,
        carga_horaria_min: carga, url_vendas: f.url_vendas.trim() || null,
        liberar_em: f.liberar_em || null, liberar_dias: Math.max(0, Number(f.liberar_dias) || 0),
        prazo_acesso_dias: prazo, modulos_como_cursos: f.modulos_como_cursos,
        publicado: f.publicado, em_breve: f.em_breve, comentarios_habilitados: f.comentarios_habilitados,
      });
      toast.success(editando ? "Curso atualizado." : "Curso criado — agora adicione módulos e aulas.");
      navigate(`/app/treinamentos/cursos/${novoId}`);
    } catch (e: any) { toast.error(e?.message ?? "Não deu para salvar."); }
  };

  const menuTela = editando ? MENU.cursos : MENU.cursosNovo;
  const capaUrl = urlMidia(f.capa_path);

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={menuTela} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para esta tela.</Card>}>
        <TrnHero eyebrow="Treinamentos › Cursos" titulo={editando ? `Editar: ${data?.curso.nome ?? "curso"}` : "Adicionar curso"}
                 texto="Nome, descrição e capa aparecem na vitrine da área do aluno — capriche."
                 acoes={<Link to={editando ? `/app/treinamentos/cursos/${id}` : "/app/treinamentos/cursos"} className="sec">← {editando ? "Visualização do curso" : "Todos os cursos"}</Link>} />

        {editando && isLoading ? <TrnCarregando /> : (
          <div className="trn-lateral">
            <div className="trn-form">
              <div className="grupo">
                <h4>{editando ? "Editar informações" : "Adicionar informações"}</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="campo sm:col-span-2"><label>Nome do curso *</label><Input value={f.nome} onChange={(e) => set({ nome: e.target.value })} /></div>
                  <div className="campo sm:col-span-2"><label>Descrição *</label><Textarea rows={4} value={f.descricao} onChange={(e) => set({ descricao: e.target.value })} /></div>

                  <div className="campo">
                    <label>Formato da imagem do curso na vitrine *</label>
                    <div className="flex gap-2">
                      {(["paisagem", "retrato", "quadrado"] as CapaFormato[]).map((fm) => (
                        <button key={fm} type="button" onClick={() => set({ capa_formato: fm })}
                                className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize ${f.capa_formato === fm ? "border-orange-500 bg-orange-50 text-orange-700" : ""}`}>{fm}</button>
                      ))}
                    </div>
                  </div>
                  <div className="campo">
                    <label>Logotipo / capa do curso</label>
                    <div className="flex items-center gap-3">
                      <div className="grid h-16 w-24 place-items-center overflow-hidden rounded-lg border bg-slate-100 text-[10px] text-slate-400">
                        {capaUrl ? <img src={capaUrl} alt="" className="h-full w-full object-cover" /> : "sem capa"}
                      </div>
                      <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted">
                        <ImagePlus className="mr-1 inline h-4 w-4" /> {subindo ? "Enviando…" : "Enviar arquivo"}
                        <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => subirCapa(e.target.files?.[0] ?? null)} />
                      </label>
                      {f.capa_path && <button type="button" className="text-xs text-rose-600" onClick={() => set({ capa_path: null })}>remover</button>}
                    </div>
                    <div className="ajuda">500 × 350 px para melhor resolução. JPG ou PNG.</div>
                  </div>

                  <div className="campo">
                    <label>Este curso faz parte de qual categoria?</label>
                    <Select value={f.categoria_id || "__"} onValueChange={(v) => set({ categoria_id: v === "__" ? "" : v })} disabled={f.modulos_como_cursos}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="__">Nenhuma</SelectItem>{categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
                    </Select>
                    {categorias.length === 0 && <div className="ajuda">Nenhuma categoria ainda — <Link to="/app/treinamentos/cursos/categorias" className="text-primary">cadastre em Categorias</Link>.</div>}
                  </div>
                  <div className="campo">
                    <label>Slug</label>
                    <Input placeholder="gerado do nome se vazio" value={f.slug} onChange={(e) => set({ slug: e.target.value })} />
                    <div className="ajuda">Endereço do curso na área do aluno: /curso/<b>{f.slug || "…"}</b></div>
                  </div>

                  <div className="campo">
                    <label>Certificado (opcional)</label>
                    <Select value={f.certificado_modelo_id || "__"} onValueChange={(v) => set({ certificado_modelo_id: v === "__" ? "" : v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="__">Não emitir certificado</SelectItem>{modelos.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="campo">
                    <label>Ordem de exibição na vitrine (opcional)</label>
                    <Input inputMode="numeric" value={f.ordem_vitrine} onChange={(e) => set({ ordem_vitrine: e.target.value })} />
                    <div className="ajuda">Vazio = sem ordem definida.</div>
                  </div>
                  <div className="campo">
                    <label>Carga horária do curso (horas, opcional)</label>
                    <Input inputMode="decimal" placeholder="ex.: 8" value={f.carga_horaria} onChange={(e) => set({ carga_horaria: e.target.value })} />
                    <div className="ajuda">Se preenchida, aparece no certificado.</div>
                  </div>
                  <div className="campo">
                    <label>URL da página de vendas externa (opcional)</label>
                    <Input value={f.url_vendas} onChange={(e) => set({ url_vendas: e.target.value })} />
                  </div>
                  <div className="campo">
                    <label>Data de liberação do curso (opcional)</label>
                    <Input type="date" value={f.liberar_em} onChange={(e) => set({ liberar_em: e.target.value })} />
                    <div className="ajuda">Se definida, o curso só fica disponível a partir desta data.</div>
                  </div>
                  <div className="campo">
                    <label>Liberação do curso (em dias)</label>
                    <Input inputMode="numeric" value={f.liberar_dias} onChange={(e) => set({ liberar_dias: e.target.value })} />
                    <div className="ajuda">Dias após a matrícula para liberar. 0 libera imediatamente.</div>
                  </div>
                </div>
              </div>

              <div className="grupo">
                <h4>Exibir módulos como cursos na vitrine</h4>
                <label className="flex items-center gap-2 text-sm"><Switch checked={f.modulos_como_cursos} onCheckedChange={(v) => set({ modulos_como_cursos: v })} /> {f.modulos_como_cursos ? "Habilitado" : "Desabilitado"}</label>
                <div className="ajuda mt-1 text-xs text-muted-foreground">Habilitado, o nome do curso vira uma categoria na vitrine e cada módulo aparece como um curso — por isso a categoria acima é ignorada.</div>
              </div>

              <div className="grupo">
                <h4>Prazo de acesso ao curso para alunos</h4>
                <div className="flex flex-wrap gap-3">
                  <Select value={f.prazo || "__"} onValueChange={(v) => set({ prazo: v === "__" ? "" : v })}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__">Vitalício</SelectItem>
                      {PRAZOS.map((d) => <SelectItem key={d} value={String(d)}>{d} dias</SelectItem>)}
                      <SelectItem value="outros">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                  {f.prazo === "outros" && <Input className="w-32" inputMode="numeric" placeholder="dias" value={f.prazoOutro} onChange={(e) => set({ prazoOutro: e.target.value })} />}
                </div>
                <div className="ajuda mt-1 text-xs text-muted-foreground">Contado a partir da matrícula. Aluno com acesso completo ignora esta configuração.</div>
              </div>

              <div className="grupo">
                <h4>Publicação</h4>
                <div className="flex flex-wrap gap-6 text-sm">
                  <label className="flex items-center gap-2"><Switch checked={f.publicado} onCheckedChange={(v) => set({ publicado: v })} /> Curso publicado</label>
                  <label className="flex items-center gap-2"><Switch checked={f.em_breve} onCheckedChange={(v) => set({ em_breve: v })} /> Em breve</label>
                  <label className="flex items-center gap-2"><Switch checked={f.comentarios_habilitados} onCheckedChange={(v) => set({ comentarios_habilitados: v })} /> Comentários habilitados</label>
                </div>
              </div>

              <AcessoGate menu={menuTela} acao={editando ? "alterar" : "incluir"} fallback={<p className="text-xs text-muted-foreground">Você pode ver, mas não tem a ação de {editando ? "alterar" : "incluir"} curso.</p>}>
                <div><Button disabled={salvar.isPending || subindo} onClick={gravar}><Save className="mr-2 h-4 w-4" /> {editando ? "Salvar alterações" : "Criar curso"}</Button></div>
              </AcessoGate>
            </div>

            <div className="trn-ajuda">
              <h4>{editando ? "Editando um curso" : "Criando um curso"}</h4>
              Ao salvar, o curso é replicado de imediato na área do aluno (se publicado).
              <h5>Observação</h5>
              Nome, descrição e capa são o que o aluno vê na vitrine. Depois de criar, adicione módulos e aulas na visualização do curso.
              <h5>Certificado</h5>
              Escolha um modelo em Cursos › Certificados. Sem modelo, o curso não emite certificado.
            </div>
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
