"""
TWK Data Intelligence Agent — Executive Guide PDF Builder
Generates a premium, well-structured PDF document explaining the agent's capabilities.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.lib.colors import HexColor, black, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    Frame, PageTemplate, BaseDocTemplate, KeepTogether, NextPageTemplate,
)
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

# ── TWK Brand Colors ─────────────────────────────────────────────────────────
GOLD      = HexColor('#C9A96E')
GOLD_DARK = HexColor('#8B6F3C')
GOLD_SOFT = HexColor('#E5D4A3')
INK       = HexColor('#1A1A1F')
INK_SOFT  = HexColor('#3A3A45')
GREY      = HexColor('#6B6B75')
LIGHT_BG  = HexColor('#F8F6F1')
DIVIDER   = HexColor('#E8E2D2')

EMERALD   = HexColor('#10B981')
AMBER     = HexColor('#F59E0B')
RED       = HexColor('#EF4444')
BLUE      = HexColor('#3B82F6')
PURPLE    = HexColor('#A78BFA')

OUTPUT = r"C:\Users\bianc\OneDrive\Área de Trabalho\data-bank-agent\TWK_Data_Intelligence_Agent.pdf"

# ── Styles ───────────────────────────────────────────────────────────────────

styles = getSampleStyleSheet()

S_COVER_BRAND = ParagraphStyle(
    'CoverBrand', parent=styles['Normal'],
    fontName='Helvetica-Bold', fontSize=10, textColor=GOLD,
    alignment=TA_CENTER, spaceAfter=2, letterSpacing=3,
)
S_COVER_TITLE = ParagraphStyle(
    'CoverTitle', parent=styles['Normal'],
    fontName='Times-Roman', fontSize=48, textColor=INK,
    alignment=TA_CENTER, leading=54, spaceAfter=8,
)
S_COVER_SUB = ParagraphStyle(
    'CoverSub', parent=styles['Normal'],
    fontName='Helvetica', fontSize=14, textColor=INK_SOFT,
    alignment=TA_CENTER, leading=20, spaceAfter=20,
)
S_COVER_TAG = ParagraphStyle(
    'CoverTag', parent=styles['Normal'],
    fontName='Helvetica-Oblique', fontSize=10, textColor=GREY,
    alignment=TA_CENTER, spaceAfter=4,
)

S_H1 = ParagraphStyle(
    'H1', parent=styles['Normal'],
    fontName='Times-Roman', fontSize=32, textColor=INK,
    alignment=TA_LEFT, leading=38, spaceBefore=0, spaceAfter=16,
)
S_H2 = ParagraphStyle(
    'H2', parent=styles['Normal'],
    fontName='Times-Roman', fontSize=22, textColor=INK,
    alignment=TA_LEFT, leading=28, spaceBefore=18, spaceAfter=10,
)
S_H3 = ParagraphStyle(
    'H3', parent=styles['Normal'],
    fontName='Helvetica-Bold', fontSize=11, textColor=GOLD_DARK,
    alignment=TA_LEFT, spaceBefore=8, spaceAfter=4, letterSpacing=2,
)
S_BODY = ParagraphStyle(
    'Body', parent=styles['Normal'],
    fontName='Helvetica', fontSize=10.5, textColor=INK_SOFT,
    alignment=TA_JUSTIFY, leading=16, spaceAfter=8,
)
S_BODY_LARGE = ParagraphStyle(
    'BodyLarge', parent=styles['Normal'],
    fontName='Helvetica', fontSize=12, textColor=INK_SOFT,
    alignment=TA_JUSTIFY, leading=20, spaceAfter=10,
)
S_BODY_CENTER = ParagraphStyle(
    'BodyCenter', parent=S_BODY, alignment=TA_CENTER,
)
S_LABEL = ParagraphStyle(
    'Label', parent=styles['Normal'],
    fontName='Helvetica-Bold', fontSize=8, textColor=GOLD_DARK,
    alignment=TA_LEFT, letterSpacing=2, spaceAfter=4,
)
S_POWER_NUM = ParagraphStyle(
    'PowerNum', parent=styles['Normal'],
    fontName='Times-Roman', fontSize=64, textColor=GOLD,
    alignment=TA_CENTER, leading=64,
)
S_POWER_TITLE = ParagraphStyle(
    'PowerTitle', parent=styles['Normal'],
    fontName='Times-Roman', fontSize=20, textColor=INK,
    alignment=TA_LEFT, leading=24, spaceAfter=4,
)
S_POWER_TAG = ParagraphStyle(
    'PowerTag', parent=styles['Normal'],
    fontName='Helvetica-Bold', fontSize=8, textColor=GOLD_DARK,
    alignment=TA_LEFT, letterSpacing=1.5, spaceAfter=6,
)
S_EXAMPLE_LABEL = ParagraphStyle(
    'ExampleLabel', parent=styles['Normal'],
    fontName='Helvetica-Bold', fontSize=8, textColor=GOLD_DARK,
    alignment=TA_LEFT, letterSpacing=1.5, spaceAfter=4,
)
S_EXAMPLE_TEXT = ParagraphStyle(
    'ExampleText', parent=styles['Normal'],
    fontName='Helvetica-Oblique', fontSize=10, textColor=INK_SOFT,
    alignment=TA_LEFT, leading=15,
)
S_TOC_ITEM = ParagraphStyle(
    'TOCItem', parent=styles['Normal'],
    fontName='Helvetica', fontSize=11, textColor=INK,
    alignment=TA_LEFT, spaceAfter=8, leading=18,
)
S_FOOTER = ParagraphStyle(
    'Footer', parent=styles['Normal'],
    fontName='Helvetica', fontSize=8, textColor=GREY,
    alignment=TA_CENTER,
)
S_QUOTE = ParagraphStyle(
    'Quote', parent=styles['Normal'],
    fontName='Times-Italic', fontSize=14, textColor=INK,
    alignment=TA_LEFT, leading=22, leftIndent=14, rightIndent=14,
)

# ── Page templates ───────────────────────────────────────────────────────────

PAGE_WIDTH, PAGE_HEIGHT = A4

def cover_page(canvas_, doc):
    """Cinematic cover page."""
    canvas_.saveState()
    # Background
    canvas_.setFillColor(LIGHT_BG)
    canvas_.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    # Top gold band
    canvas_.setFillColor(GOLD)
    canvas_.rect(0, PAGE_HEIGHT - 8, PAGE_WIDTH, 8, fill=1, stroke=0)
    # Decorative diamond
    cx, cy = PAGE_WIDTH / 2, PAGE_HEIGHT - 5.5 * cm
    s = 0.45 * cm
    canvas_.setFillColor(GOLD)
    p = canvas_.beginPath()
    p.moveTo(cx, cy + s); p.lineTo(cx + s, cy); p.lineTo(cx, cy - s); p.lineTo(cx - s, cy); p.close()
    canvas_.drawPath(p, fill=1, stroke=0)
    # Subtle bottom band
    canvas_.setFillColor(GOLD_SOFT)
    canvas_.rect(0, 0, PAGE_WIDTH, 4, fill=1, stroke=0)
    # Footer
    canvas_.setFont('Helvetica', 8)
    canvas_.setFillColor(GREY)
    canvas_.drawCentredString(PAGE_WIDTH / 2, 1.2 * cm, 'CONFIDENCIAL · THE WORLD KEYS · 2026')
    canvas_.restoreState()

def chapter_page(canvas_, doc):
    """Standard page with header/footer."""
    canvas_.saveState()
    # Background
    canvas_.setFillColor(white)
    canvas_.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    # Header line
    canvas_.setStrokeColor(DIVIDER)
    canvas_.setLineWidth(0.5)
    canvas_.line(2 * cm, PAGE_HEIGHT - 1.8 * cm, PAGE_WIDTH - 2 * cm, PAGE_HEIGHT - 1.8 * cm)
    # Header text
    canvas_.setFont('Helvetica-Bold', 8)
    canvas_.setFillColor(GOLD_DARK)
    canvas_.drawString(2 * cm, PAGE_HEIGHT - 1.4 * cm, 'TWK · DATA INTELLIGENCE AGENT')
    canvas_.setFont('Helvetica', 8)
    canvas_.setFillColor(GREY)
    canvas_.drawRightString(PAGE_WIDTH - 2 * cm, PAGE_HEIGHT - 1.4 * cm, 'Guia Executivo')
    # Footer
    canvas_.setStrokeColor(DIVIDER)
    canvas_.line(2 * cm, 1.5 * cm, PAGE_WIDTH - 2 * cm, 1.5 * cm)
    canvas_.setFont('Helvetica', 7)
    canvas_.setFillColor(GREY)
    canvas_.drawString(2 * cm, 1.1 * cm, 'The World Keys · theworldkeys.com')
    canvas_.drawRightString(PAGE_WIDTH - 2 * cm, 1.1 * cm, f'Página {doc.page}')
    canvas_.restoreState()

# ── Helper: gold divider ────────────────────────────────────────────────────

def gold_divider(width=12*cm):
    """Returns a Table acting as a centred gold rule."""
    t = Table([['']], colWidths=[width], rowHeights=[1.2])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0),(-1,-1), GOLD),
        ('LINEABOVE', (0,0),(-1,-1), 0, white),
    ]))
    return t

def power_card(num, title, tag, description, example, accent_color=GOLD):
    """Creates a beautiful card for one of the 10 powers."""
    num_cell = Paragraph(f'<font color="#C9A96E">{num:02d}</font>', S_POWER_NUM)

    tag_p = Paragraph(tag, S_POWER_TAG)
    title_p = Paragraph(title, S_POWER_TITLE)
    desc_p = Paragraph(description, S_BODY)
    ex_label = Paragraph('EXEMPLO', S_EXAMPLE_LABEL)
    ex_p = Paragraph(example, S_EXAMPLE_TEXT)

    right_content = [[tag_p],[title_p],[desc_p],[Spacer(1,4)],[ex_label],[ex_p]]
    right_table = Table(right_content, colWidths=[13.2*cm])
    right_table.setStyle(TableStyle([
        ('LEFTPADDING',  (0,0),(-1,-1), 0),
        ('RIGHTPADDING', (0,0),(-1,-1), 0),
        ('TOPPADDING',   (0,0),(-1,-1), 0),
        ('BOTTOMPADDING',(0,0),(-1,-1), 0),
    ]))

    # Outer 2-col table: number left, content right
    outer = Table(
        [[num_cell, right_table]],
        colWidths=[3*cm, 13.5*cm],
    )
    outer.setStyle(TableStyle([
        ('VALIGN',   (0,0),(0,0),  'TOP'),
        ('VALIGN',   (1,0),(1,0),  'TOP'),
        ('LEFTPADDING',  (0,0),(-1,-1), 12),
        ('RIGHTPADDING', (0,0),(-1,-1), 12),
        ('TOPPADDING',   (0,0),(-1,-1), 16),
        ('BOTTOMPADDING',(0,0),(-1,-1), 16),
        ('BACKGROUND',   (0,0),(-1,-1), LIGHT_BG),
        ('LINEBEFORE',   (0,0),(0,0),  3, accent_color),
        ('ROUNDEDCORNERS',[6,6,6,6]),
    ]))
    return outer

def callout(label, text, color=GOLD):
    """Returns an accent callout block."""
    label_p = Paragraph(label, ParagraphStyle('CalloutLabel', parent=S_LABEL, textColor=color))
    text_p = Paragraph(text, S_BODY)
    t = Table([[label_p],[text_p]], colWidths=[16.5*cm])
    t.setStyle(TableStyle([
        ('BACKGROUND',   (0,0),(-1,-1), HexColor('#FAF7EE')),
        ('LINEBEFORE',   (0,0),(-1,-1), 3, color),
        ('LEFTPADDING',  (0,0),(-1,-1), 14),
        ('RIGHTPADDING', (0,0),(-1,-1), 14),
        ('TOPPADDING',   (0,0),(-1,-1), 10),
        ('BOTTOMPADDING',(0,0),(-1,-1), 10),
    ]))
    return t

# ════════════════════════════════════════════════════════════════════════════
# BUILD DOCUMENT
# ════════════════════════════════════════════════════════════════════════════

doc = BaseDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm, topMargin=2.4*cm, bottomMargin=2.2*cm,
    title='TWK Data Intelligence Agent — Guia Executivo',
    author='The World Keys',
)

frame_cover = Frame(0, 0, PAGE_WIDTH, PAGE_HEIGHT, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0, id='cover')
frame_chapter = Frame(2*cm, 2*cm, PAGE_WIDTH - 4*cm, PAGE_HEIGHT - 4*cm, id='chapter')

doc.addPageTemplates([
    PageTemplate(id='Cover', frames=[frame_cover], onPage=cover_page),
    PageTemplate(id='Chapter', frames=[frame_chapter], onPage=chapter_page),
])

story = []

# ── COVER ────────────────────────────────────────────────────────────────────
story.append(Spacer(1, 7*cm))
story.append(Paragraph('THE WORLD KEYS', S_COVER_BRAND))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph('Data Intelligence Agent', S_COVER_TITLE))
story.append(Spacer(1, 0.2*cm))
story.append(Paragraph('Guia Executivo de Capacidades', S_COVER_SUB))
story.append(Spacer(1, 0.3*cm))
story.append(gold_divider(6*cm))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph('um assistente inteligente que cuida do banco de dados<br/>de restaurantes 24 horas por dia, sem dormir, sem férias', S_COVER_TAG))
story.append(Spacer(1, 6*cm))
story.append(Paragraph('Versão 3.0 — junho de 2026', S_COVER_TAG))

# Switch to chapter template from page 2 onwards
story.append(NextPageTemplate('Chapter'))
story.append(PageBreak())

# ── PAGE 2: SUMÁRIO ──────────────────────────────────────────────────────────
story.append(Paragraph('Sumário', S_H1))
story.append(gold_divider(4*cm))
story.append(Spacer(1, 0.6*cm))

toc_data = [
    ['01', 'O que é o agente?',                  '03'],
    ['02', 'Os 10 super-poderes',                '04'],
    ['03', 'Central de Comando',                 '12'],
    ['04', 'Segurança e Auditoria',              '14'],
    ['05', 'Antes vs. Agora',                    '15'],
    ['06', 'Resumo Executivo',                   '16'],
]
toc_table = Table(toc_data, colWidths=[1.2*cm, 13*cm, 2.5*cm])
toc_table.setStyle(TableStyle([
    ('FONT', (0,0),(0,-1), 'Times-Roman', 14),
    ('TEXTCOLOR', (0,0),(0,-1), GOLD),
    ('FONT', (1,0),(1,-1), 'Helvetica', 11),
    ('TEXTCOLOR', (1,0),(1,-1), INK),
    ('FONT', (2,0),(2,-1), 'Helvetica', 10),
    ('TEXTCOLOR', (2,0),(2,-1), GREY),
    ('ALIGN', (2,0),(2,-1), 'RIGHT'),
    ('VALIGN', (0,0),(-1,-1), 'MIDDLE'),
    ('TOPPADDING', (0,0),(-1,-1), 14),
    ('BOTTOMPADDING', (0,0),(-1,-1), 14),
    ('LINEBELOW', (0,0),(-1,-1), 0.5, DIVIDER),
]))
story.append(toc_table)

story.append(PageBreak())

# ── PAGE 3: INTRODUÇÃO ───────────────────────────────────────────────────────
story.append(Paragraph('01', ParagraphStyle('CN', parent=S_LABEL, fontSize=11, textColor=GOLD, letterSpacing=4)))
story.append(Paragraph('O que é o agente?', S_H1))
story.append(gold_divider(4*cm))
story.append(Spacer(1, 0.8*cm))

story.append(Paragraph(
    'O <b>TWK Data Intelligence Agent</b> é um assistente de inteligência artificial '
    'que cuida do banco de dados de restaurantes da plataforma The World Keys. Ele '
    'conversa em português, entende pedidos em linguagem natural, e executa tarefas '
    'complexas de forma autônoma — desde encontrar problemas até consertá-los.',
    S_BODY_LARGE,
))
story.append(Spacer(1, 0.4*cm))
story.append(Paragraph(
    'Pense nele como um time inteiro de analistas de dados, disponível 24 horas '
    'por dia, sem férias, sem cansaço, e que fica mais preciso a cada interação.',
    S_BODY_LARGE,
))

story.append(Spacer(1, 1*cm))
story.append(Paragraph('NÚMEROS QUE IMPRESSIONAM', S_LABEL))
story.append(Spacer(1, 0.3*cm))

numbers_table = Table([
    ['27',  '22',  '9',   '0.17 MB'],
    ['Ferramentas no\narsenal',
     'Endpoints de\nauditoria',
     'Módulos visuais\ndo dashboard',
     'Pacote total\ndo aplicativo'],
], colWidths=[4*cm, 4*cm, 4*cm, 4.5*cm])
numbers_table.setStyle(TableStyle([
    ('FONT', (0,0),(-1,0), 'Times-Roman', 36),
    ('TEXTCOLOR', (0,0),(-1,0), GOLD),
    ('ALIGN', (0,0),(-1,-1), 'CENTER'),
    ('FONT', (0,1),(-1,1), 'Helvetica', 9),
    ('TEXTCOLOR', (0,1),(-1,1), GREY),
    ('TOPPADDING', (0,0),(-1,0), 12),
    ('BOTTOMPADDING', (0,1),(-1,1), 12),
    ('TOPPADDING', (0,1),(-1,1), 4),
    ('BACKGROUND', (0,0),(-1,-1), LIGHT_BG),
    ('LINEBELOW', (0,0),(-1,0), 0.5, DIVIDER),
]))
story.append(numbers_table)

story.append(Spacer(1, 1*cm))
story.append(callout(
    'NA PRÁTICA',
    'Você pergunta: <i>"Quantos restaurantes em Paris estão com dados incompletos?"</i> — '
    'O agente em segundos: pesquisa, conta, analisa, gera relatório e ainda sugere as correções.',
    GOLD,
))

story.append(PageBreak())

# ── PAGE 4: OS 10 SUPER-PODERES — INTRO ──────────────────────────────────────
story.append(Paragraph('02', ParagraphStyle('CN', parent=S_LABEL, fontSize=11, textColor=GOLD, letterSpacing=4)))
story.append(Paragraph('Os 10 super-poderes', S_H1))
story.append(gold_divider(4*cm))
story.append(Spacer(1, 0.6*cm))
story.append(Paragraph(
    'O agente combina cinco níveis de inteligência: auditoria estrutural, validação '
    'externa contra o mundo real, análise semântica via IA, auto-correção documentada '
    'e monitoramento contínuo. A seguir, cada um dos dez super-poderes explicado em '
    'linguagem simples, com exemplo real.',
    S_BODY_LARGE,
))
story.append(Spacer(1, 0.8*cm))

# Power 1
story.append(power_card(
    1, 'Vê tudo no banco em segundos', 'AUDITORIA ESTRUTURAL',
    'Ele olha qualquer tabela do banco e em poucos segundos identifica todos os '
    'problemas: campos vazios, valores estranhos, formatos errados, registros incompletos. '
    'Tudo organizado por gravidade — crítico, aviso ou informativo.',
    'Em poucos segundos descobre: <b>707 restaurantes com coordenadas erradas, '
    '621 sem e-mail, 383 sem horário de funcionamento.</b>',
    GOLD,
))
story.append(Spacer(1, 0.4*cm))

# Power 2
story.append(power_card(
    2, 'Confere se os e-mails são reais', 'VALIDAÇÃO EXTERNA',
    'Não basta o e-mail ter "@" no meio. O agente verifica de verdade se o domínio '
    'existe e se aceita mensagens, usando consulta DNS. Se for um erro de digitação, '
    'identifica e sugere a correção.',
    'Detecta que <b>reservas@gmial.com</b> tem typo e sugere automaticamente '
    '<b>reservas@gmail.com</b>.',
    BLUE,
))
story.append(PageBreak())

# Power 3
story.append(power_card(
    3, 'Arruma os telefones automaticamente', 'NORMALIZAÇÃO',
    'Pega telefones bagunçados, de qualquer formato, e transforma no padrão internacional E.164. '
    'Ainda identifica se é móvel ou fixo, e em qual país está cadastrado.',
    '<b>(11) 99999-8888</b> vira <b>+5511999998888</b>, classificado como móvel · Brasil.',
    EMERALD,
))
story.append(Spacer(1, 0.4*cm))

# Power 4
story.append(power_card(
    4, 'Testa se os sites funcionam', 'LIVENESS CHECK',
    'Tenta acessar cada site cadastrado. Se um site está fora do ar, dá erro 404, virou '
    'estacionamento de domínio, ou demora demais para responder, o agente detecta na hora.',
    'Identifica que <b>4 sites na amostra estão fora do ar há mais de 30 dias</b> e '
    'recomenda remoção do cadastro.',
    AMBER,
))
story.append(Spacer(1, 0.4*cm))

# Power 5
story.append(power_card(
    5, 'Confere se as coordenadas estão certas', 'GEO-VALIDAÇÃO',
    'Se um restaurante diz estar em Paris mas as coordenadas apontam para Madrid, ele '
    'percebe. Se as coordenadas estão fora do mapa real da cidade declarada, ele alerta.',
    'Detecta que o restaurante "Le Marais" cadastrado como sendo em Paris está '
    'com <b>coordenadas em Lyon</b> — provavelmente um erro de cadastro.',
    PURPLE,
))
story.append(PageBreak())

# Power 6
story.append(power_card(
    6, 'Compara com o Google Places em tempo real', 'FRESHNESS CHECK',
    'O pulo do gato. O agente consulta o Google Places usando o place_id e compara '
    'o que está no seu banco com o que está no Google hoje: o restaurante fechou? '
    'O telefone mudou? O endereço mudou?',
    'Descobre que <b>2 restaurantes do top 15 estão marcados como CLOSED_PERMANENTLY</b> '
    'no Google Places — mas continuam ativos no banco da TWK.',
    RED,
))
story.append(Spacer(1, 0.4*cm))

# Power 7
story.append(power_card(
    7, 'Detecta incoerências usando IA secundária', 'ANÁLISE SEMÂNTICA',
    'Usa um modelo de IA dedicado (Claude Haiku) para ler os dados e perceber coisas '
    'que só um humano notaria: incoerências entre nome e culinária, endereços que parecem '
    'residenciais, descrições com spam, idioma errado para o país.',
    'Alerta: <i>"O restaurante diz ser sushi japonês, mas o nome é em italiano e o '
    'endereço fica em Paris — algo está errado."</i>',
    PURPLE,
))
story.append(Spacer(1, 0.4*cm))

# Power 8
story.append(power_card(
    8, 'Acha duplicatas escondidas', 'FUZZY MATCHING',
    'Se há dois registros parecidos como "Le Cinq" e "Restaurante Le Cinq", o agente '
    'detecta que provavelmente são o mesmo lugar, usando comparação inteligente de '
    'texto baseada em trigramas.',
    'Encontra <b>14 grupos de duplicatas</b> que estavam passando despercebidos, '
    'com similaridade acima de 85%.',
    AMBER,
))
story.append(PageBreak())

# Power 9
story.append(power_card(
    9, 'Conserta sozinho — com permissão', 'AUTO-CORREÇÃO',
    'Depois de identificar os problemas, o agente gera correções com nível de '
    'confiança: <b>verde</b> (aplica direto), <b>amarelo</b> (pede revisão), <b>vermelho</b> '
    '(só sugere). Você decide o quanto delegar.',
    'Em uma execução típica: <b>187 sugestões geradas, 124 de alta confiança</b> aplicadas '
    'automaticamente, 51 enviadas para revisão humana, 12 apenas registradas.',
    EMERALD,
))
story.append(Spacer(1, 0.4*cm))

# Power 10
story.append(power_card(
    10, 'Acompanha a evolução da qualidade', 'MONITORAMENTO',
    'Tira uma "foto" do banco em qualquer momento e compara com o passado. Se a qualidade '
    'estiver caindo, ele alerta. Se estiver melhorando, mostra o progresso em pontos.',
    'Notifica: <i>"📈 Quality score melhorou 12 pontos desde a última verificação"</i> '
    'ou <i>"🚨 Quality score caiu 8 pontos — algo aconteceu nas últimas 24h"</i>.',
    GOLD,
))

story.append(PageBreak())

# ── CENTRAL DE COMANDO ───────────────────────────────────────────────────────
story.append(Paragraph('03', ParagraphStyle('CN', parent=S_LABEL, fontSize=11, textColor=GOLD, letterSpacing=4)))
story.append(Paragraph('Central de Comando', S_H1))
story.append(gold_divider(4*cm))
story.append(Spacer(1, 0.6*cm))
story.append(Paragraph(
    'Para você acompanhar tudo em tempo real, o sistema tem uma <b>Central de Comando '
    'cinematográfica</b> — como uma sala de controle da NASA, mas para dados de '
    'restaurantes premium.',
    S_BODY_LARGE,
))
story.append(Spacer(1, 0.5*cm))

story.append(Paragraph('O QUE VOCÊ VÊ AO ABRIR O SISTEMA', S_LABEL))
story.append(Spacer(1, 0.3*cm))

features_data = [
    ['1', 'Cards de Métricas Animados',
     'Quality score, total de restaurantes, problemas críticos, latência do banco — \ntudo atualizado em tempo real com mini-gráficos de tendência.'],
    ['2', 'Stream Ao Vivo de Atividades',
     'Cada ação que o agente executa aparece numa lista animada, com ícone por \ncategoria, tempo de execução e status (rodando, sucesso ou erro).'],
    ['3', 'Saúde do Sistema',
     'Indicadores verdes piscando para PostgreSQL, Google Places e Anthropic — \ne os tempos de resposta de cada serviço.'],
    ['4', 'Linha do Tempo Visual',
     'Gráfico de barras horizontal mostrando a atividade dos últimos 60 minutos, \nminuto a minuto, colorido por sucesso ou erro.'],
    ['5', 'Atalho ⌘K',
     'Aperta Ctrl+K (ou Cmd+K no Mac) e abre uma busca instantânea de qualquer \nação ou módulo — como o Spotlight do macOS, mas para o sistema TWK.'],
    ['6', 'Chat Conversacional',
     'Em qualquer momento você pode abrir o chat e conversar com o agente em \nportuguês, dando comandos em linguagem natural.'],
]

feat_table = Table(features_data, colWidths=[1*cm, 5*cm, 10.5*cm])
feat_table.setStyle(TableStyle([
    ('FONT', (0,0),(0,-1), 'Times-Roman', 16),
    ('TEXTCOLOR', (0,0),(0,-1), GOLD),
    ('VALIGN', (0,0),(0,-1), 'TOP'),
    ('FONT', (1,0),(1,-1), 'Helvetica-Bold', 10),
    ('TEXTCOLOR', (1,0),(1,-1), INK),
    ('VALIGN', (1,0),(1,-1), 'TOP'),
    ('FONT', (2,0),(2,-1), 'Helvetica', 9.5),
    ('TEXTCOLOR', (2,0),(2,-1), INK_SOFT),
    ('VALIGN', (2,0),(2,-1), 'TOP'),
    ('LEADING', (2,0),(2,-1), 14),
    ('TOPPADDING', (0,0),(-1,-1), 10),
    ('BOTTOMPADDING', (0,0),(-1,-1), 10),
    ('LINEBELOW', (0,0),(-1,-1), 0.3, DIVIDER),
]))
story.append(feat_table)

story.append(PageBreak())

# ── Exemplo de conversa ──────────────────────────────────────────────────────
story.append(Paragraph('EXEMPLO DE CONVERSA REAL', S_LABEL))
story.append(Spacer(1, 0.4*cm))

conv_user = ParagraphStyle('ConvUser', parent=S_BODY, fontName='Helvetica-Bold', fontSize=11, textColor=INK, alignment=TA_LEFT)
conv_agent = ParagraphStyle('ConvAgent', parent=S_BODY, fontName='Helvetica', fontSize=10.5, textColor=INK_SOFT, alignment=TA_LEFT, leading=16)

conv = Table([
    [Paragraph('VOCÊ', conv_user)],
    [Paragraph('<i>"Audite os restaurantes de Paris e me mostre os 10 piores em qualidade."</i>', conv_agent)],
    [Spacer(1, 0.3*cm)],
    [Paragraph('AGENTE  🤖', ParagraphStyle('CA', parent=conv_user, textColor=GOLD_DARK))],
    [Paragraph(
        '⚙ <b>audit_table</b> · 234ms · ✓<br/>'
        '⚙ <b>check_emails_reality</b> · 1.2s · ✓<br/>'
        '⚙ <b>check_places_freshness</b> · 3.4s · ✓<br/>'
        '⚙ <b>completeness_report</b> · 89ms · ✓',
        ParagraphStyle('CT', parent=conv_agent, fontName='Courier', fontSize=9, textColor=GREY),
    )],
    [Spacer(1, 0.2*cm)],
    [Paragraph(
        'Analisei <b>23 restaurantes em Paris</b>. Os 10 piores em qualidade são... '
        '<i>[lista detalhada com pontuação]</i>. <br/><br/>'
        '⚠️ Importante: <b>3 deles estão marcados como FECHADOS PERMANENTEMENTE</b> '
        'no Google Places. Quer que eu marque como inativos no banco e gere um '
        'relatório para a equipe?',
        conv_agent,
    )],
], colWidths=[16.5*cm])
conv.setStyle(TableStyle([
    ('LEFTPADDING', (0,0),(-1,-1), 14),
    ('RIGHTPADDING', (0,0),(-1,-1), 14),
    ('TOPPADDING', (0,0),(-1,-1), 4),
    ('BOTTOMPADDING', (0,0),(-1,-1), 4),
    ('BACKGROUND', (0,0),(-1,-1), LIGHT_BG),
    ('LINEBEFORE', (0,0),(-1,-1), 3, GOLD),
]))
story.append(conv)

story.append(Spacer(1, 1*cm))
story.append(callout(
    'O DIFERENCIAL',
    'O agente não apenas responde — ele <b>raciocina</b>, escolhe quais ferramentas usar, '
    'em que ordem, e antecipa próximos passos. É proativo, não reativo.',
    GOLD,
))

story.append(PageBreak())

# ── PAGE: SEGURANÇA ──────────────────────────────────────────────────────────
story.append(Paragraph('04', ParagraphStyle('CN', parent=S_LABEL, fontSize=11, textColor=GOLD, letterSpacing=4)))
story.append(Paragraph('Segurança e Auditoria', S_H1))
story.append(gold_divider(4*cm))
story.append(Spacer(1, 0.6*cm))
story.append(Paragraph(
    'Um agente poderoso precisa ser confiável. O TWK Data Intelligence Agent foi '
    'construído com cinco camadas de proteção que tornam impossível causar dano '
    'acidental ao banco.',
    S_BODY_LARGE,
))
story.append(Spacer(1, 0.5*cm))

sec_data = [
    ['◆', 'Nunca destrói dados em massa',
     'Antes de qualquer DELETE ou UPDATE em larga escala, o agente pede confirmação \ne mostra exatamente o que será alterado.'],
    ['◆', 'Tudo fica registrado',
     'Cada alteração é logada na tabela update_events: valor anterior, valor novo, \nmotivo da mudança, hora exata e qual agente realizou.'],
    ['◆', 'Modo Safe ligado por padrão',
     'Operações perigosas como DELETE sem WHERE ou TRUNCATE são automaticamente \nbloqueadas até liberação explícita.'],
    ['◆', 'Reversibilidade total',
     'O valor antigo é sempre preservado. Se uma correção foi errada, é possível \nreverter consultando o histórico.'],
    ['◆', 'Confiança graduada para auto-fix',
     'O agente só aplica automaticamente correções com confiança ALTA. Médias e \nbaixas exigem revisão humana explícita.'],
]

sec_table = Table(sec_data, colWidths=[0.8*cm, 5.5*cm, 10.2*cm])
sec_table.setStyle(TableStyle([
    ('FONT', (0,0),(0,-1), 'Helvetica-Bold', 12),
    ('TEXTCOLOR', (0,0),(0,-1), GOLD),
    ('VALIGN', (0,0),(0,-1), 'TOP'),
    ('FONT', (1,0),(1,-1), 'Helvetica-Bold', 10),
    ('TEXTCOLOR', (1,0),(1,-1), INK),
    ('VALIGN', (1,0),(1,-1), 'TOP'),
    ('FONT', (2,0),(2,-1), 'Helvetica', 9.5),
    ('TEXTCOLOR', (2,0),(2,-1), INK_SOFT),
    ('VALIGN', (2,0),(2,-1), 'TOP'),
    ('LEADING', (2,0),(2,-1), 14),
    ('TOPPADDING', (0,0),(-1,-1), 12),
    ('BOTTOMPADDING', (0,0),(-1,-1), 12),
    ('LINEBELOW', (0,0),(-1,-1), 0.3, DIVIDER),
]))
story.append(sec_table)

story.append(PageBreak())

# ── ANTES vs AGORA ──────────────────────────────────────────────────────────
story.append(Paragraph('05', ParagraphStyle('CN', parent=S_LABEL, fontSize=11, textColor=GOLD, letterSpacing=4)))
story.append(Paragraph('Antes vs. Agora', S_H1))
story.append(gold_divider(4*cm))
story.append(Spacer(1, 0.6*cm))
story.append(Paragraph(
    'O impacto operacional do agente é mais bem visualizado em comparação direta '
    'com o processo manual tradicional.',
    S_BODY_LARGE,
))
story.append(Spacer(1, 0.8*cm))

compare_data = [
    ['', 'ANTES · Processo Manual', 'AGORA · Com o Agente'],
    ['Identificar problemas',
     'Análise manual de planilhas\nrelatórios Excel, cruzamento\nde dados em pranchetas',
     'Auditoria completa em\n30 segundos com score\n0-100 e ranking de issues'],
    ['Verificar e-mails',
     'Envio manual de teste e\nrastreamento de bounces',
     'DNS MX lookup automático\npara qualquer volume'],
    ['Detectar restaurantes\nfechados',
     'Descoberta acidental quando\num cliente reclama',
     'Comparação contínua com\nGoogle Places em background'],
    ['Corrigir 100 registros',
     'Edição uma a uma na\nplanilha, sem log',
     'Sugestões em lote com\nmotivo documentado e fix\nem 1 clique'],
    ['Tempo total',
     '~5 dias úteis (40 horas)',
     '~5 minutos · automatizado'],
    ['Auditabilidade',
     'Inexistente — fica perdido\nno e-mail ou no Slack',
     'Registro imutável em\nupdate_events para sempre'],
]

cmp_table = Table(compare_data, colWidths=[4*cm, 6.5*cm, 6*cm])
cmp_table.setStyle(TableStyle([
    # Header row
    ('FONT', (0,0),(-1,0), 'Helvetica-Bold', 9),
    ('TEXTCOLOR', (0,0),(0,0), white),
    ('TEXTCOLOR', (1,0),(1,0), white),
    ('TEXTCOLOR', (2,0),(2,0), INK),
    ('BACKGROUND', (1,0),(1,0), GREY),
    ('BACKGROUND', (2,0),(2,0), GOLD_SOFT),
    ('ALIGN', (0,0),(-1,0), 'CENTER'),
    ('LETTERSPACING', (0,0),(-1,0), 1.5),
    # Body
    ('FONT', (0,1),(0,-1), 'Helvetica-Bold', 9),
    ('TEXTCOLOR', (0,1),(0,-1), INK),
    ('FONT', (1,1),(-1,-1), 'Helvetica', 9),
    ('TEXTCOLOR', (1,1),(1,-1), GREY),
    ('TEXTCOLOR', (2,1),(2,-1), INK),
    ('VALIGN', (0,0),(-1,-1), 'TOP'),
    ('TOPPADDING', (0,0),(-1,-1), 10),
    ('BOTTOMPADDING', (0,0),(-1,-1), 10),
    ('LEFTPADDING', (0,0),(-1,-1), 10),
    ('RIGHTPADDING', (0,0),(-1,-1), 10),
    ('LINEBELOW', (0,0),(-1,-1), 0.3, DIVIDER),
    # Highlight last row
    ('BACKGROUND', (0,5),(-1,5), HexColor('#FAF7EE')),
    ('FONT', (0,5),(-1,5), 'Helvetica-Bold', 10),
    ('TEXTCOLOR', (2,5),(2,5), GOLD_DARK),
]))
story.append(cmp_table)

story.append(PageBreak())

# ── PAGE FINAL: RESUMO EXECUTIVO ─────────────────────────────────────────────
story.append(Paragraph('06', ParagraphStyle('CN', parent=S_LABEL, fontSize=11, textColor=GOLD, letterSpacing=4)))
story.append(Paragraph('Resumo Executivo', S_H1))
story.append(gold_divider(4*cm))
story.append(Spacer(1, 0.8*cm))

story.append(Paragraph(
    'O <b>TWK Data Intelligence Agent</b> é a evolução natural da gestão de dados na '
    'plataforma The World Keys. Ele combina velocidade computacional, validação contra '
    'a realidade externa, raciocínio semântico via IA e auditoria total — em uma '
    'experiência conversacional e visual de classe mundial.',
    S_BODY_LARGE,
))
story.append(Spacer(1, 0.6*cm))

story.append(Paragraph('"', ParagraphStyle('OpenQuote', parent=S_QUOTE, fontSize=48, textColor=GOLD, leading=20, leftIndent=0)))
story.append(Paragraph(
    'É como ter um time inteiro de analistas de dados, sem dormir, sem férias, '
    'que fica mais inteligente a cada dia — e nunca perde uma única alteração.',
    S_QUOTE,
))
story.append(Spacer(1, 1*cm))

story.append(Paragraph('CHECKLIST DE VALOR ENTREGUE', S_LABEL))
story.append(Spacer(1, 0.4*cm))

check_data = [
    ['✓', 'Auditoria completa de qualidade em segundos, não dias'],
    ['✓', 'Validação contra fontes externas (DNS, HTTP, Google Places, Geocoding)'],
    ['✓', 'Análise semântica via IA secundária para incoerências'],
    ['✓', 'Auto-correção com confiança graduada e revisão humana'],
    ['✓', 'Monitoramento contínuo com alertas de regressão'],
    ['✓', 'Auditoria imutável de toda mudança realizada'],
    ['✓', 'Central de Comando visual em tempo real, com command palette'],
    ['✓', 'Interface conversacional em português natural'],
    ['✓', 'Deploy pronto para EasyPanel · Docker · Vercel'],
    ['✓', '27 ferramentas especializadas no arsenal do agente'],
]

check_table = Table(check_data, colWidths=[0.8*cm, 15.7*cm])
check_table.setStyle(TableStyle([
    ('FONT', (0,0),(0,-1), 'Helvetica-Bold', 12),
    ('TEXTCOLOR', (0,0),(0,-1), EMERALD),
    ('VALIGN', (0,0),(-1,-1), 'TOP'),
    ('FONT', (1,0),(1,-1), 'Helvetica', 10),
    ('TEXTCOLOR', (1,0),(1,-1), INK),
    ('TOPPADDING', (0,0),(-1,-1), 8),
    ('BOTTOMPADDING', (0,0),(-1,-1), 8),
]))
story.append(check_table)

story.append(Spacer(1, 1.5*cm))
story.append(gold_divider(6*cm))
story.append(Spacer(1, 0.5*cm))
story.append(Paragraph('THE WORLD KEYS', ParagraphStyle('Final', parent=S_LABEL, alignment=TA_CENTER, textColor=GOLD)))
story.append(Paragraph('theworldkeys.com', ParagraphStyle('FinalUrl', parent=S_BODY, fontSize=9, alignment=TA_CENTER, textColor=GREY)))

# Build
doc.build(story)
print(f"PDF gerado com sucesso: {OUTPUT}")
