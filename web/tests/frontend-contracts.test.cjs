const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const Module = require('node:module');
const { buildSync } = require('esbuild');

function loadSource(relative) {
  const filename = path.resolve(__dirname, '..', relative);
  const result = buildSync({
    entryPoints: [filename], tsconfig: path.resolve(__dirname, '../tsconfig.json'),
    bundle: true, write: false, platform: 'node', format: 'cjs',
  });
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

const Language = loadSource('src/components/gfeditor/emain/language.ts').default;
const { schemaStyles } = loadSource('src/components/gfeditor/emain/types/schema.ts');
const { AxiosRetry, shouldRetryRequest } = loadSource('src/utils/http/axiosRetry.ts');
const { getComputedStyle } = loadSource('src/components/gfeditor/emain/utils/string.ts');

test('editor language preserves nested toolbar labels and handles absent keys', () => {
  const language = new Language('zh-CN', { 'zh-CN': { table: { title: 'Table', verticalAlign: { top: 'Top' } } } });
  assert.equal(language.get('table', 'verticalAlign', 'top'), 'Top');
  assert.equal(language.get('missing'), '');
  language.add({ 'zh-CN': { table: { mergeCell: 'Merge' } } });
  assert.deepEqual(language.get('table'), { title: 'Table', verticalAlign: { top: 'Top' }, mergeCell: 'Merge' });
});

test('schema styles distinguish attribute predicates and retain mutable style rules', () => {
  const rules = { color: '@color', background: '@color' };
  const schema = { class: '*', style: rules };
  delete schemaStyles(schema).background;
  assert.deepEqual(rules, { color: '@color' });
  for (const invalid of [undefined, {}, { style: '*' }, { style: /red/ }, { style: ['red'] }, { style: { required: true, value: '*' } }]) {
    assert.deepEqual(schemaStyles(invalid), {});
  }
});

test('network retries use request config without requiring a response and stop at the limit', async () => {
  const retry = new AxiosRetry();
  const config = { method: 'get', requestOptions: { retryRequest: { isOpenRetry: true, count: 2, waitTime: 0 } } };
  const error = Object.assign(new Error('Network Error'), { config });
  let calls = 0;
  const instance = { request: async (received) => { assert.equal(received, config); calls += 1; return { data: 'ok' }; } };
  assert.deepEqual(await retry.retry(instance, error), { data: 'ok' });
  assert.deepEqual(await retry.retry(instance, error), { data: 'ok' });
  await assert.rejects(retry.retry(instance, error), (received) => received === error);
  assert.equal(calls, 2);
});

test('requests without retry configuration keep their original failure', async () => {
  const error = new Error('cancelled');
  await assert.rejects(new AxiosRetry().retry({ request() { throw new Error('unexpected retry'); } }, error), (received) => received === error);
});

test('retry eligibility never repeats login failures, writes, cancellations or exhausted requests', () => {
  const config = { method: 'get', requestOptions: { retryRequest: { isOpenRetry: true, count: 2, waitTime: 0 } } };
  assert.equal(shouldRetryRequest({ config }), true);
  assert.equal(shouldRetryRequest({ config, response: { status: 503 } }), true);
  for (const status of [400, 401, 403, 404]) assert.equal(shouldRetryRequest({ config, response: { status } }), false);
  assert.equal(shouldRetryRequest({ config: { ...config, method: 'post' } }), false);
  assert.equal(shouldRetryRequest({ config, code: 'ERR_CANCELED' }), false);
  assert.equal(shouldRetryRequest({ config: { ...config, signal: { aborted: true } } }), false);
  assert.equal(shouldRetryRequest({ config: { ...config, __retryCount: 2 } }), false);
});

test('editor computed styles accept camel case while preserving custom property case', () => {
  const originalWindow = global.window;
  const requested = [];
  global.window = { getComputedStyle: () => ({ getPropertyValue(name) { requested.push(name); return '12px'; } }) };
  try {
    assert.equal(getComputedStyle({}, 'paddingLeft'), '12px');
    assert.equal(getComputedStyle({}, 'padding-left'), '12px');
    assert.equal(getComputedStyle({}, '--ToolbarSize'), '12px');
    assert.deepEqual(requested, ['padding-left', 'padding-left', '--ToolbarSize']);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
});


const { wrapRootPageRoute, removePageSelfRedirect } = loadSource('src/router/helper/pageRoute.ts');
const { runtimePluginAdminTarget } = loadSource('src/utils/runtime-plugin-route.ts');
const { createRouter, createMemoryHistory, stringifyQuery, parseQuery } = require('vue-router');

test('a runtime root menu with a self redirect opens its actual page without recursion', async () => {
  const page = { path: '/runtime-plugins/devtools', name: 'runtime_plugin_devtools', component: {}, redirect: '/runtime-plugins/devtools', meta: { title: '开发工具' } };
  wrapRootPageRoute(page, {});
  const router = createRouter({ history: createMemoryHistory(), routes: [page] });
  await router.push('/runtime-plugins/devtools');
  assert.equal(router.currentRoute.value.name, 'runtime_plugin_devtools');
  assert.deepEqual(router.currentRoute.value.matched.map((route) => route.name), ['runtime_plugin_devtoolsParent', 'runtime_plugin_devtools']);
  assert.equal(router.currentRoute.value.matched[1].redirect, undefined);
  const directory = { path: '/tools', name: 'tools', component: {}, redirect: '/tools/index', meta: {} };
  removePageSelfRedirect(directory);
  assert.equal(directory.redirect, '/tools/index');
});

test('runtime admin targets preserve existing business routes and accept generic plugin entries', () => {
  assert.equal(runtimePluginAdminTarget('/runtime-plugins/devtools'), '/plugins/devtools/admin/');
  assert.equal(runtimePluginAdminTarget('/runtime-plugins/devtools', 'devtools'), '/plugins/devtools/admin/');
  assert.equal(runtimePluginAdminTarget('/runtime-plugins/devtools/settings', 'devtools'), '/plugins/devtools/admin/settings');
  assert.equal(runtimePluginAdminTarget('/album/books', 'ebook'), '/plugins/ebook/admin/album/books');
  assert.equal(runtimePluginAdminTarget('/runtime-plugins/devtools', 'ebook'), null);
  assert.equal(runtimePluginAdminTarget('/home'), null);
  assert.equal(runtimePluginAdminTarget('/home', '../devtools'), null);
});

test('runtime iframe targets retain CMS tenant, business, view and edit query parameters', () => {
  const query = { tenant_id: '42', business_id: 'video', view: 'list', edit: '1' };
  assert.equal(
    runtimePluginAdminTarget('/suxinvideo/admin', 'suxinvideo', query),
    '/plugins/suxinvideo/admin/suxinvideo/admin?tenant_id=42&business_id=video&view=list&edit=1'
  );
  assert.equal(
    runtimePluginAdminTarget('/runtime-plugins/devtools/settings', 'devtools', query),
    '/plugins/devtools/admin/settings?tenant_id=42&business_id=video&view=list&edit=1'
  );
});

test('runtime iframe query values round trip using Vue Router encoding for Chinese, symbols, null and arrays', () => {
  const query = {
    '筛选&键': '影视 / 中文 + & = ? # % [片单]',
    bare: null,
    empty: '',
    labels: ['中文', 'a+b & c=d?#/%', null, ''],
  };
  for (const [route, plugin, pathname] of [
    ['/suxinvideo/admin', 'suxinvideo', '/plugins/suxinvideo/admin/suxinvideo/admin'],
    ['/runtime-plugins/devtools', undefined, '/plugins/devtools/admin/'],
  ]) {
    const target = runtimePluginAdminTarget(route, plugin, query);
    const url = new URL(target, 'https://example.test');
    assert.equal(url.origin, 'https://example.test');
    assert.equal(url.pathname, pathname);
    assert.equal(url.hash, '', 'query fragment characters must stay in the iframe query');
    assert.equal(url.search.slice(1), stringifyQuery(query));
    assert.deepEqual(parseQuery(url.search), query);
  }
});

test('empty runtime query keeps existing paths and query values cannot select an invalid plugin', () => {
  for (const query of [undefined, {}]) {
    assert.equal(runtimePluginAdminTarget('/runtime-plugins/devtools', 'devtools', query), '/plugins/devtools/admin/');
    assert.equal(runtimePluginAdminTarget('/album/books', 'ebook', query), '/plugins/ebook/admin/album/books');
  }
  const query = { tenant_id: '42', plugin: 'devtools', redirect: 'https://example.test/' };
  for (const plugin of ['../devtools', 'Devtools', 'devtools/admin', 'devtools?view=edit']) {
    assert.equal(runtimePluginAdminTarget('/home', plugin, query), null);
  }
  assert.equal(runtimePluginAdminTarget('/runtime-plugins/devtools', 'ebook', query), null);
  assert.equal(runtimePluginAdminTarget('/home', undefined, query), null);
});


const { routeTitle } = loadSource('src/utils/route-title.ts');
test('hot installed plugin menus use server titles when their locale key is absent', () => {
  const translated = (key) => ({ 'menu.home': '首页概况' }[key] || key);
  const exists = (key) => key === 'menu.home';
  assert.equal(routeTitle({ locale: 'runtime.plugin.devtools', title: '开发工具' }, translated, exists), '开发工具');
  assert.equal(routeTitle({ locale: 'menu.home', title: 'Home' }, translated, exists), '首页概况');
  assert.equal(routeTitle({ locale: 'menu.home', title: 'Home' }, translated, () => false), '首页概况');
});
