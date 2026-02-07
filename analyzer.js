import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// Leer URLs desde variable de entorno
const urlsFromEnv = process.env.LIGHTHOUSE_URLS || '';

if (!urlsFromEnv || urlsFromEnv.trim() === '') {
  console.error('\n❌ ERROR: No se encontró la variable LIGHTHOUSE_URLS');
  console.error('Por favor, configura la variable LIGHTHOUSE_URLS en GitHub Actions.');
  console.error('Ve a: Settings > Secrets and variables > Actions > Variables\n');
  process.exit(1);
}

const urls = urlsFromEnv
  .split(',')
  .map(url => url.trim())
  .filter(url => url.length > 0);

if (urls.length === 0) {
  console.error('\n❌ ERROR: La variable LIGHTHOUSE_URLS está vacía o no tiene URLs válidas');
  console.error('Formato esperado: https://example.com,https://example2.com\n');
  process.exit(1);
}

async function runLighthouse(url, preset = 'mobile') {
  const tempFile = `temp_${preset}_${Date.now()}.json`;
  
  const presetFlag = preset === 'desktop' ? '--preset=desktop' : '';
  
  const command = `lighthouse "${url}" ${presetFlag} --output=json --output-path="${tempFile}" --chrome-flags="--headless --no-sandbox" --only-categories=performance,accessibility,best-practices,seo --quiet`;
  
  try {
    await execAsync(command);
    
    const reportData = fs.readFileSync(tempFile, 'utf8');
    const report = JSON.parse(reportData);
    
    fs.unlinkSync(tempFile);
    
    return report;
  } catch (error) {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch (e) {}
    
    throw error;
  }
}

function extractMetrics(report) {
  const categories = report.categories;
  const audits = report.audits;
  
  return {
    performance: Math.round(categories.performance.score * 100),
    accessibility: Math.round(categories.accessibility.score * 100),
    bestPractices: Math.round(categories['best-practices'].score * 100),
    seo: Math.round(categories.seo.score * 100),
    // Métricas Core Web Vitals para el histórico
    fcp: audits['first-contentful-paint']?.numericValue ? Math.round(audits['first-contentful-paint'].numericValue) : null,
    lcp: audits['largest-contentful-paint']?.numericValue ? Math.round(audits['largest-contentful-paint'].numericValue) : null,
    tbt: audits['total-blocking-time']?.numericValue ? Math.round(audits['total-blocking-time'].numericValue) : null,
    cls: audits['cumulative-layout-shift']?.numericValue ? audits['cumulative-layout-shift'].numericValue : null,
    si: audits['speed-index']?.numericValue ? Math.round(audits['speed-index'].numericValue) : null
  };
}

