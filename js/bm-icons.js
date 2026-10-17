/* Preserve the icon host (including Vue ownership), replacing only decorative content. */
(function(window) {
    'use strict';
    const missing = new Set();
    function noteMissing(name) {
        if (missing.has(name)) return;
        missing.add(name);
        window.console?.warn?.('Unknown BM icon; using fallback:', name);
    }
    function svg(tree) {
        const node = document.createElementNS('http://www.w3.org/2000/svg', tree[0]);
        for (const [key, value] of Object.entries(tree[1] || {})) node.setAttribute(key, value);
        for (const child of tree[2] || []) node.appendChild(svg(child));
        return node;
    }
    function iconName(element) {
        return Array.from(element.classList).find(name => Object.hasOwn(window.BMIconData.aliases, name));
    }
    function create(name) {
        const known = Object.hasOwn(window.BMIconData.icons, name);
        if (!known) noteMissing(name);
        const graphic = svg(known ? window.BMIconData.icons[name] : window.BMIconData.icons['circle-help']);
        graphic.setAttribute('aria-hidden','true'); graphic.setAttribute('focusable','false');
        return graphic;
    }
    function render(root = document) {
        const elements = Array.from(root.querySelectorAll?.('i[class]') || []);
        if (root.matches?.('i[class]')) elements.unshift(root);
        for (const element of elements) {
            const alias = iconName(element);
            const unknown = Array.from(element.classList).find(name => /^fa-/.test(name) && !['fa-solid','fa-regular','fa-brands','fa-spin','fa-fw','fa-lg','fa-xs','fa-sm','fa-xl','fa-2xl','fa-1x','fa-2x','fa-3x','fa-4x','fa-5x'].includes(name) && !Object.hasOwn(window.BMIconData.aliases,name));
            if (unknown) { noteMissing(unknown); element.setAttribute('data-bm-icon-missing', unknown); }
            else element.removeAttribute('data-bm-icon-missing');
            if (!alias && !unknown) { if (element.dataset.bmIcon) { element.replaceChildren(); delete element.dataset.bmIcon; } continue; }
            const name = alias ? window.BMIconData.aliases[alias] : 'circle-help';
            if (element.dataset.bmIcon === name && element.querySelector('svg')) continue;
            const graphic = create(name);
            graphic.setAttribute('width','1em'); graphic.setAttribute('height','1em');
            graphic.setAttribute('aria-hidden','true'); graphic.setAttribute('focusable','false');
            element.setAttribute('aria-hidden','true'); element.dataset.bmIcon = name;
            element.replaceChildren(graphic);
        }
    }
    function start() {
        const style = document.createElement('style');
        style.textContent = 'i[data-bm-icon]{display:inline-flex;align-items:center;justify-content:center;font-style:normal;line-height:1;vertical-align:-.125em}i[data-bm-icon] svg{flex:none}i[data-bm-icon].fa-fw{width:1.25em}i[data-bm-icon].fa-spin svg{animation:bm-icon-spin 1s linear infinite}@keyframes bm-icon-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){i[data-bm-icon].fa-spin svg{animation:none}}';
        document.head.appendChild(style); render();
        new MutationObserver(records => {
            for (const record of records) {
                if (record.type === 'attributes') render(record.target);
                else { render(record.target); for (const node of record.addedNodes) if (node.nodeType === 1) render(node); }
            }
        }).observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:['class']});
    }
    window.BMIcons = Object.freeze({render, create, missing:() => Array.from(missing)});
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true});
    else start();
})(window);
