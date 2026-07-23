import puppeteer from 'puppeteer-core';

const [url, out, wheelDelta = '-2400'] = process.argv.slice(2);

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 6000));
// Zoom via wheel events over the canvas center (OrbitControls dolly)
await page.mouse.move(900, 450);
const total = Number(wheelDelta);
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel({ deltaY: total / 8 });
  await new Promise((r) => setTimeout(r, 150));
}
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
