// Run against serve-layout-fixture.mjs only: no real accounts or model turns.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {measureLayout} from './check-layout.mjs';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined});
try {
 const page=await browser.newPage({viewport:{width:1280,height:796}});
 await page.goto('http://127.0.0.1:'+(process.env.PI_COFFEE_LAYOUT_PORT || '4175'));
 await page.getByRole('button',{name:/^布局验收 0/}).click();
 await page.getByRole('button',{name:'Checkpoint',exact:true}).waitFor();
 await page.locator('.wt-file').first().waitFor();
 for(const collapsed of [false,true]) {
  await page.setViewportSize({width:1280,height:796});
  if(collapsed)await page.getByRole('button',{name:'折叠侧栏',exact:true}).click();
  for(const [width,height] of [[1440,900],[1280,796],[1110,640],[1100,640],[820,640],[390,844],[1280,480]]) {
   await page.setViewportSize({width,height});
   const result=await page.evaluate(measureLayout);console.log(JSON.stringify({...result,collapsed}));assert.deepEqual(result.failures,[]);
  }
 }
 await page.getByRole('textbox',{name:'输入',exact:true}).fill('Synthetic draft\n'.repeat(35));
 assert.deepEqual((await page.evaluate(measureLayout)).failures,[]);
 await page.getByRole('button',{name:'详情',exact:true}).click();
 assert.match(await page.locator('#modal-text').textContent(),/00000000-0000-4000-8000-000000000000/);
 console.log('Compact layout passed');
} finally {await browser.close();}
