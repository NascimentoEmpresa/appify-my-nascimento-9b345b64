import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useDemoMode } from "@/context/DemoModeContext";
import { useMustChangePassword } from "@/hooks/useMustChangePassword";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { isDemo } = useDemoMode();
  const { mustChange, loading: mcLoading } = useMustChangePassword(user?.id);
  const location = useLocation();

  // Only block on the very first auth check (loading=true once at startup).
  // mcLoading (must-change-password) must NOT unmount children — auth events fire on
  // every navigation and briefly set mcLoading=true, which would reset Lista filters.
  // The mustChange redirect below fires as soon as the check resolves (< 1 frame).
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Carregando sessão…
      </div>
    );
  }

  if (!user && !isDemo) {
    return <Navigate to="/login" replace />;
  }

  // Usuário real precisa trocar a senha (reset feito por admin).
  // Sessão anônima (encarregado externo) não tem senha para trocar — e nem
  // linha em profiles com must_change_password —, então nunca cai aqui.
  if (user && !user.is_anonymous && !isDemo && !mcLoading && mustChange && location.pathname !== "/trocar-senha") {
    return <Navigate to="/trocar-senha" replace />;
  }

  return <>{children}</>;
}
