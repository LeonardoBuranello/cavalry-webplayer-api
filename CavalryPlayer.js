const wasm = await import('./wasm-lib/CavalryWasm.js');
const module = await wasm.default({
    locateFile: (path) => `./wasm-lib/${path}`,
});

export class CavalryPlayer {
    #animationFrameId = null;
    #surface = null;
    #pane = null; // Il pannello Tweakpane
    module = module;
    player = null;
    canvas = null;

    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        module.specialHTMLTargets['#canvas'] = this.canvas;
        
        // Inizializziamo Tweakpane
        this.#pane = new Tweakpane.Pane({ title: 'Control Centre' });
        
        window.addEventListener('resize', () => this.resize());
    }

    async load(url) {
        const response = await fetch(url);
        const contents = await response.arrayBuffer();
        const filename = url.split('/').pop();
        
        if (this.player) this.stop();
        module.FS.writeFile(filename, new Uint8Array(contents));
        this.player = module.Cavalry.MakeWithPath(filename);

        this.setupTweakpane(); // Crea i controlli automaticamente
        this.resize();
        this.play();
    }

    setupTweakpane() {
        const compId = this.player.getActiveComp();
        const attributesPointer = this.player.getControlCentreAttributes(compId);
        const attributeIds = this.vectorToArray(attributesPointer);

        // Aggiungiamo i controlli di riproduzione base
        const playbackFolder = this.#pane.addFolder({ title: 'Playback' });
        playbackFolder.addButton({ title: 'Play/Pause' }).on('click', () => this.togglePlayback());
        playbackFolder.addButton({ title: 'Restart' }).on('click', () => this.restart());

        const controlsFolder = this.#pane.addFolder({ title: 'Parameters' });

        attributeIds.forEach(attrPath => {
            const [layerId, ...rest] = attrPath.split('.');
            const attrId = rest.join('.');
            const definition = this.player.getAttributeDefinition(layerId, attrId);
            const initialValue = this.player.getAttribute(layerId, attrId);
            const label = this.player.getAttributeName(layerId, attrId) || attrId;

            // Creiamo un oggetto temporaneo per Tweakpane
            const proxy = { value: initialValue };

            // Se è un colore, dobbiamo gestirlo specialmente
            if (definition.type === 'color' || attrId.toLowerCase().includes('color')) {
                // Convertiamo array [0-1] in HEX per Tweakpane
                proxy.value = this.rgbToHex(initialValue);
                
                controlsFolder.addInput(proxy, 'value', { label }).on('change', (ev) => {
                    const rgba = this.hexToRgbaArray(ev.value);
                    this.player.setAttribute(layerId, attrId, rgba);
                    this.renderIfStatic();
                });
            } else {
                // Per numeri, slider e checkbox
                const options = { label };
                if (definition.numericInfo?.hasHardMin) options.min = definition.numericInfo.hardMin;
                if (definition.numericInfo?.hasHardMax) options.max = definition.numericInfo.hardMax;

                controlsFolder.addInput(proxy, 'value', options).on('change', (ev) => {
                    this.player.setAttribute(layerId, attrId, ev.value);
                    this.renderIfStatic();
                });
            }
        });
    }

    // --- UTILITIES ---
    renderIfStatic() {
        if (!this.player.isPlaying()) this.render();
    }

    hexToRgbaArray(hex) {
        // Ritorna l'array [0.0 - 1.0] che Cavalry ama
        const r = parseInt(hex.substring(1, 3), 16) / 255;
        const g = parseInt(hex.substring(3, 5), 16) / 255;
        const b = parseInt(hex.substring(5, 7), 16) / 255;
        return [r, g, b, 1.0];
    }

    rgbToHex(colorValue) {
        if (typeof colorValue === 'string') return colorValue;
        return "#" + colorValue.slice(0, 3).map(x => {
            const val = Math.round(x * 255);
            return val.toString(16).padStart(2, '0');
        }).join("");
    }

    vectorToArray(v) {
        if (!v || typeof v.size !== 'function') return [];
        return new Array(v.size()).fill(0).map((_, i) => v.get(i));
    }

    // --- CORE ENGINE ---
    render() { this.player.render(this.#surface); }

    play() {
        this.player.play();
        const tick = (ts) => {
            if (!this.player || !this.player.isPlaying()) return;
            this.player.tick(this.#surface, ts);
            this.#animationFrameId = requestAnimationFrame(tick);
        };
        this.#animationFrameId = requestAnimationFrame(tick);
    }

    stop() {
        this.player.stop();
        cancelAnimationFrame(this.#animationFrameId);
    }

    togglePlayback() { this.player.isPlaying() ? this.stop() : this.play(); }
    restart() { this.player.setFrame(0); this.renderIfStatic(); }
    
    resize() {
        const res = this.player.getSceneResolution();
        const p = this.canvas.parentElement;
        const s = Math.min(p.offsetWidth / res.width, p.offsetHeight / res.height) * 0.9;
        this.canvas.width = res.width * s;
        this.canvas.height = res.height * s;
        this.#surface = module.makeWebGLSurfaceFromElement(this.canvas, this.canvas.width, this.canvas.height);
        this.renderIfStatic();
    }
}
