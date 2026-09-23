// Read-only DOM measurements, also usable with any browser automation evaluate API.
export function measureLayout() {
  const r = selector => document.querySelector(selector).getBoundingClientRect();
  const visible = selector => r(selector).width > 0;
  const main = r('main');
  const footer = r('#project-controls').height + r('#workspace-context').height;
  const failures = [];
  if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) failures.push('page overflow');
  for (const selector of ['#sidebar', '#workspace-panel']) {
    if (visible(selector) && r(selector).bottom > innerHeight + 1) failures.push(`${selector} height`);
  }
  for (const selector of ['#checkpoint-workspace', '#pull-request', '#files-toggle', '#send']) {
    if (visible(selector) && (r(selector).right > main.right + 1 || r(selector).bottom > innerHeight + 1 || r(selector).left < main.left - 1)) failures.push(`${selector} bounds`);
  }
  if (footer > 78) failures.push('footer exceeds three rows');
  if (r('#prompt').height < 60) failures.push('input too short');
  return { viewport: [innerWidth, innerHeight], footer, failures };
}
