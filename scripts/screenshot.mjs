import puppeteer from 'puppeteer-core';

const [url, out, waitMs = '8000', scrollY = '0'] = process.argv.slice(2);

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERROR:', m.text());
});
await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
if (Number(scrollY) > 0) {
  // ScrollControls uses an inner scroller; scroll it if present, else the window
  await page.evaluate((y) => {
    const scroller = [...document.querySelectorAll('div')].find(
      (d) => d.scrollHeight > d.clientHeight * 2 && getComputedStyle(d).overflow.includes('auto')
    );
    if (scroller) scroller.scrollTop = y;
    else window.scrollTo(0, y);
  }, Number(scrollY));
}
await new Promise((r) => setTimeout(r, Number(waitMs)));
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
