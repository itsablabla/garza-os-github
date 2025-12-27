const puppeteer = require('puppeteer-core');

async function run() {
  const action = process.argv[2];
  const arg = process.argv[3];

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222'
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  switch(action) {
    case 'goto':
      await page.goto(arg, { waitUntil: 'networkidle2' });
      console.log('Navigated to:', arg);
      break;
    
    case 'click':
      await page.click(arg);
      console.log('Clicked:', arg);
      break;
    
    case 'type':
      const [selector, text] = arg.split('::');
      await page.type(selector, text);
      console.log('Typed into:', selector);
      break;
    
    case 'screenshot':
      const path = arg || '/tmp/screenshot.png';
      await page.screenshot({ path, fullPage: true });
      console.log('Screenshot saved to:', path);
      break;
    
    case 'url':
      console.log('Current URL:', page.url());
      break;
    
    case 'html':
      const html = await page.content();
      console.log(html);
      break;
    
    case 'eval':
      const result = await page.evaluate(arg);
      console.log(JSON.stringify(result, null, 2));
      break;

    case 'cookies':
      const cookies = await page.cookies();
      console.log(JSON.stringify(cookies, null, 2));
      break;

    default:
      console.log('Usage: node browser-control.js <action> [arg]');
      console.log('Actions: goto, click, type, screenshot, url, html, eval, cookies');
  }

  await browser.disconnect();
}

run().catch(console.error);
