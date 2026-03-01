import { createRequire } from 'module';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pptxgen = require('pptxgenjs') as typeof import('pptxgenjs').default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESENTATIONS_DIR = path.resolve(__dirname, '../../../data/presentations');

// CoWork emerald/teal brand colors
const COLORS = {
  bg: '0A1628',           // dark background
  slide_bg: '0D1F35',     // slightly lighter card bg
  accent: '10B981',       // emerald green
  accent_dark: '059669',  // darker emerald
  gold: 'F59E0B',         // gold accent
  text: 'E2E8F0',         // light text
  muted: '94A3B8',        // muted text
  white: 'FFFFFF',
  header_bg: '0F2744',    // header/footer band
};

export type SlideTemplate =
  | 'insight'
  | 'comparison'
  | 'timeline'
  | 'metrics'
  | 'process'
  | 'quote'
  | 'two-column';

export interface Slide {
  title: string;
  bullets?: string[];
  content?: string;
  isTitle?: boolean;
  template?: SlideTemplate | string;
  leftTitle?: string;
  rightTitle?: string;
  source?: string;
}

export interface CreatePresentationArgs {
  title: string;
  subtitle?: string;
  slides: Slide[];
  author?: string;
}

function normalizeTemplate(template?: string): SlideTemplate {
  const t = (template || 'insight').trim().toLowerCase();
  if (t === 'comparison') return 'comparison';
  if (t === 'timeline') return 'timeline';
  if (t === 'metrics') return 'metrics';
  if (t === 'process') return 'process';
  if (t === 'quote') return 'quote';
  if (t === 'two-column' || t === 'two column' || t === '2-column') return 'two-column';
  return 'insight';
}

function trimPrefix(text: string, prefixes: string[]): string {
  const lower = text.toLowerCase();
  for (const p of prefixes) {
    if (lower.startsWith(p)) return text.slice(p.length).trim();
  }
  return text.trim();
}

function toComparisonColumns(slide: Slide): { left: string[]; right: string[] } {
  const input = (slide.bullets || []).map(b => b.trim()).filter(Boolean);
  const left: string[] = [];
  const right: string[] = [];

  for (const b of input) {
    const lower = b.toLowerCase();
    if (lower.startsWith('left:') || lower.startsWith('a:') || lower.startsWith('option a:')) {
      left.push(trimPrefix(b, ['left:', 'a:', 'option a:']));
      continue;
    }
    if (lower.startsWith('right:') || lower.startsWith('b:') || lower.startsWith('option b:')) {
      right.push(trimPrefix(b, ['right:', 'b:', 'option b:']));
      continue;
    }
    const split = b.split('|').map(s => s.trim()).filter(Boolean);
    if (split.length === 2) {
      left.push(split[0]);
      right.push(split[1]);
      continue;
    }
    // fallback: alternate assignment
    if (left.length <= right.length) left.push(b);
    else right.push(b);
  }

  if (left.length === 0 && right.length === 0 && slide.content) {
    left.push(slide.content);
  }
  return { left, right };
}

function toMetrics(slide: Slide): Array<{ label: string; value: string }> {
  const metrics: Array<{ label: string; value: string }> = [];
  for (const b of slide.bullets || []) {
    const idx = b.indexOf(':');
    if (idx > 0) {
      metrics.push({
        label: b.slice(0, idx).trim(),
        value: b.slice(idx + 1).trim(),
      });
    } else {
      metrics.push({ label: 'Metric', value: b.trim() });
    }
  }
  if (metrics.length === 0 && slide.content) {
    metrics.push({ label: 'Summary', value: slide.content });
  }
  return metrics.slice(0, 6);
}

