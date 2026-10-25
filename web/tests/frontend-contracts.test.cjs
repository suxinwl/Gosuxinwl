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
const { createServerClock } = loadSource('src/utils/http/serverClock.ts');
test('login follow-up timestamps use server time despite remote clock skew or wall-clock changes', () => {
  const serverTime = Date.parse('Sun, 25 Oct 2026 11:45:00 GMT');
  for (const skew of [3000, -3000, 3600000, -3600000]) {
    let wall = serverTime + skew;
    let monotonic = 500;
    const clock = createServerClock(() => wall, () => monotonic);
    assert.equal(clock.timestamp(), Math.floor(wall / 1000));
    clock.sync('Sun, 25 Oct 2026 11:45:00 GMT');
    assert.equal(clock.timestamp(), serverTime / 1000);
    wall += 86400000;
    monotonic += 2500;
    assert.equal(clock.timestamp(), serverTime / 1000 + 2);
    clock.sync(undefined);
    clock.sync('invalid date');
    assert.equal(clock.timestamp(), serverTime / 1000 + 2);
    clock.sync('Sun, 25 Oct 2026 11:45:04 GMT');
    assert.equal(clock.timestamp(), serverTime / 1000 + 4);
  }
});

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
  const query = { tenant_id: '42', business_id: 'inventory', view: 'list', edit: '1' };
  assert.equal(
    runtimePluginAdminTarget('/inventory/admin', 'inventory', query),
    '/plugins/inventory/admin/inventory/admin?tenant_id=42&business_id=inventory&view=list&edit=1'
  );
  assert.equal(
    runtimePluginAdminTarget('/runtime-plugins/devtools/settings', 'devtools', query),
    '/plugins/devtools/admin/settings?tenant_id=42&business_id=inventory&view=list&edit=1'
  );
});

