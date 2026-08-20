import { useEffect } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { NovidadesPainel } from "@/components/novidades/NovidadesPainel";
import { useNovidades } from "@/hooks/useNovidades";

/**
 * /app/novidades — o changelog inteiro.
 *
 * A rota fica FORA de app_menu de propósito: rota sem entrada lá é sempre
 * aberta (RouteGuard/Sidebar), e ler novidade é para todo mundo. O que é
 * restrito é PUBLICAR, e isso o painel resolve pelo flag
 * "Pode criar novidades do sistema" (Administração › Acesso por Usuário).
 *
 * Abrir a página conta como ler: é a lista inteira na frente da pessoa.
 */
export default function Novidades() {
  const { marcarLidas, novidades } = useNovidades();

  useEffect(() => { void marcarLidas(); }, [marcarLidas]);

  return (
    <div className="nov-pagina">
      <PageHeader
        title="Novidades do Sistema"
        subtitle="Tudo o que mudou no ERP Nascimento — novos módulos, melhorias e ajustes."
        module="Sistemas"
        breadcrumb={["Novidades do Sistema"]}
      />
      <NovidadesPainel completo />
      {novidades.length > 0 && (
        <p style={{ textAlign: "center", fontSize: ".72rem", color: "#cbd5e1", margin: "14px 0 4px" }}>
          {novidades.length} {novidades.length === 1 ? "publicação" : "publicações"} no histórico.
        </p>
      )}
    </div>
  );
}
