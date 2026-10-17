module.exports = {
    // Vendored SVG tree/alias data contains icon names such as "columns-3", not HTML classes.
    content: { relative: true, files: ['./index.html', './js/**/*.js', '!./js/bm-icon-data.js'] },
    // Dashboard bar colors are assembled as bg-${color}-500 at runtime.
    safelist: ['bg-red-500', 'bg-green-500'],
    theme: { extend: {} },
    plugins: []
};
