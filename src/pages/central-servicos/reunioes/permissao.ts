import type { Reuniao } from "./types";

type VinculosDeGestao = Pick<Reuniao, "criado_por" | "responsavel_preenchimento_user_id" | "organizador_user_id">;

/** Mesma decisão que a RLS de reuniao_update/reuniao_delete aplica no banco. */
export function podeGerenciarReuniao(
  userId: string | null | undefined,
  reuniao: VinculosDeGestao,
  temAcessoAdmin: boolean,
): boolean {
  if (temAcessoAdmin) return true;
  if (!userId) return false;
  return userId === reuniao.criado_por
    || userId === reuniao.responsavel_preenchimento_user_id
    || userId === reuniao.organizador_user_id;
}