function renderInsightSlide(s: any, slide: Slide): void {
  if (slide.bullets && slide.bullets.length > 0) {
    const bulletItems = slide.bullets.map(b => ({
      text: b,
      options: {
        bullet: { type: 'bullet' as const },
        fontSize: 18,
        color: COLORS.text,
        fontFace: 'Segoe UI',
        paraSpaceAfter: 8,
      },
    }));
    s.addText(bulletItems, {
      x: 0.5, y: 1.45, w: 12.2, h: 5.4,
      valign: 'top',
      lineSpacingMultiple: 1.3,
    });
    return;
  }

  if (slide.content) {
    s.addText(slide.content, {
      x: 0.5, y: 1.45, w: 12.2, h: 5.4,
      fontSize: 18,
      color: COLORS.text,
      fontFace: 'Segoe UI',
      valign: 'top',
      wrap: true,
      lineSpacingMultiple: 1.4,
    });
  }
}

function renderComparisonSlide(s: any, slide: Slide, pptx: any): void {
  const { left, right } = toComparisonColumns(slide);
  const leftTitle = slide.leftTitle || 'Option A';
  const rightTitle = slide.rightTitle || 'Option B';

  s.addShape(pptx.ShapeType.roundRect, {
    x: 0.5, y: 1.55, w: 5.85, h: 5.45,
    fill: { color: COLORS.slide_bg, transparency: 8 },
    line: { color: COLORS.accent, width: 1.2 },
    radius: 0.12,
  });
  s.addShape(pptx.ShapeType.roundRect, {
    x: 6.85, y: 1.55, w: 5.85, h: 5.45,
    fill: { color: COLORS.slide_bg, transparency: 8 },
    line: { color: COLORS.gold, width: 1.2 },
    radius: 0.12,
  });

  s.addText(leftTitle, {
    x: 0.75, y: 1.75, w: 5.35, h: 0.45,
    fontSize: 16, bold: true, color: COLORS.accent, fontFace: 'Segoe UI',
  });
  s.addText(rightTitle, {
    x: 7.1, y: 1.75, w: 5.35, h: 0.45,
    fontSize: 16, bold: true, color: COLORS.gold, fontFace: 'Segoe UI',
  });

  const leftItems = left.map(t => ({
    text: t,
    options: { bullet: { type: 'bullet' as const }, fontSize: 15, color: COLORS.text, paraSpaceAfter: 7 },
  }));
  const rightItems = right.map(t => ({
    text: t,
    options: { bullet: { type: 'bullet' as const }, fontSize: 15, color: COLORS.text, paraSpaceAfter: 7 },
  }));

  if (leftItems.length > 0) {
    s.addText(leftItems, { x: 0.75, y: 2.25, w: 5.1, h: 4.45, lineSpacingMultiple: 1.2, valign: 'top' });
  }
  if (rightItems.length > 0) {
    s.addText(rightItems, { x: 7.1, y: 2.25, w: 5.1, h: 4.45, lineSpacingMultiple: 1.2, valign: 'top' });
  }
}

function renderTimelineSlide(s: any, slide: Slide, pptx: any): void {
  const milestones = (slide.bullets || []).map(b => b.trim()).filter(Boolean).slice(0, 5);
  if (milestones.length === 0) {
    renderInsightSlide(s, slide);
    return;
  }

  const y = 4.1;
  s.addShape(pptx.ShapeType.line, {
    x: 1.0, y, w: 10.9, h: 0,
    line: { color: COLORS.muted, width: 1.4 },
  });

  const stepW = milestones.length > 1 ? 10.2 / (milestones.length - 1) : 0;
  milestones.forEach((m, i) => {
    const x = 1.35 + i * stepW;
    s.addShape(pptx.ShapeType.ellipse, {
      x: x - 0.14, y: y - 0.14, w: 0.28, h: 0.28,
      fill: { color: COLORS.accent },
      line: { color: COLORS.white, width: 0.6 },
    });
    s.addText(String(i + 1), {
      x: x - 0.2, y: y - 0.85, w: 0.4, h: 0.25,
      fontSize: 11, bold: true, color: COLORS.accent, align: 'center',
    });
    s.addText(m, {
      x: x - 1.05, y: y + 0.18, w: 2.1, h: 1.25,
      fontSize: 13, color: COLORS.text, align: 'center', valign: 'top', breakLine: true,
    });
  });
}