test('runtime iframe query values round trip using Vue Router encoding for Chinese, symbols, null and arrays', () => {
  const query = {
    '筛选&键': '资料 / 中文 + & = ? # % [清单]',
    bare: null,
    empty: '',
    labels: ['中文', 'a+b & c=d?#/%', null, ''],
  };
  for (const [route, plugin, pathname] of [
    ['/inventory/admin', 'inventory', '/plugins/inventory/admin/inventory/admin'],
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

async function loadMigrationFixture(relative, { source, fixtures = {}, external = [], define = {} } = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const result = await require('esbuild').build({
    stdin: {
      contents: source ?? require('node:fs').readFileSync(filename, 'utf8'),
      sourcefile: filename, resolveDir: path.dirname(filename), loader: 'ts',
    },
    tsconfig: path.resolve(__dirname, '../tsconfig.json'),
    bundle: true, write: false, platform: 'node', format: 'cjs', external, define,
    plugins: [{
      name: 'migration-fixtures',
      setup(builder) {
        builder.onResolve({ filter: /./ }, (args) => Object.hasOwn(fixtures, args.path)
          ? { path: args.path, namespace: 'migration-fixture' } : undefined);
        builder.onLoad({ filter: /./, namespace: 'migration-fixture' }, (args) => ({
          contents: fixtures[args.path], loader: 'ts', resolveDir: path.dirname(filename),
        }));
      },
    }],
  });
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = module.paths;
  compiled._compile(result.outputFiles[0].text, filename);
  return compiled.exports;
}

test('locale switching updates global composition users, template translations and saved preferences', async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(global, 'localStorage');
  const saved = new Map([['arco-locale', 'zh-TW']]);
  Object.defineProperty(global, 'localStorage', { configurable: true, value: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  } });
  try {
    const { i18n, useLocale } = await loadMigrationFixture('src/locale/migration-fixture.ts', {
      source: "export { default as i18n } from '@/locale'; export { default as useLocale } from '@/hooks/locale';",
      external: ['vue', 'vue-i18n'],
      fixtures: {
        './en-US': "export default { greeting: 'Hello', 'navbar.action.locale': 'Language changed' };",
        './zh-CN': "export default { greeting: '你好', fallback: '中文回退', 'navbar.action.locale': '语言已切换' };",
        './zh-TW': "export default { greeting: '您好', 'navbar.action.locale': '語言已切換' };",
        '@arco-design/web-vue': 'export const Message = { success() {} };',
      },
    });
    const { createSSRApp, h, getCurrentInstance, nextTick } = require('vue');
    const { renderToString } = require('@vue/server-renderer');
    const { useI18n } = require('vue-i18n');
    let localeControl;
    let childLocale;
    const Child = { setup() {
      const { t, locale } = useI18n();
      childLocale = locale;
      return () => h('span', t('greeting'));
    } };
    const Root = { setup() {
      localeControl = useLocale();
      const instance = getCurrentInstance();
      return () => h('div', [instance.proxy.$t('greeting'), h(Child)]);
    } };
    const render = () => renderToString(createSSRApp(Root).use(i18n));
    assert.equal(i18n.mode, 'composition');
    assert.match(await render(), /您好<span>您好<\/span>/);
    localeControl.changeLocale('en-US');
    await nextTick();
    assert.equal(i18n.global.locale.value, 'en-US');
    assert.equal(childLocale.value, 'en-US');
    assert.equal(localeControl.currentLocale.value, 'en-US');
    assert.equal(saved.get('arco-locale'), 'en-US');
    assert.match(await render(), /Hello<span>Hello<\/span>/);
    for (const [locale, greeting] of [['zh-TW', '您好'], ['zh-CN', '你好'], ['en-US', 'Hello'], ['zh-TW', '您好'], ['zh-CN', '你好']]) {
      localeControl.changeLocale(locale);
      await nextTick();
      assert.equal(i18n.global.locale.value, locale);
      assert.equal(childLocale.value, locale);
      assert.equal(localeControl.currentLocale.value, locale);
      assert.equal(saved.get('arco-locale'), locale);
      assert.ok((await render()).includes(`${greeting}<span>${greeting}</span>`));
    }
    localeControl.changeLocale('en-US');
    i18n.global.missingWarn = false;
    i18n.global.fallbackWarn = false;
    assert.equal(i18n.global.t('fallback'), '中文回退');
  } finally {
    if (storageDescriptor) Object.defineProperty(global, 'localStorage', storageDescriptor);
    else delete global.localStorage;
  }
});

test('editor Markdown preserves formatting, tables, bare-domain links and custom token hooks', () => {
  const { createMarkdownIt, convertMarkdown } = loadSource('src/components/gfeditor/emain/utils/index.ts');
  let configured = 0;
  const editor = {
    schema: { getTags: () => ['p', 'h1', 'blockquote', 'pre', 'li'] },
    trigger(name, value) {
      if (name === 'markdown-it') {
        configured += 1;
        value.enable(['heading', 'emphasis', 'table', 'fence', 'linkify']);
      }
      if (name === 'markdown-it-token' && value.token.type === 'fence') {
        value.callback('<pre data-editor-code="true">custom code</pre>');
        return false;
      }
      return undefined;
    },
  };
  const markdown = createMarkdownIt(editor);
  assert.equal(configured, 1);
  const convert = (text) => convertMarkdown(editor, markdown, markdown.parse(text, {}));
  assert.match(convert('# Heading\n\n**Bold** and *italic*'), /<h1>Heading<\/h1>[\s\S]*<strong>Bold<\/strong> and <em>italic<\/em>/);
  assert.match(convert('example.com'), /href="http:\/\/example.com"/);
  assert.match(convert('| Name | Value |\n| --- | --- |\n| a | b |'), /<table>[\s\S]*<th>Name<\/th>[\s\S]*<td>b<\/td>/);
  assert.equal(convert('```js\nconst n = 1;\n```'), '<pre data-editor-code="true">custom code</pre>');
  assert.equal(convert('plain text'), null, 'plain text should keep the normal paste path');
});

test('chart wrapper forwards existing props and renders ECharts 6 charts with the v5 theme and graphic labels', async () => {
  const { parse, compileScript } = require('@vue/compiler-sfc');
  const filename = path.resolve(__dirname, '../src/components/chart/index.vue');
  const { descriptor } = parse(require('node:fs').readFileSync(filename, 'utf8'), { filename });
  const source = compileScript(descriptor, { id: 'chart-migration-test', inlineTemplate: true }).content;
  const chartModule = await loadMigrationFixture('src/components/chart/index.vue', {
    source: `${source}\nexport { init, use } from 'echarts/core'; export { SVGRenderer } from 'echarts/renderers';`,
    external: ['vue'],
    fixtures: {
      'vue-echarts': `import { h } from 'vue'; export default {
        props: ['option', 'theme', 'autoresize'], setup() { return () => h('div'); }
      };`,
    },
  });
  const { createRenderer, nextTick, h } = require('vue');
  const captures = [];
  // Replace only the canvas-facing child; the wrapper and ECharts registrations run unchanged.
  const instance = chartModule.default;
  const renderer = createRenderer({
    patchProp(el, key, _old, value) { el.props[key] = value; },
    createElement: () => ({ children: [], props: {} }),
    createText: (text) => ({ text }), createComment: (text) => ({ text }),
    setText(el, text) { el.text = text; }, setElementText(el, text) { el.text = text; },
    parentNode: (el) => el.parent, nextSibling: () => null,
    insert(el, parent) { el.parent = parent; parent.children.push(el); },
    remove(el) { el.parent?.children.splice(el.parent.children.indexOf(el), 1); },
  });
  chartModule.use([chartModule.SVGRenderer]);
  const option = {
    animation: false, legend: { data: ['Content'] },
    xAxis: { type: 'category', data: ['A', 'B'] }, yAxis: { type: 'value' },
    graphic: { elements: [{ type: 'text', left: 'center', top: '40%', style: { text: 'Total' } }] },
    series: [{ name: 'Content', type: 'line', data: [1, 2] }],
  };
  for (const prop of ['option', 'options']) {
    const root = { children: [] };
    const app = renderer.createApp({ render: () => h(instance, { [prop]: option, autoResize: false, onVnodeMounted(vnode) {
      captures.push(vnode.component);
    } }) });
    app.mount(root);
    await nextTick();
    await nextTick();
    const child = captures.at(-1).subTree;
    assert.equal(child.props.option, option);
    assert.equal(child.props.theme, 'v5');
    assert.equal(child.props.autoresize, false);
    app.unmount();
  }
  const chart = chartModule.init(null, 'v5', { renderer: 'svg', ssr: true, width: 480, height: 320 });
  try {
    chart.setOption(option);
    assert.match(chart.renderToSVGString(), /<svg[\s\S]*Total/);
    assert.equal(chart.getOption().color[0], '#5470c6');
    chart.setOption({ series: [{ name: 'Content', type: 'bar', data: [3, 4] }] });
    assert.match(chart.renderToSVGString(), /<path/);
    chart.setOption({ animation: false, series: [{ type: 'pie', data: [{ name: 'A', value: 3 }, { name: 'B', value: 4 }] }] }, true);
    assert.match(chart.renderToSVGString(), /<path/);
  } finally {
    chart.dispose();
  }
});

function storeMigrationEnvironment(t, values = []) {
  const saved = new Map(values);
  const browser = {
    window: { globalConfig: { RouterHome: 'home' } },
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
  };
  for (const [name, value] of Object.entries(browser)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    });
  }
  return saved;
}

