import { useState } from "react";
import { toast } from "sonner";
import { Bell, ImagePlus, MoreVertical, Plus, Save } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { uploadMidia, urlMidia, useTrnAvisos, useTrnExcluirAviso, useTrnSalvarAviso, useTrnTags } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type Aviso, type Publico } from "./tipos";
import { PublicoPicker, TrnCarregando, TrnEstilo, TrnHero, TrnVazio, fmtData } from "./ui";

// =====================================================================
// TREINAMENTOS — Comunicação › Avisos. Mensagens que aparecem para o aluno
// ao entrar na plataforma: título, URL, conteúdo (texto / imagem / vídeo),
// público (todos ou tags) e, em "Configurações adicionais", período e
// status de publicação. Lista com título, público, período, status, data.
// =====================================================================

interface Form {
  id?: string; titulo: string; url: string; tipo_conteudo: Aviso["tipo_conteudo"]; mensagem: string; imagem_path: string | null; video_url: string;
  publico: Publico; tagIds: string[]; inicio_em: string; fim_em: string; publicado: boolean;
}
const VAZIO: Form = { titulo: "", url: "", tipo_conteudo: "texto", mensagem: "", imagem_path: null, video_url: "", publico: "todos", tagIds: [], inicio_em: "", fim_em: "", publicado: true };