function renderMetricsSlide(s: any, slide: Slide, pptx: any): void {
  const metrics = toMetrics(slide);
  if (metrics.length === 0) {
    renderInsightSlide(s, slide);
    return;
  }

  const cols = metrics.length <= 3 ? metrics.length : 3;
  const cardW = cols === 1 ? 11.8 : cols === 2 ? 5.75 : 3.75;
  const gap = cols === 1 ? 0 : 0.35;

  metrics.forEach((metric, idx) => {
    const row = Math.floor(idx / cols);
    const col = idx % cols;
    const x = 0.6 + col * (cardW + gap);
    const y = 1.6 + row * 2.45;
    const isAccent = idx % 2 === 0;

    s.addShape(pptx.ShapeType.roundRect, {
      x, y, w: cardW, h: 2.15,
      fill: { color: COLORS.slide_bg, transparency: 4 },
      line: { color: isAccent ? COLORS.accent : COLORS.gold, width: 1.1 },
      radius: 0.1,
    });

    s.addText(metric.value, {
      x: x + 0.22, y: y + 0.34, w: cardW - 0.44, h: 0.95,
      fontSize: 30,
      bold: true,
      color: isAccent ? COLORS.accent : COLORS.gold,
      align: 'left',
      valign: 'middle',
    });
    s.addText(metric.label, {
      x: x + 0.22, y: y + 1.42, w: cardW - 0.44, h: 0.52,
      fontSize: 13,
      color: COLORS.text,
      breakLine: true,
    });
  });
}

function renderProcessSlide(s: any, slide: Slide, pptx: any): void {
  const steps = (slide.bullets || []).map(b => b.trim()).filter(Boolean).slice(0, 6);
  if (steps.length === 0) {
    renderInsightSlide(s, slide);
    return;
  }

  steps.forEach((step, idx) => {
    const y = 1.55 + idx * 0.88;
    s.addShape(pptx.ShapeType.roundRect, {
      x: 0.9, y, w: 11.5, h: 0.72,
      fill: { color: COLORS.slide_bg, transparency: 5 },
      line: { color: COLORS.accent_dark, width: 1 },
      radius: 0.08,
    });
    s.addShape(pptx.ShapeType.ellipse, {
      x: 1.1, y: y + 0.12, w: 0.48, h: 0.48,
      fill: { color: COLORS.accent },
      line: { color: COLORS.white, width: 0.6 },
    });
    s.addText(String(idx + 1), {
      x: 1.1, y: y + 0.11, w: 0.48, h: 0.48,
      fontSize: 12,
      bold: true,
      color: COLORS.white,
      align: 'center',
      valign: 'middle',
    });
    s.addText(step, {
      x: 1.75, y: y + 0.15, w: 10.3, h: 0.45,
      fontSize: 15,
      color: COLORS.text,
      fontFace: 'Segoe UI',
    });
    if (idx < steps.length - 1) {
      s.addShape(pptx.ShapeType.line, {
        x: 1.34, y: y + 0.72, w: 0, h: 0.16,
        line: { color: COLORS.muted, width: 0.8 },
      });
    }
  });
}

function renderQuoteSlide(s: any, slide: Slide, pptx: any): void {
  const quote = slide.content || (slide.bullets?.[0] || '').trim();
  const source = slide.source || slide.bullets?.[1] || '';
  if (!quote) {
    renderInsightSlide(s, slide);
    return;
  }

  s.addShape(pptx.ShapeType.roundRect, {
    x: 1.0, y: 1.8, w: 11.35, h: 3.7,
    fill: { color: COLORS.slide_bg, transparency: 6 },
    line: { color: COLORS.accent, width: 1.2 },
    radius: 0.12,
  });
  s.addText('“', {
    x: 1.25, y: 2.05, w: 0.7, h: 0.7,
    fontSize: 56,
    bold: true,
    color: COLORS.accent,
  });
  s.addText(quote, {
    x: 1.95, y: 2.35, w: 9.8, h: 2.4,
    fontSize: 26,
    bold: true,
    color: COLORS.text,
    italic: true,
    align: 'center',
    valign: 'middle',
    breakLine: true,
  });
  if (source) {
    s.addText(`— ${source}`, {
      x: 2.0, y: 5.55, w: 9.8, h: 0.45,
      fontSize: 13,
      color: COLORS.muted,
      align: 'right',
      italic: true,
    });
  }
}

