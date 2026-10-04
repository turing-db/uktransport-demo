// Page-only styles; every colour is a kit token (--tk-*) or a mode colour passed inline.
export const UKT_CSS = `
/* No host side bar on this page (the kit's chrome policy has no switch for it):
   hide its cell and give the content the whole width of the layout grid. */
.grid:has(> .row-span-2 img[aria-label="turing-logo"]) { grid-template-columns: 1fr; }
.row-span-2:has(img[aria-label="turing-logo"]) { display: none; }
.ukt-root { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--tk-bg, #0E1014); }
.ukt-logo { color: var(--tk-accent); font-size: 18px; text-shadow: 0 0 12px var(--tk-accent); }
.ukt-tip { position: absolute; z-index: 30; pointer-events: none; max-width: 280px; padding: 6px 9px; border-radius: 6px;
  background: color-mix(in srgb, var(--tk-panel) 92%, transparent); border: 1px solid var(--tk-border); color: var(--tk-text-strong);
  font: 12px var(--tk-font); box-shadow: 0 6px 24px rgba(0,0,0,0.45); backdrop-filter: blur(6px); }
.ukt-ribbon { position: absolute; z-index: 15; bottom: 14px; left: 416px; display: flex; gap: 14px;
  padding: 6px 14px; border-radius: 999px; white-space: nowrap; pointer-events: none; font: 12px var(--tk-font); color: var(--tk-text-mute);
  background: color-mix(in srgb, var(--tk-panel) 80%, transparent); border: 1px solid var(--tk-border); backdrop-filter: blur(6px); }
.ukt-ribbon b { color: var(--tk-text-strong); font-weight: 600; }
.ukt-hud { position: absolute; z-index: 25; left: 50%; top: 50%; transform: translate(calc(-50% + 200px), -50%); width: 360px; padding: 18px 20px;
  border-radius: 12px; background: color-mix(in srgb, var(--tk-panel) 88%, transparent); border: 1px solid var(--tk-border);
  box-shadow: 0 0 60px color-mix(in srgb, var(--tk-accent) 18%, transparent); backdrop-filter: blur(8px); font: 13px var(--tk-font); color: var(--tk-text); }
.ukt-hud-title { color: var(--tk-text-strong); font-weight: 600; margin-bottom: 10px; }
.ukt-step { display: flex; justify-content: space-between; gap: 10px; padding: 3px 0; font-size: 12px; }
.ukt-step[data-done="false"] { color: var(--tk-text-mute); }
.ukt-edges { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; font-size: 11px; color: var(--tk-text-mute); }
.ukt-mode { display: grid; grid-template-columns: 22px 1fr auto; align-items: center; gap: 8px; width: 100%; padding: 6px 4px;
  background: none; border: 0; border-radius: 6px; color: var(--tk-text); cursor: pointer; text-align: left; font: inherit; }
.ukt-mode:hover { background: var(--tk-card); }
.ukt-mode i { display: block; height: 4px; border-radius: 2px; }
.ukt-mode[data-on="false"] { opacity: 0.38; }
.ukt-mode[data-on="false"] i { box-shadow: none; }
.ukt-mode-label { color: var(--tk-text-strong); font-weight: 500; }
.ukt-search { position: relative; margin-bottom: 12px; }
.ukt-search .tk-input { width: 100%; }
.ukt-hits { position: absolute; z-index: 5; left: 0; right: 0; top: calc(100% + 4px); padding: 4px; border-radius: 8px;
  background: var(--tk-card); border: 1px solid var(--tk-border); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
.ukt-hits button { display: grid; grid-template-columns: 10px 1fr; column-gap: 8px; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px;
  background: none; color: var(--tk-text-strong); text-align: left; cursor: pointer; font: inherit; font-size: 12px; }
.ukt-hits button:hover { background: var(--tk-raised); }
.ukt-hits i { width: 8px; height: 8px; border-radius: 50%; align-self: center; }
.ukt-hits small { grid-column: 2; color: var(--tk-text-mute); }
.ukt-card { position: absolute; z-index: 20; top: 12px; right: 12px; width: 340px; max-height: calc(100% - 24px); overflow-y: auto; }
.ukt-routes { display: flex; flex-direction: column; gap: 1px; margin-top: 4px; }
.ukt-legs { display: flex; flex-direction: column; gap: 8px; margin: 12px 0 10px; }
.ukt-leg { border-left: 3px solid; padding: 2px 0 2px 10px; }
.ukt-leg[data-walk="true"] { border-left-style: dotted; }
.ukt-leg-head { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12px; }
.ukt-leg-service { margin-top: 2px; }
.ukt-stops { display: flex; flex-direction: column; margin-top: 6px; }
.ukt-stop { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 8px; padding: 2px 4px 2px 0; border: 0;
  background: none; color: var(--tk-text); font: inherit; font-size: 12px; text-align: left; cursor: pointer; border-radius: 4px; }
.ukt-stop:hover { background: var(--tk-card); }
.ukt-stop i { width: 8px; height: 8px; margin-left: 2px; border-radius: 50%; border: 2px solid; background: var(--tk-panel); box-sizing: border-box; }
.ukt-stop[data-role="end"] { color: var(--tk-text-strong); font-weight: 600; }
.ukt-stop[data-role="end"] i { width: 11px; height: 11px; margin-left: 0; }
.ukt-stop small { color: var(--tk-text-mute); font-weight: 400; }
.ukt-stop .tk-num { color: var(--tk-text-mute); font-weight: 400; }
.ukt-more span { color: var(--tk-link); }
`