const storeViewFixtures = Object.fromEntries([
  '@/views/systool/iframe/FrameBlank.vue',
  '@/views/systool/404/index.vue',
  '@/layout/default-layout.vue',
].map((view) => [view, 'export default { render() { return null; } };']));

test('actual Pinia menu store replaces authenticated routes and preserves working routes after a failed refresh', async (t) => {
  const { createPinia, disposePinia } = require('pinia');
  storeMigrationEnvironment(t, [['settingsval', JSON.stringify({
    theme: 'dark', menuWidth: 280, isDynamicAddedRoute: true,
    serverRoute: [{ path: '/other-user', name: 'other-user' }],
  })]]);
  const menus = [{
    path: '/runtime-plugins/devtools', name: 'runtime_plugin_devtools',
    component: 'tools/index', redirect: '/runtime-plugins/devtools',
    meta: { title: '开发工具' },
  }];
  let failRefresh = false;
  globalThis.__storeMigrationMenus = async () => {
    if (failRefresh) throw new Error('menu request failed');
    return menus;
  };
  // Vite resolves view globs at build time; use a view loader while retaining the real route transformation.
  globalThis.__storeMigrationViews = () => ({
    '../../views/tools/index.vue': async () => ({ default: { render() { return null; } } }),
  });
  t.after(() => {
    delete globalThis.__storeMigrationMenus;
    delete globalThis.__storeMigrationViews;
  });
  const { default: useAppStore } = await loadMigrationFixture('src/store/modules/app/index.ts', {
    external: ['vue', 'pinia', 'vue-router'],
    define: {
      'import.meta.glob': 'globalThis.__storeMigrationViews',
      'import.meta.env': JSON.stringify({ VITE_GLOB_APP_TITLE: 'GoSuxin' }),
    },
    fixtures: {
      ...storeViewFixtures,
      '@/api/user': 'export const getMenuList = (...args) => globalThis.__storeMigrationMenus(...args);',
      '@arco-design/web-vue': 'export const Notification = { warning() {} };',
    },
  });
  const pinia = createPinia();
  t.after(() => disposePinia(pinia));
  const store = useAppStore(pinia);
  assert.equal(store.getTheme, 'dark');
  assert.equal(store.menuWidth, 280);
  assert.deepEqual(store.serverRoute, [], 'saved settings must not restore another session\'s routes');
  assert.equal(store.getIsDynamicAddedRoute, false);
  const oldRoute = { path: '/retired', name: 'retired', component: {} };
  const router = createRouter({ history: createMemoryHistory(), routes: [oldRoute] });
  store.serverRoute = [oldRoute];
  assert.equal(await store.refreshServerRoutes(router), true);
  assert.equal(router.hasRoute('retired'), false);
  assert.equal(router.hasRoute('runtime_plugin_devtools'), true);
  assert.equal(store.getIsDynamicAddedRoute, true);
  await router.push('/runtime-plugins/devtools?tenant_id=42');
  assert.deepEqual(router.currentRoute.value.matched.map((route) => route.name), [
    'runtime_plugin_devtoolsParent', 'runtime_plugin_devtools',
  ]);
  assert.equal(router.currentRoute.value.query.tenant_id, '42');
  assert.equal(menus[0].redirect, '/runtime-plugins/devtools', 'route registration must not mutate API menu data');
  failRefresh = true;
  assert.equal(await store.refreshServerRoutes(router), false);
  assert.equal(router.hasRoute('runtime_plugin_devtools'), true);
  assert.equal(store.appAsyncMenus[0].name, 'runtime_plugin_devtools');
});

