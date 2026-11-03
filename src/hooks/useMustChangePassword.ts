import { useEffect, useState, useCallback } from "react";
import { esquecerMeuPerfil, lerMeuPerfil } from "@/lib/meuPerfil";

export function useMustChangePassword(userId?: string | null) {
  const [mustChange, setMustChange] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkedUserId, setCheckedUserId] = useState<string | null>(null);

  // refetch() vem depois de trocar a senha: aí a leitura tem que ser fresca.
  const fetchFlag = useCallback(async (fresco = false) => {
    if (!userId) {
      setMustChange(false);
      setCheckedUserId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    if (fresco) esquecerMeuPerfil(userId);
    const data = await lerMeuPerfil(userId).catch(() => undefined);
    if (data !== undefined) setMustChange(!!data?.must_change_password);
    setCheckedUserId(userId);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchFlag(); }, [fetchFlag]);

  return { mustChange, loading: loading || (!!userId && checkedUserId !== userId), refetch: () => fetchFlag(true) };
}
