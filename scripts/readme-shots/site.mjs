// README images from the website (https://wavi-pi.vercel.app): the banner and the sections that explain the workflow.
//   node scripts/readme-shots/site.mjs <out-dir>
import { chromium } from 'playwright'

const SITE = 'https://wavi-pi.vercel.app/'
const out = process.argv[2]
const browser = await chromium.launch({ channel: 'chrome' })

// Banner: the hero's WAVI and the CRT row of question marks, settled, without the copy and buttons.
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 })
  await page.goto(SITE, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '[data-nav]{display:none!important} [data-hero-cta],[data-hero-sub],[data-hero-title]{visibility:hidden!important}' })
  await page.waitForTimeout(12_000)
  await page.screenshot({ path: `${out}/banner.png`, clip: { x: 0, y: 80, width: 1600, height: 500 } })
  await page.close()
}

// Sections, with reduced motion so every reveal is in its final state.
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' })
  await page.goto(SITE, { waitUntil: 'networkidle' })
  await page.addStyleTag({ content: '[data-nav]{display:none!important}' })
  const height = await page.evaluate(() => globalThis.document.documentElement.scrollHeight)
  for (let y = 0; y < height; y += 300) {
    await page.evaluate((top) => globalThis.scrollTo(0, top), y)
    await page.waitForTimeout(150)
  }
  const shoot = async (selector, name, trim = { top: 0, bottom: 0 }) => {
    const element = page.locator(selector).first()
    await element.scrollIntoViewIfNeeded()
    await page.waitForTimeout(1500)
    const box = await element.boundingBox()
    await page.screenshot({ path: `${out}/${name}.png`, clip: { x: box.x, y: box.y + trim.top, width: box.width, height: box.height - trim.top - trim.bottom } })
  }
  await shoot('.cmp-stage', 'compare')
  // The sticky stage is a full viewport: drop the scroll progress bar above the graph and the space under the steps.
  await shoot('.wt-sticky', 'workflow', { top: 140, bottom: 60 })
  await shoot('.ovp-wrap', 'branch-out-merge-in')
  await page.close()
}
await browser.close()
