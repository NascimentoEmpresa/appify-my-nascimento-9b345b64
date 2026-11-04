# Sem busca automática: o ERP só pede ao servidor quando o usuário pede

> Item 5 do pedido de 03/11/2026. Decisão do Eduardo: **sem exceção**. Vale
> para sininho, chat, TV e painel de conferência.

## Por quê, em números

No log do Kong de 03/11, uma aba **parada** fazia ~13 requisições por minuto
(0,22 req/s), e o pico do dia foi de 62 abas logadas. Quase toda a carga fixa
do banco vinha de temporizador, não de gente clicando:

| Rota (automática) | Vezes no dia | Origem |
|---|---|---|
| `malote_despesa_rateio_linha` | 43.574 | lotes em rajada (item 2) |
| `WA_CONTATO` | 31.355 | WhatsApp Inbox, a cada 8 s |
| `rpc/presenca_registrar` | 25.152 | presença online, a cada 60 s por aba |
| `VW_RECRUTAMENTO_CANDIDATOS` | 12.215 | alerta de admissão urgente, a cada 60 s |
| `rpc/presenca_listar` | 8.562 | lista de quem está online, a cada 60 s |
| `rpc/tv_estado` + `rpc/tv_reportar` | 16.382 | TVs, ping de 20 s + batimento por slide |
| `CHAMADO_SISTEMA` (sininho) | 5.791 | a cada 3 min por aba |
| `SISTEMA_NOTIFICACAO_*`, `notificacoes` | ~16 mil | sininhos, a cada 3–5 min |

Nas quedas, cada aba passou a fazer 4 a 6 vezes isso (ver
[capacidade-usuarios.md](capacidade-usuarios.md)).

## A regra

O ERP pede dado novo ao servidor **só** quando a pessoa:

1. **abre uma tela** (ou troca de filtro e de página);
2. **grava algo**: a mutation invalida as consultas afetadas e elas atualizam
   na hora, como sempre foi;
3. **clica em "Atualizar"**: o botão ⟳ na barra do topo, presente em **toda
   tela** (`src/lib/atualizarTela.ts`). Ele relê só o que está na tela aberta;
4. **abre o sininho**: as notificações são relidas ao abrir.

E mais:

- o cache padrão passou de 30 s para 5 min (item 4), então voltar a uma tela
  não refaz as consultas;
- **voltar para a aba do navegador não refaz nada** (`refetchOnWindowFocus:
  false`). Antes, cada alt-tab relia toda consulta da tela com mais de 30 s.

## O que saiu, arquivo por arquivo

### `refetchInterval` (React Query) — 29 ocorrências, 21 arquivos

| Arquivo | Intervalo que tinha |
|---|---|
| `components/layout/Topbar.tsx` (notificações) | 3 min |
| `hooks/useChamadosNotif.ts`, `useReembolsoNotif.ts` | 3 min |
| `hooks/useAprovacoesNotif.ts`, `useJuridicoNotif.ts`, `useDashboardRecrutamento.ts` (×2) | 5 min |
| `hooks/useMaloteExcecao.ts` (×3), `useEfetividade.ts` | 1 min |
| `hooks/usePresencaOnline.ts` (lista) | 1 min |
| `hooks/useTvs.ts` (estado, playlists, prévia, alertas) | 15 s, 1 min, 4 s, 30 s |
| `hooks/useBiEstudio.ts` | configurável por painel |
| `hooks/useExtratorBeneficios.ts`, `pages/sst/PainelCatalogoCa.tsx`, `pages/chamados/ParecerIaChamado.tsx` | 5–8 s enquanto há job em andamento |
| `pages/whatsapp/WhatsAppInbox.tsx` | **8 s** (conversas) e **5 s** (mensagens) |
| `pages/chamados/ChatChamado.tsx` (×2), `BotaoChatChamado.tsx` | 15 s, 30 s |
| `pages/chamados/DashboardChamados.tsx` (×3), `FeedAtualizacoes.tsx` | 1 a 5 min |
| `pages/admin/SmokeTestHelena.tsx` | 15 s |

