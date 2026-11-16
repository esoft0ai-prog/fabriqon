// Thin Chart.js wrapper: lazy-loads the bundled library and themes charts
// from CSS custom properties so light/dark mode stay consistent.
import { loadScript, money } from './utils.js';

const charts = new WeakMap();
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const palette = () => Array.from({ length: 8 }, (_, i) => css(`--chart-${i + 1}`));

async function ensureChart() {
  if (!window.Chart) await loadScript('js/vendor/chart.umd.js');
  const C = window.Chart;
  C.defaults.font.family = css('--font') || 'system-ui';
  C.defaults.font.size = 12;
  C.defaults.color = css('--text-2');
  C.defaults.borderColor = css('--chart-grid');
  C.defaults.plugins.legend.labels.boxWidth = 10;
  C.defaults.plugins.legend.labels.boxHeight = 10;
  C.defaults.plugins.legend.labels.useBorderRadius = true;
  C.defaults.plugins.legend.labels.borderRadius = 3;
  C.defaults.plugins.tooltip.backgroundColor = '#111B31';
  C.defaults.plugins.tooltip.padding = 10;
  C.defaults.plugins.tooltip.cornerRadius = 8;
  C.defaults.animation.duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500;
  return C;
}

function mount(canvas, config) {
  const prev = charts.get(canvas);
  if (prev) prev.destroy();
  const chart = new window.Chart(canvas, config);
  charts.set(canvas, chart);
  return chart;
}

const compact = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(v / 1e3).toFixed(0)}k`;
  return String(v);
};

export async function renderBarChart(canvas, { labels, datasets, money: isMoney = false, horizontal = false, stacked = false }) {
  if (!canvas) return null;
  try {
    await ensureChart();
  } catch {
    canvas.replaceWith(Object.assign(document.createElement('p'), { className: 'small muted', textContent: 'Chart unavailable.' }));
    return null;
  }
  const pal = palette();
  return mount(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map(d => ({
        label: d.label, data: d.data, type: d.type || 'bar',
        backgroundColor: d.type === 'line' ? pal[d.color ?? 0] : pal[d.color ?? 0],
        borderColor: pal[d.color ?? 0], borderWidth: d.type === 'line' ? 2 : 0,
        borderRadius: 6, maxBarThickness: 34, tension: 0.35, pointRadius: d.type === 'line' ? 3 : 0, order: d.type === 'line' ? 0 : 1,
      })),
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, position: 'bottom' },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${isMoney ? money(c.parsed[horizontal ? 'x' : 'y']) : c.parsed[horizontal ? 'x' : 'y']}` } },
      },
      scales: {
        x: { stacked, grid: { display: horizontal }, ticks: horizontal && isMoney ? { callback: compact } : {} },
        y: { stacked, beginAtZero: true, grid: { display: !horizontal }, ticks: !horizontal && isMoney ? { callback: compact } : { precision: 0 } },
      },
    },
  });
}

export async function renderDoughnut(canvas, { labels, data }) {
  if (!canvas) return null;
  try { await ensureChart(); } catch { return null; }
  const pal = palette();
  return mount(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: labels.map((_, i) => pal[i % pal.length]), borderWidth: 2, borderColor: css('--surface'), hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } },
  });
}

export const chartColors = palette;
