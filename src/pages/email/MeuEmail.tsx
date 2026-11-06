import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { CaixaEmail } from "@/components/email/CaixaEmail";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import { CAIXA_PESSOAL, useContatosEmail } from "@/hooks/useCaixaEmail";
import { sugestoesDosContatos } from "@/lib/email/caixa";

/**
 * Módulo E-mail › Meu E-mail (/app/email) — cada um envia do PRÓPRIO
 * endereço, pela mesma caixa estilo Gmail de Fornecedores.
 *
 * Fase 1 = só envio: a resposta cai na caixa de sempre da pessoa (UOL),
 * porque a mensagem sai do endereço real dela. O endereço é amarrado ao
 * login pela Edge `email-enviar` (ver lá e a mig 20261106010000) — a tela
 * não escolhe o "De".
 *
 * Caixa pessoal: mesmo quem tem o histórico geral (email_admin) vê aqui só as
 * próprias mensagens (filtro por autor); o geral fica em /app/email/remetentes.
 */
export default function MeuEmail() {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const podeVer = can("visualizar", "email", "email");
  const podeEscrever = can("incluir", "email", "email");
  const podeExcluir = can("excluir", "email", "email");
  const podeAdmin = can("visualizar", "email", "email_admin");

  const contatos = useContatosEmail(podeEscrever);
  const sugestoes = useMemo(() => sugestoesDosContatos(contatos.data ?? []), [contatos.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Meu E-mail"
        subtitle="Envie e-mails do seu endereço pelo ERP. As respostas chegam na sua caixa de sempre."
        module="E-mail"
        breadcrumb={["Meu E-mail"]}
        actions={podeAdmin ? (
          <Button variant="outline" asChild>
            <Link to="/app/email/remetentes"><Users className="mr-2 h-4 w-4" /> Remetentes e histórico geral</Link>
          </Button>
        ) : undefined}
      />
      <Card className="h-[calc(100vh-12rem)] min-h-[520px] overflow-hidden p-0">
        <CaixaEmail
          caixa={CAIXA_PESSOAL}
          titulo="Meu E-mail"
          subtitulo={user?.email ?? undefined}
          sugestoes={sugestoes}
          podeVer={podeVer}
          podeEscrever={podeEscrever}
          podeExcluir={podeExcluir}
          autorId={user?.id ?? null}
        />
      </Card>
    </div>
  );
}
