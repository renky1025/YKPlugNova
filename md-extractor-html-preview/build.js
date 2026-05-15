const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isProd = process.argv.includes('--prod');

async function build() {
  const outdir = path.join(__dirname, 'dist');
  
  // Clean dist
  if (fs.existsSync(outdir)) {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
  fs.mkdirSync(outdir, { recursive: true });

  // Copy static files
  fs.copyFileSync(path.join(__dirname, 'src', 'manifest.json'), path.join(outdir, 'manifest.json'));
  fs.copyFileSync(path.join(__dirname, 'src', 'popup.html'), path.join(outdir, 'popup.html'));
  fs.copyFileSync(path.join(__dirname, 'src', 'popup.css'), path.join(outdir, 'popup.css'));
  
  // Copy icon placeholders (we will generate a simple icon or just not specify icon right now to let Chrome use default, but manifest requires icons usually. Let's create an empty icon or use default)

  // Bundle content script and popup script
  await esbuild.build({
    entryPoints: [
      path.join(__dirname, 'src', 'content.js'),
      path.join(__dirname, 'src', 'popup.js')
    ],
    bundle: true,
    minify: isProd,
    outdir: outdir,
    sourcemap: !isProd,
    target: ['es2020']
  });

  console.log('Build completed successfully.');
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
