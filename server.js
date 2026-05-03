const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const ROUTES = {
  '/':                       'statcare_product.html',
  '/index.html':             'statcare_product.html',
  '/statcare_product.html':  'statcare_product.html',
  '/apply':                  'apply.html',
  '/apply.html':             'apply.html',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const fileName = ROUTES[url];

  if (!fileName) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const filePath = path.join(__dirname, fileName);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
