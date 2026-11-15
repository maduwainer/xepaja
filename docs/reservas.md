# Reservas e histórico

## Comportamento

A aba Minhas reservas mantém a reserva ativa acima do histórico, mesmo quando filtros excluem todos os resultados históricos. Cada cartão abre seus detalhes; voltar mantém os filtros e as páginas já carregadas enquanto a aba estiver aberta.

O histórico usa a data da solicitação, da mais recente para a mais antiga. Os filtros aceitam datas inicial/final inclusivas no fuso do navegador e um status final existente por vez. A API recebe limites temporais explícitos, valida o período e filtra todo o histórico antes de paginar. Não existe novo status de reserva.

O detalhe mostra identificação, composição por unidade, valor, estabelecimento, condições de retirada e motivo registrado quando houver. Cada pedido corresponde a uma unidade da oferta; não se somam quantidades com unidades diferentes para inventar um total de itens.

## Snapshot e fotos

Novos pedidos preservam título, tipo, composição, estabelecimento, referência, GPS, horários e conservação, além do preço e endereço já registrados na reserva. A foto é copiada para um arquivo independente em data/uploads/reservations. Editar a oferta ou substituir sua foto não altera esses dados.

Reservas legadas sem snapshot mostram somente os dados originais disponíveis e identificam informações não registradas. Não são preenchidas silenciosamente com o catálogo atual.

Somente o titular acessa o detalhe e a foto da reserva. Os arquivos não são expostos por uma rota estática pública.

## Código de retirada

O consumidor titular pode consultar o código no resumo e no detalhe enquanto a reserva estiver confirmada. Não aparece em pendentes ou estados finais, nem na resposta de aceite do comerciante. O comerciante continua digitando o código apresentado presencialmente.

O servidor mantém o hash para validação e uma cópia cifrada com AES-GCM para consulta. A chave fica em data/secrets, fora do banco e do build Docker, com volume persistente. Fazer backup do banco sem esse diretório não permite recuperar os códigos cifrados. Não apagar ou regenerar a chave em um deploy.

Respostas de reservas não devem ser cacheadas. Nunca colocar códigos em avisos, URLs ou logs.

## Seed e substituição explícita

O seed normal usa o fluxo da API, com snapshots e imagens. Seu acesso ao histórico percorre as páginas para manter a idempotência.

A manutenção destrutiva tem modo próprio e não é executada pelo seed normal:

```bash
# Conferir a distribuição, sem substituir reservas
bun run seed --recreate-reservations

# Somente depois de autorização explícita e backup completo
bun run seed --recreate-reservations --apply
```

O modo de substituição captura as reservas e avisos anteriores em data/reservation-backups, bloqueia escritas concorrentes e recria os registros em uma transação. Mantém a quantidade por consumidor, oferta e status; preserva cadastros, ofertas, contagem de faltas e bloqueios. Produz novos identificadores, códigos e datas coerentes; remapeia os avisos e registra a substituição na auditoria, sem apagar a auditoria anterior.

Os snapshots recriados usam o catálogo disponível no momento da manutenção: isso não recupera informações antigas que nunca foram salvas. Os arquivos originais de fotos são preservados.

Antes de produção, interromper temporariamente a aplicação e guardar pg_dump, data (incluindo fotos e chave), .env e fonte anterior em local restrito. Conferir que o dump pode ser listado pelo pg_restore. O JSON de manutenção complementa, mas não substitui, o backup completo. Em caso de falha transacional, o banco permanece com as reservas anteriores; cópias de fotos sem referência podem permanecer no disco, sem exclusão automática.

## Verificação

A suíte cobre autorização do titular, ausência de código para o comerciante e estados finais, uso único, snapshot e foto independentes, filtros temporais, paginação além dos primeiros resultados e invariantes da substituição.

A interface deve ser conferida pelo Playwright em localhost: lista, detalhes, filtros, ausência de resultados, cancelamento, carregamento e responsividade. Confirmar também que o novo cache do service worker assumiu o shell.

## Modelo sem pendentes (2026-11-15)

Toda reserva nasce confirmada. Nao ha pendente, aceite ou recusa. Faltas por no-show e bloqueio de 10 dias continuam. Solicitações do comerciante listam confirmadas com olho para Nome, e-mail e faltas. Avisos usam data formatada `DD/MM/AAAA às HH:mm`. Ofertas publicadas ou encerradas nao aceitam troca de foto; fotos vao no cadastro (caixa ate 3, item 1 por item). Ofertas com retirada vencida viram encerradas automaticamente e aparecem na aba Encerradas.
