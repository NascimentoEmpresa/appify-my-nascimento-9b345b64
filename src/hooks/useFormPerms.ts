import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";

// =====================================================================
// NASCIMENTO FORMULARIOS - capacidades do usuario logado
// Espelha a RLS (public.cs_form_cap): 'responder' e o default de todo
// autenticado; as demais capacidades vem de CS_FORM_ACESSOS por USUARIO -
// SEM bypass de admin (admin tambem depende dos grants aqui). Usado so p/
// mostrar/esconder botoes - a autoridade continua sendo a RLS no banco.
// =====================================================================

export type FormCap =
  | "editar_criar" | "responder" | "encerrar_excluir"
  | "ver_tudo" | "ver_proprias" | "ver_setor" | "criar_setor" | "ver_lixeira"
  | "diagnostico_feedback";

const VIEW_CAPS: FormCap[] = ["ver_tudo", "ver_proprias"];

/** Papel marcador que liga a regra propria do formulario (nao e capacidade). */
const MARCADOR_FORM = "ver_regra_form";
const CAPS_VER = ["ver_tudo", "ver_proprias", "ver_setor"];

/** O que esta ligado para o usuario DENTRO de um formulario. */
export interface RegraForm { caps: Set<string>; setores: Set<string> }

export function useFormPerms() {
  const { user } = useAuth();
  const { empregado } = useVinculoEmpregado();
  const setor = empregado?.setor || null;  // usado por Formularios (setores_acesso), nao por permissao
  const [caps, setCaps] = useState<Set<string>>(new Set());
  // Setores cujas respostas o usuario pode ver (papel 'ver_setor'), normalizados.
  const [setoresVer, setSetoresVer] = useState<Set<string>>(new Set());
  // Setores dos quais o usuario e DONO: cria formularios e ve as respostas
  // deles (papel 'criar_setor'), normalizados.
  const [setoresCriar, setSetoresCriar] = useState<Set<string>>(new Set());
  // Regra POR FORMULARIO: formulario_id -> o que vale la dentro. Formulario
  // presente aqui tem regra propria, que SUBSTITUI a geral (espelha
  // public.cs_form_regra_propria / cs_form_cap_ver, migration 20260921000002).
  const [regrasForm, setRegrasForm] = useState<Map<string, RegraForm>>(new Map());
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user) { setCaps(new Set()); setSetoresVer(new Set()); setSetoresCriar(new Set()); setRegrasForm(new Map()); setLoading(false); return; }
    const uRes = await (supabase as any).from("CS_FORM_ACESSOS")
      .select("papel, setor, formulario_id").eq("user_id", user.id).neq("papel", "dashboard");
    const todas = uRes.data ?? [];
    // Os grants gerais sao os SEM formulario; os com formulario montam o mapa
    // de regras proprias. Misturar os dois faria a tela concluir que a pessoa
    // ve tudo em todo lugar porque ve tudo em UM formulario.
    const linhas = todas.filter((r: any) => !r.formulario_id);
    const porForm = new Map<string, RegraForm>();
    todas
      .filter((r: any) => r.formulario_id && (r.papel === MARCADOR_FORM || CAPS_VER.includes(r.papel)))
      .forEach((r: any) => {
        const id = String(r.formulario_id);
        const atual = porForm.get(id) ?? { caps: new Set<string>(), setores: new Set<string>() };
        if (r.papel === "ver_setor" && r.setor) atual.setores.add(String(r.setor).trim().toUpperCase());
        else if (r.papel !== MARCADOR_FORM) atual.caps.add(r.papel);
        porForm.set(id, atual);
      });
    setRegrasForm(porForm);
    const setoresDe = (papel: string) => new Set<string>(linhas
      .filter((r: any) => r.papel === papel && r.setor)
      .map((r: any) => String(r.setor).trim().toUpperCase()));
    setCaps(new Set<string>(linhas.map((r: any) => r.papel)));
    setSetoresVer(setoresDe("ver_setor"));
    setSetoresCriar(setoresDe("criar_setor"));
    setLoading(false);
  }, [user]);
  useEffect(() => { carregar(); }, [carregar]);

  // Formularios e governado 100% pelos grants POR USUARIO - inclusive admin.
  // 'responder' segue liberado por padrao a todo autenticado (Abrir/responder).
  const can = (c: FormCap) => c === "responder" || caps.has(c);
  // Ve alguma resposta? ver_tudo, ver_proprias, algum setor liberado (ver_setor)
  // OU dono de algum setor (criar_setor ve as respostas dos formularios dele).
  const canVerAlguma = VIEW_CAPS.some((c) => caps.has(c)) || setoresVer.size > 0 || setoresCriar.size > 0;
  // Escopo efetivo "so as proprias": tem ver_proprias e nada mais amplo.
  const soProprias = caps.has("ver_proprias") && !caps.has("ver_tudo") && setoresVer.size === 0 && setoresCriar.size === 0;
  // Espelha public.cs_form_cap_setor (a autoridade e a RLS).
  const canVerSetor = (s?: string | null) =>
    !!s && setoresVer.has(String(s).trim().toUpperCase());
  // Espelha public.cs_form_pode_criar_setor: dono do setor do formulario.
  const canCriarSetor = (s?: string | null) =>
    !!s && setoresCriar.has(String(s).trim().toUpperCase());
  // -- Por formulario ------------------------------------------------
  // A autoridade continua sendo a RLS; estes helpers so evitam que a tela
  // prometa (ou esconda) o que o banco vai decidir de outro jeito.
  const temRegraNoForm = (formId?: string | null) => !!formId && regrasForm.has(String(formId));
  /** A capacidade que VALE neste formulario: a propria dele, ou a geral. */
  const canNoForm = (formId: string | null | undefined, c: FormCap) =>
    temRegraNoForm(formId) ? !!regrasForm.get(String(formId))?.caps.has(c) : can(c);
  /** Escopo efetivo "so as proprias" DENTRO do formulario. */
  const soPropriasNoForm = (formId?: string | null) => {
    if (!temRegraNoForm(formId)) return soProprias;
    const r = regrasForm.get(String(formId))!;
    return r.caps.has("ver_proprias") && !r.caps.has("ver_tudo") && r.setores.size === 0;
  };
  const canVerSetorNoForm = (formId: string | null | undefined, s?: string | null) =>
    temRegraNoForm(formId)
      ? !!s && !!regrasForm.get(String(formId))?.setores.has(String(s).trim().toUpperCase())
      : canVerSetor(s);
  /** Ve alguma resposta DESTE formulario? (esconde abas e botoes) */
  const canVerAlgumaNoForm = (formId?: string | null) => {
    if (!temRegraNoForm(formId)) return canVerAlguma;
    const r = regrasForm.get(String(formId))!;
    return r.caps.size > 0 || r.setores.size > 0;
  };

  return {
    can, canVerAlguma, soProprias, canVerSetor, canCriarSetor, setoresVer, setoresCriar, setor, loading,
    regrasForm, temRegraNoForm, canNoForm, soPropriasNoForm, canVerSetorNoForm, canVerAlgumaNoForm,
    reload: carregar,
  };
}
