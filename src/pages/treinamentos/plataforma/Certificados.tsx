import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Award, ImagePlus, MoreVertical, Plus, Save, Trash2 } from "lucide-react";
import { AcessoGate } from "@/components/auth/AcessoGate";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { uploadMidia, urlMidia, useTrnExcluirModelo, useTrnModelosCertificado, useTrnSalvarModelo } from "@/hooks/useTreinamentosPlataforma";
import { MENU, type CertificadoModelo } from "./tipos";
import { CertificadoFrente, CertificadoVerso, EXEMPLO } from "./CertificadoPreview";
import { TrnCarregando, TrnEstilo, TrnHero, TrnVazio } from "./ui";

// =====================================================================
// TREINAMENTOS — Cursos › Certificados (modelos).
//
// Lista de modelos + editor com prévia ao vivo: nome, título, texto
// superior/inferior (${curso}, ${data}), o que exibir, frente e verso,
// layout e imagens de fundo. O curso escolhe o modelo em "Editar curso";
// a emissão acontece em Aluno › Certificados (ou pela área do aluno, na
// fase 2).
// =====================================================================

const NOVO: Omit<CertificadoModelo, "id" | "created_at" | "updated_at"> = {
  nome: "", titulo: "Certificado de conclusão de curso",
  texto_superior: "A instituição de ensino Grupo Nascimento certifica que o(a) aluno(a)",
  texto_inferior: "Concluiu o curso de ${curso} no dia ${data}",
  exibir_nome_negocio: true, exibir_logo: false, exibir_cnpj: false, exibir_carga_horaria: true, exibir_qr: true,
  exibir_documento: true, frente_verso: false, verso_somente_modulos: false, verso_titulo: "Conteúdo programático",
  layout: "centro", fundo_path: null, fundo_verso_path: null,
};

