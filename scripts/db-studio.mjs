import http from "node:http";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { exec } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (configured) return configured;
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "9router");
  }
  return path.join(os.homedir(), ".9router");
}

const dbPath = path.join(getDataDir(), "db", "data.sqlite");

if (!fs.existsSync(dbPath)) {
  console.error(`[db:studio] SQLite database file not found at: ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: false });

const PORT = Number(process.env.PORT || 4983);

function getTables() {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC").all();
  return rows.map((r) => r.name);
}

function getTableSchema(table) {
  return db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all();
}

function getTableData(table, page = 1, pageSize = 50, sortCol = null, sortDir = "ASC") {
  const safeTable = table.replace(/"/g, '""');
  const countRow = db.prepare(`SELECT COUNT(*) as total FROM "${safeTable}"`).get();
  const total = Number(countRow.total || 0);

  let orderClause = "";
  if (sortCol) {
    const safeCol = sortCol.replace(/"/g, '""');
    const dir = sortDir?.toUpperCase() === "DESC" ? "DESC" : "ASC";
    orderClause = `ORDER BY "${safeCol}" ${dir}`;
  }

  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`SELECT * FROM "${safeTable}" ${orderClause} LIMIT ${pageSize} OFFSET ${offset}`).all();

  return { total, page, pageSize, rows };
}

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>9Router Database Studio</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    :root {
      --pico-font-size: 14px;
      --pico-border-radius: 8px;
    }
    body {
      padding: 0;
      margin: 0;
      display: flex;
      height: 100vh;
      background: #0f172a;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
    }
    aside {
      width: 280px;
      background: #1e293b;
      border-right: 1px solid #334155;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .brand {
      padding: 16px 20px;
      border-bottom: 1px solid #334155;
      font-size: 16px;
      font-weight: 700;
      color: #38bdf8;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand-badge {
      font-size: 11px;
      background: #0284c7;
      color: white;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 500;
    }
    .db-path {
      padding: 8px 16px;
      font-size: 11px;
      color: #94a3b8;
      background: #0f172a88;
      word-break: break-all;
      border-bottom: 1px solid #334155;
    }
    .table-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px 8px;
      list-style: none;
      margin: 0;
    }
    .table-item {
      padding: 10px 14px;
      border-radius: 6px;
      cursor: pointer;
      color: #cbd5e1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 4px;
      transition: all 0.15s;
    }
    .table-item:hover {
      background: #334155;
      color: white;
    }
    .table-item.active {
      background: #0284c7;
      color: white;
      font-weight: 600;
    }
    .tab-sql {
      padding: 12px;
      border-top: 1px solid #334155;
    }
    .tab-sql button {
      width: 100%;
      margin: 0;
      padding: 8px;
      font-size: 13px;
    }
    main {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: #0f172a;
    }
    header {
      height: 56px;
      padding: 0 24px;
      border-bottom: 1px solid #334155;
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #1e293b;
      flex-shrink: 0;
    }
    .header-title {
      font-size: 16px;
      font-weight: 600;
      color: #f1f5f9;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .content-area {
      flex: 1;
      overflow: auto;
      padding: 16px;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .data-table th, .data-table td {
      border: 1px solid #334155;
      padding: 8px 12px;
      text-align: left;
      white-space: nowrap;
      max-width: 320px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .data-table th {
      background: #1e293b;
      position: sticky;
      top: 0;
      z-index: 10;
      color: #94a3b8;
      font-weight: 600;
    }
    .data-table tr:hover td {
      background: #1e293b88;
    }
    .json-cell {
      font-family: monospace;
      color: #38bdf8;
      cursor: pointer;
    }
    .json-cell:hover {
      text-decoration: underline;
    }
    .pagination {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 12px;
      padding: 10px 24px;
      background: #1e293b;
      border-top: 1px solid #334155;
      flex-shrink: 0;
    }
    .pagination button {
      padding: 4px 12px;
      margin: 0;
      font-size: 12px;
    }
    .modal-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal-content {
      background: #1e293b;
      border: 1px solid #475569;
      border-radius: 10px;
      width: 600px;
      max-width: 90vw;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .modal-header {
      padding: 14px 20px;
      border-bottom: 1px solid #334155;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 600;
    }
    .modal-body {
      padding: 16px 20px;
      overflow-y: auto;
      flex: 1;
    }
    .modal-body pre {
      background: #0f172a;
      padding: 14px;
      border-radius: 6px;
      color: #38bdf8;
      font-size: 12px;
      overflow-x: auto;
    }
    .sql-editor-wrap {
      display: flex;
      flex-direction: column;
      gap: 12px;
      height: 100%;
    }
    .sql-textarea {
      width: 100%;
      height: 120px;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 12px;
      font-family: monospace;
      font-size: 14px;
      resize: vertical;
    }
  </style>
</head>
<body>
  <aside>
    <div class="brand">
      <span>9Router Studio</span>
      <span class="brand-badge">SQLite</span>
    </div>
    <div class="db-path" id="db-path-el">Loading...</div>
    <ul class="table-list" id="table-list"></ul>
    <div class="tab-sql">
      <button class="secondary outline" onclick="openSqlTab()">⚡ Run SQL Query</button>
    </div>
  </aside>

  <main>
    <header>
      <div class="header-title" id="main-title">Select a table</div>
      <div id="header-actions"></div>
    </header>

    <div class="content-area" id="content-area">
      <div style="color: #64748b; padding: 40px; text-align: center;">Select a table from the sidebar to view records.</div>
    </div>

    <div class="pagination" id="pagination" style="display: none;">
      <span id="page-info" style="font-size: 12px; color: #94a3b8;"></span>
      <button class="secondary" id="btn-prev" onclick="changePage(-1)">Previous</button>
      <button class="secondary" id="btn-next" onclick="changePage(1)">Next</button>
    </div>
  </main>

  <div class="modal-backdrop" id="cell-modal" onclick="closeModal(event)">
    <div class="modal-content" onclick="event.stopPropagation()">
      <div class="modal-header">
        <span id="modal-title">Cell Detail</span>
        <button style="width: auto; padding: 2px 8px; margin: 0;" class="outline secondary" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">
        <pre id="modal-json"></pre>
      </div>
    </div>
  </div>

  <script>
    let currentTable = null;
    let isSqlMode = false;
    let currentPage = 1;
    let currentTotal = 0;
    const pageSize = 50;

    async function init() {
      const res = await fetch('/api/info');
      const data = await res.json();
      document.getElementById('db-path-el').innerText = data.path;

      const listEl = document.getElementById('table-list');
      listEl.innerHTML = '';
      data.tables.forEach((t, i) => {
        const li = document.createElement('li');
        li.className = 'table-item';
        li.innerHTML = '<span>📄 ' + t + '</span>';
        li.onclick = () => loadTable(t);
        listEl.appendChild(li);
        if (i === 0 && !currentTable) {
          loadTable(t);
        }
      });
    }

    async function loadTable(table, page = 1) {
      isSqlMode = false;
      currentTable = table;
      currentPage = page;

      document.querySelectorAll('.table-item').forEach(el => {
        el.classList.toggle('active', el.innerText.includes(table));
      });

      document.getElementById('main-title').innerHTML = '<span>Table: <b>' + table + '</b></span>';
      document.getElementById('header-actions').innerHTML = '<button class="outline secondary" style="padding: 4px 10px; font-size: 12px; margin:0;" onclick="loadTable(\\'' + table + '\\', ' + page + ')">↻ Refresh</button>';

      const res = await fetch('/api/table?name=' + encodeURIComponent(table) + '&page=' + page + '&pageSize=' + pageSize);
      const result = await res.json();
      currentTotal = result.total;

      renderTable(result.schema, result.rows);
      renderPagination();
    }

    function renderTable(schema, rows) {
      const content = document.getElementById('content-area');
      if (!rows || rows.length === 0) {
        content.innerHTML = '<div style="color: #64748b; padding: 40px; text-align: center;">No records found.</div>';
        return;
      }

      const columns = schema ? schema.map(s => s.name) : Object.keys(rows[0]);
      let html = '<table class="data-table"><thead><tr>';
      columns.forEach(col => {
        html += '<th>' + col + '</th>';
      });
      html += '</tr></thead><tbody>';

      rows.forEach(row => {
        html += '<tr>';
        columns.forEach(col => {
          let val = row[col];
          if (val === null || val === undefined) {
            html += '<td style="color: #64748b; font-style: italic;">NULL</td>';
          } else if (typeof val === 'string' && (val.startsWith('{') || val.startsWith('['))) {
            try {
              JSON.parse(val);
              const escaped = encodeURIComponent(val);
              html += '<td class="json-cell" onclick="openJsonModal(\\'' + escaped + '\\', \\'' + col + '\\')">' + escapeHtml(val) + '</td>';
            } catch(e) {
              html += '<td>' + escapeHtml(String(val)) + '</td>';
            }
          } else {
            html += '<td>' + escapeHtml(String(val)) + '</td>';
          }
        });
        html += '</tr>';
      });

      html += '</tbody></table>';
      content.innerHTML = html;
    }

    function renderPagination() {
      const pag = document.getElementById('pagination');
      if (isSqlMode || currentTotal <= pageSize) {
        pag.style.display = 'none';
        return;
      }
      pag.style.display = 'flex';
      const maxPage = Math.ceil(currentTotal / pageSize) || 1;
      document.getElementById('page-info').innerText = 'Page ' + currentPage + ' of ' + maxPage + ' (' + currentTotal + ' total rows)';
      document.getElementById('btn-prev').disabled = currentPage <= 1;
      document.getElementById('btn-next').disabled = currentPage >= maxPage;
    }

    function changePage(delta) {
      loadTable(currentTable, currentPage + delta);
    }

    function openSqlTab() {
      isSqlMode = true;
      document.querySelectorAll('.table-item').forEach(el => el.classList.remove('active'));
      document.getElementById('main-title').innerHTML = '<span>⚡ SQL Query Console</span>';
      document.getElementById('header-actions').innerHTML = '';
      document.getElementById('pagination').style.display = 'none';

      const content = document.getElementById('content-area');
      content.innerHTML = \`
        <div class="sql-editor-wrap">
          <textarea id="sql-input" class="sql-textarea" placeholder="SELECT * FROM providerConnections LIMIT 10;"></textarea>
          <div>
            <button onclick="executeSql()" style="padding: 6px 16px; margin: 0;">Execute Query (Ctrl/Cmd + Enter)</button>
          </div>
          <div id="sql-result" style="flex: 1; overflow: auto;"></div>
        </div>
      \`;

      const input = document.getElementById('sql-input');
      input.focus();
      input.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          executeSql();
        }
      });
    }

    async function executeSql() {
      const sql = document.getElementById('sql-input').value.trim();
      if (!sql) return;

      const resultArea = document.getElementById('sql-result');
      resultArea.innerHTML = '<div style="color: #94a3b8; padding: 20px;">Running...</div>';

      try {
        const res = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql })
        });
        const data = await res.json();
        if (data.error) {
          resultArea.innerHTML = '<div style="color: #ef4444; background: #450a0a; padding: 12px; border-radius: 6px;">Error: ' + escapeHtml(data.error) + '</div>';
          return;
        }

        if (Array.isArray(data.rows)) {
          if (data.rows.length === 0) {
            resultArea.innerHTML = '<div style="color: #22c55e; padding: 12px;">Query executed successfully. 0 rows returned.</div>';
            return;
          }
          const columns = Object.keys(data.rows[0]);
          let html = '<div style="color: #22c55e; margin-bottom: 8px;">Returned ' + data.rows.length + ' rows (' + data.durationMs + 'ms):</div>';
          html += '<table class="data-table"><thead><tr>';
          columns.forEach(col => html += '<th>' + col + '</th>');
          html += '</tr></thead><tbody>';
          data.rows.forEach(r => {
            html += '<tr>';
            columns.forEach(col => {
              const val = r[col];
              html += '<td>' + escapeHtml(val === null ? 'NULL' : String(val)) + '</td>';
            });
            html += '</tr>';
          });
          html += '</tbody></table>';
          resultArea.innerHTML = html;
        } else {
          resultArea.innerHTML = '<div style="color: #22c55e; padding: 12px;">Statement executed. Changes: ' + data.changes + ' (' + data.durationMs + 'ms)</div>';
        }
      } catch (err) {
        resultArea.innerHTML = '<div style="color: #ef4444; padding: 12px;">Request failed: ' + escapeHtml(err.message) + '</div>';
      }
    }

    function openJsonModal(encoded, title) {
      const raw = decodeURIComponent(encoded);
      try {
        const parsed = JSON.parse(raw);
        document.getElementById('modal-json').innerText = JSON.stringify(parsed, null, 2);
      } catch(e) {
        document.getElementById('modal-json').innerText = raw;
      }
      document.getElementById('modal-title').innerText = 'Field: ' + title;
      document.getElementById('cell-modal').style.display = 'flex';
    }

    function closeModal(e) {
      document.getElementById('cell-modal').style.display = 'none';
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    window.onload = init;
  </script>
</body>
</html>
`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(HTML_TEMPLATE);
  }

  if (url.pathname === "/api/info") {
    try {
      const tables = getTables();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ path: dbPath, tables }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (url.pathname === "/api/table") {
    try {
      const name = url.searchParams.get("name");
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get("pageSize") || "50", 10)));
      if (!name) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Missing table name" }));
      }
      const schema = getTableSchema(name);
      const data = getTableData(name, page, pageSize);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ schema, ...data }));
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (url.pathname === "/api/query" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { query } = JSON.parse(body);
        if (!query || typeof query !== "string") {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ error: "Empty query" }));
        }

        const trimmed = query.trim();
        const isSelect = /^(SELECT|PRAGMA|EXPLAIN|WITH)/i.test(trimmed);
        const t0 = Date.now();

        if (isSelect) {
          const rows = db.prepare(trimmed).all();
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ rows, durationMs: Date.now() - t0 }));
        } else {
          const result = db.exec(trimmed);
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ success: true, changes: result?.changes || 0, durationMs: Date.now() - t0 }));
        }
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found");
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  \x1b[32m✔\x1b[0m 9Router Database Studio is running at: \x1b[36m${url}\x1b[0m`);
  console.log(`  \x1b[90mConnected to: ${dbPath}\x1b[0m\n`);

  // Auto-open browser
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${opener} ${url}`).catch?.(() => {});
});
