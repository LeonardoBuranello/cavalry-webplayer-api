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

		// Collegamento dei pulsanti
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

	async load(url) {
		const response = await fetch(url)
		if (!response.ok) throw new Error(`Errore caricamento: ${response.statusText}`)
		const contents = await response.arrayBuffer()
		await this.loadScene(new Uint8Array(contents), url.split('/').pop())
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
						<button id="btn-restart" title="Ricomincia">⏮</button>
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

	async loadScene(contents, filename = '') {
		try {
			if (this.player) this.stop()
			module.FS.writeFile(filename, contents)
			this.player = module.Cavalry.MakeWithPath(filename)
			this.loadControlCentreAttributes()
			this.setTimelineAttributes()
			this.resize()
			if (this.#options.autoplay) this.play()
		} catch (error) {
			console.error(error)
		}
	}

	loadControlCentreAttributes() {
		if (!this.player) return
		const compId = this.player.getActiveComp()
		const attributesPointer = this.player.getControlCentreAttributes(compId)
		const attributeIds = vectorToArray(attributesPointer)
		this.#controls.innerHTML = ''
		if (attributeIds.length > 0) {
			this.#controls.appendChild(this.createControls(attributeIds))
		} else {
			this.#controls.innerHTML = '<div style="padding:10px; opacity:0.5">Nessun controllo</div>'
		}
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
    
    // --- GESTIONE COLORE ---
    if (type === 'color' || attrId.toLowerCase().includes('color')) {
        input.type = 'color';
        input.className = 'control-input color-picker-custom';
        
        // Inizializzazione: se Cavalry manda un array [r,g,b,a], lo convertiamo in HEX per il browser
        input.value = this.rgbToHex(value);

        input.oninput = (e) => {
            const hexColor = e.target.value;
            
            /* SPIEGAZIONE: Alcune versioni del player Cavalry preferiscono ricevere 
               il colore come stringa HEX, altre come array. 
               Proviamo a impostarlo direttamente; se l'animazione non risponde, 
               Cavalry di solito gestisce la conversione internamente se riceve la stringa corretta.
            */
            this.player.setAttribute(layerId, attrId, hexColor);
            
            // Forza il refresh immediato del disegno
            if (!this.player.isPlaying()) {
                this.render();
            }
        };
    } 
    // --- GESTIONE CHECKBOX ---
    else if (type === 'bool') {
        input.type = 'checkbox';
        input.className = 'control-input-checkbox'; // Classe specifica per non subire il width: 100%
        input.checked = value;
        input.onchange = (e) => {
            this.player.setAttribute(layerId, attrId, e.target.checked);
            if (!this.player.isPlaying()) this.render();
        };
    } 
    // --- GESTIONE SLIDER / NUMERI ---
    else {
        input.className = 'control-input';
        input.type = (limits.hasHardMin && limits.hasHardMax) ? 'range' : 'number';
        input.value = value;
        if (limits.hasHardMin) input.min = limits.hardMin;
        if (limits.hasHardMax) input.max = limits.hardMax;
        input.step = limits.step || (type === 'int' ? 1 : 0.1);
        
        input.oninput = (e) => {
            const val = type === 'int' ? parseInt(e.target.value) : parseFloat(e.target.value);
            this.player.setAttribute(layerId, attrId, val);
            if (!this.player.isPlaying()) this.render();
        };
    }
    return input;
}

// Questa funzione deve essere all'interno della classe CavalryPlayer
rgbToHex(colorValue) {
    // Se è già una stringa (es. #ffffff), la restituiamo così com'è
    if (typeof colorValue === 'string') return colorValue;
    
    // Se è un array [r, g, b, a] (formato standard Cavalry)
    if (Array.isArray(colorValue)) {
        return "#" + colorValue.slice(0, 3).map(x => {
            // Cavalry usa valori 0.0 - 1.0, il browser 0 - 255
            const hex = Math.round(x * 255).toString(16);
            return hex.length === 1 ? "0" + hex : hex;
        }).join("");
    }
    
    // Valore di default (nero) se il formato è sconosciuto
    return "#000000";
}

	

	resize() {
		if (!this.player || !this.canvas) return
		const scene = this.player.getSceneResolution()
		const parent = this.canvas.parentElement
		if (!parent) return

		const scale = Math.min(
			(parent.offsetWidth * 0.9) / scene.width, 
			(parent.offsetHeight * 0.9) / scene.height
		)
		
		this.canvas.width = scene.width * scale
		this.canvas.height = scene.height * scale
		this.#surface = module.makeWebGLSurfaceFromElement(this.canvas, this.canvas.width, this.canvas.height)
		if (!this.player.isPlaying()) this.render()
	}

	setTimelineAttributes() {
		this.#timeline.min = this.player.getStartFrame()
		this.#timeline.max = this.player.getEndFrame()
		this.#timeline.value = this.player.getStartFrame()
		this.#timeline.oninput = (e) => {
			this.player.setFrame(parseInt(e.target.value))
			this.render()
		}
	}

	togglePlayback() {
		if (!this.player) return
		this.player.isPlaying() ? this.stop() : this.play()
	}

	play() {
		this.player.play()
		this.#playButton.innerText = 'Pause'
		const tick = (timestamp) => {
			if (!this.player || !this.player.isPlaying()) return
			const status = this.player.tick(this.#surface, timestamp)
			if (status.frameChanged) this.#timeline.value = status.currentFrame
			this.#animationFrameId = requestAnimationFrame(tick)
		}
		this.#animationFrameId = requestAnimationFrame(tick)
	}

	stop() {
		this.player.stop()
		this.#playButton.innerText = 'Play'
		cancelAnimationFrame(this.#animationFrameId)
	}

	restart() {
		this.player.setFrame(0)
		this.#timeline.value = 0
		if (!this.player.isPlaying()) this.render()
	}

	prev() { this.player.setFrame(this.player.getCurrentFrame() - 1); this.render(); }
	next() { this.player.setFrame(this.player.getCurrentFrame() + 1); this.render(); }
	render() { this.player.render(this.#surface) }
}

function vectorToArray(vector) {
	if (typeof vector?.size !== 'function') return []
	return new Array(vector.size()).fill(0).map((_, index) => vector.get(index))
}
