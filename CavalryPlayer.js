// 1. IMPORT DEL MOTORE
const wasm = await import('./wasm-lib/CavalryWasm.js')

const module = await wasm.default({
    locateFile: (path) => `./wasm-lib/${path}`,
    print: (text) => console.log(text),
    printErr: (text) => console.error(text),
})

export class CavalryPlayer {
    #animationFrameId = null
    #container = null
    #surface = null
    #controls = null
    #timeline = null
    #playButton = null
    #options = {}
    module = module
    player = null
    canvas = null

    constructor(parent, options = {}) {
        this.#options.autoplay = options.autoplay ?? true
        const ui = this.createInterface()
        parent.innerHTML = ''
        parent.appendChild(ui)

        ui.querySelector('#btn-play').onclick = () => this.togglePlayback()
        ui.querySelector('#btn-restart').onclick = () => this.restart()
        ui.querySelector('#btn-prev').onclick = () => this.prev()
        ui.querySelector('#btn-next').onclick = () => this.next()
        
        this.#playButton = ui.querySelector('#btn-play')
        this.#timeline = ui.querySelector('#frame-slider')
        this.#controls = ui.querySelector('#dynamic-controls')
        this.#container = ui.querySelector('#player-canvas-container')
        this.canvas = ui.querySelector('#canvas')
        
        module.specialHTMLTargets['#canvas'] = this.canvas
        window.addEventListener('resize', () => this.resize())
    }

    createInterface() {
        const container = document.createElement('div')
        container.className = 'player-ui-root'
        container.innerHTML = `
            <div class="main-layout">
                <div id="player-canvas-container" class="canvas-area">
                    <canvas id="canvas"></canvas>
                </div>
                <div class="sidebar">
                    <div class="toolbar">
                        <button id="btn-restart">⏮</button>
                        <button id="btn-prev">◀</button>
                        <button id="btn-play">Pause</button>
                        <button id="btn-next">▶</button>
                    </div>
                    <div class="slider-container">
                        <input type="range" id="frame-slider" value="0">
                    </div>
                    <div class="control-centre-header">Control Centre</div>
                    <div id="dynamic-controls" class="controls-grid"></div>
                </div>
            </div>
        `
        return container
    }

    async load(url) {
        const response = await fetch(url)
        const contents = await response.arrayBuffer()
        await this.loadScene(new Uint8Array(contents), url.split('/').pop())
    }