async function analyzeUrls() {
  console.log('Iniciando análisis de Lighthouse (Desktop + Mobile)...\n');
  
  const results = [];
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] Analizando: ${url}`);
    
    const result = {
      url: url,
      desktop: {},
      mobile: {}
    };
    
    // Análisis MOBILE
    console.log('  📱 Ejecutando análisis Mobile...');
    try {
      const reportMobile = await runLighthouse(url, 'mobile');
      result.mobile = extractMetrics(reportMobile);
      console.log(`  ✓ Mobile completado: Performance=${result.mobile.performance}`);
    } catch (error) {
      console.error(`  ✗ Error en Mobile:`, error.message);
      result.mobile = {
        performance: null,
        accessibility: null,
        bestPractices: null,
        seo: null,
        fcp: null,
        lcp: null,
        tbt: null,
        cls: null,
        si: null,
        error: error.message
      };
    }
    
    // Análisis DESKTOP
    console.log('  🖥️  Ejecutando análisis Desktop...');
    try {
      const reportDesktop = await runLighthouse(url, 'desktop');
      result.desktop = extractMetrics(reportDesktop);
      console.log(`  ✓ Desktop completado: Performance=${result.desktop.performance}`);
    } catch (error) {
      console.error(`  ✗ Error en Desktop:`, error.message);
      result.desktop = {
        performance: null,
        accessibility: null,
        bestPractices: null,
        seo: null,
        fcp: null,
        lcp: null,
        tbt: null,
        cls: null,
        si: null,
        error: error.message
      };
    }
    
    results.push(result);
  }
  
  return results;
}

function saveHistoricalData(results) {
  // Crear directorio si no existe
  const historyDir = 'historical-data';
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true });
  }
  
  // Timestamp para el nombre del archivo
  const timestamp = new Date().toISOString();
  const filename = path.join(historyDir, `lighthouse_${timestamp.replace(/[:.]/g, '-').slice(0, -5)}.json`);
  
  // Estructura de datos históricos
  const historicalData = {
    timestamp: timestamp,
    date: new Date().toLocaleString('es-ES', { 
      dateStyle: 'full', 
      timeStyle: 'short',
      timeZone: 'Europe/Madrid'
    }),
    results: results
  };
  
  fs.writeFileSync(filename, JSON.stringify(historicalData, null, 2));
  console.log(`\n✓ Datos históricos guardados en: ${filename}`);
  
  return filename;
}

function saveResultsToCSV(results) {
  const csvHeader = 'URL,' +
    'Desktop Performance,Desktop Accessibility,Desktop Best Practices,Desktop SEO,Desktop FCP (ms),Desktop LCP (ms),Desktop TBT (ms),Desktop CLS,Desktop SI (ms),' +
    'Mobile Performance,Mobile Accessibility,Mobile Best Practices,Mobile SEO,Mobile FCP (ms),Mobile LCP (ms),Mobile TBT (ms),Mobile CLS,Mobile SI (ms)\n';
  
  const csvRows = results.map(result => {
    const d = result.desktop;
    const m = result.mobile;
    
    return `${result.url},` +
      `${d.performance ?? 'ERROR'},${d.accessibility ?? 'ERROR'},${d.bestPractices ?? 'ERROR'},${d.seo ?? 'ERROR'},${d.fcp ?? 'ERROR'},${d.lcp ?? 'ERROR'},${d.tbt ?? 'ERROR'},${d.cls ?? 'ERROR'},${d.si ?? 'ERROR'},` +
      `${m.performance ?? 'ERROR'},${m.accessibility ?? 'ERROR'},${m.bestPractices ?? 'ERROR'},${m.seo ?? 'ERROR'},${m.fcp ?? 'ERROR'},${m.lcp ?? 'ERROR'},${m.tbt ?? 'ERROR'},${m.cls ?? 'ERROR'},${m.si ?? 'ERROR'}`;
  }).join('\n');
  
  const csvContent = csvHeader + csvRows;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `lighthouse_results_${timestamp}.csv`;
  
  fs.writeFileSync(filename, csvContent);
  console.log(`✓ CSV guardado en: ${filename}`);
  
  return filename;
}

function generateSimplifiedHTMLEmail(results) {
  const date = new Date().toLocaleString('es-ES', { 
    dateStyle: 'full', 
    timeStyle: 'short',
    timeZone: 'Europe/Madrid'
  });
  
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f5f5f5;
      margin: 0;
      padding: 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      background-color: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #333;
      border-bottom: 3px solid #4CAF50;
      padding-bottom: 10px;
      margin-bottom: 20px;
    }
    .date {
      color: #666;
      font-size: 14px;
      margin-bottom: 20px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      font-size: 13px;
    }
    th {
      background-color: #4CAF50;
      color: white;
      padding: 12px 8px;
      text-align: center;
      font-weight: 600;
      border: 1px solid #ddd;
    }
    td {
      padding: 10px 8px;
      border: 1px solid #ddd;
      text-align: center;
    }
    .url-cell {
      text-align: left;
      font-weight: 500;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    tr:nth-child(even) {
      background-color: #f9f9f9;
    }
    tr:hover {
      background-color: #f0f0f0;
    }
    .device-header {
      background-color: #2196F3;
      color: white;
    }
    .score {
      font-weight: 600;
      font-size: 14px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      text-align: center;
      color: #666;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Lighthouse Analysis Report</h1>
    <div class="date">Fecha: ${date}</div>
    <div class="date">URLs analizadas: ${results.length}</div>
    
    <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; margin: 20px 0; border-radius: 4px;">
      <p style="margin: 0; color: #1976d2; font-weight: 600; font-size: 14px;">
        📊 <strong>Dashboard Histórico:</strong> 
        <a href="https://analyzerbotreporter-crypto.github.io/HL/dashboard.html" 
           style="color: #1976d2; text-decoration: none; border-bottom: 2px solid #2196F3;">
          Ver evolución de todas las métricas
        </a>
      </p>
    </div>
    
    <table>
      <thead>
        <tr>
          <th rowspan="2" style="vertical-align: middle;">URL</th>
          <th colspan="4" class="device-header">🖥️ DESKTOP</th>
          <th colspan="4" class="device-header">📱 MOBILE</th>
        </tr>
        <tr>
          <th>Perf</th>
          <th>Acc</th>
          <th>BP</th>
          <th>SEO</th>
          <th>Perf</th>
          <th>Acc</th>
          <th>BP</th>
          <th>SEO</th>
        </tr>
      </thead>
      <tbody>
`;

  results.forEach(result => {
    const d = result.desktop;
    const m = result.mobile;
    
    html += `        <tr>
          <td class="url-cell" title="${result.url}">${result.url}</td>
          <td class="score">${getEmojiHTML(d.performance)} ${d.performance ?? 'ERR'}</td>
          <td class="score">${getEmojiHTML(d.accessibility)} ${d.accessibility ?? 'ERR'}</td>
          <td class="score">${getEmojiHTML(d.bestPractices)} ${d.bestPractices ?? 'ERR'}</td>
          <td class="score">${getEmojiHTML(d.seo)} ${d.seo ?? 'ERR'}</td>
          <td class="score">${getEmojiHTML(m.performance)} ${m.performance ?? 'ERR'}</td>
          <td class="score">${getEmojiHTML(m.accessibility)} ${m.accessibility ?? 'ERR'}</td>
          <td class="score">${getEmojiHTML(m.bestPractices)} ${m.bestPractices ?? 'ERR'}</td>
          <td class="score">${getEmojiHTML(m.seo)} ${m.seo ?? 'ERR'}</td>
        </tr>
`;
  });

  html += `      </tbody>
    </table>
    
    <div class="footer">
      <p>🟢 ≥90 | 🟡 50-89 | 🔴 <50</p>
      <p>Generado automáticamente por Lighthouse Analyzer</p>
      <p style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #ddd; font-size: 13px; color: #495057;">
        <strong>Leyenda de métricas:</strong><br>
        <span style="display: inline-block; margin-right: 15px;">⚡ <strong>Perf</strong> = Performance</span>
        <span style="display: inline-block; margin-right: 15px;">♿ <strong>Acc</strong> = Accessibility</span>
        <span style="display: inline-block; margin-right: 15px;">✨ <strong>BP</strong> = Best Practices</span>
        <span style="display: inline-block;">🔍 <strong>SEO</strong> = Search Engine Optimization</span>
      </p>
    </div>
    
  </div>
</body>
</html>`;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `lighthouse_email_${timestamp}.html`;
  
  fs.writeFileSync(filename, html);
  console.log(`✓ Email HTML guardado en: ${filename}`);
  
  return filename;
}

function getEmojiHTML(score) {
  if (score === null || score === undefined) return '⚫';
  if (score >= 90) return '🟢';
  if (score >= 50) return '🟡';
  return '🔴';
}

// Ejecutar el análisis
console.log('='.repeat(60));
console.log('LIGHTHOUSE ANALYZER - Desktop & Mobile');
console.log('='.repeat(60));
console.log(`URLs a analizar: ${urls.length}`);
console.log('URLs cargadas desde variable LIGHTHOUSE_URLS');
console.log('='.repeat(60));

analyzeUrls()
  .then(results => {
    const csvFilename = saveResultsToCSV(results);
    const htmlFilename = generateSimplifiedHTMLEmail(results);
    const historyFilename = saveHistoricalData(results);
    
    console.log('\n' + '='.repeat(60));
    console.log('¡Análisis completado exitosamente!');
    console.log(`Archivo CSV: ${csvFilename}`);
    console.log(`Email HTML: ${htmlFilename}`);
    console.log(`Histórico JSON: ${historyFilename}`);
    console.log('='.repeat(60));
    
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Error fatal:', error);
    process.exit(1);
  });