export default function Avisos() {
  const { data: avisos = [], isLoading } = useTrnAvisos();
  const { data: tags = [] } = useTrnTags();
  const salvar = useTrnSalvarAviso();
  const excluir = useTrnExcluirAviso();
  const [f, setF] = useState<Form | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [config, setConfig] = useState(false);
  const set = (p: Partial<Form>) => setF((x) => ({ ...(x ?? VAZIO), ...p }));

  const abrir = (a?: Aviso) => {
    setF(a ? { id: a.id, titulo: a.titulo, url: a.url ?? "", tipo_conteudo: a.tipo_conteudo, mensagem: a.mensagem ?? "", imagem_path: a.imagem_path, video_url: a.video_url ?? "",
      publico: a.publico, tagIds: (a.tags ?? []).map((t) => t.tag_id), inicio_em: a.inicio_em ?? "", fim_em: a.fim_em ?? "", publicado: a.publicado } : { ...VAZIO });
    setConfig(!!(a?.inicio_em || a?.fim_em || (a && !a.publicado)));
  };
  const gravar = async () => {
    if (!f) return;
    if (!f.titulo.trim()) return toast.error("Informe o título.");
    if (f.titulo.length > 100) return toast.error("Título com no máximo 100 caracteres.");
    if (f.tipo_conteudo === "texto" && !f.mensagem.trim()) return toast.error("Informe a mensagem.");
    if (f.tipo_conteudo === "imagem" && !f.imagem_path) return toast.error("Envie a imagem.");
    if (f.tipo_conteudo === "video" && !f.video_url.trim()) return toast.error("Informe o vídeo.");
    if (f.publico === "tags" && f.tagIds.length === 0) return toast.error("Escolha ao menos uma tag.");
    try {
      await salvar.mutateAsync({ id: f.id, titulo: f.titulo.trim(), url: f.url.trim() || null, tipo_conteudo: f.tipo_conteudo, mensagem: f.mensagem.trim() || null,
        imagem_path: f.imagem_path, video_url: f.video_url.trim() || null, publico: f.publico, tagIds: f.tagIds, inicio_em: f.inicio_em || null, fim_em: f.fim_em || null, publicado: f.publicado });
      toast.success(f.id ? "Aviso atualizado." : "Aviso criado."); setF(null);
    } catch (e: any) { toast.error(e?.message ?? "Não deu para salvar."); }
  };
  const apagar = async (a: Aviso) => {
    if (!window.confirm(`Excluir o aviso "${a.titulo}"?`)) return;
    try { await excluir.mutateAsync(a.id); toast.success("Aviso excluído."); } catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };
  const nomeTags = (a: Aviso) => (a.tags ?? []).map((t) => tags.find((x) => x.id === t.tag_id)?.nome).filter(Boolean).join(", ");
  const periodo = (a: Aviso) => (!a.inicio_em && !a.fim_em) ? "Sem limite" : `${a.inicio_em ? fmtData(a.inicio_em) : "…"} → ${a.fim_em ? fmtData(a.fim_em) : "…"}`;

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.avisos} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para os avisos.</Card>}>
        <TrnHero eyebrow="Treinamentos › Comunicação" titulo="Avisos" texto="Mensagens importantes que aparecem para os alunos quando acessam a plataforma."
                 acoes={<AcessoGate menu={MENU.avisos} acao="incluir"><button onClick={() => abrir()}><Plus className="h-4 w-4" /> Adicionar aviso</button></AcessoGate>} />

        {f ? (
          <div className="trn-lateral">
            <div className="trn-form">
              <div className="grupo">
                <h4>{f.id ? "Editar aviso" : "Adicionar informações"}</h4>
                <div className="grid gap-3">
                  <div className="campo"><label>Título *</label><Input maxLength={100} value={f.titulo} onChange={(e) => set({ titulo: e.target.value })} /><div className="ajuda">Máximo 100 caracteres ({f.titulo.length}/100).</div></div>
                  <div className="campo"><label>URL direta (opcional)</label><Input placeholder="https://…" value={f.url} onChange={(e) => set({ url: e.target.value })} /><div className="ajuda">Para onde o aluno vai ao clicar no aviso.</div></div>
                  <div className="campo">
                    <label>Conteúdo do aviso</label>
                    <div className="flex gap-2">
                      {([["texto", "Texto"], ["imagem", "Imagem (png/jpg)"], ["video", "Vídeo (link/embed)"]] as const).map(([v, r]) => (
                        <button key={v} type="button" onClick={() => set({ tipo_conteudo: v })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${f.tipo_conteudo === v ? "border-orange-500 bg-orange-50 text-orange-700" : ""}`}>{r}</button>
                      ))}
                    </div>
                  </div>
                  {f.tipo_conteudo === "imagem" && (
                    <div className="campo"><label>Imagem</label>
                      <div className="flex items-center gap-3">
                        {urlMidia(f.imagem_path) && <img src={urlMidia(f.imagem_path)!} alt="" className="h-16 rounded-lg border object-cover" />}
                        <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted"><ImagePlus className="mr-1 inline h-4 w-4" /> {subindo ? "Enviando…" : "Enviar imagem"}
                          <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; setSubindo(true); try { set({ imagem_path: await uploadMidia(file, "avisos") }); } catch (er: any) { toast.error(er?.message ?? "Não deu."); } finally { setSubindo(false); } }} /></label>
                      </div></div>
                  )}
                  {f.tipo_conteudo === "video" && <div className="campo"><label>Vídeo (URL do YouTube/Vimeo ou embed)</label><Input value={f.video_url} onChange={(e) => set({ video_url: e.target.value })} /></div>}
                  <div className="campo"><label>Mensagem {f.tipo_conteudo === "texto" ? "*" : "(opcional)"}</label><Textarea rows={5} value={f.mensagem} onChange={(e) => set({ mensagem: e.target.value })} /></div>
                </div>
              </div>
              <div className="grupo">
                <h4>Público do aviso *</h4>
                <PublicoPicker publico={f.publico} tagIds={f.tagIds} onPublico={(p) => set({ publico: p })} onTags={(ids) => set({ tagIds: ids })} />
              </div>
              <button type="button" className="text-sm font-bold text-orange-600" onClick={() => setConfig((v) => !v)}>Configurações adicionais {config ? "▴" : "▾"}</button>
              {config && (
                <div className="grupo">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="campo"><label>Exibir a partir de</label><Input type="date" value={f.inicio_em} onChange={(e) => set({ inicio_em: e.target.value })} /></div>
                    <div className="campo"><label>Exibir até</label><Input type="date" value={f.fim_em} onChange={(e) => set({ fim_em: e.target.value })} /></div>
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm"><Switch checked={f.publicado} onCheckedChange={(v) => set({ publicado: v })} /> {f.publicado ? "Publicado" : "Rascunho (não aparece para o aluno)"}</label>
                </div>
              )}
              <div className="flex gap-2">
                <AcessoGate menu={MENU.avisos} acao={f.id ? "alterar" : "incluir"} fallback={<p className="text-xs text-muted-foreground">Sem a ação de salvar.</p>}>
                  <Button disabled={salvar.isPending || subindo} onClick={gravar}><Save className="mr-2 h-4 w-4" /> {f.id ? "Salvar alterações" : "Criar aviso"}</Button>
                </AcessoGate>
                <Button variant="outline" onClick={() => setF(null)}>Cancelar</Button>
              </div>
            </div>
            <div className="trn-ajuda">
              <h4>Criando um aviso</h4>
              Avisos são mensagens importantes que aparecem para seus alunos quando acessam a plataforma.
              <h5>Título</h5>Exibido no topo do aviso para identificação rápida.
              <h5>Segmentação</h5>Todos os alunos ou só quem tem as tags escolhidas.
              <h5>Período</h5>Ideal para campanhas temporárias ou avisos com prazo.
            </div>
          </div>
        ) : isLoading ? <TrnCarregando /> : avisos.length === 0 ? (
          <TrnVazio titulo="Nenhum aviso" texto="Crie um aviso de boas-vindas ou um lembrete de curso novo." acao={<Button onClick={() => abrir()}>Adicionar aviso</Button>} />
        ) : (
          <div className="trn-card p-0">
            <table className="trn-tab">
              <thead><tr><th>Título</th><th>Público</th><th>Período</th><th>Status</th><th>Criado em</th><th /></tr></thead>
              <tbody>
                {avisos.map((a) => (
                  <tr key={a.id}>
                    <td><b className="text-slate-900"><Bell className="mr-1 inline h-3.5 w-3.5 text-slate-400" />{a.titulo}</b><div className="text-[11px] text-slate-400">{a.tipo_conteudo}{a.url ? ` · ${a.url}` : ""}</div></td>
                    <td>{a.publico === "todos" ? <span className="trn-badge" style={{ background: "#f26522", color: "#fff" }}>Todos os alunos</span> : <span className="text-xs">{nomeTags(a) || "Tags"}</span>}</td>
                    <td className="text-xs">{periodo(a)}</td>
                    <td><span className={`trn-badge ${a.publicado ? "ok" : "off"}`}>{a.publicado ? "Publicado" : "Rascunho"}</span></td>
                    <td className="text-xs">{fmtData(a.created_at)}</td>
                    <td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => abrir(a)}>Editar</DropdownMenuItem>
                          <DropdownMenuItem className="text-rose-600" onSelect={() => apagar(a)}>Excluir</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
