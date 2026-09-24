import { SistemaIndisponivel } from "@/components/layout/SistemaIndisponivel";

/**
 * /404 (24/09/2026, pedido do Pablo): a tela "Sistema temporariamente
 * indisponível" num endereço próprio, pública (fora do login) — para
 * mostrar/apontar para ela sem depender de uma queda real. Sem contador de
 * verificação (aqui não há queda a esperar); o botão leva de volta ao
 * início. O joguinho vem junto, como na queda.
 *
 * Não substitui o `*` (rota inexistente continua no NotFound): dizer
 * "sistema indisponível" para quem só digitou um endereço errado seria
 * informação falsa.
 */
export default function Pagina404() {
  return (
    <SistemaIndisponivel
      modo="tela"
      jogo
      onTentar={() => window.location.assign("/")}
      rotuloTentar="Voltar ao início"
    />
  );
}
