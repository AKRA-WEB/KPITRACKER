# Owned Tailwind CSS

The page uses committed `css/tailwind.min.css`, built with Tailwind **3.4.17**.
Install the locked development dependencies with `npm ci --ignore-scripts`, then
run `npm run build:css` and `npm run test:css` whenever utility classes change.
Commit the rebuilt CSS with the source change. The build only reads the config,
CSS input and `index.html`/`js/**/*.js`, and writes the CSS asset; it has no watch,
application runtime or backend step.

The two safelisted backgrounds cover the dashboard's partial `bg-${color}-500`
class. Other classes remain full literals in the scanned source. The stylesheet
link follows the custom head style to preserve the observed CDN runtime cascade.
