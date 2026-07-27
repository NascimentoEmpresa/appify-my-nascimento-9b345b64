import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { usePlanoAcaoPermissao } from "@/hooks/usePlanoAcaoPermissao";
import { STATUS_LABELS, STATUS_ORDEM, STATUS_COR, PRIORIDADES, PRIORIDADE_LABEL, VISIBILIDADE_OPTIONS, VISIBILIDADE_LABEL, type VisibilidadeType, TIPO_ACAO_OPTIONS, TIPO_ACAO_LABEL } from "@/types/planoAcao";
import { ForbiddenCard } from "./Lista";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Paperclip, Download } from "lucide-react";
import { useComitesMap } from "@/hooks/useComitesMap";
import { useSetoresEmpresa } from "@/hooks/useSetoresEmpresa";
import { acharUsuarioPorNome } from "@/lib/acharUsuarioPorNome";
import { SETOR_RESPONSAVEL_MAP, normalizeSetorNome } from "@/data/planoAcaoSetorResponsavel";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { useUsuariosEmpresa } from "@/hooks/useUsuariosEmpresa";

// Tipo de Reunião é campo independente de Comitê (não compartilha coluna).
const TIPOS_REUNIAO = ["Reunião Extraordinária", "Reunião Ordinária"];
// Opções sintéticas de Comitê que não vêm da tabela comite — líder é fixo por nome.
const COMITE_LIDER_FIXO: Record<string, string> = { Gestor: "helena nascimento", Sistemas: "iury de jesus silva" };

