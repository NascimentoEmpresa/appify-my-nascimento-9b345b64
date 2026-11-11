// Arquivo: supabase/functions/admin-create-user/index.ts
// FASE 2 / EDGE FUNCTION
// Cria auth.users + profiles + user_roles sem lista fixa de perfis.
// Perfis válidos são lidos dinamicamente de public.perfil_metadata.
// Requer chamador autenticado e role admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
// O nome do setor como está em Administração › Setores (user_setor).
const SETOR_ENCARREGADOS = "Encarregados";

interface Body {
  email: string;
  password: string;
  display_name?: string | null;
  cargo?: string | null;
  empresa_id?: string | null;
  roles?: string[];
  // Setores (Administração › Setores). Desde 11/11/2026 gravados AQUI (antes a
  // tela gravava em user_setor depois): quem só cria Encarregados não tem a
  // escrita em user_setor, e a trava do setor tem que ser do servidor.
  setores?: string[];
  telefone?: string | null;
  // O que a pessoa faz na empresa (profiles.bio, a mesma de Meu Perfil).
  bio?: string | null;
  // Onde a pessoa fica no organograma (mig 20261104009000). A tela de Usuários
  // sempre manda; fica opcional aqui porque scripts de carga criam conta sem
  // saber a posição — quem entra assim aparece nas Pendências do organograma.
  organograma?: {
    empregado_id?: number | null;
    parent_id?: string | null;
    topo?: boolean;
    do_grupo?: boolean;
    funcao?: string | null;
    posto?: string | null;
    contratos?: { empresa: number; filial: number }[] | null;
  } | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeTextOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Normaliza pra dígitos puros com DDI 55 na frente (ex: "(51) 99659-4681" →
// "5551996594681"). Se já vier com 12-13 dígitos começando com 55, mantém.
function normalizeTelefone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  return `55${digits}`;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    ),
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
    return jsonResponse({ error: "Variáveis de ambiente Supabase não configuradas." }, 500);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Não autenticado" }, 401);
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "Sessão inválida" }, 401);
    }

    const callerId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // 11/11/2026 (mig 20261111260000): além da Administração (incluir), quem
    // tem "PODE CRIAR LOGIN (só Encarregados)" cria usuário — mas só do setor
    // Encarregados, com o perfil básico. Sem a migration, a regra antiga.
    let escopo: "tudo" | "encarregados" | null = null;
    const regua = await admin.rpc("login_pode_criar", { _quem: callerId });
    if (!regua.error) {
      escopo = regua.data === "tudo" || regua.data === "encarregados" ? regua.data : null;
    } else {
      const { data: podeCriar, error: roleErr } = await admin.rpc("can_access", {
        _user: callerId,
        _menu: "administracao",
        _acao: "incluir",
      });
      if (roleErr) return jsonResponse({ error: roleErr.message }, 500);
      escopo = podeCriar ? "tudo" : null;
    }
    if (!escopo) {
      return jsonResponse({ error: "Apenas administradores podem criar usuários." }, 403);
    }
    const soEncarregados = escopo === "encarregados";

    let body: Body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "JSON inválido" }, 400);
    }

    const email = normalizeEmail(body.email);
    const password = typeof body.password === "string" ? body.password : "";
    const display_name = normalizeTextOrNull(body.display_name);
    const cargo = normalizeTextOrNull(body.cargo);
    const telefone = normalizeTelefone(body.telefone);
    const empresa_id = normalizeTextOrNull(body.empresa_id);
    // Quem só cria Encarregados não escolhe perfil nem setor.
    const requestedRoles = soEncarregados ? [] : uniqueStrings(body.roles);
    const setores = soEncarregados ? [SETOR_ENCARREGADOS] : uniqueStrings(body.setores);
    if (soEncarregados && uniqueStrings(body.setores).some((s) => s.toUpperCase() !== SETOR_ENCARREGADOS.toUpperCase())) {
      return jsonResponse({ error: "Com a permissão \"Pode criar login\" só dá para criar usuário do setor Encarregados." }, 403);
    }
    const bio = normalizeTextOrNull(body.bio)?.slice(0, 500) ?? null;
    const organograma = body.organograma ?? null;

    if (organograma && !organograma.parent_id && !organograma.topo) {
      return jsonResponse({ error: "Diga a quem o usuário se reporta no organograma (ou marque que fica no topo)." }, 400);
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "E-mail inválido" }, 400);
    }

    if (!password || password.length < 6) {
      return jsonResponse({ error: "Senha deve ter ao menos 6 caracteres" }, 400);
    }

    const { data: perfilRows, error: perfilErr } = await admin
      .from("perfil_metadata")
      .select("role")
      .order("role", { ascending: true });

    if (perfilErr) {
      return jsonResponse({ error: `Erro ao carregar perfis: ${perfilErr.message}` }, 500);
    }

    const validRoles = new Set((perfilRows ?? []).map((row: { role: string }) => row.role));
    const defaultRole = validRoles.has("usuario") ? "usuario" : null;
    const rolesToApply = requestedRoles.length > 0 ? requestedRoles : defaultRole ? [defaultRole] : [];
    const invalidRoles = rolesToApply.filter((role) => !validRoles.has(role));

    if (invalidRoles.length > 0) {
      return jsonResponse({
        error: "Perfil inválido informado.",
        invalid_roles: invalidRoles,
        valid_roles: Array.from(validRoles).sort(),
      }, 400);
    }

    if (rolesToApply.length === 0) {
      return jsonResponse({
        error: "Nenhum perfil válido disponível em perfil_metadata. Cadastre ao menos o perfil usuario ou informe perfis válidos.",
      }, 400);
    }

    if (empresa_id) {
      const { data: empresa, error: empresaErr } = await admin
        .from("empresas")
        .select("id")
        .eq("id", empresa_id)
        .maybeSingle();

      if (empresaErr) {
        return jsonResponse({ error: `Erro ao validar empresa: ${empresaErr.message}` }, 500);
      }

      if (!empresa) {
        return jsonResponse({ error: "Empresa informada não existe." }, 400);
      }
    }

    // Cargo sai da lista de Configurações do ERP › Cargos (SIS-2026-0851,
    // 10/11/2026): profiles.cargo virou FK de "CARGO_CATALOGO". Confere AQUI,
    // antes de criar o login — se a FK recusasse só no upsert de profiles, o
    // usuário já existiria no auth (a mesma origem dos perfis órfãos de 07/2026).
    if (cargo) {
      const { data: cargoOk, error: cargoErr } = await admin
        .from("CARGO_CATALOGO")
        .select("nome")
        .eq("nome", cargo)
        .maybeSingle();
      // Sem a tabela (migration ainda pendente) também não há FK: segue como antes.
      const semCatalogo = !!cargoErr && (cargoErr.code === "42P01" || cargoErr.code === "PGRST205");
      if (cargoErr && !semCatalogo) {
        return jsonResponse({ error: `Erro ao validar cargo: ${cargoErr.message}` }, 500);
      }
      if (!semCatalogo && !cargoOk) {
        return jsonResponse({ error: `O cargo "${cargo}" não está na lista. Escolha um da lista ou cadastre em Configurações do ERP › Cargos.` }, 400);
      }
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        display_name: display_name ?? email.split("@")[0],
      },
    });

    if (createErr || !created?.user) {
      const msg = createErr?.message ?? "Falha ao criar usuário";
      const status = /already|registered|exists/i.test(msg) ? 409 : 400;
      return jsonResponse({ error: msg }, status);
    }

    const newUserId = created.user.id;

    const rollbackCreatedUser = async () => {
      try {
        // O trigger on_auth_user_created já criou profiles + user_roles('visitante')
        // pra este id — como profiles.id não tem FK real pra auth.users, apagar só
        // o auth user deixaria essas 2 linhas órfãs pra trás (foi exatamente assim
        // que os perfis órfãos de teste apareceram). Limpa os 3 antes de apagar.
        await admin.from("user_roles").delete().eq("user_id", newUserId);
        await admin.from("user_setor").delete().eq("user_id", newUserId);
        await admin.from("user_empresa").delete().eq("user_id", newUserId);
        await admin.from("profiles").delete().eq("id", newUserId);
        await admin.auth.admin.deleteUser(newUserId);
      } catch {
        console.error("Falha ao executar rollback do usuário criado", newUserId);
      }
    };

    // IMPORTANTE: o vínculo em user_empresa precisa existir ANTES de gravar
    // empresa_atual_id em profiles — o trigger trg_profiles_valida_empresa_atual
    // (BEFORE UPDATE OF empresa_atual_id) exige user_pode_atuar_empresa(...), que
    // olha pra user_empresa. Como on_auth_user_created já criou a linha de profiles
    // (com empresa_atual_id NULL) no createUser acima, o upsert de profiles logo
    // abaixo já é um UPDATE de verdade — se a ordem fosse invertida, o trigger
    // sempre rejeitaria por "Usuário sem vínculo com a empresa selecionada".
    if (empresa_id) {
      const { error: userEmpresaErr } = await admin
        .from("user_empresa")
        .upsert({
          user_id: newUserId,
          empresa_id,
          is_default: true,
          created_by: callerId,
        }, { onConflict: "user_id,empresa_id" });

      if (userEmpresaErr) {
        await rollbackCreatedUser();
        return jsonResponse({ error: `Erro ao vincular empresa ao usuário: ${userEmpresaErr.message}` }, 500);
      }
    }

    const { error: profileErr } = await admin
      .from("profiles")
      .upsert({
        id: newUserId,
        email,
        display_name,
        cargo,
        ...(bio ? { bio } : {}),
        empresa_id,
        empresa_atual_id: empresa_id,
        telefone,
        must_change_password: true,
        ativo: true,
      }, { onConflict: "id" });

    if (profileErr) {
      await rollbackCreatedUser();
      return jsonResponse({ error: `Erro ao gravar profile: ${profileErr.message}` }, 500);
    }

    // on_auth_user_created já concedeu 'visitante' automaticamente — remove antes
    // de aplicar os perfis pedidos, senão um insert de 'visitante' explícito (a
    // opção existe no formulário) bateria de frente com UNIQUE(user_id, role).
    const { error: cleanupRoleErr } = await admin
      .from("user_roles")
      .delete()
      .eq("user_id", newUserId);

    if (cleanupRoleErr) {
      await rollbackCreatedUser();
      return jsonResponse({ error: `Erro ao limpar perfil padrão: ${cleanupRoleErr.message}` }, 500);
    }

    const { error: rolesErr } = await admin
      .from("user_roles")
      .insert(rolesToApply.map((role) => ({ user_id: newUserId, role })));

    if (rolesErr) {
      await rollbackCreatedUser();
      return jsonResponse({ error: `Erro ao vincular perfis: ${rolesErr.message}` }, 500);
    }

    // Setor (11/11/2026): gravado aqui, com a service role. Para quem só cria
    // Encarregados, é sempre e só o setor Encarregados.
    if (setores.length > 0) {
      const { error: setorErr } = await admin
        .from("user_setor")
        .insert(setores.map((setor) => ({ user_id: newUserId, setor })));
      if (setorErr) {
        // Sem o setor o login de Encarregado ficaria sem o recorte do setor: desfaz.
        if (soEncarregados) {
          await rollbackCreatedUser();
          return jsonResponse({ error: `Erro ao gravar o setor: ${setorErr.message}` }, 500);
        }
        console.error("Erro ao gravar setores do usuário criado", newUserId, setorErr.message);
      }
    }

    // Por último: é a etapa que pode recusar por regra de negócio (colaborador
    // já vinculado a outro login, superior que fecharia ciclo). Recusou, desfaz
    // o usuário e o operador corrige sem ficar com conta pela metade.
    if (organograma) {
      const { error: orgErr } = await admin.rpc("organograma_salvar_interno", {
        p_no: null,
        p_empregado: organograma.empregado_id ?? null,
        p_user: newUserId,
        p_parent: organograma.topo ? null : organograma.parent_id ?? null,
        p_topo: !!organograma.topo,
        p_funcao: normalizeTextOrNull(organograma.funcao) ?? "",
        p_posto: organograma.empregado_id ? organograma.posto ?? "" : null,
        p_contratos: organograma.contratos ?? [],
        p_autor: callerId,
        p_do_grupo: !!organograma.do_grupo,
      });

      if (orgErr) {
        // PGRST202 = a função ainda não existe: as Edge Functions sobem ANTES
        // das migrations no merge (cluster_pos_merge.yml), e uma migration pode
        // ficar pendente por lock. Criar usuário não para por isso; a pessoa
        // aparece nas Pendências quando a migration entrar.
        if (orgErr.code !== "PGRST202") {
          await rollbackCreatedUser();
          return jsonResponse({ error: orgErr.message }, 400);
        }
        console.error("organograma_salvar_interno ainda não existe; usuário criado sem posição", newUserId);
      }
    }

    return jsonResponse({
      ok: true,
      user_id: newUserId,
      roles: rolesToApply,
      empresa_id,
      setores,
      setores_gravados: true,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonResponse({ error: msg }, 500);
  }
});

