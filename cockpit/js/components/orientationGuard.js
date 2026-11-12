/**
 * ============================================================================
 * JARVIS COCKPIT — PORTRAIT ORIENTATION SHIELD
 * ============================================================================
 * Enforces landscape-first cockpit view. If device is in portrait mode,
 * displays a sleek sci-fi HUD rotation directive.
 * ============================================================================
 */

export class OrientationGuard {
  constructor(overlayElement) {
    this.overlay = overlayElement;
    this.render();
    this.checkOrientation();
    window.addEventListener('resize', () => this.checkOrientation());
    window.addEventListener('orientationchange', () => this.checkOrientation());
  }

  render() {
    this.overlay.innerHTML = `
      <div class="portrait-shield hidden" id="portrait-shield">
        <div class="shield-content">
          <div class="shield-rotate-icon">
            <span class="device-icon">📱</span>
            <span class="rotate-arrow">⤹</span>
          </div>
          <h2 class="shield-title">JARVIS COCKPIT // ORIENTATION LOCK</h2>
          <p class="shield-subtitle">
            FLIGHT INSTRUMENTATION REQUIRES <strong>LANDSCAPE ORIENTATION</strong>.
          </p>
          <div class="shield-tech-bar">
            <span>SYSTEM READY</span> // <span>AWAITING VIEWPORT ROTATION</span>
          </div>
        </div>
      </div>
    `;
  }

  checkOrientation() {
    const shield = this.overlay.querySelector('#portrait-shield');
    if (!shield) return;

    const isPortrait = window.innerHeight > window.innerWidth && window.innerWidth < 900;
    shield.classList.toggle('hidden', !isPortrait);
  }
}

