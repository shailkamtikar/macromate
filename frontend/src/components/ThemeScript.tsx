// Runs before paint (inline script) so there's no flash of the wrong
// theme on load. Reads the stored preference; falls back to OS preference
// (no data-theme attribute at all) if the user hasn't chosen one.
const THEME_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('macromate-theme');
    if (stored === 'dark' || stored === 'light') {
      document.documentElement.setAttribute('data-theme', stored);
    }
  } catch (e) {}
})();
`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />;
}
