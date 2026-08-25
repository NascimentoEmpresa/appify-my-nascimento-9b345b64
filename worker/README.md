# Worker de automação — Reuniões (WhatsApp + E-mail)

Processo Node.js **separado** do app principal (Vite). Fica rodando no PC, faz duas coisas a cada 60 segundos:

1. **Lembrete de WhatsApp**: reuniões que começam em ~10 minutos → manda mensagem pro organizador e convidados que tiverem telefone cadastrado.
2. **E-mail da ata**: reuniões encerradas com o PDF final já gerado (feito automaticamente pelo app ao clicar "Encerrar Reunião") → envia o PDF por e-mail pra quem participou.

Se a sessão do WhatsApp cair e não reconectar sozinha, você recebe uma DM de aviso no Discord.

## Setup (primeira vez)

```bash
cd worker
npm install
```

Preencha o `worker/.env` (falta pelo menos a `SUPABASE_SERVICE_ROLE_KEY` — pegue em **Supabase → Project Settings → API → service_role**, é diferente da chave usada no app).

Rode manualmente:

```bash
npm start
```

Na primeira vez vai aparecer um QR code no terminal — escaneie com o WhatsApp (Aparelhos conectados) do número que vai disparar as mensagens. A sessão fica salva em `worker/.wwebjs_auth/` e é reaproveitada nas próximas vezes que rodar `npm start`, sem precisar escanear de novo (a não ser que o WhatsApp invalide a sessão).

## Depois de testado e confirmado

Quando tudo estiver funcionando do jeito que você quer, é só pedir que eu crie o `.bat` que automatiza esse `npm start` reaproveitando a sessão salva.

teste
