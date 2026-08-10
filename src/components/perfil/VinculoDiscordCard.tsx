import { useState } from "react";
import { BadgeCheck, CircleAlert, Link2, Loader2, Trash2, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  useDesvincularDiscord,
  useIniciarVinculoDiscord,
  useMeuDiscord,
  useVincularDiscordManual,
} from "@/hooks/useVinculoDiscord";

/** Ícone do Discord — a lucide não tem, então vai o SVG da marca. */
function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.317 4.369A19.79 19.79 0 0 0 16.558 3c-.164.293-.355.687-.487.998a18.27 18.27 0 0 0-4.142 0A12.65 12.65 0 0 0 11.44 3a19.74 19.74 0 0 0-3.76 1.369C4.29 9.058 3.37 13.63 3.83 18.138a19.9 19.9 0 0 0 5.993 3.03c.484-.66.915-1.362 1.286-2.099a12.9 12.9 0 0 1-2.025-.972c.17-.124.336-.254.496-.388a14.2 14.2 0 0 0 12.084 0c.162.135.328.264.496.388-.646.382-1.325.708-2.03.973.372.736.802 1.438 1.287 2.098a19.87 19.87 0 0 0 5.996-3.03c.54-5.223-.924-9.754-3.096-13.769ZM9.68 15.33c-1.182 0-2.152-1.085-2.152-2.419 0-1.333.95-2.42 2.152-2.42 1.21 0 2.18 1.094 2.16 2.42 0 1.334-.95 2.42-2.16 2.42Zm7.95 0c-1.183 0-2.152-1.085-2.152-2.419 0-1.333.95-2.42 2.152-2.42 1.21 0 2.18 1.094 2.16 2.42 0 1.334-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}

/**
 * Vínculo da conta do Discord, em Meu Perfil.
 *
 * O botão de um clique é o caminho principal porque é o único que PROVA que a
 * conta é de quem clicou. O manual fica visível mas em segundo plano, e o que
 * ele grava aparece marcado como não verificado — quem for disparar
 * notificação depois precisa saber a diferença.
 */
export function VinculoDiscordCard() {
  const vinculo = useMeuDiscord();
  const iniciar = useIniciarVinculoDiscord();
  const manual = useVincularDiscordManual();
  const desvincular = useDesvincularDiscord();

  const [abertoManual, setAbertoManual] = useState(false);
  const [id, setId] = useState("");
  const [email, setEmail] = useState("");

  const v = vinculo.data;

  const salvarManual = async () => {
    await manual.mutateAsync({ discord_id: id, discord_email: email });
    setAbertoManual(false);
    setId(""); setEmail("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DiscordIcon className="h-5 w-5 text-[#5865F2]" />
          Discord
        </CardTitle>
        <CardDescription>
          Vincule sua conta para receber as notificações do ERP no Discord.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {vinculo.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        )}

        {!vinculo.isLoading && !v && (
          <>
            <Button
              onClick={() => iniciar.mutate()}
              disabled={iniciar.isPending}
              className="gap-2 bg-[#5865F2] text-white hover:bg-[#4752C4]"
            >
              {iniciar.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <DiscordIcon className="h-4 w-4" />}
              Vincular com o Discord
            </Button>
            <p className="text-xs text-muted-foreground">
              Você será levado ao Discord para autorizar. Pedimos apenas seu nome de
              usuário e e-mail — nada de ler mensagens ou entrar em servidores.
            </p>

            <Dialog open={abertoManual} onOpenChange={setAbertoManual}>
              <DialogTrigger asChild>
                <Button variant="link" className="h-auto p-0 text-xs text-muted-foreground">
                  Prefiro informar meu ID manualmente
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Informar o Discord manualmente</DialogTitle>
                  <DialogDescription>
                    No Discord, ative Configurações › Avançado › Modo de desenvolvedor.
                    Depois clique com o botão direito no seu nome e escolha "Copiar ID do usuário".
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="discord-id">ID do Discord</Label>
                    <Input
                      id="discord-id"
                      inputMode="numeric"
                      placeholder="Ex.: 284712930487123456"
                      value={id}
                      onChange={(e) => setId(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Só números.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="discord-email">E-mail do Discord</Label>
                    <Input
                      id="discord-email"
                      type="email"
                      placeholder="voce@exemplo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Preenchido à mão, o vínculo fica marcado como não verificado —
                      ninguém confirmou que o ID é seu. Se puder, use o botão de vincular.
                    </span>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setAbertoManual(false)}>Cancelar</Button>
                  <Button onClick={salvarManual} disabled={!id.trim() || manual.isPending}>
                    {manual.isPending ? "Salvando..." : "Salvar"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}

        {v && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
              {v.discord_avatar
                ? <img src={v.discord_avatar} alt="" className="h-10 w-10 rounded-full" />
                : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#5865F2]/10 text-[#5865F2]">
                    <DiscordIcon className="h-5 w-5" />
                  </span>
                )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {v.discord_username ?? "Conta vinculada"}
                  </span>
                  {v.verificado ? (
                    <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      <BadgeCheck className="h-3 w-3" /> Verificado
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                      <CircleAlert className="h-3 w-3" /> Não verificado
                    </span>
                  )}
                </div>
                {v.discord_email && (
                  <p className="truncate text-sm text-muted-foreground">{v.discord_email}</p>
                )}
                <p className="font-mono text-xs text-muted-foreground">{v.discord_id}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!v.verificado && (
                <Button
                  size="sm"
                  onClick={() => iniciar.mutate()}
                  disabled={iniciar.isPending}
                  className="gap-1.5 bg-[#5865F2] text-white hover:bg-[#4752C4]"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Confirmar pelo Discord
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => desvincular.mutate()}
                disabled={desvincular.isPending}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Desvincular
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