export default function PlanoAcaoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === "nova";
  const nav = useNavigate();
  const location = useLocation();
  const listSearch = (location.state as any)?.listSearch ?? "";
  const backUrl = `/app/plano-acoes${listSearch}`;
  const qc = useQueryClient();
  const { toast } = useToast();
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;
  const { can, loading: lp } = usePlanoAcaoPermissao();
  const { user } = useAuth();

  const [form, setForm] = useState<any>({
    tipo_acao: "acao",
    titulo: "", problema: "", acao: "", comite: "", tipo_reuniao: "", area: "", setor: "",
    prioridade_normalizada: "media", status_normalizado: "a_definir",
    responsavel_profile_id: null,
    responsavel_nome_origem: "", lider_comite_nome_origem: "", lider_comite_profile_id: null,
    data_inicio_planejado: null,
    data_fim_planejado: null,
    comentarios: "",
    visibilidade: "privado",
  });
  const [usuariosVisibilidade, setUsuariosVisibilidade] = useState<string[]>([]);
  const [historico, setHistorico] = useState<any[]>([]);
  const [comentarios, setComentarios] = useState<any[]>([]);
  const [novoComent, setNovoComent] = useState("");
  const [anexos, setAnexos] = useState<any[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["plano_acao_one", id],
    enabled: !isNew && !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("plano_acao").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const loadExtras = async (planId: string) => {
    const [csRes, hsRes, axRes, visRes] = await Promise.all([
      supabase.from("plano_acao_comentario")
        .select("*")
        .eq("plano_acao_id", planId)
        .order("created_at", { ascending: false }),
      supabase.from("plano_acao_historico")
        .select("*")
        .eq("plano_acao_id", planId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("plano_acao_anexo")
        .select("*")
        .eq("plano_acao_id", planId)
        .order("created_at", { ascending: false }),
      (supabase as any).from("plano_acao_visibilidade_usuario")
        .select("profile_id")
        .eq("plano_acao_id", planId),
    ]);

    setUsuariosVisibilidade(
      ((visRes as any)?.data ?? []).map((r: any) => r.profile_id as string)
    );

    // Busca nomes dos autores e responsáveis referenciados no histórico em lote
    const allItems = [...(csRes.data ?? []), ...(hsRes.data ?? [])];
    const authorIds = allItems.map((x: any) => x.criado_por).filter(Boolean);
    const responsavelIds = (hsRes.data ?? [])
      .filter((h: any) => h.campo === "responsavel_profile_id")
      .flatMap((h: any) => [h.valor_anterior, h.valor_novo].filter(Boolean));
    const ids = [...new Set([...authorIds, ...responsavelIds])];
    const profileMap: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      (profs ?? []).forEach((p: any) => { profileMap[p.id] = p.display_name ?? "Usuário"; });
    }

    setComentarios((csRes.data ?? []).map((c: any) => ({
      ...c, autor: { display_name: profileMap[c.criado_por] ?? "Usuário" },
    })));
    setHistorico((hsRes.data ?? []).map((h: any) => {
      const resolveVal = (uuid: string | null) =>
        uuid ? (profileMap[uuid] ?? uuid) : null;
      const isResp = h.campo === "responsavel_profile_id";
      return {
        ...h,
        autor: { display_name: profileMap[h.criado_por] ?? "Sistema" },
        _valor_anterior: isResp ? resolveVal(h.valor_anterior) : h.valor_anterior,
        _valor_novo: isResp ? resolveVal(h.valor_novo) : h.valor_novo,
      };
    }));
    setAnexos(axRes.data ?? []);
  };

  useEffect(() => {
    if (data) {
      setForm(data);
      loadExtras(data.id);
    }
  }, [data]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const { data: comitesMap = {} } = useComitesMap();
  const comitesReais = useMemo(() => Object.keys(comitesMap).sort((a, b) => a.localeCompare(b, "pt-BR")), [comitesMap]);
  const { data: setoresDisponiveis = [] } = useSetoresEmpresa();

  // Só roda a partir de interação real do usuário com o dropdown de Comitê —
  // por isso a lógica fica no onValueChange, não num useEffect que também
  // dispararia ao carregar uma ação existente. Preenche o líder automático
  // (fixo por nome pras opções "Gestor"/"Sistemas", vindo do cadastro do
  // comitê pros demais) — Setor é campo independente, não reseta mais aqui.
  const handleComiteChange = (v: string) => {
    const novoComite = v === "__none" ? "" : v;
    setForm((f: any) => {
      const next = { ...f, comite: novoComite };
      const nomeLiderFixo = COMITE_LIDER_FIXO[novoComite];
      if (nomeLiderFixo) {
        const achado = acharUsuarioPorNome(usuariosOptions, nomeLiderFixo);
        next.lider_comite_profile_id = achado?.value ?? null;
        next.lider_comite_nome_origem = achado?.label ?? null;
      } else {
        const info = novoComite ? comitesMap[novoComite] : undefined;
        next.lider_comite_profile_id = info?.liderProfileId ?? null;
        next.lider_comite_nome_origem = info?.lider ?? null;
      }
      return next;
    });
  };

  // Setor -> Responsável: setor é a fonte, nunca o contrário. Se o valor
  // escolhido não estiver no mapa fixo, o Responsável não é tocado (é
  // obrigatório e não deve ser limpo por um setor sem mapeamento).
  const handleSetorChange = (v: string) => {
    const novoSetor = v === "__none" ? "" : v;
    setForm((f: any) => {
      const next = { ...f, area: novoSetor };
      const mapeado = SETOR_RESPONSAVEL_MAP[normalizeSetorNome(novoSetor)];
      if (mapeado) {
        const achado = acharUsuarioPorNome(usuariosOptions, mapeado.nome);
        if (achado) {
          next.responsavel_profile_id = achado.value;
          next.responsavel_nome_origem = achado.label;
        }
      }
      return next;
    });
  };

  const _podeEditPre = isNew ? can("criar") : can("editar");
  const { data: usuarios = [], error: errUsuarios } = useUsuariosEmpresa({
    enabled: !lp && can("visualizar") && (_podeEditPre || isNew),
  });

  if (lp) return null;
  if (!can("visualizar")) return <ForbiddenCard />;
  const podeEdit = _podeEditPre;
  const usuariosOptions = usuarios.map((u) => ({
    value: u.id,
    label: u.display_name ?? "(sem nome)",
    hint: u.email ?? undefined,
  }));
  const rpcSemPermissao =
    !!errUsuarios &&
    ((errUsuarios as any)?.code === "42501" ||
      String((errUsuarios as any)?.message ?? "").includes("sem_permissao_para_listar_usuarios_empresa"));

  const uploadFile = async (file: File, planId: string) => {
    const { data: u } = await supabase.auth.getUser();
    const timestamp = Date.now();
    // A key do storage não aceita acentos/espaços ("Invalid key") —
    // sanitiza só o nome usado no path; o nome original fica intacto em nome_arquivo.
    const nomeSanitizado = file.name
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${empresaId}/${planId}/${timestamp}_${nomeSanitizado}`;
    const { error: uploadError } = await supabase.storage.from("anexos").upload(path, file);
    if (uploadError) throw uploadError;
    const { error: dbErr } = await supabase.from("plano_acao_anexo").insert({
      empresa_id: empresaId,
      plano_acao_id: planId,
      bucket: "anexos",
      storage_path: path,
      nome_arquivo: file.name,
      tipo_mime: file.type || "application/octet-stream",
      tamanho_bytes: file.size,
      criado_por: u.user?.id,
    });
    if (dbErr) throw dbErr;
  };

  const handleAnexar = async () => {
    if (!pendingFile || isNew || !id || !empresaId) return;
    setUploading(true);
    try {
      await uploadFile(pendingFile, id);
      setPendingFile(null);
      await loadExtras(id);
      toast({ title: "Arquivo anexado com sucesso" });
    } catch (e: any) {
      toast({ title: "Erro ao anexar", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const salvar = async () => {
    if (!podeEdit || !empresaId) return;
    if (isNew && !form.responsavel_profile_id) {
      return toast({
        title: "Responsável é obrigatório",
        description: "Selecione um responsável para criar a ação.",
        variant: "destructive",
      });
    }
    if (isNew && !form.area) {
      return toast({
        title: "Setor é obrigatório",
        description: "Selecione o setor para criar a ação.",
        variant: "destructive",
      });
    }
    if (isNew) {
      // Para visibilidade específica garante que o criador está na lista,
      // caso contrário ele mesmo perderá acesso ao plano após salvar.
      const usuariosParaRPC = form.visibilidade === "especifico"
        ? Array.from(new Set([...(user?.id ? [user.id] : []), ...usuariosVisibilidade]))
        : null;

      const { data: novoId, error } = await supabase.rpc("criar_plano_acao", {
        _empresa_id: empresaId,
        _titulo: form.titulo,
        _problema: form.problema || null,
        _acao: form.acao || null,
        _comite: form.comite || null,
        _tipo_reuniao: form.tipo_reuniao || null,
        _area: form.area || null,
        _setor: form.setor || null,
        _prioridade_normalizada: form.prioridade_normalizada,
        _status_normalizado: form.status_normalizado,
        _responsavel_profile_id: form.responsavel_profile_id ?? null,
        _responsavel_nome_origem: form.responsavel_nome_origem || null,
        _lider_comite_nome_origem: form.lider_comite_nome_origem || null,
        _lider_comite_profile_id: form.lider_comite_profile_id ?? null,
        _data_inicio_planejado: form.data_inicio_planejado || null,
        _data_fim_planejado: form.data_fim_planejado || null,
        _comentarios: form.comentarios || null,
        _visibilidade: form.visibilidade ?? "privado",
        _usuarios_visibilidade: usuariosParaRPC,
        _tipo_acao: form.tipo_acao ?? "acao",
      } as any);
      if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });
      const ins = { id: novoId as string };
      if (pendingFile) {
        try { await uploadFile(pendingFile, ins.id); } catch {}
        setPendingFile(null);
      }
      toast({ title: "Ação criada" });
      qc.invalidateQueries({ queryKey: ["plano_acoes"] });
      nav(`/app/plano-acoes/${ins.id}`);
    } else {
      const { error } = await supabase.from("plano_acao").update({
        tipo_acao: form.tipo_acao ?? "acao",
        titulo: form.titulo, problema: form.problema, acao: form.acao,
        comite: form.comite, tipo_reuniao: form.tipo_reuniao || null, area: form.area, setor: form.setor || null,
        prioridade_normalizada: form.prioridade_normalizada,
        status_normalizado: form.status_normalizado,
        responsavel_profile_id: form.responsavel_profile_id ?? null,
        responsavel_nome_origem: form.responsavel_nome_origem,
        lider_comite_nome_origem: form.lider_comite_nome_origem,
        lider_comite_profile_id: form.lider_comite_profile_id ?? null,
        comentarios: form.comentarios,
        data_inicio_planejado: form.data_inicio_planejado || null,
        data_fim_planejado: form.data_fim_planejado || null,
        visibilidade: form.visibilidade ?? "privado",
        atualizado_por: user?.id ?? null,
      } as any).eq("id", id!);
      if (error) return toast({ title: "Erro", description: error.message, variant: "destructive" });

      // Sincroniza usuários de visibilidade específica.
      // O criador (user.id) é sempre mantido na lista para que ele não perca
      // acesso ao próprio plano ao editar — a política RLS não tem bypass de criador
      // para visibilidade='especifico'.
      await (supabase as any).from("plano_acao_visibilidade_usuario").delete().eq("plano_acao_id", id!);
      if (form.visibilidade === "especifico") {
        const usuariosComCriador = Array.from(
          new Set([...(user?.id ? [user.id] : []), ...usuariosVisibilidade])
        );
        if (usuariosComCriador.length > 0) {
          await (supabase as any).from("plano_acao_visibilidade_usuario").insert(
            usuariosComCriador.map((uid) => ({
              plano_acao_id: id!,
              empresa_id: empresaId,
              profile_id: uid,
            }))
          );
        }
      }

      toast({ title: "Ação atualizada" });
      qc.invalidateQueries({ queryKey: ["plano_acoes"] });
      qc.invalidateQueries({ queryKey: ["plano_acao_one", id] });
    }
  };

  const concluir = async () => {
    if (!can("editar") || isNew) return;
    const novo = can("aprovar") ? "concluida_validada" : "aguardando_validacao";
    const { error } = await supabase.from("plano_acao").update({ status_normalizado: novo, atualizado_por: user?.id ?? null }).eq("id", id!);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: STATUS_LABELS[novo] }); qc.invalidateQueries({ queryKey: ["plano_acao_one", id] }); }
  };

  const excluir = async () => {
    if (!can("excluir") || isNew) return;
    if (!confirm("Excluir logicamente esta ação?")) return;
    const { error } = await supabase.rpc("excluir_plano_acao", { _id: id! } as any);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { toast({ title: "Excluída" }); nav("/app/plano-acoes"); }
  };

  const addComentario = async () => {
    if (!novoComent.trim() || isNew || !empresaId) return;
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("plano_acao_comentario").insert({
      empresa_id: empresaId, plano_acao_id: id!, comentario: novoComent.trim(), criado_por: u.user?.id,
    });
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else { setNovoComent(""); await loadExtras(id!); }
  };

  const handleDownloadAnexo = async (path: string) => {
    const { data, error } = await supabase.storage.from("anexos").createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      toast({ title: "Erro ao abrir anexo", description: error?.message, variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div>
      <PageHeader
        title={isNew ? "Nova ação" : (form.id_importacao ?? "Detalhe da ação")}
        subtitle={isNew ? "Cadastrar nova ação no plano" : form.titulo ?? form.problema ?? ""}
        module="Plano de Ações"
        breadcrumb={[isNew ? "Nova" : "Detalhe"]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => nav(backUrl)}>← Lista</Button>
            {!isNew && can("editar") && form.status_normalizado !== "concluida_validada" && (
              <Button size="sm" variant="secondary" onClick={concluir}>
                {can("aprovar") ? "Validar conclusão" : "Marcar como concluída"}
              </Button>
            )}
            {podeEdit && <Button size="sm" onClick={salvar} disabled={isNew && (!form.responsavel_profile_id || !form.area)}>Salvar</Button>}
            {!isNew && can("excluir") && (
              <Button size="sm" variant="destructive" onClick={excluir}><Trash2 className="mr-1 h-3.5 w-3.5" />Excluir</Button>
            )}
          </div>
        }
      />
      {isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Tipo de Ação</Label>
              <Select value={form.tipo_acao ?? "acao"} disabled={!podeEdit} onValueChange={v => set("tipo_acao", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIPO_ACAO_OPTIONS.map(t => <SelectItem key={t} value={t}>{TIPO_ACAO_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Título</Label>
              <Input value={form.titulo ?? ""} disabled={!podeEdit} onChange={e => set("titulo", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Problema</Label>
              <Textarea rows={3} value={form.problema ?? ""} disabled={!podeEdit} onChange={e => set("problema", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Ação</Label>
              <Textarea rows={4} value={form.acao ?? ""} disabled={!podeEdit} onChange={e => set("acao", e.target.value)} />
            </div>
            <div>
              <Label>Comitê</Label>
              <Select value={form.comite || "__none"} disabled={!podeEdit} onValueChange={handleComiteChange}>
                <SelectTrigger><SelectValue placeholder="Selecione o comitê" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  <SelectItem value="Gestor">Gestor</SelectItem>
                  <SelectItem value="Sistemas">Sistemas</SelectItem>
                  {comitesReais.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  {form.comite && !comitesReais.includes(form.comite) && !["Gestor", "Sistemas"].includes(form.comite) && (
                    <SelectItem value={form.comite}>{form.comite}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de Reunião</Label>
              <Select value={form.tipo_reuniao || "__none"} disabled={!podeEdit} onValueChange={v => set("tipo_reuniao", v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Selecione o tipo de reunião" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {TIPOS_REUNIAO.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Setor {isNew && <span className="text-destructive">*</span>}</Label>
              <Select value={form.area || "__none"} disabled={!podeEdit} onValueChange={handleSetorChange}>
                <SelectTrigger><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  {setoresDisponiveis.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  {form.area && !setoresDisponiveis.includes(form.area) && <SelectItem value={form.area}>{form.area}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status_normalizado} disabled={!podeEdit} onValueChange={v => set("status_normalizado", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUS_ORDEM.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prioridade</Label>
              <Select value={form.prioridade_normalizada ?? "nao_informada"} disabled={!podeEdit} onValueChange={v => set("prioridade_normalizada", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORIDADES.map(p => <SelectItem key={p} value={p}>{PRIORIDADE_LABEL[p]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Data de início</Label>
              <Input
                type="date"
                value={form.data_inicio_planejado ?? ""}
                disabled={!podeEdit}
                onChange={e => set("data_inicio_planejado", e.target.value || null)}
              />
            </div>
            <div>
              <Label>Data de conclusão</Label>
              <Input
                type="date"
                value={form.data_fim_planejado ?? ""}
                disabled={!podeEdit}
                onChange={e => set("data_fim_planejado", e.target.value || null)}
              />
            </div>
            <div>
              <Label>Responsável {isNew && <span className="text-destructive">*</span>}</Label>
              <SearchableSelect
                value={form.responsavel_profile_id ?? null}
                onChange={(v) => {
                  const opt = usuariosOptions.find((o) => o.value === v);
                  setForm((f: any) => ({ ...f, responsavel_profile_id: v || null, responsavel_nome_origem: opt?.label ?? f.responsavel_nome_origem }));
                }}
                options={usuariosOptions}
                placeholder={rpcSemPermissao ? "Sem permissão para listar usuários" : "Selecione um usuário"}
                disabled={!podeEdit || rpcSemPermissao}
                allowClear={!isNew}
                clearValue=""
              />
              {!form.responsavel_profile_id && form.responsavel_nome_origem && (
                <p className="mt-1 text-xs text-muted-foreground">Responsável pendente de vínculo · texto original: {form.responsavel_nome_origem}</p>
              )}
              {rpcSemPermissao && <p className="mt-1 text-xs text-destructive">Sem permissão para listar usuários desta empresa.</p>}
            </div>
            <div>
              <Label>Líder do Comitê</Label>
              <SearchableSelect
                value={form.lider_comite_profile_id ?? null}
                onChange={(v) => {
                  const opt = usuariosOptions.find((o) => o.value === v);
                  setForm((f: any) => ({ ...f, lider_comite_profile_id: v || null, lider_comite_nome_origem: opt?.label ?? null }));
                }}
                options={usuariosOptions}
                placeholder={rpcSemPermissao ? "Sem permissão para listar usuários" : "Selecione o líder"}
                disabled={!podeEdit || rpcSemPermissao}
                allowClear
                clearValue=""
              />
              {!form.lider_comite_profile_id && form.lider_comite_nome_origem && (
                <p className="mt-1 text-xs text-muted-foreground">Líder pendente de vínculo · texto original: {form.lider_comite_nome_origem}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label>Visibilidade</Label>
              <Select
                value={(form.visibilidade ?? "privado") as VisibilidadeType}
                disabled={!podeEdit}
                onValueChange={v => set("visibilidade", v)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VISIBILIDADE_OPTIONS.map(v => (
                    <SelectItem key={v} value={v}>{VISIBILIDADE_LABEL[v]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(form.visibilidade ?? "privado") === "especifico" && (
                <div className="mt-2 space-y-1">
                  <Label className="text-xs text-muted-foreground">Pessoas que podem ver esta ação</Label>
                  <SearchableMultiSelect
                    value={usuariosVisibilidade}
                    onChange={setUsuariosVisibilidade}
                    options={usuariosOptions}
                    placeholder="Adicionar pessoas..."
                    disabled={!podeEdit || rpcSemPermissao}
                  />
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label>Comentários</Label>
              <Textarea rows={3} value={form.comentarios ?? ""} disabled={!podeEdit} onChange={e => set("comentarios", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Anexar arquivo</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  disabled={!podeEdit}
                  onChange={e => setPendingFile(e.target.files?.[0] ?? null)}
                  className="flex-1 cursor-pointer"
                />
                {!isNew && pendingFile && (
                  <Button size="sm" onClick={handleAnexar} disabled={uploading}>
                    <Paperclip className="mr-1 h-4 w-4" />
                    {uploading ? "Enviando…" : "Anexar"}
                  </Button>
                )}
              </div>
              {isNew && pendingFile && (
                <p className="mt-1 text-xs text-muted-foreground">O arquivo será enviado ao salvar a ação.</p>
              )}
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status & pendências</h3>
            <Badge variant="outline" className={`mb-2 ${STATUS_COR[form.status_normalizado] ?? ""}`}>{STATUS_LABELS[form.status_normalizado] ?? form.status_normalizado}</Badge>
            <div className="space-y-1 text-xs text-muted-foreground">
              {form.pendencia_responsavel && <p>• Sem responsável vinculado</p>}
              {form.pendencia_datas && <p>• Sem datas planejadas</p>}
              {form.pendencia_evidencia && <p>• Aguardando evidência</p>}
              {(form.pendencias_iniciais ?? []).map((p: string) => <p key={p} className="font-mono">• {p}</p>)}
            </div>
            {(form.origem === "importacao_excel" || form.id_importacao || form.linha_csv) && (
              <div className="mt-3 grid gap-2 text-xs">
                <div><span className="text-muted-foreground">ID importação:</span> <span className="font-mono">{form.id_importacao ?? "—"}</span></div>
                <div><span className="text-muted-foreground">Linha CSV:</span> {form.linha_csv ?? "—"}</div>
                <div><span className="text-muted-foreground">Status original:</span> {form.status_original ?? "—"}</div>
              </div>
            )}
          </Card>

          {!isNew && (
            <Card className="p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Anexos</h3>
              <div className="space-y-1">
                {anexos.map(ax => (
                  <div key={ax.id} className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-xs">
                    <span className="truncate max-w-[160px]" title={ax.nome_arquivo}>{ax.nome_arquivo}</span>
                    <button type="button" onClick={() => handleDownloadAnexo(ax.storage_path)} className="ml-2 shrink-0 text-primary hover:underline">
                      <Download className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {anexos.length === 0 && <p className="text-xs text-muted-foreground">Sem anexos.</p>}
              </div>
            </Card>
          )}

          {!isNew && (
            <Card className="p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Encaminhamentos</h3>
              {can("editar") && (
                <div className="mb-2 flex gap-2">
                  <Input placeholder="Novo encaminhamento..." value={novoComent} onChange={e => setNovoComent(e.target.value)} onKeyDown={e => e.key === "Enter" && addComentario()} />
                  <Button size="sm" onClick={addComentario}>Add</Button>
                </div>
              )}
              <div className="max-h-48 space-y-2 overflow-auto">
                {comentarios.map(c => (
                  <div key={c.id} className="rounded border border-border p-2 text-xs">
                    <p>{c.comentario}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      <span className="font-medium">{(c.autor as any)?.display_name ?? "Usuário"}</span>
                      {" · "}{new Date(c.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                ))}
                {comentarios.length === 0 && <p className="text-xs text-muted-foreground">Sem encaminhamentos ainda.</p>}
              </div>
            </Card>
          )}

          {!isNew && (
            <Card className="p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Histórico</h3>
              <div className="max-h-64 space-y-1 overflow-auto text-xs">
                {historico.map(h => (
                  <div key={h.id} className="border-l-2 border-primary/40 pl-2">
                    <p className="font-medium">{h.evento}</p>
                    <p className="text-muted-foreground">{h.campo}: {h._valor_anterior ?? "∅"} → {h._valor_novo ?? "∅"}</p>
                    <p className="text-[10px] text-muted-foreground">
                      <span className="font-medium">{(h.autor as any)?.display_name ?? "Sistema"}</span>
                      {" · "}{new Date(h.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                ))}
                {historico.length === 0 && <p className="text-muted-foreground">Sem alterações registradas.</p>}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
