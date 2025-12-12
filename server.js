import { createServer } from 'http';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8000;
const ROOT = path.resolve(__dirname);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function respond(res, status, message, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(message);
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function sanitizePath(urlPath) {
  const normalized = path.posix.normalize(urlPath).replace(/^\.\//, '');
  if (normalized.startsWith('..')) return null;
  return normalized;
}

async function serveFile(res, filePath) {
  res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
  createReadStream(filePath).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sanitizedPath = sanitizePath(url.pathname);

  if (!sanitizedPath) {
    respond(res, 403, 'Forbidden');
    return;
  }

  const requestPath = sanitizedPath.endsWith('/') ? `${sanitizedPath}index.html` : sanitizedPath;
  const absolutePath = path.join(ROOT, requestPath);

  if (!absolutePath.startsWith(ROOT)) {
    respond(res, 403, 'Forbidden');
    return;
  }

  try {
    const stats = await stat(absolutePath);

    if (stats.isDirectory()) {
      const indexPath = path.join(absolutePath, 'index.html');
      const indexStats = await stat(indexPath);
      if (indexStats.isFile()) {
        await serveFile(res, indexPath);
      } else {
        respond(res, 404, 'Not Found');
      }
      return;
    }

    await serveFile(res, absolutePath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      respond(res, 404, 'Not Found');
      return;
    }

    respond(res, 500, 'Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`Pricing engine available at http://localhost:${PORT}/index.html`);
  console.log(`Admin upload available at http://localhost:${PORT}/admin.html`);
});
