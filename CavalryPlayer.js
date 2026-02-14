const wasm = await import('./wasm-lib/CavalryWasm.js');
const module = await wasm.default({
    locateFile: (path) => `./wasm-lib/${path}`,
});

export class CavalryPlayer {
    #animationFrameId = null;
    #surface = null;
    #pane = null;
    module = module;
    player = null;
    canvas = null;

    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) throw new Error(`Canvas con id ${canvasId} non trovato!`);

        module.specialHTMLTargets['#canvas'] = this.canvas;
        
        // Inizializziamo Tweakpane - apparirà nell'angolo in alto a destra
        this.#pane = new Tweakpane.Pane({ title: 'Giraffa Control Centre' });
        
        window.addEventListener('resize', () => this.resize());
    }

    async load(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Impossibile caricare il file della scena: ${url}`);
        
        const contents = await response.arrayBuffer();
        const filename = url.split('/').pop();
        
        if (this.player) this.stop();
        module.FS.writeFile(filename, new Uint8Array(contents));
        this.player = module.Cavalry.MakeWithPath(filename);

        this.setupTweakpane();
        this.resize();
        this.play();
    }

    setupTweakpane() {
        if (!this.player) return;
        
        const compId = this.player.getActiveComp();
        const attributesPointer = this.player.getControlCentreAttributes(compId);
        const attributeIds = this.vectorToArray(attributesPointer);

        // Cartella Playback
        const playbackFolder = this.#pane.addFolder({ title: 'Animazione' });
        playbackFolder.addButton({ title: 'Play / Pausa' }).on('click', () => this.togglePlayback());
        playbackFolder.addButton({ title: 'Reset' }).on('click', () => this.restart());

        // Cartella Parametri (Control Centre)
        const controlsFolder = this.#pane.addFolder({ title: 'Parametri Cavalry', expanded: true });

        attributeIds.forEach(attrPath => {
            const [layerId, ...rest] = attrPath.split('.');
            const attrId = rest.join('.');
            const definition = this.player.getAttributeDefinition(layerId, attrId);
            const initialValue = this.player.getAttribute(layerId, attrId);
            const label = this.player.getAttributeName(layerId, attrId) || attrId;

            const proxy = { value: initialValue };

            // LOGICA COLORE
            if (definition.type === 'color' || attrId.toLowerCase().includes('color')) {
                proxy.value = this.rgbToHex(initialValue);
                controlsFolder.addInput(proxy, 'value', { label, view: 'color' }).on('change', (ev) => {
                    const rgba = this.hexToRgbaArray(ev.value);
                    this.player.setAttribute(layerId, attrId, rgba);
                    this.renderIfStatic();
                });
            } 
            // LOGICA BOOLEAN (Checkbox)
            else if (definition.type === 'bool') {
                controlsFolder.addInput(proxy, 'value', { label }).on('change', (ev) => {
                    this.player.setAttribute(layerId, attrId, ev.value);
                    this.renderIfStatic();
                });
            }
            // LOGICA NUMERI (Slider)
            else {
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

    renderIfStatic() {
        if (this.player && !this.player.isPlaying()) this.render();
    }

    hexToRgbaArray(hex) {
        const r = parseInt(hex.substring(1, 3), 16) / 255;
        const g = parseInt(hex.substring(3, 5), 16) / 255;
        const b = parseInt(hex.substring(5, 7), 16) / 255;
        return [r, g, b, 1.0];
    }

    rgbToHex(colorValue) {
        if (typeof colorValue === 'string') return colorValue;
        const rgba = Array.isArray(colorValue) ? colorValue : [0,0,0];
        return "#" + rgba.slice(0, 3).map(x => {
            const val = Math.round(x * 255);
            return Math.max(0, Math.min(255, val)).toString(16).padStart(2, '0');
        }).join("");
    }

    vectorToArray(v) {
        if (!v || typeof v.size !== 'function') return [];
        const arr = [];
        for (let i = 0; i < v.size(); i++) { arr.push(v.get(i)); }
        return arr;
    }

    render() { if (this.player && this.#surface) this.player.render(this.#surface); }

    play() {
        if (!this.player) return;
        this.player.play();
        const tick = (ts) => {
            if (!this.player || !this.player.isPlaying()) return;
            this.player.tick(this.#surface, ts);
            this.#animationFrameId = requestAnimationFrame(tick);
        };
        this.#animationFrameId = requestAnimationFrame(tick);
    }

    stop() {
        if (this.player) this.player.stop();
        cancelAnimationFrame(this.#animationFrameId);
    }

    togglePlayback() { this.player.isPlaying() ? this.stop() : this.play(); }
    restart() { if (this.player) { this.player.setFrame(0); this.renderIfStatic(); } }
    
    resize() {
        if (!this.player) return;
        const res = this.player.getSceneResolution();
        const p = this.canvas.parentElement;
        const s = Math.min(p.offsetWidth / res.width, p.offsetHeight / res.height) * 0.9;
        this.canvas.width = res.width * s;
        this.canvas.height = res.height * s;
        this.#surface = module.makeWebGLSurfaceFromElement(this.canvas, this.canvas.width, this.canvas.height);
        this.renderIfStatic();
    }
}