function renderTwoColumnSlide(s: any, slide: Slide, pptx: any): void {
  const bullets = (slide.bullets || []).map(b => b.trim()).filter(Boolean);
  s.addShape(pptx.ShapeType.line, {
    x: 6.55, y: 1.6, w: 0, h: 5.25,
    line: { color: COLORS.muted, width: 1.1 },
  });
  if (bullets.length > 0) {
    const bulletItems = bullets.map(b => ({
      text: b,
      options: { bullet: { type: 'bullet' as const }, fontSize: 15, color: COLORS.text, paraSpaceAfter: 7 },
    }));
    s.addText(bulletItems, {
      x: 0.55, y: 1.65, w: 5.7, h: 5.1,
      lineSpacingMultiple: 1.2,
      valign: 'top',
    });
  }
  if (slide.content) {
    s.addText(slide.content, {
      x: 6.9, y: 1.7, w: 5.5, h: 5.1,
      fontSize: 16,
      color: COLORS.text,
      valign: 'top',
      breakLine: true,
      lineSpacingMultiple: 1.25,
    });
  }
}

export async function createPresentation(args: CreatePresentationArgs): Promise<string> {
  fs.mkdirSync(PRESENTATIONS_DIR, { recursive: true });

  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_WIDE'; // 16:9

  // Define master theme
  pptx.defineSlideMaster({
    title: 'COWORK_MASTER',
    background: { color: COLORS.bg },
    objects: [
      // Bottom accent bar
      { rect: { x: 0, y: 7.0, w: '100%', h: 0.5, fill: { color: COLORS.accent_dark } } },
      // Subtle top line
      { rect: { x: 0, y: 0, w: '100%', h: 0.06, fill: { color: COLORS.accent } } },
    ],
  });

  // ── TITLE SLIDE ──────────────────────────────────────────────────────
  const titleSlide = pptx.addSlide({ masterName: 'COWORK_MASTER' });

  // Background gradient block (left accent)
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: 7.5,
    fill: { color: COLORS.accent },
  });

  // Decorative emerald circle (background element)
  titleSlide.addShape(pptx.ShapeType.ellipse, {
    x: 8.5, y: -1.2, w: 4, h: 4,
    fill: { color: COLORS.accent_dark },
    line: { color: COLORS.accent, width: 2 },
  });
  titleSlide.addShape(pptx.ShapeType.ellipse, {
    x: 9.2, y: -0.5, w: 2.5, h: 2.5,
    fill: { color: COLORS.accent },
    line: { color: COLORS.white, width: 1 },
  });

  // Title text
  titleSlide.addText(args.title, {
    x: 0.55, y: 2.2, w: 9.5, h: 1.8,
    fontSize: 44,
    bold: true,
    color: COLORS.white,
    fontFace: 'Segoe UI',
    charSpacing: 1,
  });

  // Subtitle / gold divider line
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0.55, y: 4.1, w: 2.5, h: 0.06,
    fill: { color: COLORS.gold },
  });

  if (args.subtitle) {
    titleSlide.addText(args.subtitle, {
      x: 0.55, y: 4.3, w: 9, h: 0.7,
      fontSize: 20,
      color: COLORS.muted,
      fontFace: 'Segoe UI',
      italic: true,
    });
  }

  // Author / date
  const byLine = [
    args.author ? `By ${args.author}` : '',
    new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long' }),
  ].filter(Boolean).join('  ·  ');

  titleSlide.addText(byLine, {
    x: 0.55, y: 6.5, w: 9, h: 0.4,
    fontSize: 13,
    color: COLORS.muted,
    fontFace: 'Segoe UI',
  });

  // ── CONTENT SLIDES ────────────────────────────────────────────────────
  args.slides.forEach((slide, idx) => {
    const s = pptx.addSlide({ masterName: 'COWORK_MASTER' });
    const template = normalizeTemplate(slide.template);

    // Left accent stripe
    s.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0.06, w: 0.12, h: 7.44,
      fill: { color: COLORS.accent_dark },
    });

    // Header background band
    s.addShape(pptx.ShapeType.rect, {
      x: 0.12, y: 0.06, w: 13.21, h: 1.1,
      fill: { color: COLORS.header_bg },
    });

    // Slide number badge
    s.addShape(pptx.ShapeType.ellipse, {
      x: 12.1, y: 0.15, w: 0.7, h: 0.7,
      fill: { color: COLORS.accent },
    });
    s.addText(String(idx + 1), {
      x: 12.1, y: 0.15, w: 0.7, h: 0.7,
      fontSize: 13,
      bold: true,
      color: COLORS.white,
      align: 'center',
      valign: 'middle',
      fontFace: 'Segoe UI',
    });

    // Slide title
    s.addText(slide.title, {
      x: 0.35, y: 0.12, w: 11.6, h: 0.9,
      fontSize: 26,
      bold: true,
      color: COLORS.white,
      fontFace: 'Segoe UI',
      charSpacing: 0.5,
    });

    // Gold accent underline
    s.addShape(pptx.ShapeType.rect, {
      x: 0.35, y: 1.22, w: 1.2, h: 0.05,
      fill: { color: COLORS.gold },
    });

    s.addText(template.toUpperCase(), {
      x: 11.05, y: 0.95, w: 1.7, h: 0.25,
      fontSize: 8,
      bold: true,
      color: COLORS.muted,
      align: 'right',
    });

    if (template === 'comparison') {
      renderComparisonSlide(s, slide, pptx);
    } else if (template === 'timeline') {
      renderTimelineSlide(s, slide, pptx);
    } else if (template === 'metrics') {
      renderMetricsSlide(s, slide, pptx);
    } else if (template === 'process') {
      renderProcessSlide(s, slide, pptx);
    } else if (template === 'quote') {
      renderQuoteSlide(s, slide, pptx);
    } else if (template === 'two-column') {
      renderTwoColumnSlide(s, slide, pptx);
    } else {
      renderInsightSlide(s, slide);
    }
  });

  // ── THANK YOU SLIDE ───────────────────────────────────────────────────
  const endSlide = pptx.addSlide({ masterName: 'COWORK_MASTER' });

  endSlide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: 7.5,
    fill: { color: COLORS.gold },
  });

  endSlide.addShape(pptx.ShapeType.ellipse, {
    x: -1, y: 4.5, w: 5, h: 5,
    fill: { color: COLORS.accent_dark },
    line: { color: COLORS.accent, width: 1 },
  });

  endSlide.addText('Thank You', {
    x: 0.55, y: 2.5, w: 12, h: 1.5,
    fontSize: 52,
    bold: true,
    color: COLORS.white,
    fontFace: 'Segoe UI',
    align: 'center',
  });
  endSlide.addShape(pptx.ShapeType.rect, {
    x: 5.25, y: 4.1, w: 2.8, h: 0.06,
    fill: { color: COLORS.gold },
  });
  endSlide.addText(args.title, {
    x: 0.55, y: 4.3, w: 12, h: 0.6,
    fontSize: 18,
    color: COLORS.muted,
    fontFace: 'Segoe UI',
    align: 'center',
    italic: true,
  });

  // ── SAVE FILE ─────────────────────────────────────────────────────────
  const safeName = args.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
  const timestamp = Date.now();
  const filename = `${safeName}-${timestamp}.pptx`;
  const filePath = path.join(PRESENTATIONS_DIR, filename);

  await pptx.writeFile({ fileName: filePath });
  return filename;
}
