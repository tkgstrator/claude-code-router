// Static CSS injected once so Powerline-style module chips render their
// triangular separators; colors are driven by the `data-current-bg` attribute
// set per module (see hex-colors.ts for the hex-color variant of this table).
export const POWERLINE_SEPARATOR_STYLES = `
  .powerline-module {
    display: inline-flex;
    align-items: center;
    height: 28px;
    position: relative;
    padding: 0 8px;
    overflow: visible;
  }

  .powerline-module-content {
    display: flex;
    align-items: center;
    gap: 4px;
    position: relative;
  }

  .powerline-separator {
    width: 0;
    height: 0;
    border-top: 14px solid transparent;
    border-bottom: 14px solid transparent;
    border-left: 8px solid;
    position: absolute;
    right: -8px;
    top: 0;
    display: block;
  }

  /* Use z-index so each module's triangle overlays the next module */
  .cursor-pointer:nth-child(1) .powerline-separator { z-index: 10; }
  .cursor-pointer:nth-child(2) .powerline-separator { z-index: 9; }
  .cursor-pointer:nth-child(3) .powerline-separator { z-index: 8; }
  .cursor-pointer:nth-child(4) .powerline-separator { z-index: 7; }
  .cursor-pointer:nth-child(5) .powerline-separator { z-index: 6; }
  .cursor-pointer:nth-child(6) .powerline-separator { z-index: 5; }
  .cursor-pointer:nth-child(7) .powerline-separator { z-index: 4; }
  .cursor-pointer:nth-child(8) .powerline-separator { z-index: 3; }
  .cursor-pointer:nth-child(9) .powerline-separator { z-index: 2; }
  .cursor-pointer:nth-child(10) .powerline-separator { z-index: 1; }

  .cursor-pointer:last-child .powerline-separator {
    display: none;
  }

  /* Drive separator color from the data attribute to match the module background */
  .powerline-separator[data-current-bg="bg_black"] { border-left-color: #000000; }
  .powerline-separator[data-current-bg="bg_red"] { border-left-color: #dc2626; }
  .powerline-separator[data-current-bg="bg_green"] { border-left-color: #16a34a; }
  .powerline-separator[data-current-bg="bg_yellow"] { border-left-color: #eab308; }
  .powerline-separator[data-current-bg="bg_blue"] { border-left-color: #3b82f6; }
  .powerline-separator[data-current-bg="bg_magenta"] { border-left-color: #a855f7; }
  .powerline-separator[data-current-bg="bg_cyan"] { border-left-color: #06b6d4; }
  .powerline-separator[data-current-bg="bg_white"] { border-left-color: #ffffff; }
  .powerline-separator[data-current-bg="bg_bright_black"] { border-left-color: #1f2937; }
  .powerline-separator[data-current-bg="bg_bright_red"] { border-left-color: #f87171; }
  .powerline-separator[data-current-bg="bg_bright_green"] { border-left-color: #4ade80; }
  .powerline-separator[data-current-bg="bg_bright_yellow"] { border-left-color: #fde047; }
  .powerline-separator[data-current-bg="bg_bright_blue"] { border-left-color: #93c5fd; }
  .powerline-separator[data-current-bg="bg_bright_magenta"] { border-left-color: #c084fc; }
  .powerline-separator[data-current-bg="bg_bright_cyan"] { border-left-color: #22d3ee; }
  .powerline-separator[data-current-bg="bg_bright_white"] { border-left-color: #f3f4f6; }
  .powerline-separator[data-current-bg="bg_bright_orange"] { border-left-color: #fb923c; }
  .powerline-separator[data-current-bg="bg_bright_purple"] { border-left-color: #c084fc; }
`