test('actual Pinia tab store keeps cache membership reactive across navigation, removal and logout reset', async (t) => {
  const { createPinia, disposePinia } = require('pinia');
  const { watch } = require('vue');
  storeMigrationEnvironment(t);
  const { default: useTabStore } = await loadMigrationFixture('src/store/modules/tab-bar/index.ts', {
    external: ['vue', 'pinia', 'vue-i18n'], fixtures: {
      ...storeViewFixtures,
      './en-US': 'export default {};',
      './zh-CN': 'export default {};',
      './zh-TW': 'export default {};',
    },
  });
  const pinia = createPinia();
  t.after(() => disposePinia(pinia));
  const store = useTabStore(pinia);
  const cacheChanges = [];
  const stop = watch(() => store.getCacheList, (cache) => cacheChanges.push([...cache]), { flush: 'sync' });
  t.after(stop);
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/home', name: 'home', component: {} },
    { path: '/reports', name: 'reports', component: {}, meta: { title: '统计报表' } },
    { path: '/preview', name: 'preview', component: {}, meta: { title: '临时预览', ignoreCache: true } },
    { path: '/login', name: 'login', component: {} },
  ] });
  for (const target of ['/reports', '/preview', '/reports', '/login']) {
    await router.push(target);
    store.updateTabList(router.currentRoute.value);
  }
  assert.deepEqual(store.getTabList.map((tag) => tag.name), ['home', 'reports', 'preview']);
  assert.deepEqual(store.getCacheList, ['home', 'reports']);
  const reportIndex = store.getTabList.findIndex((tag) => tag.name === 'reports');
  store.deleteTag(reportIndex, store.getTabList[reportIndex]);
  assert.deepEqual(store.getCacheList, ['home']);
  assert.deepEqual(cacheChanges, [['home', 'reports'], ['home']]);
  store.resetTabList();
  assert.deepEqual(store.getTabList.map((tag) => tag.name), ['home']);
  assert.deepEqual(store.getCacheList, ['home']);
});

