#!/usr/bin/env python3
"""Gera XepaJa_MariaEduardaWainer_PWA.pptx a partir dos assets desta pasta.

Uso (na raiz do repo xepaja):
    uv run --with python-pptx --with pillow docs/apresentacao_codigo/assets/build_pptx.py

Saída: docs/apresentacao_codigo/XepaJa_MariaEduardaWainer_PWA.pptx
Insumos lidos: assets/prints/01..06 (fotos mobile 390px).
Para ajustar textos, edite as funções add_slide_* abaixo e rode de novo.
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

BASE = Path(__file__).resolve().parent
PRINTS = BASE / "prints"
OUT = BASE.parent / "XepaJa_MariaEduardaWainer_PWA.pptx"

GREEN_DARK = RGBColor(0x1B, 0x5E, 0x20)
GREEN = RGBColor(0x2E, 0x7D, 0x33)
ORANGE = RGBColor(0xEF, 0x6C, 0x00)
CREAM = RGBColor(0xF7, 0xF3, 0xEA)
INK = RGBColor(0x2B, 0x2B, 0x2B)
MUTED = RGBColor(0x6B, 0x6B, 0x6B)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
CODE_BG = RGBColor(0x1E, 0x1E, 0x1E)
CODE_FG = RGBColor(0xED, 0xED, 0xED)
C_COMMENT = RGBColor(0x7A, 0x7A, 0x7A)
C_STRING = RGBColor(0x9E, 0xCE, 0x6A)
C_KEYWORD = RGBColor(0xFF, 0x9E, 0x64)
C_NUMBER = RGBColor(0x7A, 0xA2, 0xF7)

KEYWORDS = {
    "const", "let", "var", "function", "return", "await", "async", "export",
    "import", "from", "new", "if", "else", "for", "of", "null", "true",
    "false", "throw", "try", "catch", "type", "interface",
}

TOKEN_RE = re.compile(
    r"(//[^\n]*)"          # 1 comentario
    r"|('(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`\\]|\\.)*)"  # 2 string
    r"|\b(\d[\d_]*(?:\.\d+)?)\b"  # 3 numero
    r"|\b([A-Za-z_$][\w$]*)\b"    # 4 palavra
)


def highlight(paragraph, code: str, size: int = 12) -> None:
    paragraph.clear()
    for line in code.split("\n"):
        # monta a linha token a token preservando separadores
        pos = 0
        for m in TOKEN_RE.finditer(line):
            if m.start() > pos:
                r = paragraph.add_run()
                r.text = line[pos:m.start()]
                r.font.size = Pt(size)
                r.font.name = "Consolas"
                r.font.color.rgb = CODE_FG
            tok = m.group(0)
            r = paragraph.add_run()
            r.text = tok
            r.font.size = Pt(size)
            r.font.name = "Consolas"
            if m.group(1) is not None:
                r.font.color.rgb = C_COMMENT
            elif m.group(2) is not None:
                r.font.color.rgb = C_STRING
            elif m.group(3) is not None:
                r.font.color.rgb = C_NUMBER
            elif m.group(4) is not None and tok in KEYWORDS:
                r.font.color.rgb = C_KEYWORD
                r.font.bold = True
            else:
                r.font.color.rgb = CODE_FG
            pos = m.end()
        if pos < len(line):
            r = paragraph.add_run()
            r.text = line[pos:]
            r.font.size = Pt(size)
            r.font.name = "Consolas"
            r.font.color.rgb = CODE_FG
        paragraph.add_line_break()


def new_slide(prs: Presentation, bg=CREAM):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = bg
    return slide


def footer(slide, num: int, total: int) -> None:
    box = slide.shapes.add_textbox(Inches(0.5), Inches(7.05), Inches(12.33), Inches(0.3))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.RIGHT
    r = p.add_run()
    r.text = f"XepaJá — Maria Eduarda Wainer    {num}/{total}"
    r.font.size = Pt(10)
    r.font.name = "Calibri"
    r.font.color.rgb = MUTED


def top_bar(slide) -> None:
    bar = slide.shapes.add_shape(
        MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(13.333), Inches(0.09)
    )
    bar.fill.solid()
    bar.fill.fore_color.rgb = GREEN
    bar.line.fill.background()


def title_block(slide, kicker: str, title: str) -> float:
    if kicker:
        box = slide.shapes.add_textbox(Inches(0.7), Inches(0.35), Inches(11.9), Inches(0.4))
        p = box.text_frame.paragraphs[0]
        r = p.add_run()
        r.text = kicker.upper()
        r.font.size = Pt(13)
        r.font.bold = True
        r.font.name = "Calibri"
        r.font.color.rgb = ORANGE
    box = slide.shapes.add_textbox(Inches(0.7), Inches(0.75), Inches(11.9), Inches(0.9))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = title
    r.font.size = Pt(32)
    r.font.bold = True
    r.font.name = "Calibri"
    r.font.color.rgb = GREEN_DARK
    return 1.8


def bullets(
    slide,
    items: list[str],
    left: float = 0.7,
    top: float = 1.9,
    width: float = 11.9,
    size: int = 20,
) -> None:
    # REGRA: uma unica caixa por lista, um paragrafo por item.
    # Nunca uma caixa por bullet: a estimativa de quebra de linha
    # erra e as caixas se sobrepoem no slide.
    box = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(4.8))
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(8)
        p.space_before = Pt(0)
        r = p.add_run()
        r.text = f"\u2022  {item}"
        r.font.size = Pt(size)
        r.font.name = "Calibri"
        r.font.color.rgb = INK


def code_slide(
    prs, num: int, total: int, kicker: str, title: str,
    code: str, rationale: list[str], code_width: float = 7.3,
) -> None:
    slide = new_slide(prs)
    top_bar(slide)
    title_block(slide, kicker, title)
    bg = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.7), Inches(1.9), Inches(code_width), Inches(4.7)
    )
    bg.fill.solid()
    bg.fill.fore_color.rgb = CODE_BG
    bg.line.fill.background()
    box = slide.shapes.add_textbox(Inches(1.0), Inches(2.1), Inches(code_width - 0.6), Inches(4.3))
    tf = box.text_frame
    tf.word_wrap = True
    highlight(tf.paragraphs[0], code, size=12)
    bullets(slide, rationale, left=0.7 + code_width + 0.5, top=2.0,
            width=12.0 - code_width - 0.5, size=18)
    footer(slide, num, total)


def print_slide(prs, num: int, total: int, caption: str, path: Path) -> None:
    slide = new_slide(prs)
    top_bar(slide)
    title_block(slide, "No celular", caption)
    with Image.open(path) as im:
        w_px, h_px = im.size
    max_w, max_h = 4.4, 4.6
    scale = min(max_w / (w_px / 160.0), max_h / (h_px / 160.0))
    w, h = (w_px / 160.0) * scale, (h_px / 160.0) * scale
    left = (13.333 - w) / 2
    slide.shapes.add_picture(str(path), Inches(left), Inches(2.0), Inches(w), Inches(h))
    footer(slide, num, total)


def diagram_label(slide, left, top, width, height, text, fill, fg, size=15, bold=True):
    box = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height)
    )
    box.fill.solid()
    box.fill.fore_color.rgb = fill
    box.line.color.rgb = GREEN
    box.line.width = Pt(1.5)
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = text
    r.font.size = Pt(size)
    r.font.bold = bold
    r.font.name = "Calibri"
    r.font.color.rgb = fg
    return box


def arrow(slide, x1, y1, x2, y2, label: str = "") -> None:
    conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    conn.line.color.rgb = GREEN
    conn.line.width = Pt(2.25)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2 - 0.28
        box = slide.shapes.add_textbox(Inches(mx - 0.8), Inches(my), Inches(1.6), Inches(0.3))
        p = box.text_frame.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = label
        r.font.size = Pt(11)
        r.font.name = "Calibri"
        r.font.color.rgb = MUTED


def build() -> None:
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    total = 26
    n = 0

    def nxt() -> int:
        nonlocal n
        n += 1
        return n

    # 1 capa
    s = new_slide(prs, bg=GREEN_DARK)
    bar = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.9), Inches(1.1), Inches(1.6), Inches(0.12))
    bar.fill.solid()
    bar.fill.fore_color.rgb = ORANGE
    bar.line.fill.background()
    for text, top, size, bold, color in [
        ("XepaJá", 1.45, 64, True, WHITE),
        ("ofertas perto de você, retire no local", 2.6, 26, False, WHITE),
        ("Maria Eduarda Wainer", 4.3, 28, True, WHITE),
        ("Projeto Extensionista Integrador — Desenvolvimento de PWAs com Frameworks Avançados", 4.95, 18, False, CREAM),
        ("Código, integrações e arquitetura  •  2026/2", 5.6, 16, False, ORANGE),
    ]:
        box = s.shapes.add_textbox(Inches(0.9), Inches(top), Inches(11.5), Inches(1.0))
        p = box.text_frame.paragraphs[0]
        r = p.add_run()
        r.text = text
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.name = "Calibri"
        r.font.color.rgb = color
    footer(s, nxt(), total)

    # 2 agenda
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Roteiro", "Agenda")
    bullets(s, [
        "1. Problema e solução: sobra boa da feira encontra morador perto",
        "2. Arquitetura e stack: PWA, API, banco e deploy",
        "3. Código: auth, CPF, busca, reserva e service worker",
        "4. Integrações: mapas, e-mail, push e produção",
        "5. Mobile e prints do app funcionando",
        "6. Melhorias honestas e conclusão",
    ])
    footer(s, nxt(), total)

    # 3 problema
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Contexto", "O problema")
    bullets(s, [
        "Ao fim da feira, alimentos ainda bons vão para o lixo por falta de canal rápido.",
        "Feirantes e mercearias perdem receita no último giro do dia.",
        "Moradores por perto nem ficam sabendo da oferta a tempo.",
    ], size=22)
    footer(s, nxt(), total)

    # 4 solucao
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Produto", "A solução: XepaJá")
    bullets(s, [
        "Comerciante publica oferta com foto, preço ou gratuidade e janela de retirada.",
        "Consumidor busca por raio, reserva uma unidade e retira com código único.",
        "Pagamento, quando houver, é presencial e fora do aplicativo.",
    ], size=22)
    footer(s, nxt(), total)

    # 5 arquitetura (diagrama)
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Visão geral", "Arquitetura")
    diagram_label(s, 0.7, 3.1, 2.6, 1.1, "PWA React 19\n(mobile e desktop)", WHITE, GREEN_DARK)
    diagram_label(s, 5.35, 3.1, 2.6, 1.1, "API Hono + Bun\n(única autoridade)", GREEN_DARK, WHITE)
    diagram_label(s, 10.0, 3.1, 2.6, 1.1, "PostgreSQL 16\n(transações)", WHITE, GREEN_DARK)
    arrow(s, 3.3, 3.65, 5.35, 3.65, "JSON")
    arrow(s, 7.95, 3.65, 10.0, 3.65, "SQL")
    diagram_label(s, 1.2, 1.55, 2.4, 0.8, "Tiles OSM + Leaflet", CREAM, INK, size=13)
    diagram_label(s, 5.45, 1.55, 2.4, 0.8, "Resend (e-mail)", CREAM, INK, size=13)
    diagram_label(s, 9.7, 1.55, 2.4, 0.8, "Web Push (VAPID)", CREAM, INK, size=13)
    arrow(s, 2.4, 2.35, 2.0, 3.1)
    arrow(s, 6.65, 2.35, 6.65, 3.1)
    arrow(s, 10.9, 2.35, 11.3, 3.1)
    diagram_label(s, 3.6, 5.0, 6.1, 0.8, "Docker  •  Caddy central (TLS)  •  Cloudflare (edge)", CREAM, INK, size=13)
    arrow(s, 6.65, 4.2, 6.65, 5.0, "HTTPS")
    box = s.shapes.add_textbox(Inches(0.7), Inches(6.1), Inches(11.9), Inches(0.5))
    p = box.text_frame.paragraphs[0]
    r = p.add_run()
    r.text = "Regra de ouro: decisão crítica sempre no servidor; o cliente só antecipa formato."
    r.font.size = Pt(15)
    r.font.italic = False
    r.font.name = "Calibri"
    r.font.color.rgb = MUTED
    footer(s, nxt(), total)

    # 6 stack
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Ferramentas", "Stack")
    bullets(s, [
        "Bun 1.x roda tudo: API, build do front, testes, migrations e seed.",
        "Hono 4 na API, React 19 no PWA instalável, PostgreSQL 16 em container.",
        "Leaflet com tiles OpenStreetMap, web-push com chaves VAPID.",
        "Docker com Caddy central e Cloudflare no edge em produção.",
    ])
    footer(s, nxt(), total)

    # 7 rodar local
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Mão na massa", "Como rodar em ambiente local")
    bullets(s, [
        "Pré-requisitos: Bun, Docker, Node com npx e Chrome.",
        "bun install  •  docker compose up -d db  •  bun run db:migrate",
        "bun run watch (API com reload + rebuild do front)  •  bun run seed",
        "App em http://localhost:3000; GET /api/health prova que subiu (db: up).",
        "Contas demo do seed: comercio-banca@ e cliente-zeca@exemplo.com.",
    ], size=19)
    footer(s, nxt(), total)

    # 8 banco
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Dados", "Banco e persistência")
    bullets(s, [
        "PostgreSQL 16 com migrate idempotente; testes usam banco dedicado (xepaja_test).",
        "Reserva, aceite, recusa, cancelamento e retirada rodam em transação.",
        "Datas em TIMESTAMPTZ normalizadas para ISO; COUNT com ::int.",
        "Fotos no disco (data/uploads); no banco, só o caminho do arquivo.",
    ])
    footer(s, nxt(), total)

    # 9 auth + codigo
    code_slide(prs, nxt(), total, "Código 1 de 5", "Autenticação sem senha em texto puro",
        "const passwordHash = await hashPassword(password);\n"
        "// Bun.password: bcrypt, um hash por usuário\n"
        "const inserted = await db`INSERT INTO users\n"
        "  (name, cpf, email, password_hash, role, ...)\n"
        "  VALUES (${name}, ${cpf}, ${email},\n"
        "    ${passwordHash}, ${role}, ...)`;\n"
        "const { token } = await createSession(row.id);\n"
        "// cookie HttpOnly com expiração; logout destrói",
        [
            "Rationale: hash com salt embutido; vazar o banco não entrega senhas.",
            "Rationale: sessão curta com expiração; login genérico não revela e-mails.",
        ])

    # 10 cpf + codigo
    code_slide(prs, nxt(), total, "Código 2 de 5", "CPF com máscara, dígitos no banco",
        "export function maskCpf(value: string): string {\n"
        "  const d = value.replace(/\\D/g, \"\").slice(0, 11);\n"
        "  // tela: 000.000.000-00, banco: \"01234567890\"\n"
        "  ...\n"
        "}\n"
        "// servidor: validateCpf extrai dígitos, confere\n"
        "// os verificadores e salva como TEXT",
        [
            "Rationale: digitação guiada na tela, dado canônico no banco.",
            "Rationale: TEXT preserva zero à esquerda; número quebraria.",
        ])

    # 11 nearby + codigo
    code_slide(prs, nxt(), total, "Código 3 de 5", "Busca por proximidade",
        "const distance_km = haversineKm(\n"
        "  lat, lng, offer.gps_lat, offer.gps_lng);\n"
        ".filter(({ distance_km }) =>\n"
        "  distance_km <= radius); // 10 a 100 km\n"
        "// GPS do consumidor só na query, nunca salvo",
        [
            "Rationale: Haversine com a posição de retirada do comerciante.",
            "Rationale: raio validado no servidor; sem GPS, explica e tenta de novo.",
        ])

    # 12 reserva + codigo
    code_slide(prs, nxt(), total, "Código 4 de 5", "Reserva sem overbooking",
        "FROM offers WHERE id = ${offerId} FOR UPDATE`;\n"
        "// trava a linha: dois pedidos na última\n"
        "// unidade passam em série, sem duplicar\n"
        "// idempotency_key: reenvio não cria outra\n"
        "// 1 ativa por consumidor; faltas viram\n"
        "// pendência de 30 min com aceite do dono",
        [
            "Rationale: atomicidade no banco, não na memória do cliente.",
            "Rationale: pendência expira sozinha e libera a unidade.",
        ], code_width=7.8)

    # 13 pwa + codigo
    code_slide(prs, nxt(), total, "Código 5 de 5", "PWA que funciona offline",
        "const CACHE = \"xepaja-v13\";\n"
        "// bump a cada mudança no shell,\n"
        "// senão o SW serve o antigo travado\n"
        "const SHELL = [\"/\", \"/offline.html\",\n"
        "  \"/manifest.webmanifest\", \"/styles.css\"];\n"
        "// /api nunca sai do cache; sem rede,\n"
        "// navegação cai em offline.html",
        [
            "Rationale: instalável com manifesto e tela sem conexão.",
            "Rationale: sem confirmação falsa: reserva exige rede.",
        ])

    # 14 mapas
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Integração 1 de 4", "Mapas: OpenStreetMap + Leaflet")
    bullets(s, [
        "Tiles OSM com atribuição e Leaflet via CDN na busca e no detalhe.",
        "Pinos das ofertas encontradas e ponto de retirada do comerciante.",
        "Sem rede para o mapa, mostra texto e o resto segue funcionando.",
    ])
    footer(s, nxt(), total)

    # 15 email
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Integração 2 de 4", "E-mail transacional via Resend")
    bullets(s, [
        "Reset de senha com código de 5 caracteres, válido por 1 hora e uso único.",
        "Sem chave configurada, o código sai no log: modo demo local.",
        "Resposta igual exista ou não a conta: sem oráculo de e-mail.",
    ])
    footer(s, nxt(), total)

    # 16 push
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Integração 3 de 4", "Push com fallback garantido")
    bullets(s, [
        "Web Push com chaves VAPID para os mesmos eventos dos avisos internos.",
        "Push é best-effort: falhou ou sem inscrição, o aviso interno cobre.",
        "Reserva funciona igual sem permissão ou sem suporte a push.",
    ])
    footer(s, nxt(), total)

    # 17 deploy
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Integração 4 de 4", "Deploy: Docker, Caddy e Cloudflare")
    bullets(s, [
        "App e banco em containers; Caddy central termina o TLS na VPS.",
        "Cloudflare no edge acelera estáticos com cache de até 4 horas.",
        "Lição real: edge serviu bundle velho após deploy; purga da zona virou etapa.",
        "Banco preservado entre deploys; migrate roda no boot da app.",
    ], size=19)
    footer(s, nxt(), total)

    # 18 responsividade
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Mobile", "Responsividade mobile-first")
    bullets(s, [
        "Layout pensado a partir de 390 px até o desktop sem rolagem lateral.",
        "Navegação em abas acessíveis; menu burger só no mobile.",
        "Formulários contidos e centralizados; botão primário cheio no mobile.",
        "Foco visível, labels ligadas aos campos e erros anunciados.",
    ])
    footer(s, nxt(), total)

    # 19-24 prints
    for caption, fname in [
        ("Cadastro com CPF mascarado", "01-cadastro.png"),
        ("Busca por raio com mapa e distância", "02-busca.png"),
        ("Detalhe com foto, preço e composição", "03-detalhe.png"),
        ("Reserva confirmada com código único", "04-reserva.png"),
        ("Conta com slider de 10 a 100 km", "05-conta.png"),
        ("Comerciante: estados e nova oferta", "06-publicar.png"),
    ]:
        print_slide(prs, nxt(), total, caption, PRINTS / fname)

    # 25 melhorias
    s = new_slide(prs)
    top_bar(s)
    title_block(s, "Evolução", "Pontos de melhoria honestos")
    bullets(s, [
        "Trocar a chave full-access da Resend por uma send-only em produção.",
        "Automatizar a purga do Cloudflare ao fim de cada deploy.",
        "Testes end-to-end no navegador cobrindo os dois perfis.",
        "Rastrear entrega do push; modo escuro; avaliações do comerciante.",
    ])
    footer(s, nxt(), total)

    # 26 conclusao
    s = new_slide(prs, bg=GREEN_DARK)
    for text, top, size, bold, color in [
        ("O servidor é a autoridade", 1.6, 44, True, WHITE),
        ("estoque, faltas, bloqueio e retirada decididos em transação;", 2.9, 20, False, CREAM),
        ("o cliente antecipa formato, nunca resultado.", 3.45, 20, False, CREAM),
        ("Obrigada!", 4.8, 36, True, ORANGE),
        ("Maria Eduarda Wainer  •  repositório xepaja  •  demo local com seed", 5.7, 15, False, WHITE),
    ]:
        box = s.shapes.add_textbox(Inches(0.9), Inches(top), Inches(11.5), Inches(1.0))
        p = box.text_frame.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = text
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.name = "Calibri"
        r.font.color.rgb = color
    footer(s, nxt(), total)

    destino = OUT
    try:
        prs.save(destino)
    except PermissionError:
        destino = OUT.with_name(OUT.stem + '-novo.pptx')
        prs.save(destino)
        print('TRAVADO: feche o pptx no PowerPoint.')
    print(f'OK: {n} slides em {destino}')


if __name__ == "__main__":
    build()