Também saiu o `refetchOnWindowFocus: true` explícito de 7 hooks de
notificação.

### `setInterval` que ia ao servidor — 12 pontos

| Arquivo | Antes | Agora |
|---|---|---|
| `components/conferencia-ponto/PainelConferenciaPonto.tsx` | 20 s | ao abrir + Atualizar |
| `components/recrutamento/AlertaUrgenteAdmissao.tsx` | 60 s + foco | ao abrir + troca de tela + Atualizar |
| `components/solicitacoes/ConversaSolicitacao.tsx` | 8 s | ao abrir + ao enviar + Atualizar |
| `pages/encarregados/DetalheSolicitacao.tsx` | 8 s | ao abrir + ao enviar + Atualizar |
| `pages/rh/ConferenciaPontoPainel.tsx` | 30 s | ao abrir + Atualizar (o relógio continua, sem servidor) |
| `pages/rh/Recrutamento.tsx` (mensagens do WhatsApp) | 5 s | ao abrir + Atualizar |
| `pages/admin/MigracaoFcr.tsx` | 2,5 s com lote em andamento | Atualizar |
| `hooks/usePresencaOnline.ts` (presença) | **60 s por aba** | quando a pessoa age (abrir, voltar à aba, clicar/teclar), no máximo 1 a cada 5 min |
| `pages/colaborador/CursoColaborador.tsx` (tempo de aula) | 60 s | ao esconder a aba e ao sair da aula (o tempo contado é o mesmo) |
| `pages/tv/TvPlayer.tsx` | ping, versão, cão de guarda e batimento | ao abrir + **tv_estado a cada 4 min** (exceção de 04/11/2026: sem ping toda TV aparecia offline); versão e batimento seguem fora, `tv_reportar` saiu do banco |
| `pages/tv/TvRelatorio.tsx` | reconsulta periódica | só ao abrir |

**Realtime:** o hook `useContratosCatalogoRealtime` (único `.channel(` do
projeto, sem uso desde 21/09) foi apagado. O serviço nem existe no cluster.

**Ficaram** os temporizadores que **não** tocam no servidor: relógios na tela,
contagem regressiva, troca de slide, animação do login.

## O que muda para quem usa

| Onde | Comportamento novo |
|---|---|
| Sininho / badges | atualizam ao abrir a tela, ao abrir o sino e no ⟳ |
| Chats (chamados, solicitações, WhatsApp, recrutamento) | mensagem do outro lado aparece no ⟳ ou ao reabrir; a sua aparece na hora |
| Quem está online | some da lista quem não mexe no ERP há 10 min; o "ausente" (aba aberta e parada) deixou de existir, porque detectá-lo exige o temporizador |
| **TVs** | **ping a cada 4 min** (exceção de 04/11/2026, pedido do Pablo: sem ele toda TV aparecia offline mesmo tocando). Playlist, aviso e "recarregar" chegam em até 4 min; o "ao vivo" de Sistemas › TV's é aproximado (sem `tv_reportar`) |
| Job em andamento (extrator, catálogo CA, parecer IA, migração FCR) | o andamento aparece no ⟳ |

## Como foi validado

- `npx vitest run`: a suíte inteira (ver o commit).
- `src/test/presenca-online.test.ts` (19/19): regra de status com a janela nova.
- Busca no código: `refetchInterval` e `.channel(` com zero ocorrências fora de
  comentário. Os `setInterval` restantes foram conferidos um a um: nenhum faz
  requisição.
- Na produção, depois do deploy: o mesmo `infra/incidentes/analisar.mjs` mostra
  as rotas acima caindo (seção "Depois" em [capacidade-usuarios.md](capacidade-usuarios.md)).