test('return-based navigation guards retain permission rejection and failed-login redirect queries', async (t) => {
  storeMigrationEnvironment(t);
  let logoutCalls = 0;
  const user = { id: 1, btnroles: undefined, info: async () => { throw new Error('expired session'); },
    logout: async () => { logoutCalls += 1; user.id = 0; loggedIn = false; } };
  let loggedIn = true;
  globalThis.__guardMigration = { user, app: { menuFromServer: false }, isLogin: () => loggedIn };
  t.after(() => { delete globalThis.__guardMigration; });
  const { setupLogin, setupPermission } = await loadMigrationFixture('src/router/guard/migration-fixture.ts', {
    source: "export { default as setupLogin } from './userLoginInfo'; export { default as setupPermission } from './permission';",
    external: ['vue', 'vue-router'],
    fixtures: {
      ...storeViewFixtures,
      '@/store': 'export const useAppStore = () => globalThis.__guardMigration.app; export const useUserStore = () => globalThis.__guardMigration.user;',
      '@/utils/auth': 'export const isLogin = () => globalThis.__guardMigration.isLogin();',
      '@/hooks/permission': "export default () => ({ accessRouter: (to) => to.name !== 'forbidden' });",
      nprogress: 'export default { start() {}, done() {} };',
    },
  });
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/login', name: 'login', component: {} },
    { path: '/not-found', name: 'notFound', component: {} },
    { path: '/reports', name: 'reports', component: {}, meta: { btnroles: ['export'] } },
    { path: '/forbidden', name: 'forbidden', component: {} },
  ] });
  setupLogin(router);
  setupPermission(router);
  await router.push('/reports');
  assert.equal(router.currentRoute.value.name, 'reports');
  assert.deepEqual(user.btnroles, ['export']);
  await router.push('/forbidden');
  assert.equal(router.currentRoute.value.name, 'notFound');
  user.id = 0;
  await router.push('/reports?tenant_id=42&view=table');
  assert.equal(logoutCalls, 1);
  assert.equal(router.currentRoute.value.name, 'login');
  assert.deepEqual(router.currentRoute.value.query, { redirect: '/reports?tenant_id=42&view=table' });
  await router.push('/runtime-plugins/inventory?view=content/collect');
  assert.equal(router.currentRoute.value.query.redirect, '/runtime-plugins/inventory?view=content/collect');
});

test('login return targets retain plugin paths and reject external or missing route names', () => {
  const { loginDestination } = loadSource('src/utils/login-redirect.ts');
  const known = name => name === 'reports';
  assert.equal(loginDestination('/runtime-plugins/inventory?view=content/collect#tasks', {}, known), '/runtime-plugins/inventory?view=content/collect#tasks');
  assert.deepEqual(loginDestination('reports', { tenant_id: '42' }, known), { name: 'reports', query: { tenant_id: '42' } });
  for (const target of ['runtime-plugins', 'login', '/login', '//external.example', '/\\external.example', 'https://external.example', undefined]) {
    assert.deepEqual(loginDestination(target, {}, known), { name: 'home', query: {} });
  }
});
