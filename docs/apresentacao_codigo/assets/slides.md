# Roteiro de fala — XepaJá (Maria Eduarda Wainer)

Fala de apoio para cada slide do `XepaJa_MariaEduardaWainer_PWA.pptx`.
O visual de cada slide é gerado por `build_pptx.py`; este arquivo é o que
falar em cada um. Tempo total estimado: 12 minutos.

## 1. Capa
Apresentar nome, curso e disciplina. Uma frase: PWA que liga feirantes
a moradores para vender sobras boas ao fim da feira, com retirada presencial.

## 2. Agenda
Seis blocos: problema e solução, arquitetura, código, integrações,
mobile e melhorias. Sem slide de perguntas no fim: perguntas ao longo.

## 3. O problema
Comida boa vai para o lixo ao fim da feira por falta de canal rápido.
Comerciante perde receita, morador perto nem fica sabendo.

## 4. A solução
Comerciante publica oferta com foto e janela de retirada; consumidor
busca por raio, reserva uma unidade e retira com código único.
Pagamento, quando houver, é presencial fora do app.

## 5. Arquitetura
PWA React fala JSON com API Hono no mesmo processo Bun; Postgres em
container guarda tudo; Resend manda e-mail, web-push avisa, OSM dá mapa,
Docker com Caddy e Cloudflare servem produção.

## 6. Stack
Bun 1.x roda tudo: API, build, testes, seed. Hono 4, React 19,
PostgreSQL 16, Leaflet com tiles OSM, web-push com VAPID, Docker.

## 7. Como rodar local
Pré-requisitos e cinco comandos: install, compose do banco, migrate,
watch e seed. Health em /api/health prova que subiu. Contas demo no seed.

## 8. Banco e persistência
PostgreSQL com schema versionado pelo migrate, transações em reserva,
aceite, recusa, cancelamento e retirada. Datas em TIMESTAMPTZ, COUNT com
::int. Fotos no disco, só o caminho no banco.

## 9. Autenticação
Senha nunca em texto puro: hash bcrypt via Bun.password. Sessão em
cookie HttpOnly com expiração e logout. Login não revela se o e-mail existe.

## 10. CPF com máscara
Tela mostra 000.000.000-00 enquanto digita; servidor extrai só dígitos
e salva como TEXT, preservando zero à esquerda. Validação com dígitos
verificadores antes de aceitar.

## 11. Busca por proximidade
GPS do consumidor vai só na query e nunca é persistido. Servidor calcula
Haversine, filtra pelo raio de 10 a 100 km e ordena por distância.
Sem GPS, explica e deixa tentar de novo.

## 12. Reserva sem overbooking
Transação trava a linha da oferta com SELECT FOR UPDATE: dois pedidos
na última unidade passam em série. Chave de idempotência impede duplicar
no reenvio. Uma ativa por consumidor; faltas viram pendência de 30 min.

## 13. PWA e offline
Shell em cache com versão: cada mudança no shell pede bump do CACHE,
senão o SW serve o antigo. API nunca sai do cache. Sem rede, offline.html;
sem confirmação de reserva offline.

## 14. Integração: mapas
Leaflet via CDN com tiles OpenStreetMap e atribuição. Mapa na busca com
pinos das ofertas e ponto de retirada no detalhe. Sem rede, texto no lugar.

## 15. Integração: e-mail
Reset de senha por código de 5 caracteres via Resend, válido por 1 hora
e de uso único. Sem chave configurada, o código sai no log (modo demo).
Resposta igual exista ou não a conta: sem oráculo de e-mail.

## 16. Integração: push
Web Push com chaves VAPID para os mesmos eventos dos avisos internos.
Sem permissão ou suporte, os avisos internos garantem a informação e a
reserva funciona igual.

## 17. Deploy
Docker com app e banco, Caddy central com TLS, Cloudflare no edge.
Lição real: edge cacheou o bundle antigo por 4 horas; hoje a purga da
zona faz parte do deploy.

## 18. Responsividade
Mobile-first a partir de 390 px: navegação em abas na topbar, burger no
mobile, formulários contidos e centralizados, foco visível, sem rolagem
horizontal nas ações essenciais.

## 19. Print: cadastro
Conta criada com CPF mascarado na tela e só dígitos no banco.

## 20. Print: busca
Raio de 10 km, pinos no mapa, distância e disponibilidade na lista.

## 21. Print: detalhe
Foto, preço, comerciante, composição e ponto de retirada antes de pedir.

## 22. Print: reserva
Código único de uso único com prazo e limite de cancelamento sem falta.

## 23. Print: conta
Slider de 10 a 100 km; servidor rejeita fora disso com mensagem clara.

## 24. Print: comerciante
Estados da oferta e rascunho que só publica com foto.

## 25. Melhorias honestas
Trocar a chave Resend por send-only, automatizar a purga do Cloudflare
no deploy, testes E2E no navegador, rastrear entrega do push, modo escuro.

## 26. Conclusão
Servidor é a autoridade em tudo crítico; cliente antecipa formato.
Obrigada. Repositório e demo local com seed.
