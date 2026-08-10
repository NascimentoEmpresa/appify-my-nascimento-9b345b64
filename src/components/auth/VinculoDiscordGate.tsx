import { useState } from "react";
import { Loader2, X } from "lucide-react";
import { useVinculoEmpregado } from "@/hooks/useVinculoEmpregado";
import {
  useDiscordConfigurado,
  useIniciarVinculoDiscord,
  useMeuDiscord,
} from "@/hooks/useVinculoDiscord";

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3c-.164.293-.355.687-.487.998a18.27 18.27 0 0 0-4.142 0A12.65 12.65 0 0 0 11.44 3a19.74 19.74 0 0 0-3.76 1.369C4.29 9.058 3.37 13.63 3.83 18.138a19.9 19.9 0 0 0 5.993 3.03c.484-.66.915-1.362 1.286-2.099a12.9 12.9 0 0 1-2.025-.972c.17-.124.336-.254.496-.388a14.2 14.2 0 0 0 12.084 0c.162.135.328.264.496.388-.646.382-1.325.708-2.03.973.372.736.802 1.438 1.287 2.098a19.87 19.87 0 0 0 5.996-3.03c.54-5.223-.924-9.754-3.096-13.769ZM9.68 15.33c-1.182 0-2.152-1.085-2.152-2.419 0-1.333.95-2.42 2.152-2.42 1.21 0 2.18 1.094 2.16 2.42 0 1.334-.95 2.42-2.16 2.42Zm7.95 0c-1.183 0-2.152-1.085-2.152-2.419 0-1.333.95-2.42 2.152-2.42 1.21 0 2.18 1.094 2.16 2.42 0 1.334-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}

/**
 * Convite automático para vincular o Discord — mesmo padrão do VinculoGate do
 * cadastro Senior: aparece sozinho enquanto a pessoa não vincular, e some da
 * navegação quando ela diz "agora não" (volta no próximo carregamento).
 *
 * TRÊS COISAS SEGURAM O CONVITE, e cada uma por um motivo:
 *
 *   1. O vínculo Senior vem primeiro. Dois modais empilhados no primeiro login
 *      é hostil, e identidade importa mais que canal de notificação.
 *   2. A integração precisa estar configurada. Convidar todo mundo para um
 *      botão que responderia 503 seria pior do que não convidar.
 *   3. Quem já vinculou nunca mais vê.
 */
export function VinculoDiscordGate() {
  const empregado = useVinculoEmpregado();
  const configurado = useDiscordConfigurado();
  const discord = useMeuDiscord();
  const iniciar = useIniciarVinculoDiscord();
  const [dispensado, setDispensado] = useState(false);

  const esperando = empregado.loading || !empregado.ready || configurado.isLoading || discord.isLoading;
  if (esperando || dispensado) return null;
  if (!empregado.linked) return null;      // o vínculo Senior tem a vez
  if (!configurado.data) return null;      // sem credenciais, não incomoda
  if (discord.data) return null;           // já vinculado

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md animate-rise-in rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <button
          onClick={() => setDispensado(true)}
          className="absolute right-4 top-4 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#5865F2]/10 text-[#5865F2]">
          <DiscordIcon className="h-6 w-6" />
        </div>

        <h2 className="text-lg font-bold text-foreground">Vincule seu Discord</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          É assim que as notificações do ERP vão te encontrar no Discord — aprovações
          pendentes, chamados e prazos.
        </p>

        <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
          <li>· Pedimos apenas seu nome de usuário e e-mail.</li>
          <li>· Nada de ler mensagens nem entrar em servidores.</li>
          <li>· Não cria outra forma de entrar no ERP.</li>
        </ul>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={() => iniciar.mutate()}
            disabled={iniciar.isPending}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#4752C4] disabled:opacity-60"
          >
            {iniciar.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <DiscordIcon className="h-4 w-4" />}
            Vincular com o Discord
          </button>
          <button
            onClick={() => setDispensado(true)}
            className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            Agora não
          </button>
        </div>

        <p className="mt-3 text-center text-xs text-muted-foreground/70">
          Dá para fazer depois em Meu Perfil.
        </p>
      </div>
    </div>
  );
}
