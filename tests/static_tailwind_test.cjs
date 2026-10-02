// Local source/CSS only. No Browser, network, application script execution or writes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');
const tailwind = require('tailwindcss');
const { loadAutoprefixer, loadCssNano } = require('tailwindcss/lib/cli/build/deps');
const { defaultExtractor } = require('tailwindcss/lib/lib/defaultExtractor');
const { createContext } = require('tailwindcss/lib/lib/setupContextUtils');
const { generateRules } = require('tailwindcss/lib/lib/generateRules');
const resolveConfig = require('tailwindcss/resolveConfig');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('index.html');
const asset = read('css/tailwind.min.css');
const config = require('../tailwind.config.cjs');
const manifest = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const version = JSON.parse(read('version.json')).version;
const hash = css => crypto.createHash('sha256').update(css).digest('hex');
function jsFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
        .flatMap(entry => entry.isDirectory() ? jsFiles(path.join(directory, entry.name))
            : entry.name.endsWith('.js') ? [path.join(directory, entry.name)] : []);
}
const sources = [path.join(root, 'index.html'), ...jsFiles(path.join(root, 'js'))]
    .map(file => ({ raw: fs.readFileSync(file, 'utf8'), extension: path.extname(file).slice(1) }));

assert.equal(manifest.devDependencies.tailwindcss, '3.4.17');
assert.equal(require('tailwindcss/package.json').version, '3.4.17');
assert.equal(lock.packages[''].devDependencies.tailwindcss, '3.4.17');
assert.equal(lock.packages['node_modules/tailwindcss'].version, '3.4.17');
for (const [name, entry] of Object.entries(lock.packages)) {
    if (name) assert.ok(entry.integrity && entry.version, 'Every locked package has a version and integrity: ' + name);
}
assert.deepEqual(config.content, { relative: true, files: ['./index.html', './js/**/*.js'] });
assert.deepEqual(config.safelist, ['bg-red-500', 'bg-green-500']);
assert.deepEqual(config.plugins, []);
assert.deepEqual(config.theme, { extend: {} });
assert.ok(!html.includes('cdn.tailwindcss.com'), 'Runtime compiler removed');
const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const link = `<link rel="stylesheet" href="css/tailwind.min.css?v=${version}">`;
assert.equal(html.split('css/tailwind.min.css').length - 1, 1, 'One owned stylesheet');
assert.ok(head.indexOf(link) > head.lastIndexOf('</style>'), 'Tailwind follows existing custom head CSS, as the live runtime did');
assert.match(read('styles/tailwind.css'), /^@tailwind base;\s*@tailwind components;\s*@tailwind utilities;\s*$/);

const parsed = postcss.parse(asset);
const assetClasses = new Set();
parsed.walkRules(rule => selectorParser(selectors => selectors.walkClasses(node => assetClasses.add(node.value))).processSync(rule.selector));
const context = createContext(resolveConfig({ content: { files: [] }, theme: { extend: {} }, plugins: [] }));
const extractor = defaultExtractor(context);
const candidates = new Set(['bg-red-500', 'bg-green-500']);
for (const source of sources) {
    for (const line of source.raw.split(/\r?\n/)) for (const candidate of extractor(line)) candidates.add(candidate);
}
const expectedClasses = new Set();
for (const [, node] of generateRules(candidates, context)) {
    const collect = rule => selectorParser(selectors => selectors.walkClasses(cls => expectedClasses.add(cls.value))).processSync(rule.selector);
    if (node.type === 'rule') collect(node);
    else node.walkRules(collect);
}
const missing = [...expectedClasses].filter(name => !assetClasses.has(name));
assert.deepEqual(missing, [], 'Every valid utility literal in index.html and all owned JS must appear in committed CSS');
// Representative responsive, arbitrary, interaction and later-view classes, beyond initial Workload DOM.
for (const name of ['md:hidden', 'sm:px-4', 'text-[10px]', 'z-[60]', 'active:scale-95',
    'peer-checked:bg-purple-500', 'peer-checked:border-red-500', 'bg-red-500', 'bg-green-500']) {
    assert.ok(assetClasses.has(name), 'Missing interactive/dynamic utility ' + name);
}
for (const [className, expectedRgb] of [['bg-red-500', '239 68 68'], ['bg-green-500', '34 197 94']]) {
    let matched = false;
    parsed.walkRules(rule => {
        if (rule.selector !== '.' + className) return;
        rule.walkDecls('background-color', declaration => { matched ||= declaration.value.includes(expectedRgb); });
    });
    assert.ok(matched, 'Dynamic dashboard color has the default Tailwind declaration: ' + className);
}

async function independentlyCompile() {
    // Explicit raw source enumeration detects an omitted content glob or stale committed CSS.
    return (await postcss([tailwind({ content: { files: sources }, safelist: ['bg-red-500', 'bg-green-500'],
        theme: { extend: {} }, plugins: [] }), loadAutoprefixer(), loadCssNano()])
        .process(read('styles/tailwind.css'), { from: path.join(root, 'styles/tailwind.css'),
            to: path.join(root, 'css/tailwind.min.css'), map: false })).css;
}
(async () => {
    const first = await independentlyCompile();
    const second = await independentlyCompile();
    assert.equal(hash(first), hash(second), 'Two independent builds must be deterministic');
    assert.equal(hash(asset), hash(first), 'Committed CSS equals the pinned build of all owned source classes');
    console.log(JSON.stringify({ result: 'PASS', tailwind: '3.4.17', sourceFiles: sources.length,
        coveredClasses: expectedClasses.size, assetClasses: assetClasses.size,
        bytes: Buffer.byteLength(asset), sha256: hash(asset) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