export default function Certificados() {
  const { data: modelos = [], isLoading } = useTrnModelosCertificado();
  const salvar = useTrnSalvarModelo();
  const excluir = useTrnExcluirModelo();
  const [editando, setEditando] = useState<Partial<CertificadoModelo> | null>(null);
  const [subindo, setSubindo] = useState<string | null>(null);
  const set = (p: Partial<CertificadoModelo>) => setEditando((x) => ({ ...(x ?? {}), ...p }));

  useEffect(() => { if (!isLoading && modelos.length === 0 && !editando) setEditando({ ...NOVO }); }, [isLoading, modelos.length, editando]);

  const subir = async (file: File | null, campo: "fundo_path" | "fundo_verso_path") => {
    if (!file) return;
    if (!/^image\/(png|jpe?g)$/.test(file.type)) return toast.error("Imagem tem que ser JPG ou PNG.");
    setSubindo(campo);
    try { set({ [campo]: await uploadMidia(file, "certificados") }); } catch (e: any) { toast.error(e?.message ?? "Não deu."); }
    finally { setSubindo(null); }
  };
  const gravar = async () => {
    if (!editando?.nome?.trim()) return toast.error("Informe o nome do modelo.");
    if (!editando?.titulo?.trim()) return toast.error("Informe o título do certificado.");
    try { await salvar.mutateAsync({ ...NOVO, ...editando, nome: editando.nome!.trim(), titulo: editando.titulo!.trim() } as any); toast.success("Modelo salvo."); setEditando(null); }
    catch (e: any) { toast.error(e?.message ?? "Não deu para salvar."); }
  };
  const apagar = async (m: CertificadoModelo) => {
    if (!window.confirm(`Excluir o modelo "${m.nome}"? Cursos que o usam passam a não emitir certificado.`)) return;
    try { await excluir.mutateAsync(m.id); toast.success("Modelo excluído."); } catch (e: any) { toast.error(e?.message ?? "Não deu."); }
  };

  const modeloPreview = { ...NOVO, id: "", created_at: "", updated_at: "", ...(editando ?? {}) } as CertificadoModelo;

  return (
    <div className="trn mx-auto max-w-7xl">
      <TrnEstilo />
      <AcessoGate menu={MENU.certificados} acao="visualizar" fallback={<Card className="p-6 text-sm text-muted-foreground">Você não tem liberação para os certificados.</Card>}>
        <TrnHero eyebrow="Treinamentos › Cursos" titulo="Certificados" texto="Modelos de certificado. Cada curso escolhe o seu em Editar curso; quem conclui recebe o certificado com código de validação."
                 acoes={<AcessoGate menu={MENU.certificados} acao="incluir"><button onClick={() => setEditando({ ...NOVO })}><Plus className="h-4 w-4" /> Adicionar certificado</button></AcessoGate>} />

        {isLoading ? <TrnCarregando /> : !editando && modelos.length === 0 ? (
          <TrnVazio titulo="Nenhum modelo" acao={<Button onClick={() => setEditando({ ...NOVO })}>Adicionar certificado</Button>} />
        ) : !editando ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {modelos.map((m) => (
              <div key={m.id} className="trn-card flex items-center gap-4">
                <div className="grid h-14 w-20 place-items-center rounded-lg border bg-slate-100 text-[10px] font-bold uppercase text-slate-500">{urlMidia(m.fundo_path) ? <img src={urlMidia(m.fundo_path)!} alt="" className="h-full w-full rounded-lg object-cover" /> : "custom"}</div>
                <div className="min-w-0 flex-1"><b className="block truncate">{m.nome}</b><span className="text-xs text-slate-500">{m.titulo} · {m.layout === "centro" ? "centralizado" : "à esquerda"}{m.frente_verso ? " · frente e verso" : ""}</span></div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setEditando(m)}>Editar</DropdownMenuItem>
                    <DropdownMenuItem className="text-rose-600" onSelect={() => apagar(m)}>Excluir</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        ) : (
          <div className="trn-lateral" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)" }}>
            <div className="trn-form">
              <div className="grupo">
                <h4><Award className="mr-1 inline h-4 w-4" /> {editando.id ? "Editar modelo de certificado" : "Novo modelo de certificado"}</h4>
                <div className="grid gap-3">
                  <div className="campo"><label>Nome do modelo *</label><Input value={editando.nome ?? ""} onChange={(e) => set({ nome: e.target.value })} /></div>
                  <div className="campo"><label>Título do certificado *</label><Input value={editando.titulo ?? ""} onChange={(e) => set({ titulo: e.target.value })} /></div>
                  <div className="campo"><label>Texto superior</label><Textarea rows={2} value={editando.texto_superior ?? ""} onChange={(e) => set({ texto_superior: e.target.value })} /></div>
                  <div className="campo"><label>Texto inferior</label><Textarea rows={2} value={editando.texto_inferior ?? ""} onChange={(e) => set({ texto_inferior: e.target.value })} />
                    <div className="ajuda">Use <code>${"{curso}"}</code> para o nome do curso e <code>${"{data}"}</code> para a data de emissão.</div></div>
                </div>
              </div>
              <div className="grupo">
                <h4>O que exibir</h4>
                <div className="grid gap-2 sm:grid-cols-2 text-sm">
                  {([
                    ["exibir_nome_negocio", "Exibir nome do negócio"], ["exibir_logo", "Exibir logotipo do negócio"], ["exibir_cnpj", "Exibir CNPJ"],
                    ["exibir_carga_horaria", "Exibir carga horária"], ["exibir_qr", "Exibir QR Code de validação"], ["exibir_documento", "Exibir documento do aluno (se cadastrado)"],
                    ["frente_verso", "Emitir frente e verso"], ["verso_somente_modulos", "Somente título dos módulos (verso)"],
                  ] as [keyof CertificadoModelo, string][]).map(([k, r]) => (
                    <label key={k} className="flex items-center gap-2"><Switch checked={!!editando[k]} onCheckedChange={(v) => set({ [k]: v } as any)} /> {r}</label>
                  ))}
                </div>
              </div>
              {editando.frente_verso && (
                <div className="grupo">
                  <h4>Conteúdo do verso</h4>
                  <div className="campo"><label>Título do verso</label><Input value={editando.verso_titulo ?? ""} onChange={(e) => set({ verso_titulo: e.target.value })} /></div>
                  <div className="campo mt-3"><label>Imagem de fundo do verso</label>
                    <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted"><ImagePlus className="mr-1 inline h-4 w-4" /> {subindo === "fundo_verso_path" ? "Enviando…" : "Selecionar"}<input type="file" accept="image/*" className="hidden" onChange={(e) => subir(e.target.files?.[0] ?? null, "fundo_verso_path")} /></label>
                    {editando.fundo_verso_path && <button type="button" className="ml-2 text-xs text-rose-600" onClick={() => set({ fundo_verso_path: null })}>remover</button>}
                    <div className="ajuda">Sem imagem, usa a mesma da frente.</div></div>
                </div>
              )}
              <div className="grupo">
                <h4>Layout e fundo</h4>
                <div className="mb-3 flex gap-2">
                  {(["esquerda", "centro"] as const).map((l) => <button key={l} type="button" onClick={() => set({ layout: l })} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${editando.layout === l ? "border-orange-500 bg-orange-50 text-orange-700" : ""}`}>{l === "centro" ? "Centralizado" : "Alinhado à esquerda"}</button>)}
                </div>
                <div className="campo"><label>Imagem de fundo (frente)</label>
                  <label className="cursor-pointer rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-muted"><ImagePlus className="mr-1 inline h-4 w-4" /> {subindo === "fundo_path" ? "Enviando…" : "Selecionar"}<input type="file" accept="image/*" className="hidden" onChange={(e) => subir(e.target.files?.[0] ?? null, "fundo_path")} /></label>
                  {editando.fundo_path && <button type="button" className="ml-2 text-xs text-rose-600" onClick={() => set({ fundo_path: null })}>remover</button>}
                  <div className="ajuda">A4 paisagem (297 × 210 mm). Sem imagem, o fundo é neutro.</div></div>
              </div>
              <div className="flex gap-2">
                <AcessoGate menu={MENU.certificados} acao={editando.id ? "alterar" : "incluir"} fallback={<p className="text-xs text-muted-foreground">Você pode ver, mas não tem a ação de salvar.</p>}>
                  <Button disabled={salvar.isPending || !!subindo} onClick={gravar}><Save className="mr-2 h-4 w-4" /> {editando.id ? "Atualizar informações" : "Criar modelo"}</Button>
                </AcessoGate>
                <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
                {editando.id && <AcessoGate menu={MENU.certificados} acao="excluir"><Button variant="ghost" className="text-rose-600" onClick={() => apagar(editando as CertificadoModelo)}><Trash2 className="mr-1 h-4 w-4" /> Excluir</Button></AcessoGate>}
              </div>
            </div>
            <div className="space-y-3">
              <div className="trn-card"><h3>Pré-visualização</h3><div className="sub">Com dados de exemplo.</div><CertificadoFrente modelo={modeloPreview} dados={EXEMPLO} /></div>
              {editando.frente_verso && <div className="trn-card"><h3>Pré-visualização do verso</h3><div className="sub" /><CertificadoVerso modelo={modeloPreview} dados={EXEMPLO} /></div>}
            </div>
          </div>
        )}
      </AcessoGate>
    </div>
  );
}