    async loadScene(contents, filename = '') {
        try {
            if (this.player) this.stop()
            module.FS.writeFile(filename, contents)
            this.player = module.Cavalry.MakeWithPath(filename)
            this.loadControlCentreAttributes()
            this.setTimelineAttributes()
            this.resize()
            if (this.#options.autoplay) this.play()
        } catch (error) { console.error(error) }
    }

    loadControlCentreAttributes() {
        if (!this.player) return
        const compId = this.player.getActiveComp()
        const attributesPointer = this.player.getControlCentreAttributes(compId)
        const attributeIds = vectorToArray(attributesPointer)
        this.#controls.innerHTML = ''
        this.#controls.appendChild(this.createControls(attributeIds))
    }

    createControls(attributes = []) {
        const fragment = document.createDocumentFragment()
        for (const attribute of attributes) {
            const group = document.createElement('div')
            group.className = 'control-group'
            const [layerId, ...attr] = attribute.split('.')
            const attrId = attr.join('.')
            
            const label = document.createElement('label')
            label.className = 'control-label'
            label.textContent = this.player.getAttributeName(layerId, attrId) || attrId
            
            const definition = this.player.getAttributeDefinition(layerId, attrId)
            const input = this.createControl({
                type: definition.type,
                value: this.player.getAttribute(layerId, attrId),
                limits: definition.numericInfo,
                layerId,
                attrId
            })
            
            group.appendChild(label)
            group.appendChild(input)
            fragment.appendChild(group)
        }
        return fragment
    }

    createControl({ layerId, attrId, type, value, limits }) {
    const input = document.createElement('input');
    
    if (type === 'color' || attrId.toLowerCase().includes('color')) {
        input.type = 'color';
        input.className = 'color-picker-custom';
        
        // Assicuriamoci di convertire correttamente il colore iniziale
        input.value = this.rgbToHex(value);

        input.oninput = (e) => {
            const hex = e.target.value;
            // CONVERSIONE CRUCIALE: Da HEX a Array [R, G, B, A] con valori 0.0-1.0
            const rgba = this.hexToRgbaArray(hex);
            
            // Applichiamo al player
            this.player.setAttribute(layerId, attrId, rgba);
            
            // Forza il ridisegno immediato per evitare il "fermo immagine" grigio
            if (!this.player.isPlaying()) {
                this.render();
            }
        };
    } 
    // ... resto del codice per checkbox e slider ...
    return input;
}

// QUESTA FUNZIONE È IL "CERVELLO" CHE EVITA IL GRIGIO
hexToRgbaArray(hex) {
    hex = hex.replace('#', '');
    // Dividiamo per 255 per ottenere i decimali (0.0 - 1.0) richiesti da Cavalry
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    return [r, g, b, 1.0]; 
}

rgbToHex(colorValue) {
    if (typeof colorValue === 'string') return colorValue;
    if (Array.isArray(colorValue)) {
        // Se Cavalry ci dà già i decimali, li riportiamo a 255 per il browser
        return "#" + colorValue.slice(0, 3).map(x => {
            const val = x <= 1 ? Math.round(x * 255) : x;
            const hex = Math.max(0, Math.min(255, val)).toString(16);
            return hex.padStart(2, '0');
        }).join("");
    }
    return "#000000";
}

    render() { this.player.render(this.#surface); }
    
    // Altri metodi (resize, play, stop, etc.) restano invariati dal tuo originale...
    resize() {
        if (!this.player || !this.canvas) return
        const scene = this.player.getSceneResolution()
        const parent = this.canvas.parentElement
        const scale = Math.min((parent.offsetWidth * 0.9) / scene.width, (parent.offsetHeight * 0.9) / scene.height)
        this.canvas.width = scene.width * scale
        this.canvas.height = scene.height * scale
        this.#surface = module.makeWebGLSurfaceFromElement(this.canvas, this.canvas.width, this.canvas.height)
        if (!this.player.isPlaying()) this.render()
    }

    setTimelineAttributes() {
        this.#timeline.min = this.player.getStartFrame();
        this.#timeline.max = this.player.getEndFrame();
        this.#timeline.oninput = (e) => { this.player.setFrame(parseInt(e.target.value)); this.render(); }
    }

    togglePlayback() { this.player.isPlaying() ? this.stop() : this.play(); }

    play() {
        this.player.play();
        this.#playButton.innerText = 'Pause';
        const tick = (timestamp) => {
            if (!this.player || !this.player.isPlaying()) return;
            const status = this.player.tick(this.#surface, timestamp);
            if (status.frameChanged) this.#timeline.value = status.currentFrame;
            this.#animationFrameId = requestAnimationFrame(tick);
        }
        this.#animationFrameId = requestAnimationFrame(tick);
    }

    stop() {
        this.player.stop();
        this.#playButton.innerText = 'Play';
        cancelAnimationFrame(this.#animationFrameId);
    }

    restart() { this.player.setFrame(0); if (!this.player.isPlaying()) this.render(); }
    prev() { this.player.setFrame(this.player.getCurrentFrame() - 1); this.render(); }
    next() { this.player.setFrame(this.player.getCurrentFrame() + 1); this.render(); }
}

function vectorToArray(vector) {
    if (typeof vector?.size !== 'function') return []
    return new Array(vector.size()).fill(0).map((_, index) => vector.get(index))
}
