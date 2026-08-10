import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useConcluirVinculoDiscord } from "@/hooks/useVinculoDiscord";

/**
 * Página de retorno do Discord.
 *
 * O usuário só passa por aqui de relance: entrega o `code` para a Edge
 * Function e volta para onde estava. Existe como rota própria porque o
 * Discord exige uma URL de retorno fixa e registrada.
 */
export default function DiscordCallback() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const concluir = useConcluirVinculoDiscord();
  const [erro, setErro] = useState<string | null>(null);
  // O React 18 monta duas vezes em dev; sem esta trava o `code` seria trocado
  // duas vezes e a segunda falharia, mostrando erro num vínculo que deu certo.
  const jaRodou = useRef(false);

  const voltar = () => {
    const destino = sessionStorage.getItem("discord_voltar_para") || "/app/meu-perfil";
    sessionStorage.removeItem("discord_voltar_para");
    nav(destino, { replace: true });
  };

  useEffect(() => {
    if (jaRodou.current) return;
    jaRodou.current = true;

    const negado = params.get("error");
    if (negado) {
      setErro(
        negado === "access_denied"
          ? "Você cancelou a autorização no Discord."
          : `O Discord recusou: ${negado}`,
      );
      return;
    }

    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setErro("O Discord não devolveu os dados esperados.");
      return;
    }

    concluir.mutateAsync({ code, state })
      .then(() => setTimeout(voltar, 1200))
      .catch((e: any) => setErro(e?.message ?? "Não foi possível concluir o vínculo."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md p-8 text-center">
        {!erro && concluir.isSuccess && (
          <>
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 animate-check-pop text-emerald-500" />
            <h1 className="font-semibold text-foreground">Discord vinculado</h1>
            <p className="mt-1 text-sm text-muted-foreground">Levando você de volta...</p>
          </>
        )}

        {!erro && !concluir.isSuccess && (
          <>
            <Loader2 className="mx-auto mb-3 h-10 w-10 animate-spin text-primary" />
            <h1 className="font-semibold text-foreground">Concluindo o vínculo</h1>
            <p className="mt-1 text-sm text-muted-foreground">Um instante.</p>
          </>
        )}

        {erro && (
          <>
            <XCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <h1 className="font-semibold text-foreground">Não deu certo</h1>
            <p className="mt-1 text-sm text-muted-foreground">{erro}</p>
            <Button className="mt-4" onClick={voltar}>Voltar ao meu perfil</Button>
          </>
        )}
      </Card>
    </div>
  );
}
