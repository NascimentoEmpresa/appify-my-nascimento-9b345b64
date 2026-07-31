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
  | "ver_tudo" | "ver_proprias" | "ver_setor" | "criar_setor" | "ver_lixeira";

const VIEW_CAPS: FormCap[] = ["ver_tudo", "ver_proprias"];

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
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user) { setCaps(new Set()); setSetoresVer(new Set()); setSetoresCriar(new Set()); setLoading(false); return; }
    const uRes = await (supabase as any).from("CS_FORM_ACESSOS")
      .select("papel, setor").eq("user_id", user.id).neq("papel", "dashboard");
    const linhas = uRes.data ?? [];
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
  return { can, canVerAlguma, soProprias, canVerSetor, canCriarSetor, setoresVer, setoresCriar, setor, loading, reload: carregar };
}
