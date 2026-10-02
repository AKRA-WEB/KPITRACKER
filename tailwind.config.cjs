module.exports = {
    content: { relative: true, files: ['./index.html', './js/**/*.js'] },
    // Dashboard bar colors are assembled as bg-${color}-500 at runtime.
    safelist: ['bg-red-500', 'bg-green-500'],
    theme: { extend: {} },
    plugins: []
};
